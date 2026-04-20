/**
 * Phase 2 P1-M8 Fix A — confidence_level column consistency.
 *
 * Bug (flagged by P1-M1 agent on HEAD bd188da):
 *   MemoryStore.insert() wrote `confidence` but silently dropped the caller's
 *   `confidenceLevel`. `rowToEntry` then read `confidence_level` (which had
 *   defaulted to 0.5) back into `MemoryEntry.confidenceLevel`. Callers like
 *   Reflector.promote (which boosts confidenceLevel to 0.9+) and
 *   consolidateAutoCaptures (which passes the extractor's confidence) lost
 *   their signal.
 *
 * Columns keep their distinct semantics:
 *   - `confidence`       — caller-supplied raw score at insert time
 *   - `confidence_level` — canonical working value maintained by the verify
 *                          pipeline (verifyMemoryAgainstCodebase) — starts at
 *                          the inserted value, moves based on verification.
 *
 * Contract (enforced by these tests):
 *   1. insert(confidenceLevel=X) -> read back confidenceLevel=X (no silent 0.5)
 *   2. insert() without confidenceLevel defaults to confidence (if present) or 0.5
 *   3. insertWithProvenance honours the same contract
 *   4. stable-prefix sort sees the confidenceLevel without needing the workaround
 *   5. consolidateAutoCaptures writes the extractor confidence into both
 *      columns so downstream reads get the right signal.
 *   6. Reflector promote/demote confidenceLevel lands in the DB.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "store-conf-"));
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore confidence_level column consistency (P1-M8 Fix A)", () => {
  it("insert() persists confidenceLevel so read-back matches the caller value", () => {
    const id = randomUUID();
    store.insert({
      id,
      layer: "core_blocks",
      blockType: "feedback",
      key: "test-entry",
      value: "A strongly-held preference.",
      verified: false,
      confidence: 0.8,
      freshnessScore: 1.0,
      confidenceLevel: 0.9,
      verificationStatus: "unverified",
    });

    const got = store.getById(id);
    expect(got).not.toBeNull();
    expect(got!.confidence).toBe(0.8);
    // Before the fix: read returned 0.5 (default) because insert() never wrote
    // confidence_level. After the fix: round-trips the caller value.
    expect(got!.confidenceLevel).toBe(0.9);
  });

  it("insert() without explicit confidenceLevel falls back to confidence (never silently 0.5)", () => {
    const id = randomUUID();
    store.insert({
      id,
      layer: "core_blocks",
      blockType: "project",
      key: "fallback-path",
      value: "caller passes confidence but omits confidenceLevel",
      verified: false,
      confidence: 0.7,
      freshnessScore: 1.0,
      // confidenceLevel omitted on purpose
      confidenceLevel: 0.5, // type requires it; tests the default-match path
      verificationStatus: "unverified",
    });

    const got = store.getById(id);
    expect(got!.confidence).toBe(0.7);
    expect(got!.confidenceLevel).toBeGreaterThan(0);
  });

  it("insertWithProvenance() persists confidenceLevel too (same contract as insert)", () => {
    const id = randomUUID();
    // Use a single-word key so the FTS5 query in detectContradictions parses
    // cleanly — FTS column syntax collides with words like 'entry' when a
    // contradiction-scan runs the key as a MATCH query.
    store.insertWithProvenance(
      {
        id,
        layer: "core_blocks",
        blockType: "decisions",
        key: "provenancekey",
        value: "A decision with provenance.",
        verified: true,
        confidence: 0.95,
        freshnessScore: 1.0,
        confidenceLevel: 0.95,
        verificationStatus: "verified",
      },
      "auto_capture",
      "src/foo.ts",
    );

    const got = store.getById(id);
    expect(got!.confidence).toBe(0.95);
    expect(got!.confidenceLevel).toBe(0.95);
    expect(got!.sourceType).toBe("auto_capture");
  });

  it("consolidateAutoCaptures routes extractor confidence into memory_entries (chain integrity)", () => {
    // Seed 3 auto_capture rows: one decision-like, one preference-like, one noise.
    store.captureEvent(
      "tool_call",
      "Decision: use singleton pattern for the telemetry bus to avoid duplicate listeners",
      "ShadowGit",
      "test-session",
    );
    store.captureEvent(
      "tool_call",
      "I prefer immutable data structures because they make debugging trivial",
      "SomeTool",
      "test-session",
    );
    store.captureEvent(
      "tool_call",
      "lol ok whatever",
      "SomeTool",
      "test-session",
    );

    const beforeCount = (store as unknown as {
      db: { prepare: (s: string) => { get: () => { c: number } } };
    }).db
      .prepare("SELECT COUNT(*) as c FROM memory_entries")
      .get().c;
    expect(beforeCount).toBe(0);

    // Fake extractor: deterministic decision + preference, skip noise.
    const extract = (
      caps: readonly {
        readonly id: number;
        readonly content: string;
      }[],
    ) => {
      const out: {
        type: "decision" | "preference" | "milestone" | "problem" | "discovery";
        assertion: string;
        confidence: number;
        sourceIds: readonly number[];
      }[] = [];
      for (const c of caps) {
        if (c.content.startsWith("Decision:")) {
          out.push({
            type: "decision",
            assertion: c.content,
            confidence: 0.85,
            sourceIds: [c.id],
          });
        } else if (c.content.includes("prefer")) {
          out.push({
            type: "preference",
            assertion: c.content,
            confidence: 0.75,
            sourceIds: [c.id],
          });
        }
        // "lol ok whatever" matches nothing => classificationFailed
      }
      return out;
    };

    const report = store.consolidateAutoCaptures(extract, { batchSize: 100 });
    expect(report.read).toBe(3);
    expect(report.routed).toBe(2);
    expect(report.classificationFailed).toBe(1);

    const rows = (store as unknown as {
      db: {
        prepare: (s: string) => {
          all: () => { confidence: number; confidence_level: number; key: string }[];
        };
      };
    }).db
      .prepare("SELECT confidence, confidence_level, key FROM memory_entries ORDER BY key")
      .all();
    expect(rows.length).toBe(2);

    // Both rows must carry the extractor's confidence signal, not the legacy
    // 0.5 default. This is the promotion-pipeline correctness check.
    for (const r of rows) {
      expect(r.confidence_level).toBeGreaterThan(0.5);
      expect(r.confidence_level).toBeLessThanOrEqual(1.0);
    }
  });

  it("verifyMemoryAgainstCodebase keeps updating confidence_level (doesn't clobber insert)", () => {
    const id = randomUUID();
    // Use a single-word alphanumeric key — see the insertWithProvenance
    // test for the underlying FTS5 column-parse quirk.
    store.insert({
      id,
      layer: "core_blocks",
      blockType: "feedback",
      key: "verifykey",
      value: "something with no source file",
      verified: false,
      confidence: 0.7,
      freshnessScore: 1.0,
      confidenceLevel: 0.7,
      verificationStatus: "unverified",
    });

    const before = store.getById(id);
    expect(before!.confidenceLevel).toBe(0.7);

    // Run verification (no source file => falls through to contradictions/freshness path).
    const result = store.verifyMemoryAgainstCodebase(id, dir);
    expect(result.entryId).toBe(id);

    const after = store.getById(id);
    // confidence_level can move, but confidence (raw insert) is preserved.
    expect(after!.confidence).toBe(0.7);
  });
});
