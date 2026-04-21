/**
 * Mem0 v3 single-pass ADD-only fact extractor.
 *
 * Ports Mem0 v3's "token-efficient" algorithm (93.4% LongMemEval-S,
 * +53.6pp on single-session-assistant, +42.1pp on temporal reasoning —
 * see `docs/internal/RESEARCH_LONGMEMEVAL_SYSTEMS_DEEP.md` §1.4).
 *
 * The Mem0 v2→v3 delta in two lines:
 *   - v2 used two passes: extract facts, then reconcile with the store
 *     via ADD / UPDATE / DELETE. UPDATE sometimes overwrote relevant
 *     info; DELETE sometimes removed info that became relevant later.
 *   - v3 uses ONE pass: extract facts, persist them as ADD only. New
 *     facts live alongside old facts — no reconciliation, no lost info.
 *
 * The other v3 win (the one that moved single-session-assistant from
 * 46.4% to 100%) is giving agent-emitted sentences user-equal priority
 * — "I've booked your flight" is a fact about the world, not chatter.
 * The WOTANN port honours this by tagging each extracted fact with
 * `role: "user" | "agent"` (see `agent-facts.ts`).
 *
 * Design decisions (Quality Bar #6, #7, #11, #13, #14):
 *
 *   (1) Honest ADD-only invariant. This module persists facts via
 *       `store.insert()` only. It never calls `store.replace()`,
 *       `store.archive()`, or any UPDATE/DELETE SQL. A grep over this
 *       file will confirm the invariant; the tests exercise it.
 *
 *   (2) Reuse of `ObservationExtractor`. WOTANN already has a tuned
 *       pattern-based extractor for observations (decision / preference
 *       / milestone / problem / discovery). Duplicating those regexes
 *       here would violate the "no duplicate patterns" bar and create
 *       drift between Observer-lane and Mem0-lane extraction. We call
 *       the existing extractor twice per turn — once on the USER half,
 *       once on the ASSISTANT half — then stamp `role` on the output.
 *       This is how Mem0 v3 gets agent-facts for free.
 *
 *   (3) Per-session state NONE. This extractor is stateless — every
 *       call to extractFromTurn() is independent. Per-session state
 *       (pending buffers, flush windows) lives in the Observer
 *       (`observer.ts`); this module is the extraction atom.
 *
 *   (4) Honest failure on extractor throw. Returns `{ok:false, error}`
 *       with the session id so the caller can tally failures. Never
 *       returns a silent empty array on internal failure.
 *
 *   (5) Grep-verifiable provenance. Every fact persisted via this
 *       module carries the `mem0-add-only` tag on the memory_entries
 *       row. An auditor can run:
 *
 *           SELECT COUNT(*) FROM memory_entries WHERE tags LIKE '%mem0-add-only%'
 *
 *       to confirm the v3 path is actually firing.
 *
 * This module is the PURE extractor. Persistence goes through
 * `recordAgentFact()` from `agent-facts.ts`, which owns the tag
 * convention and the scoping semantics. Persistence is exposed here
 * as `persistFacts()` — a thin convenience that loops
 * `recordAgentFact` over the result list.
 */

import { randomUUID } from "node:crypto";
import {
  ObservationExtractor,
  type Observation,
  type ObservationType,
} from "./observation-extractor.js";
import type { MemoryStore } from "./store.js";
import { recordAgentFact, type AgentFact } from "./agent-facts.js";

// ── Agent-fact patterns (Mem0 v3 key differentiator) ───
//
// The standard ObservationExtractor catches decisions, preferences,
// milestones, problems, discoveries — patterns optimized for user
// messages. Mem0 v3's +53.6pp single-session-assistant gain comes from
// ALSO extracting assistant-emitted ACTION-COMPLETION sentences ("I've
// booked your flight", "I've sent the email", "I scheduled the call"):
// these are facts about the world that the agent just created, and
// prior Mem0 v2 ignored them.
//
// Patterns below target first-person agent assertions. They are
// intentionally narrow — high-precision at the cost of recall — so
// chatter ("I'll help you", "I can do that") doesn't get persisted.
// The verb list covers the common action-completion verbs used in
// agent outputs across WOTANN's task surface.
const AGENT_ACTION_VERBS = [
  "booked",
  "scheduled",
  "created",
  "sent",
  "saved",
  "deleted",
  "updated",
  "installed",
  "deployed",
  "committed",
  "pushed",
  "merged",
  "opened",
  "closed",
  "submitted",
  "configured",
  "added",
  "removed",
  "renamed",
  "moved",
] as const;

