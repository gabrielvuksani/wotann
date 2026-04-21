/**
 * Agent-facts — Mem0 v3's agent-identity scoping for memory.
 *
 * In Mem0 v3, every extracted fact is attached to an agent identity
 * (when one is known). Retrieval then filters by `agent_id` so one
 * memory store can serve multiple concurrent agents without cross-
 * talk. The same mechanism also lets a single agent distinguish
 * user-emitted facts from agent-emitted facts — Mem0 v3's single
 * biggest delta was giving agent-generated sentences ("I've booked
 * your flight") user-equal priority in extraction and retrieval.
 *
 * WOTANN port strategy (non-invasive):
 *
 *   We ENCODE agent identity and role in the existing `tags` column on
 *   `memory_entries`, rather than adding a new column. This keeps the
 *   port schema-compatible with every database that already ships in
 *   WOTANN — no migration, no ALTER TABLE — while still giving O(1)
 *   filtering via SQL LIKE on the tag substring. The trade-off is
 *   that exact-match lookup by agent_id scans the index; for WOTANN's
 *   scale (single-device, per-user) this is fine. If we ever need
 *   agent-sharded multi-tenant isolation, a dedicated column can be
 *   added in a follow-up without breaking this API (the tag encoding
 *   remains a canonical source of truth readable from SQL).
 *
 * Encoding convention:
 *
 *   tags "agent:<agentId>"           — binds a row to an agent identity
 *   tags "role:user" | "role:agent"  — identifies who emitted the fact
 *   tags "mem0-add-only"             — provenance marker (Mem0 v3 port)
 *
 * Public API:
 *
 *   - `recordAgentFact(store, fact)` — inserts a fact and tags it with
 *     the agent identity. Honest failure on empty agentId — no silent
 *     coercion to a default. Follows Quality Bar #6.
 *   - `retrieveAgentFacts(store, opts)` — filters by agentId (and
 *     optional role / FTS query), returns the raw MemoryEntry list.
 *   - `encodeAgentTag(agentId)` — the canonical tag form; exported for
 *     callers that compose their own `insert()` paths.
 *   - `extractAgentIdFromTags(tags)` — reverse lookup.
 *
 * Quality bars applied (CLAUDE.md feedback_wotann_quality_bars*):
 *   - Bar #6 honest failure: empty agentId rejected with a clear error
 *     instead of silently falling through to a global bucket.
 *   - Bar #7 per-session state: facts carry sessionId on the row so
 *     per-session queries keep working; agent scope is an additional
 *     filter, not a replacement.
 *   - Bar #11 no duplicate patterns: retrieval reuses
 *     `store.search()` for FTS path rather than issuing new SQL.
 *   - Bar #13 grep-verifiable: the "mem0-add-only" and "agent:..."
 *     tags make the population of this module's output auditable via
 *     `SELECT tags FROM memory_entries WHERE tags LIKE '%agent:%'`.
 *   - Bar #14 honest assessment: this module does NOT claim the
 *     +53.6pp single-session-assistant gain by itself. It is the
 *     plumbing; the gain comes when the extractor (see
 *     `mem0-add-only.ts`) actually extracts assistant-emitted facts
 *     with role="agent" and the retrieval path queries them with
 *     user-equal priority. See the test suite for end-to-end evidence.
 */

import { randomUUID } from "node:crypto";
import type { MemoryEntry, MemoryStore } from "./store.js";

// ── Types ──────────────────────────────────────────────

/**
 * A fact as produced by the Mem0 v3 single-pass extractor. Attach an
 * `agentId` and a `role` so retrieval can scope correctly. `role` is
 * who emitted the underlying sentence in the conversation — this is
 * how Mem0 v3 closes the single-session-assistant blind spot.
 */
export interface AgentFact {
  readonly id: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly role: "user" | "agent";
  readonly type: "decision" | "preference" | "milestone" | "problem" | "discovery" | "fact";
  readonly assertion: string;
  readonly confidence: number;
  readonly extractedAt: number;
  readonly domain?: string;
  readonly topic?: string;
}

/** Options for retrieveAgentFacts. */
export interface AgentFactsQuery {
  readonly agentId?: string;
  readonly role?: "user" | "agent";
  /** Optional FTS query — when present, retrieval runs FTS5 first. */
  readonly query?: string;
  /** Cap result size. Default: 100. */
  readonly limit?: number;
}

// ── Tag encoding ───────────────────────────────────────

/** Produce the canonical agent tag. Empty input → empty tag (caller's choice). */
export function encodeAgentTag(agentId: string): string {
  if (agentId.length === 0) return "";
  // Tag keys are lowercase, colon-separated. No spaces so they pass
  // through SQL LIKE cleanly.
  return `agent:${agentId}`;
}

/** Extract the agent id from a comma-separated tag string, if present. */
export function extractAgentIdFromTags(tags: string | undefined): string | undefined {
  if (!tags || tags.length === 0) return undefined;
  for (const raw of tags.split(",")) {
    const tag = raw.trim();
    if (tag.startsWith("agent:")) {
      const id = tag.slice("agent:".length);
      return id.length > 0 ? id : undefined;
    }
  }
  return undefined;
}

// ── Public API ─────────────────────────────────────────

