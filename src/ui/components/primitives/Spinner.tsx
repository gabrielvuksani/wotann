/**
 * Spinner — animated frame cycler with palette-aware coloring.
 *
 * Encapsulates the `useEffect` + `setInterval` dance that every
 * loading/streaming surface used to repeat. Frames advance every
 * `intervalMs` ticks; clean-up cancels the timer when the component
 * unmounts (so paint loops stop when an overlay closes).
 */

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { Tone } from "../../theme/tokens.js";
import { SPINNER_DOTS } from "../../theme/tokens.js";

export interface SpinnerProps {
  readonly tone: Tone;
  /** Frames to cycle through. Default: SPINNER_DOTS. */
  readonly frames?: readonly string[];
  /** Interval between frame advances (ms). Default 80. */
  readonly intervalMs?: number;
  /** Tone slot — default `primary` for cyan signature. */
  readonly accent?: keyof Tone;
  /** Optional label rendered next to the spinner. */
  readonly label?: string;
  /** Pause the animation but keep the frame visible. */
  readonly paused?: boolean;
}

/**
 * Spinner — animated indicator using design-token frames.
 */
export function Spinner({
  tone,
  frames = SPINNER_DOTS,
  intervalMs = 80,
  accent = "primary",
  label,
  paused = false,
}: SpinnerProps): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (paused) return;
    const handle = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, intervalMs);
    return () => {
      clearInterval(handle);
    };
  }, [paused, intervalMs, frames.length]);

  const color = tone[accent];
  const safeFrame = frames[frame % frames.length] ?? frames[0] ?? "";

  return (
    <Box gap={1}>
      <Text color={color}>{safeFrame}</Text>
      {label !== undefined && <Text color={tone.muted}>{label}</Text>}
    </Box>
  );
}
