/**
 * Theme system — WOTANN 5-palette consolidation (P1-UI1).
 *
 * Design:
 * - 5 CANONICAL palettes: dark, light, high-contrast, sepia, monochrome.
 * - Every palette implements the same typed {@link Palette} interface
 *   (11 role tokens + 4 message kinds + 4 HUD slots). No more scattered
 *   hex accents in callers — colors are looked up via tokens only.
 * - Legacy theme names (dracula, nord, tokyo-night, catppuccin-mocha,
 *   mimir, yggdrasil, …) still resolve via {@link ThemeManager.setTheme}
 *   so the /theme CLI and Ctrl+Y cycle keep working. They are aliases
 *   onto one of the 5 canonical palettes — purple stand-ins are gone.
 * - Norse cycle names (mimir/yggdrasil/runestone/bifrost/valkyrie) are
 *   preserved as aliases; Ctrl+Y remains a cycle of 5 distinct looks by
 *   remapping each Norse slot to a canonical palette.
 *
 * Purple purge:
 *   The old DARK_BASE used #6366f1/#8b5cf6/#a855f7/#cba6f7 as accents
 *   (vendor-biased). Those are now replaced by {@link Palette.accent} /
 *   {@link Palette.accentMuted} tokens. The default dark accent is
 *   #06b6d4 (cyan), which matches the WOTANN product palette from
 *   the rebrand — purple can still be opted in by selecting the
 *   "sepia" or custom themes that keep warmer accents.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ── Palette ─────────────────────────────────────────────────────────────────

/**
 * Typed palette token set. Every canonical palette exports exactly
 * these keys so callers can consume `theme.colors.<token>` safely.
 */
export interface Palette {
  /** Primary surface (window background). */
  readonly background: string;
  /** Slightly raised surface (panels, status bar). */
  readonly surface: string;
  /** Default foreground text. */
  readonly text: string;
  /** Dimmed text (metadata, hints). */
  readonly muted: string;
  /** Borders + dividers. */
  readonly border: string;
  /** Accent (focus, primary action, brand highlight). */
  readonly accent: string;
  /** Muted accent — hover/inactive variants. */
  readonly accentMuted: string;
  /** Info (neutral/assistive) — blue family. */
  readonly info: string;
  /** Success — green family. */
  readonly success: string;
  /** Warning — yellow/orange family. */
  readonly warning: string;
  /** Error — red family. */
  readonly error: string;

  /** Message kinds (chat log). */
  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly systemMessage: string;
  readonly toolMessage: string;

  /** HUD severity slots (context gauge, memory health). */
  readonly hudGreen: string;
  readonly hudYellow: string;
  readonly hudOrange: string;
  readonly hudRed: string;
}

/**
 * Legacy-shape colors kept for back-compat with old `theme.colors.*`
 * references in `App.tsx`. New code should use {@link Palette}.
 */
export interface ThemeColors extends Palette {
  /** @deprecated — use {@link Palette.accent}. */
  readonly primary: string;
  /** @deprecated — use {@link Palette.accentMuted}. */
  readonly secondary: string;
  /** @deprecated — use {@link Palette.muted}. */
  readonly textDim: string;
  /** @deprecated — use {@link Palette.surface}. */
  readonly statusBar: string;
}

export interface Theme {
  readonly name: string;
  readonly variant: "dark" | "light";
  readonly colors: ThemeColors;
}

export interface PersistedUIState {
  readonly theme?: string;
  readonly panel?: string;
}

/** Canonical palette identifiers. */
export const CANONICAL_PALETTES = [
  "dark",
  "light",
  "high-contrast",
  "sepia",
  "monochrome",
] as const;
export type CanonicalPaletteName = (typeof CANONICAL_PALETTES)[number];

// ── Canonical palette definitions ──────────────────────────────────────────

