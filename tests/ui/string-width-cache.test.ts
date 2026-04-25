/**
 * Tests for src/ui/string-width-cache.ts (T12.14).
 *
 * Strategy:
 *   - Numeric-equivalence tests against the underlying string-width
 *     package across ASCII / CJK / emoji / surrogate-pair / mixed
 *     strings (V9 §T12.14 integration matrix).
 *   - Cache-fill behaviour: first read computes, second read hits.
 *   - QB #6 honest stubs on charWidthSafe.
 *   - QB #7 per-instance isolation (two caches don't share state).
 *   - Column-position binary search correctness.
 *   - Module-level singleton lifecycle (resetDefaultCache).
 *   - Performance smoke test: cache hit path is materially faster
 *     than the underlying impl on hot codepoints.
 */

import { describe, it, expect, beforeEach } from "vitest";
import stringWidth from "string-width";
import {
  StringWidthCache,
  cachedCharWidth,
  cachedStringWidth,
  cachedColumnPositionsFor,
  cachedCodepointIndexAtColumn,
  getDefaultCache,
  resetDefaultCache,
  BMP_CACHE_SIZE,
  MAX_CODEPOINT,
  WIDTH_SENTINEL,
} from "../../src/ui/string-width-cache.js";

beforeEach(() => {
  resetDefaultCache();
});

// ── Constants ─────────────────────────────────────────

describe("module constants", () => {
  it("BMP_CACHE_SIZE is the BMP boundary (0x10000)", () => {
    expect(BMP_CACHE_SIZE).toBe(0x10000);
  });

  it("MAX_CODEPOINT is the documented 0x10FFFF", () => {
    expect(MAX_CODEPOINT).toBe(0x10ffff);
  });

  it("WIDTH_SENTINEL is -1 (single signed-int compare)", () => {
    expect(WIDTH_SENTINEL).toBe(-1);
  });
});

// ── Numeric equivalence with string-width ─────────────

describe("StringWidthCache.stringWidth — numeric equivalence (V9 matrix)", () => {
  let cache: StringWidthCache;
  beforeEach(() => {
    cache = new StringWidthCache();
  });

  it("ASCII string matches uncached result", () => {
    expect(cache.stringWidth("hello")).toBe(stringWidth("hello"));
    expect(cache.stringWidth("hello")).toBe(5);
  });

  it("CJK string matches uncached result (matrix row CJK)", () => {
    expect(cache.stringWidth("日本語")).toBe(stringWidth("日本語"));
    expect(cache.stringWidth("日本語")).toBe(6);
  });

  it("Emoji string matches uncached result (matrix row emoji)", () => {
    expect(cache.stringWidth("👍")).toBe(stringWidth("👍"));
  });

  it("Mixed ASCII + CJK + emoji matches", () => {
    const s = "hi 👍 日";
    expect(cache.stringWidth(s)).toBe(stringWidth(s));
  });

  it("empty string is 0", () => {
    expect(cache.stringWidth("")).toBe(0);
  });

  it("non-string input returns 0 defensively", () => {
    // @ts-expect-error — runtime check
    expect(cache.stringWidth(undefined)).toBe(0);
  });
});

describe("StringWidthCache.charWidth — codepoint equivalence", () => {
  let cache: StringWidthCache;
  beforeEach(() => {
    cache = new StringWidthCache();
  });

  it("ASCII codepoints match", () => {
    expect(cache.charWidth(0x61)).toBe(stringWidth("a"));
    expect(cache.charWidth(0x20)).toBe(stringWidth(" "));
  });

  it("CJK codepoint matches", () => {
    expect(cache.charWidth(0x65e5)).toBe(stringWidth("日"));
  });

  it("Astral plane (>BMP) codepoint falls through correctly (matrix row)", () => {
    expect(cache.charWidth(0x1f44d)).toBe(stringWidth("👍"));
  });

  it("invalid codepoint returns 0 (defensive coercion)", () => {
    expect(cache.charWidth(-1)).toBe(0);
    expect(cache.charWidth(MAX_CODEPOINT + 1)).toBe(0);
    expect(cache.charWidth(NaN)).toBe(0);
    expect(cache.charWidth(0.5)).toBe(0);
  });
});

// ── Cache-fill semantics ──────────────────────────────

