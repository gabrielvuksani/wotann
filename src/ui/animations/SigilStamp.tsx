/**
 * SigilStamp — runic glyph that "stamps" briefly at notable moments.
 *
 * Wave 6-OO TUI v2 Phase 2 element. A SigilStamp is a single Elder
 * Futhark rune flashing through a short color sequence to mark:
 *   - session-start (assistant ready)
 *   - success (task completed)
 *   - error (task failed)
 *
 * The animation is intentionally brief — three palette steps then
 * the rune settles into its rest color. Long enough to register
 * peripheral attention, short enough that it never lingers.
 *
 * ── Themeability ──────────────────────────────────────────────────
 * The active palette is consumed via the optional `tone` prop. We
 * map each kind to a palette slot:
 *   start   → tone.primary  (cyan signature)
 *   success → tone.success  (green family)
 *   error   → tone.error    (red family)
 * Callers can override with an explicit `color` prop when they
 * want a non-semantic flash (e.g. a celebratory milestone).
 *
 * ── Per-instance state (QB#7) ─────────────────────────────────────
 * Each stamp owns its own animation frame. Multiple concurrent
 * stamps (rare but possible — say, two parallel tools both
 * succeeding at once) animate independently. Cleanup releases the
 * timer on unmount or when the stamp completes.
 *
 * ── Accessibility ─────────────────────────────────────────────────
 * When `WOTANN_SCREEN_READER=1` we render the static rune in the
 * rest color, with no flashing. When `WOTANN_REDUCE_MOTION=1` the
 * same path applies — assistive tech does not lose information,
 * it just doesn't get the color cycle.
 */

import React, { useEffect, useState } from "react";
import { Text } from "ink";

import type { Tone } from "../theme/tokens.js";

// ── Glyphs — Elder Futhark runes used as semantic stamps ─────────────

/**
 * Elder Futhark rune set used by SigilStamp. Each kind picks a rune
 * with semantically resonant meaning in Norse symbology — close
 * enough that the visual feels intentional, abstract enough that
 * the meaning never overrides the literal status.
 *
 * - ᚠ (fehu)   — wealth/start — used for session-start
 * - ᚢ (uruz)   — strength/health — used for success
 * - ᚣ (yr)     — yew/warning — used for error
 * - ᚡ (vend)   — generic flourish — used as the default rest glyph
 */
export const SIGIL_GLYPHS = {
  start: "ᚠ",
  success: "ᚢ",
  error: "ᚣ",
  neutral: "ᚡ",
} as const;

export type SigilKind = keyof typeof SIGIL_GLYPHS;

// ── Animation tokens ─────────────────────────────────────────────────

/** Frames per kind — each entry is a color-name + duration pair. */
interface SigilFrame {
  /** Ink color name OR hex string. */
  readonly color: string;
  /** Duration in ms before advancing to the next frame. */
  readonly durationMs: number;
}

const DEFAULT_FRAME_DURATION_MS = 90;

/** Default frame count — three flashes then settle. */
const DEFAULT_FLASH_FRAMES = 3;

// ── Public API ───────────────────────────────────────────────────────

export interface SigilStampProps {
  /** Which semantic stamp to render. */
  readonly kind: SigilKind;
  /** Optional tone for theme-aware coloring. */
  readonly tone?: Tone;
  /** Override the auto-picked rune. */
  readonly glyph?: string;
  /** Override the rest color (after flashing finishes). */
  readonly color?: string;
  /** Per-frame duration in ms. Defaults to 90. */
  readonly frameMs?: number;
  /** Number of color-cycle frames before settling. Defaults to 3. */
  readonly flashFrames?: number;
  /**
   * If true, the stamp re-fires whenever this prop changes value
   * (any new value triggers a fresh stamp). Useful for re-animating
   * on the same kind without unmount/remount.
   */
  readonly nonce?: number | string;
}

function shouldSuppressMotion(): boolean {
  if (process.env["WOTANN_SCREEN_READER"] === "1") return true;
  if (process.env["WOTANN_REDUCE_MOTION"] === "1") return true;
  if (!process.stdout.isTTY) return true;
  return false;
}

function pickRestColor(
  kind: SigilKind,
  tone: Tone | undefined,
  override: string | undefined,
): string {
  if (override) return override;
  if (tone) {
    if (kind === "success") return tone.success;
    if (kind === "error") return tone.error;
    if (kind === "start") return tone.primary;
    return tone.muted;
  }
  if (kind === "success") return "green";
  if (kind === "error") return "red";
  if (kind === "start") return "cyan";
  return "white";
}

function buildFlashFrames(
  kind: SigilKind,
  tone: Tone | undefined,
  override: string | undefined,
  frameMs: number,
  count: number,
): readonly SigilFrame[] {
  const settle = pickRestColor(kind, tone, override);
  // Two-tone flash: alternate between accent and rest. A simple
  // pulse pattern is enough — over-engineering colour transitions
  // doesn't help the user perceive "something happened".
  const pulse = tone?.primary ?? "cyan";
  const frames: SigilFrame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({ color: i % 2 === 0 ? pulse : settle, durationMs: frameMs });
  }
  // Final frame — the rest color. Stays put indefinitely.
  frames.push({ color: settle, durationMs: 0 });
  return frames;
}

/**
 * SigilStamp — short animated rune flash, then settle.
 *
 * Renders a single character. Use it inline in status rows or atop
 * notification banners. The component's footprint is one cell.
 */
export function SigilStamp({
  kind,
  tone,
  glyph,
  color,
  frameMs = DEFAULT_FRAME_DURATION_MS,
  flashFrames = DEFAULT_FLASH_FRAMES,
  nonce,
}: SigilStampProps): React.ReactElement {
  const motionSuppressed = shouldSuppressMotion();
  const frames = buildFlashFrames(kind, tone, color, frameMs, flashFrames);
  const [frameIdx, setFrameIdx] = useState<number>(0);

  // Re-trigger animation whenever kind or nonce changes.
  useEffect(() => {
    setFrameIdx(0);
  }, [kind, nonce]);

  useEffect(() => {
    if (motionSuppressed) return;
    if (frameIdx >= frames.length - 1) return;
    const current = frames[frameIdx];
    if (current === undefined) return;
    if (current.durationMs <= 0) return;
    const handle = setTimeout(() => {
      setFrameIdx((idx) => Math.min(idx + 1, frames.length - 1));
    }, current.durationMs);
    return () => {
      clearTimeout(handle);
    };
  }, [frameIdx, frames, motionSuppressed]);

  const renderedGlyph = glyph ?? SIGIL_GLYPHS[kind];
  const renderedColor = motionSuppressed
    ? pickRestColor(kind, tone, color)
    : (frames[frameIdx]?.color ?? pickRestColor(kind, tone, color));

  return <Text color={renderedColor}>{renderedGlyph}</Text>;
}

// ── Test helpers ─────────────────────────────────────────────────────

/** Internal — exported so tests can assert glyph coverage. */
export const __SIGIL_GLYPHS_FOR_TEST = SIGIL_GLYPHS;
