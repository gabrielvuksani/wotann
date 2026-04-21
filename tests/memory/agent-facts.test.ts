/**
 * Tests for agent-facts scoping — Mem0 v3's agent-identity filter.
 *
 * In Mem0 v3, every fact is attached to an agent identity (when one is
 * known); retrieval filters by agent_id so the same memory store can
 * serve multiple agents without cross-talk. WOTANN ports this via a
 * non-invasive tag encoding (so existing DBs don't need migration):
 *
 *   tags contains "agent:<agentId>" → the fact belongs to agentId
 *
 * Public API:
 *   - recordAgentFact(store, fact) — tags + inserts
 *   - retrieveAgentFacts(store, { agentId, query? }) — filter by tag
 *
 * Coverage:
 *  1. recordAgentFact round-trips through store.insert with agent tag.
 *  2. retrieveAgentFacts filters by agentId — no cross-agent bleed.
 *  3. retrieveAgentFacts with a query hits the FTS index.
 *  4. Without agentId, retrieveAgentFacts returns everything.
 *  5. agentId="" is rejected honestly (no silent coercion).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MemoryStore } from "../../src/memory/store.js";
import {
  recordAgentFact,
  retrieveAgentFacts,
  encodeAgentTag,
  extractAgentIdFromTags,
  type AgentFact,
} from "../../src/memory/agent-facts.js";

// ── Setup ──────────────────────────────────────────────

let tempDir: string;
let store: MemoryStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-facts-test-"));
  store = new MemoryStore(join(tempDir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────

function factFor(agentId: string, sessionId: string, assertion: string): AgentFact {
  return {
    id: `${agentId}-${assertion.slice(0, 12)}`,
    agentId,
    sessionId,
    role: "user",
    type: "decision",
    assertion,
    confidence: 0.8,
    extractedAt: Date.now(),
  };
}

// ── Tests ──────────────────────────────────────────────

describe("agent-facts", () => {
  it("encodeAgentTag produces deterministic `agent:<id>` tag", () => {
    expect(encodeAgentTag("agent-alpha")).toBe("agent:agent-alpha");
    expect(encodeAgentTag("")).toBe("");
  });

  it("extractAgentIdFromTags finds the agent tag in a mixed tag string", () => {
    expect(extractAgentIdFromTags("observer,decision,agent:agent-alpha,foo")).toBe("agent-alpha");
    expect(extractAgentIdFromTags("observer,decision")).toBeUndefined();
    expect(extractAgentIdFromTags("")).toBeUndefined();
    expect(extractAgentIdFromTags(undefined)).toBeUndefined();
  });

  it("recordAgentFact inserts into the store with the agent tag", () => {
    const fact = factFor("agent-alpha", "s1", "We decided to use OAuth 2.0");
    recordAgentFact(store, fact);
    const rows = store.getByLayer("working");
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect((row.tags ?? "").includes("agent:agent-alpha")).toBe(true);
    expect(row.value).toContain("OAuth 2.0");
  });

  it("retrieveAgentFacts filters by agentId — no cross-agent bleed", () => {
    recordAgentFact(store, factFor("agent-alpha", "s1", "Alpha chose OAuth 2.0"));
    recordAgentFact(store, factFor("agent-beta", "s1", "Beta chose SAML"));
    recordAgentFact(store, factFor("agent-alpha", "s1", "Alpha decided on Postgres"));

    const alphaOnly = retrieveAgentFacts(store, { agentId: "agent-alpha" });
    expect(alphaOnly.length).toBe(2);
    for (const row of alphaOnly) {
      expect((row.tags ?? "").includes("agent:agent-alpha")).toBe(true);
      expect((row.tags ?? "").includes("agent:agent-beta")).toBe(false);
    }

    const betaOnly = retrieveAgentFacts(store, { agentId: "agent-beta" });
    expect(betaOnly.length).toBe(1);
    expect((betaOnly[0]!.tags ?? "").includes("agent:agent-beta")).toBe(true);
  });

  it("retrieveAgentFacts with a query filters via FTS within agent scope", () => {
    recordAgentFact(store, factFor("agent-alpha", "s1", "Alpha chose OAuth 2.0 for auth"));
    recordAgentFact(store, factFor("agent-alpha", "s1", "Alpha uses Postgres for the database"));
    recordAgentFact(store, factFor("agent-beta", "s1", "Beta chose OAuth for mobile auth"));

    const oauthAlpha = retrieveAgentFacts(store, {
      agentId: "agent-alpha",
      query: "OAuth",
    });
    // Should only hit Alpha's OAuth row, not Beta's.
    expect(oauthAlpha.length).toBeGreaterThanOrEqual(1);
    for (const row of oauthAlpha) {
      expect((row.tags ?? "").includes("agent:agent-alpha")).toBe(true);
    }
    const values = oauthAlpha.map((r) => r.value).join(" ");
    expect(values).toContain("OAuth");
    // Grep verification: Beta's OAuth row must NOT appear.
    expect(values).not.toContain("mobile auth");
  });

  it("retrieveAgentFacts without agentId returns everything (no filter)", () => {
    recordAgentFact(store, factFor("agent-alpha", "s1", "Alpha chose OAuth"));
    recordAgentFact(store, factFor("agent-beta", "s1", "Beta chose SAML"));
    const all = retrieveAgentFacts(store, {});
    expect(all.length).toBe(2);
  });

  it("rejects empty agentId on write — no silent coercion", () => {
    const bad: AgentFact = factFor("", "s1", "orphan fact");
    expect(() => recordAgentFact(store, bad)).toThrow(/agentId required/);
  });

  it("rejects empty agentId on query with honest throw", () => {
    expect(() => retrieveAgentFacts(store, { agentId: "" })).toThrow(/agentId.*empty/);
  });

  it("record preserves session_id so per-session queries still work", () => {
    recordAgentFact(store, factFor("agent-alpha", "session-one", "fact for session one"));
    recordAgentFact(store, factFor("agent-alpha", "session-two", "fact for session two"));
    const rows = store.getByLayer("working");
    const sessionOneRows = rows.filter((r) => r.sessionId === "session-one");
    expect(sessionOneRows.length).toBe(1);
    const sessionTwoRows = rows.filter((r) => r.sessionId === "session-two");
    expect(sessionTwoRows.length).toBe(1);
  });

  it("role is encoded in tags for downstream assistant-vs-user filtering", () => {
    const fact = factFor("agent-alpha", "s1", "Booked flight to Reykjavik");
    const agentFact: AgentFact = { ...fact, role: "agent" };
    recordAgentFact(store, agentFact);
    const rows = store.getByLayer("working");
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect((row.tags ?? "").includes("role:agent")).toBe(true);
  });

  it("retrieveAgentFacts accepts a role filter ('user' or 'agent')", () => {
    recordAgentFact(store, {
      ...factFor("agent-alpha", "s1", "User said plan"),
      role: "user",
    });
    recordAgentFact(store, {
      ...factFor("agent-alpha", "s1", "Agent booked flight"),
      role: "agent",
    });
    const agentOnly = retrieveAgentFacts(store, { agentId: "agent-alpha", role: "agent" });
    expect(agentOnly.length).toBe(1);
    expect(agentOnly[0]!.value).toContain("flight");
    const userOnly = retrieveAgentFacts(store, { agentId: "agent-alpha", role: "user" });
    expect(userOnly.length).toBe(1);
    expect(userOnly[0]!.value).toContain("plan");
  });
});