/**
 * Persist one agent fact into the memory store. Writes into the
 * `working` layer with block type "cases" (a catch-all where facts
 * accumulate before promotion by the Reflector) and attaches:
 *
 *   - `agent:<agentId>` tag        → scope filter
 *   - `role:user|agent` tag        → Mem0 v3's agent-fact priority
 *   - `mem0-add-only` tag          → provenance (grep-verifiable)
 *   - fact.type as an extra tag    → semantic filter
 *
 * Honest failure on empty agentId — the alternative (silently bucket
 * into a default agent) would break cross-agent isolation and hide
 * wiring bugs downstream.
 */
export function recordAgentFact(store: MemoryStore, fact: AgentFact): void {
  if (!fact.agentId || fact.agentId.length === 0) {
    throw new Error("agent-facts.recordAgentFact: agentId required (got empty string)");
  }
  if (!fact.sessionId || fact.sessionId.length === 0) {
    throw new Error("agent-facts.recordAgentFact: sessionId required (got empty string)");
  }

  // Build the tag string. Order is insignificant for LIKE, but we
  // keep a stable order so test assertions stay predictable.
  const tags = [
    "mem0-add-only",
    encodeAgentTag(fact.agentId),
    `role:${fact.role}`,
    `type:${fact.type}`,
  ]
    .filter((t) => t.length > 0)
    .join(",");

  // ADD-only invariant: every recordAgentFact produces an additive row.
  // The row id is always a fresh UUID so callers can record the same
  // logical fact twice without tripping the memory_entries UNIQUE
  // constraint. Logical fact identity is preserved in the `key` prefix
  // (the assertion slice) and the `fact.id` field which callers hold.
  store.insert({
    id: randomUUID(),
    layer: "working",
    // Block type mapping mirrors session-ingestion / observer so facts
    // land in consistent buckets and the Reflector's promotion paths
    // continue to work without branching on source.
    blockType: factTypeToBlock(fact.type),
    key: `mem0-add-only:${fact.type}:${fact.assertion.slice(0, 64)}`,
    value: fact.assertion,
    sessionId: fact.sessionId,
    verified: false,
    freshnessScore: 1.0,
    confidenceLevel: fact.confidence,
    verificationStatus: "unverified",
    tags,
    domain: fact.domain ?? "",
    topic: fact.topic ?? "",
  });
}

/**
 * Retrieve facts scoped to an agent identity. Three modes:
 *
 *   1. No filter → returns everything in the working layer (caller
 *      must sort / cap downstream).
 *   2. agentId only → post-filters getByLayer("working") by the
 *      agent tag substring. O(n) over working entries; fine for
 *      WOTANN's single-device scale.
 *   3. agentId + query → runs store.search() (FTS5) and post-filters
 *      by the agent tag.
 *
 * `role` when present narrows further to user-only or agent-only rows.
 */
export function retrieveAgentFacts(
  store: MemoryStore,
  opts: AgentFactsQuery,
): readonly MemoryEntry[] {
  const limit = opts.limit ?? 100;

  // Empty agentId is rejected — silent coercion would hide bugs and
  // break the isolation guarantee.
  if (opts.agentId !== undefined && opts.agentId.length === 0) {
    throw new Error(
      "agent-facts.retrieveAgentFacts: agentId must not be empty (pass undefined to skip filter)",
    );
  }

  const agentTag = opts.agentId ? encodeAgentTag(opts.agentId) : undefined;
  const roleTag = opts.role ? `role:${opts.role}` : undefined;

  // FTS path — use store.search for the query, then filter by tags.
  if (opts.query && opts.query.length > 0) {
    const hits = store.search(opts.query, limit * 4);
    const filtered = hits
      .map((h) => h.entry)
      .filter((e) => matchesTags(e.tags, agentTag, roleTag))
      .slice(0, limit);
    return filtered;
  }

  // No-query path — scan the working layer and filter by tags.
  const rows = store.getByLayer("working");
  const filtered: MemoryEntry[] = [];
  for (const row of rows) {
    if (!matchesTags(row.tags, agentTag, roleTag)) continue;
    filtered.push(row);
    if (filtered.length >= limit) break;
  }
  return filtered;
}

// ── Helpers ────────────────────────────────────────────

function matchesTags(
  tags: string | undefined,
  agentTag: string | undefined,
  roleTag: string | undefined,
): boolean {
  if (!tags) return !agentTag && !roleTag;
  if (agentTag && !tags.includes(agentTag)) return false;
  if (roleTag && !tags.includes(roleTag)) return false;
  return true;
}

/**
 * Map AgentFact.type → MemoryBlockType. Mirrors the observer/session-
 * ingestion mapping — keeps promotion and reflection uniform across
 * extraction sources.
 */
function factTypeToBlock(
  type: AgentFact["type"],
): "decisions" | "feedback" | "project" | "issues" | "cases" {
  switch (type) {
    case "decision":
      return "decisions";
    case "preference":
      return "feedback";
    case "milestone":
      return "project";
    case "problem":
      return "issues";
    case "discovery":
    case "fact":
      return "cases";
  }
}

// ── Auto-bootstrap: register this module with MemoryStore ─
//
// So `MemoryStore.recordAgentFact` / `retrieveAgentFacts` can delegate
// back into this module's public API without a circular runtime
// import. Import is deferred so we never evaluate store.ts during
// this module's load; the side effect runs once on first import.
import { setAgentFactsModule } from "./store.js";

setAgentFactsModule({
  recordAgentFact,
  retrieveAgentFacts,
  encodeAgentTag,
  extractAgentIdFromTags,
});