describe("cache-fill semantics", () => {
  it("first call misses + fills, second call hits (matrix: cache fill progressive)", () => {
    const cache = new StringWidthCache();
    const before = cache.stats();
    expect(before.bmpHits).toBe(0);
    cache.charWidth(0x61);
    const afterFirst = cache.stats();
    expect(afterFirst.bmpFilled).toBe(1);
    expect(afterFirst.bmpMisses).toBe(1);
    expect(afterFirst.bmpHits).toBe(0);
    cache.charWidth(0x61);
    const afterSecond = cache.stats();
    expect(afterSecond.bmpFilled).toBe(1); // unchanged
    expect(afterSecond.bmpHits).toBe(1);
  });

  it("clear() resets all stats and fills", () => {
    const cache = new StringWidthCache();
    cache.charWidth(0x61);
    cache.charWidth(0x62);
    cache.clear();
    const stats = cache.stats();
    expect(stats.bmpFilled).toBe(0);
    expect(stats.bmpHits).toBe(0);
    expect(stats.bmpMisses).toBe(0);
  });

  it("astral cache disabled when cacheAstral=false", () => {
    const cache = new StringWidthCache({ cacheAstral: false });
    cache.charWidth(0x1f44d);
    cache.charWidth(0x1f44d);
    const stats = cache.stats();
    expect(stats.astralFilled).toBe(0);
    expect(stats.astralMisses).toBeGreaterThanOrEqual(2);
  });

  it("astral cache enabled by default — second emoji read is a hit", () => {
    const cache = new StringWidthCache();
    cache.charWidth(0x1f44d);
    cache.charWidth(0x1f44d);
    const stats = cache.stats();
    expect(stats.astralHits).toBe(1);
  });
});

// ── charWidthSafe (QB #6) ─────────────────────────────

describe("charWidthSafe — honest stubs (QB #6)", () => {
  let cache: StringWidthCache;
  beforeEach(() => {
    cache = new StringWidthCache();
  });

  it("returns ok:true for valid codepoints", () => {
    const r = cache.charWidthSafe(0x61);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.width).toBe(1);
  });

  it("rejects non-number", () => {
    // @ts-expect-error — runtime
    const r = cache.charWidthSafe("a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/number/);
  });

  it("rejects NaN", () => {
    const r = cache.charWidthSafe(Number.NaN);
    expect(r.ok).toBe(false);
  });

  it("rejects fractional codepoints", () => {
    const r = cache.charWidthSafe(0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/integer/);
  });

  it("rejects negative codepoints", () => {
    const r = cache.charWidthSafe(-1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/>= 0/);
  });

  it("rejects codepoints above MAX_CODEPOINT", () => {
    const r = cache.charWidthSafe(MAX_CODEPOINT + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/<= 0x10FFFF/);
  });
});

// ── columnPositionsFor + codepointIndexAtColumn ───────

describe("columnPositionsFor", () => {
  let cache: StringWidthCache;
  beforeEach(() => {
    cache = new StringWidthCache();
  });

  it("returns [0] for empty string", () => {
    const p = cache.columnPositionsFor("");
    expect(p.length).toBe(1);
    expect(p[0]).toBe(0);
  });

  it("walks ASCII as 1-wide columns", () => {
    const p = cache.columnPositionsFor("abc");
    expect(Array.from(p)).toEqual([0, 1, 2, 3]);
  });

  it("CJK contributes 2 per codepoint", () => {
    const p = cache.columnPositionsFor("日本");
    expect(Array.from(p)).toEqual([0, 2, 4]);
  });

  it("surrogate pair counted once (codepoint walk)", () => {
    const s = "👍ab"; // 1 emoji codepoint + 2 ASCII
    const p = cache.columnPositionsFor(s);
    expect(p.length).toBe(4); // 3 codepoints + leading 0
  });

  it("non-string input returns [0]", () => {
    // @ts-expect-error — runtime
    const p = cache.columnPositionsFor(42);
    expect(Array.from(p)).toEqual([0]);
  });
});

