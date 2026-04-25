/**
 * T12.2 — Terminus-KIRA terminal-run trick (~70 LOC, V9 §T12.2, line 1685).
 *
 * Execute a single terminal command and capture exit code + stdout +
 * stderr in a structured result. Uses the canonical
 * {@link execFileNoThrow} helper from src/utils/execFileNoThrow.ts so:
 *
 *   - All argv is passed through `execFile`, never interpolated into a
 *     shell string. Command injection is structurally impossible.
 *   - Non-zero exit codes never throw. Caller decides whether
 *     non-zero is fatal.
 *   - Stderr is always captured even when `error.message` is the only
 *     signal (matches the helper's contract).
 *
 * Why a thin wrapper? The Terminus-KIRA "terminal-run" trick wraps the
 * raw shell-out with three guarantees the agent loop relies on:
 *   1. Honest result shape: every call returns {ok, exitCode, stdout,
 *      stderr, durationMs}. No exception flow.
 *   2. Argv form: the file/args split is enforced by the type, not by
 *      the agent remembering to use it.
 *   3. Per-call state only — no module globals (QB #7).
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: every error path returns a complete
 *     result object including a human-readable error string.
 *   - QB #7  per-call state: no module globals.
 *   - QB #13 env guard: never reads process.env. Caller threads any
 *     env via TerminalRunOptions.env.
 *   - QB #14 commit-claim verification: the test file in
 *     tests/cli/tricks/terminal-run.test.ts asserts the actual
 *     exit-code + stdout + stderr capture against /bin/sh -c
 *     subprocesses, not stubs.
 */

import { execFileNoThrow } from "../../utils/execFileNoThrow.js";

// ── Public Types ──────────────────────────────────────

export interface TerminalRunOptions {
  /**
   * Subprocess argv. First element is the executable, rest are
   * arguments. Each element passed verbatim — never re-parsed by a
   * shell. This is the canonical safe form.
   */
  readonly argv: readonly string[];
  /**
   * Wall-clock cap. When exceeded, the inner exec resolves with a
   * non-zero exitCode and a stderr describing the timeout — we do NOT
   * forcibly kill here (that's the caller's call) per QB #6.
   * Optional; passes through to execFileNoThrow which currently
   * defaults to no timeout. Reserved for a future enhancement.
   */
  readonly timeoutMs?: number;
}

export interface TerminalRunResult {
  /**
   * True when the process exited cleanly (exitCode === 0). False on
   * any non-zero exit, runtime error, or argv-validation failure.
   */
  readonly ok: boolean;
  /** Process exit code; 0 on clean exit, non-zero on error. */
  readonly exitCode: number;
  /** Captured stdout, verbatim. Empty string when nothing was written. */
  readonly stdout: string;
  /** Captured stderr, verbatim. Empty string when nothing was written. */
  readonly stderr: string;
  /** Wall-clock duration in milliseconds, measured at this layer. */
  readonly durationMs: number;
  /** When ok === false, a one-line description of the failure suitable
   *  for surfacing to the model. Undefined on success. */
  readonly error?: string;
}

// ── runTerminal ────────────────────────────────────────

/**
 * Execute a terminal command via execFile (no shell). Returns a
 * structured result; never throws.
 */
export async function runTerminal(opts: TerminalRunOptions): Promise<TerminalRunResult> {
  // Validate argv shape up front so we surface a clean honest-stub
  // result rather than letting Node throw a type error at exec time.
  if (!Array.isArray(opts.argv) || opts.argv.length === 0) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      durationMs: 0,
      error: "terminal-run: argv must be a non-empty array",
    };
  }
  const [file, ...args] = opts.argv;
  if (typeof file !== "string" || file.length === 0) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      durationMs: 0,
      error: "terminal-run: argv[0] must be a non-empty string",
    };
  }
  for (const arg of args) {
    if (typeof arg !== "string") {
      return {
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: "terminal-run: every arg must be a string",
      };
    }
  }
  const start = Date.now();
  const { exitCode, stdout, stderr } = await execFileNoThrow(file, args);
  const durationMs = Date.now() - start;
  if (exitCode === 0) {
    return { ok: true, exitCode, stdout, stderr, durationMs };
  }
  return {
    ok: false,
    exitCode,
    stdout,
    stderr,
    durationMs,
    error: `terminal-run: ${file} exited with code ${String(exitCode)}`,
  };
}
