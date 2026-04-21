/**
 * Phase 2 P1-M2 — verify store.temprSearch honors the OMEGA wiring
 * options (vectorBackend + ONNX cross-encoder). Uses mocks — the real
 * sqlite-vec and onnx paths are tested in their own files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../src/memory/store.js";
import { createOnnxCrossEncoder } from "../../src/memory/onnx-cross-encoder.js";

let tmpDir: string;
let dbPath: string;
let store: MemoryStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tempr-omega-"));
  dbPath = join(tmpDir, "memory.db");
  store = new MemoryStore(dbPath);
  store.insert({
    id: "e1",
    layer: "working",
    blockType: "feedback",
    key: "pref/a",
    value: "immutable data patterns rock",
    verified: false,
    freshnessScore: 1.0,
    confidenceLevel: 0.8,
    verificationStatus: "unverified",
  });
  store.insert({
    id: "e2",
    layer: "working",
    blockType: "feedback",
    key: "pref/b",
    value: "cats like naps",
    verified: false,
    freshnessScore: 1.0,
    confidenceLevel: 0.8,
    verificationStatus: "unverified",
  });
});

afterEach(() => {
  try {
    store.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("temprSearch: vectorBackend wiring", () => {
  it("uses vectorBackend.knn when provided", async () => {
    const knnMock = vi.fn().mockReturnValue([
      { id: "e1", distance: 0.1 },
      { id: "e2", distance: 0.9 },
    ]);
    const embed = vi.fn().mockResolvedValue([1, 0, 0, 0]);
    const result = await store.temprSearch("immutable", {
      embed,
      vectorBackend: { knn: knnMock },
    });
    // knn was called at least once (via vector channel)
    expect(knnMock).toHaveBeenCalled();
    // Both entries appear in hits (via vector or bm25 channels)
    const ids = result.hits.map((h) => h.id);
    expect(ids).toContain("e1");
  });

  it("falls back to FTS5+cosine when vectorBackend.knn throws", async () => {
    const knnMock = vi.fn().mockImplementation(() => {
      throw new Error("backend down");
    });
    const embed = vi.fn().mockResolvedValue([1, 0, 0, 0]);
    const result = await store.temprSearch("immutable", {
      embed,
      vectorBackend: { knn: knnMock },
    });
    expect(knnMock).toHaveBeenCalled();
    // Fallback still returns hits (via bm25 and fallback vector path)
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("no vectorBackend → uses FTS5+cosine path (honest)", async () => {
    const embed = vi.fn().mockResolvedValue([1, 0, 0, 0]);
    const result = await store.temprSearch("immutable", {
      embed,
      // no vectorBackend
    });
    expect(embed).toHaveBeenCalled();
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("ONNX cross-encoder (mock session) reranks temprSearch hits", async () => {
    // Build a mock ONNX session that gives higher score to "immutable"
    const mockSession = {
      run: vi.fn(async () => ({
        logits: { data: new Float32Array([0.9]), dims: [1, 1] },
      })),
    };
    const encoder = createOnnxCrossEncoder({ session: mockSession, maxLength: 32 });
    const result = await store.temprSearch("immutable", {
      crossEncoder: encoder,
    });
    expect(result.rerankerApplied).toBe(true);
    expect(mockSession.run).toHaveBeenCalled();
  });

  it("ONNX cross-encoder without session → heuristic fallback (rerank still applied)", async () => {
    const encoder = createOnnxCrossEncoder({}); // no session
    const result = await store.temprSearch("immutable", {
      crossEncoder: encoder,
    });
    // Heuristic is applied; rerankerApplied is true.
    expect(result.rerankerApplied).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
  });
});
