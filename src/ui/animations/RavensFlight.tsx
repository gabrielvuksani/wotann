/**
 * RavensFlight — themed loading animation (Wave 6-OO).
 *
 * A small Norse-flavoured raven that flutters across the available
 * width while a long-running task is in flight. The animation is
 * decorative — never a blocker. When motion is suppressed (screen
 * reader, reduce-motion preference, or non-TTY), we render a
 * static text token instead so the layout stays predictable.
 *
 * ── Why a separate component? ─────────────────────────────────────
 * Existing spinners (`primitives/Spinner`) are pure dot/braille
 * cyclers. They don't carry the brand. A raven that physically
 * traverses the row is the visual signature for "WOTANN is
 * working" — distinct from "WOTANN is buffering" (the small
 * spinner) and from "WOTANN succeeded/failed" (the SigilStamp).
 *
 * ── Per-instance state (QB#7) ─────────────────────────────────────
 * Frame counter and X position live in component state. Multiple
 * concurrent ravens (e.g. one in a status bar and one in a modal)
 * advance independently. Cleanup releases the timer on unmount and
 * when `active` flips to false.
 *
 * ── Honest fallback (QB#6) ────────────────────────────────────────
 * - When `WOTANN_SCREEN_READER=1` we render the literal text
 *   "WOTANN working..." instead of a moving glyph (screen readers
 *   would otherwise re-announce the position every tick).
 * - When `WOTANN_REDUCE_MOTION=1` we render a single static raven.
 * - When `process.stdout.isTTY` is false (pipes, CI logs) we
 *   render the static raven once and never advance.
 */

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";

import type { Tone } from "../theme/tokens.js";

// ── Animation tokens ─────────────────────────────────────────────────

/**
 * Wing-flap frames, swapped every `frameMs`. Two-character glyphs
 * preserve column width so the bird's body footprint is stable.
 */
const RAVEN_FRAMES: readonly string[] = ["◢◣", "◤◥", "◢◣", "◣◢"];

/** Glyph rendered when motion is suppressed. */
const RAVEN_STATIC = "◢◣";

/** Default interval between frame advances (ms). */
const DEFAULT_FRAME_MS = 140;

/** Default flight width — kept short so it fits in a status row. */
const DEFAULT_FLIGHT_WIDTH = 16;

// ── Public API ───────────────────────────────────────────────────────

export interface RavensFlightProps {
  /** Whether the animation is running. */
  readonly active: boolean;
  /** Frame interval in ms. Defaults to 140. */
  readonly frameMs?: number;
  /** Number of cells the raven traverses. Defaults to 16. */
  readonly width?: number;
  /** Optional palette-aware color hint. Defaults to "cyan" (Ink color name). */
  readonly tone?: Tone;
  /** Optional label appended after the raven (e.g. "indexing repo..."). */
  readonly label?: string;
}

/**
 * Detect whether motion should be suppressed. Pure read of env +
 * stdout — never throws. Wave 6-NN owns the canonical accessibility
 * flag set; we read the same env vars to stay in sync without
 * importing their (concurrent) source.
 */
function shouldSuppressMotion(): boolean {
  if (process.env["WOTANN_SCREEN_READER"] === "1") return true;
  if (process.env["WOTANN_REDUCE_MOTION"] === "1") return true;
  if (!process.stdout.isTTY) return true;
  return false;
}

/**
 * RavensFlight — animated raven that traverses the row from left to
 * right, then loops back to the start. When `active === false` the
 * component renders nothing (so it can be inlined without reserving
 * vertical space).
 */
export function RavensFlight({
  active,
  frameMs = DEFAULT_FRAME_MS,
  width = DEFAULT_FLIGHT_WIDTH,
  tone,
  label,
}: RavensFlightProps): React.ReactElement | null {
  const [frame, setFrame] = useState<number>(0);
  const [position, setPosition] = useState<number>(0);
  const motionSuppressed = shouldSuppressMotion();

  useEffect(() => {
    if (!active) return;
    if (motionSuppressed) return;
    const handle = setInterval(
      () => {
        setFrame((current) => (current + 1) % RAVEN_FRAMES.length);
        setPosition((current) => (current + 1) % Math.max(width, 1));
      },
      Math.max(frameMs, 16),
    );
    return () => {
      clearInterval(handle);
    };
  }, [active, frameMs, width, motionSuppressed]);

  if (!active) return null;

  const accentColor = tone?.primary ?? "cyan";

  if (motionSuppressed) {
    // Honest fallback — no motion. Screen readers see one static
    // string per render, not a moving target.
    return (
      <Box>
        <Text color={accentColor}>{RAVEN_STATIC}</Text>
        {label !== undefined && (
          <Text> WOTANN working{label.length > 0 ? `: ${label}` : "..."}</Text>
        )}
      </Box>
    );
  }

  const glyph = RAVEN_FRAMES[frame] ?? RAVEN_STATIC;
  const safePosition = Math.min(position, Math.max(width - 1, 0));
  const leadingPad = " ".repeat(safePosition);
  const trailingPad = " ".repeat(Math.max(width - safePosition - 2, 0));

  return (
    <Box>
      <Text>{leadingPad}</Text>
      <Text color={accentColor}>{glyph}</Text>
      <Text>{trailingPad}</Text>
      {label !== undefined && label.length > 0 && <Text> {label}</Text>}
    </Box>
  );
}

// ── Test helpers (exported for unit tests, not for app code) ────────

/** Internal — exported so tests can assert frame coverage. */
export const __RAVEN_FRAMES_FOR_TEST = RAVEN_FRAMES;
/** Internal — exported so tests can assert the static fallback glyph. */
export const __RAVEN_STATIC_FOR_TEST = RAVEN_STATIC;
