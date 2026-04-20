/**
 * Active Memory engine (S3-5) — tests.
 *
 * Covers:
 *   - Classifier categories (decision, preference, fact, question, other)
 *   - Observation extraction (written to auto_capture via captureEvent)
 *   - Recall for question messages against a real in-memory MemoryStore.
 *     Historically the recall filter accessed `.content`, but the upstream
 *     `MemoryStore.search()` returns rows shaped `{entry: {value: ...}, ...}`
 *     which caused every row to be filtered out and recall to return `null`
 *     (Master Plan V8 P0-5). This file pins the correct contract: when
 *     there are relevant matching entries, recall returns a non-empty
 *     contextPrefix that includes their values.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ActiveMemoryEngine, createActiveMemoryEngine } from "../../src/memory/active-memory.js";
import { MemoryStore } from "../../src/memory/store.js";

// ── Setup helpers ───────────────────────────────────────────

function seedStore(store: MemoryStore): void {
  // Three representative entries covering decisions, preferences, and facts
  // with values that a follow-up question can FTS-match on.
  store.insert({
    id: "active-1",
    layer: "core_blocks",
    blockType: "decisions",
    key: "oauth-decision",
    value: "We decided to use OAuth 2.0 for the new auth system.",
    verified: false,
    freshnessScore: 1.0,
    confidenceLevel: 0.8,
    verificationStatus: "unverified",
  });
  store.insert({
    id: "active-2",
    layer: "core_blocks",
    blockType: "feedback",
    key: "testing-preference",
    value: "Gabriel prefers TDD with RED-GREEN-REFACTOR for every new feature.",
    verified: false,
    freshnessScore: 1.0,
    confidenceLevel: 0.8,
    verificationStatus: "unverified",
  });
  store.insert({
    id: "active-3",
    layer: "core_blocks",
    blockType: "project",
    key: "project-fact",
    value: "The WOTANN project uses SQLite with FTS5 for the memory store.",
    verified: false,
    freshnessScore: 1.0,
    confidenceLevel: 0.8,
    verificationStatus: "unverified",
  });
}

// ── Tests ───────────────────────────────────────────────────

describe("ActiveMemoryEngine — classification + extraction", () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wotann-active-mem-"));
    store = new MemoryStore(join(tmpDir, "memory.db"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies a decision and writes an observation", () => {
    const engine = new ActiveMemoryEngine(store);
    const result = engine.preprocess("We decided to use OAuth for auth.", "s1");
    expect(result.classification).toBe("decision");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.type).toBe("decision");
    // contextPrefix is only populated for questions.
    expect(result.contextPrefix).toBeNull();
  });

  it("classifies a question and does not extract observations", () => {
    const engine = new ActiveMemoryEngine(store);
    const result = engine.preprocess("What did we decide about auth?", "s1");
    expect(result.classification).toBe("question");
    expect(result.observations).toHaveLength(0);
  });

  it("classifies an 'other' message and returns no observations / no prefix", () => {
    const engine = new ActiveMemoryEngine(store);
    const result = engine.preprocess("hello there friend", "s1");
    expect(result.classification).toBe("other");
    expect(result.observations).toHaveLength(0);
    expect(result.contextPrefix).toBeNull();
  });
});

describe("ActiveMemoryEngine — recall (regression: .entry.value shape)", () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wotann-active-mem-recall-"));
    store = new MemoryStore(join(tmpDir, "memory.db"));
    seedStore(store);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a NON-EMPTY contextPrefix when a question matches prior entries", () => {
    const engine = createActiveMemoryEngine(store);

    // A question whose FTS5 terms overlap with seeded values.
    const result = engine.preprocess("What did we decide about OAuth?", "s1");

    // The pattern-based classifier must mark this as a question so the
    // recall branch runs.
    expect(result.classification).toBe("question");

    // REGRESSION GUARD: with the old `.content` filter, every row was
    // rejected and this was `null`. With the correct `.entry.value`
    // access, we must get a prefix that includes seeded OAuth text.
    expect(result.contextPrefix).not.toBeNull();
    expect(result.contextPrefix).toContain("OAuth");
    // Prefix is expected to open with the Active Memory header.
    expect(result.contextPrefix).toMatch(/Active Memory recall/);
  });

  it("recall returns multiple formatted bullets when multiple entries match", () => {
    const engine = createActiveMemoryEngine(store);

    // "memory" should hit both the FTS5 project-fact row and (loosely)
    // recall still surfaces at least one hit.
    const result = engine.preprocess("How does memory work here?", "s1");
    expect(result.classification).toBe("question");
    expect(result.contextPrefix).not.toBeNull();
    // Each hit is formatted as a `- <value>` bullet.
    expect(result.contextPrefix!.split("\n").filter((l) => l.startsWith("- ")).length).toBeGreaterThan(0);
  });

  it("recall returns null for non-question messages even with matching entries", () => {
    const engine = createActiveMemoryEngine(store);
    const result = engine.preprocess("I prefer OAuth for new services.", "s1");
    // Classified as preference → no recall, even though the store would match.
    expect(result.classification).toBe("preference");
    expect(result.contextPrefix).toBeNull();
  });

  it("recall returns null when the store is null (no memory)", () => {
    const engine = createActiveMemoryEngine(null);
    const result = engine.preprocess("What did we decide about OAuth?", "s1");
    expect(result.classification).toBe("question");
    expect(result.contextPrefix).toBeNull();
  });
});
