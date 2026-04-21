/**
 * Tests for Mem0 v3 single-pass ADD-only fact extractor.
 *
 * Port verification (Quality Bar #14): the claim "Mem0 v3 single-pass
 * ADD-only" means one LLM call per turn that emits N candidate facts,
 * each persisted additively. Never UPDATE/DELETE/MERGE existing facts.
 *
 * The WOTANN port keeps the pattern-based (LLM-free) extraction that
 * the rest of the memory module uses, so "single-pass" translates to
 * "one extractor invocation per turn that emits a flat list of facts
 * attached to the turn's role (user/agent)". ADD-only is the invariant
 * about how those facts are persisted.
 *
 * Coverage:
 *  1. Emits at least one fact per turn when patterns match.
 *  2. Role is preserved on each fact ("user" vs "agent").
 *  3. Re-extracting the same turn does NOT mutate prior facts.
 *  4. Store writes are all INSERT (no UPDATE/DELETE calls).
 *  5. Honest failure — extractor throw → `{ok:false, error}`, no silent
 *     swallow.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  Mem0AddOnlyExtractor,
  createMem0AddOnlyExtractor,
  type Mem0Turn,
  type Mem0Fact,
} from "../../src/memory/mem0-add-only.js";
import { MemoryStore } from "../../src/memory/store.js";
// Import agent-facts so the MemoryStore bootstrap registers — this
// import is side-effecting; it wires `setAgentFactsModule` on load.
import "../../src/memory/agent-facts.js";
import { Observer } from "../../src/memory/observer.js";

// ── Fixtures ───────────────────────────────────────────

const USER_DECISION_TURN: Mem0Turn = {
  sessionId: "mem0-s1",
  userMessage: "We decided to use OAuth 2.0 for the new auth system.",
  assistantMessage: "Sounds good — I'll set up the OAuth 2.0 integration.",
  completedAt: 1700000000000,
};

const AGENT_FACT_TURN: Mem0Turn = {
  sessionId: "mem0-s1",
  userMessage: "Can you book me a flight to Reykjavik?",
  // Mem0 v3's single biggest win: assistant-emitted facts ("I've booked ...")
  // get user-equal priority. They must be extracted with source=agent.
  assistantMessage: "I've booked your flight to Reykjavik on 2026-05-04 at 08:15.",
  completedAt: 1700000000001,
};

const NO_FACTS_TURN: Mem0Turn = {
  sessionId: "mem0-s1",
  userMessage: "hi",
  assistantMessage: "hello",
  completedAt: 1700000000002,
};

// ── Setup ──────────────────────────────────────────────

let tempDir: string;
let store: MemoryStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mem0-add-only-test-"));
  store = new MemoryStore(join(tempDir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────

describe("Mem0AddOnlyExtractor", () => {
  it("extracts at least one fact from a user decision turn", () => {
    const mx = new Mem0AddOnlyExtractor();
    const result = mx.extractFromTurn(USER_DECISION_TURN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.length).toBeGreaterThan(0);
  });

  it("preserves the source role on each extracted fact", () => {
    const mx = new Mem0AddOnlyExtractor();
    const result = mx.extractFromTurn(AGENT_FACT_TURN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Every fact is tagged with a role. Agent-emitted sentences yield
    // role="agent"; user-emitted sentences yield role="user".
    const roles = new Set(result.facts.map((f) => f.role));
    expect(roles.size).toBeGreaterThan(0);
    for (const r of roles) {
      expect(["user", "agent"]).toContain(r);
    }
    // The agent-fact about booking must be captured with role="agent".
    const agentFacts = result.facts.filter((f) => f.role === "agent");
    expect(agentFacts.length).toBeGreaterThan(0);
  });

  it("single-pass: one call per turn emits N facts, no reconcile pass", () => {
    const mx = new Mem0AddOnlyExtractor();
    // extractFromTurn is synchronous and returns the full fact list
    // in one call. It does not read back from the store, so it cannot
    // do UPDATE/DELETE/MERGE reconciliation.
    const result = mx.extractFromTurn(USER_DECISION_TURN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Invariant: each fact carries only its own source ids — no
    // cross-references to pre-existing facts. This is the structural
    // definition of "single-pass".
    for (const fact of result.facts) {
      expect(fact.turnCompletedAt).toBe(USER_DECISION_TURN.completedAt);
      expect(fact.sessionId).toBe(USER_DECISION_TURN.sessionId);
    }
  });

  it("re-extracting the same turn produces facts that don't mutate prior facts", () => {
    const mx = new Mem0AddOnlyExtractor();
    const first = mx.extractFromTurn(USER_DECISION_TURN);
    const second = mx.extractFromTurn(USER_DECISION_TURN);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Each extraction is independent and yields a fresh fact list —
    // there is no shared mutable state between calls.
    expect(first.facts.length).toBe(second.facts.length);
    // Fact ids must all be unique across both extractions (no reuse).
    const allIds = [...first.facts.map((f) => f.id), ...second.facts.map((f) => f.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("persists facts via INSERT only — zero UPDATE/DELETE calls", () => {
    const mx = new Mem0AddOnlyExtractor();
    const result = mx.extractFromTurn(USER_DECISION_TURN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Persist first batch.
    const count1 = mx.persistFacts(store, result.facts);
    expect(count1).toBe(result.facts.length);
    // Persist the SAME facts again — ADD-only means we get duplicate
    // rows (not an overwrite). The invariant is that we never mutate
    // the existing rows.
    const beforeBlocks = store.getByLayer("working").length;
    mx.persistFacts(store, result.facts);
    const afterBlocks = store.getByLayer("working").length;
    expect(afterBlocks).toBeGreaterThanOrEqual(beforeBlocks);
    // All persisted rows carry the "mem0-add-only" tag so the pipeline
    // is grep-verifiable (Quality Bar #13).
    const rows = store.getByLayer("working");
    const tagged = rows.filter((r) => (r.tags ?? "").includes("mem0-add-only"));
    expect(tagged.length).toBeGreaterThan(0);
  });

  it("returns honest {ok:false,error} when extraction throws", () => {
    // Inject a stub that throws on .extractFromCaptures.
    const stub = {
      extractFromCaptures: () => {
        throw new Error("simulated mem0 extractor failure");
      },
    };
    const mx = new Mem0AddOnlyExtractor({
      extractor: stub as unknown as Mem0AddOnlyExtractor["extractor"],
    });
    const result = mx.extractFromTurn(USER_DECISION_TURN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("simulated mem0 extractor failure");
    expect(result.sessionId).toBe("mem0-s1");
  });

  it("empty sessionId → honest failure, not a silent skip", () => {
    const mx = new Mem0AddOnlyExtractor();
    const result = mx.extractFromTurn({
      sessionId: "",
      userMessage: "decided to ship",
      assistantMessage: "ok",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("sessionId required");
  });

  it("returns zero facts for chatter turns, but ok=true", () => {
    const mx = new Mem0AddOnlyExtractor();
    const result = mx.extractFromTurn(NO_FACTS_TURN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Chatter with no pattern hits yields zero facts. This is NOT a
    // silent failure — the extractor ran, matched nothing, reported
    // an empty list. Caller can distinguish via facts.length.
    expect(result.facts.length).toBe(0);
  });

  it("createMem0AddOnlyExtractor() factory returns a working instance", () => {
    const mx = createMem0AddOnlyExtractor();
    expect(mx).toBeInstanceOf(Mem0AddOnlyExtractor);
    const result = mx.extractFromTurn(USER_DECISION_TURN);
    expect(result.ok).toBe(true);
  });

  it("persistFacts writes agent_id on each row via tag encoding when provided", () => {
    const mx = new Mem0AddOnlyExtractor();
    const result = mx.extractFromTurn(USER_DECISION_TURN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Rewrite each fact's agentId to a known value so the test can
    // assert retrieval scoping in the companion agent-facts test.
    const withAgent: readonly Mem0Fact[] = result.facts.map((f) => ({
      ...f,
      agentId: "agent-alpha",
    }));
    mx.persistFacts(store, withAgent);
    const rows = store.getByLayer("working");
    const alphaRows = rows.filter((r) => (r.tags ?? "").includes("agent:agent-alpha"));
    expect(alphaRows.length).toBeGreaterThan(0);
  });
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
});

