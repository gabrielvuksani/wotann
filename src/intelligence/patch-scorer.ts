/**
 * Hidden-test-aware patch scoring — Phase 4 Sprint B2 item 12.
 *
 * Problem: agent-generated patches on SWE-bench / HumanEval / Aider
 * Polyglot are scored by "did tests pass?" — but the agent can game
 * this by either (a) patching the tests themselves, or (b) "fixing" a
 * function in a way that breaks other tests. Without pass-delta
 * accounting, the scoreboard can inflate by 2-5% from false positives.
 *
 * This module runs the existing test suite BEFORE and AFTER a patch,
 * captures the test-id set at each phase, and computes:
 *   - newlyPassing   (failing → passing)   → good, agent fixed something
 *   - newlyFailing   (passing → failing)   → REGRESSION, agent broke something
 *   - stillPassing / stillFailing          → unchanged
 *   - compositeScore = newlyPassing - 2 * newlyFailing
 *                      (regressions weighted 2x because they're
 *                      undetected bugs, not just "didn't help")
 *
 * The patch is applied inside a ShadowGit snapshot so the working
 * tree is auto-restored even if the test command crashes.
 *
 * No LLM calls. No external deps beyond node:child_process + ShadowGit.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ShadowGit } from "../utils/shadow-git.js";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────

export interface PatchFile {
  /** Path relative to workDir. */
  readonly path: string;
  /** New file content (full replacement — no diffs). */
  readonly newContent: string;
}

export interface PatchDescriptor {
  readonly files: readonly PatchFile[];
  /** Optional human-readable label for logs/checkpoints. */
  readonly label?: string;
}

export interface TestRunResult {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly passingTestIds: ReadonlySet<string>;
  readonly failingTestIds: ReadonlySet<string>;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly parseSucceeded: boolean;
}

export interface PatchScore {
  /** AFTER.passed - BEFORE.passed (positive = more tests pass). */
  readonly passDelta: number;
  /** AFTER.failed - BEFORE.failed (negative = fewer failures). */
  readonly failDelta: number;
  /** Test IDs that went from fail → pass (agent fixed something). */
  readonly newlyPassing: readonly string[];
  /** Test IDs that went from pass → fail (REGRESSION — agent broke something). */
  readonly newlyFailing: readonly string[];
  /** Weighted score: newlyPassing.length - 2 * newlyFailing.length. */
  readonly compositeScore: number;
  /** Full before/after test runs (for forensic analysis). */
  readonly before: TestRunResult;
  readonly after: TestRunResult;
  /** Did the patch actually get applied? False on I/O errors. */
  readonly patchApplied: boolean;
  /** Did shadow-git restore succeed? False means working tree is dirty. */
  readonly restored: boolean;
}

export interface PatchScorerOptions {
  /** Absolute path to project root. */
  readonly workDir: string;
  /**
   * Test command as argv array. Default ["npm", "test"].
   * Vitest: ["npx", "vitest", "run", "--reporter=json"]
   * Pytest: ["pytest", "--json-report", "--json-report-file=-"]
   */
  readonly testCommand?: readonly string[];
  /** Max ms for a single test-run (before OR after). Default 600_000 (10m). */
  readonly timeoutMs?: number;
  /** Custom parser — defaults tries vitest-json then generic regex. */
  readonly parser?: TestOutputParser;
  /** Include stdout in result (default true — set false for memory-constrained runs). */
  readonly keepStdout?: boolean;
  /**
   * If true, patch is applied via ShadowGit commit instead of raw fs-writes.
   * Default true — guarantees restorability.
   */
  readonly useShadowGit?: boolean;
}

export type TestOutputParser = (
  stdout: string,
  stderr: string,
) => {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly passingTestIds: Set<string>;
  readonly failingTestIds: Set<string>;
  readonly parseSucceeded: boolean;
};

// ── Parsers ────────────────────────────────────────────

/**
 * Vitest JSON reporter (stdout shape: {testResults: [{name, status, ...}]}).
 * Robust against lines before/after the JSON envelope.
 */
