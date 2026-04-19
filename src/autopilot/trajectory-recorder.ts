/**
 * Agent trajectory recording + replay — debugging primitive.
 *
 * Agent runs produce a stream of prompts, responses, tool calls, tool
 * results, and side effects. When a run produces the wrong outcome,
 * debugging requires reconstructing the exact sequence. Without
 * recording, that means hoping logs captured enough.
 *
 * This module ships:
 *   - TrajectoryRecorder: append-only frame log
 *   - saveTrajectory(path, trajectory): JSON serialization
 *   - loadTrajectory(path): load + validate
 *   - replayTrajectory(trajectory, callbacks): step through frames
 *   - diffTrajectories(a, b): find first divergence point
 *
 * Frames are stored with monotonic timestamps so replay can simulate
 * real-time pacing or run as fast as possible.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// ── Types ──────────────────────────────────────────────

export type FrameKind =
  | "prompt"
  | "response"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "error"
  | "meta";

export interface TrajectoryFrame {
  readonly seq: number; // monotonic counter within trajectory
  readonly timestamp: number; // ms since epoch
  readonly kind: FrameKind;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface Trajectory {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly frames: readonly TrajectoryFrame[];
  readonly metadata?: Record<string, unknown>;
}

// ── Recorder ───────────────────────────────────────────

export class TrajectoryRecorder {
  private frames: TrajectoryFrame[] = [];
  private readonly id: string;
  private readonly startedAt: number;
  private seqCounter = 0;
  private endedAt: number | null = null;

  constructor(id?: string) {
    this.id = id ?? `traj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = Date.now();
  }

  record(kind: FrameKind, content: string, metadata?: Record<string, unknown>): TrajectoryFrame {
    if (this.endedAt !== null) {
      throw new Error("TrajectoryRecorder: cannot record after end()");
    }
    const frame: TrajectoryFrame = {
      seq: this.seqCounter++,
      timestamp: Date.now(),
      kind,
      content,
      ...(metadata !== undefined ? { metadata } : {}),
    };
    this.frames.push(frame);
    return frame;
  }

  end(): Trajectory {
    if (this.endedAt === null) this.endedAt = Date.now();
    return this.snapshot();
  }

  snapshot(metadata?: Record<string, unknown>): Trajectory {
    const base: Trajectory = {
      id: this.id,
      startedAt: this.startedAt,
      frames: [...this.frames],
    };
    return {
      ...base,
      ...(this.endedAt !== null ? { endedAt: this.endedAt } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
  }

  frameCount(): number {
    return this.frames.length;
  }
}

// ── Persistence ────────────────────────────────────────

export async function saveTrajectory(path: string, trajectory: Trajectory): Promise<void> {
  const abs = resolve(path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(trajectory, null, 2), "utf-8");
}

export async function loadTrajectory(path: string): Promise<Trajectory> {
  const raw = await readFile(resolve(path), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`loadTrajectory: not an object at ${path}`);
  }
  const t = parsed as Trajectory;
  if (typeof t.id !== "string" || !Array.isArray(t.frames)) {
    throw new Error(`loadTrajectory: invalid shape at ${path}`);
  }
  return t;
}

// ── Replay ─────────────────────────────────────────────

export interface ReplayCallbacks {
  readonly onFrame?: (frame: TrajectoryFrame, index: number) => void | Promise<void>;
  readonly shouldPause?: (frame: TrajectoryFrame) => boolean;
  /**
   * If "realtime", pause between frames to match recorded timing.
   * If "fast", no pauses.
   * If a number, use that fixed pause between frames.
   */
  readonly pacing?: "realtime" | "fast" | number;
}

export interface ReplayResult {
  readonly framesPlayed: number;
  readonly stoppedAt: number | null; // frame index where paused, or null if completed
  readonly durationMs: number;
}

export async function replayTrajectory(
  trajectory: Trajectory,
  callbacks: ReplayCallbacks = {},
): Promise<ReplayResult> {
  const startedAt = Date.now();
  const pacing = callbacks.pacing ?? "fast";

  let prevTimestamp: number | null = null;
  let played = 0;

  for (let i = 0; i < trajectory.frames.length; i++) {
    const frame = trajectory.frames[i]!;

    if (pacing === "realtime" && prevTimestamp !== null) {
      const delta = frame.timestamp - prevTimestamp;
      if (delta > 0) await sleep(delta);
    } else if (typeof pacing === "number" && pacing > 0 && i > 0) {
      await sleep(pacing);
    }

    if (callbacks.onFrame) {
      await callbacks.onFrame(frame, i);
    }
    played++;

    if (callbacks.shouldPause?.(frame)) {
      return {
        framesPlayed: played,
        stoppedAt: i,
        durationMs: Date.now() - startedAt,
      };
    }

    prevTimestamp = frame.timestamp;
  }

  return {
    framesPlayed: played,
    stoppedAt: null,
    durationMs: Date.now() - startedAt,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Diff ───────────────────────────────────────────────

export interface TrajectoryDivergence {
  /** First frame index where the two trajectories differ. Null if identical. */
  readonly firstDivergentIndex: number | null;
  /** Frame from trajectory A at the divergence point. */
  readonly aFrame: TrajectoryFrame | null;
  readonly bFrame: TrajectoryFrame | null;
  readonly reason: string;
}

/**
 * Compare two trajectories frame-by-frame. Useful for regression
 * debugging: "this is what happened; what's happening now differs HERE".
 */
export function diffTrajectories(a: Trajectory, b: Trajectory): TrajectoryDivergence {
  const minLen = Math.min(a.frames.length, b.frames.length);
  for (let i = 0; i < minLen; i++) {
    const fa = a.frames[i]!;
    const fb = b.frames[i]!;
    if (fa.kind !== fb.kind || fa.content !== fb.content) {
      return {
        firstDivergentIndex: i,
        aFrame: fa,
        bFrame: fb,
        reason: `frames differ at index ${i}: ${fa.kind}="${fa.content.slice(0, 50)}" vs ${fb.kind}="${fb.content.slice(0, 50)}"`,
      };
    }
  }
  if (a.frames.length !== b.frames.length) {
    const longer = a.frames.length > b.frames.length ? "A" : "B";
    return {
      firstDivergentIndex: minLen,
      aFrame: a.frames[minLen] ?? null,
      bFrame: b.frames[minLen] ?? null,
      reason: `${longer} has ${Math.abs(a.frames.length - b.frames.length)} extra frames`,
    };
  }
  return {
    firstDivergentIndex: null,
    aFrame: null,
    bFrame: null,
    reason: "identical",
  };
}

// ── Summary ────────────────────────────────────────────

export interface TrajectorySummary {
  readonly id: string;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly byKind: Readonly<Record<FrameKind, number>>;
  readonly toolCallCount: number;
  readonly errorCount: number;
}

export function summarize(trajectory: Trajectory): TrajectorySummary {
  const byKind: Record<FrameKind, number> = {
    prompt: 0,
    response: 0,
    tool_call: 0,
    tool_result: 0,
    thinking: 0,
    error: 0,
    meta: 0,
  };
  for (const f of trajectory.frames) byKind[f.kind]++;

  const endedAt =
    trajectory.endedAt ??
    trajectory.frames[trajectory.frames.length - 1]?.timestamp ??
    trajectory.startedAt;
  return {
    id: trajectory.id,
    frameCount: trajectory.frames.length,
    durationMs: endedAt - trajectory.startedAt,
    byKind,
    toolCallCount: byKind.tool_call,
    errorCount: byKind.error,
  };
}
