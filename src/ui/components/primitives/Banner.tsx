/**
 * Banner — top-aligned headline strip used by overlays + welcome
 * surfaces.
 *
 * A Banner is a one or two-line block with a colored title + an
 * optional subtitle / muted right-side metadata. It wraps the title
 * row in a rounded box only when the caller asks (`framed`); the
 * default is a flat banner that flows above other content without
 * adding chrome.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Tone } from "../../theme/tokens.js";
import { glyph as glyphTokens } from "../../theme/tokens.js";

export interface BannerProps {
  /** Headline text — printed in bold using `tone`. */
  readonly title: string;
  /** Optional subtitle — printed dimmed beneath the title. */
  readonly subtitle?: string;
  /** Optional right-side metadata — version, count, status badge. */
  readonly meta?: string;
  /** Active tone (palette-dependent). Defaults caller-side. */
  readonly tone: Tone;
  /** Optional decorative rune to prepend to the title. */
  readonly rune?: string;
  /** Render inside a rounded card with surface background. */
  readonly framed?: boolean;
  /** Tone slot for the title color (default: `primary`). */
  readonly accent?: keyof Tone;
}

/**
 * Banner — compose a recognizable headline strip.
 *
 * Layout:
 *   ╭──────────────────────────────────────────────────────╮
 *   │ ᚠ TITLE GOES HERE                            v1.2.3 │
 *   │ subtitle goes here                                   │
 *   ╰──────────────────────────────────────────────────────╯
 */
export function Banner({
  title,
  subtitle,
  meta,
  tone,
  rune,
  framed = false,
  accent = "primary",
}: BannerProps): React.ReactElement {
  const titleColor = tone[accent];

  const inner = (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Box gap={1}>
          {rune !== undefined && (
            <Text color={tone.rune} bold>
              {rune}
            </Text>
          )}
          <Text color={titleColor} bold>
            {title}
          </Text>
        </Box>
        {meta !== undefined && <Text color={tone.muted}>{meta}</Text>}
      </Box>
      {subtitle !== undefined && (
        <Box>
          <Text color={tone.muted}>{subtitle}</Text>
        </Box>
      )}
    </Box>
  );

  if (!framed) {
    return inner;
  }

  return (
    <Box borderStyle="round" borderColor={titleColor} paddingX={1} flexDirection="column">
      {inner}
    </Box>
  );
}

/**
 * Tiny visual divider — single rule line in `tone.border`. Useful
 * between Banner and content when `framed` is false.
 */
export function BannerRule({
  tone,
  glyph,
}: {
  readonly tone: Tone;
  readonly glyph?: string;
}): React.ReactElement {
  const ch = glyph ?? glyphTokens.bullet;
  return (
    <Box>
      <Text color={tone.border}>{ch.repeat(48)}</Text>
    </Box>
  );
}
