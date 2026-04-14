/**
 * Agent status panel: tree view of active subagents with elapsed time.
 */

import React from "react";
import { Box, Text } from "ink";

export interface SubagentStatus {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly status: "running" | "completed" | "failed" | "queued";
  readonly startedAt: number;
  readonly toolCalls: number;
  readonly currentTool?: string;
}

interface AgentStatusPanelProps {
  readonly agents: readonly SubagentStatus[];
  readonly showCompleted?: boolean;
}

function formatElapsed(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return min > 0 ? `${min}m${sec}s` : `${sec}s`;
}

function statusIcon(status: SubagentStatus["status"]): { icon: string; color: string } {
  switch (status) {
    case "running": return { icon: "●", color: "green" };
    case "completed": return { icon: "✓", color: "green" };
    case "failed": return { icon: "✗", color: "red" };
    case "queued": return { icon: "○", color: "gray" };
  }
}

export function AgentStatusPanel({
  agents,
  showCompleted = false,
}: AgentStatusPanelProps): React.ReactElement {
  const displayed = showCompleted
    ? agents
    : agents.filter((a) => a.status !== "completed");

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Agents ({agents.filter((a) => a.status === "running").length} active)</Text>

      {displayed.length === 0 && (
        <Text dimColor>No active agents</Text>
      )}

      {displayed.map((agent) => {
        const { icon, color } = statusIcon(agent.status);
        return (
          <Box key={agent.id} gap={1}>
            <Text color={color}>{icon}</Text>
            <Text bold>{agent.name}</Text>
            <Text dimColor>({agent.model})</Text>
            {agent.status === "running" && (
              <>
                <Text dimColor>{formatElapsed(agent.startedAt)}</Text>
                {agent.currentTool && (
                  <Text color="yellow">[{agent.currentTool}]</Text>
                )}
                <Text dimColor>T:{agent.toolCalls}</Text>
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
