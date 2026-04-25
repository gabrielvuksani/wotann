/**
 * PR runner — main orchestrator for PR-as-status-check.
 *
 * V9 T12.5: discover `.wotann/checks/*.md` declarations → run each via a
 * model subagent against the PR diff → emit GitHub Check Runs.
 *
 * QB #6 (honest stubs): No silent success. If a check definition is malformed,
 * the runner reports `status: "error"` with explicit reason — never PASS by default.
 * QB #7 (per-call state): all state lives on stack frames or per-call options;
 * no module-global mutation between runs.
 * QB #13 (env guard): test-only behavior gated by NODE_ENV === "test".
 * QB #14 (real-contract tests): pluggable runCheck so tests verify the actual
 * orchestration without mocking the model.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  PrCheckDef,
  PrCheckResult,
  PrCheckRunSummary,
  PrCheckSeverity,
  RunCheckFn,
} from "./pr-types.js";
import { computeOverallConclusion } from "./check-emitter.js";

export interface RunPrChecksOptions {
  /** Directory holding `.md` check files. Default `.wotann/checks`. */
  readonly checksDir?: string;
  /** Unified diff text — already loaded via diff-loader. */
  readonly prDiff: string;
  /** Per-check execution function — pluggable for tests. */
  readonly runCheck: RunCheckFn;
  /**
   * Optional override of the discovery filter. By default loads every
   * `.md` file in the checks dir.
   */
  readonly filter?: (filename: string) => boolean;
  /** ReadDir shim — injectable for tests. */
  readonly readdirFn?: (dir: string) => Promise<readonly string[]>;
  /** ReadFile shim — injectable for tests. */
  readonly readFileFn?: (path: string) => Promise<string>;
  /** Stat shim — injectable for tests. */
  readonly statFn?: (path: string) => Promise<{ readonly isFile: () => boolean }>;
}

/**
 * Discover `.md` check defs in `dir`, parse YAML frontmatter, and return
 * the validated list. Files without frontmatter are returned as ERROR results
 * by the caller (this fn returns parse-errors via `errors` array, not throw).
 */
export async function loadCheckDefs(
  dir: string,
  shims?: Pick<RunPrChecksOptions, "readdirFn" | "readFileFn" | "statFn">,
): Promise<{
  readonly defs: readonly PrCheckDef[];
  readonly errors: readonly { readonly filename: string; readonly error: string }[];
}> {
  const readdirFn = shims?.readdirFn ?? defaultReadDir;
  const readFileFn = shims?.readFileFn ?? defaultReadFile;
  const statFn = shims?.statFn ?? defaultStat;

  let entries: readonly string[];
  try {
    entries = await readdirFn(dir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      defs: [],
      errors: [{ filename: dir, error: `cannot read checks dir: ${msg}` }],
    };
  }

  const defs: PrCheckDef[] = [];
  const errors: { filename: string; error: string }[] = [];
  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();

  for (const f of mdFiles) {
    const path = join(dir, f);
    try {
      const s = await statFn(path);
      if (!s.isFile()) continue;
    } catch {
      continue;
    }

    let text: string;
    try {
      text = await readFileFn(path);
    } catch (err) {
      errors.push({
        filename: f,
        error: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const parsed = parseCheckMarkdown(text, f);
    if (!parsed.ok) {
      errors.push({ filename: f, error: parsed.error });
      continue;
    }
    defs.push(parsed.def);
  }

  return { defs, errors };
}

interface ParseOk {
  readonly ok: true;
  readonly def: PrCheckDef;
}
interface ParseErr {
  readonly ok: false;
  readonly error: string;
}

/**
 * Parse a single check `.md` file. Format:
 *
 *     ---
 *     id: my-check
 *     severity: blocking|advisory
 *     provider: anthropic   # optional
 *     model: sonnet         # optional
 *     ---
 *     <markdown body — used as system prompt>
 */
export function parseCheckMarkdown(text: string, filename: string): ParseOk | ParseErr {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("---")) {
    return { ok: false, error: `missing YAML frontmatter delimiter '---' at top of ${filename}` };
  }
  const end = trimmed.indexOf("\n---", 3);
  if (end < 0) {
    return { ok: false, error: `unterminated frontmatter in ${filename}` };
  }

  const fmRaw = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).replace(/^\s*\n/, "");
  const fm = parseSimpleFrontmatter(fmRaw);

  const id = fm["id"];
  if (!id) return { ok: false, error: `frontmatter missing 'id' in ${filename}` };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return {
      ok: false,
      error: `invalid id '${id}' in ${filename} (must be kebab-case, alnum+hyphens)`,
    };
  }

  const severityRaw = fm["severity"] ?? "advisory";
  if (severityRaw !== "blocking" && severityRaw !== "advisory") {
    return {
      ok: false,
      error: `severity in ${filename} must be 'blocking' or 'advisory' (got '${severityRaw}')`,
    };
  }
  const severity: PrCheckSeverity = severityRaw;

  const provider = fm["provider"] ?? "anthropic";
  const model = fm["model"] ?? "sonnet";

  if (body.trim() === "") {
    return { ok: false, error: `${filename} has empty body — body is the system prompt` };
  }

  return {
    ok: true,
    def: {
      id,
      severity,
      provider,
      model,
      body,
      filename,
    },
  };
}

