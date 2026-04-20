/**
 * Phase 2 P1-M8 Fix B — memory promotion pipeline end-to-end.
 *
 * Chain: auto_capture INSERT -> runtime.consolidateObservations ->
 *        store.consolidateAutoCaptures -> observation-extractor ->
 *        memory_entries INSERT -> decision_log INSERT (for decisions).
 *
 * P0-5 verified the chain produced 288 memory_entries rows on the
 * live db. P1-M7 flagged upstream callers; P1-M8 re-verifies the
 * chain integrity with a deterministic end-to-end test using the
 * real ObservationExtractor (no mocks).
 *
 * Contract:
 *   1. Chain is wired — seeded auto_capture rows produce memory_entries
 *   2. Decision captures flow into decision_log too
 *   3. Preferences only fire when a tool appears ≥3 times (real extractor rule)
 *   4. Noise is marked classificationFailed, not silently dropped
 *   5. Consolidated rows carry the extractor confidence (not default 0.5)
 *      — this is the Fix-A interaction: promotion survives the round trip.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";
import { ObservationExtractor } from "../../src/memory/observation-extractor.js";

let dir: string;
let store: MemoryStore;
let extractor: ObservationExtractor;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "promo-chain-"));
  store = new MemoryStore(join(dir, "memory.db"));
  extractor = new ObservationExtractor();
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function countMemoryEntries(store: MemoryStore): number {
  const row = (store as unknown as {
    db: { prepare: (s: string) => { get: () => { c: number } } };
  }).db
    .prepare("SELECT COUNT(*) as c FROM memory_entries")
    .get();
  return row.c;
}

function countDecisionLog(store: MemoryStore): number {
  const row = (store as unknown as {
    db: { prepare: (s: string) => { get: () => { c: number } } };
  }).db
    .prepare("SELECT COUNT(*) as c FROM decision_log")
    .get();
  return row.c;
}

function getMemoryEntries(
  store: MemoryStore,
): readonly {
  id: string;
  block_type: string;
  value: string;
  confidence: number;
  confidence_level: number;
  tags: string;
}[] {
  return (store as unknown as {
    db: {
      prepare: (s: string) => {
        all: () => {
          id: string;
          block_type: string;
          value: string;
          confidence: number;
          confidence_level: number;
          tags: string;
        }[];
      };
    };
  }).db
    .prepare("SELECT id, block_type, value, confidence, confidence_level, tags FROM memory_entries ORDER BY block_type, id")
    .all();
}

describe("Memory promotion chain auto_capture -> memory_entries (P1-M8 Fix B)", () => {
  it("fresh DB: auto_capture rows flow through the chain into memory_entries", () => {
    // baseline: empty
    expect(countMemoryEntries(store)).toBe(0);

    // Seed auto_capture: a decision cap + a noise cap.
    store.captureEvent(
      "tool_call",
      "We decided to use SQLite over Postgres because bundling matters",
      "ShadowGit",
      "session-1",
    );
    store.captureEvent(
      "tool_call",
      "random unrelated chatter without decision markers",
      "SomeOther",
      "session-1",
    );

    // Trigger the real chain: real extractor, real store path.
    const report = store.consolidateAutoCaptures(
      (caps) => extractor.extractFromCaptures(caps),
      { batchSize: 100 },
    );

    expect(report.read).toBe(2);
    // At least the decision must route; noise may be counted as classificationFailed.
    expect(report.routed).toBeGreaterThanOrEqual(1);
    expect(countMemoryEntries(store)).toBeGreaterThanOrEqual(1);
  });

  it("decision captures mirror into decision_log (bi-temporal ledger)", () => {
    store.captureEvent(
      "tool_call",
      "We chose the repository pattern over ActiveRecord because of testability",
      "Designer",
      "session-2",
    );

    const report = store.consolidateAutoCaptures(
      (caps) => extractor.extractFromCaptures(caps),
      { batchSize: 100 },
    );

    expect(report.routed).toBeGreaterThanOrEqual(1);
    expect(report.decisionLogged).toBeGreaterThanOrEqual(1);
    expect(countDecisionLog(store)).toBeGreaterThanOrEqual(1);
    expect(report.byBlock.decisions).toBeGreaterThanOrEqual(1);
  });

  it("preferences fire only when a tool is used >=3 times (real extractor rule)", () => {
    // Only 2 uses of the same tool => should NOT trigger preference.
    store.captureEvent("tool_call", "hello world", "ToolA", "session-3");
    store.captureEvent("tool_call", "hello again", "ToolA", "session-3");

    const r1 = store.consolidateAutoCaptures(
      (caps) => extractor.extractFromCaptures(caps),
      { batchSize: 100 },
    );
    const prefCount1 = r1.byBlock.feedback ?? 0;

    // Fresh store for the positive case.
    const dir2 = mkdtempSync(join(tmpdir(), "promo-chain-b-"));
    const store2 = new MemoryStore(join(dir2, "memory.db"));
    try {
      for (let i = 0; i < 4; i++) {
        store2.captureEvent("tool_call", `usage ${i}`, "ToolB", "session-4");
      }
      const r2 = store2.consolidateAutoCaptures(
        (caps) => extractor.extractFromCaptures(caps),
        { batchSize: 100 },
      );
      expect(r2.byBlock.feedback ?? 0).toBeGreaterThanOrEqual(1);
    } finally {
      store2.close();
      rmSync(dir2, { recursive: true, force: true });
    }

    expect(prefCount1).toBe(0);
  });

  it("honest failure: noise captures are reported to onClassificationFailed, not silent-success dropped", () => {
    store.captureEvent("tool_call", "noise alpha", "ToolC", "session-5");
    store.captureEvent("tool_call", "noise beta", "ToolC", "session-5");

    const failedIds: number[] = [];
    const reasons: string[] = [];
    const report = store.consolidateAutoCaptures(
      (caps) => extractor.extractFromCaptures(caps),
      {
        batchSize: 100,
        onClassificationFailed: (entry, reason) => {
          failedIds.push(entry.id);
          reasons.push(reason);
        },
      },
    );

    expect(report.read).toBe(2);
    expect(report.routed).toBe(0);
    expect(report.classificationFailed).toBe(2);
    expect(failedIds.length).toBe(2);
    expect(reasons.every((r) => r === "no_pattern_matched")).toBe(true);
  });

  it("consolidation never re-processes the same auto_capture row (consolidated_at marker)", () => {
    store.captureEvent(
      "tool_call",
      "We decided to cache the result because of performance",
      "Perf",
      "session-6",
    );

    const first = store.consolidateAutoCaptures(
      (caps) => extractor.extractFromCaptures(caps),
      { batchSize: 100 },
    );
    expect(first.read).toBe(1);
    expect(first.routed).toBeGreaterThanOrEqual(1);

    // Second pass: queue must be empty — no re-consolidation of old rows.
    const second = store.consolidateAutoCaptures(
      (caps) => extractor.extractFromCaptures(caps),
      { batchSize: 100 },
    );
    expect(second.read).toBe(0);
    expect(second.routed).toBe(0);
  });

  it("Fix-A interaction: promoted rows carry the extractor's confidence (not default 0.5)", () => {
    // Decision confidence in the extractor is 0.7; verify round trip.
    store.captureEvent(
      "tool_call",
      "We chose GraphQL over REST because of typed schemas",
      "Api",
      "session-7",
    );

    const report = store.consolidateAutoCaptures(
      (caps) => extractor.extractFromCaptures(caps),
      { batchSize: 100 },
    );
    expect(report.routed).toBeGreaterThanOrEqual(1);

    const rows = getMemoryEntries(store);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      // Decision extractor sets confidence=0.7, so the row's confidence_level
      // column must reflect that — NOT the legacy 0.5 default.
      expect(r.confidence_level).toBeGreaterThan(0.5);
      expect(r.tags).toContain("consolidated");
    }
  });

  it("tags produced include consolidated marker so sessions can grep-verify the claim", () => {
    store.captureEvent(
      "tool_call",
      "We opted for SQLite over LevelDB because of SQL",
      "Store",
      "session-8",
    );

    store.consolidateAutoCaptures(
      (caps) => extractor.extractFromCaptures(caps),
      { batchSize: 100 },
    );

    const rows = getMemoryEntries(store);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const anyConsolidated = rows.some((r) => r.tags.includes("consolidated"));
    expect(anyConsolidated).toBe(true);
  });
});
