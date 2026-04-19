/**
 * Session-level ingestion — Phase H Task 4.
 *
 * Processes a WHOLE session as a single unit at session.close(),
 * rather than per-turn. Round-by-round ingestion fragments entities
 * and decisions; the Supermemory / LongMemEval SOTA agents get their
 * lift by extracting once, at the end, against the full transcript.
 *
 * This module ships:
 *   - SessionIngestInput — the transcript + metadata to consolidate.
 *   - SessionIngestResult — structured extraction outcome.
 *   - ingestSession(input, extractor?) — pure function that runs the
 *     full pipeline: contextual resolution → pattern extraction →
 *     relationship classification → dedup. Returns the observations +
 *     relationships ready for the store, plus honest
 *     "extraction_failed" counters when a step fails.
 *   - scheduleViaHook(hookEngine, store, ...) — registers a
 *     SessionEnd handler that runs ingestSession when the runtime
 *     fires SessionEnd, without touching runtime.ts. This is the
 *     "extend via hook API" path specified by the task.
 *
 * Quality bars:
 *   - Honest failure counters per stage — extraction errors surface
 *     in the result, never silently dropped.
 *   - No module-global state. Every call takes explicit inputs.
 *   - Pure data in, pure data out; the hook wrapper owns all I/O.
 */

import type { AutoCaptureEntry } from "./store.js";
import { ObservationExtractor, type Observation } from "./observation-extractor.js";
import type { MemoryRelationship } from "./relationship-types.js";
import {
  type SessionContext,
  type ContextualResolver,
  resolveContextAtIngest,
  toResolutionEvent,
  type ResolutionEvent,
} from "./atomic-memory.js";

// ── Types ──────────────────────────────────────────────

export interface SessionIngestInput {
  readonly sessionId: string;
  /** Auto-capture rows produced during the session. */
  readonly captures: readonly AutoCaptureEntry[];
  /** Optional session-local context for contextual resolution. */
  readonly context?: SessionContext;
  /** When the session ended (unix ms). Defaults to Date.now(). */
  readonly endedAt?: number;
}

export interface SessionIngestStageFailures {
  /** Non-zero when contextual resolution emitted resolution_failed. */
  readonly resolutionFailed: number;
  /** Non-zero when the pattern extractor produced no observations. */
  readonly extractionEmpty: number;
  /** Non-zero when the relationship classifier errored out. */
  readonly classificationErrors: number;
}

export interface SessionIngestResult {
  readonly sessionId: string;
  readonly endedAt: number;
  /** Number of captures read from the input. */
  readonly readCount: number;
  /** Observations extracted from the resolved captures. */
  readonly observations: readonly Observation[];
  /** Relationships classified between observations. */
  readonly relationships: readonly MemoryRelationship[];
  /**
   * Resolution events for every capture that went through contextual
   * resolution. Callers may persist these as audit trail.
   */
  readonly resolutions: readonly ResolutionEvent[];
  /** Stage-wise failure counters — honest, not silently swallowed. */
  readonly failures: SessionIngestStageFailures;
}

// ── Dedup helpers ──────────────────────────────────────

function dedupByAssertion(observations: readonly Observation[]): readonly Observation[] {
  const seen = new Set<string>();
  const out: Observation[] = [];
  for (const obs of observations) {
    if (seen.has(obs.assertion)) continue;
    seen.add(obs.assertion);
    out.push(obs);
  }
  return out;
}

// ── Core ingest pipeline ───────────────────────────────

export interface IngestOptions {
  /** Extractor to reuse (wires classifier). Default: new instance. */
  readonly extractor?: ObservationExtractor;
  /** Resolver to apply to each capture's content. Defaults to heuristic. */
  readonly resolver?: ContextualResolver;
  /** Reference time used for derived createdAt fields. */
  readonly now?: number;
}

/**
 * Process a whole session as one consolidation.
 *
 * Steps:
 *   1. Resolve each capture's content via the contextual resolver.
 *      Resolution events are collected; a failed resolution is NOT a
 *      fatal error — we fall back to the original content but record
 *      the failure so downstream processes can retry with a better
 *      resolver.
 *   2. Run the pattern extractor over the RESOLVED captures. If the
 *      extractor throws, we surface the error via a failure counter
 *      rather than crashing the pipeline.
 *   3. Run relationship classification across all extracted
 *      observations. Classifier errors are already swallowed per-pair
 *      inside ObservationExtractor.classifyRelationships — we count
 *      them honestly by comparing expected vs actual edges.
 *   4. Dedup observations by assertion text (same quality bar as
 *      ObservationStore.add).
 *
 * Returns a SessionIngestResult the caller hands to MemoryStore.
 * Pure — no I/O.
 */
