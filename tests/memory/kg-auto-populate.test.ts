/**
 * P1-M7 upstream — observation-extractor → recordEntity wiring.
 *
 * Before this wire, observation-extractor emitted free-text observations
 * but `knowledge_nodes` stayed empty forever because nothing in the
 * codebase actually called `MemoryStore.recordEntity`. The derivation
 * helpers + session-ingestion `autoPopulateKG` gate fix that.
 *
 * These tests PROVE the gap is closed by asserting the raw SQL row
 * count of `knowledge_nodes` transitions from 0 → N after running an
 * ingest pass with the gate flipped on.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { MemoryStore, type AutoCaptureEntry } from "../../src/memory/store.js";
import {
  deriveEntitiesFromObservations,
  deriveRelationshipHintsFromObservations,
  extractDecisions,
  extractMilestones,
  extractPreferences,
  extractProblems,
} from "../../src/memory/observation-extractor.js";
import { ingestSession } from "../../src/memory/session-ingestion.js";
import type { Entity } from "../../src/memory/entity-types.js";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kg-auto-populate-"));
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeCapture(overrides: Partial<AutoCaptureEntry> & { id: number }): AutoCaptureEntry {
  return {
    eventType: "tool_call",
    content: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── deriveEntitiesFromObservations — pure helper ───────────────────────

describe("deriveEntitiesFromObservations", () => {
  it("emits a Tool entity for a preference observation", () => {
    // Three captures of the same tool → extractPreferences emits one.
    const captures = [
      makeCapture({ id: 1, toolName: "grep", content: "search 1" }),
      makeCapture({ id: 2, toolName: "grep", content: "search 2" }),
      makeCapture({ id: 3, toolName: "grep", content: "search 3" }),
    ];
    const obs = extractPreferences(captures);
    expect(obs).toHaveLength(1);
    const derived = deriveEntitiesFromObservations(obs);
    const tool = derived.find((d) => d.entity.type === "tool") as
      | { entity: Extract<Entity, { type: "tool" }> }
      | undefined;
    expect(tool).toBeDefined();
    expect(tool!.entity.name).toBe("grep");
  });

  it("emits a Concept entity for a decision observation", () => {
    const captures = [
      makeCapture({
        id: 1,
        content: "Chose Postgres instead of MySQL for JSONB support",
      }),
    ];
    const obs = extractDecisions(captures);
    expect(obs).toHaveLength(1);
    const derived = deriveEntitiesFromObservations(obs);
    const concept = derived.find((d) => d.entity.type === "concept");
    expect(concept).toBeDefined();
  });

  it("emits an Event entity + File entity for a problem observation mentioning a path", () => {
    const captures = [
      makeCapture({
        id: 1,
        content: "TypeError crashed tests at src/memory/store.ts during indexing",
      }),
    ];
    const obs = extractProblems(captures);
    expect(obs).toHaveLength(1);
    const derived = deriveEntitiesFromObservations(obs);
    const event = derived.find((d) => d.entity.type === "event");
    const file = derived.find((d) => d.entity.type === "file");
    expect(event).toBeDefined();
    expect(file).toBeDefined();
    const fileEntity = file!.entity as Extract<Entity, { type: "file" }>;
    expect(fileEntity.path).toContain("src/memory/store.ts");
  });

  it("returns an empty list when given zero observations (no fabrication)", () => {
    expect(deriveEntitiesFromObservations([])).toHaveLength(0);
  });
});

// ── deriveRelationshipHintsFromObservations ────────────────────────────

describe("deriveRelationshipHintsFromObservations", () => {
  it("returns empty when fewer than 2 observations (no fabrication)", () => {
    const captures = [makeCapture({ id: 1, content: "Chose Redis over Memcached" })];
    const obs = extractDecisions(captures);
    expect(deriveRelationshipHintsFromObservations(obs)).toHaveLength(0);
  });

  it("emits hints for consecutive same-domain observations", () => {
    // Synthesize two observations with the SAME domain (testing) and
    // different extractedAt so sort is deterministic.
    const captures = [
      makeCapture({ id: 1, content: "All vitest tests passed successfully" }),
      makeCapture({ id: 2, content: "Decided to switch to jest instead" }),
    ];
    const obs = [...extractMilestones(captures), ...extractDecisions(captures)];
    expect(obs.length).toBeGreaterThanOrEqual(1);
    // Need at least 2 same-domain observations — give them the same domain.
    const sameDomain = obs.map((o, i) => ({
      ...o,
      domain: "testing",
      extractedAt: Date.now() + i,
    }));
    const hints = deriveRelationshipHintsFromObservations(sameDomain);
    if (sameDomain.length >= 2) {
      expect(hints.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── session-ingestion.autoPopulateKG — default gate OFF ────────────────

describe("ingestSession autoPopulateKG gate (default OFF)", () => {
  it("does NOT call recordEntity when gate is off (store stays empty)", async () => {
    const before = store.getKnowledgeGraphSize();
    expect(before.nodes).toBe(0);

    const result = await ingestSession({
      sessionId: "s1",
      captures: [
        makeCapture({ id: 1, content: "Chose Postgres instead of MySQL", sessionId: "s1" }),
        makeCapture({ id: 2, content: "All tests passed", sessionId: "s1" }),
      ],
    });

    // Gate default is OFF — observations extracted but KG untouched.
    expect(result.observations.length).toBeGreaterThan(0);
    const after = store.getKnowledgeGraphSize();
    expect(after.nodes).toBe(0);
    expect(result.kgPopulation.recordedEntities).toBe(0);
  });

  it("does NOT call recordEntity when gate is on but populator missing", async () => {
    const result = await ingestSession(
      {
        sessionId: "s1",
        captures: [makeCapture({ id: 1, content: "Chose Postgres" })],
      },
      { autoPopulateKG: true /* no populator — should no-op */ },
    );
    expect(result.kgPopulation.recordedEntities).toBe(0);
    expect(store.getKnowledgeGraphSize().nodes).toBe(0);
  });
});