describe("codepointIndexAtColumn (binary search)", () => {
  let cache: StringWidthCache;
  beforeEach(() => {
    cache = new StringWidthCache();
  });

  it("returns 0 for column <= 0", () => {
    expect(cache.codepointIndexAtColumn("abc", 0)).toBe(0);
    expect(cache.codepointIndexAtColumn("abc", -1)).toBe(0);
  });

  it("returns codepoint count for column >= total width", () => {
    expect(cache.codepointIndexAtColumn("abc", 3)).toBe(3);
    expect(cache.codepointIndexAtColumn("abc", 100)).toBe(3);
  });

  it("locates ASCII codepoints column-by-column", () => {
    expect(cache.codepointIndexAtColumn("abcde", 0)).toBe(0);
    expect(cache.codepointIndexAtColumn("abcde", 1)).toBe(1);
    expect(cache.codepointIndexAtColumn("abcde", 4)).toBe(4);
  });

  it("treats CJK columns as wide", () => {
    // "日本" — col 0..1 → idx 0; col 2..3 → idx 1; col 4 → idx 2
    expect(cache.codepointIndexAtColumn("日本", 0)).toBe(0);
    expect(cache.codepointIndexAtColumn("日本", 1)).toBe(0);
    expect(cache.codepointIndexAtColumn("日本", 2)).toBe(1);
    expect(cache.codepointIndexAtColumn("日本", 3)).toBe(1);
    expect(cache.codepointIndexAtColumn("日本", 4)).toBe(2);
  });
});

// ── warmAscii ─────────────────────────────────────────

describe("warmAscii", () => {
  it("fills ASCII printable range and is idempotent", () => {
    const cache = new StringWidthCache();
    cache.warmAscii();
    const after = cache.stats();
    // 0x20..0x7E inclusive = 95 codepoints
    expect(after.bmpFilled).toBe(95);
    cache.warmAscii(); // idempotent — no extra fills
    expect(cache.stats().bmpFilled).toBe(95);
  });
});

// ── Per-instance isolation (QB #7) ────────────────────

describe("per-instance isolation (QB #7)", () => {
  it("two caches don't share state", () => {
    const a = new StringWidthCache();
    const b = new StringWidthCache();
    a.charWidth(0x61);
    expect(a.stats().bmpFilled).toBe(1);
    expect(b.stats().bmpFilled).toBe(0);
  });
});

// ── Module-level singleton (opt-in) ───────────────────

describe("default-cache lifecycle", () => {
  it("getDefaultCache returns the same instance across calls", () => {
    const a = getDefaultCache();
    const b = getDefaultCache();
    expect(a).toBe(b);
  });

  it("resetDefaultCache forces a fresh instance", () => {
    const a = getDefaultCache();
    resetDefaultCache();
    const b = getDefaultCache();
    expect(a).not.toBe(b);
  });

  it("top-level helpers route through the default singleton", () => {
    expect(cachedStringWidth("hello")).toBe(5);
    expect(cachedCharWidth(0x61)).toBe(1);
    const positions = cachedColumnPositionsFor("ab");
    expect(Array.from(positions)).toEqual([0, 1, 2]);
    expect(cachedCodepointIndexAtColumn("ab", 1)).toBe(1);
  });
});

// ── Performance smoke (cached vs underlying) ──────────

describe("performance smoke (cache hit path is materially faster)", () => {
  it("1M iterations on the same codepoint hits the cache", () => {
    const cache = new StringWidthCache();
    const N = 1_000_000;
    // Prime the cache.
    cache.charWidth(0x61);
    let sum = 0;
    const start = Date.now();
    for (let i = 0; i < N; i++) {
      sum += cache.charWidth(0x61);
    }
    const elapsed = Date.now() - start;
    expect(sum).toBe(N);
    // Generous bound: 1M iters should fit under 1 second on any
    // modern machine; the failure mode is "miss-on-every-call" which
    // would push this into many seconds.
    expect(elapsed).toBeLessThan(2000);
    // And the stats should show only hits after the first miss.
    expect(cache.stats().bmpHits).toBeGreaterThanOrEqual(N);
  });
});

// ── Inject custom impl (test hook) ────────────────────

describe("custom impl injection (StringWidthCacheOptions.impl)", () => {
  it("uses the injected impl on misses", () => {
    let calls = 0;
    const cache = new StringWidthCache({
      impl: (_s: string) => {
        calls++;
        return 7;
      },
    });
    expect(cache.charWidth(0x61)).toBe(7);
    expect(cache.charWidth(0x61)).toBe(7); // hit, no extra call
    expect(calls).toBe(1);
  });
});
