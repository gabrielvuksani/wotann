/**
 * T12.14 — Int32Array TUI string-width / column-position optimizer
 * (~700 LOC, V9 §T12.14, line 2746).
 *
 * Goal:
 *   Replace per-character `stringWidth(ch)` calls in TUI rendering with
 *   an Int32Array-backed lookup keyed by codepoint. The Int32Array maps
 *   codepoint → display-width so the TUI can compute column positions
 *   without round-tripping `stringWidth` per character per frame.
 *
 *   Match Anthropic's leaked Claude Code internal TUI optimizer pattern
 *   (50× speedup on emoji + CJK heavy renders).
 *
 * Design:
 *   - One Int32Array sized to cover the Basic Multilingual Plane
 *     (codepoints 0..0xFFFF). Sentinel `WIDTH_SENTINEL` (-1) means
 *     "not yet computed"; fill on first read.
 *   - Codepoints above the BMP fall through to the underlying
 *     `stringWidth` impl. They occur much less often (mostly emoji) so
 *     a small auxiliary Map is used to avoid re-parsing the same emoji
 *     repeatedly without consuming the Int32Array's 256KB-of-memory
 *     budget.
 *   - The hot path is a single `cache[cp]` access plus an integer
 *     `width === -1` branch. No string allocation, no Map lookup, no
 *     subprocess.
 *   - String-level helper (`cachedStringWidth`) walks the string by
 *     codepoint (not by char unit) so surrogate pairs are summed once,
 *     not twice.
 *   - Column-position helper (`columnPositionsFor`) returns an
 *     Int32Array of cumulative widths so callers can binary-search to
 *     find the column at a given character index without rescanning.
 *   - Cache-instance form (`StringWidthCache`) is the canonical entry
 *     point: per-call/per-renderer state, not module-global. A
 *     module-level singleton (`getDefaultCache`) is exposed for the
 *     runtime to share one cache across the process when desired.
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: `cachedCharWidthSafe` returns
 *     `{ok:false, reason}` for invalid codepoints (NaN, negative,
 *     >0x10FFFF) — never silently coerced.
 *   - QB #7  per-call state: `StringWidthCache` is a class with
 *     instance state; module-level singleton is opt-in via
 *     `getDefaultCache()`.
 *   - QB #13 env guard: never reads process.env. Caller threads
 *     options via `StringWidthCacheOptions`.
 *   - QB #14 commit-claim verification: tests assert numeric
 *     equivalence with the underlying string-width package across
 *     ASCII / CJK / emoji / surrogate-pair / mixed strings, not just
 *     stub shapes.
 */

import stringWidth from "string-width";

// ── Public Constants ──────────────────────────────────

/** Highest codepoint that we directly index in the Int32Array.
 *  0x10000 = 65536 = full BMP coverage. Memory cost: 256 KiB
 *  (Int32Array stores 4 bytes per entry). */
export const BMP_CACHE_SIZE = 0x10000;

/** Highest valid Unicode codepoint. Above this is invalid. */
export const MAX_CODEPOINT = 0x10ffff;

/** Sentinel value for "uncomputed" entries. Chosen as -1 so a single
 *  signed-int comparison against the cache is enough. */
export const WIDTH_SENTINEL = -1;

// ── Public Types ──────────────────────────────────────

export interface StringWidthCacheOptions {
  /** Override the underlying string-width implementation. Tests use
   *  this; production callers leave it undefined. */
  readonly impl?: (s: string) => number;
  /**
   * When true, codepoints above the BMP also get cached (in an
   *  auxiliary Map). Default true. Disable to keep memory tight in
   *  long-running daemons that render many one-off emoji.
   */
  readonly cacheAstral?: boolean;
  /** Optional ambiguous-is-narrow flag passed to the underlying impl.
   *  Defaults to string-width's own default (true). */
  readonly ambiguousIsNarrow?: boolean;
}

export interface StringWidthCacheStats {
  readonly bmpFilled: number;
  readonly astralFilled: number;
  readonly bmpHits: number;
  readonly bmpMisses: number;
  readonly astralHits: number;
  readonly astralMisses: number;
}

/** Result wrapper for the safe-form helpers (QB #6). */
export type CharWidthResult =
  | { readonly ok: true; readonly width: number }
  | { readonly ok: false; readonly reason: string };

// ── StringWidthCache ──────────────────────────────────

/**
 * Per-instance Int32Array-backed string-width cache. Construct one
 * per renderer (TUI, App.tsx) so caches don't bleed across unrelated
 * sessions. Use `getDefaultCache()` for a process-wide singleton when
 * sharing is desired.
 */
export class StringWidthCache {
  private readonly bmp: Int32Array;
  private readonly astral: Map<number, number> | null;
  private readonly impl: (s: string) => number;

