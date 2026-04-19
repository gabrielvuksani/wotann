/**
 * Canvas Registry — type-keyed registry of interactive React canvases
 * the agent can mount from its output stream.
 *
 * Port of Cursor 3 "Canvases" pattern (UNKNOWN_UNKNOWNS.md #3):
 * agent output is not just markdown + diffs, but LIVE React components
 * that accept data from the agent and emit events back. A canvas knows
 * how to render a specific kind of payload (PR review, CSV, eval grid,
 * memory graph, etc.) and owns its own interactivity (accept/reject
 * buttons, sortable tables, drill-downs).
 *
 * Protocol contract:
 *   - Agent output contains blocks that look like:
 *         canvas: <type>
 *         data: <json>
 *         ---
 *     or a fenced variant:
 *         three-backticks canvas:<type>
 *         <json>
 *         three-backticks
 *   - `parseCanvasBlocks(text)` extracts every block into
 *     `{ type, data, range }` tuples.
 *   - `WorkshopView` (or any consumer) looks up the matching component
 *     via `getCanvas(type)` and mounts it with the parsed `data`.
 *   - Missing type falls back to a JSON viewer (handled upstream so
 *     the registry stays pure data).
 *
 * Design principles:
 *   - Components are lazy-loaded via React.lazy so the base Workshop
 *     bundle does not grow by the full canvas surface area. Each
 *     canvas type is paid only when it first appears in output.
 *   - The registry is a frozen map initialized at module scope. No
 *     mutation, no async side effects. Tests can call `registerCanvas`
 *     from the public API, but each call returns a NEW registry copy
 *     and the current singleton is replaced atomically — the canonical
 *     immutable pattern used elsewhere in WOTANN.
 *
 * Related files:
 *   - src/components/canvases/*.tsx — the seed canvases
 *   - src/components/workshop/WorkshopView.tsx — the consumer
 */

import type { ComponentType, LazyExoticComponent } from "react";

// ────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────

/**
 * Props handed to every canvas component. The canvas owns parsing
 * of `data` (so it can fail loudly if the shape is wrong) instead of
 * delegating to the registry — keeps the registry narrow.
 */
export interface CanvasProps {
  /**
   * The JSON payload the agent emitted inside the canvas block.
   * Canvases MUST validate this at runtime and render an honest
   * empty / error state if the shape does not match.
   */
  readonly data: unknown;
  /**
   * Monotonic block id so the consumer can mount multiple canvases of
   * the same type without duplicate-key warnings.
   */
  readonly blockId: string;
}

/** A canvas component as stored in the registry — lazy or eager. */
export type CanvasComponent =
  | ComponentType<CanvasProps>
  | LazyExoticComponent<ComponentType<CanvasProps>>;

/** Frozen entry inside the registry map. */
export interface CanvasEntry {
  readonly type: string;
  readonly component: CanvasComponent;
  /** Optional human label for dev tools / empty states. */
  readonly label?: string;
}

/** A parsed canvas block from agent output. */
export interface CanvasBlock {
  readonly type: string;
  readonly data: unknown;
  /** Character range inside the source text — useful for "edit block" UI. */
  readonly start: number;
  readonly end: number;
  /** Raw JSON text as it appeared, before parsing. Kept for debugging. */
  readonly rawJson: string;
}

// ────────────────────────────────────────────────────────────
// Internal immutable registry state
// ────────────────────────────────────────────────────────────

/**
 * Registry is an immutable Map-like frozen object. Each mutation
 * (`registerCanvas`) returns a NEW registry; the module-scope
 * `currentRegistry` is swapped atomically. Following the WOTANN
 * "immutable data / encapsulated services" rule.
 */
let currentRegistry: ReadonlyMap<string, CanvasEntry> = new Map();

/**
 * Register a canvas under a type key. Safe to call multiple times;
 * the last registration wins, matching how React.lazy factories tend
 * to be hot-reloaded during dev.
 *
 * Returns the new registry snapshot so callers can compose in tests
 * without relying on module state.
 */
export function registerCanvas(
  type: string,
  component: CanvasComponent,
  label?: string,
): ReadonlyMap<string, CanvasEntry> {
  if (!type || typeof type !== "string") {
    throw new Error("registerCanvas: `type` must be a non-empty string");
  }
  const next = new Map(currentRegistry);
  next.set(type, Object.freeze({ type, component, label }));
  currentRegistry = Object.freeze(next) as ReadonlyMap<string, CanvasEntry>;
  return currentRegistry;
}

/**
 * Resolve a canvas entry by type. Returns `undefined` if the type is
 * not registered — consumers should fall back to a JSON viewer.
 */
export function getCanvas(type: string): CanvasEntry | undefined {
  return currentRegistry.get(type);
}

