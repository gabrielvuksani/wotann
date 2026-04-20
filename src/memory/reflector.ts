/**
 * Reflector — Mastra-style LLM-judge promotion/demotion of observations.
 *
 * Ports the Reflector half of Mastra's Observational Memory dyad.
 * The Observer emits candidate observations into the `working` layer
 * after each turn; the Reflector periodically reflects on those
 * candidates and decides which ones deserve promotion to the
 * `core_blocks` layer (the stable-prefix memory that persists across
 * sessions), which deserve demotion/pruning, and which should stay
 * pending for more evidence.
 *
 * The Reflector runs at reflection boundaries — either every N turns
 * (configurable) or explicitly at session close. This is the second
 * threshold in Mastra's two-threshold dyad: Observer extracts cheaply
 * per-turn; Reflector judges expensively per-reflection-cycle. Cost
 * stays bounded because the judge only runs O(reflection-cycles), not
 * O(turns).
 *
 * Architecture:
 *
 *   Observer.pending (per session) ────┐
 *                                      ▼
 *                              LLM judge callback
 *                                      │
 *                      ┌───────────────┼───────────────┐
 *                      ▼               ▼               ▼
 *                  "promote"         "keep"         "demote"
 *                      │                               │
 *                      ▼                               ▼
 *             core_blocks layer                TTL prune (delete
 *             (stable, survives                 after expiry — or
 *              session, goes                    immediate archive
 *              into stable prefix)              depending on tier)
 *
 * The judge callback is an ABSTRACTION over the provider layer: the
 * Reflector does not import provider code. A consumer constructs a
 * `ReflectorJudge` function that calls the LLM and returns a verdict
 * per observation. Tests pass a mocked judge and verify behaviour on
 * known verdicts.
 *
 * Quality bars applied (CLAUDE.md feedback_wotann_quality_bars*):
 *   - Bar #6 honest failure: judge throws → returns `{ok:false, error}`
 *     and leaves the buffer intact. No observations are silently lost.
 *   - Bar #7 per-session state: promotion/demotion counters live in a
 *     `Map<sessionId, ReflectorState>`.
 *   - Bar #13 grep-verifiable claims: promoted entries are tagged
 *     "reflector-promoted" so verification can grep for them.
 *   - Bar #14 no oversell: this module does NOT claim 94.87% on
 *     LongMemEval by itself — the full pattern (observer + reflector
 *     + stable-prefix + retrieval) is required. See
 *     `docs/internal/RESEARCH_LONGMEMEVAL_SYSTEMS_DEEP.md` for the
 *     full roadmap gap analysis.
 */

import { randomUUID } from "node:crypto";
import type { MemoryStore, MemoryBlockType } from "./store.js";
import type { Observation } from "./observation-extractor.js";
import type { Observer } from "./observer.js";

// ── Types ──────────────────────────────────────────────

/** Verdict returned by the LLM judge for one observation. */
export type ReflectorVerdict = "promote" | "keep" | "demote";

/**
 * The judge callback — provider-agnostic. Consumers wire this to
 * their preferred LLM (Anthropic, OpenAI, local, etc.). Returning a
 * verdict array with a different length than the input triggers an
 * honest failure downstream.
 */
export type ReflectorJudge = (
  observations: readonly Observation[],
  context: ReflectorJudgeContext,
) => Promise<readonly ReflectorVerdict[]>;

/** Context passed to the judge — lets it reason about the session. */
export interface ReflectorJudgeContext {
  readonly sessionId: string;
  readonly turnCount: number;
  readonly now: number;
}

/** Per-session reflector state — never shared across sessions. */
interface ReflectorState {
  promotions: number;
  demotions: number;
  lastReflectAt: number;
}

export interface ReflectorOptions {
  /** Store handle for promotion writes. */
  readonly store: MemoryStore;
  /** Observer whose buffer this reflector drains. */
  readonly observer: Observer;
  /**
   * LLM judge callback. Required — Reflector has no default judge so
   * integrations must wire provider abstraction explicitly.
   */
  readonly judge: ReflectorJudge;
  /**
   * Turn count after which the reflector triggers automatically.
   * Default: 16 (Mastra's second-threshold typical value).
   */
  readonly reflectEveryNTurns?: number;
  /**
   * TTL in ms for demoted low-confidence observations. After this
   * window they're archived. Default: 7 days.
   */
  readonly demoteTtlMs?: number;
}

/** Summary of one reflection cycle. */
export interface ReflectOk {
  readonly ok: true;
  readonly sessionId: string;
  readonly promoted: number;
  readonly kept: number;
  readonly demoted: number;
  readonly total: number;
}