  // Stats. Counted per-instance, not via module globals (QB #7).
  private bmpHitsCount = 0;
  private bmpMissesCount = 0;
  private bmpFilledCount = 0;
  private astralHitsCount = 0;
  private astralMissesCount = 0;

  constructor(opts: StringWidthCacheOptions = {}) {
    this.bmp = new Int32Array(BMP_CACHE_SIZE);
    this.bmp.fill(WIDTH_SENTINEL);
    this.astral = (opts.cacheAstral ?? true) ? new Map() : null;
    if (opts.impl) {
      this.impl = opts.impl;
    } else {
      const ambiguousIsNarrow = opts.ambiguousIsNarrow;
      this.impl =
        ambiguousIsNarrow === undefined
          ? (s: string) => stringWidth(s)
          : (s: string) => stringWidth(s, { ambiguousIsNarrow });
    }
  }

  // ── Codepoint width ──────────────────────────────

  /**
   * Width of a single codepoint. Hot path — called per-char per-frame.
   *
   * Defensive: NaN / negative / out-of-range codepoints fall through to
   *  width 0 (the agreed sentinel for "not displayable"), with a
   *  miss-count bump so observability sees the bad input. Use
   *  `charWidthSafe` to surface the error.
   */
  charWidth(codepoint: number): number {
    if (codepoint < 0 || codepoint > MAX_CODEPOINT || !Number.isInteger(codepoint)) {
      // Invalid codepoint — return 0 to keep the renderer alive.
      // The safe-form variant surfaces a structured error.
      this.bmpMissesCount++;
      return 0;
    }
    if (codepoint < BMP_CACHE_SIZE) {
      const cached = this.bmp[codepoint];
      // cached is always a number (Int32Array). Guard the union for TS.
      if (cached !== undefined && cached !== WIDTH_SENTINEL) {
        this.bmpHitsCount++;
        return cached;
      }
      const width = this.impl(String.fromCodePoint(codepoint));
      this.bmp[codepoint] = width;
      this.bmpFilledCount++;
      this.bmpMissesCount++;
      return width;
    }
    // Astral plane. Optionally cache.
    if (this.astral) {
      const cached = this.astral.get(codepoint);
      if (cached !== undefined) {
        this.astralHitsCount++;
        return cached;
      }
      const width = this.impl(String.fromCodePoint(codepoint));
      this.astral.set(codepoint, width);
      this.astralMissesCount++;
      return width;
    }
    this.astralMissesCount++;
    return this.impl(String.fromCodePoint(codepoint));
  }

  /**
   * Honest-stub variant for callers that want to surface invalid
   * codepoints. Returns `{ok:false, reason}` rather than coercing
   * silently.
   */
  charWidthSafe(codepoint: number): CharWidthResult {
    if (typeof codepoint !== "number" || Number.isNaN(codepoint)) {
      return { ok: false, reason: "string-width-cache: codepoint must be a number" };
    }
    if (!Number.isInteger(codepoint)) {
      return { ok: false, reason: "string-width-cache: codepoint must be an integer" };
    }
    if (codepoint < 0) {
      return { ok: false, reason: "string-width-cache: codepoint must be >= 0" };
    }
    if (codepoint > MAX_CODEPOINT) {
      return {
        ok: false,
        reason: `string-width-cache: codepoint must be <= 0x10FFFF (got 0x${codepoint
          .toString(16)
          .toUpperCase()})`,
      };
    }
    return { ok: true, width: this.charWidth(codepoint) };
  }

  // ── String width ─────────────────────────────────

  /**
   * Total visual width of a string. Walks by codepoint so a surrogate
   * pair contributes one width, not two.
   */
  stringWidth(s: string): number {
    if (typeof s !== "string") return 0;
    if (s.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < s.length; ) {
      const cp = s.codePointAt(i);
      if (cp === undefined) {
        // Should be unreachable for in-range i, but guard for TS.
        i++;
        continue;
      }
      total += this.charWidth(cp);
      i += cp >= 0x10000 ? 2 : 1;
    }
    return total;
  }

  // ── Column positions ──────────────────────────────

  /**
   * Return cumulative column positions for each codepoint in the input.
   *
   * The returned Int32Array has length `(codepointCount + 1)` where
   * `result[i]` = visual column of the start of the i-th codepoint
   * (result[0] is always 0; result[N] is the total visual width).
   * Allows O(log N) lookup of the column a given codepoint sits in via
   * binary search rather than rescanning.
   */
  columnPositionsFor(s: string): Int32Array {
    if (typeof s !== "string" || s.length === 0) return new Int32Array(1);
    // First pass: count codepoints to size the result exactly.
    let cpCount = 0;
    for (let i = 0; i < s.length; ) {
      const cp = s.codePointAt(i);
      if (cp === undefined) {
        i++;
        continue;
      }
      cpCount++;
      i += cp >= 0x10000 ? 2 : 1;
    }
    const out = new Int32Array(cpCount + 1);
    let total = 0;
    let outIdx = 0;
    out[outIdx++] = 0;
    for (let i = 0; i < s.length; ) {
      const cp = s.codePointAt(i);
      if (cp === undefined) {
        i++;
        continue;
      }
      total += this.charWidth(cp);
      out[outIdx++] = total;
      i += cp >= 0x10000 ? 2 : 1;
    }
    return out;
  }

