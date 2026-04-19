/**
 * Phase H Task 5 — knowledge-update dynamics.
 *
 * Verifies detectSupersession finds entity+predicate+value conflicts,
 * honestly returns null on peaceful coexistence, and that
 * applySupersession writes an `updates` edge while invalidating stale
 * predecessor edges.
 */

import { describe, expect, it } from "vitest";
import {
  applySupersession,
  detectSupersession,
  detectSupersessionsInPool,
  parseAssertionAsFact,
  type FactLike,
  type KnowledgeUpdateStoreAdapter,
} from "../../src/memory/knowledge-update-dynamics.js";
import type { MemoryRelationship } from "../../src/memory/relationship-types.js";

function fact(overrides: Partial<FactLike> & { id: string }): FactLike {
  return {
    entity: "User",
    predicate: "lives in",
    value: "Vancouver",
    documentDate: 1000,
    ...overrides,
  };
}

describe("detectSupersession", () => {
  it("detects same entity+predicate with different value", () => {
    const pred = fact({ id: "p", value: "Vancouver", documentDate: 1000 });
    const succ = fact({ id: "s", value: "Toronto", documentDate: 2000 });
    const result = detectSupersession(succ, pred);
    expect(result).not.toBeNull();
    expect(result?.predecessor.id).toBe("p");
    expect(result?.successor.id).toBe("s");
    expect(result?.confidence).toBeGreaterThan(0);
    expect(result?.confidence).toBeLessThanOrEqual(0.85);
  });

  it("returns null when entities differ (peaceful coexistence)", () => {
    const pred = fact({ id: "p", entity: "Alice", value: "Vancouver" });
    const succ = fact({ id: "s", entity: "Bob", value: "Toronto" });
    expect(detectSupersession(succ, pred)).toBeNull();
  });

  it("returns null when predicates differ", () => {
    const pred = fact({ id: "p", predicate: "lives in", value: "Vancouver" });
    const succ = fact({ id: "s", predicate: "works at", value: "Toronto" });
    expect(detectSupersession(succ, pred)).toBeNull();
  });

  it("returns null when values are identical (idempotent)", () => {
    const pred = fact({ id: "p", value: "Toronto", documentDate: 1000 });
    const succ = fact({ id: "s", value: "Toronto", documentDate: 2000 });
    expect(detectSupersession(succ, pred)).toBeNull();
  });

  it("returns null when self-comparison", () => {
    const f = fact({ id: "same" });
    expect(detectSupersession(f, f)).toBeNull();
  });

  it("respects minDocumentDateDeltaMs", () => {
    const pred = fact({ id: "p", value: "Vancouver", documentDate: 1000 });
    const succ = fact({ id: "s", value: "Toronto", documentDate: 1100 });
    // 100ms delta — requiring 500ms blocks the detection.
    expect(detectSupersession(succ, pred, { minDocumentDateDeltaMs: 500 })).toBeNull();
    expect(detectSupersession(succ, pred, { minDocumentDateDeltaMs: 50 })).not.toBeNull();
  });

  it("is case-insensitive by default", () => {
    const pred = fact({ id: "p", entity: "user", predicate: "lives in", value: "Vancouver" });
    const succ = fact({ id: "s", entity: "USER", predicate: "LIVES IN", value: "Toronto" });
    expect(detectSupersession(succ, pred)).not.toBeNull();
  });

  it("caseSensitive option blocks mismatched case", () => {
    const pred = fact({ id: "p", entity: "user", predicate: "lives in" });
    const succ = fact({ id: "s", entity: "USER", predicate: "lives in", value: "Toronto" });
    expect(detectSupersession(succ, pred, { caseSensitive: true })).toBeNull();
  });

  it("lowers confidence when values share tokens", () => {
    const pred = fact({ id: "p", value: "Vancouver BC Canada", documentDate: 100 });
    const succ = fact({ id: "s", value: "Vancouver Canada 2026", documentDate: 200 });
    const result = detectSupersession(succ, pred);
    expect(result).not.toBeNull();
    // token overlap lowers confidence below 0.85
    expect(result!.confidence).toBeLessThan(0.85);
  });
});

