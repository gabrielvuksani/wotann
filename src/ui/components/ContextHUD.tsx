/**
 * Context Health HUD: full-width bar with green→yellow→red gradient.
 * Shows token counts, cache hit rate, and provider status.
 *
 * V9 design polish:
 *   - Tokens for every color slot — drops the ad-hoc "green/yellow/red"
 *     literals so theme switches paint the HUD coherently.
 *   - Bar uses the GradientBar primitive (same as StatusBar's mini bar)
 *     so the user sees the same visual vocabulary across surfaces.
 *   - Provider/model section now renders the runic Ask glyph as a tiny
 *     brand mark — no extra space cost, single-cell ornament.
 */

import React from "react";
import { Box, Text } from "ink";
import { PALETTES } from "../themes.js";
import { buildTone, rune } from "../theme/tokens.js";
import { GradientBar } from "./primitives/index.js";

interface ContextHUDProps {
  readonly usedTokens: number;
  readonly maxTokens: number;
  readonly cacheHitRate: number;
  readonly provider: string;
  readonly model: string;
  readonly costUsd: number;
}

function severityColorFromTone(percent: number, tone: ReturnType<typeof buildTone>): string {
  if (percent < 50) return tone.success;
  if (percent < 75) return tone.warning;
  return tone.error;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function ContextHUD({
  usedTokens,
  maxTokens,
  cacheHitRate,
  provider,
  model,
  costUsd,
}: ContextHUDProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const percent = maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 100) : 0;
  const accentColor = severityColorFromTone(percent, tone);
  const cacheColor = cacheHitRate > 0.5 ? tone.success : tone.warning;

  return (
    <Box
      borderStyle="single"
      borderColor={accentColor}
      paddingX={1}
      justifyContent="space-between"
      width="100%"
    >
      <Box gap={1}>
        <GradientBar tone={tone} percent={percent} width={20} />
        <Text color={accentColor} bold>
          {percent}%
        </Text>
        <Text color={tone.muted}>
          ({formatTokens(usedTokens)}/{formatTokens(maxTokens)})
        </Text>
      </Box>

      <Box gap={1}>
        <Text color={tone.muted}>Cache</Text>
        <Text color={cacheColor} bold>
          {(cacheHitRate * 100).toFixed(0)}%
        </Text>
      </Box>

      <Box gap={1}>
        <Text color={tone.rune} bold>
          {rune.ask}
        </Text>
        <Text color={tone.primary} bold>
          {model}
        </Text>
        <Text color={tone.muted}>via {provider}</Text>
      </Box>

      <Box gap={1}>
        <Text color={tone.muted}>$</Text>
        <Text color={tone.success} bold>
          {costUsd.toFixed(3)}
        </Text>
      </Box>
    </Box>
  );
}
