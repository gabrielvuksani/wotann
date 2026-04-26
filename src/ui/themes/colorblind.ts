/**
 * Color-blind palettes — Wave 6-OO TUI v2 Phase 2 accessibility.
 *
 * ── What this is ─────────────────────────────────────────────────
 * A palette remapper that re-colours the active 5-canonical palette
 * (`src/ui/themes.ts`) for the three most prevalent forms of colour
 * vision deficiency:
 *
 *   - Protanopia    — red-blind (≈1% of males)
 *   - Deuteranopia  — green-blind (≈1.1% of males, most common)
 *   - Tritanopia    — blue-blind (rare, but still material)
 *
 * The remap targets the ROLE tokens (success/error/warning/info,
 * the four message kinds, and the four HUD slots) rather than the
 * neutral tokens (background/text/border) — those stay intact so
 * the surface chrome still looks like itself.
 *
 * ── Why a remapper, not a 4th palette set ────────────────────────
 * The 5-palette system (`themes.ts`) is theme-of-mood: dark, light,
 * sepia, mono, high-contrast. Colour-blindness is independent —
 * a deuteranope user picking the sepia theme should still get
 * deuteran-safe accents on a sepia background. A remapper layered
 * on top of any palette achieves that without quintuplicating the
 * canonical palette set.
 *
 * ── Detection (QB#6 — honest fallback) ───────────────────────────
 * - `WOTANN_COLOR_MODE` env var with the literal values
 *   `protan`, `deutan`, `tritan` enables the corresponding remap.
 * - Anything else → null mode (no remap, palette returned as-is).
 *   We do NOT fall back to deutan when the env var is misspelled —
 *   silent fallbacks lie to the user.
 *
 * ── Per-instance state (QB#7) ────────────────────────────────────
 * `applyColorBlindMode` is a pure function. It does not cache, mutate
 * the input palette, or carry global state. Callers thread the
 * detected mode through their `ThemeManager` plumbing.
 *
 * ── Sibling-site scan (QB#11) ────────────────────────────────────
 * The remapper preserves the `Palette` shape from `themes.ts`. It
 * does NOT touch `theme/tokens.ts` (which adds glyph + spinner
 * tokens) — that file already consumes a `Palette` and will inherit
 * the remap automatically when callers pass the remapped palette to
 * `buildTone`.
 */

import type { Palette } from "../themes.js";

// ── Public types ─────────────────────────────────────────────────────

/** Supported colour-blind modes. `null` means "no remap". */
export type ColorBlindMode = "protan" | "deutan" | "tritan";

/** Strict env values that opt into a mode. */
const COLOR_MODE_ENV_VALUES: Readonly<Record<string, ColorBlindMode>> = {
  protan: "protan",
  deutan: "deutan",
  tritan: "tritan",
};

/** Env var that selects the mode. */
const ENV_VAR = "WOTANN_COLOR_MODE";

// ── Detection ────────────────────────────────────────────────────────

/**
 * Resolve the active mode from env. Returns null when the env var
 * is unset or contains a value we do not recognise — strict
 * equality, no fuzzy matching.
 */
export function detectColorBlindMode(env: NodeJS.ProcessEnv = process.env): ColorBlindMode | null {
  const raw = env[ENV_VAR];
  if (typeof raw !== "string") return null;
  return COLOR_MODE_ENV_VALUES[raw] ?? null;
}

// ── Remap tables ─────────────────────────────────────────────────────

/**
 * Per-mode role-colour overrides. We swap the primary indicators
 * for ones distinguishable under each deficiency. References:
 *
 *   - "ColorBrewer" / Wong's Nature Methods palette (2011)
 *   - The "Okabe-Ito" colour-blind safe set (2008)
 *
 * These hexes are well-trodden and play nicely with each other on
 * dark and light backgrounds.
 */
const REMAP_TABLES: Readonly<Record<ColorBlindMode, Partial<Record<keyof Palette, string>>>> = {
  // Protanopia — red appears dim/dark. Replace red→orange,
  // shift accent away from red-leaning hues.
  protan: {
    error: "#e69f00", // Okabe-Ito orange
    warning: "#f0e442", // Okabe-Ito yellow
    success: "#0072b2", // Okabe-Ito blue (keeps "good = blue" mental model)
    info: "#56b4e9", // Okabe-Ito sky-blue
    accent: "#0072b2",
    accentMuted: "#005a8a",
    userMessage: "#56b4e9",
    assistantMessage: "#0072b2",
    systemMessage: "#f0e442",
    toolMessage: "#cc79a7", // Okabe-Ito reddish-purple
    hudGreen: "#0072b2",
    hudYellow: "#f0e442",
    hudOrange: "#e69f00",
    hudRed: "#cc79a7",
  },
  // Deuteranopia — green appears dim/dark. Most common form.
  // Use the canonical Okabe-Ito set: orange/blue/yellow/sky.
  deutan: {
    error: "#d55e00", // Okabe-Ito vermillion
    warning: "#f0e442",
    success: "#0072b2", // blue stands in for green
    info: "#56b4e9",
    accent: "#0072b2",
    accentMuted: "#005a8a",
    userMessage: "#56b4e9",
    assistantMessage: "#0072b2",
    systemMessage: "#f0e442",
    toolMessage: "#cc79a7",
    hudGreen: "#0072b2",
    hudYellow: "#f0e442",
    hudOrange: "#d55e00",
    hudRed: "#cc79a7",
  },
  // Tritanopia — blue/yellow confusion. Use red/green/teal mapping.
  tritan: {
    error: "#d55e00", // vermillion (high contrast)
    warning: "#cc79a7", // reddish-purple replaces yellow
    success: "#009e73", // bluish-green stays distinguishable
    info: "#e69f00", // orange replaces sky-blue
    accent: "#009e73",
    accentMuted: "#007a59",
    userMessage: "#e69f00",
    assistantMessage: "#009e73",
    systemMessage: "#cc79a7",
    toolMessage: "#d55e00",
    hudGreen: "#009e73",
    hudYellow: "#cc79a7",
    hudOrange: "#e69f00",
    hudRed: "#d55e00",
  },
};

// ── Public remapper ──────────────────────────────────────────────────

/**
 * Apply a colour-blind remap to a palette.
 *
 * Returns a NEW palette object — the input is never mutated
 * (immutability bar). When `mode` is null, the input palette is
 * returned as-is so callers can use this unconditionally:
 *
 *   const palette = applyColorBlindMode(theme.colors, detectColorBlindMode());
 *
 * Pure, deterministic, no I/O.
 */
export function applyColorBlindMode<P extends Palette>(palette: P, mode: ColorBlindMode | null): P {
  if (mode === null) return palette;
  const overrides = REMAP_TABLES[mode];
  // Merge into a fresh object — preserve any extra keys callers
  // attached (e.g. ThemeColors adds primary/secondary/textDim).
  return { ...palette, ...overrides } as P;
}

/**
 * Convenience wrapper — read env, then apply.
 */
export function applyEnvColorBlindMode<P extends Palette>(
  palette: P,
  env: NodeJS.ProcessEnv = process.env,
): P {
  return applyColorBlindMode(palette, detectColorBlindMode(env));
}

// ── Test helpers ─────────────────────────────────────────────────────

/** Internal — exported for tests to assert per-mode coverage. */
export const __REMAP_TABLES_FOR_TEST = REMAP_TABLES;
/** Internal — supported env values exposed for tests. */
export const __SUPPORTED_ENV_VALUES_FOR_TEST = Object.keys(COLOR_MODE_ENV_VALUES);
