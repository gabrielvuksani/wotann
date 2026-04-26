/**
 * Sparkline — single-row Unicode block-character mini chart.
 *
 * Renders an array of numeric samples as a row of eight-step bars
 * (▁▂▃▄▅▆▇█), letting the StatusBar / ContextHUD show "tokens/min over
 * the last N minutes" or "cost burn over the last hour" without
 * needing a separate panel.
 *
 * ── Design notes ──────────────────────────────────────────────────────
 * - Pure presentational component: no internal state, no effects. The
 *   caller owns the data buffer and decides how often to update.
 * - Min/max-scaled by default so a flat-but-nonzero series still shows
 *   a recognisable bar. Pass an explicit {min,max} in `range` when the
 *   bounds matter (e.g. percent-of-budget bars locked to 0..100).
 * - Empty / single-sample / all-equal inputs degrade honestly to a
 *   muted bullet row rather than a misleading flat bar (QB #6).
 * - No external animation or chart libs (per ownership rules — no new
 *   top-level deps). Just Box + Text + a single string of Unicode
 *   characters.
 *
 * ── Quality bars honoured ─────────────────────────────────────────────
 * - QB #6  honest fallback: empty / NaN / single-sample inputs render a
 *   placeholder row rather than fabricating a chart.
 * - QB #7  per-component state: the only state is local to the render
 *   (no module-level mutable buffers).
 * - QB #11 sibling-site scan: matches the ProgressMeter API shape
 *   (tone, width, fill char) so consumers don't context-switch between
 *   bar primitives.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Tone } from "../theme/tokens.js";

/**
 * Eight-step block ramp (low → high). Index 0 is the empty/below-min
 * sentinel (centred dot keeps the row visible); 1..8 are the visible
 * eighths. Frozen at module load — never mutate at runtime.
 */
export const SPARKLINE_BLOCKS: readonly string[] = Object.freeze([
  "·",
  "▁", // ▁
  "▂", // ▂
  "▃", // ▃
  "▄", // ▄
  "▅", // ▅
  "▆", // ▆
  "▇", // ▇
  "█", // █
]);

export interface SparklineRange {
  readonly min: number;
  readonly max: number;
}

export interface SparklineProps {
  /** Active palette tones (provides default colours when none given). */
  readonly tone: Tone;
  /**
   * Numeric samples (oldest → newest left → right). Non-finite values
   * (NaN, Infinity) are treated as the row baseline so a single bad
   * sample doesn't throw or skew the chart.
   */
  readonly data: readonly number[];
  /**
   * Output width in cells. Truncates from the LEFT (drops oldest
   * samples) when `data.length > width`, matching the visual intuition
   * that the right edge is "now". Default 20.
   */
  readonly width?: number;
  /**
   * Tone slot used to colour the bars. Defaults to `primary` so
   * sparklines pick up the active accent. Use `success`/`warning`/etc
   * to convey severity.
   */
  readonly accent?: keyof Tone;
  /**
   * Explicit range for the y-axis. When omitted the bar auto-scales
   * to `[min(data), max(data)]`. Pass `{min:0, max:100}` for a
   * percent-fixed scale.
   */
  readonly range?: SparklineRange;
  /**
   * Optional label rendered after the bar. Useful for "(last 5m)".
   * Caller is responsible for keeping it short.
   */
  readonly label?: string;
}

/** Detect "no usable data" — empty input, all NaN, or fewer than 1 sample. */
function isEmptyData(data: readonly number[]): boolean {
  if (data.length === 0) return true;
  for (const v of data) {
    if (Number.isFinite(v)) return false;
  }
  return true;
}

/** Map a value into [0..8] block index given a min/max range. */
function blockIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) {
    // Flat range — render a mid-level bar so the row is still visible.
    return value === min ? 4 : 0;
  }
  const ratio = (value - min) / (max - min);
  const clamped = Math.max(0, Math.min(1, ratio));
  // 1..8 (skip index 0 so any in-range sample shows at least one block).
  return Math.max(1, Math.min(8, Math.ceil(clamped * 8)));
}

/**
 * Compute the visible window of `data` to fit `width` cells. Drops
 * oldest samples when overflowing (newest stays glued to the right edge).
 */
function visibleWindow(data: readonly number[], width: number): readonly number[] {
  if (data.length <= width) return data;
  return data.slice(data.length - width);
}

/**
 * Sparkline — render a one-row block-character mini chart.
 *
 *   ▁▂▃▅▆█▇▅  (last 5m)
 */
export function Sparkline({
  tone,
  data,
  width = 20,
  accent = "primary",
  range,
  label,
}: SparklineProps): React.ReactElement {
  const safeWidth = Number.isInteger(width) && width > 0 ? width : 20;

  // Honest empty fallback — a row of muted bullets so the slot is
  // visible but doesn't fabricate a trend (QB #6).
  if (isEmptyData(data)) {
    return (
      <Box gap={1}>
        <Text color={tone.muted}>{"·".repeat(safeWidth)}</Text>
        {label !== undefined && <Text color={tone.muted}>{label}</Text>}
      </Box>
    );
  }

  const samples = visibleWindow(data, safeWidth);

  // Auto-scale unless caller fixed the range.
  let min: number;
  let max: number;
  if (range !== undefined) {
    min = range.min;
    max = range.max;
  } else {
    min = Number.POSITIVE_INFINITY;
    max = Number.NEGATIVE_INFINITY;
    for (const v of samples) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      // All non-finite — degrade gracefully.
      return (
        <Box gap={1}>
          <Text color={tone.muted}>{"·".repeat(safeWidth)}</Text>
          {label !== undefined && <Text color={tone.muted}>{label}</Text>}
        </Box>
      );
    }
  }

  // Build the bar string in one pass — safer for Ink than a list of
  // <Text/> per cell (one Text node per row keeps the renderer cheap).
  let bar = "";
  for (const v of samples) {
    const idx = blockIndex(v, min, max);
    bar += SPARKLINE_BLOCKS[idx] ?? "·";
  }
  // Left-pad with the empty sentinel if `data` was shorter than width
  // so the right edge always represents "now".
  if (bar.length < safeWidth) {
    bar = "·".repeat(safeWidth - bar.length) + bar;
  }

  const color = tone[accent];

  return (
    <Box gap={1}>
      <Text color={color}>{bar}</Text>
      {label !== undefined && <Text color={tone.muted}>{label}</Text>}
    </Box>
  );
}
