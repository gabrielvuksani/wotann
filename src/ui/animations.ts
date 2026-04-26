/**
 * Motif moments — themed micro-animations for status transitions.
 *
 * A "motif moment" is a short, theme-aware visual flourish played at a
 * specific transition: session-start, session-end, error, success.
 * They're rendered by walking a small sequence of (frame, durationMs)
 * pairs — no external animation library, no requestAnimationFrame
 * loop. Ink components can subscribe via the
 * `useMotifMoment` hook (see below) which encapsulates the
 * setTimeout/clearTimeout dance per-render.
 *
 * ── Why a registry? ──────────────────────────────────────────────────
 * Different themes deserve different motifs. The dark/wotann default
 * gets the runic "ᚠ → ᚱ → ᛉ" cycle as a session-start nod to the brand.
 * High-contrast skips animation entirely (it adds visual noise without
 * carrying meaning under that palette). Sepia uses warm-tone glyphs.
 * Monochrome shrinks to a single bullet. The registry centralises this
 * so callers ask for "the start motif for the active palette" rather
 * than hardcoding glyphs per call site.
 *
 * ── Quality bars honoured ───────────────────────────────────────────
 * - QB #6  honest fallback: when the active palette opts out
 *   (high-contrast, accessibility-suppressed), the registry returns
 *   `null` — callers render nothing rather than a degenerate animation.
 * - QB #7  per-component state: `useMotifMoment` keeps the frame
 *   index in `useState`, never module-global.
 * - QB #11 sibling-site scan: matches the SPINNER_DOTS pattern in
 *   `theme/tokens.ts` — frames are a `readonly string[]` so consumers
 *   can iterate with the same idiom (`frames[i % frames.length]`).
 * - QB #13 env guard: never reads process.env directly. Accessibility
 *   suppression is threaded in through `MotifContext.suppress`.
 */

import { useEffect, useState } from "react";
import type { CanonicalPaletteName } from "./themes.js";

// ── Public types ─────────────────────────────────────────────────────

/** Names of motif transitions the registry supports. */
export type MotifTrigger = "session-start" | "session-end" | "error" | "success";

/** A single animation frame: a glyph string + how long to hold it. */
export interface MotifFrame {
  readonly glyph: string;
  readonly durationMs: number;
}

/** A motif moment is an ordered sequence of frames + an optional accent. */
export interface MotifMoment {
  /** Ordered frames. The animation stops after the last frame and the
   *  final glyph remains painted (use an empty trailing frame to clear). */
  readonly frames: readonly MotifFrame[];
  /** Tone slot to use for the glyph (matches keys on `Tone`). */
  readonly accent: "primary" | "success" | "warning" | "error" | "info" | "rune" | "muted";
  /** Optional one-line caption rendered alongside the animation. */
  readonly caption?: string;
}

/** Caller-supplied context that shapes which motif fires. */
export interface MotifContext {
  /** Active canonical palette. Picks per-palette variants. */
  readonly palette: CanonicalPaletteName;
  /** When true, motifs are suppressed entirely (returns null). Used by
   *  the accessibility layer to hide decorative animations. */
  readonly suppress?: boolean;
}

// ── Frame-budget defaults ────────────────────────────────────────────

/** Standard frame durations. Kept here so motif designers tune timing
 *  in one place rather than scattering literals. */
const TIMING = Object.freeze({
  /** ~6 fps — slow enough to read, fast enough to feel intentional. */
  slow: 180,
  /** ~12 fps — default for runic cycles. */
  med: 80,
  /** ~24 fps — used for terminal "ping" flashes. */
  fast: 40,
});

// ── Per-palette motif definitions ────────────────────────────────────

/**
 * The full motif registry. Indexed by palette → trigger → moment.
 * `undefined` (or omitted) means "no motif for this combo" — callers
 * should render nothing, not a fallback animation.
 */
const MOTIFS: Readonly<
  Record<CanonicalPaletteName, Readonly<Partial<Record<MotifTrigger, MotifMoment>>>>
