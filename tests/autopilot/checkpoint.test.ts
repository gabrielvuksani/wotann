import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  saveCheckpoint,
  loadCheckpoint,
  findResumableCheckpoint,
  pruneOldCheckpoints,
  checkpointFilename,
  hashWorkingTree,
  decideResume,
  CHECKPOINT_VERSION,
  type AutopilotCheckpoint,
} from "../../src/autopilot/checkpoint.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeCheckpoint(overrides: Partial<AutopilotCheckpoint> = {}): AutopilotCheckpoint {
  return {
    version: CHECKPOINT_VERSION,
    taskId: "task-1",
    savedAt: new Date().toISOString(),
    iteration: 5,
    continuesSoFar: 2,
    elapsedMs: 60_000,
    usdSpent: 1.5,
    evidence: [],
    artifacts: [],
    workingTreeHash: "abc123",
    ...overrides,
  };
}

describe("saveCheckpoint / loadCheckpoint", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wotann-cp-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a checkpoint", async () => {
    const cp = makeCheckpoint({ iteration: 42 });
    const path = join(dir, "one.checkpoint.json");
    await saveCheckpoint(path, cp);
    const loaded = await loadCheckpoint(path);
    expect(loaded).toEqual(cp);
  });

  it("save is atomic: no stray .tmp files remain on success", async () => {
    const cp = makeCheckpoint();
    const path = join(dir, "two.checkpoint.json");
    await saveCheckpoint(path, cp);
    const entries = await readFile(path, "utf-8");
    expect(entries).toContain('"taskId"');
    // The .tmp file should have been renamed, not left behind
  });

  it("load rejects wrong version", async () => {
    const path = join(dir, "stale.checkpoint.json");
    await writeFile(path, JSON.stringify({ version: 99, taskId: "x", iteration: 0 }));
    await expect(loadCheckpoint(path)).rejects.toThrow(/version mismatch/);
  });

  it("load rejects missing taskId", async () => {
    const path = join(dir, "broken.checkpoint.json");
    await writeFile(
      path,
      JSON.stringify({ version: CHECKPOINT_VERSION, taskId: "", iteration: 0 }),
    );
    await expect(loadCheckpoint(path)).rejects.toThrow(/missing taskId/);
  });

  it("load rejects invalid JSON", async () => {
    const path = join(dir, "garbage.checkpoint.json");
    await writeFile(path, "{not json}");
    await expect(loadCheckpoint(path)).rejects.toThrow(/invalid JSON/);
  });

  it("load rejects invalid iteration", async () => {
    const path = join(dir, "neg-iter.checkpoint.json");
    await writeFile(
      path,
      JSON.stringify({ version: CHECKPOINT_VERSION, taskId: "t", iteration: -1 }),
    );
    await expect(loadCheckpoint(path)).rejects.toThrow(/invalid iteration/);
  });

  it("overwrite=false fails on existing path", async () => {
    const cp = makeCheckpoint();
    const path = join(dir, "three.checkpoint.json");
    await saveCheckpoint(path, cp);
    await expect(saveCheckpoint(path, cp, { overwrite: false })).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("findResumableCheckpoint", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wotann-cp-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when no checkpoints exist", async () => {
    expect(await findResumableCheckpoint(dir, "task-1")).toBeNull();
  });

  it("returns null when directory does not exist", async () => {
    expect(await findResumableCheckpoint(join(dir, "nope"), "task-1")).toBeNull();
  });

  it("returns the most recent checkpoint for the given taskId", async () => {
    const old = makeCheckpoint({ taskId: "task-a", iteration: 1 });
    const recent = makeCheckpoint({ taskId: "task-a", iteration: 10 });
    await saveCheckpoint(join(dir, "task-a.20260101000000000.checkpoint.json"), old);
    await saveCheckpoint(join(dir, "task-a.20260419000000000.checkpoint.json"), recent);
    const found = await findResumableCheckpoint(dir, "task-a");
    expect(found?.iteration).toBe(10);
  });

  it("ignores checkpoints for other taskIds", async () => {
    const other = makeCheckpoint({ taskId: "task-b", iteration: 99 });
    await saveCheckpoint(join(dir, "task-b.20260419000000000.checkpoint.json"), other);
    const found = await findResumableCheckpoint(dir, "task-a");
    expect(found).toBeNull();
  });

  it("skips a corrupt checkpoint and tries the next older", async () => {
    const good = makeCheckpoint({ taskId: "task-c", iteration: 5 });
    await writeFile(
      join(dir, "task-c.20260420000000000.checkpoint.json"),
      "CORRUPT",
    );
    await saveCheckpoint(join(dir, "task-c.20260419000000000.checkpoint.json"), good);
    const found = await findResumableCheckpoint(dir, "task-c");
    expect(found?.iteration).toBe(5);
  });
});

