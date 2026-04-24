/**
 * V9 T14.7 — time-travel replay + fork tests.
 *
 * Both modules wrap `src/autopilot/trajectory-recorder.ts`. Tests
 * inject a fake loader/saver so the suite runs without real disk I/O.
 */

import { describe, expect, it } from "vitest";
import type { Trajectory, TrajectoryFrame } from "../../src/autopilot/trajectory-recorder.js";
import {
  parseFilterArg,
  parsePacingArg,
  parseUntilArg,
  runReplay,
} from "../../src/cli/replay.js";
import {
  resolveSplitSeq,
  runFork,
  truncateTrajectory,
} from "../../src/cli/fork.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function frame(
  seq: number,
  kind: TrajectoryFrame["kind"],
  content = `frame-${seq}`,
  timestamp = 1_000_000 + seq * 100,
): TrajectoryFrame {
  return { seq, timestamp, kind, content };
}

function sampleTraj(): Trajectory {
  return {
    id: "traj-1",
    startedAt: 1_000_000,
    endedAt: 1_000_500,
    frames: [
      frame(0, "prompt", "hello"),
      frame(1, "thinking", "...thinking"),
      frame(2, "response", "hi there"),
      frame(3, "tool_call", "bash"),
      frame(4, "tool_result", "ok"),
      frame(5, "response", "done"),
    ],
    metadata: { source: "test" },
  };
}

// ── replay.ts — runReplay ─────────────────────────────────────────────────

