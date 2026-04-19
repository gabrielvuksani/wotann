import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TrajectoryRecorder,
  saveTrajectory,
  loadTrajectory,
  replayTrajectory,
  diffTrajectories,
  summarize,
} from "../../src/autopilot/trajectory-recorder.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("TrajectoryRecorder", () => {
  it("records frames with monotonic seq", () => {
    const rec = new TrajectoryRecorder("r1");
    rec.record("prompt", "hello");
    rec.record("response", "hi");
    rec.record("tool_call", "bash: ls");
    const traj = rec.snapshot();
    expect(traj.frames).toHaveLength(3);
    expect(traj.frames[0]?.seq).toBe(0);
    expect(traj.frames[2]?.seq).toBe(2);
  });

  it("throws when recording after end", () => {
    const rec = new TrajectoryRecorder();
    rec.record("prompt", "x");
    rec.end();
    expect(() => rec.record("response", "y")).toThrow(/cannot record after end/);
  });

  it("end() sets endedAt", () => {
    const rec = new TrajectoryRecorder();
    rec.record("prompt", "x");
    const traj = rec.end();
    expect(traj.endedAt).toBeDefined();
    expect(traj.endedAt!).toBeGreaterThanOrEqual(traj.startedAt);
  });

  it("frameCount is accurate", () => {
    const rec = new TrajectoryRecorder();
    rec.record("prompt", "a");
    rec.record("prompt", "b");
    expect(rec.frameCount()).toBe(2);
  });

  it("metadata is preserved", () => {
    const rec = new TrajectoryRecorder();
    rec.record("tool_call", "x", { tool: "bash", retries: 0 });
    const traj = rec.snapshot();
    expect(traj.frames[0]?.metadata?.["tool"]).toBe("bash");
  });
});

describe("save/loadTrajectory", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wotann-traj-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("round-trips a trajectory", async () => {
    const rec = new TrajectoryRecorder("rt");
    rec.record("prompt", "q");
    rec.record("response", "a");
    const traj = rec.end();
    const path = join(tempDir, "t.json");
    await saveTrajectory(path, traj);
    const loaded = await loadTrajectory(path);
    expect(loaded).toEqual(traj);
  });

  it("throws on invalid shape", async () => {
    const path = join(tempDir, "bad.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, '{"not a trajectory": true}');
    await expect(loadTrajectory(path)).rejects.toThrow(/invalid shape/);
  });
});

describe("replayTrajectory", () => {
  it("calls onFrame for each frame", async () => {
    const rec = new TrajectoryRecorder();
    rec.record("prompt", "1");
    rec.record("prompt", "2");
    rec.record("prompt", "3");
    const traj = rec.end();

    const calls: number[] = [];
    const result = await replayTrajectory(traj, {
      onFrame: (_f, i) => {
        calls.push(i);
      },
    });
    expect(calls).toEqual([0, 1, 2]);
    expect(result.framesPlayed).toBe(3);
    expect(result.stoppedAt).toBeNull();
  });

  it("stops when shouldPause returns true", async () => {
    const rec = new TrajectoryRecorder();
    rec.record("prompt", "a");
    rec.record("tool_call", "x");
    rec.record("prompt", "b");
    const traj = rec.end();

    const result = await replayTrajectory(traj, {
      shouldPause: (f) => f.kind === "tool_call",
    });
    expect(result.framesPlayed).toBe(2);
    expect(result.stoppedAt).toBe(1);
  });

  it("fixed pacing adds delay between frames", async () => {
    const rec = new TrajectoryRecorder();
    rec.record("prompt", "a");
    rec.record("prompt", "b");
    const traj = rec.end();
    const start = Date.now();
    await replayTrajectory(traj, { pacing: 20 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(15); // allow some slack
  });
});

describe("diffTrajectories", () => {
  function makeTraj(frames: Array<{ kind: "prompt" | "response"; content: string }>) {
    const rec = new TrajectoryRecorder("id");
    for (const f of frames) rec.record(f.kind, f.content);
    return rec.end();
  }

  it("returns null for identical trajectories", () => {
    const a = makeTraj([{ kind: "prompt", content: "x" }]);
    const b = makeTraj([{ kind: "prompt", content: "x" }]);
    const diff = diffTrajectories(a, b);
    expect(diff.firstDivergentIndex).toBeNull();
  });

  it("finds first divergent frame", () => {
    const a = makeTraj([
      { kind: "prompt", content: "x" },
      { kind: "response", content: "y" },
    ]);
    const b = makeTraj([
      { kind: "prompt", content: "x" },
      { kind: "response", content: "different" },
    ]);
    const diff = diffTrajectories(a, b);
    expect(diff.firstDivergentIndex).toBe(1);
  });

  it("reports length mismatch when same prefix", () => {
    const a = makeTraj([
      { kind: "prompt", content: "x" },
      { kind: "response", content: "y" },
    ]);
    const b = makeTraj([{ kind: "prompt", content: "x" }]);
    const diff = diffTrajectories(a, b);
    expect(diff.firstDivergentIndex).toBe(1);
    expect(diff.reason).toContain("extra frames");
  });
});

describe("summarize", () => {
  it("counts frames by kind", () => {
    const rec = new TrajectoryRecorder();
    rec.record("prompt", "x");
    rec.record("response", "y");
    rec.record("tool_call", "z");
    rec.record("tool_call", "w");
    rec.record("error", "oops");
    const summary = summarize(rec.end());
    expect(summary.frameCount).toBe(5);
    expect(summary.byKind.tool_call).toBe(2);
    expect(summary.toolCallCount).toBe(2);
    expect(summary.errorCount).toBe(1);
  });

  it("durationMs computed from start + end", () => {
    const rec = new TrajectoryRecorder();
    rec.record("prompt", "x");
    const traj = rec.end();
    const summary = summarize(traj);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});