// Matches: "I've booked ...", "I booked ...", "I have scheduled ..."
// Restricts to a first-person subject to avoid matching user
// reports — an agent-fact must be agent-authored.
const AGENT_FACT_PATTERN = new RegExp(
  `\\bI(?:'ve| have| just)?\\s+(?:${AGENT_ACTION_VERBS.join("|")})\\b`,
  "i",
);

/**
 * Extract agent-action facts from a single assistant message. These
 * complement the standard ObservationExtractor patterns for the
 * Mem0 v3 agent-facts priority win. Returns `[]` when no pattern
 * matches — NOT a silent failure, just a no-match.
 */
function extractAgentActionFacts(
  assistantMessage: string,
  sessionId: string,
  turnCompletedAt: number,
  extractedAt: number,
  agentId: string | undefined,
): readonly Mem0Fact[] {
  const trimmed = assistantMessage.trim();
  if (!AGENT_FACT_PATTERN.test(trimmed)) return [];

  // Split into sentences on '.','!','?' boundaries; only keep the
  // ones that match the agent-fact pattern. This avoids picking up
  // mid-sentence chatter when the bulk of the message is other text.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && AGENT_FACT_PATTERN.test(s));

  if (sentences.length === 0) return [];

  const facts: Mem0Fact[] = [];
  for (const sentence of sentences) {
    facts.push({
      id: randomUUID(),
      sessionId,
      agentId,
      role: "agent",
      type: "fact",
      assertion: sentence.slice(0, 500),
      confidence: 0.9, // high confidence — verb-bound agent action
      extractedAt,
      turnCompletedAt,
    });
  }
  return facts;
}

// ── Types ──────────────────────────────────────────────

/** One conversational turn fed into the Mem0 v3 extractor. */
export interface Mem0Turn {
  readonly sessionId: string;
  /** Agent identity this turn belongs to. Optional — pass-through on facts. */
  readonly agentId?: string;
  readonly userMessage: string;
  readonly assistantMessage: string;
  /** Unix ms when the turn completed. Defaults to Date.now() at extract. */
  readonly completedAt?: number;
}

/**
 * One fact as emitted by the Mem0 v3 single-pass extractor. Shape is
 * a proper subset of `AgentFact`: callers who want to persist without
 * setting up agent-id context can read these and call recordAgentFact
 * after stamping the agent id.
 */
export interface Mem0Fact {
  readonly id: string;
  readonly sessionId: string;
  readonly agentId?: string;
  readonly role: "user" | "agent";
  readonly type: ObservationType | "fact";
  readonly assertion: string;
  readonly confidence: number;
  readonly extractedAt: number;
  readonly turnCompletedAt: number;
  readonly domain?: string;
  readonly topic?: string;
}

export interface Mem0ExtractOk {
  readonly ok: true;
  readonly sessionId: string;
  readonly facts: readonly Mem0Fact[];
}

export interface Mem0ExtractErr {
  readonly ok: false;
  readonly sessionId: string;
  readonly error: string;
}

export type Mem0ExtractResult = Mem0ExtractOk | Mem0ExtractErr;

export interface Mem0AddOnlyOptions {
  /** Extractor to reuse. Default: one per instance. */
  readonly extractor?: ObservationExtractor;
}

// ── Extractor engine ───────────────────────────────────

export class Mem0AddOnlyExtractor {
  /**
   * Kept on `this` so tests can inject a stub for failure-path
   * coverage (Quality Bar #6 — honest failure, not silent).
   */
  readonly extractor: ObservationExtractor;

  constructor(options: Mem0AddOnlyOptions = {}) {
    this.extractor = options.extractor ?? new ObservationExtractor();
  }

