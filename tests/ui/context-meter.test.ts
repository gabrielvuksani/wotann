/**
 * C9 — context meter tests.
 */

import { describe, it, expect } from "vitest";
import {
  applyDelta,
  buildReading,
  emptyBudget,
  renderBreakdown,
  renderRadialAscii,
  type ContextBudget,
} from "../../src/ui/context-meter.js";

function mkBudget(overrides: Partial<ContextBudget> = {}): ContextBudget {
  return {
    usedTokens: 12_000,
    limit: 200_000,
    categories: {
      system: 2_000,
      memory: 1_500,
      docs: 500,
      tools: 3_000,
      conversation: 4_500,
      other: 500,
    },
    ...overrides,
  };
}

describe("buildReading", () => {
  it("computes percent and remainingTokens", () => {
    const r = buildReading(mkBudget({ usedTokens: 50_000, limit: 200_000 }));
    expect(r.percent).toBe(25);
    expect(r.remainingTokens).toBe(150_000);
  });

  it("clamps percent at 100 when over budget", () => {
    const r = buildReading(mkBudget({ usedTokens: 250_000, limit: 200_000 }));
    expect(r.percent).toBe(100);
    expect(r.remainingTokens).toBe(0);
  });

  it("returns severity=critical at 88%+", () => {
    const r = buildReading(mkBudget({ usedTokens: 180_000, limit: 200_000 }));
    expect(r.severity).toBe("critical");
  });

  it("returns severity=warn at 70–87%", () => {
    const r = buildReading(mkBudget({ usedTokens: 150_000, limit: 200_000 }));
    expect(r.severity).toBe("warn");
  });

  it("returns severity=ok below 70%", () => {
    const r = buildReading(mkBudget({ usedTokens: 50_000, limit: 200_000 }));
    expect(r.severity).toBe("ok");
  });

  it("identifies the largest category", () => {
    const r = buildReading(mkBudget());
    expect(r.mostExpensiveCategory).toBe("conversation");
  });

  it("drops zero-token slices", () => {
    const r = buildReading(
      mkBudget({
        categories: {
          system: 0,
          memory: 1000,
          docs: 0,
          tools: 0,
          conversation: 2000,
          other: 0,
        },
        usedTokens: 3000,
      }),
    );
    expect(r.slices.map((s) => s.category)).toEqual(["memory", "conversation"]);
  });

  it("handles zero-use budget without divide-by-zero", () => {
    const r = buildReading(emptyBudget(200_000));
    expect(r.percent).toBe(0);
    expect(r.remainingTokens).toBe(200_000);
    expect(r.severity).toBe("ok");
    expect(r.mostExpensiveCategory).toBeUndefined();
  });

  it("treats limit=0 gracefully (snaps to 1 to avoid NaN)", () => {
    const r = buildReading({ usedTokens: 100, limit: 0, categories: emptyBudget(1).categories });
    expect(r.percent).toBe(100);
  });
});

describe("renderRadialAscii", () => {
  it("renders 12 dots and percent", () => {
    const r = buildReading(mkBudget({ usedTokens: 100_000, limit: 200_000 }));
    const out = renderRadialAscii(r);
    expect(out).toMatch(/⧖/);
    expect(out).toMatch(/50%/);
    expect(out).toContain("●");
    expect(out).toContain("○");
  });

  it("adds !! marker on critical", () => {
    const r = buildReading(mkBudget({ usedTokens: 190_000, limit: 200_000 }));
    const out = renderRadialAscii(r);
    expect(out).toContain("!!");
  });

  it("omits marker on ok severity", () => {
    const r = buildReading(mkBudget({ usedTokens: 10_000, limit: 200_000 }));
    const out = renderRadialAscii(r);
    expect(out).not.toContain("!");
  });
});

describe("renderBreakdown", () => {
  it("lists categories sorted by fixed order", () => {
    const r = buildReading(mkBudget());
    const out = renderBreakdown(r);
    expect(out).toMatch(/system/);
    expect(out).toMatch(/conversation/);
    expect(out).toMatch(/tools/);
  });

  it("handles empty slices", () => {
    const r = buildReading(emptyBudget(200_000));
    const out = renderBreakdown(r);
    expect(out).toMatch(/no category data/);
  });
});

describe("applyDelta", () => {
  it("accumulates category tokens and usedTokens", () => {
    const b1 = applyDelta(emptyBudget(200_000), { system: 100, conversation: 200 });
    expect(b1.usedTokens).toBe(300);
    expect(b1.categories.system).toBe(100);
    expect(b1.categories.conversation).toBe(200);
  });

  it("ignores zero / undefined deltas", () => {
    const b1 = applyDelta(emptyBudget(200_000), { system: 100, conversation: 0 });
    expect(b1.usedTokens).toBe(100);
    expect(b1.categories.conversation).toBe(0);
  });

  it("applies successive deltas cumulatively", () => {
    let b: ContextBudget = emptyBudget(200_000);
    b = applyDelta(b, { system: 500 });
    b = applyDelta(b, { conversation: 1200 });
    b = applyDelta(b, { tools: 300 });
    expect(b.usedTokens).toBe(2000);
    expect(b.categories.system).toBe(500);
    expect(b.categories.tools).toBe(300);
  });
});
