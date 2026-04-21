/**
 * Bi-temporal knowledge edges — Zep/Graphiti port (Phase 2 P1-M5).
 *
 * Knowledge graphs that track when a fact is "true" in the real world AND
 * when WOTANN knew about it outperform single-axis graphs on both
 * knowledge-update and temporal-reasoning categories. Zep's Graphiti —
 * Apache-2.0, [arXiv:2501.13956] — achieves 94.8% on DMR (SOTA over
 * MemGPT 93.4%) by stamping each relationship edge with TWO time axes:
 *
 *   Knowledge-time axis (WHEN the fact was true in the world):
 *     - valid_from  → when the fact became true
 *     - valid_to    → when the fact stopped being true (null = still true)
 *
 *   Ingest-time axis (WHEN WOTANN learned the fact):
 *     - recorded_from → when the edge was first inserted
 *     - recorded_to   → when the edge was retracted (null = still known)
 *
 * The two axes are orthogonal. "The user was CEO from 2020 to 2023" is a
 * knowledge-time fact. "WOTANN learned this on 2026-04-20 and forgot it on
 * 2026-05-01" is the ingest-time fact. Both axes survive separately — the
 * retraction does not erase the historical claim.
 *
 * This module is pure (no I/O) — callers persist bi-temporal rows via
 * MemoryStore.addBiTemporalEdge. The knowledge-edges table already ships
 * valid_from/valid_to (M7 wiring). This module adds the missing
 * recorded_from/recorded_to axis and the query helpers that use both.
 *
 * Non-breaking: edges inserted before M5 have recorded_from = created_at,
 * recorded_to = null. Legacy readers keep working; new readers get full
 * bi-temporal fidelity.
 */

// ── Errors ────────────────────────────────────────────

/**
 * Thrown when a caller passes an invalid date to a bi-temporal query.
 * Honest-fail: we prefer an explicit error over silently returning []
 * so the caller can distinguish "no matches" from "broken query".
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Types ────────────────────────────────────────────

/**
 * An edge with both knowledge-time and ingest-time axes. ISO-8601
 * strings (UTC). Nullable `_to` fields mean "open-ended".
 */
export interface BiTemporalEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relation: string;
  readonly weight: number;
  /** When the fact became true in the world. ISO-8601. */
  readonly validFrom: string;
  /** When the fact stopped being true. null = still valid. */
  readonly validTo: string | null;
  /** When WOTANN first recorded the edge. ISO-8601. */
  readonly recordedFrom: string;
  /** When WOTANN retracted the edge. null = still known. */
  readonly recordedTo: string | null;
}

/**
 * Options for creating a bi-temporal edge. Defaults:
 *   - validFrom = now()
 *   - recordedFrom = now()
 *   - validTo = null (still valid)
 *   - recordedTo = null (still known)
 */
export interface BiTemporalInsertOptions {
  readonly validFrom?: string;
  readonly validTo?: string | null;
  readonly recordedFrom?: string;
  readonly weight?: number;
}

/**
 * A snapshot request that filters on both axes simultaneously.
 */
export interface SnapshotQuery {
  /** Only edges whose valid range contains this date. */
  readonly validAt: string;
  /** Only edges whose recorded range contains this date. */
  readonly knownAt: string;
}

// ── Validators ────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Validate a date string is ISO-8601 compatible and parses to a real
 * instant. Throws ValidationError on malformed input.
 */
export function validateDate(input: unknown, field: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new ValidationError(`${field}: expected ISO-8601 string, got ${typeof input}`);
  }
  if (!ISO_DATE_RE.test(input)) {
    throw new ValidationError(`${field}: not an ISO-8601 date: ${input}`);
  }
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) {
    throw new ValidationError(`${field}: unparseable date: ${input}`);
  }
  return input;
}

/**
 * Validate a nullable date. null passes through; anything else must be
 * ISO-8601.
 */
export function validateDateOrNull(input: unknown, field: string): string | null {
  if (input === null || input === undefined) return null;
  return validateDate(input, field);
}

// ── Predicates ────────────────────────────────────────

/**
 * True when `edge` was VALID at `date` on the knowledge-time axis.
 * Semantics: validFrom ≤ date ≤ (validTo ?? ∞).
 */