  /**
   * Single-pass extract. Runs the WOTANN pattern extractor once per
   * role half (user, assistant) of the turn and flattens the output
   * into a Mem0 v3 fact list. The ADD-only invariant is structural:
   * this method is read-only against the store and produces a fresh,
   * non-reconciled fact list every call.
   *
   * Agent-emitted sentences from `assistantMessage` are tagged
   * role="agent" — this is the Mem0 v3 agent-facts priority win.
   */
  extractFromTurn(turn: Mem0Turn): Mem0ExtractResult {
    if (!turn.sessionId || turn.sessionId.length === 0) {
      return { ok: false, sessionId: "", error: "Mem0AddOnlyExtractor: sessionId required" };
    }
    const completedAt = turn.completedAt ?? Date.now();
    const extractedAt = Date.now();

    let userObs: readonly Observation[];
    let agentObs: readonly Observation[];
    try {
      userObs = this.extractor.extractFromCaptures([
        {
          id: 0,
          eventType: "mem0-user-turn",
          toolName: "mem0",
          content: turn.userMessage,
          sessionId: turn.sessionId,
          createdAt: new Date(completedAt).toISOString(),
        },
      ]);
      agentObs = this.extractor.extractFromCaptures([
        {
          id: 0,
          eventType: "mem0-assistant-turn",
          toolName: "mem0",
          content: turn.assistantMessage,
          sessionId: turn.sessionId,
          createdAt: new Date(completedAt).toISOString(),
        },
      ]);
    } catch (err) {
      return {
        ok: false,
        sessionId: turn.sessionId,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const facts: Mem0Fact[] = [];
    for (const obs of userObs) {
      facts.push(observationToFact(obs, turn, "user", extractedAt, completedAt));
    }
    for (const obs of agentObs) {
      facts.push(observationToFact(obs, turn, "agent", extractedAt, completedAt));
    }
    // Mem0 v3's agent-fact pattern — catches action-completion
    // sentences the base observation patterns miss. This is what
    // closed the single-session-assistant blind spot for Mem0 v3.
    const agentActionFacts = extractAgentActionFacts(
      turn.assistantMessage,
      turn.sessionId,
      completedAt,
      extractedAt,
      turn.agentId,
    );
    for (const fact of agentActionFacts) {
      facts.push(fact);
    }

    return { ok: true, sessionId: turn.sessionId, facts };
  }

  /**
   * Persist a batch of facts via ADD-only. Thin wrapper over
   * `recordAgentFact` — enforces that every fact has an `agentId`
   * before writing. If `agentId` is missing, falls back to the
   * sessionId so the fact still scopes per-session (Mem0 v3 with a
   * single agent collapses to session scope). Returns the count of
   * rows written.
   *
   * Honest failure propagates — if the store throws on insert (e.g.,
   * disk full, constraint violation), the exception bubbles so the
   * caller can react. We do NOT swallow writes silently.
   */
  persistFacts(store: MemoryStore, facts: readonly Mem0Fact[]): number {
    let written = 0;
    for (const fact of facts) {
      // ADD-only means each persist is a fresh write event. Generate
      // a new row id per persist so re-persisting the same fact list
      // produces additive rows instead of a UNIQUE constraint error.
      // This is the structural definition of ADD-only: the logical
      // fact identity (fact.id) is preserved in the fact object, but
      // the row identity on disk is always fresh.
      const agentFact: AgentFact = {
        id: randomUUID(),
        agentId: fact.agentId && fact.agentId.length > 0 ? fact.agentId : fact.sessionId,
        sessionId: fact.sessionId,
        role: fact.role,
        // AgentFact's type is a proper superset; the `"fact"` case
        // aligns with "discovery" block semantics.
        type: mem0TypeToAgentFactType(fact.type),
        assertion: fact.assertion,
        confidence: fact.confidence,
        extractedAt: fact.extractedAt,
        domain: fact.domain,
        topic: fact.topic,
      };
      recordAgentFact(store, agentFact);
      written += 1;
    }
    return written;
  }
}

// ── Helpers ────────────────────────────────────────────

function observationToFact(
  obs: Observation,
  turn: Mem0Turn,
  role: "user" | "agent",
  extractedAt: number,
  turnCompletedAt: number,
): Mem0Fact {
  return {
    id: obs.id.length > 0 ? obs.id : randomUUID(),
    sessionId: turn.sessionId,
    agentId: turn.agentId,
    role,
    type: obs.type,
    assertion: obs.assertion,
    confidence: obs.confidence,
    extractedAt,
    turnCompletedAt,
    domain: obs.domain,
    topic: obs.topic,
  };
}

function mem0TypeToAgentFactType(type: Mem0Fact["type"]): AgentFact["type"] {
  // Mem0Fact's type is a superset (includes "fact" alongside the 5
  // observation types). Pass through — AgentFact accepts the same set.
  return type;
}

// ── Factory ────────────────────────────────────────────

/** Factory helper mirroring the pattern used elsewhere in memory/. */
export function createMem0AddOnlyExtractor(options: Mem0AddOnlyOptions = {}): Mem0AddOnlyExtractor {
  return new Mem0AddOnlyExtractor(options);
}
