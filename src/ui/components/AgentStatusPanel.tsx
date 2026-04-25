/**
 * Agent status panel: tree view of active subagents with elapsed time.
 *
 * V9 design polish:
 *   - StatusBadge primitive replaces literal glyph + color pairs.
 *   - Card primitive provides consistent header + border styling.
 *   - Counts in the header are colored when non-zero so glanceable.
 */

import React from "react";
import { Box, Text } from "ink";
import { PALETTES } from "../themes.js";
import { buildTone } from "../theme/tokens.js";
import { Card, StatusBadge, type StatusVariant } from "./primitives/index.js";

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

function statusVariant(status: SubagentStatus["status"]): StatusVariant {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "ok";
    case "failed":
      return "fail";
    case "queued":
      return "idle";
  }
}

export function AgentStatusPanel({
  agents,
  showCompleted = false,
}: AgentStatusPanelProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const displayed = showCompleted ? agents : agents.filter((a) => a.status !== "completed");
  const activeCount = agents.filter((a) => a.status === "running").length;

  return (
    <Card tone={tone} title="Agents" meta={`${activeCount} active`} accent="primary">
      {displayed.length === 0 && <Text color={tone.muted}>No active agents</Text>}

      {displayed.map((agent) => {
        return (
          <Box key={agent.id} gap={1}>
            <StatusBadge tone={tone} variant={statusVariant(agent.status)} />
            <Text color={tone.text} bold>
              {agent.name}
            </Text>
            <Text color={tone.muted}>({agent.model})</Text>
            {agent.status === "running" && (
              <>
                <Text color={tone.muted}>{formatElapsed(agent.startedAt)}</Text>
                {agent.currentTool && <Text color={tone.warning}>[{agent.currentTool}]</Text>}
                <Text color={tone.muted}>T:{agent.toolCalls}</Text>
              </>
            )}
          </Box>
        );
      })}
    </Card>
  );
}
