/**
 * Knowledge-update dynamics — Phase H Task 5.
 *
 * When a new fact contradicts an existing one ("User lives in Vancouver"
 * vs "I moved to Toronto"), ingestion auto-emits an `updates` edge from
 * the old to the new fact and stamps the old fact with invalidatedAt.
 *
 * MVP is rule-based: entity + predicate match with a freshness check.
 * LLM fallback is an optional upgrade callers can layer in via
 * createLlmContradictionDetector — future work.
 *
 * Contract:
 *   - detectSupersession(new, existing, options?) → supersession info
 *     when the new fact should supersede an existing one. Null when
 *     they peacefully coexist.
 *   - applySupersession(store, newEntry, existing, detection, now) →
 *     writes the updates edge + invalidates the predecessor's outbound
 *     non-updates edges. Caller-supplied store adapter keeps this
 *     module I/O-free when used from tests.
 *
 * Quality bars:
 *   - Honest: null when no supersession detected. Never guess.
 *   - Immutable inputs: the function returns new objects, nothing is
 *     mutated in place.
 *   - Per-detection state: no shared maps or global counters — every
 *     call is pure.
 */

import { randomUUID } from "node:crypto";
import type { MemoryRelationship } from "./relationship-types.js";

// ── Types ──────────────────────────────────────────────

export interface FactLike {
  /** Stable id for this memory entry. */
  readonly id: string;
  /** Entity being asserted about: "User", "Alice", "the deploy". */
  readonly entity: string;
  /** Predicate being asserted: "lives in", "uses", "deployed". */
  readonly predicate: string;
  /** Value/object of the assertion: "Vancouver", "Postgres", "v2.3.1". */
  readonly value: string;
  /** When this fact was recorded (unix ms). */
  readonly documentDate: number;
}

export interface SupersessionDetection {
  readonly predecessor: FactLike;
  readonly successor: FactLike;
  readonly reason: string;
  /**
   * Detection confidence 0-1. Rule-based detections cap at 0.85 —
   * reserve 0.85-1.0 for the LLM fallback so callers can triage by
   * threshold.
   */
  readonly confidence: number;
}

// ── Rule-based detector ────────────────────────────────

export interface DetectorOptions {
  /**
   * How recent the new fact must be to supersede — older "updates"
   * are rarely meaningful. Default: accept supersession if the
   * successor is AT LEAST as new as the predecessor.
   */
  readonly minDocumentDateDeltaMs?: number;
  /**
   * Case-sensitive entity match? Default false (case-insensitive).
   */
  readonly caseSensitive?: boolean;
}

function normalize(text: string, caseSensitive: boolean): string {
  const trimmed = text.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

/**
 * Detect whether `successor` supersedes `predecessor`. Rule: same
 * entity + same predicate + different value + successor is newer.
 *
 * Null when the facts aren't the same entity+predicate (peaceful
 * coexistence) or when the values match (idempotent restatement).
 */
export function detectSupersession(
  successor: FactLike,
  predecessor: FactLike,
  options?: DetectorOptions,
): SupersessionDetection | null {
  const caseSensitive = options?.caseSensitive ?? false;
  const minDelta = options?.minDocumentDateDeltaMs ?? 0;

  if (successor.id === predecessor.id) return null;

  const entA = normalize(successor.entity, caseSensitive);
  const entB = normalize(predecessor.entity, caseSensitive);
  if (entA !== entB) return null;

  const predA = normalize(successor.predicate, caseSensitive);
  const predB = normalize(predecessor.predicate, caseSensitive);
  if (predA !== predB) return null;

  const valA = normalize(successor.value, caseSensitive);
  const valB = normalize(predecessor.value, caseSensitive);
  if (valA === valB) return null;

  if (successor.documentDate - predecessor.documentDate < minDelta) return null;

  // Confidence decays when values share a token (e.g., "Vancouver, BC"
  // → "Vancouver, Canada" is less likely a supersession). Check token
  // overlap — high overlap = low confidence.
  const tokensA = new Set(valA.split(/\s+/).filter((t) => t.length > 2));
  const tokensB = new Set(valB.split(/\s+/).filter((t) => t.length > 2));
  let overlap = 0;
  for (const t of tokensA) if (tokensB.has(t)) overlap++;
  const denom = Math.max(tokensA.size, tokensB.size, 1);
  const overlapRatio = overlap / denom;
  const confidence = Math.min(0.85, 0.85 - overlapRatio * 0.4);

  return {
    predecessor,
    successor,
    reason: `same entity+predicate, value changed from "${predecessor.value}" to "${successor.value}"`,
    confidence,
  };
}

/**
 * Detect all supersessions between a new fact and a pool of existing
 * facts. Returns one detection per predecessor that the new fact
 * supersedes. Useful during batch ingest.
 */
export function detectSupersessionsInPool(
  successor: FactLike,
  pool: readonly FactLike[],
  options?: DetectorOptions,
): readonly SupersessionDetection[] {
  const out: SupersessionDetection[] = [];
  for (const candidate of pool) {
    const detection = detectSupersession(successor, candidate, options);
    if (detection) out.push(detection);
  }
  return out;
}

// ── Store adapter / apply ──────────────────────────────

export interface KnowledgeUpdateStoreAdapter {
  addRelationship(rel: MemoryRelationship): void;
  /**
   * Mark all non-updates edges outbound from the predecessor as
   * invalidated. Optional — stores without this surface skip it.
   */
  invalidatePredecessorEdges?: (predecessorId: string, at: number) => number;
}

/**
 * Write an `updates` edge for a detected supersession and invalidate
 * the predecessor's outbound non-updates edges so queries walking the
 * graph don't return stale facts.
 *
 * Returns the relationship that was written.
 */
export function applySupersession(
  store: KnowledgeUpdateStoreAdapter,
  detection: SupersessionDetection,
  now: number = Date.now(),
): MemoryRelationship {
  const rel: MemoryRelationship = {
    id: randomUUID(),
    fromId: detection.predecessor.id,
    toId: detection.successor.id,
    kind: "updates",
    confidence: detection.confidence,
    createdAt: now,
    rationale: detection.reason,
  };
  store.addRelationship(rel);
  store.invalidatePredecessorEdges?.(detection.predecessor.id, now);
  return rel;
}

// ── Assertion → FactLike parsers ──────────────────────

/**
 * Simple extractor for natural-language "S-V-O" assertions. Pattern:
 *   "<subject> <copula> <object>"
 *   with copulas like "is/was/are/lives in/moved to/uses/chose".
 * Returns null when the assertion doesn't match the pattern — honest.
 *
 * Used by ingest to decompose an Observation.assertion into a
 * FactLike so the rule-based detector can compare.
 */
const COPULAS: readonly string[] = [
  "lives in",
  "moved to",
  "is using",
  "uses",
  "chose",
  "switched to",
  "is",
  "was",
  "are",
  "works at",
];

export function parseAssertionAsFact(
  id: string,
  assertion: string,
  documentDate: number,
): FactLike | null {
  const cleaned = assertion.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return null;

  for (const copula of COPULAS) {
    const re = new RegExp(`^(.+?)\\s+${copula}\\s+(.+)$`, "i");
    const match = cleaned.match(re);
    if (match && match[1] && match[2]) {
      return {
        id,
        entity: match[1].trim(),
        predicate: copula,
        value: match[2].trim(),
        documentDate,
      };
    }
  }
  return null;
}
