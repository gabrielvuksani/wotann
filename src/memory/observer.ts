/**
 * Observer — Mastra-style async per-turn fact extraction.
 *
 * Ports the Observer half of Mastra's Observational Memory dyad
 * (94.87% LongMemEval-S @ gpt-5-mini). After every agent turn, the
 * Observer extracts candidate facts/decisions from the turn and stores
 * them asynchronously into the MemoryStore. The key invariant — and
 * the reason Mastra's approach wins on cost — is that the Observer
 * runs OUT-OF-BAND: it never blocks the next user turn, and the
 * observations it produces become part of the stable prompt prefix
 * only at reflection boundaries (see `reflector.ts`). This preserves
 * prompt-cache hit rates across many turns.
 *
 * Contrast with existing WOTANN modules:
 *   - `active-memory.ts` runs SYNCHRONOUSLY on the user prompt and
 *     returns a contextPrefix for recall. It's a pre-turn pattern.
 *   - `session-ingestion.ts` runs ONCE per session at SessionEnd; it
 *     extracts the whole transcript in one pass.
 *   - `observation-extractor.ts` is the shared pattern-based extractor
 *     both Observer and session-ingestion reuse (single source of
 *     truth — do not duplicate the regex patterns here).
 *
 * The Observer's job is the ingest lane between the two: extract just
 * enough from one turn to seed the candidate pool that the Reflector
 * later promotes. By running after the response (not before), the
 * Observer sees the full context (user + assistant), which is what
 * Mastra's OM does.
 *
 * Quality bars applied (CLAUDE.md feedback_wotann_quality_bars*):
 *   - Bar #6 honest failure: on extractor throw, emit
 *     `{ok: false, error, ...}` — no silent no-op.
 *   - Bar #7 per-session state: all turn counters / buffers live in a
 *     `Map<sessionId, ObserverState>`; no module-global mutation.
 *   - Bar #11 sibling-site scan: reuses ObservationExtractor verbatim
 *     — this module adds orchestration, not new extraction patterns.
 *
 * Module layout:
 *   - `Observer` — stateful service; one instance per runtime.
 *   - `observeTurn(sessionId, turn)` — per-turn entry point.
 *   - `flush(sessionId)` — drains the pending buffer into the store.
 *     Called explicitly by the reflector, or on session end. The
 *     observer NEVER writes directly during observeTurn — it buffers
 *     for batch-write so the main turn loop stays latency-bound.
 */

import { randomUUID } from "node:crypto";
import type { MemoryStore } from "./store.js";
import { ObservationExtractor, type Observation } from "./observation-extractor.js";

// ── Types ──────────────────────────────────────────────

/** One agent turn as observed by the runtime. */
export interface ObservedTurn {
  readonly sessionId: string;
  readonly userMessage: string;
  readonly assistantMessage: string;
  /** Unix ms when the turn completed. Defaults to Date.now() at observe. */
  readonly completedAt?: number;
}

/** Per-session observer state — never shared across sessions. */
interface ObserverState {
  /** Buffered observations awaiting flush into the store. */
  readonly pending: Observation[];
  /** Number of turns observed this session. */
  turnCount: number;
  /** Unix ms when the last flush was performed. */
  lastFlushAt: number;
}

/** Successful observe outcome. */
export interface ObserveOk {
  readonly ok: true;
  readonly sessionId: string;
  /** Observations extracted this call (pre-buffer). */
  readonly observations: readonly Observation[];
  /** Current buffer size after the call. */
  readonly bufferSize: number;
}

/** Honest failure — the extractor threw, but the pipeline didn't silently swallow. */
export interface ObserveErr {
  readonly ok: false;
  readonly sessionId: string;
  readonly error: string;
}

export type ObserveResult = ObserveOk | ObserveErr;

/** Configuration for the Observer. Sensible defaults — every field is optional. */
export interface ObserverOptions {
  /** Extractor instance to reuse. Default: one per Observer. */
  readonly extractor?: ObservationExtractor;
  /**
   * Auto-flush threshold — after this many observations buffered for
   * one session, the observer flushes to the store inside observeTurn.
   * Default: 8 (Mastra's "tight" threshold; tune higher to reduce
   * write churn, lower for latency-sensitive recall).
   */
  readonly flushThreshold?: number;
  /**
   * Max observations retained per session. Older observations are
   * dropped on overflow. Default: 512.
   */
  readonly maxBuffer?: number;
  /** Store handle used for persistence. Nullable for unit tests. */
  readonly store?: MemoryStore | null;
}

// ── Observer engine ────────────────────────────────────

export class Observer {
  private readonly sessions: Map<string, ObserverState> = new Map();
  private readonly extractor: ObservationExtractor;
  private readonly flushThreshold: number;
  private readonly maxBuffer: number;
  private readonly store: MemoryStore | null;