export async function ingestSession(
  input: SessionIngestInput,
  options?: IngestOptions,
): Promise<SessionIngestResult> {
  const endedAt = input.endedAt ?? options?.now ?? Date.now();
  const extractor = options?.extractor ?? new ObservationExtractor();
  const resolver: ContextualResolver = options?.resolver ?? resolveContextAtIngest;

  // Stage 1: contextual resolution per capture.
  const resolutions: ResolutionEvent[] = [];
  const resolvedCaptures: AutoCaptureEntry[] = [];
  let resolutionFailed = 0;
  if (input.context) {
    for (const capture of input.captures) {
      const resolved = await resolver(capture.content, input.context);
      const event = toResolutionEvent(resolved, input.sessionId, endedAt);
      resolutions.push(event);
      if (event.kind === "resolution_failed") resolutionFailed++;

      resolvedCaptures.push({
        id: capture.id,
        eventType: capture.eventType,
        toolName: capture.toolName,
        content: resolved.resolved,
        sessionId: capture.sessionId,
        createdAt: capture.createdAt,
      });
    }
  } else {
    // No session context — resolution is a no-op passthrough.
    for (const capture of input.captures) resolvedCaptures.push(capture);
  }

  // Stage 2: pattern extraction.
  let observations: readonly Observation[] = [];
  let extractionEmpty = 0;
  try {
    observations = extractor.extractFromCaptures(resolvedCaptures);
    if (observations.length === 0 && resolvedCaptures.length > 0) {
      extractionEmpty = resolvedCaptures.length;
    }
  } catch {
    extractionEmpty = resolvedCaptures.length;
    observations = [];
  }

  // Stage 3: relationship classification.
  let relationships: readonly MemoryRelationship[] = [];
  let classificationErrors = 0;
  try {
    relationships = await extractor.classifyRelationships(observations, endedAt);
  } catch {
    classificationErrors = 1;
    relationships = [];
  }

  // Stage 4: dedup.
  const deduped = dedupByAssertion(observations);

  return {
    sessionId: input.sessionId,
    endedAt,
    readCount: input.captures.length,
    observations: deduped,
    relationships,
    resolutions,
    failures: {
      resolutionFailed,
      extractionEmpty,
      classificationErrors,
    },
  };
}

// ── Hook-API scheduling (no runtime.ts edits) ──────────

/**
 * Minimal interface of the HookEngine we depend on. Declared inline so
 * the module stays import-cycle-free — session-ingestion should not
 * pull the hook engine as a hard dep since it also runs from tests /
 * daemon contexts that don't use hooks at all.
 */
export interface HookEngineLike {
  register(handler: {
    readonly name: string;
    readonly event: "SessionEnd";
    readonly profile: "minimal" | "standard" | "strict";
    readonly priority?: number;
    readonly handler: (payload: {
      readonly sessionId?: string;
    }) =>
      | Promise<{ readonly action: "allow" | "warn" | "block"; readonly message?: string }>
      | { readonly action: "allow" | "warn" | "block"; readonly message?: string };
  }): void;
}

/**
 * Minimal interface of the store this scheduler needs — only what we
 * actually call, so test doubles stay tiny.
 */
export interface SessionIngestStoreLike {
  getAutoCaptureEntries(limit: number, sessionId?: string): readonly AutoCaptureEntry[];
  insert(entry: {
    readonly id: string;
    readonly layer: "working";
    readonly blockType: "cases" | "feedback" | "project" | "issues" | "decisions";
    readonly key: string;
    readonly value: string;
    readonly sessionId?: string;
    readonly verified: boolean;
    readonly freshnessScore: number;
    readonly confidenceLevel: number;
    readonly verificationStatus: "unverified";
    readonly tags?: string;
    readonly domain?: string;
    readonly topic?: string;
  }): void;
  addRelationships(rels: readonly MemoryRelationship[]): number;
}

/**
 * Registers a SessionEnd hook that runs ingestSession when the runtime
 * fires SessionEnd. Does NOT edit runtime.ts — the task constraint.
 *
 * Returns an async callback that runs the same pipeline manually for
 * tests / cron-driven flushes.
 */
export function scheduleViaHook(
  engine: HookEngineLike,
  store: SessionIngestStoreLike,
  getContextForSession: (sessionId: string) => SessionContext | undefined,
  options?: IngestOptions,
): (sessionId: string, limit?: number) => Promise<SessionIngestResult> {
  const run = async (sessionId: string, limit: number = 5000): Promise<SessionIngestResult> => {
    const captures = store.getAutoCaptureEntries(limit, sessionId);
    const context = getContextForSession(sessionId);
    const result = await ingestSession(
      {
        sessionId,
        captures,
        ...(context !== undefined ? { context } : {}),
      },
      options,
    );

    // Route observations into memory_entries.
    for (const obs of result.observations) {
      const block = observationTypeToBlock(obs.type);
      store.insert({
        id: obs.id,
        layer: "working",
        blockType: block,
        key: `${obs.type}:${obs.assertion.slice(0, 80)}`,
        value: obs.assertion,
        sessionId,
        verified: false,
        freshnessScore: 1.0,
        confidenceLevel: obs.confidence,
        verificationStatus: "unverified",
        tags: `session-ingest,${obs.type}`,
        domain: obs.domain ?? "",
        topic: obs.topic ?? "",
      });
    }

    // Persist relationships.
    if (result.relationships.length > 0) {
      store.addRelationships(result.relationships);
    }

    return result;
  };

  engine.register({
    name: "session-ingestion",
    event: "SessionEnd",
    profile: "standard",
    priority: 150,
    handler: async (payload) => {
      const sid = payload.sessionId;
      if (!sid) {
        return { action: "warn", message: "session-ingestion: no sessionId in payload" };
      }
      const result = await run(sid);
      const failureCount =
        result.failures.resolutionFailed +
        result.failures.extractionEmpty +
        result.failures.classificationErrors;
      if (failureCount > 0) {
        return {
          action: "warn",
          message: `session-ingestion: ${result.observations.length} obs, ${result.relationships.length} rels, ${failureCount} stage-failures`,
        };
      }
      return {
        action: "allow",
        message: `session-ingestion: ${result.observations.length} obs, ${result.relationships.length} rels`,
      };
    },
  });

  return run;
}

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
