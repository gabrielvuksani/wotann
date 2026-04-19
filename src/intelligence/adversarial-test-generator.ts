/**
 * Adversarial test generator — Phase 4 Sprint B2 item 13.
 *
 * Known-test-only scoring overstates patch quality: an agent can solve
 * for the 1-2 tests in the task description while breaking edge cases
 * that aren't covered. The fix is hidden-test augmentation: a CHEAP
 * model reads the patched code and generates N adversarial tests that
 * probe the likely failure modes (null/empty/boundary, type confusion,
 * concurrent access, off-by-one, overflow). Those tests are run
 * AGAINST the patch. Pass rate on the adversarial set gives a more
 * honest signal than the task-provided tests alone.
 *
 * This module ships:
 *   - createLlmAdversarialGenerator(query) — LLM-backed generator factory
 *   - runAdversarialTests(original, patched, opts) — writes tests to a
 *     temp file, invokes the test-command, parses results, cleans up
 *
 * The adversarial LLM prompt is short, deterministic, and self-critical:
 * the model must name WHY each test is adversarial (prevents cargo-cult
 * "just write another happy-path test"). We parse the response via a
 * fenced ```json block (same contract as llm-modification-generator).
 *
 * Integrates with patch-scorer: a full adversarial run is (patch-score
 * baseline) + (adversarial-score overlay) → weighted combined number.
 */

import { writeFile, unlink, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseVitestJson, parseGeneric } from "./patch-scorer.js";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────

export interface AdversarialTest {
  /** Short identifier (used in test file + reports). */
  readonly name: string;
  /** Full test body as emitted by the LLM — vitest `it("...", () => {...})`
   * or equivalent in target framework. */
  readonly code: string;
  /** Why this test is adversarial — what edge case / failure mode it probes. */
  readonly rationale: string;
}

export interface AdversarialTestGenerator {
  readonly generate: (
    context: AdversarialContext,
    count: number,
  ) => Promise<readonly AdversarialTest[]>;
}

export interface AdversarialContext {
  /** Source path that was patched (relative to workDir). */
  readonly filePath: string;
  /** Original code BEFORE patch. */
  readonly originalCode: string;
  /** Patched code AFTER patch. */
  readonly patchedCode: string;
  /** Optional task description / problem statement. */
  readonly taskDescription?: string;
  /** Optional target language — defaults to typescript. */
  readonly language?: "typescript" | "javascript" | "python";
}

export type LlmQuery = (
  prompt: string,
  options: { readonly maxTokens: number; readonly temperature?: number },
) => Promise<string>;

export interface AdversarialRunOptions {
  readonly workDir: string;
  /** Where to write the generated test file. Must be inside workDir. */
  readonly testFilePath: string;
  /** Argv for the test command (must target the generated file). */
  readonly testCommand: readonly string[];
  /** Max ms for the test run. Default 120_000 (2m). */
  readonly timeoutMs?: number;
  /** Number of adversarial tests to generate. Default 3. */
  readonly count?: number;
  /** Generator implementation — LLM-backed or stubbed for tests. */
  readonly generator: AdversarialTestGenerator;
  /** Preserve generated test file on disk after run (for debugging). Default false. */
  readonly keepFile?: boolean;
}

export interface AdversarialRunResult {
  readonly tests: readonly AdversarialTest[];
  /** Count of adversarial tests that passed. */
  readonly passed: number;
  /** Count of adversarial tests that failed. */
  readonly failed: number;
  /** Pass rate 0-1 (0 on empty test set). */
  readonly passRate: number;
  /** Per-test pass/fail breakdown. */
  readonly perTest: ReadonlyArray<{
    readonly test: AdversarialTest;
    readonly passed: boolean;
  }>;
  /** Full stdout/stderr for forensic analysis. */
  readonly stdout: string;
  readonly stderr: string;
}

// ── LLM-backed generator ───────────────────────────────

const EDGE_CASE_CATEGORIES = [
  "null / undefined inputs",
  "empty collections (empty string, empty array, empty object)",
  "boundary values (0, -1, MAX_SAFE_INTEGER, NaN, Infinity)",
  "type coercion (number where string expected, etc.)",
  "duplicate / repeated inputs",
  "unicode / non-ASCII characters",
  "concurrent / async reentry",
  "off-by-one in loops or indexing",
] as const;

function buildAdversarialPrompt(ctx: AdversarialContext, count: number): string {
  const lang = ctx.language ?? "typescript";
  const frameworkHint =
    lang === "python"
      ? "pytest with `def test_<name>():` blocks"
      : "vitest with `it('<name>', () => { ... });` blocks";

  const categories = EDGE_CASE_CATEGORIES.map((c) => `  - ${c}`).join("\n");

  return `You are an adversarial test generator. Your job is to find WAYS THE PATCH BELOW COULD BE WRONG — not to confirm it's right.

Target file: ${ctx.filePath}
Language: ${lang}
Framework: ${frameworkHint}
Generate exactly ${count} adversarial tests.

CANDIDATE EDGE-CASE CATEGORIES (pick ${count} DISTINCT ones, no duplicates):
${categories}

ORIGINAL CODE (before patch):
\`\`\`${lang}
${ctx.originalCode.slice(0, 8000)}
\`\`\`

PATCHED CODE (after agent's fix):
\`\`\`${lang}
${ctx.patchedCode.slice(0, 8000)}
\`\`\`
${ctx.taskDescription ? `\nTASK DESCRIPTION:\n${ctx.taskDescription.slice(0, 2000)}\n` : ""}
Output a single fenced JSON block with shape:
\`\`\`json
{
  "tests": [
    {
      "name": "rejects_empty_input",
      "rationale": "Patched function uses .length without null-guard; empty array should return 0 not crash.",
      "code": "it('rejects empty input', () => { expect(fn([])).toBe(0); });"
    }
  ]
}
\`\`\`

Rules:
- Each test MUST be a complete ${frameworkHint} block.
- Each rationale MUST explain what SPECIFIC line of the patch could break.
- Do NOT generate happy-path tests. Every test should probe a likely bug.
- Do NOT re-test what the task description already covers.
- Names must be snake_case or camelCase, unique.`;
}

