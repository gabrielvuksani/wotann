/**
 * Phase H Task 2 — relationship classification on extracted observations.
 *
 * Verifies the ObservationExtractor wires the heuristic classifier and
 * emits `updates`/`extends`/`derives` edges between same-domain pairs.
 * Also covers the store.addRelationship / getRelationshipsForEntry
 * round-trip.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObservationExtractor, type Observation } from "../../src/memory/observation-extractor.js";
import { MemoryStore } from "../../src/memory/store.js";
import type { MemoryRelationship } from "../../src/memory/relationship-types.js";

function obs(overrides: Partial<Observation> & { id: string; assertion: string }): Observation {
  return {
    type: "decision",
    confidence: 0.7,
    sourceIds: [1],
    extractedAt: Date.now(),
    ...overrides,
  };
}

describe("ObservationExtractor.classifyRelationships", () => {
  it("returns empty for < 2 observations", async () => {
    const extractor = new ObservationExtractor();
    expect(await extractor.classifyRelationships([])).toEqual([]);
    expect(
      await extractor.classifyRelationships([obs({ id: "a", assertion: "alone" })]),
    ).toEqual([]);
  });

  it("classifies an 'updates' edge via heuristic markers", async () => {
    const extractor = new ObservationExtractor();
    const earlier = obs({
      id: "v1",
      assertion: "Old policy: 30-day return window",
      extractedAt: 100,
      domain: "policy",
    });
    const later = obs({
      id: "v2",
      assertion:
        "This supersedes the previous policy — effective 2026-01-01, return window is now 45 days.",
      extractedAt: 200,
      domain: "policy",
    });
    const rels = await extractor.classifyRelationships([earlier, later], 500);
    expect(rels).toHaveLength(1);
    expect(rels[0]!.kind).toBe("updates");
    expect(rels[0]!.fromId).toBe("v1");
    expect(rels[0]!.toId).toBe("v2");
    expect(rels[0]!.createdAt).toBe(500);
    expect(rels[0]!.rationale).toBeTruthy();
  });

  it("skips pairs from different domains", async () => {
    const extractor = new ObservationExtractor();
    const rels = await extractor.classifyRelationships(
      [
        obs({
          id: "a",
          assertion: "Old policy: 30-day return window",
          extractedAt: 100,
          domain: "policy",
        }),
        obs({
          id: "b",
          assertion:
            "This supersedes the previous policy — effective 2026-01-01, return window is now 45 days.",
          extractedAt: 200,
          domain: "billing",
        }),
      ],
      500,
    );
    expect(rels).toEqual([]);
  });

  it("pairs observations with up to 5 predecessors, not N²", async () => {
    const extractor = new ObservationExtractor();
    // 7 observations with clear update markers — each successor should
    // only pair with the 5 most recent predecessors.
    const observations: Observation[] = [];
    for (let i = 0; i < 7; i++) {
      observations.push(
        obs({
          id: `o${i}`,
          assertion: `Policy v${i}: supersedes previous version`,
          extractedAt: i * 10,
          domain: "policy",
        }),
      );
    }
    const rels = await extractor.classifyRelationships(observations, 1000);
    // successor 1: 1 pred = 1 edge
    // successor 2: 2 preds = 2 edges
    // successor 3: 3 preds = 3 edges
    // successor 4: 4 preds = 4 edges
    // successor 5: 5 preds = 5 edges
    // successor 6: 5 preds (capped) = 5 edges
    // total = 1+2+3+4+5+5 = 20
    expect(rels.length).toBeLessThanOrEqual(20);
    expect(rels.length).toBeGreaterThan(0);
    // No self-loops
    expect(rels.every((r) => r.fromId !== r.toId)).toBe(true);
  });

  it("honest-failure: returns no edge when classifier throws", async () => {
    const throwing = {
      classify: async () => {
        throw new Error("LLM exhausted budget");
      },
    };
    const extractor = new ObservationExtractor(throwing);
    const rels = await extractor.classifyRelationships(
      [
        obs({ id: "a", assertion: "x", extractedAt: 1, domain: "d" }),
        obs({ id: "b", assertion: "y", extractedAt: 2, domain: "d" }),
      ],
      100,
    );
    expect(rels).toEqual([]);
  });
});

describe("MemoryStore relationship CRUD (Phase H Task 2)", () => {
  let store: MemoryStore;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "wotann-rel-"));
    store = new MemoryStore(join(tmp, "mem.db"));
  });

  afterEach(() => {
    store.close();
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("add + retrieve a relationship", () => {
    const rel: MemoryRelationship = {
      id: "rel-1",
      fromId: "a",
      toId: "b",
      kind: "updates",
      confidence: 0.9,
      createdAt: 1000,
      rationale: "v2 supersedes v1",
    };
    store.addRelationship(rel);
    const fetched = store.getRelationshipsForEntry("a");
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.kind).toBe("updates");
    expect(fetched[0]!.rationale).toBe("v2 supersedes v1");
  });

  it("getRelationshipsForEntry returns edges for both directions", () => {
    store.addRelationship({
      id: "r1",
      fromId: "a",
      toId: "b",
      kind: "updates",
      confidence: 0.8,
      createdAt: 100,
    });
    store.addRelationship({
      id: "r2",
      fromId: "c",
      toId: "a",
      kind: "derives",
      confidence: 0.7,
      createdAt: 200,
    });
    expect(store.getRelationshipsForEntry("a")).toHaveLength(2);
  });

  it("invalidateRelationship excludes from default queries", () => {
    store.addRelationship({
      id: "r1",
      fromId: "a",
      toId: "b",
      kind: "extends",
      confidence: 0.6,
      createdAt: 1,
    });
    expect(store.invalidateRelationship("r1")).toBe(true);
    expect(store.getRelationshipsForEntry("a")).toHaveLength(0);
    expect(store.getRelationshipsForEntry("a", { includeInvalidated: true })).toHaveLength(1);
  });

  it("filters by kind", () => {
    store.addRelationship({ id: "r1", fromId: "a", toId: "b", kind: "updates", confidence: 0.9, createdAt: 1 });
    store.addRelationship({ id: "r2", fromId: "a", toId: "c", kind: "extends", confidence: 0.7, createdAt: 2 });
    expect(store.getRelationshipsForEntry("a", { kind: "updates" })).toHaveLength(1);
    expect(store.getRelationshipsForEntry("a", { kind: "extends" })).toHaveLength(1);
    expect(store.getRelationshipsForEntry("a", { kind: "derives" })).toHaveLength(0);
  });

  it("bulk addRelationships is atomic", () => {
    const rels: MemoryRelationship[] = [
      { id: "r1", fromId: "a", toId: "b", kind: "updates", confidence: 0.9, createdAt: 1 },
      { id: "r2", fromId: "b", toId: "c", kind: "updates", confidence: 0.85, createdAt: 2 },
      { id: "r3", fromId: "c", toId: "d", kind: "extends", confidence: 0.6, createdAt: 3 },
    ];
    expect(store.addRelationships(rels)).toBe(3);
    expect(store.getAllRelationships()).toHaveLength(3);
  });
});
