/**
 * WOTANN Design Tokens — canonical single source of truth (P2 design-token unification).
 *
 * Three surfaces (TUI, Desktop webview, iOS native) consume these tokens via
 * per-surface emitters in `./token-emitters/`. Nothing downstream duplicates
 * token values — edits made here propagate everywhere via the generator script
 * `scripts/generate-tokens.mjs`.
 *
 * Design notes:
 * - Palette: re-exports the 5 canonical palettes from `src/ui/themes.ts`
 *   (source-of-truth preserved; no duplication).
 * - Typography / spacing / radius / shadow / motion are NEW and chosen to
 *   align with iOS HIG + Material Design + Tailwind defaults.
 * - All values are POJOs (no class instances) so they round-trip through
 *   JSON emitters (W3C tokens, Swift) safely.
 *
 * Backwards-compat: `src/ui/themes.ts` is NOT duplicated here. It continues
 * to be the palette source; tokens.ts imports from it so the TUI path is
 * unchanged.
 */

import {
  type Palette,
  type CanonicalPaletteName,
  CANONICAL_PALETTES,
  PALETTES,
} from "../ui/themes.js";

// ── Re-exported palette primitives (TUI source of truth) ───────────────────

export { CANONICAL_PALETTES, PALETTES };
export type { Palette, CanonicalPaletteName };

// ── Token interfaces ───────────────────────────────────────────────────────

/**
 * 19 canonical color token keys. Must stay in sync with
 * {@link Palette} in `src/ui/themes.ts` (regression-lock test).
 */
export const COLOR_TOKEN_KEYS = [
  "background",
  "surface",
  "text",
  "muted",
  "border",
  "accent",
  "accentMuted",
  "info",
  "success",
  "warning",
  "error",
  "userMessage",
  "assistantMessage",
  "systemMessage",
  "toolMessage",
  "hudGreen",
  "hudYellow",
  "hudOrange",
  "hudRed",
] as const satisfies readonly (keyof Palette)[];

export type ColorTokenKey = (typeof COLOR_TOKEN_KEYS)[number];

/**
 * Typography scale. Values are intended to be platform-neutral; per-surface
 * emitters adapt them (e.g. Swift uses CGFloat, CSS uses rem).
 */
export interface TypographyTokens {
  readonly family: {
    readonly sans: string;
    readonly mono: string;
    readonly display: string;
  };
  readonly size: {
    readonly xs: number; // 12
    readonly sm: number; // 14
    readonly base: number; // 16
    readonly md: number; // 17 (iOS body)
    readonly lg: number; // 20
    readonly xl: number; // 24
    readonly "2xl": number; // 28
    readonly "3xl": number; // 34
  };
  readonly weight: {
    readonly regular: number; // 400
    readonly medium: number; // 500
    readonly semibold: number; // 600
    readonly bold: number; // 700
  };
  readonly lineHeight: {
    readonly tight: number; // 1.2
    readonly normal: number; // 1.5
    readonly relaxed: number; // 1.75
  };
  readonly letterSpacing: {
    readonly tight: number; // -0.5
    readonly normal: number; // 0
    readonly wide: number; // 0.5
  };
}

/** 4px base grid (4/8/12/16/24/32/48/64). */
export interface SpacingTokens {
  readonly xs: number; // 4
  readonly sm: number; // 8
  readonly md: number; // 12
  readonly base: number; // 16
  readonly lg: number; // 24
  readonly xl: number; // 32
  readonly "2xl": number; // 48
  readonly "3xl": number; // 64
}

export interface RadiusTokens {
  readonly none: number; // 0
  readonly sm: number; // 4
  readonly md: number; // 8
  readonly lg: number; // 12
  readonly xl: number; // 16
  readonly pill: number; // 999
  readonly round: number; // 9999 (alias of pill for symmetry)
}

/**
 * Shadow tokens use a normalized descriptor rather than a CSS string, so
 * emitters can render platform-appropriate output (CSS box-shadow, Swift
 * shadow modifier, etc.).
 */
export interface ShadowDescriptor {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  /** rgba() tuple; alpha is 0..1. */
  readonly color: { r: number; g: number; b: number; a: number };
}