> = Object.freeze({
  dark: {
    "session-start": {
      frames: [
        { glyph: "ᚠ", durationMs: TIMING.med },
        { glyph: "ᚱ", durationMs: TIMING.med },
        { glyph: "ᛉ", durationMs: TIMING.med },
        { glyph: "ᛉ", durationMs: TIMING.slow },
      ],
      accent: "rune",
      caption: "wotann ready",
    },
    "session-end": {
      frames: [
        { glyph: "●", durationMs: TIMING.med },
        { glyph: "○", durationMs: TIMING.med },
        { glyph: "·", durationMs: TIMING.slow },
      ],
      accent: "muted",
    },
    error: {
      frames: [
        { glyph: "✗", durationMs: TIMING.fast },
        { glyph: " ", durationMs: TIMING.fast },
        { glyph: "✗", durationMs: TIMING.fast },
        { glyph: "✗", durationMs: TIMING.slow },
      ],
      accent: "error",
    },
    success: {
      frames: [
        { glyph: "·", durationMs: TIMING.fast },
        { glyph: "•", durationMs: TIMING.fast },
        { glyph: "●", durationMs: TIMING.fast },
        { glyph: "✓", durationMs: TIMING.slow },
      ],
      accent: "success",
    },
  },
  light: {
    "session-start": {
      frames: [
        { glyph: "ᚠ", durationMs: TIMING.med },
        { glyph: "ᚱ", durationMs: TIMING.med },
        { glyph: "ᛉ", durationMs: TIMING.slow },
      ],
      accent: "primary",
    },
    "session-end": {
      frames: [
        { glyph: "○", durationMs: TIMING.med },
        { glyph: "·", durationMs: TIMING.slow },
      ],
      accent: "muted",
    },
    success: {
      frames: [
        { glyph: "·", durationMs: TIMING.fast },
        { glyph: "✓", durationMs: TIMING.slow },
      ],
      accent: "success",
    },
    error: {
      frames: [
        { glyph: "✗", durationMs: TIMING.fast },
        { glyph: " ", durationMs: TIMING.fast },
        { glyph: "✗", durationMs: TIMING.slow },
      ],
      accent: "error",
    },
  },
  sepia: {
    "session-start": {
      frames: [
        { glyph: "᛫", durationMs: TIMING.med },
        { glyph: "ᚠ", durationMs: TIMING.med },
        { glyph: "ᚠ", durationMs: TIMING.slow },
      ],
      accent: "rune",
    },
    success: {
      frames: [
        { glyph: "·", durationMs: TIMING.med },
        { glyph: "✓", durationMs: TIMING.slow },
      ],
      accent: "success",
    },
    error: {
      frames: [
        { glyph: "✗", durationMs: TIMING.med },
        { glyph: "✗", durationMs: TIMING.slow },
      ],
      accent: "error",
    },
    // session-end: omitted by design (sepia is "warm slow burn" — no
    // farewell flourish needed).
  },
  monochrome: {
    "session-start": {
      frames: [
        { glyph: "·", durationMs: TIMING.med },
        { glyph: "•", durationMs: TIMING.med },
        { glyph: "●", durationMs: TIMING.slow },
      ],
      accent: "primary",
    },
    success: {
      frames: [
        { glyph: "•", durationMs: TIMING.fast },
        { glyph: "●", durationMs: TIMING.slow },
      ],
      accent: "primary",
    },
    error: {
      frames: [
        { glyph: "X", durationMs: TIMING.fast },
        { glyph: " ", durationMs: TIMING.fast },
        { glyph: "X", durationMs: TIMING.slow },
      ],
      accent: "primary",
    },
    // session-end: omitted.
  },
  // High-contrast deliberately empty: under that palette, decorative
  // animations are visual noise and competing against content. Callers
  // get `null` and render nothing — honest fallback per QB #6.
  "high-contrast": {},
});

// ── Public registry API ──────────────────────────────────────────────

