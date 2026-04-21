/**
 * Context source panel: breakdown of what occupies the context window.
 * Shows each source with token count, percentage, and a visual bar.
 * Displays total usage as a progress bar with color-coded health.
 */

import React from "react";
import { Box, Text } from "ink";
import { SEVERITY } from "../themes.js";

// ── Types ──────────────────────────────────────────────────────

export type ContextSourceType = "system" | "conversation" | "files" | "tools" | "memory";

export interface ContextSource {
  readonly name: string;
  readonly tokens: number;
  readonly type: ContextSourceType;
}

interface ContextSourcePanelProps {
  readonly sources: readonly ContextSource[];
  readonly totalTokens: number;
  readonly maxTokens: number;
}

// ── Constants ──────────────────────────────────────────────────

const TYPE_COLORS: Readonly<Record<ContextSourceType, string>> = {
  system: "yellow",
  conversation: "blue",
  files: "green",
  tools: "magenta",
  memory: "cyan",
};

const TYPE_ICONS: Readonly<Record<ContextSourceType, string>> = {
  system: "S",
  conversation: "C",
  files: "F",
  tools: "T",
  memory: "M",
};

const BAR_WIDTH = 25;
const TOTAL_BAR_WIDTH = 35;

// ── Helpers ────────────────────────────────────────────────────

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function percentBar(percent: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function healthColor(percent: number): string {
  if (percent < 50) return "green";
  if (percent < 75) return "yellow";
  if (percent < 90) return SEVERITY.orange;
  return "red";
}

function healthLabel(percent: number): string {
  if (percent < 50) return "Healthy";
  if (percent < 75) return "Moderate";
  if (percent < 90) return "High";
  return "Critical";
}

// ── Aggregate by type ──────────────────────────────────────────

interface TypeAggregate {
  readonly type: ContextSourceType;
  readonly totalTokens: number;
  readonly sourceCount: number;
}

function aggregateByType(sources: readonly ContextSource[]): readonly TypeAggregate[] {
  const map = new Map<ContextSourceType, { totalTokens: number; sourceCount: number }>();

  for (const source of sources) {
    const existing = map.get(source.type);
    if (existing !== undefined) {
      map.set(source.type, {
        totalTokens: existing.totalTokens + source.tokens,
        sourceCount: existing.sourceCount + 1,
      });
    } else {
      map.set(source.type, { totalTokens: source.tokens, sourceCount: 1 });
    }
  }

  const result: TypeAggregate[] = [];
  for (const [type, agg] of map) {
    result.push({ type, totalTokens: agg.totalTokens, sourceCount: agg.sourceCount });
  }

  // Sort by token usage descending
  return result.sort((a, b) => b.totalTokens - a.totalTokens);
}

// ── Component ──────────────────────────────────────────────────

export function ContextSourcePanel({
  sources,
  totalTokens,
  maxTokens,
}: ContextSourcePanelProps): React.ReactElement {
  const usagePercent = maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 100) : 0;
  const color = healthColor(usagePercent);
  const label = healthLabel(usagePercent);
  const freeTokens = Math.max(0, maxTokens - totalTokens);

  const typeAggregates = aggregateByType(sources);
  const maxTypeTokens = typeAggregates.reduce((max, t) => Math.max(max, t.totalTokens), 0);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1}>
      {/* Header */}
      <Box gap={1} marginBottom={1}>
        <Text bold color={color}>
          Context Window
        </Text>
        <Text dimColor>-</Text>
        <Text color={color} bold>
          {label}
        </Text>
      </Box>

      {/* Total usage bar */}
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={1}>
          <Text color={color}>{percentBar(usagePercent, TOTAL_BAR_WIDTH)}</Text>
          <Text color={color} bold>
            {usagePercent}%
          </Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>
            Used: {formatTokenCount(totalTokens)} / {formatTokenCount(maxTokens)}
          </Text>
          <Text dimColor>|</Text>
          <Text dimColor>Free: {formatTokenCount(freeTokens)}</Text>
        </Box>
      </Box>

      {/* Type breakdown */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold dimColor>
          By Type:
        </Text>
        {typeAggregates.map((agg) => {
          const typePercent =
            totalTokens > 0 ? Math.round((agg.totalTokens / totalTokens) * 100) : 0;
          const barPercent =
            maxTypeTokens > 0 ? Math.round((agg.totalTokens / maxTypeTokens) * 100) : 0;

          return (
            <Box key={agg.type} gap={1}>
              <Text color={TYPE_COLORS[agg.type]}>[{TYPE_ICONS[agg.type]}]</Text>
              <Text color={TYPE_COLORS[agg.type]}>{agg.type.padEnd(13)}</Text>
              <Text color={TYPE_COLORS[agg.type]}>{percentBar(barPercent, BAR_WIDTH)}</Text>
              <Text dimColor>{formatTokenCount(agg.totalTokens).padStart(6)}</Text>
              <Text dimColor>({typePercent}%)</Text>
              {agg.sourceCount > 1 && <Text dimColor>[{agg.sourceCount} sources]</Text>}
            </Box>
          );
        })}
      </Box>

      {/* Individual sources */}
      <Box flexDirection="column">
        <Text bold dimColor>
          Sources ({sources.length}):
        </Text>
        {sources.map((source, idx) => {
          const sourcePercent =
            totalTokens > 0 ? Math.round((source.tokens / totalTokens) * 100) : 0;

          return (
            <Box key={`src-${idx}-${source.name}`} gap={1} paddingLeft={1}>
              <Text color={TYPE_COLORS[source.type]} dimColor>
                {TYPE_ICONS[source.type]}
              </Text>
              <Text>
                {source.name.length > 30 ? source.name.slice(0, 27) + "..." : source.name}
              </Text>
              <Text dimColor>
                {formatTokenCount(source.tokens).padStart(6)} ({sourcePercent}%)
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