const DARK_PALETTE: Palette = {
  background: "#08080c",
  surface: "#131318",
  text: "#e6e6eb",
  muted: "#8b8b96",
  border: "#2a2a33",
  accent: "#06b6d4",
  accentMuted: "#0891b2",
  info: "#60a5fa",
  success: "#34d399",
  warning: "#fbbf24",
  error: "#f87171",
  userMessage: "#60a5fa",
  assistantMessage: "#34d399",
  systemMessage: "#fbbf24",
  toolMessage: "#06b6d4",
  hudGreen: "#34d399",
  hudYellow: "#fbbf24",
  hudOrange: "#f97316",
  hudRed: "#f87171",
};

const LIGHT_PALETTE: Palette = {
  background: "#fafafa",
  surface: "#f0f0f3",
  text: "#1e1e24",
  muted: "#6b6b75",
  border: "#d4d4dc",
  accent: "#0891b2",
  accentMuted: "#0e7490",
  info: "#2563eb",
  success: "#059669",
  warning: "#d97706",
  error: "#dc2626",
  userMessage: "#2563eb",
  assistantMessage: "#059669",
  systemMessage: "#d97706",
  toolMessage: "#0891b2",
  hudGreen: "#059669",
  hudYellow: "#d97706",
  hudOrange: "#ea580c",
  hudRed: "#dc2626",
};

const HIGH_CONTRAST_PALETTE: Palette = {
  background: "#000000",
  surface: "#0a0a0a",
  text: "#ffffff",
  muted: "#cccccc",
  border: "#ffffff",
  accent: "#00ffff",
  accentMuted: "#00cccc",
  info: "#00ffff",
  success: "#00ff00",
  warning: "#ffff00",
  error: "#ff0000",
  userMessage: "#00ffff",
  assistantMessage: "#00ff00",
  systemMessage: "#ffff00",
  toolMessage: "#ffffff",
  hudGreen: "#00ff00",
  hudYellow: "#ffff00",
  hudOrange: "#ff8000",
  hudRed: "#ff0000",
};

const SEPIA_PALETTE: Palette = {
  background: "#1a1410",
  surface: "#241b14",
  text: "#ebd5b3",
  muted: "#9c8972",
  border: "#3d2f1f",
  accent: "#d4a853",
  accentMuted: "#a88540",
  info: "#c8a876",
  success: "#8cb368",
  warning: "#e8a857",
  error: "#c87a5e",
  userMessage: "#c8a876",
  assistantMessage: "#d4a853",
  systemMessage: "#e8a857",
  toolMessage: "#b89468",
  hudGreen: "#8cb368",
  hudYellow: "#e8a857",
  hudOrange: "#d17d3d",
  hudRed: "#c87a5e",
};

const MONOCHROME_PALETTE: Palette = {
  background: "#000000",
  surface: "#111111",
  text: "#e0e0e0",
  muted: "#808080",
  border: "#333333",
  accent: "#ffffff",
  accentMuted: "#cccccc",
  info: "#bdbdbd",
  success: "#d0d0d0",
  warning: "#999999",
  error: "#666666",
  userMessage: "#e0e0e0",
  assistantMessage: "#ffffff",
  systemMessage: "#aaaaaa",
  toolMessage: "#888888",
  hudGreen: "#d0d0d0",
  hudYellow: "#999999",
  hudOrange: "#777777",
  hudRed: "#555555",
};

/** Canonical palettes indexed by name. */
export const PALETTES: Readonly<Record<CanonicalPaletteName, Palette>> = {
  dark: DARK_PALETTE,
  light: LIGHT_PALETTE,
  "high-contrast": HIGH_CONTRAST_PALETTE,
  sepia: SEPIA_PALETTE,
  monochrome: MONOCHROME_PALETTE,
};

/**
 * Severity tokens — palette-backed constants for components that aren't
 * (yet) theme-aware. Pulling from these instead of hardcoding hex keeps
 * callers inside the token system even when the Theme object isn't
 * threaded through props. Matches the dark palette; migrate to full
 * theme-aware props when a component gets refactored.
 */
export const SEVERITY = {
  green: DARK_PALETTE.hudGreen,
  yellow: DARK_PALETTE.hudYellow,
  orange: DARK_PALETTE.hudOrange,
  red: DARK_PALETTE.hudRed,
  accent: DARK_PALETTE.accent,
  accentMuted: DARK_PALETTE.accentMuted,
} as const;

