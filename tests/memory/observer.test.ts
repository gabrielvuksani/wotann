/**
 * Tests for Observer — Mastra-style async per-turn fact extraction.
 *
 * Covers:
 *   1. Extracts observations on a multi-turn transcript (decision +
 *      preference + milestone).
 *   2. Buffers observations per session; no cross-session bleed.
 *   3. Flush threshold triggers auto-flush to the store.
 *   4. Extractor throw → honest `{ok: false, error}` — no silent no-op.
 *   5. Byte-level dedup — same assertion across turns doesn't double-buffer.
 *   6. `forget(sessionId)` clears per-session state.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  Observer,
  createObserver,
  type ObservedTurn,
} from "../../src/memory/observer.js";
import { ObservationExtractor } from "../../src/memory/observation-extractor.js";
import { MemoryStore } from "../../src/memory/store.js";

// ── Fixtures ───────────────────────────────────────────

const TURNS: readonly ObservedTurn[] = [
  {
    sessionId: "s1",
    userMessage: "We decided to use OAuth 2.0 for the new auth system.",
    assistantMessage: "Understood — OAuth 2.0 chosen over OAuth 1.0 because of wider ecosystem support.",
    completedAt: 1700000000000,
  },
  {
    sessionId: "s1",
    userMessage: "I prefer TDD for every new feature.",
    assistantMessage: "Got it — I'll default to RED-GREEN-REFACTOR for any new implementation.",
    completedAt: 1700000000001,
  },
  {
    sessionId: "s1",
    userMessage: "Build succeeded on CI.",
    assistantMessage: "All tests passed; deployment ready.",
    completedAt: 1700000000002,
  },
];

// ── Setup ──────────────────────────────────────────────

let tempDir: string;
let store: MemoryStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "observer-test-"));
  store = new MemoryStore(join(tempDir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────

describe("Observer", () => {
  it("extracts observations from a multi-turn transcript", () => {
    const obs = new Observer({ store: null, flushThreshold: 100 });
    for (const turn of TURNS) {
      const result = obs.observeTurn(turn);
      expect(result.ok).toBe(true);
    }
    const pending = obs.pendingFor("s1");
    expect(pending.length).toBeGreaterThan(0);
    // Pattern extractor should pick up the OAuth decision and the
    // "build succeeded / tests passed" milestone; preferences require
    // repeated tool invocations so they aren't expected from plain
    // text turns. Verify the shape of what the extractor actually
    // produces.
    const types = pending.map((o) => o.type);
    expect(types).toContain("decision");
    expect(types).toContain("milestone");
    // Every assertion must carry a non-empty string — honest extractor
    // output, not silent empties.
    for (const obs of pending) {
      expect(obs.assertion.length).toBeGreaterThan(0);
    }
  });

  it("keeps per-session state isolated (no cross-session bleed)", () => {
    const obs = new Observer({ store: null, flushThreshold: 100 });
    obs.observeTurn({ ...TURNS[0]!, sessionId: "s1" });
    obs.observeTurn({ ...TURNS[0]!, sessionId: "s2" });
    const s1Pending = obs.pendingFor("s1");
    const s2Pending = obs.pendingFor("s2");
    expect(s1Pending.length).toBeGreaterThan(0);
    expect(s2Pending.length).toBeGreaterThan(0);
    // Each session sees only its own turn count.
    expect(obs.turnsFor("s1")).toBe(1);
    expect(obs.turnsFor("s2")).toBe(1);
    expect(obs.turnsFor("unknown")).toBe(0);
  });

  it("auto-flushes when the flush threshold is crossed", () => {
    const obs = new Observer({ store, flushThreshold: 2 });
    // Turn 0 adds a decision; turn 1 adds nothing (no pattern match);
    // turn 2 adds a milestone. After turn 2 the buffer hits 2 → flush.
    obs.observeTurn(TURNS[0]!);
    obs.observeTurn(TURNS[1]!);
    obs.observeTurn(TURNS[2]!);
    // After auto-flush, pending should be empty for s1.
    expect(obs.pendingFor("s1").length).toBe(0);
    // Store should have inserts in the working layer.
    const working = store.getByLayer("working");
    expect(working.length).toBeGreaterThan(0);
    // Tags should include "observer" so these are grep-verifiable.
    expect(working.some((r) => (r.tags ?? "").includes("observer"))).toBe(true);
  });

  it("returns honest {ok:false,error} when the extractor throws", () => {
    // Stub extractor that throws.
    const stub = {
      extractFromCaptures: () => {
        throw new Error("simulated extractor failure");
      },
    } as unknown as ObservationExtractor;

    const obs = new Observer({ store: null, extractor: stub });
    const result = obs.observeTurn(TURNS[0]!);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.sessionId).toBe("s1");
      expect(result.error).toContain("simulated extractor failure");
    }
    // No observations should have been buffered.
    expect(obs.pendingFor("s1").length).toBe(0);
  });

  it("dedupes observations by assertion text within a session", () => {
    const obs = new Observer({ store: null, flushThreshold: 100 });
    // Observe the same turn twice — the extracted patterns collide.
    obs.observeTurn(TURNS[0]!);
    const afterFirst = obs.pendingFor("s1").length;
    obs.observeTurn(TURNS[0]!);
    const afterSecond = obs.pendingFor("s1").length;
    // Second observe should not grow the buffer (same assertions).
    expect(afterSecond).toBe(afterFirst);
  });

  it("rejects empty sessionId with honest failure, not silent skip", () => {
    const obs = new Observer({ store: null });
    const result = obs.observeTurn({
      sessionId: "",
      userMessage: "foo",
      assistantMessage: "bar",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("sessionId required");
    }
  });

  it("forget(sessionId) clears per-session state", () => {
    const obs = new Observer({ store: null, flushThreshold: 100 });
    obs.observeTurn(TURNS[0]!);
    expect(obs.pendingFor("s1").length).toBeGreaterThan(0);
    obs.forget("s1");
    expect(obs.pendingFor("s1").length).toBe(0);
    expect(obs.turnsFor("s1")).toBe(0);
  });

  it("createObserver() factory returns a working instance", () => {
    const obs = createObserver({ store: null });
    expect(obs).toBeInstanceOf(Observer);
    const result = obs.observeTurn(TURNS[0]!);
    expect(result.ok).toBe(true);
  });

  it("explicit flush() drains the buffer even below threshold", () => {
    const obs = new Observer({ store, flushThreshold: 100 });
    obs.observeTurn(TURNS[0]!);
    const beforeFlush = obs.pendingFor("s1").length;
    expect(beforeFlush).toBeGreaterThan(0);
    const flushed = obs.flush("s1");
    expect(flushed).toBe(beforeFlush);
    expect(obs.pendingFor("s1").length).toBe(0);
    const working = store.getByLayer("working");
    expect(working.length).toBeGreaterThan(0);
  });
});