export function isValidAt(edge: BiTemporalEdge, date: string): boolean {
  validateDate(date, "date");
  const d = Date.parse(date);
  const from = Date.parse(edge.validFrom);
  if (Number.isNaN(from) || d < from) return false;
  if (edge.validTo === null) return true;
  const to = Date.parse(edge.validTo);
  if (Number.isNaN(to)) return true; // malformed validTo — treat as still-valid
  return d <= to;
}

/**
 * True when WOTANN KNEW `edge` at `date` on the ingest-time axis.
 * Semantics: recordedFrom ≤ date ≤ (recordedTo ?? ∞).
 */
export function isKnownAt(edge: BiTemporalEdge, date: string): boolean {
  validateDate(date, "date");
  const d = Date.parse(date);
  const from = Date.parse(edge.recordedFrom);
  if (Number.isNaN(from) || d < from) return false;
  if (edge.recordedTo === null) return true;
  const to = Date.parse(edge.recordedTo);
  if (Number.isNaN(to)) return true;
  return d <= to;
}

/**
 * True when both axes satisfy the snapshot query: the fact was true in
 * the world AND WOTANN knew it at the specified dates.
 */
export function matchesSnapshot(edge: BiTemporalEdge, q: SnapshotQuery): boolean {
  return isValidAt(edge, q.validAt) && isKnownAt(edge, q.knownAt);
}

// ── Pure filter helpers ───────────────────────────────

/**
 * Filter a list of edges to those valid at `date`. Pure — does no I/O.
 */
export function filterValidAt(
  edges: readonly BiTemporalEdge[],
  date: string,
): readonly BiTemporalEdge[] {
  validateDate(date, "date");
  return edges.filter((e) => isValidAt(e, date));
}

/**
 * Filter a list of edges to those known to WOTANN at `date`.
 */
export function filterKnownAt(
  edges: readonly BiTemporalEdge[],
  date: string,
): readonly BiTemporalEdge[] {
  validateDate(date, "date");
  return edges.filter((e) => isKnownAt(e, date));
}

/**
 * Filter a list of edges to those matching the snapshot on BOTH axes.
 */
export function filterSnapshot(
  edges: readonly BiTemporalEdge[],
  q: SnapshotQuery,
): readonly BiTemporalEdge[] {
  validateDate(q.validAt, "validAt");
  validateDate(q.knownAt, "knownAt");
  return edges.filter((e) => matchesSnapshot(e, q));
}

// ── Migration defaults ────────────────────────────────

/**
 * Build default bi-temporal fields for a legacy row missing one or both
 * axes. An edge with a pre-M5 created_at will have:
 *   - recordedFrom = created_at (when WOTANN first saw it)
 *   - recordedTo   = null        (still known)
 *
 * validFrom / validTo are NOT overwritten — they were wired in M7 and
 * already carry the knowledge-time truth from that migration.
 */
export function defaultIngestAxis(createdAt: string): {
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
} {
  validateDate(createdAt, "createdAt");
  return { recordedFrom: createdAt, recordedTo: null };
}

/**
 * Build default knowledge-time fields when legacy valid_from is missing.
 * (Defensive only — M7 migration sets valid_from = datetime('now') for
 * legacy rows, so this should rarely fire.)
 */
export function defaultKnowledgeAxis(createdAt: string): {
  readonly validFrom: string;
  readonly validTo: string | null;
} {
  validateDate(createdAt, "createdAt");
  return { validFrom: createdAt, validTo: null };
}

/**
 * Shape a retraction onto an edge: returns new fields to write to the
 * DB. The original edge is NOT mutated — callers persist the new fields.
 * Use when WOTANN learns a fact was wrong: we invalidate the old edge on
 * the ingest axis (recordedTo) AND optionally close the knowledge axis
 * (validTo) if we also know when the fact stopped being true.
 */
export function buildInvalidationFields(input: {
  readonly retractedAt: string;
  readonly factEndedAt?: string | null;
}): {
  readonly recordedTo: string;
  readonly validTo: string | null | undefined;
} {
  const retractedAt = validateDate(input.retractedAt, "retractedAt");
  if (input.factEndedAt === undefined) {
    return { recordedTo: retractedAt, validTo: undefined };
  }
  return {
    recordedTo: retractedAt,
    validTo: validateDateOrNull(input.factEndedAt, "factEndedAt"),
  };
}
