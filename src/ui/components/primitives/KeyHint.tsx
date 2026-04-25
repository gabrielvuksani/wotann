/**
 * KeyHint + KeyHintBar — keyboard shortcut footer primitives.
 *
 * Replaces patterns like:
 *   <Text dimColor>Enter: send</Text>
 *   <Text dimColor>|</Text>
 *   <Text dimColor>Esc: close</Text>
 * with a structured, palette-aware footer.
 *
 * Why centralize?
 *   - Separator characters were inconsistent ("|", "·", "—", " ").
 *   - Keys were colored differently in each component (sometimes
 *     dim-only, sometimes bold cyan, sometimes plain).
 *   - Footer spacing rhythm was ad-hoc — some components used gap=1,
 *     others used `<Text> | </Text>` literals.
 *
 * The KeyHintBar:
 *   - Renders each binding as `<key> <description>` with the key
 *     highlighted in the active accent.
 *   - Inserts the canonical separator (`·`) automatically.
 *   - Wraps onto multiple lines if Ink's flex layout would overflow,
 *     so narrow terminals don't truncate the footer mid-binding.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Tone } from "../../theme/tokens.js";
import { glyph } from "../../theme/tokens.js";

export interface KeyBinding {
  /** Key label — "Enter", "Esc", "Ctrl+P", "↑↓", etc. */
  readonly keys: string;
  /** Action description. */
  readonly description: string;
}

export interface KeyHintBarProps {
  /** Bindings to display, left to right. */
  readonly bindings: readonly KeyBinding[];
  /** Active palette tones. */
  readonly tone: Tone;
  /** Override accent color for keys (default: primary). */
  readonly accent?: keyof Tone;
  /** Override separator character (default: ·). */
  readonly separator?: string;
}

/**
 * KeyHintBar — render a row of `<key> <action>` pairs with consistent
 * styling and a separator between each pair.
 *
 *   Enter send  ·  Esc close  ·  ↑↓ navigate
 */
export function KeyHintBar({
  bindings,
  tone,
  accent = "primary",
  separator = glyph.bullet,
}: KeyHintBarProps): React.ReactElement {
  const keyColor = tone[accent];
  return (
    <Box gap={1} flexWrap="wrap">
      {bindings.map((b, i) => (
        <Box key={`hint-${i}-${b.keys}`} gap={1}>
          {i > 0 && <Text color={tone.border}>{separator}</Text>}
          <Text color={keyColor} bold>
            {b.keys}
          </Text>
          <Text color={tone.muted}>{b.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * KeyHint — render a single `<key> <action>` pair without a wrapping
 * Box. Useful when embedding inside an existing flex row.
 */
export function KeyHint({
  binding,
  tone,
  accent = "primary",
}: {
  readonly binding: KeyBinding;
  readonly tone: Tone;
  readonly accent?: keyof Tone;
}): React.ReactElement {
  return (
    <Box gap={1}>
      <Text color={tone[accent]} bold>
        {binding.keys}
      </Text>
      <Text color={tone.muted}>{binding.description}</Text>
    </Box>
  );
}