/**
 * Look up the motif for a (palette, trigger) pair. Returns `null` if
 * the palette opts out of that trigger or `ctx.suppress === true`
 * (accessibility-suppressed). Callers must handle null and render
 * nothing rather than fabricating a fallback.
 */
export function getMotifMoment(trigger: MotifTrigger, ctx: MotifContext): MotifMoment | null {
  if (ctx.suppress) return null;
  const paletteMotifs = MOTIFS[ctx.palette];
  if (!paletteMotifs) return null;
  const moment = paletteMotifs[trigger];
  return moment ?? null;
}

/**
 * Total duration of a motif (sum of all frame durations). Useful for
 * callers that need to schedule "fire post-motif" cleanup work.
 */
export function motifDurationMs(moment: MotifMoment): number {
  let total = 0;
  for (const f of moment.frames) total += f.durationMs;
  return total;
}

// ── Hook: render a motif inside an Ink component ─────────────────────

export interface UseMotifMomentResult {
  /** Current frame to render. `null` means the motif has not started
   *  or has finished and was not pinned. */
  readonly currentFrame: MotifFrame | null;
  /** True while the animation is actively cycling. */
  readonly isPlaying: boolean;
  /** Frame index (0-based). Useful for callers that want to pair the
   *  glyph with parallel state. */
  readonly frameIndex: number;
}

/**
 * useMotifMoment — drive a motif inside a function component.
 *
 * Each call site keeps its own setTimeout chain (per-component state,
 * not module-global per QB #7). When `moment` is null the hook is a
 * no-op and the timer chain stays unallocated.
 *
 * Cleanup cancels pending timeouts when the component unmounts or when
 * `moment` changes mid-animation. Re-entering the same motif resets
 * the index so a re-trigger plays from frame 0.
 */
export function useMotifMoment(moment: MotifMoment | null): UseMotifMomentResult {
  const [frameIndex, setFrameIndex] = useState<number>(-1);

  useEffect(() => {
    if (moment === null) {
      setFrameIndex(-1);
      return;
    }
    if (moment.frames.length === 0) {
      setFrameIndex(-1);
      return;
    }
    setFrameIndex(0);
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    for (let i = 0; i < moment.frames.length - 1; i++) {
      const frame = moment.frames[i];
      if (frame === undefined) continue;
      elapsed += frame.durationMs;
      const nextIndex = i + 1;
      const t = setTimeout(() => {
        if (!cancelled) setFrameIndex(nextIndex);
      }, elapsed);
      timeouts.push(t);
    }
    return () => {
      cancelled = true;
      for (const t of timeouts) clearTimeout(t);
    };
  }, [moment]);

  if (moment === null || moment.frames.length === 0 || frameIndex < 0) {
    return { currentFrame: null, isPlaying: false, frameIndex: -1 };
  }
  const safeIdx = Math.min(frameIndex, moment.frames.length - 1);
  const frame = moment.frames[safeIdx] ?? null;
  const isPlaying = frameIndex < moment.frames.length - 1;
  return { currentFrame: frame, isPlaying, frameIndex: safeIdx };
}

// ── Convenience: list all registered motifs ──────────────────────────

/**
 * Enumerate every (palette, trigger) pair that has a motif defined.
 * Useful for tests, the `/theme` debug command, and audits that want
 * to verify coverage parity across palettes.
 */
export function listMotifs(): readonly {
  readonly palette: CanonicalPaletteName;
  readonly trigger: MotifTrigger;
}[] {
  const out: { palette: CanonicalPaletteName; trigger: MotifTrigger }[] = [];
  for (const palette of Object.keys(MOTIFS) as CanonicalPaletteName[]) {
    const paletteMotifs = MOTIFS[palette];
    if (!paletteMotifs) continue;
    for (const trigger of Object.keys(paletteMotifs) as MotifTrigger[]) {
      if (paletteMotifs[trigger] !== undefined) {
        out.push({ palette, trigger });
      }
    }
  }
  return Object.freeze(out);
}
