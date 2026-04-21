import { describe, it, expect } from "vitest";
import { typedEntity } from "../../../src/memory/retrieval-modes/typed-entity.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  {
    id: "person-1",
    content: "gabriel vuksani works in toronto",
    metadata: { entityType: "person" },
  },
  {
    id: "project-1",
    content: "wotann port of cognee retrieval modes",
    metadata: { entityType: "project" },
  },
  {
    id: "file-1",
    content: "src/memory/store.ts handles fts5 lookup",
    metadata: { entityType: "file" },
  },
  { id: "untyped-1", content: "no entity type tag here" },
];

describe("typed-entity mode", () => {
  it("filters by explicit entityType param", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await typedEntity.search(ctx, "anything", {
      params: { entityType: "person" },
    });
    expect(r.results.map((h) => h.id)).toEqual(["person-1"]);
    expect(r.scoring.isHeuristic).not.toBe(true);
  });

  it("guesses entity type from query keyword (who → person)", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await typedEntity.search(ctx, "who works in toronto");
    expect(r.results.map((h) => h.id)).toEqual(["person-1"]);
    expect(r.scoring.isHeuristic).toBe(true);
    expect(r.scoring.notes).toMatch(/guess/);
  });

  it("guesses entity type from file extension (.ts → file)", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await typedEntity.search(ctx, "look in the store.ts");
    expect(r.results.map((h) => h.id)).toContain("file-1");
    expect(r.scoring.isHeuristic).toBe(true);
  });

  it("returns empty with heuristic note when nothing can be guessed", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await typedEntity.search(ctx, "purely generic phrase");
    expect(r.results).toEqual([]);
    expect(r.scoring.isHeuristic).toBe(true);
  });
});
