/**
 * Phase 2 P1-M2 — ONNX MiniLM cross-encoder tests.
 *
 * The real ms-marco-MiniLM-L-6-v2 model (~90MB) is opt-in via
 * `scripts/download-minilm.mjs` and NEVER committed. Tests here focus
 * on:
 *
 *   1. The injection slot works for any ONNX-shaped session (mock).
 *   2. Model-file missing → graceful fallback to heuristic.
 *   3. Tokenizer is deterministic and handles edge cases.
 *   4. The factory exposes an availability probe (paralleling
 *      isSqliteVecAvailable) so callers can decide at runtime.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createOnnxCrossEncoder,
  isOnnxRuntimeAvailable,
  isMiniLmModelAvailable,
  tokenizePair,
  type OnnxSession,
} from "../../src/memory/onnx-cross-encoder.js";

const ortAvailable = isOnnxRuntimeAvailable();

describe("isOnnxRuntimeAvailable", () => {
  it("returns a boolean", () => {
    expect(typeof ortAvailable).toBe("boolean");
  });
});

describe("tokenizePair — deterministic input shaping", () => {
  it("emits symmetric shape for query+doc", () => {
    const t = tokenizePair("memory system", "a memory");
    expect(t.inputIds.length).toBe(t.attentionMask.length);
    expect(t.tokenTypeIds.length).toBe(t.inputIds.length);
    expect(t.inputIds.length).toBeGreaterThan(0);
  });

  it("truncates to maxLen", () => {
    const t = tokenizePair("x".repeat(1000), "y".repeat(1000), 16);
    expect(t.inputIds.length).toBeLessThanOrEqual(16);
  });

  it("handles empty strings honestly", () => {
    const t = tokenizePair("", "");
    expect(t.inputIds.length).toBeGreaterThan(0); // at least special tokens
  });

  it("is deterministic across calls", () => {
    const a = tokenizePair("q", "d");
    const b = tokenizePair("q", "d");
    expect(a.inputIds).toEqual(b.inputIds);
    expect(a.attentionMask).toEqual(b.attentionMask);
  });
});

describe("createOnnxCrossEncoder — injection path", () => {
  it("routes (query, doc) pairs through an injected session", async () => {
    // Mock ONNX session: returns docs.length scores based on content
    // length (longer = higher). We just want to verify plumbing.
    const mockSession: OnnxSession = {
      run: vi.fn(async (feeds: Record<string, { data: BigInt64Array | Float32Array }>) => {
        // Each call processes ONE pair; output is a single float score
        const ids = feeds["input_ids"]?.data as BigInt64Array;
        // Score proportional to non-pad tokens (real MiniLM fires on
        // semantic content; mock uses attention-mask-like behavior).
        const score = ids ? Math.min(ids.length, 32) / 32 : 0;
        return { logits: { data: new Float32Array([score]), dims: [1, 1] } };
      }),
    };

    const enc = createOnnxCrossEncoder({
      session: mockSession,
      maxLength: 32,
    });
    const out = await enc.rerank("memory", [
      { id: "a", content: "short" },
      { id: "b", content: "much longer text here about memory systems" },
    ]);
    expect(out.length).toBe(2);
    expect(mockSession.run).toHaveBeenCalledTimes(2);
  });

  it("honest-fail: session throws → heuristic fallback invoked", async () => {
    const mockSession: OnnxSession = {
      run: vi.fn(async () => {
        throw new Error("onnx runtime error");
      }),
    };
    const enc = createOnnxCrossEncoder({
      session: mockSession,
      maxLength: 32,
    });
    const out = await enc.rerank("memory retrieval", [
      { id: "a", content: "memory retrieval system" }, // heuristic wins
      { id: "b", content: "unrelated cats" },
    ]);
    // Fallback to heuristic → candidate 'a' scores higher due to overlap
    expect(out[0]?.id).toBe("a");
  });

  it("handles empty candidates without calling the session", async () => {
    const mockSession: OnnxSession = {
      run: vi.fn(),
    };
    const enc = createOnnxCrossEncoder({
      session: mockSession,
      maxLength: 32,
    });
    const out = await enc.rerank("q", []);
    expect(out).toEqual([]);
    expect(mockSession.run).not.toHaveBeenCalled();
  });

  it("reranks by score descending", async () => {
    const mockSession: OnnxSession = {
      run: vi.fn(async (feeds: Record<string, { data: BigInt64Array | Float32Array }>) => {
        // Score = hash of content length mod 10 — random-ish but deterministic
        const ids = feeds["input_ids"]?.data as BigInt64Array;
        const score = ids ? ids.length % 10 : 0;
        return { logits: { data: new Float32Array([score]), dims: [1, 1] } };
      }),
    };
    const enc = createOnnxCrossEncoder({
      session: mockSession,
      maxLength: 32,
    });
    const out = await enc.rerank("q", [
      { id: "a", content: "x" },
      { id: "b", content: "xxxxxxxxxxxxxxx" }, // longer → higher mock score
    ]);
    // Check that output is sorted desc by score
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.score).toBeGreaterThanOrEqual(out[i]!.score);
    }
  });
});

describe("createOnnxCrossEncoder — model missing fallback", () => {
  it("returns a cross-encoder without session (always falls back)", async () => {
    const enc = createOnnxCrossEncoder({
      // no session — forces heuristic
    });
    const out = await enc.rerank("memory", [
      { id: "a", content: "memory system" },
      { id: "b", content: "cats" },
    ]);
    expect(out[0]?.id).toBe("a");
  });

  it("fallback preserves ids and content", async () => {
    const enc = createOnnxCrossEncoder({});
    const out = await enc.rerank("x", [{ id: "only", content: "x y z" }]);
    expect(out[0]?.id).toBe("only");
    expect(out[0]?.content).toBe("x y z");
  });
});

describe("isMiniLmModelAvailable", () => {
  it("returns false for non-existent path", () => {
    expect(isMiniLmModelAvailable("/nonexistent/model.onnx")).toBe(false);
  });

  it("returns false for undefined path", () => {
    expect(isMiniLmModelAvailable()).toBe(false);
  });
});
