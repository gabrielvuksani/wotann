/**
 * Phase 2 P1-M7: wire test — entity-types + relationship-types into
 * MemoryStore. Verifies that:
 *   - recordEntity validates Entity and inserts a knowledge_nodes row
 *   - recordEntities batch-inserts all valid, skips invalid
 *   - recordEntity is idempotent by (entity, entity_type)
 *   - recordHeuristicRelationship adds a knowledge_edges row when the
 *     heuristic classifier emits a confident result
 *   - resolveLatestRelationship + partitionRelationshipsByKind delegate
 *     to the underlying relationship-types helpers
 *
 * This is the fix for the "49-byte empty KG" bug — before this wire,
 * nothing in the codebase called addKnowledgeNode / addKnowledgeEdge,
 * so knowledge_nodes and knowledge_edges stayed permanently empty.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";
import type { Entity } from "../../src/memory/entity-types.js";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "store-kg-population-"));
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore.recordEntity (entity-types wire)", () => {
  it("validates entity via EntitySchema and inserts a knowledge_nodes row", () => {
    const nodeId = store.recordEntity({
      type: "person",
      name: "Gabriel Vuksani",
      role: "Full Stack Dev",
    });
    expect(nodeId).toBeTypeOf("string");
    expect(nodeId.length).toBeGreaterThan(0);
    const { nodes } = store.getKnowledgeGraphSize();
    expect(nodes).toBe(1);
  });

  it("dedupes by (entity, entity_type) — returns existing id", () => {
    const id1 = store.recordEntity({
      type: "project",
      name: "WOTANN",
      status: "active",
    });
    const id2 = store.recordEntity({
      type: "project",
      name: "WOTANN",
      status: "active",
    });
    expect(id2).toBe(id1);
    expect(store.getKnowledgeGraphSize().nodes).toBe(1);
  });

  it("preserves per-entity fields in the properties JSON blob", () => {
    const nodeId = store.recordEntity({
      type: "file",
      path: "/src/foo.ts",
      kind: "source",
      sizeBytes: 2048,
    });
    expect(nodeId).toBeTypeOf("string");
    // Call recordEntity on a second distinct file so getRelatedEntities
    // has multiple frontier options — depth=1 returns the seed entity.
    const related = store.getRelatedEntities("/src/foo.ts", 1);
    expect(related.length).toBeGreaterThanOrEqual(1);
    const seed = related.find((r) => r.entity === "/src/foo.ts");
    expect(seed).toBeDefined();
    const props = seed!.properties;
    expect(props["kind"]).toBe("source");
    expect(props["sizeBytes"]).toBe("2048");
    expect(nodeId).toBe(seed!.id);
  });

  it("handles all 8 entity kinds", () => {
    const entities: Entity[] = [
      { type: "person", name: "Alice" },
      { type: "project", name: "Proj-X" },
      { type: "file", path: "/a/b.ts" },
      { type: "concept", name: "RAG" },
      { type: "event", name: "Launch", whenMs: Date.now() },
      { type: "goal", name: "Ship v1" },
      { type: "skill", name: "TypeScript" },
      { type: "tool", name: "vitest" },
    ];
    for (const e of entities) store.recordEntity(e);
    expect(store.getKnowledgeGraphSize().nodes).toBe(8);
  });

  it("throws on invalid entity payload", () => {
    expect(() => {
      store.recordEntity({
        // @ts-expect-error deliberately invalid
        type: "person",
        name: "", // empty string violates min(1)
      });
    }).toThrow(/invalid entity/);
  });
});

describe("MemoryStore.recordEntities (batch)", () => {
  it("inserts valid, collects invalid in skipped", () => {
    const result = store.recordEntities([
      { type: "person", name: "Bob" },
      // @ts-expect-error deliberately invalid
      { type: "person", name: "" },
      { type: "concept", name: "Memory" },
    ]);
    expect(result.inserted.length).toBe(2);
    expect(result.skipped.length).toBe(1);
    expect(store.getKnowledgeGraphSize().nodes).toBe(2);
  });

  it("is atomic-per-item (skipped items don't revert inserted ones)", () => {
    const result = store.recordEntities([
      { type: "project", name: "P1", status: "active" },
      // @ts-expect-error deliberately invalid
      { type: "project", name: "" },
      { type: "project", name: "P2", status: "active" },
    ]);
    expect(result.inserted.length).toBe(2);
    expect(result.skipped.length).toBe(1);
    expect(store.getKnowledgeGraphSize().nodes).toBe(2);
  });
});

describe("MemoryStore.recordHeuristicRelationship", () => {
  it("adds a knowledge_edges row when classifier is confident", async () => {
    const from = store.recordEntity({ type: "concept", name: "Policy v1" });
    const to = store.recordEntity({ type: "concept", name: "Policy v2" });
    const edgeId = await store.recordHeuristicRelationship(
      from,
      to,
      "The original deployment policy requires review.",
      "This policy supersedes the original; effective 2026.",
    );
    expect(edgeId).toBeTypeOf("string");
    expect(store.getKnowledgeGraphSize().edges).toBe(1);
  });

  it("returns null when classifier finds no relationship", async () => {
    const from = store.recordEntity({ type: "concept", name: "Sky" });
    const to = store.recordEntity({ type: "concept", name: "Tree" });
    const edgeId = await store.recordHeuristicRelationship(
      from,
      to,
      "The sky is blue today.",
      "My favorite color is green.",
    );
    expect(edgeId).toBeNull();
    expect(store.getKnowledgeGraphSize().edges).toBe(0);
  });
});

describe("MemoryStore.resolveLatestRelationship + partitionRelationshipsByKind", () => {
  it("resolveLatestRelationship follows `updates` chain", () => {
    const rels = [
      {
        id: "r1",
        fromId: "v1",
        toId: "v2",
        kind: "updates" as const,
        confidence: 0.9,
        createdAt: 100,
      },
      {
        id: "r2",
        fromId: "v2",
        toId: "v3",
        kind: "updates" as const,
        confidence: 0.9,
        createdAt: 200,
      },
    ];
    expect(store.resolveLatestRelationship(rels, "v1")).toBe("v3");
    expect(store.resolveLatestRelationship(rels, "v2")).toBe("v3");
    expect(store.resolveLatestRelationship(rels, "v3")).toBe("v3");
  });

  it("partitionRelationshipsByKind groups by kind for a given node", () => {
    const rels = [
      {
        id: "r1",
        fromId: "a",
        toId: "b",
        kind: "updates" as const,
        confidence: 0.9,
        createdAt: 100,
      },
      {
        id: "r2",
        fromId: "a",
        toId: "c",
        kind: "extends" as const,
        confidence: 0.8,
        createdAt: 200,
      },
      {
        id: "r3",
        fromId: "x",
        toId: "y",
        kind: "derives" as const,
        confidence: 0.7,
        createdAt: 300,
      },
    ];
    const parts = store.partitionRelationshipsByKind(rels, "a");
    expect(parts["updates"].length).toBe(1);
    expect(parts["extends"].length).toBe(1);
    expect(parts["derives"].length).toBe(0);
    expect(parts["unknown"].length).toBe(0);
  });
});

describe("End-to-end: memory insert -> KG population via recordEntity", () => {
  it("KG goes from 0 to >0 nodes after recordEntity is called", () => {
    // Snapshot bug state: the "49-byte empty KG" was caused by nothing
    // calling addKnowledgeNode. Before this wire, recordEntity did not
    // exist.
    expect(store.getKnowledgeGraphSize().nodes).toBe(0);

    // Insert a memory entry AND populate the graph.
    store.insert({
      id: "mem-1",
      layer: "core_blocks",
      blockType: "project",
      key: "project.wotann",
      value: "WOTANN is the unified agent harness built by Gabriel.",
      verified: true,
      confidence: 1.0,
    });
    store.recordEntity({ type: "project", name: "WOTANN", owner: "Gabriel" });
    store.recordEntity({ type: "person", name: "Gabriel", role: "builder" });

    // KG should now have 2 nodes — not empty.
    expect(store.getKnowledgeGraphSize().nodes).toBe(2);
  });
});
