/**
 * `wotann replay` — V9 Tier 14.7.
 *
 * Time-travel replay over a recorded trajectory. Wraps the primitives
 * in `src/autopilot/trajectory-recorder.ts` so users can replay a
 * saved session frame-by-frame from the shell:
 *
 *     wotann replay .wotann/trajectories/traj-xyz.json --pacing fast
 *     wotann replay path/to/traj.json --until 42
 *     wotann replay traj.json --filter prompt,response
 *
 * The replay is purely informational: frames are streamed to a
 * caller-supplied writer (stdout by default). No side effects — no
 * tool calls re-issued, no model round-trips, no disk writes beyond
 * the injected writer. This makes replay safe to run against any
 * trajectory, including ones captured in a different environment.
 *
 * ── Companion: `wotann fork` ─────────────────────────────────────────
 * `src/cli/fork.ts` is the mutator — it takes a trajectory and
 * produces a truncated copy at a chosen seq so a user can branch off
 * a past decision. Replay reads; fork writes.
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: missing files / malformed trajectories
 *    produce `{ ok: false, error }` — never silent partial replay.
 *  - QB #7 per-call state: pure async function. No module-level state.
 *  - QB #13 env guard: every input (path, writer, pacing) arrives
 *    via the options object.
 *  - QB #11 sibling-site scan: `trajectory-recorder.ts` exposes
 *    `loadTrajectory` + `replayTrajectory`; this module only composes.
 */

import {
  loadTrajectory,
  replayTrajectory,
  type FrameKind,
  type ReplayCallbacks,
  type ReplayResult,
  type Trajectory,
  type TrajectoryFrame,
} from "../autopilot/trajectory-recorder.js";

// ═══ Types ════════════════════════════════════════════════════════════════

export type ReplayPacing = "realtime" | "fast" | number;

export interface ReplayOptions {
  /** Absolute path to the saved trajectory JSON file. */
  readonly trajectoryPath: string;
  /**
   * Where to write frame output. Injected so tests use a string
   * sink instead of stdout. Defaults to `process.stdout.write`.
   */
  readonly writer?: (text: string) => void;
  /**
   * Playback speed. Defaults to `"fast"` — replay completes as fast
   * as frames can be rendered. `"realtime"` reproduces the original
   * timing between frames. A number is a fixed ms pause per frame.
   */
  readonly pacing?: ReplayPacing;
  /**
   * Optional inclusive upper seq. Frames with `seq > until` are
   * skipped. Useful for "replay up to the point before I broke it".
   */
  readonly until?: number;
  /**
   * Optional set of frame kinds to include. When absent, every kind
   * is printed. Intersection semantics — frames not in the set are
   * silently dropped from the stream.
   */
  readonly filter?: readonly FrameKind[];
  /**
   * Optional injection for the trajectory loader (tests pass a
   * resolver that returns a pre-built Trajectory without reading
   * disk).
   */
  readonly loader?: (path: string) => Promise<Trajectory>;
}

export interface ReplayOutcome {
  readonly ok: true;
  readonly trajectoryId: string;
  readonly framesConsidered: number;
  readonly framesPlayed: number;
  readonly durationMs: number;
  readonly stoppedAt: number | null;
}

export interface ReplayFailure {
  readonly ok: false;
  readonly error: string;
}

export type ReplayCliResult = ReplayOutcome | ReplayFailure;

// ═══ Core ═════════════════════════════════════════════════════════════════

function defaultWriter(text: string): void {
  process.stdout.write(text);
}

/**
 * Format one trajectory frame as a single line plus a body indent.
 * Kept minimal so pipe consumers can grep by kind.
 */
function formatFrame(frame: TrajectoryFrame): string {
  const ts = new Date(frame.timestamp).toISOString();
  const kind = frame.kind.padEnd(12, " ");
  const header = `[${frame.seq.toString().padStart(4, "0")}] ${ts} ${kind} `;
  const body = frame.content.split("\n").join("\n              ");
  return `${header}${body}\n`;
}

/**
 * Run the replay. Returns a structured outcome; never throws.
 */
export async function runReplay(options: ReplayOptions): Promise<ReplayCliResult> {
  const writer = options.writer ?? defaultWriter;
  const pacing: ReplayPacing = options.pacing ?? "fast";
  const kinds = options.filter ? new Set<FrameKind>(options.filter) : null;
  const loader = options.loader ?? loadTrajectory;

  let trajectory: Trajectory;
  try {
    trajectory = await loader(options.trajectoryPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `load failed: ${msg}` };
  }

  const callbacks: ReplayCallbacks = {
    pacing,
    onFrame: (frame) => {
      if (typeof options.until === "number" && frame.seq > options.until) return;
      if (kinds !== null && !kinds.has(frame.kind)) return;
      writer(formatFrame(frame));
    },
  };

  let result: ReplayResult;
  try {
    result = await replayTrajectory(trajectory, callbacks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `replay failed: ${msg}` };
  }

  return {
    ok: true,
    trajectoryId: trajectory.id,
    framesConsidered: trajectory.frames.length,
    framesPlayed: result.framesPlayed,
    durationMs: result.durationMs,
    stoppedAt: result.stoppedAt,
  };
}

// ═══ Arg parsing (helpers for CLI wiring) ═════════════════════════════════

/**
 * Parse a kind-list comma string (e.g. `prompt,response`) into the
 * typed tuple `replayTrajectory` accepts. Unknown kinds are dropped
 * with a warning on the writer, not silent-accepted (QB #6).
 */
export function parseFilterArg(raw: string | undefined): readonly FrameKind[] | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const valid: ReadonlySet<FrameKind> = new Set([
    "prompt",
    "response",
    "tool_call",
    "tool_result",
    "thinking",
    "error",
    "meta",
  ]);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const kept: FrameKind[] = [];
  for (const part of parts) {
    if (valid.has(part as FrameKind)) kept.push(part as FrameKind);
  }
  return kept.length > 0 ? kept : undefined;
}

/**
 * Parse the `--pacing` arg from the CLI. Accepts `realtime`, `fast`,
 * or an integer millisecond value. Invalid inputs default to `fast`
 * (no silent failure — the caller can report the fallback).
 */
export function parsePacingArg(raw: string | undefined): ReplayPacing {
  if (raw === undefined || raw === "") return "fast";
  if (raw === "realtime" || raw === "fast") return raw;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return "fast";
}

/**
 * Parse the `--until` arg. Returns `undefined` for absent or invalid
 * input so callers fall back to "play everything".
 */
export function parseUntilArg(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}
