/**
 * V9 T14.2a — ASMR voter tests.
 *
 * Covers reciprocal-rank fusion correctness, empty-ensemble handling,
 * per-retriever failures isolated to telemetry, and the deterministic
 * ordering required for LongMemEval reproducibility.
 */

import { describe, expect, it } from "vitest";
import type { MemoryEntry, MemorySearchResult } from "../../src/memory/store.js";
import {
  runAsmrVoter,
  spreadRetrievers,
  type AsmrRetrieverSpec,
} from "../../src/memory/asmr-voter.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeEntry(id: string, value: string = id): MemoryEntry {
  return {
    id,
    layer: "session",
    blockType: "fact",
    key: id,
    value,
    createdAt: "2026-04-23T00:00:00Z",
    updatedAt: "2026-04-23T00:00:00Z",
    verified: false,
    freshnessScore: 1,
    confidenceLevel: 0.5,
    verificationStatus: "unverified",
  } as unknown as MemoryEntry;
}

function makeHit(id: string, score: number = 1): MemorySearchResult {
  return {
    entry: makeEntry(id),
    score,
    snippet: id,
  } as unknown as MemorySearchResult;
}

function constantRetriever(ids: readonly string[]): AsmrRetrieverSpec["retriever"] {
  return async () => ids.map((id) => makeHit(id));
}

// ── Empty ensemble ────────────────────────────────────────────────────────

describe("runAsmrVoter — empty ensemble", () => {
  it("returns empty result when no retrievers supplied", async () => {
    const result = await runAsmrVoter("q", []);
    expect(result.hits).toHaveLength(0);
    expect(result.telemetry).toHaveLength(0);
    expect(result.hasPartialFailure).toBe(false);
  });
});

// ── Single retriever ──────────────────────────────────────────────────────

