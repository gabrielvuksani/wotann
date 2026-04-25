/**
 * StatusBadge — small inline indicator for state.
 *
 * Renders a colored glyph + label. Used in lists, headers, and
 * notifications wherever a one-token "this is OK" / "this is failing"
 * cue is needed.
 *
 * Variants map to severity tones:
 *   ok      — green + ✓
 *   info    — primary + ●
 *   running — primary + ◐ (animatable)
 *   warn    — warning + ◑
 *   fail    — error + ✗
 *   idle    — muted + ○
 */

import React from "react";
import { Box, Text } from "ink";
import type { Tone } from "../../theme/tokens.js";
import { glyph } from "../../theme/tokens.js";

export type StatusVariant = "ok" | "info" | "running" | "warn" | "fail" | "idle";

interface VariantStyle {
  readonly icon: string;
  readonly accent: keyof Tone;
}

const VARIANTS: Readonly<Record<StatusVariant, VariantStyle>> = {
  ok: { icon: glyph.statusOk, accent: "success" },
  info: { icon: glyph.statusActive, accent: "primary" },
  running: { icon: glyph.statusPartial, accent: "primary" },
  warn: { icon: glyph.statusQueued, accent: "warning" },
  fail: { icon: glyph.statusFail, accent: "error" },
  idle: { icon: glyph.statusIdle, accent: "muted" },
};

export interface StatusBadgeProps {
  readonly tone: Tone;
  readonly variant: StatusVariant;
  readonly label?: string;
  /** Inline override for the glyph (e.g. for a custom rune). */
  readonly icon?: string;
  /** Render label in bold (defaults true for non-idle variants). */
  readonly bold?: boolean;
}

export function StatusBadge({
  tone,
  variant,
  label,
  icon,
  bold,
}: StatusBadgeProps): React.ReactElement {
  const variantStyle = VARIANTS[variant];
  const color = tone[variantStyle.accent];
  const displayIcon = icon ?? variantStyle.icon;
  const isBold = bold ?? variant !== "idle";

  return (
    <Box gap={1}>
      <Text color={color} bold={isBold}>
        {displayIcon}
      </Text>
      {label !== undefined && (
        <Text color={color} bold={isBold}>
          {label}
        </Text>
      )}
    </Box>
  );
}

/**
 * Pill — tight pill-shaped label using brackets, e.g. `[PLAN]`.
 * Used by mode/status indicators where a glyph would look too sparse.
 */
export function Pill({
  tone,
  label,
  variant = "info",
}: {
  readonly tone: Tone;
  readonly label: string;
  readonly variant?: StatusVariant;
}): React.ReactElement {
  const accent = VARIANTS[variant].accent;
  const color = tone[accent];
  return (
    <Box>
      <Text color={color} bold>
        [{label}]
      </Text>
    </Box>
  );
}
