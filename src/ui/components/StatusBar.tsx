/**
 * Status bar: model | provider | mode | cost | context | tool counts.
 * Always visible at the bottom, updates in real-time during streaming.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ProviderName } from "../../core/types.js";
import { SEVERITY } from "../themes.js";

interface StatusBarProps {
  readonly model: string;
  readonly provider: ProviderName;
  readonly cost: number;
  readonly contextPercent: number;
  readonly reads: number;
  readonly edits: number;
  readonly bashCalls: number;
  readonly mode?: string;
  readonly isStreaming?: boolean;
  readonly turnCount?: number;
  readonly skillCount?: number;
  readonly roeSessionActive?: boolean;
}

function contextBar(percent: number): string {
  const width = 12;
  const filled = Math.round(percent / (100 / width));
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function contextColor(percent: number): string {
  if (percent < 50) return "green";
  if (percent < 70) return "yellow";
  if (percent < 85) return SEVERITY.orange;
  return "red";
}

function modeColor(mode: string): string {
  switch (mode) {
    case "plan":
      return "cyan";
    case "autonomous":
      return "magenta";
    case "bypass":
      return "red";
    case "guardrails-off":
      return "red";
    case "auto":
      return "green";
    default:
      return "white";
  }
}

export function StatusBar({
  model,
  provider,
  cost,
  contextPercent,
  reads,
  edits,
  bashCalls,
  mode = "default",
  isStreaming = false,
  turnCount = 0,
  skillCount,
  roeSessionActive = false,
}: StatusBarProps): React.ReactElement {
  return (
    <Box
      borderStyle="single"
      borderColor={isStreaming ? "green" : "gray"}
      paddingX={1}
      justifyContent="space-between"
    >
      {/* Left: model + provider */}
      <Box gap={1}>
        {isStreaming && <Text color="green">●</Text>}
        <Text color="cyan" bold>
          {model.replace("claude-", "").replace("gpt-", "")}
        </Text>
        <Text dimColor>via</Text>
        <Text color="white">{provider}</Text>
      </Box>

      {/* Center: mode + ROE indicator + turn count */}
      <Box gap={1}>
        <Text color={modeColor(mode)} bold>
          {mode}
        </Text>
        {mode === "guardrails-off" && roeSessionActive && (
          <Text color="yellow" bold>
            [ROE]
          </Text>
        )}
        {mode === "guardrails-off" && !roeSessionActive && (
          <Text color="red" bold>
            [NO-ROE]
          </Text>
        )}
        {turnCount > 0 && <Text dimColor>T{turnCount}</Text>}
        {skillCount !== undefined && <Text dimColor>S{skillCount}</Text>}
      </Box>

      {/* Right: cost + context bar + tool counts */}
      <Box gap={1}>
        <Text color="green">${cost.toFixed(3)}</Text>
        <Text color={contextColor(contextPercent)}>{contextBar(contextPercent)}</Text>
        <Text dimColor>{contextPercent}%</Text>
        <Text dimColor>
          R{reads} E{edits} B{bashCalls}
        </Text>
      </Box>
    </Box>
  );
}
