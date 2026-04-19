/**
 * Phase H Task 7 — progressive context loader L0/L1/L2/L3.
 *
 * Verifies tier budgets, adapter wiring, room caching, and the
 * PrepareContext wake-up util.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUDGETS,
  PrepareContext,
  ProgressiveContextLoader,
  estimateTokens,
} from "../../src/memory/progressive-context-loader.js";

describe("estimateTokens", () => {
  it("approximates 4 chars per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("ProgressiveContextLoader — L0 identity", () => {
  it("returns empty honest-source payload when no adapter", () => {
    const loader = new ProgressiveContextLoader();
    const l0 = loader.loadL0();
    expect(l0.tier).toBe("L0");
    expect(l0.content).toBe("");
    expect(l0.tokenEstimate).toBe(0);
    expect(l0.source).toBe("no-identity-adapter");
  });

  it("composes identity line + core personality", () => {
    const loader = new ProgressiveContextLoader({
      identity: {
        getIdentityLine: () => "I am WOTANN, an agent harness.",
        getCorePersonality: () => "Curious, relentless, honest.",
      },
    });
    const l0 = loader.loadL0();
    expect(l0.content).toContain("WOTANN");
    expect(l0.content).toContain("Curious");
  });

  it("truncates to L0 budget", () => {
    const longLine = "x".repeat(1000);
    const loader = new ProgressiveContextLoader(
      {
        identity: {
          getIdentityLine: () => longLine,
          getCorePersonality: () => longLine,
        },
      },
      { l0: 20 }, // tight budget
    );
    const l0 = loader.loadL0();
    expect(l0.tokenEstimate).toBeLessThanOrEqual(21); // budget + truncation rounding
  });
});

describe("ProgressiveContextLoader — L1 facts", () => {
  it("returns empty honest-source when no adapter", () => {
    const loader = new ProgressiveContextLoader();
    expect(loader.loadL1().source).toBe("no-facts-adapter");
  });

  it("packs facts up to budget, stops at overflow", () => {
    const loader = new ProgressiveContextLoader(
      {
        facts: {
          topFacts: () =>
            Array.from({ length: 20 }, (_, i) => `fact-${i}: lorem ipsum dolor sit amet`),
        },
      },
      { l1: 30 }, // tight budget
    );
    const l1 = loader.loadL1();
    expect(l1.tokenEstimate).toBeLessThanOrEqual(30);
    expect(l1.content.length).toBeGreaterThan(0);
  });

  it("includes all facts when under budget", () => {
    const loader = new ProgressiveContextLoader({
      facts: {
        topFacts: () => ["fact-a", "fact-b"],
      },
    });
    const l1 = loader.loadL1();
    expect(l1.content).toContain("fact-a");
    expect(l1.content).toContain("fact-b");
  });
});

describe("ProgressiveContextLoader — L2 room recall", () => {
  it("returns [] when no recall adapter", () => {
    const loader = new ProgressiveContextLoader();
    expect(loader.loadL2("q", { wing: "w" })).toEqual([]);
  });

  it("loads room-scoped recall via adapter and labels source", () => {
    const loader = new ProgressiveContextLoader({
      recall: {
        recall: (query, partition) => [
          { key: `${partition.wing}/${partition.room}/${partition.hall}/${query}`, value: "body" },
        ],
      },
    });
    const results = loader.loadL2("auth", { wing: "w", room: "r", hall: "facts" });
    expect(results).toHaveLength(1);
    expect(results[0]!.source).toContain("wing:w");
    expect(results[0]!.source).toContain("room:r");
    expect(results[0]!.source).toContain("hall:facts");
  });

  it("stops at maxTokens budget", () => {
    const loader = new ProgressiveContextLoader({
      recall: {
        recall: () =>
          Array.from({ length: 50 }, (_, i) => ({
            key: `k${i}`,
            value: "x".repeat(200),
          })),
      },
    });
    const results = loader.loadL2("q", { wing: "w" }, 50);
    const totalTokens = results.reduce((acc, r) => acc + r.tokenEstimate, 0);
    expect(totalTokens).toBeLessThanOrEqual(50);
  });

  it("caches loaded rooms (isRoomLoaded)", () => {
    const loader = new ProgressiveContextLoader({
      recall: {
        recall: () => [],
      },
    });
    expect(loader.isRoomLoaded("w", "r", "facts")).toBe(false);
    loader.loadL2("q", { wing: "w", room: "r", hall: "facts" });
    expect(loader.isRoomLoaded("w", "r", "facts")).toBe(true);
  });

  it("resetLoadedRooms clears cache", () => {
    const loader = new ProgressiveContextLoader({ recall: { recall: () => [] } });
    loader.loadL2("q", { wing: "w" });
    loader.resetLoadedRooms();
    expect(loader.isRoomLoaded("w")).toBe(false);
  });
});

describe("ProgressiveContextLoader — L3 deep search", () => {
  it("returns [] when no adapter", () => {
    const loader = new ProgressiveContextLoader();
    expect(loader.loadL3("q")).toEqual([]);
  });

  it("fetches results from deepSearch adapter", () => {
    const loader = new ProgressiveContextLoader({
      deepSearch: {
        search: (query) => [{ key: `result-for-${query}`, value: "v" }],
      },
    });
    const results = loader.loadL3("auth");
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain("auth");
    expect(results[0]!.source).toContain("deep-search");
  });
});

describe("PrepareContext — runtime-init util", () => {
  it("builds a loader and eagerly loads L0+L1", () => {
    const prepared = PrepareContext({
      adapters: {
        identity: {
          getIdentityLine: () => "I am WOTANN.",
          getCorePersonality: () => "Curious.",
        },
        facts: {
          topFacts: () => ["user: prefers immutability", "project: wotann"],
        },
      },
    });
    expect(prepared.l0.content).toContain("WOTANN");
    expect(prepared.l1.content).toContain("immutability");
    expect(prepared.combinedPrompt).toContain("WOTANN");
    expect(prepared.combinedPrompt).toContain("immutability");
    expect(prepared.totalTokens).toBe(prepared.l0.tokenEstimate + prepared.l1.tokenEstimate);
    expect(prepared.loader).toBeInstanceOf(ProgressiveContextLoader);
  });

  it("returns empty combinedPrompt when no adapters", () => {
    const prepared = PrepareContext({ adapters: {} });
    expect(prepared.combinedPrompt).toBe("");
    expect(prepared.totalTokens).toBe(0);
  });

  it("respects custom budgets", () => {
    const prepared = PrepareContext({
      adapters: {
        facts: {
          topFacts: () => Array.from({ length: 30 }, () => "lorem ipsum dolor sit amet"),
        },
      },
      budgets: { l1: 20 },
    });
    expect(prepared.l1.tokenEstimate).toBeLessThanOrEqual(20);
  });
});

describe("DEFAULT_BUDGETS", () => {
  it("matches the MemPalace wake-up budget (<=200 tokens L0+L1)", () => {
    expect(DEFAULT_BUDGETS.l0).toBeLessThan(100);
    expect(DEFAULT_BUDGETS.l1).toBeLessThan(200);
    expect(DEFAULT_BUDGETS.l0 + DEFAULT_BUDGETS.l1).toBeLessThanOrEqual(200);
  });
});
