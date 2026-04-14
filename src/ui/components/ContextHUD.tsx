/**
 * Context Health HUD: full-width bar with green→yellow→red gradient.
 * Shows token counts, cache hit rate, and provider status.
 */

import React from "react";
import { Box, Text } from "ink";

interface ContextHUDProps {
  readonly usedTokens: number;
  readonly maxTokens: number;
  readonly cacheHitRate: number;
  readonly provider: string;
  readonly model: string;
  readonly costUsd: number;
}

function healthColor(percent: number): string {
  if (percent < 50) return "green";
  if (percent < 75) return "yellow";
  return "red";
}

function healthBar(percent: number, width: number = 30): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
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
  const percent = maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 100) : 0;
  const color = healthColor(percent);

  return (
    <Box
      borderStyle="single"
      borderColor={color}
      paddingX={1}
      justifyContent="space-between"
      width="100%"
    >
      <Box gap={1}>
        <Text color={color}>{healthBar(percent, 20)}</Text>
        <Text dimColor>{percent}%</Text>
        <Text dimColor>({formatTokens(usedTokens)}/{formatTokens(maxTokens)})</Text>
      </Box>

      <Box gap={1}>
        <Text dimColor>Cache:</Text>
        <Text color={cacheHitRate > 0.5 ? "green" : "yellow"}>
          {(cacheHitRate * 100).toFixed(0)}%
        </Text>
      </Box>

      <Box gap={1}>
        <Text color="cyan" bold>{model}</Text>
        <Text dimColor>via {provider}</Text>
      </Box>

      <Box gap={1}>
        <Text dimColor>$</Text>
        <Text color="green">{costUsd.toFixed(3)}</Text>
      </Box>
    </Box>
  );
}