export function parseVitestJson(stdout: string, stderr: string) {
  const _unused = stderr;
  const passing = new Set<string>();
  const failing = new Set<string>();
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // Vitest JSON is a single top-level object. Extract first JSON blob.
  const firstBrace = stdout.indexOf("{");
  const lastBrace = stdout.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return {
      passed,
      failed,
      skipped,
      passingTestIds: passing,
      failingTestIds: failing,
      parseSucceeded: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
  } catch {
    return {
      passed,
      failed,
      skipped,
      passingTestIds: passing,
      failingTestIds: failing,
      parseSucceeded: false,
    };
  }

  const testResults = (parsed as { testResults?: unknown[] }).testResults;
  if (!Array.isArray(testResults)) {
    return {
      passed,
      failed,
      skipped,
      passingTestIds: passing,
      failingTestIds: failing,
      parseSucceeded: false,
    };
  }

  for (const file of testResults) {
    const fileRec = file as { assertionResults?: unknown[]; name?: string };
    const asserts = Array.isArray(fileRec.assertionResults) ? fileRec.assertionResults : [];
    for (const a of asserts) {
      const rec = a as { fullName?: string; title?: string; status?: string };
      const id = rec.fullName ?? rec.title ?? "";
      if (!id) continue;
      const prefixed = (fileRec.name ? `${fileRec.name}::${id}` : id).trim();
      if (rec.status === "passed") {
        passing.add(prefixed);
        passed++;
      } else if (rec.status === "failed") {
        failing.add(prefixed);
        failed++;
      } else if (rec.status === "skipped" || rec.status === "pending") {
        skipped++;
      }
    }
  }

  return {
    passed,
    failed,
    skipped,
    passingTestIds: passing,
    failingTestIds: failing,
    parseSucceeded: passed + failed > 0,
  };
}

/**
 * Generic fallback: count "✓" (pass) and "✗"/"×"/"FAIL" markers.
 * Used when the test framework isn't emitting parseable JSON.
 */
export function parseGeneric(stdout: string, stderr: string) {
  const combined = `${stdout}\n${stderr}`;
  // Vitest textual: "✓ test name" / "✗ test name" / "× test name"
  const passLines = combined.match(/^\s*[✓√]\s+.+$/gm) ?? [];
  const failLines = combined.match(/^\s*[✗×❌]\s+.+$/gm) ?? [];
  const skipLines = combined.match(/^\s*[↓○↷]\s+.+$/gm) ?? [];

  const passing = new Set<string>();
  const failing = new Set<string>();
  for (const line of passLines) {
    passing.add(line.replace(/^\s*[✓√]\s+/, "").trim());
  }
  for (const line of failLines) {
    failing.add(line.replace(/^\s*[✗×❌]\s+/, "").trim());
  }

  // Footer fallback: "Tests 1234 passed, 5 failed" (vitest summary)
  const passed = passing.size;
  const failed = failing.size;
  const skipped = skipLines.length;

  return {
    passed,
    failed,
    skipped,
    passingTestIds: passing,
    failingTestIds: failing,
    parseSucceeded: passed + failed > 0,
  };
}

function tryParse(stdout: string, stderr: string, parser?: TestOutputParser) {
  if (parser) return parser(stdout, stderr);
  // Try vitest JSON first, fall back to generic regex
  const json = parseVitestJson(stdout, stderr);
  if (json.parseSucceeded) return json;
  return parseGeneric(stdout, stderr);
}

// ── Runner ─────────────────────────────────────────────

async function runTestCommand(
  argv: readonly string[],
  workDir: string,
  timeoutMs: number,
  keepStdout: boolean,
): Promise<
  Omit<
    TestRunResult,
    "passed" | "failed" | "skipped" | "passingTestIds" | "failingTestIds" | "parseSucceeded"
  >
