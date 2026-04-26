/**
 * Accessibility — TUI screen-reader & high-contrast support.
 *
 * Provides a single source of truth for two accessibility modes the
 * rest of the TUI consumes:
 *
 *   1. Screen-reader mode (`WOTANN_SCREEN_READER=1`)
 *      - Suppresses decorative animations (motif moments, spinners).
 *      - Adds aria-style descriptions to status surfaces (a "describe()"
 *        helper that returns a flat english summary string the TUI can
 *        emit alongside or in place of glyph-heavy content).
 *      - Avoids unicode glyphs that screen readers tend to mispronounce.
 *
 *   2. High-contrast mode (`WOTANN_HIGH_CONTRAST=1`)
 *      - Forces the canonical "high-contrast" palette (already defined
 *        in themes.ts).
 *      - Switches the design system to bold-only / monochrome so colour
 *        encoding is supplemented by weight (important for low-colour
 *        terminals and colour-blind users).
 *
 * ── Honest stub note (QB #6) ─────────────────────────────────────────
 * Real screen-reader detection requires per-platform APIs (NVDA via the
 * Windows accessibility tree, JAWS via SAPI, VoiceOver via macOS
 * NSAccessibility). Doing that from a Node TUI is outside this layer's
 * scope — we honour the explicit `WOTANN_SCREEN_READER=1` env var so
 * users can opt-in deterministically. The detection function is a
 * stub that documents the limit clearly rather than pretending to
 * sniff the OS.
 *
 * ── QB compliance ────────────────────────────────────────────────────
 * - QB #6 honest stub: env-var fallback, not OS sniffing. The doc and
 *   the field name (`source`) make this explicit.
 * - QB #7 per-component state: `AccessibilitySettings` is an immutable
 *   value object. No module-level mutable state — caller calls
 *   `detectAccessibilitySettings()` once at bootstrap and threads the
 *   result through props.
 * - QB #11 sibling-site scan: env var format matches `WOTANN_NO_FLICKER`
 *   from App.tsx (`"1"` or `"true"` triggers, anything else is off).
 * - QB #13 env guard: this module is the SINGLE place that reads the
 *   accessibility env vars. Other modules consume the resolved
 *   `AccessibilitySettings` value, never the env var directly.
 */

import type { CanonicalPaletteName } from "./themes.js";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Resolved accessibility settings. Immutable; build once at bootstrap
 * and thread through props rather than re-detecting per render.
 */
export interface AccessibilitySettings {
  /** True when decorative animations + glyph-heavy content should be
   *  suppressed. Drives the `MotifContext.suppress` flag and the
   *  StatusBar's "screen-reader summary" line. */
  readonly screenReader: boolean;
  /** True when colour encoding should be supplemented by weight + the
   *  high-contrast palette should be forced. */
  readonly highContrast: boolean;
  /**
   * Where the settings came from. `"env"` means an explicit
   * `WOTANN_SCREEN_READER` / `WOTANN_HIGH_CONTRAST` env var; `"default"`
   * means neither was set and we fell back to "off".
   *
   * Surfaced so callers can diagnose surprising behaviour ("why is my
   * spinner missing?") without having to grep env state.
   */
  readonly source: "env" | "default";
  /**
   * Forced palette name when `highContrast === true`. Always
   * `"high-contrast"` for the env-driven mode; reserved as an
   * extension point for future runtime overrides (e.g. user prefs).
   */
  readonly forcedPalette?: CanonicalPaletteName;
}

// ── Env helpers ──────────────────────────────────────────────────────

/** Parse a "truthy" env value the same way other WOTANN env vars do. */
function envTruthy(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Detect screen-reader mode from environment.
 *
 * HONEST STUB: This is env-var-only. Real detection (NVDA/JAWS/VoiceOver)
 * requires per-platform OS calls that don't belong in the TUI layer.
 * Setting `WOTANN_SCREEN_READER=1` explicitly opts in.
 *
 * Also honours common upstream conventions when present:
 *   - `NO_DECORATIVE_ANIMATIONS=1` (third-party convention)
 *   - `WOTANN_A11Y=1` (catch-all for "any accessibility mode on")
 */
export function detectScreenReaderEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    envTruthy(env["WOTANN_SCREEN_READER"]) ||
    envTruthy(env["WOTANN_A11Y"]) ||
    envTruthy(env["NO_DECORATIVE_ANIMATIONS"])
  );
}

/**
 * Detect high-contrast mode from environment.
 *
 * Set `WOTANN_HIGH_CONTRAST=1` to force the high-contrast palette.
 * Also opts in when `WOTANN_A11Y=1` (the catch-all flag).
 */
export function detectHighContrastEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return envTruthy(env["WOTANN_HIGH_CONTRAST"]) || envTruthy(env["WOTANN_A11Y"]);
}

// ── Public detection entry point ─────────────────────────────────────

/**
 * Build an `AccessibilitySettings` snapshot. Pure function — pass an
 * explicit `env` for tests or threading caller-controlled values.
 *
 * Callers should invoke this exactly once at TUI bootstrap and thread
 * the result through React context / props (per QB #7 — no module-level
 * mutable global).
 */
export function detectAccessibilitySettings(
  env: NodeJS.ProcessEnv = process.env,
): AccessibilitySettings {
  const screenReader = detectScreenReaderEnv(env);
  const highContrast = detectHighContrastEnv(env);
  const source: "env" | "default" = screenReader || highContrast ? "env" : "default";
  return Object.freeze({
    screenReader,
    highContrast,
    source,
    forcedPalette: highContrast ? ("high-contrast" as CanonicalPaletteName) : undefined,
  });
}

