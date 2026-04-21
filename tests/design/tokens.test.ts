/**
 * Tests for the canonical WOTANN design tokens.
 *
 * These tests enforce the invariants that downstream emitters rely on:
 * - Each of the 5 canonical palettes has all 19 color token keys.
 * - Tokens stay in sync with the src/ui/themes.ts palette interface
 *   (regression-lock: same keys, same values).
 * - Spacing / radius / motion tokens are typed CSS-compatible numerics.
 */
import { describe, it, expect } from "vitest";
import {
  WOTANN_TOKENS,
  COLOR_TOKEN_KEYS,
  CANONICAL_PALETTES,
  assertPaletteComplete,
  formatShadowLayer,
  rgbaString,
} from "../../src/design/tokens.js";
import { PALETTES } from "../../src/ui/themes.js";

describe("WOTANN_TOKENS canonical token graph", () => {
  it("exposes all 5 canonical palettes", () => {
    expect(Object.keys(WOTANN_TOKENS.palettes).sort()).toEqual(
      [...CANONICAL_PALETTES].sort(),
    );
  });

  it("every palette has all 19 color token keys", () => {
    for (const name of CANONICAL_PALETTES) {
      const palette = WOTANN_TOKENS.palettes[name];
      for (const key of COLOR_TOKEN_KEYS) {
        expect(typeof palette[key], `${name}.${key}`).toBe("string");
        expect(palette[key]!.length, `${name}.${key} non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it("19 × 5 = 95 total palette-color tokens", () => {
    let count = 0;
    for (const name of CANONICAL_PALETTES) {
      count += Object.keys(WOTANN_TOKENS.palettes[name]).length;
    }
    expect(count).toBe(95);
  });

  it("all color values are valid 6-digit hex", () => {
    const HEX_RE = /^#[0-9a-fA-F]{6}$/;
    for (const name of CANONICAL_PALETTES) {
      const palette = WOTANN_TOKENS.palettes[name];
      for (const key of COLOR_TOKEN_KEYS) {
        expect(palette[key], `${name}.${key}`).toMatch(HEX_RE);
      }
    }
  });

  it("palettes in tokens.ts match src/ui/themes.ts (regression lock)", () => {
    // This is the key invariant: tokens.ts re-exports themes.ts PALETTES.
    // If anyone tries to fork the palette, this test fails.
    expect(WOTANN_TOKENS.palettes).toBe(PALETTES);
  });

  it("COLOR_TOKEN_KEYS length is 19", () => {
    expect(COLOR_TOKEN_KEYS.length).toBe(19);
  });
});

describe("Typography tokens", () => {
  it("has 8 font sizes, 4 weights, 3 line heights, 3 letter spacings", () => {
    expect(Object.keys(WOTANN_TOKENS.typography.size).length).toBe(8);
    expect(Object.keys(WOTANN_TOKENS.typography.weight).length).toBe(4);
    expect(Object.keys(WOTANN_TOKENS.typography.lineHeight).length).toBe(3);
    expect(Object.keys(WOTANN_TOKENS.typography.letterSpacing).length).toBe(3);
  });

  it("font sizes are monotonically increasing", () => {
    const sizes = Object.values(WOTANN_TOKENS.typography.size);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `size[${i}] > size[${i - 1}]`).toBeGreaterThan(sizes[i - 1]!);
    }
  });

  it("weights match standard CSS values", () => {
    expect(WOTANN_TOKENS.typography.weight.regular).toBe(400);
    expect(WOTANN_TOKENS.typography.weight.medium).toBe(500);
    expect(WOTANN_TOKENS.typography.weight.semibold).toBe(600);
    expect(WOTANN_TOKENS.typography.weight.bold).toBe(700);
  });

  it("font families include system fallbacks", () => {
    expect(WOTANN_TOKENS.typography.family.sans).toContain("system-ui");
    expect(WOTANN_TOKENS.typography.family.mono).toContain("monospace");
  });
});

describe("Spacing tokens", () => {
  it("follows 4px base grid", () => {
    for (const v of Object.values(WOTANN_TOKENS.spacing)) {
      expect(v % 4, `spacing=${v} is multiple of 4`).toBe(0);
    }
  });

  it("is monotonically increasing", () => {
    const values = Object.values(WOTANN_TOKENS.spacing);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });
});

describe("Radius tokens", () => {
  it("includes sharp (0), standard grid, and pill (999)", () => {
    expect(WOTANN_TOKENS.radius.none).toBe(0);
    expect(WOTANN_TOKENS.radius.pill).toBe(999);
    expect(WOTANN_TOKENS.radius.round).toBe(9999);
  });
});

describe("Shadow tokens", () => {
  it("has none, sm, md, lg, xl slots", () => {
    expect(WOTANN_TOKENS.shadow.none).toBeNull();
    expect(Array.isArray(WOTANN_TOKENS.shadow.sm)).toBe(true);
    expect(Array.isArray(WOTANN_TOKENS.shadow.md)).toBe(true);
    expect(Array.isArray(WOTANN_TOKENS.shadow.lg)).toBe(true);
    expect(Array.isArray(WOTANN_TOKENS.shadow.xl)).toBe(true);
  });

  it("shadow layers have all required numeric fields", () => {
    const layer = WOTANN_TOKENS.shadow.md[0]!;
    expect(typeof layer.x).toBe("number");
    expect(typeof layer.y).toBe("number");
    expect(typeof layer.blur).toBe("number");
    expect(typeof layer.spread).toBe("number");
    expect(layer.color.a).toBeGreaterThan(0);
    expect(layer.color.a).toBeLessThanOrEqual(1);
  });

  it("formatShadowLayer emits valid CSS", () => {
    const layer = WOTANN_TOKENS.shadow.sm[0]!;
    const css = formatShadowLayer(layer);
    expect(css).toMatch(/^-?\d+px -?\d+px \d+px -?\d+px rgba\(\d+, \d+, \d+, [\d.]+\)$/);
  });
});

describe("Motion tokens", () => {
  it("durations are ms numbers", () => {
    for (const v of Object.values(WOTANN_TOKENS.motion.duration)) {
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThan(0);
    }
  });

  it("easing curves are cubic-bezier tuples", () => {
    for (const curve of Object.values(WOTANN_TOKENS.motion.easing)) {
      expect(curve.length).toBe(4);
      for (const n of curve) expect(typeof n).toBe("number");
    }
  });
});

describe("assertPaletteComplete", () => {
  it("passes for a valid palette", () => {
    expect(() => assertPaletteComplete(WOTANN_TOKENS.palettes.dark)).not.toThrow();
  });

  it("throws on missing keys", () => {
    const partial = { ...WOTANN_TOKENS.palettes.dark } as Record<string, unknown>;
    delete partial.accent;
    expect(() => assertPaletteComplete(partial)).toThrow(/accent/);
  });

  it("throws on non-string keys", () => {
    const bad = { ...WOTANN_TOKENS.palettes.dark, accent: 123 } as unknown as Record<
      string,
      unknown
    >;
    expect(() => assertPaletteComplete(bad)).toThrow(/accent/);
  });
});

describe("rgbaString", () => {
  it("formats rgba tuples", () => {
    expect(rgbaString({ r: 10, g: 20, b: 30, a: 0.5 })).toBe("rgba(10, 20, 30, 0.5)");
  });
});