export interface ShadowTokens {
  readonly none: null;
  readonly sm: readonly ShadowDescriptor[];
  readonly md: readonly ShadowDescriptor[];
  readonly lg: readonly ShadowDescriptor[];
  readonly xl: readonly ShadowDescriptor[];
}

export interface MotionTokens {
  readonly duration: {
    readonly instant: number; // 80ms
    readonly fast: number; // 150ms
    readonly base: number; // 240ms
    readonly slow: number; // 400ms
    readonly deliberate: number; // 600ms
  };
  /** CSS cubic-bezier tuple — [x1,y1,x2,y2]. */
  readonly easing: {
    readonly standard: readonly [number, number, number, number];
    readonly productive: readonly [number, number, number, number];
    readonly expoOut: readonly [number, number, number, number];
    readonly pop: readonly [number, number, number, number];
  };
}

/** Top-level WOTANN design tokens. */
export interface WotannTokens {
  /** All 5 canonical palettes, ready to emit in any format. */
  readonly palettes: Readonly<Record<CanonicalPaletteName, Palette>>;
  readonly typography: TypographyTokens;
  readonly spacing: SpacingTokens;
  readonly radius: RadiusTokens;
  readonly shadow: ShadowTokens;
  readonly motion: MotionTokens;
}

// ── Canonical values ───────────────────────────────────────────────────────

const TYPOGRAPHY: TypographyTokens = {
  family: {
    sans: '"Inter Variable", "SF Pro Text", system-ui, sans-serif',
    mono: '"JetBrains Mono Variable", "SF Mono", ui-monospace, monospace',
    display: '"Geist Sans", "Inter Variable", system-ui, sans-serif',
  },
  size: {
    xs: 12,
    sm: 14,
    base: 16,
    md: 17,
    lg: 20,
    xl: 24,
    "2xl": 28,
    "3xl": 34,
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
  letterSpacing: {
    tight: -0.5,
    normal: 0,
    wide: 0.5,
  },
};

const SPACING: SpacingTokens = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
  "3xl": 64,
};

const RADIUS: RadiusTokens = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
  round: 9999,
};

const SHADOW: ShadowTokens = {
  none: null,
  sm: [{ x: 0, y: 1, blur: 2, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.35 } }],
  md: [{ x: 0, y: 4, blur: 12, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.45 } }],
  lg: [{ x: 0, y: 12, blur: 32, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.55 } }],
  xl: [
    { x: 0, y: 24, blur: 48, spread: -8, color: { r: 0, g: 0, b: 0, a: 0.6 } },
    { x: 0, y: 8, blur: 16, spread: -4, color: { r: 0, g: 0, b: 0, a: 0.35 } },
  ],
};

const MOTION: MotionTokens = {
  duration: {
    instant: 80,
    fast: 150,
    base: 240,
    slow: 400,
    deliberate: 600,
  },
  easing: {
    standard: [0.4, 0.14, 0.3, 1],
    productive: [0.4, 0, 0.2, 1],
    expoOut: [0.16, 1, 0.3, 1],
    pop: [0.34, 1.56, 0.64, 1],
  },
};

/**
 * The canonical WOTANN tokens object. Import this anywhere a consumer needs
 * the raw values; run `scripts/generate-tokens.mjs` to regenerate the per-
 * surface emission files.
 */
export const WOTANN_TOKENS: WotannTokens = {
  palettes: PALETTES,
  typography: TYPOGRAPHY,
  spacing: SPACING,
  radius: RADIUS,
  shadow: SHADOW,
  motion: MOTION,
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Assert a palette is a complete {@link Palette}; throws if any of the 19
 * color keys is missing. Used by the regression-lock test and by the
 * emitter pipeline (defensive).
 */
export function assertPaletteComplete(p: Readonly<Record<string, unknown>>): void {
  for (const key of COLOR_TOKEN_KEYS) {
    if (typeof p[key] !== "string") {
      throw new Error(`palette missing required color key: ${key}`);
    }
  }
}

/** Convert a `rgba()` descriptor to a CSS string. */
export function rgbaString(c: ShadowDescriptor["color"]): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

/** Format a {@link ShadowDescriptor} as a single CSS box-shadow layer. */
export function formatShadowLayer(s: ShadowDescriptor): string {
  return `${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${rgbaString(s.color)}`;
}
