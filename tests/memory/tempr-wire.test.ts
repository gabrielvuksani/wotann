/**
 * TEMPR + retrieval-mode wire tests.
 *
 * Proves that when `config.useTempr` or `config.recallMode` is set,
 * the ActiveMemoryEngine's async recall path actually dispatches to
 * the opt-in backend — NOT just that the code compiles.
 *
 * Strategy:
 *   - Instantiate ActiveMemoryEngine directly with a mock store.
 *   - Call preprocessAsync with opts.useTempr=true and assert the
 *     mock's temprSearch was invoked.
 *   - Flip to opts.recallMode and assert searchWithMode was invoked.
 *   - When both are off, assert neither was called (default = FTS).
 */

import { describe, it, expect, vi } from "vitest";
import { ActiveMemoryEngine } from "../../src/memory/active-memory.js";
import type { MemoryStore } from "../../src/memory/store.js";

// Minimal store mock. Not every MemoryStore method matters for these
// tests — we only care about the recall surface.
function makeMockStore(
  overrides: Partial<{
    search: MemoryStore["search"];
    temprSearch: MemoryStore["temprSearch"];
    searchWithMode: MemoryStore["searchWithMode"];
    captureEvent: MemoryStore["captureEvent"];
  }> = {},
): MemoryStore {
  const defaultSearch = vi.fn().mockReturnValue([]);
  const defaultTempr = vi.fn().mockResolvedValue({
    hits: [],
    channelResults: new Map(),
    rerankerApplied: false,
    durationMs: 0,
  });
  const defaultMode = vi.fn().mockResolvedValue({
    mode: "time-decay",
    results: [],
    scoring: { method: "exp-decay", isHeuristic: false },
  });
  const defaultCapture = vi.fn();
  return {
    search: overrides.search ?? defaultSearch,
    temprSearch: overrides.temprSearch ?? defaultTempr,
    searchWithMode: overrides.searchWithMode ?? defaultMode,
    captureEvent: overrides.captureEvent ?? defaultCapture,
  } as unknown as MemoryStore;
}