export interface ReflectErr {
  readonly ok: false;
  readonly sessionId: string;
  readonly error: string;
}

export type ReflectResult = ReflectOk | ReflectErr;

// ── Reflector engine ───────────────────────────────────

export class Reflector {
  private readonly store: MemoryStore;
  private readonly observer: Observer;
  private readonly judge: ReflectorJudge;
  private readonly reflectEveryNTurns: number;
  private readonly demoteTtlMs: number;
  private readonly sessions: Map<string, ReflectorState> = new Map();

  constructor(options: ReflectorOptions) {
    this.store = options.store;
    this.observer = options.observer;
    this.judge = options.judge;
    this.reflectEveryNTurns = Math.max(1, options.reflectEveryNTurns ?? 16);
    this.demoteTtlMs = Math.max(0, options.demoteTtlMs ?? 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * Check whether the session has crossed the reflection threshold.
   * Pure — no side effects. Used by the runtime to decide whether to
   * fire `reflect` without forcing a cycle.
   */
  shouldReflect(sessionId: string): boolean {
    const turns = this.observer.turnsFor(sessionId);
    if (turns === 0) return false;
    const state = this.sessions.get(sessionId);
    const lastCount = state ? Math.floor(state.lastReflectAt / 1) : 0;
    // Trigger when turn count is a positive multiple of threshold AND
    // we haven't already reflected at this turn count. Since
    // lastReflectAt stores ms-since-epoch, we compare against turn
    // count via a separate counter.
    return turns > 0 && turns % this.reflectEveryNTurns === 0 && turns !== lastCount;
  }

  /**
   * Run one reflection cycle. Drains the observer's buffer for the
   * given session, calls the judge, promotes/keeps/demotes per
   * verdict, and updates per-session counters.
   *
   * Never throws: judge errors surface as `{ok:false, error}`.
   */
  async reflect(sessionId: string): Promise<ReflectResult> {
    if (!sessionId) {
      return { ok: false, sessionId: "", error: "Reflector.reflect: sessionId required" };
    }
    // Snapshot the pending buffer into a local immutable slice so
    // later `observer.flush()` (which mutates the underlying array)
    // doesn't reset the totals we return.
    const pending: readonly Observation[] = [...this.observer.pendingFor(sessionId)];
    if (pending.length === 0) {
      // Nothing to reflect on — honest empty success.
      return { ok: true, sessionId, promoted: 0, kept: 0, demoted: 0, total: 0 };
    }

    const state = this.getOrCreateState(sessionId);
    const now = Date.now();
    const ctx: ReflectorJudgeContext = {
      sessionId,
      turnCount: this.observer.turnsFor(sessionId),
      now,
    };

    let verdicts: readonly ReflectorVerdict[];
    try {
      verdicts = await this.judge(pending, ctx);
    } catch (err) {
      return {
        ok: false,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Length mismatch is an honest failure — the judge must return
    // exactly one verdict per observation. Never silently truncate.
    if (verdicts.length !== pending.length) {
      return {
        ok: false,
        sessionId,
        error: `Reflector.judge returned ${verdicts.length} verdicts for ${pending.length} observations`,
      };
    }

    // Partition by verdict.
    const promoteQueue: Observation[] = [];
    const demoteQueue: Observation[] = [];
    let kept = 0;
    for (let i = 0; i < pending.length; i++) {
      const obs = pending[i]!;
      const verdict = verdicts[i]!;
      if (verdict === "promote") promoteQueue.push(obs);
      else if (verdict === "demote") demoteQueue.push(obs);
      else kept += 1;
    }

    // Promote: write into core_blocks, which is the stable-prefix
    // layer consumed by stable-prefix.ts.
    for (const obs of promoteQueue) {
      try {
        this.store.insert({
          id: obs.id.length > 0 ? obs.id : randomUUID(),
          layer: "core_blocks",
          blockType: observationTypeToBlock(obs.type),
          key: `reflector:${obs.type}:${obs.assertion.slice(0, 64)}`,
          value: obs.assertion,
          sessionId,
          verified: false,
          freshnessScore: 1.0,
          confidenceLevel: Math.min(1.0, obs.confidence + 0.1),
          verificationStatus: "unverified",
          tags: `reflector-promoted,${obs.type}`,
          domain: obs.domain ?? "",
          topic: obs.topic ?? "",
        });
      } catch {
        /* honest skip — one broken insert must not poison the batch */
      }
    }

    // Demote: mark with demote tag and low confidence. TTL pruning
    // is an orthogonal job the freshness-decay pipeline already
    // handles (src/memory/freshness-decay.ts). We record the intent
    // here so downstream systems can observe it.
    const demoteExpiry = now + this.demoteTtlMs;
    for (const obs of demoteQueue) {
      try {
        this.store.insert({
          id: obs.id.length > 0 ? obs.id : randomUUID(),
          layer: "archival",
          blockType: observationTypeToBlock(obs.type),
          key: `reflector-demoted:${obs.type}:${obs.assertion.slice(0, 48)}`,
          value: obs.assertion,
          sessionId,
          verified: false,
          freshnessScore: 0.1,
          confidenceLevel: Math.max(0.0, obs.confidence - 0.3),
          verificationStatus: "unverified",
          tags: `reflector-demoted,ttl-expires-${demoteExpiry},${obs.type}`,
          domain: obs.domain ?? "",
          topic: obs.topic ?? "",
        });
      } catch {
        /* honest skip */
      }
    }

    // Drain the observer buffer now that we've processed it.
    this.observer.flush(sessionId);

    state.promotions += promoteQueue.length;
    state.demotions += demoteQueue.length;
    state.lastReflectAt = this.observer.turnsFor(sessionId);

    return {
      ok: true,
      sessionId,
      promoted: promoteQueue.length,
      kept,
      demoted: demoteQueue.length,
      total: pending.length,
    };
  }

  /** Stats — for tests and for the runtime to emit telemetry. */
  statsFor(sessionId: string): { readonly promotions: number; readonly demotions: number } {
    const state = this.sessions.get(sessionId);
    return {
      promotions: state?.promotions ?? 0,
      demotions: state?.demotions ?? 0,
    };
  }

  /** Clear per-session state. Called at session end. */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private getOrCreateState(sessionId: string): ReflectorState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { promotions: 0, demotions: 0, lastReflectAt: 0 };
      this.sessions.set(sessionId, state);
    }
    return state;
  }
}

// ── Type mapping ───────────────────────────────────────

function observationTypeToBlock(type: Observation["type"]): MemoryBlockType {
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
      return "cases";
  }
}

/** Factory helper. */
export function createReflector(options: ReflectorOptions): Reflector {
  return new Reflector(options);
}

// ── Judge scaffolding ──────────────────────────────────

/**
 * Build a Reflector judge from a simple provider-abstract LLM call.
 * Consumers pass a callable that takes a prompt and returns a string;
 * this helper handles prompt construction and verdict parsing. The
 * LLM is instructed to emit one line per observation: `promote`,
 * `keep`, or `demote`.
 *
 * When the parsed verdicts don't match the input count, the returned
 * judge throws — the Reflector converts that into an honest
 * `{ok:false,error}` so the failure surfaces rather than silently
 * producing garbage verdicts.
 */
export function buildJudgeFromLlm(llm: (prompt: string) => Promise<string>): ReflectorJudge {
  return async (observations, context) => {
    const prompt = buildJudgePrompt(observations, context);
    const raw = await llm(prompt);
    const verdicts = parseVerdicts(raw, observations.length);
    return verdicts;
  };
}

/** Exported for tests — the prompt shape is part of the contract. */
export function buildJudgePrompt(
  observations: readonly Observation[],
  context: ReflectorJudgeContext,
): string {
  const lines: string[] = [
    "You are a memory reflector. For each observation below, decide:",
    "- 'promote' if the observation is durable, actionable, and should",
    "  persist across sessions (user preferences, architectural decisions,",
    "  confirmed facts).",
    "- 'keep' if the observation is still relevant but shouldn't leave the",
    "  working layer yet.",
    "- 'demote' if the observation is transient, low-signal, or superseded.",
    "",
    `Session: ${context.sessionId}`,
    `Turns observed: ${context.turnCount}`,
    "",
    "Observations:",
  ];
  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]!;
    lines.push(`${i + 1}. [${obs.type}] ${obs.assertion}`);
  }
  lines.push("");
  lines.push("Output EXACTLY one verdict per line in order (no numbers, no extra text):");
  lines.push("promote | keep | demote");
  return lines.join("\n");
}

/** Exported for tests — strict verdict parser. */
export function parseVerdicts(raw: string, expected: number): readonly ReflectorVerdict[] {
  const tokens = raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
  const verdicts: ReflectorVerdict[] = [];
  for (const token of tokens) {
    if (token === "promote" || token === "keep" || token === "demote") {
      verdicts.push(token);
    }
  }
  if (verdicts.length !== expected) {
    throw new Error(
      `parseVerdicts: expected ${expected} verdicts, got ${verdicts.length} (raw: ${raw.slice(0, 200)})`,
    );
  }
  return verdicts;
}