/** Startup-logo gradient stops — token-backed (accent + info family). */
export const STARTUP_GRADIENT: readonly string[] = [
  DARK_PALETTE.accent,
  DARK_PALETTE.accentMuted,
  DARK_PALETTE.info,
  DARK_PALETTE.accent,
  DARK_PALETTE.accentMuted,
];

// ── Theme resolution (back-compat) ──────────────────────────────────────────

/** Convert a Palette into the legacy ThemeColors shape (adds aliases). */
function toThemeColors(p: Palette): ThemeColors {
  return {
    ...p,
    primary: p.accent,
    secondary: p.accentMuted,
    textDim: p.muted,
    statusBar: p.surface,
  };
}

/** Canonical palette → {dark, light} variant mapping. */
const PALETTE_VARIANT: Readonly<Record<CanonicalPaletteName, "dark" | "light">> = {
  dark: "dark",
  light: "light",
  "high-contrast": "dark",
  sepia: "dark",
  monochrome: "dark",
};

/**
 * Alias table — every theme name we ever supported resolves to one of
 * the 5 canonical palettes. Keeps `/theme dracula` from failing while
 * eliminating 60+ near-duplicate color sets.
 *
 * The Norse cycle (mimir→yggdrasil→runestone→bifrost→valkyrie) is
 * preserved as aliases so Ctrl+Y still produces 5 visibly distinct
 * looks (one per canonical palette).
 */
const THEME_ALIASES: Readonly<Record<string, CanonicalPaletteName>> = {
  // Canonical
  dark: "dark",
  light: "light",
  "high-contrast": "high-contrast",
  sepia: "sepia",
  monochrome: "monochrome",

  // Back-compat (default names)
  default: "dark",
  "default-light": "light",
  "high-contrast-light": "high-contrast",
  "monochrome-light": "light",
  wotann: "dark",
  "wotann-light": "light",

  // Norse cycle — one slot per canonical palette (Ctrl+Y rotates all 5).
  mimir: "sepia",
  yggdrasil: "dark",
  runestone: "monochrome",
  bifrost: "high-contrast",
  valkyrie: "light",

  // Legacy decorative names — mapped by best-fit variant
  "catppuccin-mocha": "dark",
  "catppuccin-latte": "light",
  dracula: "dark",
  nord: "dark",
  "gruvbox-dark": "dark",
  "gruvbox-light": "light",
  "solarized-dark": "dark",
  "solarized-light": "light",
  "tokyo-night": "dark",
  "one-dark": "dark",
  monokai: "dark",
  "github-dark": "dark",
  "github-light": "light",
  material: "dark",
  "ayu-dark": "dark",
  "ayu-light": "light",
  "everforest-dark": "dark",
  "rose-pine": "dark",
  "rose-pine-moon": "dark",
  "rose-pine-dawn": "light",
  vesper: "dark",
  kanagawa: "dark",
  nightfox: "dark",
  dayfox: "light",
  oxocarbon: "dark",
  synthwave: "dark",
  cyberpunk: "high-contrast",
  midnight: "dark",
  horizon: "dark",
  palenight: "dark",
  panda: "dark",
  "shades-of-purple": "dark",
  "winter-is-coming": "dark",
  cobalt2: "dark",
  "night-owl": "dark",
  "night-owl-light": "light",
  "atom-dark": "dark",
  "atom-light": "light",
  "vim-dark": "dark",
  helix: "dark",
  "zed-dark": "dark",
  "zed-light": "light",
  "fleet-dark": "dark",
  "jetbrains-dark": "dark",
  "jetbrains-light": "light",
  "vscode-dark": "dark",
  "vscode-light": "light",
  sublime: "dark",
  oceanic: "dark",
  aurora: "dark",
  arctic: "light",
  aura: "dark",
  moonlight: "dark",
  blueberry: "dark",
  ember: "dark",
  forest: "dark",
  lavender: "dark",
  slate: "dark",
};

