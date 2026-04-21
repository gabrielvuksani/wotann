import { describe, it, expect } from "vitest";
import { timeDecay } from "../../../src/memory/retrieval-modes/time-decay.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const DAY = 86_400_000;
const now = new Date("2026-04-20T12:00:00.000Z").getTime();

const entries: SearchableEntry[] = [
  { id: "today", content: "recent post about auth", timestamp: now - 1 * DAY },
  { id: "week", content: "week-old post about auth", timestamp: now - 7 * DAY },
  { id: "month", content: "month-old post about auth", timestamp: now - 30 * DAY },
  { id: "other", content: "unrelated subject", timestamp: now },
];

describe("time-decay mode", () => {
  it("ranks recent entries above older ones at default halflife=7d", async () => {
    const ctx: RetrievalContext = { entries, now: new Date(now).toISOString() };
    const r = await timeDecay.search(ctx, "auth", { limit: 10 });
    const ids = r.results.map((h) => h.id);
    const iToday = ids.indexOf("today");
    const iMonth = ids.indexOf("month");
    expect(iToday).toBeGreaterThanOrEqual(0);
    expect(iMonth).toBeGreaterThanOrEqual(0);
    expect(iToday).toBeLessThan(iMonth);
  });

  it("shorter halflife amplifies recency effect", async () => {
    const ctx: RetrievalContext = { entries, now: new Date(now).toISOString() };
    const r1 = await timeDecay.search(ctx, "auth", { params: { halflifeDays: 1 } });
    const r7 = await timeDecay.search(ctx, "auth", { params: { halflifeDays: 7 } });
    const todayScore1 = r1.results.find((h) => h.id === "today")?.score ?? 0;
    const monthScore1 = r1.results.find((h) => h.id === "month")?.score ?? 0;
    const todayScore7 = r7.results.find((h) => h.id === "today")?.score ?? 0;
    const monthScore7 = r7.results.find((h) => h.id === "month")?.score ?? 0;
    // Ratio of today:month should be much greater at halflife=1 vs halflife=7
    const ratio1 = monthScore1 > 0 ? todayScore1 / monthScore1 : Infinity;
    const ratio7 = monthScore7 > 0 ? todayScore7 / monthScore7 : Infinity;
    expect(ratio1).toBeGreaterThan(ratio7);
  });

  it("drops entries without timestamp (decay=0)", async () => {
    const noTsEntries: SearchableEntry[] = [
      { id: "x", content: "auth note with no timestamp" },
    ];
    const ctx: RetrievalContext = { entries: noTsEntries, now: new Date(now).toISOString() };
    const r = await timeDecay.search(ctx, "auth");
    expect(r.results).toEqual([]);
  });
});
