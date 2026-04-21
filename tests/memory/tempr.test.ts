/**
 * Phase 2 P1-M4 — TEMPR 4-channel parallel retrieval.
 *
 * TEMPR = Time-aware Episodic Memory with Parallel Retrieval
 * (Hindsight port, arXiv 2512.12818).
 *
 *   Channels: vector, bm25, entity, temporal → RRF fusion → cross-encoder rerank.
 *
 * Tests use injected channel + cross-encoder mocks so the suite is
 * hermetic. The production wiring lives in store.ts temprSearch().
 */

import { describe, it, expect, vi } from "vitest";
import { createTEMPR, type TEMPRChannel, type TEMPRCandidate } from "../../src/memory/tempr.js";
import { createHeuristicCrossEncoder } from "../../src/memory/cross-encoder.js";

const entry = (id: string, content: string): TEMPRCandidate => ({ id, content });

function mockChannel(name: string, ids: string[]): TEMPRChannel {
  return {
    name,
    retrieve: vi.fn(async () => ({
      candidates: ids.map((id) => entry(id, `${name}-${id}`)),
    })),
  };
}

describe("TEMPR", () => {
  it("dispatches all 4 channels in parallel", async () => {
    const c1 = mockChannel("vector", ["a", "b", "c"]);
    const c2 = mockChannel("bm25", ["a", "d"]);
    const c3 = mockChannel("entity", ["b", "e"]);
    const c4 = mockChannel("temporal", ["c", "f"]);
    const tempr = createTEMPR({ channels: [c1, c2, c3, c4] });

    const result = await tempr.search("hello");
    expect(c1.retrieve).toHaveBeenCalledOnce();
    expect(c2.retrieve).toHaveBeenCalledOnce();
    expect(c3.retrieve).toHaveBeenCalledOnce();
    expect(c4.retrieve).toHaveBeenCalledOnce();
    // Union of all channel ids: {a,b,c,d,e,f}
    expect(result.hits.length).toBe(6);
  });

  it("isolates channel failures — 1 crashed, 3 still return results", async () => {
    const okA = mockChannel("ok-a", ["a", "b"]);
    const okB = mockChannel("ok-b", ["b", "c"]);
    const okC = mockChannel("ok-c", ["c", "d"]);
    const bad: TEMPRChannel = {
      name: "bad",
      retrieve: vi.fn(async () => {
        throw new Error("channel exploded");
      }),
    };
    const failures: string[] = [];
    const tempr = createTEMPR({
      channels: [okA, okB, okC, bad],
      onChannelError: (n) => failures.push(n),
    });

    const result = await tempr.search("q");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(failures).toEqual(["bad"]);
    expect(result.channelResults.get("bad")?.error).toBeDefined();
    expect(result.channelResults.get("ok-a")?.candidates?.length).toBe(2);
  });

  it("all 4 channels succeed → RRF fuses correctly", async () => {
    // "a" appears first in 3/4 channels → should be top
    const c1 = mockChannel("c1", ["a", "b"]);
    const c2 = mockChannel("c2", ["a", "c"]);
    const c3 = mockChannel("c3", ["a", "d"]);
    const c4 = mockChannel("c4", ["z", "a"]);
    const tempr = createTEMPR({ channels: [c1, c2, c3, c4] });

    const result = await tempr.search("q");
    expect(result.hits[0]?.id).toBe("a");
  });

  it("channels are injectable (caller provides list)", async () => {
    const custom = mockChannel("custom-only", ["single"]);
    const tempr = createTEMPR({ channels: [custom] });
    const result = await tempr.search("q");
    expect(result.hits[0]?.id).toBe("single");
  });

  it("cross-encoder rerank is injectable", async () => {
    const c1 = mockChannel("c1", ["low-relevance", "high-relevance"]);
    // Set content so heuristic encoder can judge
    (c1.retrieve as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      candidates: [
        entry("low-relevance", "cats dogs birds"),
        entry("high-relevance", "memory retrieval system"),
      ],
    });
    const tempr = createTEMPR({
      channels: [c1],
      crossEncoder: createHeuristicCrossEncoder(),
    });
    const result = await tempr.search("memory retrieval");
    expect(result.hits[0]?.id).toBe("high-relevance");
    expect(result.rerankerApplied).toBe(true);
  });

  it("rerank failure → fused order preserved (honest-fail)", async () => {
    const c1 = mockChannel("c1", ["a", "b"]);
    const tempr = createTEMPR({
      channels: [c1],
      crossEncoder: {
        rerank: async () => {
          throw new Error("rerank boom");
        },
      },
    });
    const result = await tempr.search("q");
    // Falls back to fused (which is RRF of c1 alone → original order)
    expect(result.hits.length).toBe(2);
    expect(result.rerankerApplied).toBe(false);
  });

  it("respects topK limit", async () => {
    const c1 = mockChannel("c1", ["a", "b", "c", "d", "e", "f"]);
    const tempr = createTEMPR({ channels: [c1] });
    const result = await tempr.search("q", { topK: 3 });
    expect(result.hits.length).toBe(3);
  });

  it("per-query isolation — separate search() calls don't share state", async () => {
    const c1 = mockChannel("c1", ["a"]);
    const tempr = createTEMPR({ channels: [c1] });
    const r1 = await tempr.search("q1");
    const r2 = await tempr.search("q2");
    expect(r1.hits).not.toBe(r2.hits); // different object references
    expect(c1.retrieve).toHaveBeenCalledTimes(2);
  });

  it("empty channel list → empty result (no crash)", async () => {
    const tempr = createTEMPR({ channels: [] });
    const result = await tempr.search("q");
    expect(result.hits).toEqual([]);
  });

  it("all channels fail → empty hits + all errors captured", async () => {
    const bad1: TEMPRChannel = {
      name: "b1",
      retrieve: async () => {
        throw new Error("e1");
      },
    };
    const bad2: TEMPRChannel = {
      name: "b2",
      retrieve: async () => {
        throw new Error("e2");
      },
    };
    const errors: string[] = [];
    const tempr = createTEMPR({ channels: [bad1, bad2], onChannelError: (n) => errors.push(n) });
    const result = await tempr.search("q");
    expect(result.hits).toEqual([]);
    expect(errors).toEqual(["b1", "b2"]);
    expect(result.channelResults.get("b1")?.error?.message).toBe("e1");
    expect(result.channelResults.get("b2")?.error?.message).toBe("e2");
  });

  it("query is passed to each channel", async () => {
    const c1 = mockChannel("c1", ["a"]);
    const tempr = createTEMPR({ channels: [c1] });
    await tempr.search("my-query-text");
    expect(c1.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ query: "my-query-text" }),
    );
  });

  it("durationMs is a non-negative number", async () => {
    const c1 = mockChannel("c1", ["a"]);
    const tempr = createTEMPR({ channels: [c1] });
    const result = await tempr.search("q");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("perChannel rankings are preserved in result", async () => {
    const c1 = mockChannel("c1", ["a", "b"]);
    const c2 = mockChannel("c2", ["b", "a"]);
    const tempr = createTEMPR({ channels: [c1, c2] });
    const result = await tempr.search("q");
    expect(result.channelResults.get("c1")?.candidates?.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.channelResults.get("c2")?.candidates?.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("deduplicates same id across channels (fused once)", async () => {
    const c1 = mockChannel("c1", ["a", "a", "b"]); // duplicated a within channel
    const c2 = mockChannel("c2", ["a"]);
    const tempr = createTEMPR({ channels: [c1, c2] });
    const result = await tempr.search("q");
    const aHits = result.hits.filter((h) => h.id === "a");
    expect(aHits.length).toBe(1);
  });
});