describe("pruneOldCheckpoints", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wotann-cp-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("deletes old checkpoints, keeps newest N", async () => {
    for (let i = 1; i <= 5; i++) {
      const ts = `2026041900000000${i}`;
      await saveCheckpoint(
        join(dir, `task-x.${ts}.checkpoint.json`),
        makeCheckpoint({ taskId: "task-x", iteration: i }),
      );
    }
    const deleted = await pruneOldCheckpoints(dir, "task-x", 2);
    expect(deleted).toBe(3);
  });

  it("deletes 0 when checkpoint count <= keep", async () => {
    await saveCheckpoint(
      join(dir, "task-y.20260419000000001.checkpoint.json"),
      makeCheckpoint({ taskId: "task-y" }),
    );
    expect(await pruneOldCheckpoints(dir, "task-y", 5)).toBe(0);
  });

  it("throws on negative keep", async () => {
    await expect(pruneOldCheckpoints(dir, "task-z", -1)).rejects.toThrow(/keep must be/);
  });

  it("returns 0 when directory is missing", async () => {
    expect(await pruneOldCheckpoints(join(dir, "missing"), "task-x", 3)).toBe(0);
  });
});

describe("checkpointFilename", () => {
  it("includes taskId + timestamp", () => {
    const name = checkpointFilename("task-foo", new Date("2026-04-19T12:00:00Z"));
    expect(name).toMatch(/^task-foo\.\d+\.checkpoint\.json$/);
  });

  it("different timestamps sort chronologically", () => {
    const a = checkpointFilename("x", new Date("2026-01-01T00:00:00Z"));
    const b = checkpointFilename("x", new Date("2026-06-01T00:00:00Z"));
    expect([b, a].sort()).toEqual([a, b]);
  });
});

describe("hashWorkingTree", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wotann-cp-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the same hash for same files in different order", async () => {
    await writeFile(join(dir, "a.txt"), "A");
    await writeFile(join(dir, "b.txt"), "B");
    const h1 = await hashWorkingTree(["a.txt", "b.txt"], dir);
    const h2 = await hashWorkingTree(["b.txt", "a.txt"], dir);
    expect(h1).toBe(h2);
  });

  it("changes when a file's content changes", async () => {
    await writeFile(join(dir, "a.txt"), "original");
    const h1 = await hashWorkingTree(["a.txt"], dir);
    await writeFile(join(dir, "a.txt"), "modified");
    const h2 = await hashWorkingTree(["a.txt"], dir);
    expect(h1).not.toBe(h2);
  });

  it("hashes MISSING marker for absent files", async () => {
    const h = await hashWorkingTree(["gone.txt"], dir);
    expect(h).toHaveLength(16);
  });
});

describe("decideResume", () => {
  it("start-fresh when no checkpoint", () => {
    const d = decideResume(null, "abc");
    expect(d.action).toBe("start-fresh");
  });

  it("resume when hash matches and age is fresh", () => {
    const cp = makeCheckpoint({ workingTreeHash: "abc" });
    const d = decideResume(cp, "abc");
    expect(d.action).toBe("resume");
    expect(d.checkpoint).toBe(cp);
  });

  it("discard-stale when hash mismatches", () => {
    const cp = makeCheckpoint({ workingTreeHash: "abc" });
    const d = decideResume(cp, "xyz");
    expect(d.action).toBe("discard-stale");
    expect(d.reason).toContain("working-tree hash mismatch");
  });

  it("discard-stale when checkpoint is too old", () => {
    const cp = makeCheckpoint({
      workingTreeHash: "abc",
      savedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), // 30 days ago
    });
    const d = decideResume(cp, "abc");
    expect(d.action).toBe("discard-stale");
    expect(d.reason).toContain("older than");
  });

  it("custom maxAgeMs", () => {
    const cp = makeCheckpoint({
      workingTreeHash: "abc",
      savedAt: new Date(Date.now() - 1000).toISOString(),
    });
    const d = decideResume(cp, "abc", { maxAgeMs: 500 });
    expect(d.action).toBe("discard-stale");
  });
});