/** Dump the current registry — useful for debug panels. */
export function listCanvases(): readonly CanvasEntry[] {
  return Array.from(currentRegistry.values());
}

/** Only used by tests — reset state between specs. */
export function __resetCanvasRegistry(): void {
  currentRegistry = new Map();
}

// ────────────────────────────────────────────────────────────
// Canvas block parser
// ────────────────────────────────────────────────────────────

/**
 * Regex for the fenced variant:
 *
 *   three-backticks canvas:<type>
 *   { ...json... }
 *   three-backticks
 *
 * - `type` is word-chars + dashes (allows `pr-review`, `data-explorer`).
 * - Body is lazy-captured up to the closing triple-backticks.
 * - Uses `g` + character-class strategy so `.` pitfalls with newlines
 *   are avoided and multiple blocks per message collect correctly.
 */
const FENCED_CANVAS_RE = /```canvas:([a-zA-Z0-9_-]+)\n([\s\S]*?)```/g;

/**
 * Regex for the colon-separator variant:
 *
 *   canvas: <type>
 *   data: <json>
 *   ---
 *
 * - `type` tolerates trailing whitespace.
 * - `data:` line captures everything up to the `---` terminator.
 * - Terminator must be on its own line so "---" inside JSON strings
 *   does not trip the parser.
 */
const INLINE_CANVAS_RE =
  /^canvas:\s*([a-zA-Z0-9_-]+)\s*\n\s*data:\s*([\s\S]*?)\n---\s*$/gm;

/**
 * Parse every canvas block out of a source string. Blocks that fail
 * JSON parsing are skipped silently — the canvas protocol is intended
 * to be forgiving so a partial LLM stream does not corrupt the whole
 * render pipeline.
 *
 * Returned blocks are sorted by `start` so consumers can interleave
 * them with the surrounding markdown without losing order.
 */
export function parseCanvasBlocks(source: string): readonly CanvasBlock[] {
  if (!source || typeof source !== "string") return [];

  const blocks: CanvasBlock[] = [];

  // Walk fenced first — they are the preferred form.
  FENCED_CANVAS_RE.lastIndex = 0;
  let fencedMatch: RegExpExecArray | null;
  while ((fencedMatch = FENCED_CANVAS_RE.exec(source)) !== null) {
    const [full, type, rawJson] = fencedMatch;
    if (!type || !rawJson) continue;
    const parsed = safeJsonParse(rawJson);
    if (parsed === SAFE_JSON_FAIL) continue;
    blocks.push({
      type,
      data: parsed,
      start: fencedMatch.index,
      end: fencedMatch.index + full.length,
      rawJson,
    });
  }

  // Inline variant — walk separately; matches that overlap a fenced
  // block are discarded at the end. We keep them separate so the
  // regexes stay simple.
  INLINE_CANVAS_RE.lastIndex = 0;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = INLINE_CANVAS_RE.exec(source)) !== null) {
    const [full, type, rawJson] = inlineMatch;
    if (!type || !rawJson) continue;
    const parsed = safeJsonParse(rawJson);
    if (parsed === SAFE_JSON_FAIL) continue;
    blocks.push({
      type,
      data: parsed,
      start: inlineMatch.index,
      end: inlineMatch.index + full.length,
      rawJson,
    });
  }

  // Sort + dedup overlapping (fenced wins over inline).
  blocks.sort((a, b) => a.start - b.start);
  const unique: CanvasBlock[] = [];
  for (const block of blocks) {
    const overlaps = unique.some(
      (prev) => block.start < prev.end && block.end > prev.start,
    );
    if (!overlaps) unique.push(block);
  }

  return Object.freeze(unique);
}

/**
 * Strip every canvas block from a source string, returning the
 * remaining markdown. The consumer can render the residual text as
 * regular markdown above or below the mounted canvases.
 */
export function stripCanvasBlocks(source: string): string {
  if (!source) return "";
  const blocks = parseCanvasBlocks(source);
  if (blocks.length === 0) return source;

  // Walk the string in order, copying only the runs between blocks.
  let out = "";
  let cursor = 0;
  for (const block of blocks) {
    if (block.start > cursor) out += source.slice(cursor, block.start);
    cursor = block.end;
  }
  if (cursor < source.length) out += source.slice(cursor);
  return out;
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

/**
 * Sentinel value returned by `safeJsonParse` when the text cannot be
 * parsed. Using a symbol avoids colliding with legitimate `null` /
 * `undefined` payloads — either of which may be valid canvas data.
 */
const SAFE_JSON_FAIL: unique symbol = Symbol("canvas:json-fail");

function safeJsonParse(text: string): unknown | typeof SAFE_JSON_FAIL {
  const trimmed = text.trim();
  if (!trimmed) return SAFE_JSON_FAIL;
  try {
    return JSON.parse(trimmed);
  } catch {
    return SAFE_JSON_FAIL;
  }
}