describe("runReplay", () => {
  it("streams every frame to the writer when no filter is set", async () => {
    const captured: string[] = [];
    const result = await runReplay({
      trajectoryPath: "fake",
      writer: (text) => captured.push(text),
      loader: async () => sampleTraj(),
      pacing: "fast",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.framesPlayed).toBe(6);
      expect(result.trajectoryId).toBe("traj-1");
    }
    expect(captured).toHaveLength(6);
  });

  it("honors the filter — drops non-matching kinds silently", async () => {
    const captured: string[] = [];
    const result = await runReplay({
      trajectoryPath: "fake",
      writer: (text) => captured.push(text),
      loader: async () => sampleTraj(),
      filter: ["response"],
      pacing: "fast",
    });
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(2);
    for (const line of captured) expect(line).toContain("response");
  });

  it("honors --until", async () => {
    const captured: string[] = [];
    await runReplay({
      trajectoryPath: "fake",
      writer: (text) => captured.push(text),
      loader: async () => sampleTraj(),
      until: 2,
      pacing: "fast",
    });
    expect(captured).toHaveLength(3); // seqs 0, 1, 2
  });

  it("returns ok:false when the loader throws", async () => {
    const result = await runReplay({
      trajectoryPath: "missing",
      writer: () => {},
      loader: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("load failed");
  });

  it("formats each frame with seq, ISO timestamp, and kind", async () => {
    const captured: string[] = [];
    await runReplay({
      trajectoryPath: "fake",
      writer: (text) => captured.push(text),
      loader: async () => ({
        id: "t",
        startedAt: 0,
        frames: [frame(0, "prompt", "hi", 1_600_000_000_000)],
      }),
      pacing: "fast",
    });
    expect(captured[0]).toMatch(/\[0000\]/);
    expect(captured[0]).toMatch(/prompt/);
    expect(captured[0]).toMatch(/2020-09-13/); // ISO derived from fixed ts
  });
});

// ── replay.ts — arg parsers ───────────────────────────────────────────────

describe("parseFilterArg", () => {
  it("returns undefined for empty/undefined", () => {
    expect(parseFilterArg(undefined)).toBeUndefined();
    expect(parseFilterArg("")).toBeUndefined();
    expect(parseFilterArg("   ")).toBeUndefined();
  });

  it("parses a valid comma list", () => {
    expect(parseFilterArg("prompt,response")).toEqual(["prompt", "response"]);
  });

  it("drops unknown kinds", () => {
    expect(parseFilterArg("prompt,bogus,response")).toEqual(["prompt", "response"]);
  });

  it("returns undefined when every kind is invalid", () => {
    expect(parseFilterArg("bogus,alsoWrong")).toBeUndefined();
  });
});

describe("parsePacingArg", () => {
  it("returns 'fast' by default", () => {
    expect(parsePacingArg(undefined)).toBe("fast");
    expect(parsePacingArg("")).toBe("fast");
  });

  it("accepts the two named modes", () => {
    expect(parsePacingArg("realtime")).toBe("realtime");
    expect(parsePacingArg("fast")).toBe("fast");
  });

  it("accepts a numeric ms delay", () => {
    expect(parsePacingArg("50")).toBe(50);
  });

  it("falls back to 'fast' on garbage input (honest default)", () => {
    expect(parsePacingArg("lol")).toBe("fast");
    expect(parsePacingArg("-5")).toBe("fast");
  });
});

describe("parseUntilArg", () => {
  it("returns undefined for absent or invalid input", () => {
    expect(parseUntilArg(undefined)).toBeUndefined();
    expect(parseUntilArg("-1")).toBeUndefined();
    expect(parseUntilArg("xyz")).toBeUndefined();
  });

  it("floors numeric input", () => {
    expect(parseUntilArg("42")).toBe(42);
    expect(parseUntilArg("42.7")).toBe(42);
  });
});

// ── fork.ts — resolveSplitSeq ────────────────────────────────────────────

describe("resolveSplitSeq", () => {
  it("returns at (floored) when provided", () => {
    expect(resolveSplitSeq(sampleTraj(), { at: 3.9 })).toBe(3);
  });

  it("returns the LAST frame of the atKind when kind exists", () => {
    expect(resolveSplitSeq(sampleTraj(), { atKind: "response" })).toBe(5);
  });

  it("returns null when atKind has no match", () => {
    expect(resolveSplitSeq(sampleTraj(), { atKind: "error" })).toBeNull();
  });

  it("falls back to last seq when neither at nor atKind is set", () => {
    expect(resolveSplitSeq(sampleTraj(), {})).toBe(5);
  });

  it("returns 0 for an empty trajectory with no split args", () => {
    const empty: Trajectory = {
      id: "e",
      startedAt: 0,
      frames: [],
    };
    expect(resolveSplitSeq(empty, {})).toBe(0);
  });
});

// ── fork.ts — truncateTrajectory ──────────────────────────────────────────

describe("truncateTrajectory", () => {
  it("keeps frames with seq <= atSeq", () => {
    const forked = truncateTrajectory(sampleTraj(), 2);
    expect(forked.frames).toHaveLength(3);
    expect(forked.frames.map((f) => f.seq)).toEqual([0, 1, 2]);
  });

  it("gives the fork a deterministic id derived from source + seq", () => {
    const forked = truncateTrajectory(sampleTraj(), 3);
    expect(forked.id).toBe("traj-1@fork-3");
  });

  it("merges extraMetadata alongside forkedFrom + splitSeq", () => {
    const forked = truncateTrajectory(sampleTraj(), 1, { reason: "diverge-here" });
    expect(forked.metadata?.reason).toBe("diverge-here");
    expect(forked.metadata?.forkedFrom).toBe("traj-1");
    expect(forked.metadata?.splitSeq).toBe(1);
  });

  it("updates endedAt to the last kept frame's timestamp", () => {
    const forked = truncateTrajectory(sampleTraj(), 2);
    const expected = sampleTraj().frames[2]?.timestamp;
    expect(forked.endedAt).toBe(expected);
  });

  it("preserves source frames (no mutation)", () => {
    const source = sampleTraj();
    const before = JSON.stringify(source);
    truncateTrajectory(source, 2);
    expect(JSON.stringify(source)).toBe(before);
  });
});

// ── fork.ts — runFork ─────────────────────────────────────────────────────

describe("runFork", () => {
  it("saves the forked trajectory to the output path", async () => {
    let saved: { path: string; traj: Trajectory } | null = null;
    const result = await runFork({
      trajectoryPath: "src",
      outputPath: "out.json",
      at: 2,
      loader: async () => sampleTraj(),
      saver: async (path, traj) => {
        saved = { path, traj };
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keptFrameCount).toBe(3);
      expect(result.splitSeq).toBe(2);
      expect(result.outputPath).toBe("out.json");
    }
    expect(saved).not.toBeNull();
    expect((saved as unknown as { path: string }).path).toBe("out.json");
  });

  it("rejects both at AND atKind being set", async () => {
    const result = await runFork({
      trajectoryPath: "src",
      outputPath: "out.json",
      at: 1,
      atKind: "response",
      loader: async () => sampleTraj(),
      saver: async () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("either --at or --at-kind");
  });

  it("rejects missing outputPath", async () => {
    const result = await runFork({
      trajectoryPath: "src",
      outputPath: "",
      at: 0,
      loader: async () => sampleTraj(),
      saver: async () => {},
    });
    expect(result.ok).toBe(false);
  });

  it("returns an honest error when atKind has no match", async () => {
    const result = await runFork({
      trajectoryPath: "src",
      outputPath: "out.json",
      atKind: "error",
      loader: async () => sampleTraj(),
      saver: async () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no frame of kind");
  });

  it("surfaces loader errors honestly", async () => {
    const result = await runFork({
      trajectoryPath: "missing",
      outputPath: "out.json",
      loader: async () => {
        throw new Error("bad json");
      },
      saver: async () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("load failed");
  });

  it("surfaces saver errors honestly", async () => {
    const result = await runFork({
      trajectoryPath: "src",
      outputPath: "out.json",
      at: 1,
      loader: async () => sampleTraj(),
      saver: async () => {
        throw new Error("EACCES");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("save failed");
  });
});