/**
 * Parse LLM response into a structured AdversarialTest list.
 * Tolerant: accepts fenced ```json blocks or bare JSON.
 */
export function parseAdversarialResponse(raw: string): AdversarialTest[] {
  if (!raw) return [];

  // Prefer fenced ```json block
  const fenced = raw.match(/```json\s*\n([\s\S]*?)\n```/);
  const jsonCandidate = fenced?.[1] ?? raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    // Brace-balanced fallback
    const firstBrace = jsonCandidate.indexOf("{");
    const lastBrace = jsonCandidate.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return [];
    try {
      parsed = JSON.parse(jsonCandidate.slice(firstBrace, lastBrace + 1));
    } catch {
      return [];
    }
  }

  const testsRaw = (parsed as { tests?: unknown[] }).tests;
  if (!Array.isArray(testsRaw)) return [];

  const tests: AdversarialTest[] = [];
  const seen = new Set<string>();
  for (const t of testsRaw) {
    const rec = t as { name?: unknown; code?: unknown; rationale?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const code = typeof rec.code === "string" ? rec.code.trim() : "";
    const rationale = typeof rec.rationale === "string" ? rec.rationale.trim() : "";
    if (!name || !code || !rationale) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    tests.push({ name, code, rationale });
  }
  return tests;
}

export function createLlmAdversarialGenerator(query: LlmQuery): AdversarialTestGenerator {
  return {
    generate: async (ctx, count) => {
      const prompt = buildAdversarialPrompt(ctx, count);
      const response = await query(prompt, { maxTokens: 4096, temperature: 0.7 });
      const tests = parseAdversarialResponse(response);
      return tests.slice(0, count);
    },
  };
}

// ── Test file generation ───────────────────────────────

/**
 * Wrap N tests into a single vitest file with the correct imports.
 * Callers must ensure the patched code is reachable from `testFilePath`
 * via relative import.
 */
export function buildTestFileContent(
  tests: readonly AdversarialTest[],
  language: "typescript" | "javascript" | "python",
  header?: string,
): string {
  if (language === "python") {
    const preamble = header ?? "# Adversarial tests — auto-generated";
    return `${preamble}\n\n${tests.map((t) => t.code).join("\n\n")}\n`;
  }
  const preamble =
    header ??
    `// Adversarial tests — auto-generated. Do not commit.\nimport { describe, it, expect } from "vitest";`;
  const body = tests.map((t) => t.code).join("\n\n");
  return `${preamble}\n\ndescribe("adversarial", () => {\n${body}\n});\n`;
}

// ── Runner ─────────────────────────────────────────────

/**
 * Generate N adversarial tests, write them to disk, run them, parse
 * results. The generated file is removed by default (set keepFile=true
 * to preserve for debugging).
 */
export async function runAdversarialTests(
  context: AdversarialContext,
  options: AdversarialRunOptions,
): Promise<AdversarialRunResult> {
  const count = options.count ?? 3;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const language = context.language ?? "typescript";

  // 1. Generate
  const tests = await options.generator.generate(context, count);
  if (tests.length === 0) {
    return {
      tests: [],
      passed: 0,
      failed: 0,
      passRate: 0,
      perTest: [],
      stdout: "",
      stderr: "adversarial generator returned zero tests",
    };
  }

  // 2. Write test file
  const fileContent = buildTestFileContent(tests, language);
  const absTestFile = resolve(options.workDir, options.testFilePath);
  await mkdir(dirname(absTestFile), { recursive: true });
  await writeFile(absTestFile, fileContent, "utf-8");

  // 3. Run tests
  const [cmd, ...args] = options.testCommand;
  if (!cmd) {
    if (!options.keepFile) await unlink(absTestFile).catch(() => undefined);
    throw new Error("runAdversarialTests: testCommand must have at least one arg");
  }

  let stdout = "";
  let stderr = "";
  try {
    const r = await execFileAsync(cmd, args, {
      cwd: options.workDir,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, CI: "1", NODE_ENV: "test" },
    });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }

  // 4. Parse results per test
  // Try vitest JSON first, fall back to name-matching on generic output
  const json = parseVitestJson(stdout, stderr);
  const parsed = json.parseSucceeded ? json : parseGeneric(stdout, stderr);

  const perTest = tests.map((test) => {
    // Test ID matching: check if any passing-id contains the test name
    const passing = [...parsed.passingTestIds].some((id) => id.includes(test.name));
    const failing = [...parsed.failingTestIds].some((id) => id.includes(test.name));
    return {
      test,
      passed: passing && !failing,
    };
  });

  const passed = perTest.filter((r) => r.passed).length;
  const failed = perTest.length - passed;

  // 5. Cleanup
  if (!options.keepFile) {
    await unlink(absTestFile).catch(() => undefined);
  }

  return {
    tests,
    passed,
    failed,
    passRate: tests.length > 0 ? passed / tests.length : 0,
    perTest,
    stdout,
    stderr,
  };
}
