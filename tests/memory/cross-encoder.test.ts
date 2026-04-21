/**
 * Phase 2 P1-M4 — CrossEncoder rerank tests.
 *
 * We ship a HEURISTIC cross-encoder (word-overlap + length-normalized
 * cosine TF). The real MS MARCO MiniLM-L-6-v2 lands when sqlite-vec +
 * ONNX is wired in P1-M2. The interface is stable; only the
 * relevance-scoring kernel is swapped.
 *
 * Quality bar #6: honest-fail. If rerank throws, caller gets original
 * order back, not a crash.
 */

import { describe, it, expect } from "vitest";
import {
  createHeuristicCrossEncoder,
  createCrossEncoderFromFn,
  type CrossEncoder,
  type CrossEncoderCandidate,
} from "../../src/memory/cross-encoder.js";

const cand = (id: string, content: string): CrossEncoderCandidate => ({ id, content });

describe("createHeuristicCrossEncoder", () => {
  it("returns candidates in overlap-weighted order", async () => {
    const enc = createHeuristicCrossEncoder();
    const query = "memory retrieval system";
    const candidates = [
      cand("a", "this is a memory retrieval system"), // 4 overlaps
      cand("b", "cats are fluffy animals"), // 0 overlaps
      cand("c", "memory management is hard"), // 1 overlap
    ];
    const out = await enc.rerank(query, candidates);
    expect(out[0]?.id).toBe("a");
    expect(out[out.length - 1]?.id).toBe("b");
  });

  it("assigns score 0 when no overlap", async () => {
    const enc = createHeuristicCrossEncoder();
    const out = await enc.rerank("xyz", [cand("x", "abc def ghi")]);
    expect(out[0]?.score).toBe(0);
  });

  it("empty query returns all zeros, stable order", async () => {
    const enc = createHeuristicCrossEncoder();
    const cands = [cand("a", "hello"), cand("b", "world")];
    const out = await enc.rerank("", cands);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.score === 0)).toBe(true);
  });

  it("empty candidates returns []", async () => {
    const enc = createHeuristicCrossEncoder();
    const out = await enc.rerank("anything", []);
    expect(out).toEqual([]);
  });

  it("preserves id + content in output", async () => {
    const enc = createHeuristicCrossEncoder();
    const out = await enc.rerank("retrieval", [
      cand("entry-42", "retrieval is fun"),
    ]);
    expect(out[0]?.id).toBe("entry-42");
    expect(out[0]?.content).toBe("retrieval is fun");
  });

  it("length-normalizes so short and long docs compete fairly", async () => {
    const enc = createHeuristicCrossEncoder();
    const query = "memory";
    const out = await enc.rerank(query, [
      cand("long", "memory " + "filler ".repeat(100)),
      cand("short", "memory"),
    ]);
    // Short doc should not be crushed by length; it should score
    // competitively or higher than a long doc with the same single match.
    const shortScore = out.find((r) => r.id === "short")?.score ?? 0;
    const longScore = out.find((r) => r.id === "long")?.score ?? 0;
    expect(shortScore).toBeGreaterThanOrEqual(longScore);
  });

  it("case-insensitive matching", async () => {
    const enc = createHeuristicCrossEncoder();
    const out = await enc.rerank("MEMORY", [cand("a", "memory"), cand("b", "Memory")]);
    expect(out[0]?.score).toBeGreaterThan(0);
    expect(out[1]?.score).toBeGreaterThan(0);
  });
});

describe("createCrossEncoderFromFn (injectable)", () => {
  it("wraps an arbitrary scoring function", async () => {
    const enc: CrossEncoder = createCrossEncoderFromFn((q, docs) =>
      // Custom: score by docs.length - index (reversed)
      docs.map((_, i) => docs.length - i),
    );
    const out = await enc.rerank("q", [cand("a", "1"), cand("b", "2"), cand("c", "3")]);
    expect(out[0]?.id).toBe("a"); // highest custom score
    expect(out[2]?.id).toBe("c");
  });

  it("honest-fail: when score function throws, returns input unchanged", async () => {
    const enc: CrossEncoder = createCrossEncoderFromFn(() => {
      throw new Error("boom");
    });
    const cands = [cand("a", "x"), cand("b", "y")];
    const out = await enc.rerank("q", cands);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
    expect(out.every((c) => c.score === 0)).toBe(true);
  });

  it("handles async score functions", async () => {
    const enc: CrossEncoder = createCrossEncoderFromFn(async (_q, docs) =>
      Promise.resolve(docs.map((_, i) => 1 / (i + 1))),
    );
    const out = await enc.rerank("q", [cand("a", "1"), cand("b", "2")]);
    expect(out[0]?.id).toBe("a");
  });

  it("discards mismatched score-array length (honest-fail)", async () => {
    const enc: CrossEncoder = createCrossEncoderFromFn(() => [1.0]); // too short
    const out = await enc.rerank("q", [cand("a", "1"), cand("b", "2"), cand("c", "3")]);
    // Returns input with zero scores when length mismatch
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.score === 0)).toBe(true);
  });
});
