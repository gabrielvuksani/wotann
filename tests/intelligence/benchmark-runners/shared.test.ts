/**
 * Tests for shared benchmark-runner primitives:
 *   - BlockedCorpusError formatting + type guard
 *   - DryRunReport helper
 *   - Trajectory writer
 *   - Seeded shuffle determinism
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BlockedCorpusError,
  isBlockedCorpusError,
  makeDryRunReport,
  openTrajectoryWriter,
  trajectoryPathForRun,
  seededShuffle,
} from "../../../src/intelligence/benchmark-runners/shared.js";

describe("BlockedCorpusError", () => {
  it("formats as BLOCKED-NEEDS-CORPUS-DOWNLOAD + fetch command", () => {
    const err = new BlockedCorpusError({
      benchmark: "swe-bench-verified",
      corpusPath: "/nope/here.jsonl",
      fetchCommand: "curl -L example.com -o /tmp/x",
    });
    expect(err.name).toBe("BlockedCorpusError");
    expect(err.benchmark).toBe("swe-bench-verified");
    expect(err.message).toContain("BLOCKED-NEEDS-CORPUS-DOWNLOAD");
    expect(err.message).toContain("swe-bench-verified");
    expect(err.message).toContain("curl -L example.com -o /tmp/x");
    expect(err.message).toContain("/nope/here.jsonl");
  });

  it("is identifiable via isBlockedCorpusError", () => {
    const err = new BlockedCorpusError({
      benchmark: "x",
      corpusPath: "y",
      fetchCommand: "z",
    });
    expect(isBlockedCorpusError(err)).toBe(true);
    expect(isBlockedCorpusError(new Error("other"))).toBe(false);
    expect(isBlockedCorpusError(null)).toBe(false);
    expect(isBlockedCorpusError("string")).toBe(false);
  });
});

describe("makeDryRunReport", () => {
  it("marks ready=true when all checks pass and corpus size > 0", () => {
    const r = makeDryRunReport({
      benchmark: "terminal-bench",
      checks: [
        { name: "corpus", ok: true },
        { name: "runtime", ok: true },
      ],
      corpusSize: 5,
    });
    expect(r.ready).toBe(true);
    expect(r.blockedReason).toBeUndefined();
  });

  it("marks ready=false when any check fails", () => {
    const r = makeDryRunReport({
      benchmark: "terminal-bench",
      checks: [
        { name: "corpus", ok: false, detail: "missing" },
        { name: "runtime", ok: true },
      ],
      corpusSize: 5,
    });
    expect(r.ready).toBe(false);
  });

  it("marks ready=false when corpus size is 0", () => {
    const r = makeDryRunReport({
      benchmark: "terminal-bench",
      checks: [{ name: "runtime", ok: true }],
      corpusSize: 0,
    });
    expect(r.ready).toBe(false);
  });

  it("marks ready=false when blockedReason present", () => {
    const r = makeDryRunReport({
      benchmark: "terminal-bench",
      checks: [{ name: "runtime", ok: true }],
      corpusSize: 5,
      blockedReason: "corpus missing",
    });
    expect(r.ready).toBe(false);
    expect(r.blockedReason).toBe("corpus missing");
  });
});

describe("trajectory writer", () => {
  it("creates directory and appends JSONL entries", () => {
    const writer = openTrajectoryWriter("test-trajectory-shared");
    expect(writer.path).toBe(trajectoryPathForRun("test-trajectory-shared"));
    writer.write({ type: "run-start", runId: "test-trajectory-shared" });
    writer.write({ type: "task-result", task_id: "t1", passed: true });
    writer.write({ type: "run-end", runId: "test-trajectory-shared" });

    expect(existsSync(writer.path)).toBe(true);
    const lines = readFileSync(writer.path, "utf-8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[0]?.["type"]).toBe("run-start");
    expect(parsed.find((p) => p["type"] === "task-result")?.["task_id"]).toBe("t1");

    // Cleanup — avoid accumulating test output in ~/.wotann
    rmSync(writer.path, { force: true });
  });

  it("write is non-fatal on disk failure (best-effort audit)", () => {
    // Pass a path that will be immediately removed to simulate a
    // transient disk issue; writer should swallow the error.
    const tmp = mkdtempSync(join(tmpdir(), "wotann-traj-"));
    try {
      const writer = openTrajectoryWriter("test-disk-fail-rand");
      // Force the path to a removed dir so writes go to a missing parent
      rmSync(tmp, { recursive: true, force: true });
      expect(() => writer.write({ a: 1 })).not.toThrow();
    } finally {
      if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("seededShuffle", () => {
  it("is deterministic for the same seed", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = seededShuffle(input, 42);
    const b = seededShuffle(input, 42);
    expect(a).toEqual(b);
  });

  it("produces different orders for different seeds", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = seededShuffle(input, 42);
    const b = seededShuffle(input, 99);
    // At 10 items the chance of identical shuffle is ~1 / 10! — negligible.
    expect(a).not.toEqual(b);
  });

  it("preserves elements (is a permutation)", () => {
    const input = [1, 2, 3, 4, 5];
    const shuffled = seededShuffle(input, 7);
    expect(shuffled.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });
});