describe("runAsmrVoter — single retriever", () => {
  it("preserves rank order when only one retriever votes", async () => {
    const spec: AsmrRetrieverSpec = {
      name: "only",
      retriever: constantRetriever(["a", "b", "c"]),
    };
    const result = await runAsmrVoter("q", [spec]);
    const ids = result.hits.map((h) => h.entry.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("telemetry records hit count + retriever name", async () => {
    const spec: AsmrRetrieverSpec = {
      name: "fts",
      retriever: constantRetriever(["x", "y"]),
    };
    const result = await runAsmrVoter("q", [spec]);
    expect(result.telemetry).toHaveLength(1);
    expect(result.telemetry[0]?.name).toBe("fts");
    expect(result.telemetry[0]?.hitCount).toBe(2);
  });
});

// ── Fusion correctness ───────────────────────────────────────────────────

describe("runAsmrVoter — RRF fusion", () => {
  it("entries ranked highest by multiple retrievers beat lone top-1", async () => {
    // Retriever A: a, b, c    (a at rank 1)
    // Retriever B: b, a, c    (b at rank 1)
    // Retriever C: b, c, a    (b at rank 1)
    // b appears at ranks 2, 1, 1 → strongest signal overall
    const retrievers: AsmrRetrieverSpec[] = [
      { name: "a", retriever: constantRetriever(["a", "b", "c"]) },
      { name: "b", retriever: constantRetriever(["b", "a", "c"]) },
      { name: "c", retriever: constantRetriever(["b", "c", "a"]) },
    ];
    const result = await runAsmrVoter("q", retrievers, { k: 60, topK: 3 });
    const top = result.hits.map((h) => h.entry.id);
    expect(top[0]).toBe("b");
  });

  it("entries unique to a single retriever still appear (not discarded)", async () => {
    const retrievers: AsmrRetrieverSpec[] = [
      { name: "a", retriever: constantRetriever(["shared"]) },
      { name: "b", retriever: constantRetriever(["shared", "only-in-b"]) },
    ];
    const result = await runAsmrVoter("q", retrievers, { topK: 5 });
    const ids = result.hits.map((h) => h.entry.id);
    expect(ids).toContain("shared");
    expect(ids).toContain("only-in-b");
  });

  it("per-hit ranks dictionary captures which retriever contributed which rank", async () => {
    const retrievers: AsmrRetrieverSpec[] = [
      { name: "fts", retriever: constantRetriever(["x", "y"]) },
      { name: "vec", retriever: constantRetriever(["y", "z"]) },
    ];
    const result = await runAsmrVoter("q", retrievers);
    const xHit = result.hits.find((h) => h.entry.id === "x");
    const yHit = result.hits.find((h) => h.entry.id === "y");
    expect(xHit?.ranks).toEqual({ fts: 1 });
    expect(yHit?.ranks).toEqual({ fts: 2, vec: 1 });
  });

  it("topK caps the result count", async () => {
    const spec: AsmrRetrieverSpec = {
      name: "big",
      retriever: constantRetriever(["a", "b", "c", "d", "e"]),
    };
    const result = await runAsmrVoter("q", [spec], { topK: 2 });
    expect(result.hits).toHaveLength(2);
  });

  it("lower K widens the absolute gap between rank-1 and rank-2", async () => {
    // `a` wins both retrievers at rank 1; `b` appears at rank 2 in one
    // and is absent in the other. Low K amplifies rank-1 contributions
    // vs rank-2 — so the a-vs-b absolute gap is larger when K is small.
    const retrievers: AsmrRetrieverSpec[] = [
      { name: "x", retriever: constantRetriever(["a", "b"]) },
      { name: "y", retriever: constantRetriever(["a"]) },
    ];
    const lowK = await runAsmrVoter("q", retrievers, { k: 1 });
    const highK = await runAsmrVoter("q", retrievers, { k: 200 });
    const lowSpread = lowK.hits[0]!.fusedScore - lowK.hits[1]!.fusedScore;
    const highSpread = highK.hits[0]!.fusedScore - highK.hits[1]!.fusedScore;
    expect(lowSpread).toBeGreaterThan(highSpread);
  });
});

// ── Partial failure isolation ────────────────────────────────────────────

describe("runAsmrVoter — failure isolation", () => {
  it("a throwing retriever does not stop others from voting", async () => {
    const retrievers: AsmrRetrieverSpec[] = [
      { name: "good", retriever: constantRetriever(["a"]) },
      {
        name: "bad",
        retriever: async () => {
          throw new Error("fts index corrupted");
        },
      },
      { name: "other", retriever: constantRetriever(["a", "b"]) },
    ];
    const result = await runAsmrVoter("q", retrievers);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hasPartialFailure).toBe(true);
  });

  it("telemetry records failed retriever with error message", async () => {
    const retrievers: AsmrRetrieverSpec[] = [
      { name: "good", retriever: constantRetriever(["a"]) },
      {
        name: "bad",
        retriever: async () => {
          throw new Error("timeout after 5000ms");
        },
      },
    ];
    const result = await runAsmrVoter("q", retrievers);
    const badTelemetry = result.telemetry.find((t) => t.name === "bad");
    expect(badTelemetry?.error).toContain("timeout");
    expect(badTelemetry?.hitCount).toBe(0);
  });
});

// ── Determinism ───────────────────────────────────────────────────────────

describe("runAsmrVoter — determinism", () => {
  it("two runs with identical inputs produce identical ranked output", async () => {
    const retrievers: AsmrRetrieverSpec[] = [
      { name: "a", retriever: constantRetriever(["x", "y", "z"]) },
      { name: "b", retriever: constantRetriever(["z", "y", "x"]) },
    ];
    const a = await runAsmrVoter("q", retrievers);
    const b = await runAsmrVoter("q", retrievers);
    expect(a.hits.map((h) => h.entry.id)).toEqual(b.hits.map((h) => h.entry.id));
    expect(a.hits.map((h) => h.fusedScore)).toEqual(b.hits.map((h) => h.fusedScore));
  });
});

// ── spreadRetrievers helper ───────────────────────────────────────────────

describe("spreadRetrievers", () => {
  it("produces N retrievers with sequentially numbered labels", () => {
    const factory = (seed: number) => async () => [makeHit(`r${seed}`)];
    const specs = spreadRetrievers(factory, 5);
    expect(specs).toHaveLength(5);
    expect(specs.map((s) => s.name)).toEqual([
      "variant-1",
      "variant-2",
      "variant-3",
      "variant-4",
      "variant-5",
    ]);
  });

  it("passes the seed into the factory so each variant can differ", async () => {
    const factory = (seed: number) => async () => [makeHit(`seed-${seed}`)];
    const specs = spreadRetrievers(factory, 3);
    const results = await Promise.all(specs.map((s) => s.retriever("q")));
    expect(results[0]?.[0]?.entry.id).toBe("seed-0");
    expect(results[2]?.[0]?.entry.id).toBe("seed-2");
  });

  it("honors a custom labelPrefix", () => {
    const factory = (_seed: number) => async () => [];
    const specs = spreadRetrievers(factory, 2, "recall-mode");
    expect(specs.map((s) => s.name)).toEqual(["recall-mode-1", "recall-mode-2"]);
  });
});
