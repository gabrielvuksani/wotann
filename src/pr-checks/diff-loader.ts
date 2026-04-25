/**
 * Diff loader — produces a unified-diff string for a PR.
 *
 * Three modes:
 *   - `gh-cli`: shells out to `gh pr diff <num>` via execFileNoThrow (argv-pass)
 *   - `inline`: caller already has the diff text and just wants validation
 *   - `file`:   caller has the diff in a file on disk
 *
 * QB #6 (honest stubs): no silent success — every failure path returns
 * a Result with a precise reason, never throws ambiguous noise.
 *
 * SECURITY: gh shell-out uses execFileNoThrow (no shell, argv only) so a
 * caller-supplied repo string can't inject shell metacharacters.
 */

import { readFile } from "node:fs/promises";
import { execFileNoThrow } from "../utils/execFileNoThrow.js";

/**
 * Loader result — discriminated union, never throws on bad input.
 */
export type LoadResult =
  | { readonly ok: true; readonly diff: string; readonly source: DiffSource }
  | { readonly ok: false; readonly error: string };

export type DiffSource = "gh-cli" | "inline" | "file";

/**
 * Argv-style runner injected for tests; production uses execFileNoThrow.
 */
export interface ExecRunner {
  (
    file: string,
    args: readonly string[],
  ): Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }>;
}

export interface LoadDiffOptions {
  /** PR number (required for gh-cli mode). */
  readonly prNumber?: number;
  /** Inline diff text (required for inline mode). */
  readonly inlineDiff?: string;
  /** File path on disk (required for file mode). */
  readonly filePath?: string;
  /** Mode selector — auto-detected if omitted. */
  readonly mode?: DiffSource;
  /** Repository slug `<owner>/<repo>` for gh-cli (optional). */
  readonly repo?: string;
  /** Path to gh executable (default: `gh`). Injectable for tests. */
  readonly ghBinary?: string;
  /** ExecRunner shim — injectable for tests. */
  readonly execFn?: ExecRunner;
  /** ReadFile shim — injectable for tests. */
  readonly readFileFn?: (path: string) => Promise<string>;
  /** Max diff size accepted (default 1 MiB). */
  readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1 << 20; // 1 MiB

/**
 * Load a PR diff. Returns Result, never throws.
 *
 * Validates that the returned text actually looks like a unified diff
 * (starts with `diff --git ` or `--- ` or `Index:`). An empty PR returns
 * `{ok: true, diff: ""}` — checks should treat empty diff as PASS by default.
 */
export async function loadPrDiff(opts: LoadDiffOptions): Promise<LoadResult> {
  const mode = opts.mode ?? detectMode(opts);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  switch (mode) {
    case "inline": {
      const diff = opts.inlineDiff ?? "";
      const validation = validateDiffShape(diff);
      if (!validation.ok) return { ok: false, error: validation.error };
      if (Buffer.byteLength(diff, "utf8") > maxBytes) {
        return { ok: false, error: `diff exceeds maxBytes (${maxBytes})` };
      }
      return { ok: true, diff, source: "inline" };
    }

    case "file": {
      if (!opts.filePath) {
        return { ok: false, error: "filePath is required for file mode" };
      }
      const reader = opts.readFileFn ?? defaultReadFile;
      try {
        const diff = await reader(opts.filePath);
        const validation = validateDiffShape(diff);
        if (!validation.ok) return { ok: false, error: validation.error };
        if (Buffer.byteLength(diff, "utf8") > maxBytes) {
          return { ok: false, error: `diff exceeds maxBytes (${maxBytes})` };
        }
        return { ok: true, diff, source: "file" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `failed to read ${opts.filePath}: ${msg}` };
      }
    }

    case "gh-cli": {
      if (typeof opts.prNumber !== "number" || !Number.isFinite(opts.prNumber)) {
        return { ok: false, error: "prNumber is required for gh-cli mode" };
      }
      return loadViaGhCli(opts);
    }

    default:
      return { ok: false, error: `unknown mode: ${String(mode)}` };
  }
}

function detectMode(opts: LoadDiffOptions): DiffSource {
  if (opts.inlineDiff !== undefined) return "inline";
  if (opts.filePath) return "file";
  return "gh-cli";
}

async function defaultReadFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function loadViaGhCli(opts: LoadDiffOptions): Promise<LoadResult> {
  const bin = opts.ghBinary ?? "gh";
  const runner = opts.execFn ?? execFileNoThrow;
  const args = ["pr", "diff", String(opts.prNumber)];
  if (opts.repo) args.push("--repo", opts.repo);

  const r = await runner(bin, args);
  if (r.exitCode !== 0) {
    return {
      ok: false,
      error: `gh exited ${r.exitCode}: ${r.stderr.trim() || "no stderr"}`,
    };
  }
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (Buffer.byteLength(r.stdout, "utf8") > maxBytes) {
    return { ok: false, error: `diff exceeds maxBytes (${maxBytes})` };
  }
  const validation = validateDiffShape(r.stdout);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  return { ok: true, diff: r.stdout, source: "gh-cli" };
}

/**
 * Quick validation that the input LOOKS like a unified diff. We allow
 * empty (an empty PR) but reject random text that would just confuse the
 * downstream model. Header markers cover both git-format and svn/cvs styles.
 */
function validateDiffShape(diff: string): { ok: true } | { ok: false; error: string } {
  if (diff === "") return { ok: true };
  const trimmed = diff.trimStart();
  const hasHeader =
    trimmed.startsWith("diff --git ") ||
    trimmed.startsWith("--- ") ||
    trimmed.startsWith("Index: ") ||
    trimmed.startsWith("@@ ");
  if (!hasHeader) {
    return {
      ok: false,
      error: `input does not look like a unified diff (first 64 chars: ${trimmed.slice(0, 64)})`,
    };
  }
  return { ok: true };
}