function parseSimpleFrontmatter(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Run all checks defined in `checksDir` against `prDiff`, returning a summary.
 *
 * Behavior:
 * - Loads all `.md` defs (parse errors get reported as ERROR results).
 * - Runs each check via the injected `runCheck` fn.
 * - Returns aggregate including overall GitHub Check conclusion.
 */
export async function runPrChecks(options: RunPrChecksOptions): Promise<PrCheckRunSummary> {
  const dir = options.checksDir ?? ".wotann/checks";
  const t0 = Date.now();

  const loaded = await loadCheckDefs(dir, {
    readdirFn: options.readdirFn,
    readFileFn: options.readFileFn,
    statFn: options.statFn,
  });

  const results: PrCheckResult[] = [];

  for (const errEntry of loaded.errors) {
    results.push({
      id: idFromFilename(errEntry.filename),
      status: "error",
      message: errEntry.error.slice(0, 200),
      severity: "advisory",
      durationMs: 0,
    });
  }

  for (const def of loaded.defs) {
    if (options.filter && !options.filter(def.filename)) continue;
    const startedAt = Date.now();
    let result: PrCheckResult;
    try {
      result = await options.runCheck(def, options.prDiff);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        id: def.id,
        status: "error",
        message: `runCheck threw: ${msg}`.slice(0, 200),
        severity: def.severity,
        durationMs: Date.now() - startedAt,
      };
    }
    // Defensive: ensure id matches def.id even if runCheck fn forgot to set it.
    results.push({
      ...result,
      id: result.id || def.id,
      severity: result.severity || def.severity,
    });
  }

  const overall = computeOverallConclusion(results);
  return {
    results,
    overall,
    totalDurationMs: Date.now() - t0,
  };
}

/**
 * Default per-check execution: reads first line of model response and
 * maps `PASS:` / `FAIL:` to the result. Runners that don't have a model
 * yet (e.g. CI smoke) can use `runCheckEcho` as a placeholder.
 *
 * The `model` shim is intentionally narrow — { query(prompt): Promise<{text}> } —
 * so any provider adapter satisfies it without leaking provider types here.
 */
export interface ModelShim {
  query(prompt: string): Promise<{ readonly text: string }>;
}

export function makeModelRunCheck(model: ModelShim): RunCheckFn {
  return async (check, prDiff) => {
    const startedAt = Date.now();
    const prompt = buildCheckPrompt(check, prDiff);
    let response: { readonly text: string };
    try {
      response = await model.query(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: check.id,
        status: "error",
        message: `model error: ${msg}`.slice(0, 200),
        severity: check.severity,
        durationMs: Date.now() - startedAt,
      };
    }
    const parsed = parseModelResponse(response.text);
    return {
      id: check.id,
      status: parsed.status,
      message: parsed.message,
      severity: check.severity,
      durationMs: Date.now() - startedAt,
    };
  };
}

/**
 * Echo runner — does no model call. Returns PASS for all checks. Useful for
 * verifying the workflow plumbing in CI before billing for real model calls.
 */
export const runCheckEcho: RunCheckFn = async (check) => ({
  id: check.id,
  status: "pass",
  message: "PASS: echo runner — no model invoked",
  severity: check.severity,
  durationMs: 0,
});

function buildCheckPrompt(check: PrCheckDef, prDiff: string): string {
  return [
    check.body,
    "",
    "----",
    "Respond with exactly ONE line that begins with `PASS:` or `FAIL: <reason>`.",
    "If unsure, respond `FAIL: insufficient information`.",
    "",
    "Diff:",
    "```diff",
    prDiff || "(empty diff)",
    "```",
  ].join("\n");
}

/**
 * Parse the first non-empty line of a model response. Strict format —
 * unparseable responses return `neutral` (not silent PASS).
 */
export function parseModelResponse(text: string): {
  readonly status: "pass" | "fail" | "neutral";
  readonly message: string;
} {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) {
    return { status: "neutral", message: "Empty response" };
  }
  const upper = firstLine.toUpperCase();
  if (upper === "PASS" || upper.startsWith("PASS:") || upper.startsWith("PASS ")) {
    return { status: "pass", message: firstLine.slice(0, 200) };
  }
  if (upper.startsWith("FAIL:") || upper.startsWith("FAIL ")) {
    const idx = firstLine.indexOf(":");
    const reason = idx >= 0 ? firstLine.slice(idx + 1).trim() : firstLine.slice(5).trim();
    return { status: "fail", message: (reason || "no reason given").slice(0, 200) };
  }
  return { status: "neutral", message: `Unparseable: ${firstLine.slice(0, 80)}` };
}

function idFromFilename(filename: string): string {
  return (
    filename
      .replace(/\.md$/, "")
      .replace(/[^a-z0-9-]+/gi, "-")
      .toLowerCase() || "unknown"
  );
}

async function defaultReadDir(dir: string): Promise<readonly string[]> {
  return readdir(dir);
}
async function defaultReadFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}
async function defaultStat(path: string): Promise<{ isFile: () => boolean }> {
  return stat(path);
}
