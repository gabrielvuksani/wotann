/**
 * Card — rounded panel container with consistent spacing.
 *
 * Replaces ad-hoc `<Box borderStyle="round" borderColor=... paddingX=1>`
 * call sites scattered through the components. By centralizing the
 * choices here:
 *   - Border style is always rounded (or "heavy" for emergencies).
 *   - Padding rhythm is enforced (paddingX=1, optional paddingY=1).
 *   - Border color comes from a tone slot, not a hardcoded "cyan".
 *   - The title row is rendered inline so we never end up with
 *     ten variations of "header inside a panel" pattern.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Tone } from "../../theme/tokens.js";
import { border as borderTokens, type BorderToken } from "../../theme/tokens.js";

export interface CardProps {
  /** Active palette tones. */
  readonly tone: Tone;
  /** Card title (rendered bold in `accent` color). Optional. */
  readonly title?: string;
  /** Right-side metadata (count, status). Pairs with title. */
  readonly meta?: string;
  /** Tone slot for accents (border + title color). Default: `primary`. */
  readonly accent?: keyof Tone;
  /** Border weight — rule for separators, card for default, heavy for callouts. */
  readonly weight?: keyof typeof borderTokens;
  /** Optional decorative rune to prepend to the title. */
  readonly rune?: string;
  /** Children rendered inside the card body. */
  readonly children?: React.ReactNode;
  /** Override paddingY (default 0). */
  readonly paddingY?: number;
  /** Inline width override — defaults to flexible. */
  readonly width?: number | string;
}

/**
 * Card — rounded panel with optional title row.
 *
 * Layout:
 *   ╭─ Title (meta) ─────────╮
 *   │ children                │
 *   ╰─────────────────────────╯
 */
export function Card({
  tone,
  title,
  meta,
  accent = "primary",
  weight = "card",
  rune,
  children,
  paddingY = 0,
  width,
}: CardProps): React.ReactElement {
  const borderStyle: BorderToken = borderTokens[weight];
  const accentColor = tone[accent];

  return (
    <Box
      borderStyle={borderStyle}
      borderColor={accentColor}
      paddingX={1}
      paddingY={paddingY}
      flexDirection="column"
      {...(width !== undefined ? { width } : {})}
    >
      {title !== undefined && (
        <Box justifyContent="space-between" marginBottom={children !== undefined ? 1 : 0}>
          <Box gap={1}>
            {rune !== undefined && (
              <Text color={tone.rune} bold>
                {rune}
              </Text>
            )}
            <Text color={accentColor} bold>
              {title}
            </Text>
          </Box>
          {meta !== undefined && <Text color={tone.muted}>{meta}</Text>}
        </Box>
      )}
      {children}
    </Box>
  );
}

/**
 * Section — same intent as Card but renders a flush header + content
 * with no border. Used inside cards to delimit subsections without
 * triggering nested-box visual noise.
 */
export interface SectionProps {
  readonly tone: Tone;
  readonly title: string;
  readonly children?: React.ReactNode;
  /** Tone slot for the title (defaults to muted bold). */
  readonly accent?: keyof Tone;
}

export function Section({
  tone,
  title,
  children,
  accent = "muted",
}: SectionProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={tone[accent]} bold>
        {title}
      </Text>
      {children}
    </Box>
  );
}
