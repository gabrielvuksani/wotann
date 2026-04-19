import { describe, it, expect, vi } from "vitest";
import { speculativeExecute } from "../../src/orchestration/speculative-execution.js";

describe("speculativeExecute", () => {
  it("picks highest-scoring candidate", async () => {
    const result = await speculativeExecute<number>({
      n: 3,
      generate: async (i) => i,
      score: async (v) => v,
    });
    expect(result.best.value).toBe(2); // highest index = highest value
    expect(result.bestScore).toBe(2);
  });

  it("respects concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await speculativeExecute<number>({
      n: 10,
      concurrency: 3,
      generate: async (i) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return i;
      },
      score: async (v) => v,
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(result.allCandidates.length).toBe(10);
  });

  it("early stops when threshold reached", async () => {
    let invocations = 0;
    const result = await speculativeExecute<number>({
      n: 10,
      concurrency: 1, // serial — so early-stop is deterministic
      earlyStopThreshold: 3,
      generate: async (i) => {
        invocations++;
        return i;
      },
      score: async (v) => v,
    });
    expect(result.earlyStopped).toBe(true);
    expect(invocations).toBeLessThan(10);
    expect(result.best.value).toBeGreaterThanOrEqual(3);
  });

  it("handles per-candidate errors without crashing", async () => {
    const result = await speculativeExecute<number>({
      n: 3,
      generate: async (i) => {
        if (i === 1) throw new Error("fail");
        return i;
      },
      score: async (v) => v,
    });
    const failed = result.allCandidates.find((c) => c.error);
    expect(failed).toBeDefined();
    expect(result.best.value).toBe(2); // best non-errored candidate
  });

  it("throws when n <= 0", async () => {
    await expect(
      speculativeExecute({
        n: 0,
        generate: async () => 0,
        score: async () => 0,
      }),
    ).rejects.toThrow(/n must be/);
  });

  it("per-generation timeout triggers", async () => {
    const result = await speculativeExecute<string>({
      n: 2,
      perGenTimeoutMs: 20,
      generate: async (i) => {
        if (i === 0) await new Promise((r) => setTimeout(r, 100));
        return `val-${i}`;
      },
      score: async (v) => v.length,
    });
    const slowOne = result.allCandidates.find((c) => c.id === 0);
    expect(slowOne?.error).toContain("timed out");
  });

  it("records durationMs per candidate", async () => {
    const result = await speculativeExecute<number>({
      n: 2,
      generate: async (i) => {
        await new Promise((r) => setTimeout(r, 10));
        return i;
      },
      score: async (v) => v,
    });
    for (const c of result.allCandidates) {
      expect(c.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
