/**
 * Permission prompt: approve/deny/always-allow tool execution.
 * Shown for MEDIUM and HIGH risk tool calls.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision, RiskLevel } from "../../core/types.js";

interface PermissionPromptProps {
  readonly toolName: string;
  readonly description: string;
  readonly riskLevel: RiskLevel;
  readonly onDecision: (decision: PermissionDecision) => void;
}

const RISK_COLORS: Record<RiskLevel, string> = {
  low: "green",
  medium: "yellow",
  high: "red",
};

const OPTIONS: readonly { readonly key: string; readonly label: string; readonly decision: PermissionDecision }[] = [
  { key: "y", label: "Yes (allow)", decision: "allow" },
  { key: "n", label: "No (deny)", decision: "deny" },
  { key: "a", label: "Always allow", decision: "always-allow" },
];

export function PermissionPrompt({
  toolName,
  description,
  riskLevel,
  onDecision,
}: PermissionPromptProps): React.ReactElement {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelected((prev) => Math.min(OPTIONS.length - 1, prev + 1));
    } else if (key.return) {
      const option = OPTIONS[selected];
      if (option) {
        onDecision(option.decision);
      }
    } else if (input === "y" || input === "Y") {
      onDecision("allow");
    } else if (input === "n" || input === "N") {
      onDecision("deny");
    } else if (input === "a" || input === "A") {
      onDecision("always-allow");
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={RISK_COLORS[riskLevel]} paddingX={1} paddingY={0}>
      <Box gap={1}>
        <Text color={RISK_COLORS[riskLevel]} bold>
          [{riskLevel.toUpperCase()}]
        </Text>
        <Text bold>Permission required: {toolName}</Text>
      </Box>

      <Box paddingLeft={2}>
        <Text dimColor>{description}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => (
          <Box key={opt.key} gap={1}>
            <Text color={i === selected ? "cyan" : "gray"}>
              {i === selected ? ">" : " "}
            </Text>
            <Text bold={i === selected}>
              [{opt.key}] {opt.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