describe("ActiveMemoryEngine TEMPR + retrieval-mode wire", () => {
  // ── M4 TEMPR path ──────────────────────────────────────

  it("routes through temprSearch when opts.useTempr=true", async () => {
    const temprSpy = vi.fn().mockResolvedValue({
      hits: [
        {
          id: "e1",
          score: 0.9,
          perChannel: {},
          entry: { value: "relevant fact from TEMPR" },
        },
      ],
      channelResults: new Map(),
      rerankerApplied: false,
      durationMs: 0,
    });
    const searchSpy = vi.fn().mockReturnValue([]);
    const store = makeMockStore({
      temprSearch: temprSpy as unknown as MemoryStore["temprSearch"],
      search: searchSpy as unknown as MemoryStore["search"],
    });
    const engine = new ActiveMemoryEngine(store);

    const result = await engine.preprocessAsync(
      "what did I decide about X?",
      "session-1",
      { useTempr: true },
    );

    expect(temprSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).not.toHaveBeenCalled();
    expect(result.contextPrefix).toContain("TEMPR");
    expect(result.contextPrefix).toContain("relevant fact from TEMPR");
  });

  it("falls back to FTS when TEMPR returns empty", async () => {
    const temprSpy = vi.fn().mockResolvedValue({
      hits: [],
      channelResults: new Map(),
      rerankerApplied: false,
      durationMs: 0,
    });
    const searchSpy = vi.fn().mockReturnValue([
      { entry: { value: "fts fallback fact" }, score: 0.5 },
    ]);
    const store = makeMockStore({
      temprSearch: temprSpy as unknown as MemoryStore["temprSearch"],
      search: searchSpy as unknown as MemoryStore["search"],
    });
    const engine = new ActiveMemoryEngine(store);

    const result = await engine.preprocessAsync(
      "what did I decide?",
      "session-1",
      { useTempr: true },
    );

    expect(temprSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalled();
    expect(result.contextPrefix).toContain("fts fallback fact");
    // TEMPR label absent when empty → fell back.
    expect(result.contextPrefix).not.toContain("TEMPR");
  });

  it("falls back to FTS when TEMPR throws", async () => {
    const temprSpy = vi.fn().mockRejectedValue(new Error("TEMPR crashed"));
    const searchSpy = vi.fn().mockReturnValue([
      { entry: { value: "fts recovery fact" } },
    ]);
    const store = makeMockStore({
      temprSearch: temprSpy as unknown as MemoryStore["temprSearch"],
      search: searchSpy as unknown as MemoryStore["search"],
    });
    const engine = new ActiveMemoryEngine(store);

    const result = await engine.preprocessAsync(
      "what did I decide?",
      "session-1",
      { useTempr: true },
    );

    expect(temprSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalled();
    expect(result.contextPrefix).toContain("fts recovery fact");
  });

  // ── M6 retrieval-mode path ──────────────────────────────

  it("routes through searchWithMode when opts.recallMode is set", async () => {
    const modeSpy = vi.fn().mockResolvedValue({
      mode: "time-decay",
      results: [
        {
          id: "e2",
          content: "time-decay hit",
          score: 0.8,
        },
      ],
      scoring: { method: "exp-decay", isHeuristic: false },
    });
    const searchSpy = vi.fn().mockReturnValue([]);
    const store = makeMockStore({
      searchWithMode: modeSpy as unknown as MemoryStore["searchWithMode"],
      search: searchSpy as unknown as MemoryStore["search"],
    });
    const engine = new ActiveMemoryEngine(store);

    const result = await engine.preprocessAsync(
      "what did I last do?",
      "session-1",
      { recallMode: "time-decay" },
    );

    expect(modeSpy).toHaveBeenCalledTimes(1);
    expect(modeSpy).toHaveBeenCalledWith("time-decay", expect.any(String), { limit: 3 });
    expect(result.contextPrefix).toContain("time-decay");
    expect(result.contextPrefix).toContain("time-decay hit");
    // FTS NOT called — mode returned results.
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("falls back to FTS when the requested mode is unknown", async () => {
    const modeSpy = vi.fn().mockResolvedValue({
      mode: "unknown-mode",
      results: [],
      scoring: { method: "unknown-mode", isHeuristic: true },
    });
    const searchSpy = vi.fn().mockReturnValue([
      { entry: { value: "fts fallback" } },
    ]);
    const store = makeMockStore({
      searchWithMode: modeSpy as unknown as MemoryStore["searchWithMode"],
      search: searchSpy as unknown as MemoryStore["search"],
    });
    const engine = new ActiveMemoryEngine(store);

    const result = await engine.preprocessAsync(
      "what happened to the database migration?",
      "session-1",
      { recallMode: "unknown-mode" },
    );

    expect(modeSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalled();
    expect(result.contextPrefix).toContain("fts fallback");
  });

  // ── default FTS path ────────────────────────────────────

  it("uses plain FTS when no recall options are set", async () => {
    const temprSpy = vi.fn();
    const modeSpy = vi.fn();
    const searchSpy = vi.fn().mockReturnValue([
      { entry: { value: "plain fts" } },
    ]);
    const store = makeMockStore({
      temprSearch: temprSpy as unknown as MemoryStore["temprSearch"],
      searchWithMode: modeSpy as unknown as MemoryStore["searchWithMode"],
      search: searchSpy as unknown as MemoryStore["search"],
    });
    const engine = new ActiveMemoryEngine(store);

    const result = await engine.preprocessAsync(
      "which provider handles streaming?",
      "session-1",
      {},
    );

    expect(temprSpy).not.toHaveBeenCalled();
    expect(modeSpy).not.toHaveBeenCalled();
    expect(searchSpy).toHaveBeenCalled();
    expect(result.contextPrefix).toContain("plain fts");
  });

  it("sync preprocess() continues to use FTS only (no regression)", () => {
    const temprSpy = vi.fn();
    const modeSpy = vi.fn();
    const searchSpy = vi.fn().mockReturnValue([]);
    const store = makeMockStore({
      temprSearch: temprSpy as unknown as MemoryStore["temprSearch"],
      searchWithMode: modeSpy as unknown as MemoryStore["searchWithMode"],
      search: searchSpy as unknown as MemoryStore["search"],
    });
    const engine = new ActiveMemoryEngine(store);

    engine.preprocess("what about streaming providers?", "session-1");
    expect(temprSpy).not.toHaveBeenCalled();
    expect(modeSpy).not.toHaveBeenCalled();
    // FTS called by the question classifier path.
    expect(searchSpy).toHaveBeenCalled();
  });

  it("preprocessAsync without question-class skips recall entirely", async () => {
    const temprSpy = vi.fn();
    const modeSpy = vi.fn();
    const searchSpy = vi.fn();
    const store = makeMockStore({
      temprSearch: temprSpy as unknown as MemoryStore["temprSearch"],
      searchWithMode: modeSpy as unknown as MemoryStore["searchWithMode"],
      search: searchSpy as unknown as MemoryStore["search"],
    });
    const engine = new ActiveMemoryEngine(store);

    // Statement, not a question → no recall fires.
    const result = await engine.preprocessAsync(
      "the sky is blue.",
      "session-1",
      { useTempr: true },
    );
    expect(temprSpy).not.toHaveBeenCalled();
    expect(modeSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(result.contextPrefix).toBeNull();
  });
});