// ── session-ingestion.autoPopulateKG — gate ON, real SQL proof ─────────

describe("ingestSession autoPopulateKG gate (ON, SQL-proof)", () => {
  it("populates knowledge_nodes (count goes 0 → N) via SQL count", async () => {
    // SQL evidence pre-condition: table starts empty.
    const raw = store as unknown as {
      db: { prepare: (s: string) => { get: () => { c: number } } };
    };
    const before = raw.db
      .prepare("SELECT COUNT(*) as c FROM knowledge_nodes")
      .get();
    expect(before.c).toBe(0);

    const result = await ingestSession(
      {
        sessionId: "s1",
        captures: [
          makeCapture({
            id: 1,
            toolName: "grep",
            content: "grep search for pattern",
            sessionId: "s1",
          }),
          makeCapture({
            id: 2,
            toolName: "grep",
            content: "grep another search",
            sessionId: "s1",
          }),
          makeCapture({
            id: 3,
            toolName: "grep",
            content: "grep third search",
            sessionId: "s1",
          }),
          makeCapture({
            id: 4,
            content: "Chose Postgres instead of MySQL for JSONB",
            sessionId: "s1",
          }),
        ],
      },
      { autoPopulateKG: true, populator: store },
    );

    // SQL evidence post-condition: at least one node got inserted.
    const after = raw.db
      .prepare("SELECT COUNT(*) as c FROM knowledge_nodes")
      .get();
    expect(after.c).toBeGreaterThan(0);
    expect(result.kgPopulation.derivedEntities).toBeGreaterThan(0);
    expect(result.kgPopulation.recordedEntities).toBeGreaterThan(0);
    // KG grows monotonically during the ingest.
    expect(after.c).toBeGreaterThan(before.c);
  });

  it("dedupes repeated entity derivations (recordEntity is idempotent)", async () => {
    // Seed an entity first.
    const preId = store.recordEntity({ type: "tool", name: "grep" });

    // Now run ingestSession with content that should re-derive the same
    // tool — we expect recordEntity to return the same id (no new row).
    await ingestSession(
      {
        sessionId: "s1",
        captures: [
          makeCapture({ id: 1, toolName: "grep", content: "1", sessionId: "s1" }),
          makeCapture({ id: 2, toolName: "grep", content: "2", sessionId: "s1" }),
          makeCapture({ id: 3, toolName: "grep", content: "3", sessionId: "s1" }),
        ],
      },
      { autoPopulateKG: true, populator: store },
    );

    const raw = store as unknown as {
      db: {
        prepare: (s: string) => {
          get: (...args: unknown[]) => { id: string } | undefined;
          all: () => { entity: string; entity_type: string }[];
        };
      };
    };
    const existing = raw.db
      .prepare("SELECT id FROM knowledge_nodes WHERE entity = ? AND entity_type = ? LIMIT 1")
      .get("grep", "tool");
    expect(existing).toBeDefined();
    expect(existing!.id).toBe(preId);
  });

  it("non-matching captures produce zero entities (no fabrication)", async () => {
    const result = await ingestSession(
      {
        sessionId: "s1",
        captures: [
          makeCapture({ id: 1, content: "just a plain read of a file" }),
          makeCapture({ id: 2, content: "another noise line" }),
        ],
      },
      { autoPopulateKG: true, populator: store },
    );
    // Pure-read / noise captures don't trigger any of the 5 observation
    // patterns, so no entity should be derived or recorded.
    expect(result.kgPopulation.derivedEntities).toBe(0);
    expect(result.kgPopulation.recordedEntities).toBe(0);
    expect(store.getKnowledgeGraphSize().nodes).toBe(0);
  });

  it("empty capture list leaves KG untouched even with gate ON", async () => {
    const before = store.getKnowledgeGraphSize().nodes;
    const result = await ingestSession(
      { sessionId: "s1", captures: [] },
      { autoPopulateKG: true, populator: store },
    );
    expect(result.kgPopulation.recordedEntities).toBe(0);
    expect(store.getKnowledgeGraphSize().nodes).toBe(before);
  });
});
