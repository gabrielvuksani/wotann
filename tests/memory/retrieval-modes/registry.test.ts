import { describe, it, expect } from "vitest";
import {
  createDefaultRetrievalRegistry,
  createRetrievalRegistry,
  DEFAULT_RETRIEVAL_MODE_NAMES,
  type RetrievalMode,
} from "../../../src/memory/retrieval-registry.js";

describe("RetrievalRegistry", () => {
  it("default registry has all 12 P1-M6 modes", () => {
    const reg = createDefaultRetrievalRegistry();
    const names = reg.list().map((m) => m.name);
    expect(names).toEqual([
      "graph-traversal",
      "temporal-window",
      "typed-entity",
      "fuzzy-match",
      "semantic-cluster",
      "path-based",
      "time-decay",
      "authority-weight",
      "summary-first",
      "ingest-time-travel",
      "fact-time-travel",
      "cross-session-bridge",
    ]);
    expect(DEFAULT_RETRIEVAL_MODE_NAMES).toHaveLength(12);
  });

  it("get returns null for unknown modes", () => {
    const reg = createDefaultRetrievalRegistry();
    expect(reg.get("does-not-exist")).toBeNull();
  });

  it("register + has + unregister round-trip works", () => {
    const reg = createDefaultRetrievalRegistry();
    const custom: RetrievalMode = {
      name: "custom-mode",
      description: "test",
      search: async () => ({
        mode: "custom-mode",
        results: [],
        scoring: { method: "noop" },
      }),
    };
    reg.register(custom);
    expect(reg.has("custom-mode")).toBe(true);
    expect(reg.get("custom-mode")?.name).toBe("custom-mode");
    expect(reg.unregister("custom-mode")).toBe(true);
    expect(reg.has("custom-mode")).toBe(false);
  });

  it("extra modes via createRetrievalRegistry are merged with defaults", () => {
    const custom: RetrievalMode = {
      name: "custom-x",
      description: "extra mode via ctor",
      search: async () => ({
        mode: "custom-x",
        results: [],
        scoring: { method: "noop" },
      }),
    };
    const reg = createRetrievalRegistry([custom]);
    expect(reg.list().length).toBe(DEFAULT_RETRIEVAL_MODE_NAMES.length + 1);
    expect(reg.has("custom-x")).toBe(true);
  });
});