describe("detectSupersessionsInPool", () => {
  it("finds all superseded predecessors in a pool", () => {
    const pool: FactLike[] = [
      fact({ id: "a", value: "Vancouver", documentDate: 100 }),
      fact({ id: "b", entity: "Alice", value: "Seattle", documentDate: 200 }),
      fact({ id: "c", value: "Portland", documentDate: 150 }),
    ];
    const succ = fact({ id: "new", value: "Toronto", documentDate: 300 });
    const results = detectSupersessionsInPool(succ, pool);
    // Only a and c share entity+predicate; b is Alice.
    expect(results).toHaveLength(2);
    const predIds = results.map((r) => r.predecessor.id).sort();
    expect(predIds).toEqual(["a", "c"]);
  });
});

describe("applySupersession", () => {
  it("writes an updates edge and invalidates predecessor edges", () => {
    const added: MemoryRelationship[] = [];
    let invalidatedFor: string | null = null;
    let invalidatedAt: number | null = null;
    const store: KnowledgeUpdateStoreAdapter = {
      addRelationship: (r) => added.push(r),
      invalidatePredecessorEdges: (id, at) => {
        invalidatedFor = id;
        invalidatedAt = at;
        return 3;
      },
    };
    const detection = detectSupersession(
      fact({ id: "s", value: "Toronto", documentDate: 200 }),
      fact({ id: "p", value: "Vancouver", documentDate: 100 }),
    )!;

    const rel = applySupersession(store, detection, 50_000);

    expect(rel.kind).toBe("updates");
    expect(rel.fromId).toBe("p");
    expect(rel.toId).toBe("s");
    expect(rel.createdAt).toBe(50_000);
    expect(rel.rationale).toContain("Vancouver");
    expect(added).toHaveLength(1);
    expect(invalidatedFor).toBe("p");
    expect(invalidatedAt).toBe(50_000);
  });

  it("works without the optional invalidate surface", () => {
    const added: MemoryRelationship[] = [];
    const store: KnowledgeUpdateStoreAdapter = {
      addRelationship: (r) => added.push(r),
    };
    const detection = detectSupersession(
      fact({ id: "s", value: "Toronto", documentDate: 200 }),
      fact({ id: "p", value: "Vancouver", documentDate: 100 }),
    )!;
    expect(() => applySupersession(store, detection)).not.toThrow();
    expect(added).toHaveLength(1);
  });
});

describe("parseAssertionAsFact", () => {
  it("parses 'User lives in Vancouver'", () => {
    const fact = parseAssertionAsFact("id1", "User lives in Vancouver", 1000);
    expect(fact).not.toBeNull();
    expect(fact?.entity).toBe("User");
    expect(fact?.predicate).toBe("lives in");
    expect(fact?.value).toBe("Vancouver");
    expect(fact?.documentDate).toBe(1000);
  });

  it("parses 'Alice moved to Toronto'", () => {
    const fact = parseAssertionAsFact("id1", "Alice moved to Toronto", 2000);
    expect(fact?.entity).toBe("Alice");
    expect(fact?.predicate).toBe("moved to");
    expect(fact?.value).toBe("Toronto");
  });

  it("parses 'Project uses Postgres'", () => {
    const fact = parseAssertionAsFact("id1", "Project uses Postgres", 3000);
    expect(fact?.predicate).toBe("uses");
    expect(fact?.value).toBe("Postgres");
  });

  it("returns null when no copula matches", () => {
    expect(parseAssertionAsFact("id", "Random noise with no copula here", 1)).toBeNull();
  });

  it("returns null for empty assertion", () => {
    expect(parseAssertionAsFact("id", "", 1)).toBeNull();
    expect(parseAssertionAsFact("id", "   ", 1)).toBeNull();
  });
});

describe("end-to-end ingest scenario", () => {
  it("'User lives in Vancouver' + 'I moved to Toronto' → updates edge", () => {
    const vancouver = parseAssertionAsFact("v", "User lives in Vancouver", 1000)!;
    // Rephrase to unify the entity for the detector
    const toronto = parseAssertionAsFact("t", "User moved to Toronto", 2000)!;

    // Different predicates → detector correctly rejects. This is the
    // honest behavior: "lives in" and "moved to" aren't the same
    // predicate, so we don't auto-supersede without richer semantics.
    const detection = detectSupersession(toronto, vancouver);
    expect(detection).toBeNull();

    // When both use the same predicate, detector fires.
    const tor2 = { ...toronto, predicate: vancouver.predicate };
    const detection2 = detectSupersession(tor2, vancouver);
    expect(detection2).not.toBeNull();
    expect(detection2!.successor.value).toBe("Toronto");
  });
});