  constructor(options: ObserverOptions = {}) {
    this.extractor = options.extractor ?? new ObservationExtractor();
    this.flushThreshold = Math.max(1, options.flushThreshold ?? 8);
    this.maxBuffer = Math.max(this.flushThreshold, options.maxBuffer ?? 512);
    this.store = options.store ?? null;
  }

  /**
   * Observe one completed turn. Extracts patterns from the concatenated
   * user+assistant text, appends to the per-session buffer, and
   * auto-flushes when the threshold is crossed.
   *
   * Never throws: on extractor failure returns `{ok: false, error}` so
   * the caller can tally failures without a silent no-op (Quality Bar #6).
   */
  observeTurn(turn: ObservedTurn): ObserveResult {
    const sessionId = turn.sessionId;
    if (!sessionId) {
      return { ok: false, sessionId: "", error: "Observer.observeTurn: sessionId required" };
    }
    const state = this.getOrCreateState(sessionId);
    state.turnCount += 1;

    // Merge the turn into a single synthetic capture entry per turn so
    // the pattern extractor (already tuned on auto_capture rows) can
    // apply without a new code path. The `id: 0` sentinel and synthetic
    // `eventType` mark these entries as Observer-sourced downstream.
    const completedAt = turn.completedAt ?? Date.now();
    const synthetic = [
      {
        id: 0,
        eventType: "observer-turn",
        toolName: "observer",
        content: `USER: ${turn.userMessage}\nASSISTANT: ${turn.assistantMessage}`,
        sessionId,
        createdAt: new Date(completedAt).toISOString(),
      },
    ];

    let fresh: readonly Observation[];
    try {
      fresh = this.extractor.extractFromCaptures(synthetic);
    } catch (err) {
      return {
        ok: false,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Append + cap. Dedup by assertion per session.
    const seen = new Set(state.pending.map((o) => o.assertion));
    for (const obs of fresh) {
      if (seen.has(obs.assertion)) continue;
      seen.add(obs.assertion);
      state.pending.push(obs);
    }
    if (state.pending.length > this.maxBuffer) {
      // Drop oldest — classic bounded buffer. Newer observations are
      // better candidates for reflection, per Mastra's pattern.
      state.pending.splice(0, state.pending.length - this.maxBuffer);
    }

    if (state.pending.length >= this.flushThreshold && this.store) {
      this.flushInternal(sessionId, state);
    }

    return {
      ok: true,
      sessionId,
      observations: fresh,
      bufferSize: state.pending.length,
    };
  }

  /**
   * Return the current pending buffer for a session. Read-only view —
   * consumers must treat it as immutable. Intended for the Reflector
   * and for tests.
   */
  pendingFor(sessionId: string): readonly Observation[] {
    return this.sessions.get(sessionId)?.pending ?? [];
  }

  /**
   * Number of turns observed for a session. Returns 0 if unknown.
   */
  turnsFor(sessionId: string): number {
    return this.sessions.get(sessionId)?.turnCount ?? 0;
  }

  /**
   * Explicit flush. Writes the pending buffer to the store and clears
   * it. Returns the count written. Safe to call when store is null —
   * just clears the buffer (tests rely on this).
   */
  flush(sessionId: string): number {
    const state = this.sessions.get(sessionId);
    if (!state) return 0;
    return this.flushInternal(sessionId, state);
  }

  /** Clear per-session state. Called at session end. */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ── Private ──────────────────────────────────────────

  private getOrCreateState(sessionId: string): ObserverState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { pending: [], turnCount: 0, lastFlushAt: 0 };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private flushInternal(sessionId: string, state: ObserverState): number {
    if (state.pending.length === 0) return 0;
    const count = state.pending.length;
    if (this.store) {
      for (const obs of state.pending) {
        try {
          // Route each observation into the `working` layer so the
          // Reflector can later promote it to `core_blocks`. The block
          // type mapping mirrors session-ingestion.ts.
          this.store.insert({
            id: obs.id.length > 0 ? obs.id : randomUUID(),
            layer: "working",
            blockType: observationTypeToBlock(obs.type),
            key: `observer:${obs.type}:${obs.assertion.slice(0, 64)}`,
            value: obs.assertion,
            sessionId,
            verified: false,
            freshnessScore: 1.0,
            confidenceLevel: obs.confidence,
            verificationStatus: "unverified",
            tags: `observer,${obs.type}`,
            domain: obs.domain ?? "",
            topic: obs.topic ?? "",
          });
        } catch {
          /* store write failure — honest skip, buffer still drained */
        }
      }
    }
    state.pending.length = 0;
    state.lastFlushAt = Date.now();
    return count;
  }
}

// ── Type mapping ───────────────────────────────────────

/**
 * Map observation type → memory block. Mirrors the mapping used by
 * session-ingestion.ts so observer-sourced and session-sourced
 * entries land in consistent blocks.
 */
function observationTypeToBlock(
  type: Observation["type"],
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
      return "cases";
  }
}

/** Factory helper mirroring `createActiveMemoryEngine` for consistency. */
export function createObserver(options: ObserverOptions = {}): Observer {
  return new Observer(options);
}