function buildTheme(name: string, palette: CanonicalPaletteName): Theme {
  return {
    name,
    variant: PALETTE_VARIANT[palette],
    colors: toThemeColors(PALETTES[palette]),
  };
}

/** All registered themes — canonical + every alias → same typed Theme. */
const BUILTIN_THEMES: readonly Theme[] = Object.entries(THEME_ALIASES).map(([name, palette]) =>
  buildTheme(name, palette),
);

/** Canonical theme objects (always 5 entries, one per canonical palette). */
export const CANONICAL_THEMES: readonly Theme[] = CANONICAL_PALETTES.map((p) => buildTheme(p, p));

/** Norse theme preset identifiers — cycled by Ctrl+Y (TUI) / `/theme`. */
export const NORSE_THEMES: readonly string[] = [
  "mimir",
  "yggdrasil",
  "runestone",
  "bifrost",
  "valkyrie",
];

/**
 * Cycle through the Norse theme presets. Non-Norse current themes start
 * the cycle at `mimir`. Callers pass the result to `ThemeManager.setTheme`.
 */
export function cycleNorseTheme(current: string): string {
  const idx = NORSE_THEMES.indexOf(current);
  if (idx === -1) return NORSE_THEMES[0]!;
  return NORSE_THEMES[(idx + 1) % NORSE_THEMES.length]!;
}

/** Look up a palette by alias or canonical name. Returns null if unknown. */
export function resolvePalette(name: string): Palette | null {
  const canonical = THEME_ALIASES[name];
  if (!canonical) return null;
  return PALETTES[canonical];
}

// ── ThemeManager ───────────────────────────────────────────────────────────

export class ThemeManager {
  private currentTheme: Theme;
  private readonly themes: Map<string, Theme>;
  private readonly storagePath?: string;

  constructor(initialTheme: string = "dark", storagePath?: string) {
    this.themes = new Map(BUILTIN_THEMES.map((t) => [t.name, t]));
    this.storagePath = storagePath;
    const persisted = storagePath ? readPersistedUIState(storagePath) : {};
    const resolvedTheme = persisted.theme ?? initialTheme;
    this.currentTheme = this.themes.get(resolvedTheme) ?? this.themes.get("dark")!;
  }

  getCurrent(): Theme {
    return this.currentTheme;
  }

  setTheme(name: string): boolean {
    const theme = this.themes.get(name);
    if (!theme) return false;
    this.currentTheme = theme;
    this.persist({ theme: theme.name });
    return true;
  }

  getThemeNames(): readonly string[] {
    return [...this.themes.keys()];
  }

  getThemeCount(): number {
    return this.themes.size;
  }

  /** Canonical palette count — the 5-palette invariant this system enforces. */
  getCanonicalPaletteCount(): number {
    return CANONICAL_PALETTES.length;
  }

  addCustomTheme(theme: Theme): void {
    this.themes.set(theme.name, theme);
  }

  getByVariant(variant: "dark" | "light"): readonly Theme[] {
    return [...this.themes.values()].filter((t) => t.variant === variant);
  }

  autoDetectVariant(): "dark" | "light" {
    const colorScheme = process.env["COLORFGBG"];
    if (colorScheme) {
      const parts = colorScheme.split(";");
      const bg = parseInt(parts[parts.length - 1] ?? "0", 10);
      return bg > 8 ? "light" : "dark";
    }
    return "dark";
  }

  readPersistedState(): PersistedUIState {
    return this.storagePath ? readPersistedUIState(this.storagePath) : {};
  }

  persist(next: PersistedUIState): void {
    if (!this.storagePath) return;

    const current = readPersistedUIState(this.storagePath);
    const merged = { ...current, ...next };
    mkdirSync(dirname(this.storagePath), { recursive: true });
    writeFileSync(this.storagePath, JSON.stringify(merged, null, 2));
  }
}

function readPersistedUIState(storagePath: string): PersistedUIState {
  if (!existsSync(storagePath)) return {};

  try {
    const raw = readFileSync(storagePath, "utf-8");
    const parsed = JSON.parse(raw) as PersistedUIState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
