/**
 * T12.2 — Terminus-KIRA tmux-pull trick (~70 LOC, V9 §T12.2, line 1685).
 *
 * Pull recent tmux pane content via `tmux capture-pane -pJ -S -<lines>`.
 * Used by the agent loop to inspect background sessions started by an
 * earlier `tmux new-session` invocation — e.g., a long-running build
 * or test daemon kept alive across turns.
 *
 * Honest-failure posture: when tmux is not installed, no server is
 * running, or the named session does not exist, we surface a clean
 * `{ok:false, reason}` result — never silent success (QB #6). The V9
 * integration matrix calls this out explicitly: "tmux_pull no session
 * → {ok: false, reason: 'no tmux server'} honest stub."
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: every failure path returns ok:false with
 *     a reason string. Stdout/stderr from tmux are preserved when
 *     present so the model can debug.
 *   - QB #7  per-call state: zero module globals.
 *   - QB #13 env guard: never reads process.env. Caller threads
 *     tmux binary path via {@link TmuxPullOptions.tmuxBin} if a
 *     non-default location is needed.
 *   - QB #14 commit-claim verification: the test file in
 *     tests/cli/tricks/tmux-pull.test.ts asserts the actual argv
 *     passed to execFileNoThrow + the result-shape mapping by
 *     stubbing the runner.
 */

import { execFileNoThrow } from "../../utils/execFileNoThrow.js";

// ── Public Types ──────────────────────────────────────

/** Allow tests + callers that want a different tmux binary or to
 *  intercept the runner to inject substitutes. */
export type TmuxRunner = (
  file: string,
  args: readonly string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface TmuxPullOptions {
  /** Target session name (`tmux capture-pane -t <name>`). Required —
   *  callers must know which session to pull. */
  readonly session: string;
  /** Number of lines from the bottom of the scrollback to capture.
   *  Default 200. Capped at 100_000 to avoid runaway memory. */
  readonly lines?: number;
  /** Optional override for the tmux binary path. Defaults to "tmux"
   *  resolved via $PATH in the child process. */
  readonly tmuxBin?: string;
  /**
   * Optional pane id (e.g., "0.0", "myssn:0.1"). When omitted, tmux
   * defaults to the active pane of the session.
   */
  readonly pane?: string;
  /**
   * Optional injection point for tests. Defaults to execFileNoThrow.
   */
  readonly runner?: TmuxRunner;
}

export type TmuxPullResult =
  | {
      readonly ok: true;
      readonly content: string;
      readonly lines: number;
      readonly session: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly exitCode?: number;
      readonly stderr?: string;
    };

// ── tmuxPull ──────────────────────────────────────────

const MAX_LINES = 100_000;

export async function tmuxPull(opts: TmuxPullOptions): Promise<TmuxPullResult> {
  if (typeof opts.session !== "string" || opts.session.length === 0) {
    return { ok: false, reason: "tmux-pull: session must be a non-empty string" };
  }
  const requestedLines = opts.lines ?? 200;
  if (!Number.isFinite(requestedLines) || requestedLines < 1) {
    return { ok: false, reason: "tmux-pull: lines must be >= 1" };
  }
  const cappedLines = Math.min(MAX_LINES, Math.floor(requestedLines));
  const tmuxBin = opts.tmuxBin ?? "tmux";
  const target = opts.pane ? `${opts.session}:${opts.pane}` : opts.session;
  // -p: print to stdout. -J: join wrapped lines. -S -<N>: start N lines back.
  const args: readonly string[] = [
    "capture-pane",
    "-p",
    "-J",
    "-S",
    `-${cappedLines}`,
    "-t",
    target,
  ];

  const runner: TmuxRunner = opts.runner ?? execFileNoThrow;
  const { exitCode, stdout, stderr } = await runner(tmuxBin, args);

  if (exitCode === 0) {
    return {
      ok: true,
      content: stdout,
      lines: cappedLines,
      session: opts.session,
    };
  }

  // Common tmux failure modes deserve named reasons so the agent can
  // route ("install tmux" vs. "start a session" vs. "wrong name").
  const haystack = stderr.toLowerCase();
  let reason = `tmux-pull: tmux exited ${String(exitCode)}`;
  if (haystack.includes("no server running") || haystack.includes("no tmux server")) {
    reason = "tmux-pull: no tmux server running";
  } else if (haystack.includes("can't find session") || haystack.includes("session not found")) {
    reason = `tmux-pull: session "${opts.session}" not found`;
  } else if (haystack.includes("enoent") || haystack.includes("not found")) {
    reason = "tmux-pull: tmux binary not found in PATH";
  }
  return { ok: false, reason, exitCode, stderr };
}
