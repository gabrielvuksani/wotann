/**
 * Design tokens — semantic surface for the TUI.
 *
 * Layered on top of `src/ui/themes.ts` (the canonical 5-palette system),
 * this module exposes a small, readable vocabulary that components can
 * import without juggling hex colors or remembering severity/rune
 * conventions.
 *
 * ── Why a second token layer? ────────────────────────────────────────
 * `themes.ts` owns the palette graph (dark/light/sepia/...) and is
 * already wired through `ThemeManager`. But components historically
 * picked literal Ink color names ("cyan", "magenta", "green") and
 * scattered glyphs ("●", "▸", "✓") inline, which made:
 *   - The cyan signature inconsistent (some places used "cyan", others
 *     "blue", others SEVERITY.accent — same intent, three spellings).
 *   - Norse runic punctuation impossible to roll out without a global
 *     find-replace.
 *   - Status meaning leaky: "yellow" sometimes meant warning, sometimes
 *     "muted info", sometimes just "different".
 *
 * This module names the intents — `tone.primary`, `tone.success`,
 * `glyph.statusOk`, `rune.ask` — so callers describe meaning rather
 * than ink color.
 *
 * ── Pull from the active palette ─────────────────────────────────────
 * Every tone token resolves to a hex from `Palette` so theme switches
 * (Ctrl+Y / `/theme dracula` / etc.) flow through automatically. We
 * accept a `Palette` argument when building a token bundle so the
 * caller can pass `themeManager.getCurrent().colors` and stay aligned
 * with the rest of the surface.
 *
 * For places that don't yet thread the active theme through props, we
 * also export `STATIC_TOKENS` — a snapshot bound to the canonical dark
 * palette which matches the historical SEVERITY constant. Existing
 * callers that import SEVERITY can migrate to STATIC_TOKENS without a
 * behaviour change.
 */

import type { Palette } from "../themes.js";
import { PALETTES } from "../themes.js";

// ── Tones — semantic color slots ─────────────────────────────────────

/**
 * A `Tone` is a named color role. Components reference tones (e.g.
 * `tone.success`) instead of literal Ink names so theming + visual
 * consistency stay coupled.
 */
export interface Tone {
  /** Brand accent — cyan signature, focus rings, key actions. */
  readonly primary: string;
  /** Muted accent — secondary buttons, inactive focus. */
  readonly primaryMuted: string;
  /** Default text color (inherits theme.text). */
  readonly text: string;
  /** Dimmed metadata text. */
  readonly muted: string;
  /** Border / divider color. */
  readonly border: string;
  /** Surface background (panels, status bar). */
  readonly surface: string;
  /** Info severity (neutral assistive). */
  readonly info: string;
  /** Success severity. */
  readonly success: string;
  /** Warning severity. */
  readonly warning: string;
  /** Error severity. */
  readonly error: string;
  /** Danger — same family as error but reserved for destructive cues. */
  readonly danger: string;
  /** Norse signature accent — used for runic glyphs and ornaments. */
  readonly rune: string;
}

/** Build a `Tone` bundle from any `Palette`. */
export function buildTone(palette: Palette): Tone {
  return {
    primary: palette.accent,
    primaryMuted: palette.accentMuted,
    text: palette.text,
    muted: palette.muted,
    border: palette.border,
    surface: palette.surface,
    info: palette.info,
    success: palette.success,
    warning: palette.warning,
    error: palette.error,
    danger: palette.error,
    // Rune defaults to the accent (cyan). Sepia/light themes still get
    // a tonally-coherent rune color this way.
    rune: palette.accent,
  };
}

// ── Glyphs — meaning-carrying unicode characters ─────────────────────

/**
 * Status glyphs. Used by progress, agent list, dispatch inbox, etc.
 * Pulling from one place means a status icon refresh is one edit, not
 * 12.
 */
export const glyph = Object.freeze({
  /** Filled dot — running / active / unread. */
  statusActive: "●", // ●
  /** Empty dot — idle / inactive. */
  statusIdle: "○", // ○
  /** Heavy check — completed ok. */
  statusOk: "✓", // ✓
  /** Heavy cross — failed. */
  statusFail: "✗", // ✗
  /** Half-filled — in progress / partial / snoozed. */
  statusPartial: "◐", // ◐
  /** Quarter-filled — queued / paused. */
  statusQueued: "◑", // ◑
  /** Right-pointing pointer — selected row / cursor. */
  pointer: "▸", // ▸
  /** Diamond — assistant role badge. */
  badgeAssistant: "◆", // ◆
  /** Right arrow — navigation hint. */
  arrowRight: "→", // →
  /** Left arrow — back navigation. */
  arrowLeft: "←", // ←
  /** Up arrow — history prev. */
  arrowUp: "↑", // ↑
  /** Down arrow — history next. */
  arrowDown: "↓", // ↓
  /** Bullet for muted lists. */
  bullet: "·", // ·
  /** Vertical bar — section separator in keyhint footer. */
  separator: "│", // │
  /** Block — progress bar fill. */
  progressFill: "█", // █
  /** Light shade — progress bar empty. */
  progressEmpty: "░", // ░
  /** Cursor — text input. */
  cursorBlock: "█", // █
  /** Streaming dot — animated cursor. */
  streamingTail: "▌", // ▌
});

