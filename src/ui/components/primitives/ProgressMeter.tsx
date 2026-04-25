/**
 * ProgressMeter — block-character progress bar with semantic coloring.
 *
 * Used by the StatusBar (context %), ContextHUD (token usage), and
 * any future "how full is this?" cue. Pulls glyphs from the design
 * tokens so the fill character can be swapped centrally if the
 * ASCII fallback path needs a non-unicode option.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Tone } from "../../theme/tokens.js";
import { glyph } from "../../theme/tokens.js";

export interface ProgressMeterProps {
  /** Active palette tones. */
  readonly tone: Tone;
  /** Percent (0-100). Clamped on render. */
  readonly percent: number;
  /** Bar width in cells. Default 20. */
  readonly width?: number;
  /** Override the fill character. Default: ▓ (medium block). */
  readonly fillChar?: string;
  /** Override the empty character. Default: ░. */
  readonly emptyChar?: string;
  /** Show the percentage text after the bar. Default true. */
  readonly showLabel?: boolean;
  /** Optional explicit color tone for the bar (default: severity from percent). */
  readonly toneOverride?: keyof Tone;
}

/**
 * Percent → severity tone slot.
 *   <50  → success (green-ish)
 *   <70  → primary (cyan/info)
 *   <85  → warning
 *   else → error
 */
function severityFromPercent(percent: number): keyof Tone {
  if (percent < 50) return "success";
  if (percent < 70) return "primary";
  if (percent < 85) return "warning";
  return "error";
}

/**
 * ProgressMeter — render a horizontal block bar with optional label.
 *
 *   ▓▓▓▓▓▓▓▓░░░░░░░░  47%
 */
export function ProgressMeter({
  tone,
  percent,
  width = 20,
  fillChar = glyph.progressFill,
  emptyChar = glyph.progressEmpty,
  showLabel = true,
  toneOverride,
}: ProgressMeterProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const accent = toneOverride ?? severityFromPercent(clamped);
  const color = tone[accent];

  return (
    <Box gap={1}>
      <Text color={color}>
        {fillChar.repeat(filled)}
        {emptyChar.repeat(empty)}
      </Text>
      {showLabel && <Text color={tone.muted}>{clamped.toFixed(0).padStart(2, " ")}%</Text>}
    </Box>
  );
}

/**
 * GradientBar — multi-color progress with explicit segment thresholds.
 * Used by the ContextHUD where the bar itself communicates severity:
 * a green prefix + yellow midsection + red tail makes the danger zone
 * unambiguous even at a glance.
 */
export interface GradientBarProps {
  readonly tone: Tone;
  readonly percent: number;
  readonly width?: number;
  readonly fillChar?: string;
  readonly emptyChar?: string;
}

export function GradientBar({
  tone,
  percent,
  width = 20,
  fillChar = glyph.progressFill,
  emptyChar = glyph.progressEmpty,
}: GradientBarProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  // Three threshold bands: green up to 50%, yellow up to 75%, red after.
  const greenEnd = Math.min(filled, Math.floor(width * 0.5));
  const yellowEnd = Math.min(filled, Math.floor(width * 0.75));
  const redEnd = filled;

  const greenSegment = fillChar.repeat(greenEnd);
  const yellowSegment = fillChar.repeat(Math.max(0, yellowEnd - greenEnd));
  const redSegment = fillChar.repeat(Math.max(0, redEnd - yellowEnd));
  const emptySegment = emptyChar.repeat(width - filled);

  return (
    <Box>
      <Text color={tone.success}>{greenSegment}</Text>
      <Text color={tone.warning}>{yellowSegment}</Text>
      <Text color={tone.error}>{redSegment}</Text>
      <Text color={tone.border}>{emptySegment}</Text>
    </Box>
  );
}
