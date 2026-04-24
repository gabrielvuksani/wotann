/**
 * `wotann fork` — V9 Tier 14.7.
 *
 * Fork a recorded trajectory at a chosen seq boundary. Produces a
 * NEW trajectory file containing frames [0..atSeq] so users can
 * branch off a past decision without losing the original. The
 * original file is never modified — fork writes only the output.
 *
 *     wotann fork traj.json --at 42 --out ./fork-42.json
 *     wotann fork traj.json --at-kind response --out ./before-last.json
 *
 * ── Companion: `wotann replay` ───────────────────────────────────────
 * `src/cli/replay.ts` is the read-only replayer. Fork is the mutator
 * that produces new trajectory files for replay + divergence analysis.
 *
 * ── Determinism ──────────────────────────────────────────────────────
 * The forked trajectory's `id` is derived from the source `id` plus
 * the split seq so callers get a deterministic new id (replay of
 * the same fork twice produces byte-identical output when the clock
 * is injected). The `startedAt` copies the source; `endedAt` is
 * recomputed to the last kept frame's timestamp.
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: every branch returns `{ok, ...}` or
 *    `{ok: false, error}`. Never throws on normal invalid input.
 *  - QB #7 per-call state: pure async function.
 *  - QB #13 env guard: path + seq are explicit arguments.
 */

import {
  loadTrajectory,
  saveTrajectory,
  type FrameKind,
  type Trajectory,
  type TrajectoryFrame,
} from "../autopilot/trajectory-recorder.js";

// ═══ Types ════════════════════════════════════════════════════════════════

export interface ForkOptions {
  readonly trajectoryPath: string;
  readonly outputPath: string;
  /**
   * Fork at this seq, inclusive (frames with seq <= at survive).
   * Mutually exclusive with `atKind`; if both set, `at` wins.
   */
  readonly at?: number;
  /**
   * Fork at the LAST frame of the given kind. Useful to split off
   * "the trajectory up through the most recent response". Mutually
   * exclusive with `at`.
   */
  readonly atKind?: FrameKind;
  /**
   * Optional metadata to merge into the forked trajectory — callers
   * typically stamp a `forkedFrom` / `reason` field for auditability.
   */
  readonly extraMetadata?: Readonly<Record<string, unknown>>;
  /**
   * Optional injection for the loader/saver so tests skip disk.
   */
  readonly loader?: (path: string) => Promise<Trajectory>;
  readonly saver?: (path: string, trajectory: Trajectory) => Promise<void>;
}

export interface ForkOutcome {
  readonly ok: true;
  readonly forkedTrajectoryId: string;
  readonly sourceTrajectoryId: string;
  readonly keptFrameCount: number;
  readonly splitSeq: number;
  readonly outputPath: string;
}

export interface ForkFailure {
  readonly ok: false;
  readonly error: string;
}

export type ForkResult = ForkOutcome | ForkFailure;

// ═══ Pure split logic ════════════════════════════════════════════════════

/**
 * Resolve the effective split seq given the input options + a
 * concrete trajectory. Returns the seq to keep inclusive of, OR null
 * when the options don't resolve (e.g. `atKind` with no matching frame).
 */
export function resolveSplitSeq(
  trajectory: Trajectory,
  options: Pick<ForkOptions, "at" | "atKind">,
): number | null {
  if (typeof options.at === "number") {
    return Math.floor(options.at);
  }
  if (options.atKind) {
    let last: number | null = null;
    for (const frame of trajectory.frames) {
      if (frame.kind === options.atKind) last = frame.seq;
    }
    return last;
  }
  // No split — fork the whole thing.
  return trajectory.frames.length > 0
    ? (trajectory.frames[trajectory.frames.length - 1]?.seq ?? 0)
    : 0;
}

/**
 * Truncate a trajectory at `atSeq`, returning a NEW immutable copy.
 * Never mutates the input.
 */
export function truncateTrajectory(
  source: Trajectory,
  atSeq: number,
  extraMetadata?: Readonly<Record<string, unknown>>,
): Trajectory {
  const keptFrames: TrajectoryFrame[] = [];
  for (const frame of source.frames) {
    if (frame.seq <= atSeq) keptFrames.push(frame);
  }
  const forkId = `${source.id}@fork-${atSeq}`;
  const lastKept = keptFrames[keptFrames.length - 1];
  const mergedMetadata: Record<string, unknown> = {
    ...(source.metadata ?? {}),
    ...(extraMetadata ?? {}),
    forkedFrom: source.id,
    splitSeq: atSeq,
  };
  const result: Trajectory = {
    id: forkId,
    startedAt: source.startedAt,
    frames: keptFrames,
    ...(lastKept ? { endedAt: lastKept.timestamp } : {}),
    metadata: mergedMetadata,
  };
  return result;
}

// ═══ Public API ══════════════════════════════════════════════════════════

export async function runFork(options: ForkOptions): Promise<ForkResult> {
  if (typeof options.at === "number" && options.atKind) {
    return {
      ok: false,
      error: "fork: pass either --at or --at-kind, not both",
    };
  }
  if (!options.outputPath || options.outputPath.length === 0) {
    return { ok: false, error: "fork: outputPath is required" };
  }

  const loader = options.loader ?? loadTrajectory;
  const saver = options.saver ?? saveTrajectory;

  let source: Trajectory;
  try {
    source = await loader(options.trajectoryPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `load failed: ${msg}` };
  }

  const splitSeq = resolveSplitSeq(source, options);
  if (splitSeq === null) {
    return {
      ok: false,
      error: options.atKind
        ? `no frame of kind "${options.atKind}" found in trajectory ${source.id}`
        : `could not resolve split seq for trajectory ${source.id}`,
    };
  }

  const forked = truncateTrajectory(source, splitSeq, options.extraMetadata);

  try {
    await saver(options.outputPath, forked);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `save failed: ${msg}` };
  }

  return {
    ok: true,
    forkedTrajectoryId: forked.id,
    sourceTrajectoryId: source.id,
    keptFrameCount: forked.frames.length,
    splitSeq,
    outputPath: options.outputPath,
  };
}
