import { describe, it, expect } from "vitest";
import { crossSessionBridge } from "../../../src/memory/retrieval-modes/cross-session-bridge.js";
import type { RetrievalContext } from "../../../src/memory/retrieval-modes/types.js";
import type { SearchableEntry } from "../../../src/memory/extended-search-types.js";

const entries: SearchableEntry[] = [
  { id: "s1-a", content: "session-one fact about retry", metadata: { sessionId: "s1" } },
  { id: "s1-b", content: "session-one fact about auth", metadata: { sessionId: "s1" } },
  { id: "s2-a", content: "session-two fact about retry", metadata: { sessionId: "s2" } },
  { id: "s3-a", content: "session-three fact about retry", metadata: { sessionId: "s3" } },
  { id: "orphan", content: "no session id", metadata: {} },
];

describe("cross-session-bridge mode", () => {
  it("merges hits across multiple sessions", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await crossSessionBridge.search(ctx, "retry", {
      params: { sessionIds: ["s1", "s2", "s3"] },
      limit: 10,
    });
    const ids = r.results.map((h) => h.id);
    expect(ids).toContain("s1-a");
    expect(ids).toContain("s2-a");
    expect(ids).toContain("s3-a");
  });

  it("excludes entries from sessions not in list", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await crossSessionBridge.search(ctx, "retry", {
      params: { sessionIds: ["s1"] },
      limit: 10,
    });
    const ids = r.results.map((h) => h.id);
    expect(ids).not.toContain("s2-a");
    expect(ids).not.toContain("s3-a");
  });

  it("honest-fails with empty sessionIds", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await crossSessionBridge.search(ctx, "retry", {
      params: { sessionIds: [] },
    });
    expect(r.results).toEqual([]);
    expect(r.scoring.isHeuristic).toBe(true);
  });

  it("ignores entries without sessionId metadata", async () => {
    const ctx: RetrievalContext = { entries };
    const r = await crossSessionBridge.search(ctx, "no session", {
      params: { sessionIds: ["s1", "s2", "s3"] },
    });
    const ids = r.results.map((h) => h.id);
    expect(ids).not.toContain("orphan");
  });
});
