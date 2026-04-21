import { describe, it, expect } from "vitest";
import { authorityWeight } from "../../../src/memory/retrieval-modes/authority-weight.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  { id: "v1", content: "verified answer about auth", metadata: { verified: true, confidenceLevel: 5 } },
  { id: "u1", content: "unverified answer about auth", metadata: { verified: false, confidenceLevel: 1 } },
  { id: "u2", content: "another unverified note about auth", metadata: { verified: false, confidenceLevel: 0 } },
];

describe("authority-weight mode", () => {
  it("ranks verified entries above unverified", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await authorityWeight.search(ctx, "auth");
    const ids = r.results.map((h) => h.id);
    expect(ids[0]).toBe("v1");
  });

  it("higher confidenceLevel → higher score (unverified tied)", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await authorityWeight.search(ctx, "auth");
    const u1 = r.results.find((h) => h.id === "u1")?.score ?? 0;
    const u2 = r.results.find((h) => h.id === "u2")?.score ?? 0;
    expect(u1).toBeGreaterThan(u2);
  });

  it("caller can tune verifiedBonus to disable the boost", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await authorityWeight.search(ctx, "auth", {
      params: { verifiedBonus: 0, confidenceBoost: 0 },
    });
    const scores = r.results.map((h) => h.score);
    expect(scores.every((s) => s === scores[0])).toBe(true);
  });

  it("drops entries that don't match query", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await authorityWeight.search(ctx, "non-existent-word");
    expect(r.results).toEqual([]);
  });
});