  /**
   * Find the codepoint index that lands at (or just past) the given
   * visual column. Useful for cursor-position math on the screen.
   *
   * - Returns 0 for column ≤ 0.
   * - Returns codepoint count when column ≥ total width.
   */
  codepointIndexAtColumn(s: string, column: number): number {
    const positions = this.columnPositionsFor(s);
    if (column <= 0) return 0;
    const last = positions[positions.length - 1] ?? 0;
    if (column >= last) return positions.length - 1;
    // Binary search for the first index whose cumulative width > column.
    let lo = 0;
    let hi = positions.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const pos = positions[mid] ?? 0;
      if (pos <= column) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    // lo is the first position strictly greater than column. The
    // codepoint that "owns" the column is one before that.
    return Math.max(0, lo - 1);
  }

  // ── Maintenance ──────────────────────────────────

  /** Drop cached entries. Caller probably wants this only across
   *  major renderer resets — the cache is otherwise self-managing. */
  clear(): void {
    this.bmp.fill(WIDTH_SENTINEL);
    if (this.astral) this.astral.clear();
    this.bmpHitsCount = 0;
    this.bmpMissesCount = 0;
    this.bmpFilledCount = 0;
    this.astralHitsCount = 0;
    this.astralMissesCount = 0;
  }

  /** Snapshot of cache stats. Useful for benchmarks + observability. */
  stats(): StringWidthCacheStats {
    return Object.freeze({
      bmpFilled: this.bmpFilledCount,
      astralFilled: this.astral ? this.astral.size : 0,
      bmpHits: this.bmpHitsCount,
      bmpMisses: this.bmpMissesCount,
      astralHits: this.astralHitsCount,
      astralMisses: this.astralMissesCount,
    });
  }

  /** Convenience: warm the cache for the printable ASCII range
   *  (0x20..0x7E) on construction-adjacent code paths. Used by the TUI
   *  bootstrap to avoid first-frame jank. */
  warmAscii(): void {
    for (let cp = 0x20; cp <= 0x7e; cp++) {
      // Only fill if uncomputed; warm() should be idempotent.
      const cur = this.bmp[cp];
      if (cur === WIDTH_SENTINEL) {
        const w = this.impl(String.fromCodePoint(cp));
        this.bmp[cp] = w;
        this.bmpFilledCount++;
      }
    }
  }
}

// ── Module-level singleton (opt-in) ──────────────────

let defaultCache: StringWidthCache | null = null;

/**
 * Process-wide singleton, opt-in. Useful for the runtime when many
 * renderers share width state and a per-instance cache would cause
 * redundant fill work on the same codepoints.
 *
 * Per QB #7, callers can — and should — construct their own
 * `new StringWidthCache()` when isolation matters (tests, sandboxed
 * subagents). The singleton is just a convenience.
 */
export function getDefaultCache(): StringWidthCache {
  if (!defaultCache) {
    defaultCache = new StringWidthCache();
  }
  return defaultCache;
}

/** Reset the module-level singleton. Tests use this to keep runs
 *  hermetic. Production callers shouldn't need it. */
export function resetDefaultCache(): void {
  defaultCache = null;
}

// ── Top-level convenience helpers ─────────────────────

/**
 * Width of a single codepoint via the default singleton. Equivalent
 * to `getDefaultCache().charWidth(cp)`.
 */
export function cachedCharWidth(codepoint: number): number {
  return getDefaultCache().charWidth(codepoint);
}

/**
 * Width of a string via the default singleton. Equivalent to
 * `getDefaultCache().stringWidth(s)`.
 */
export function cachedStringWidth(s: string): number {
  return getDefaultCache().stringWidth(s);
}

/**
 * Column positions of a string via the default singleton. Equivalent
 * to `getDefaultCache().columnPositionsFor(s)`.
 */
export function cachedColumnPositionsFor(s: string): Int32Array {
  return getDefaultCache().columnPositionsFor(s);
}

/**
 * Locate the codepoint at a column via the default singleton.
 */
export function cachedCodepointIndexAtColumn(s: string, column: number): number {
  return getDefaultCache().codepointIndexAtColumn(s, column);
}
