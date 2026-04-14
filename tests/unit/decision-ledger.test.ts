import { describe, it, expect } from "vitest";
import { DecisionLedger } from "../../src/learning/decision-ledger.js";

describe("DecisionLedger", () => {
  const sampleDecision = {
    title: "Use SQLite for memory storage",
    description: "Store all persistent memory in SQLite with FTS5.",
    rationale: "SQLite is embedded, zero-config, and supports full-text search.",
    alternatives: ["PostgreSQL", "Redis", "JSON files"],
    affectedFiles: ["src/memory/store.ts", "src/memory/schema.ts"],
    tags: ["architecture", "storage", "memory"],
  };

  describe("recordDecision", () => {
    it("records a decision and returns an ID", () => {
      const ledger = new DecisionLedger();
      const id = ledger.recordDecision(sampleDecision);

      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
      expect(ledger.getCount()).toBe(1);
    });

    it("assigns active status to new decisions", () => {
      const ledger = new DecisionLedger();
      const id = ledger.recordDecision(sampleDecision);
      const decision = ledger.getDecision(id);

      expect(decision?.status).toBe("active");
    });

    it("assigns a timestamp", () => {
      const ledger = new DecisionLedger();
      const id = ledger.recordDecision(sampleDecision);
      const decision = ledger.getDecision(id);

      expect(decision?.timestamp).toBeTruthy();
      // Should be a valid ISO date
      expect(new Date(decision!.timestamp).getTime()).toBeGreaterThan(0);
    });

    it("generates unique IDs", () => {
      const ledger = new DecisionLedger();
      const id1 = ledger.recordDecision(sampleDecision);
      const id2 = ledger.recordDecision(sampleDecision);

      expect(id1).not.toBe(id2);
    });
  });

  describe("searchDecisions", () => {
    it("finds decisions by title keyword", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);
      ledger.recordDecision({
        title: "Use Redis for caching",
        description: "Cache frequently accessed data in Redis.",
        rationale: "Redis is fast and supports TTL expiry natively.",
        alternatives: ["Memcached", "In-memory Map"],
        affectedFiles: ["src/cache/redis.ts"],
        tags: ["caching"],
      });

      const results = ledger.searchDecisions("SQLite");
      expect(results.length).toBe(1);
      expect(results[0]?.title).toContain("SQLite");
    });

    it("finds decisions by tag", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);

      const results = ledger.searchDecisions("architecture");
      expect(results.length).toBe(1);
    });

    it("finds decisions by rationale content", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);

      const results = ledger.searchDecisions("full-text search");
      expect(results.length).toBe(1);
    });

    it("returns empty for unmatched query", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);

      const results = ledger.searchDecisions("kubernetes");
      expect(results.length).toBe(0);
    });

    it("returns all decisions for empty query", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);
      ledger.recordDecision({
        ...sampleDecision,
        title: "Another decision",
      });

      const results = ledger.searchDecisions("");
      expect(results.length).toBe(2);
    });
  });

  describe("getDecisionsForFile", () => {
    it("finds decisions affecting a specific file", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);
      ledger.recordDecision({
        ...sampleDecision,
        title: "Unrelated",
        affectedFiles: ["src/other/file.ts"],
      });

      const results = ledger.getDecisionsForFile("src/memory/store.ts");
      expect(results.length).toBe(1);
    });

    it("normalizes backslashes in paths", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);

      const results = ledger.getDecisionsForFile("src\\memory\\store.ts");
      expect(results.length).toBe(1);
    });

    it("matches partial paths", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);

      const results = ledger.getDecisionsForFile("memory/store.ts");
      expect(results.length).toBe(1);
    });
  });

  describe("supersedeDecision", () => {
    it("marks a decision as superseded", () => {
      const ledger = new DecisionLedger();
      const oldId = ledger.recordDecision(sampleDecision);
      const newId = ledger.recordDecision({
        ...sampleDecision,
        title: "Switch to PostgreSQL",
      });

      const result = ledger.supersedeDecision(oldId, newId);
      expect(result).toBe(true);

      const old = ledger.getDecision(oldId);
      expect(old?.status).toBe("superseded");
      expect(old?.supersededBy).toBe(newId);
    });

    it("returns false for non-existent decision", () => {
      const ledger = new DecisionLedger();
      const result = ledger.supersedeDecision("fake-id", "other-id");
      expect(result).toBe(false);
    });
  });

  describe("revertDecision", () => {
    it("marks a decision as reverted", () => {
      const ledger = new DecisionLedger();
      const id = ledger.recordDecision(sampleDecision);

      const result = ledger.revertDecision(id);
      expect(result).toBe(true);

      const decision = ledger.getDecision(id);
      expect(decision?.status).toBe("reverted");
    });
  });

  describe("getCountByStatus", () => {
    it("counts decisions by status", () => {
      const ledger = new DecisionLedger();
      const id1 = ledger.recordDecision(sampleDecision);
      ledger.recordDecision(sampleDecision);
      const id3 = ledger.recordDecision(sampleDecision);

      ledger.revertDecision(id1);
      ledger.supersedeDecision(id3, id1);

      const counts = ledger.getCountByStatus();
      expect(counts.active).toBe(1);
      expect(counts.reverted).toBe(1);
      expect(counts.superseded).toBe(1);
    });
  });

  describe("exportMarkdown", () => {
    it("exports decisions as markdown", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);

      const md = ledger.exportMarkdown();
      expect(md).toContain("# Decision Ledger");
      expect(md).toContain("[ACTIVE]");
      expect(md).toContain("SQLite");
      expect(md).toContain("**Rationale:**");
      expect(md).toContain("**Alternatives Considered:**");
    });

    it("exports empty message when no decisions", () => {
      const ledger = new DecisionLedger();
      const md = ledger.exportMarkdown();
      expect(md).toContain("No decisions recorded");
    });

    it("includes affected files list", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);

      const md = ledger.exportMarkdown();
      expect(md).toContain("src/memory/store.ts");
    });
  });

  describe("serialize / restore", () => {
    it("round-trips decisions through serialization", () => {
      const ledger = new DecisionLedger();
      ledger.recordDecision(sampleDecision);
      ledger.recordDecision({
        title: "Use Zod for validation",
        description: "All input validation uses Zod schemas.",
        rationale: "Zod integrates well with TypeScript inference.",
        alternatives: ["io-ts", "yup"],
        affectedFiles: ["src/core/validation.ts"],
        tags: ["validation"],
      });

      const serialized = ledger.serialize();

      const restored = new DecisionLedger();
      restored.restore(serialized);

      expect(restored.getCount()).toBe(2);
      expect(restored.searchDecisions("SQLite").length).toBe(1);
    });

    it("ignores invalid JSON on restore", () => {
      const ledger = new DecisionLedger();
      ledger.restore("not valid json {{");
      expect(ledger.getCount()).toBe(0);
    });
  });
});