> {
  const [cmd, ...args] = argv;
  if (!cmd) throw new Error("PatchScorer: testCommand must have at least one arg");
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: workDir,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB
      env: { ...process.env, CI: "1", NODE_ENV: "test" },
    });
    return {
      stdout: keepStdout ? stdout : "",
      stderr: keepStdout ? stderr : "",
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; signal?: string };
    return {
      stdout: keepStdout ? (e.stdout ?? "") : "",
      stderr: keepStdout ? (e.stderr ?? "") : "",
      exitCode: typeof e.code === "number" ? e.code : -1,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function applyPatchToDisk(workDir: string, patch: PatchDescriptor): Promise<boolean> {
  try {
    for (const file of patch.files) {
      const abs = resolve(workDir, file.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.newContent, "utf-8");
    }
    return true;
  } catch {
    return false;
  }
}

async function snapshotOriginals(
  workDir: string,
  paths: readonly string[],
): Promise<Map<string, string | null>> {
  const snap = new Map<string, string | null>();
  for (const p of paths) {
    try {
      const content = await readFile(resolve(workDir, p), "utf-8");
      snap.set(p, content);
    } catch {
      snap.set(p, null); // file didn't exist
    }
  }
  return snap;
}

async function restoreOriginals(
  workDir: string,
  snap: Map<string, string | null>,
): Promise<boolean> {
  let ok = true;
  for (const [path, content] of snap) {
    try {
      if (content === null) {
        // file didn't exist; we won't delete it here (safer to leave) —
        // callers who need true deletion should use ShadowGit mode.
        continue;
      }
      await writeFile(resolve(workDir, path), content, "utf-8");
    } catch {
      ok = false;
    }
  }
  return ok;
}

// ── API ────────────────────────────────────────────────

/**
 * Score a patch against the test suite. Runs tests BEFORE + AFTER the
 * patch and returns pass-delta plus regression counts.
 *
 * The patch is auto-reverted after scoring. On restore failure, the
 * caller must clean up (check `restored` field).
 */
export async function scorePatch(
  patch: PatchDescriptor,
  options: PatchScorerOptions,
): Promise<PatchScore> {
  const testCommand = options.testCommand ?? ["npm", "test"];
  const timeoutMs = options.timeoutMs ?? 600_000;
  const keepStdout = options.keepStdout ?? true;
  const useShadow = options.useShadowGit ?? true;

  // 1. Run tests BEFORE patch
  const beforeRaw = await runTestCommand(testCommand, options.workDir, timeoutMs, keepStdout);
  const beforeParsed = tryParse(beforeRaw.stdout, beforeRaw.stderr, options.parser);
  const before: TestRunResult = { ...beforeRaw, ...beforeParsed };

  // 2. Snapshot current file state (either via shadow-git or in-memory)
  let shadow: ShadowGit | null = null;
  let shadowHash = "";
  let memSnapshot: Map<string, string | null> | null = null;
  if (useShadow) {
    shadow = new ShadowGit(
      options.workDir,
      join(options.workDir, ".wotann", ".patch-scorer-shadow"),
    );
    await shadow.initialize();
    shadowHash = await shadow.createCheckpoint(`patch-scorer-before-${patch.label ?? Date.now()}`);
  } else {
    memSnapshot = await snapshotOriginals(
      options.workDir,
      patch.files.map((f) => f.path),
    );
  }

  // 3. Apply patch
  const patchApplied = await applyPatchToDisk(options.workDir, patch);

  // 4. Run tests AFTER patch (only if application succeeded)
  let after: TestRunResult;
  if (patchApplied) {
    const afterRaw = await runTestCommand(testCommand, options.workDir, timeoutMs, keepStdout);
    const afterParsed = tryParse(afterRaw.stdout, afterRaw.stderr, options.parser);
    after = { ...afterRaw, ...afterParsed };
  } else {
    after = {
      passed: 0,
      failed: 0,
      skipped: 0,
      passingTestIds: new Set(),
      failingTestIds: new Set(),
      stdout: "",
      stderr: "patch application failed",
      exitCode: -1,
      durationMs: 0,
      parseSucceeded: false,
    };
  }

  // 5. Restore
  let restored = false;
  if (shadow && shadowHash) {
    try {
      await shadow.restore(shadowHash);
      restored = true;
    } catch {
      restored = false;
    }
  } else if (memSnapshot) {
    restored = await restoreOriginals(options.workDir, memSnapshot);
  }

  // 6. Compute diffs
  const newlyPassing: string[] = [];
  const newlyFailing: string[] = [];
  for (const id of after.passingTestIds) {
    if (before.failingTestIds.has(id)) newlyPassing.push(id);
  }
  for (const id of after.failingTestIds) {
    if (before.passingTestIds.has(id)) newlyFailing.push(id);
  }
  newlyPassing.sort();
  newlyFailing.sort();

  const passDelta = after.passed - before.passed;
  const failDelta = after.failed - before.failed;
  const compositeScore = newlyPassing.length - 2 * newlyFailing.length;

  return {
    passDelta,
    failDelta,
    newlyPassing,
    newlyFailing,
    compositeScore,
    before,
    after,
    patchApplied,
    restored,
  };
}

/**
 * Convenience: rank a set of candidate patches by compositeScore (desc).
 * Returns array of [patchIndex, score] sorted best-first. Ties broken
 * by smaller diff size (fewer files changed, then fewer total bytes).
 */
export async function rankPatches(
  patches: readonly PatchDescriptor[],
  options: PatchScorerOptions,
): Promise<ReadonlyArray<{ readonly index: number; readonly score: PatchScore }>> {
  const scored: Array<{ index: number; score: PatchScore }> = [];
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (!p) continue;
    const score = await scorePatch(p, options);
    scored.push({ index: i, score });
  }
  scored.sort((a, b) => {
    if (a.score.compositeScore !== b.score.compositeScore) {
      return b.score.compositeScore - a.score.compositeScore;
    }
    const patchA = patches[a.index];
    const patchB = patches[b.index];
    const aFiles = patchA?.files.length ?? 0;
    const bFiles = patchB?.files.length ?? 0;
    if (aFiles !== bFiles) return aFiles - bFiles;
    const aBytes = (patchA?.files ?? []).reduce((s, f) => s + f.newContent.length, 0);
    const bBytes = (patchB?.files ?? []).reduce((s, f) => s + f.newContent.length, 0);
    return aBytes - bBytes;
  });
  return scored;
}