/**
 * "All off" baseline. Useful for tests and for callers that want a
 * stable identity to compare against without re-detecting env state.
 */
export const ACCESSIBILITY_DEFAULT: AccessibilitySettings = Object.freeze({
  screenReader: false,
  highContrast: false,
  source: "default",
});

// ── Aria-style descriptions ──────────────────────────────────────────

/**
 * Summary input shape for the StatusBar. Maps to the props the
 * StatusBar component already receives so callers can pass the same
 * snapshot they use to render the bar.
 */
export interface StatusBarA11yInput {
  readonly model: string;
  readonly provider: string;
  readonly mode: string;
  readonly cost: number;
  readonly contextPercent: number;
  readonly turnCount?: number;
  readonly isStreaming?: boolean;
}

/**
 * Render a flat english summary of the StatusBar contents. Screen
 * readers consume this instead of (or alongside) the glyph-heavy bar.
 *
 * Example: `"Status: claude-sonnet via anthropic, mode auto, streaming,
 * cost $0.123, context 42 percent, turn 7."`
 */
export function describeStatusBar(input: StatusBarA11yInput): string {
  const parts: string[] = [];
  parts.push(`${input.model} via ${input.provider}`);
  parts.push(`mode ${input.mode}`);
  if (input.isStreaming) parts.push("streaming");
  parts.push(`cost $${input.cost.toFixed(3)}`);
  parts.push(`context ${input.contextPercent} percent`);
  if (input.turnCount !== undefined && input.turnCount > 0) {
    parts.push(`turn ${input.turnCount}`);
  }
  return `Status: ${parts.join(", ")}.`;
}

/**
 * Render a flat english summary of a context HUD reading. Used by
 * screen-reader mode to announce token-budget changes without parsing
 * progress-bar glyphs.
 */
export function describeContextUsage(input: {
  readonly tokensUsed: number;
  readonly tokensBudget: number;
  readonly percent: number;
}): string {
  const used = input.tokensUsed.toLocaleString();
  const budget = input.tokensBudget.toLocaleString();
  return `Context usage: ${used} of ${budget} tokens, ${Math.round(input.percent)} percent.`;
}

/**
 * Render a flat english summary of a sparkline series. Replaces the
 * block-character chart with a textual trend + last-sample readout for
 * screen-reader users.
 */
export function describeSparkline(data: readonly number[], label?: string): string {
  if (data.length === 0) {
    return `${label ?? "Sparkline"}: no data.`;
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;
  for (const v of data) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    count++;
  }
  if (count === 0) return `${label ?? "Sparkline"}: no usable data.`;
  const last = data[data.length - 1];
  const lastStr = Number.isFinite(last) ? (last as number).toFixed(2) : "n/a";
  const avg = (sum / count).toFixed(2);
  const trend = describeTrend(data);
  return `${label ?? "Sparkline"}: latest ${lastStr}, average ${avg}, range ${min.toFixed(2)} to ${max.toFixed(2)}, trend ${trend}.`;
}

/**
 * Return a one-word trend label ("rising" / "falling" / "flat") by
 * comparing the first half of the series to the second. Cheap, no
 * statistics — good enough for an aria summary.
 */
function describeTrend(data: readonly number[]): string {
  if (data.length < 2) return "flat";
  const mid = Math.floor(data.length / 2);
  let firstSum = 0;
  let firstCount = 0;
  for (let i = 0; i < mid; i++) {
    const v = data[i];
    if (Number.isFinite(v)) {
      firstSum += v as number;
      firstCount++;
    }
  }
  let secondSum = 0;
  let secondCount = 0;
  for (let i = mid; i < data.length; i++) {
    const v = data[i];
    if (Number.isFinite(v)) {
      secondSum += v as number;
      secondCount++;
    }
  }
  if (firstCount === 0 || secondCount === 0) return "flat";
  const firstAvg = firstSum / firstCount;
  const secondAvg = secondSum / secondCount;
  const delta = secondAvg - firstAvg;
  // Treat sub-1% changes as flat to avoid overclaiming on noise.
  const denom = Math.abs(firstAvg) > 1e-9 ? Math.abs(firstAvg) : 1;
  const ratio = delta / denom;
  if (ratio > 0.01) return "rising";
  if (ratio < -0.01) return "falling";
  return "flat";
}

// ── Palette resolution ───────────────────────────────────────────────

/**
 * Apply accessibility settings to a requested palette. When
 * `highContrast` is on, the requested palette is overridden; otherwise
 * the request is honoured.
 *
 * Prefer this over scattering "if highContrast" branches across
 * components — keeps the palette policy in one place.
 */
export function resolvePaletteName(
  requested: CanonicalPaletteName,
  settings: AccessibilitySettings,
): CanonicalPaletteName {
  if (settings.highContrast && settings.forcedPalette !== undefined) {
    return settings.forcedPalette;
  }
  return requested;
}

/**
 * "Should this decorative element render?" predicate. A single helper
 * so spinners, motifs, and other ornaments share one branch.
 */
export function shouldShowDecorativeAnimation(settings: AccessibilitySettings): boolean {
  // Screen-reader mode always suppresses decorative animation.
  // High-contrast keeps animation but switches palette — animations
  // remain useful for sighted-but-low-vision users.
  return !settings.screenReader;
}
