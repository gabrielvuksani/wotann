import { describe, it, expect } from "vitest";
import { summaryFirst } from "../../../src/memory/retrieval-modes/summary-first.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";
import type { CompressionSummary } from "../../../src/memory/omega-layers.js";

const summaries: CompressionSummary[] = [
  {
    id: "s1",
    content: "Summary: discussed retrieval modes and cognee port",
    createdAt: "2026-04-20T10:00:00Z",
    sourceEventIds: [1, 2, 3],
    sourceEventCount: 3,
  },
  {
    id: "s2",
    content: "Summary: unrelated topic about deployment",
    createdAt: "2026-04-19T10:00:00Z",
    sourceEventIds: [4],
    sourceEventCount: 1,
  },
];

const entries: SearchableEntry[] = [
  { id: "f1", content: "fact about retrieval modes implementation" },
  { id: "f2", content: "fact about retrieval details" },
];

describe("summary-first mode", () => {
  it("prioritizes L3 summaries over L2 facts", async () => {
    const ctx: RetrievalContext = { entries, summaries };
    const r = await summaryFirst.search(ctx, "retrieval");
    expect(r.results[0]?.id).toBe("s1");
    expect(r.results[0]?.metadata?.["layer"]).toBe(3);
  });

  it("tops up from L2 facts when summaries insufficient", async () => {
    const ctx: RetrievalContext = { entries, summaries };
    const r = await summaryFirst.search(ctx, "retrieval", { limit: 5 });
    const ids = r.results.map((h) => h.id);
    expect(ids).toContain("s1");
    expect(ids.some((id) => id === "f1" || id === "f2")).toBe(true);
  });

  it("summariesOnly=true suppresses L2 fallthrough", async () => {
    const ctx: RetrievalContext = { entries, summaries };
    const r = await summaryFirst.search(ctx, "retrieval", {
      limit: 5,
      params: { summariesOnly: true },
    });
    const ids = r.results.map((h) => h.id);
    expect(ids).not.toContain("f1");
    expect(ids).not.toContain("f2");
  });

  it("is honest-heuristic when no summaries exist (L2-only fallthrough)", async () => {
    const ctx: RetrievalContext = { entries, summaries: [] };
    const r = await summaryFirst.search(ctx, "retrieval");
    expect(r.scoring.isHeuristic).toBe(true);
    expect(r.scoring.notes).toMatch(/no Layer-3/);
  });
});
