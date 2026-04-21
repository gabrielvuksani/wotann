/**
 * Phase 2 P1-M3 — end-to-end Observer ↔ Mem0 v3 wiring tests.
 *
 * Complements:
 *   - `mem0-add-only.test.ts` (unit tests for the extractor alone)
 *   - `agent-facts.test.ts`   (unit tests for the tag encoding)
 *
 * This file asserts the integration surface:
 *   1. Observer.observeTurn with `agentId` routes facts through the
 *      Mem0 v3 ADD-only path and persists them via recordAgentFact.
 *   2. Observer.observeTurn without `agentId` is byte-identical to
 *      the P1-M1 behaviour (backwards compatibility).
 *   3. MemoryStore.recordAgentFact / retrieveAgentFacts wrappers
 *      round-trip through the module-level bootstrap.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MemoryStore } from "../../src/memory/store.js";
import { Observer } from "../../src/memory/observer.js";
// Side-effecting import — registers the agent-facts module with
// MemoryStore so the recordAgentFact / retrieveAgentFacts wrappers
// can find the implementation. Without this, those wrappers throw
// on first call (Quality Bar #6 honest failure, not silent).
import "../../src/memory/agent-facts.js";

let tempDir: string;
let store: MemoryStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "observer-mem0-wire-"));
  store = new MemoryStore(join(tempDir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Observer → Mem0 v3 wiring", () => {
  it("routes agent-facts through ADD-only path when agentId is provided", () => {
    // End-to-end evidence for the P1-M3 port — grep-verifiable via
    // the `mem0-add-only` tag on persisted rows.
    const obs = new Observer({ store, flushThreshold: 100 });
    const result = obs.observeTurn({
      sessionId: "obs-wire-s1",
      agentId: "agent-obs-alpha",
      userMessage: "Please book a flight to Reykjavik for me.",
      assistantMessage: "I've booked your flight to Reykjavik on 2026-05-04.",
      completedAt: 1700000000000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Mem0 v3 agent-facts path fired — the assistant fact was captured.
    expect(result.agentFacts.length).toBeGreaterThan(0);
    // Store has ADD-only-tagged rows.
    const rows = store.getByLayer("working");
    const mem0Rows = rows.filter((r) => (r.tags ?? "").includes("mem0-add-only"));
    expect(mem0Rows.length).toBeGreaterThan(0);
    const agentRows = rows.filter((r) => (r.tags ?? "").includes("agent:agent-obs-alpha"));
    expect(agentRows.length).toBeGreaterThan(0);
  });

  it("does NOT emit agent-facts when agentId is absent (backwards compatible)", () => {
    const obs = new Observer({ store, flushThreshold: 100 });
    const result = obs.observeTurn({
      sessionId: "obs-wire-s2",
      userMessage: "Hello",
      assistantMessage: "Hi there",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No agent id → no Mem0 v3 path firing.
    expect(result.agentFacts.length).toBe(0);
    // Grep invariant: no mem0-add-only rows persisted for this
    // session — the old P1-M1 behaviour is preserved verbatim.
    const rows = store.getByLayer("working");
    const mem0Rows = rows.filter(
      (r) => r.sessionId === "obs-wire-s2" && (r.tags ?? "").includes("mem0-add-only"),
    );
    expect(mem0Rows.length).toBe(0);
  });

  it("MemoryStore.recordAgentFact/retrieveAgentFacts wrappers round-trip", () => {
    store.recordAgentFact({
      id: "wire-1",
      agentId: "wrap-agent",
      sessionId: "wrap-s1",
      role: "agent",
      type: "fact",
      assertion: "I've committed the changes to main.",
      confidence: 0.9,
      extractedAt: Date.now(),
    });
    const rows = store.retrieveAgentFacts({ agentId: "wrap-agent" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.value).toContain("committed");
  });

  it("retrieveAgentFacts honours role filter across multi-role turn", () => {
    // One turn produces both a user-decision fact and an agent-action
    // fact. Querying by role must partition them correctly.
    const obs = new Observer({ store, flushThreshold: 100 });
    obs.observeTurn({
      sessionId: "obs-wire-s3",
      agentId: "agent-obs-beta",
      userMessage: "I decided to switch to OAuth 2.0.",
      assistantMessage: "I've updated the auth configuration to use OAuth 2.0.",
    });
    const userFacts = store.retrieveAgentFacts({ agentId: "agent-obs-beta", role: "user" });
    const agentFacts = store.retrieveAgentFacts({ agentId: "agent-obs-beta", role: "agent" });
    expect(userFacts.length + agentFacts.length).toBeGreaterThan(0);
    // No row appears in both buckets.
    const userIds = new Set(userFacts.map((r) => r.id));
    for (const agentRow of agentFacts) {
      expect(userIds.has(agentRow.id)).toBe(false);
    }
  });
});