export type GlyphName = keyof typeof glyph;

// ── Runes — Norse signature glyphs ───────────────────────────────────

/**
 * Three runic glyphs reserved as visual punctuation for WOTANN's
 * three command modes. Used sparingly — a single rune in a banner
 * carries the brand without crowding the layout.
 *
 * Mapping per CLAUDE.md:
 *   ᚠ Fehu     — Ask / wealth / starting state
 *   ᚱ Raidho   — Relay / journey / hand-off
 *   ᛉ Algiz    — Autopilot / protection / autonomous
 */
export const rune = Object.freeze({
  ask: "ᚠ", // ᚠ
  relay: "ᚱ", // ᚱ
  autopilot: "ᛉ", // ᛉ
});

// ── Spinners ──────────────────────────────────────────────────────────

/**
 * Braille spinner — preferred default. 10 frames at ~80ms gives a
 * smooth rotating dot. Encoded as a tuple so consumers can do
 * `frames[i % frames.length]` without rebuilding arrays.
 */
export const SPINNER_DOTS: readonly string[] = [
  "⠋", // ⠋
  "⠙", // ⠙
  "⠹", // ⠹
  "⠸", // ⠸
  "⠼", // ⠼
  "⠴", // ⠴
  "⠦", // ⠦
  "⠧", // ⠧
  "⠇", // ⠇
  "⠏", // ⠏
];

/** Slower bullet-pulse spinner — for low-priority background hints. */
export const SPINNER_PULSE: readonly string[] = [
  "·", // ·
  "•", // •
  "●", // ●
  "•", // •
];

// ── Spacing rhythm ────────────────────────────────────────────────────

/**
 * Vertical spacing rhythm. Ink boxes use unitless line heights; we
 * standardize on these so panels feel consistent without one-off
 * marginTop/marginBottom values scattered through callers.
 */
export const space = Object.freeze({
  /** Tight — used inside related elements (e.g. badge + label). */
  tight: 0,
  /** Single — between paragraphs in the same panel. */
  single: 1,
  /** Block — between major panel sections. */
  block: 2,
});

// ── Border + radius preferences ──────────────────────────────────────

/**
 * Ink supports a fixed set of border styles. We standardize on rounded
 * ("╭...") for cards/overlays and single ("─") for separator
 * rules. Components use `border.card` rather than `borderStyle="round"`
 * so a future migration to a richer style is a single-token swap.
 */
export const border = Object.freeze({
  /** Rounded box — overlays, panels, banners. */
  card: "round" as const,
  /** Single line — internal separators, status bars. */
  rule: "single" as const,
  /** Bold double — heavy callouts (errors, security). */
  heavy: "double" as const,
});

export type BorderToken = (typeof border)[keyof typeof border];

// ── Static fallback tokens ──────────────────────────────────────────

/**
 * Snapshot bundle bound to the dark palette. Components that don't yet
 * thread the active theme through props can import these and still
 * stay inside the token system. Matches the legacy `SEVERITY` constant.
 */
export const STATIC_TOKENS: Readonly<{
  readonly tone: Tone;
}> = Object.freeze({
  tone: buildTone(PALETTES.dark),
});

// ── Convenience: package the full design system ──────────────────────

/**
 * Compose all token surfaces for the active theme. Callers that only
 * need glyphs/runes can import them directly; components that consume
 * tone tokens pass `palette` and get a Tone bundle aligned to the
 * active theme.
 */
export interface DesignSystem {
  readonly tone: Tone;
  readonly glyph: typeof glyph;
  readonly rune: typeof rune;
  readonly space: typeof space;
  readonly border: typeof border;
  readonly spinner: {
    readonly dots: readonly string[];
    readonly pulse: readonly string[];
  };
}

export function buildDesignSystem(palette: Palette): DesignSystem {
  return {
    tone: buildTone(palette),
    glyph,
    rune,
    space,
    border,
    spinner: {
      dots: SPINNER_DOTS,
      pulse: SPINNER_PULSE,
    },
  };
}

/**
 * Default design system bound to the dark palette. Stable identity so
 * `React.memo` predicates can compare by reference.
 */
export const DEFAULT_DESIGN_SYSTEM: DesignSystem = buildDesignSystem(PALETTES.dark);
