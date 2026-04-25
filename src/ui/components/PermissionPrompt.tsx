/**
 * Permission prompt: approve/deny/always-allow tool execution.
 * Shown for MEDIUM and HIGH risk tool calls.
 *
 * V9 design polish:
 *   - Border + risk badge come from semantic tones.
 *   - Heavy border style for HIGH risk so the visual weight matches
 *     the consequence — mirrors how warning vs danger should read
 *     differently on the Norse-themed surface.
 *   - Pointer + action keys pulled from design tokens.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision, RiskLevel } from "../../core/types.js";
import { PALETTES } from "../themes.js";
import { buildTone, glyph } from "../theme/tokens.js";
import { Pill, type StatusVariant } from "./primitives/index.js";

interface PermissionPromptProps {
  readonly toolName: string;
  readonly description: string;
  readonly riskLevel: RiskLevel;
  readonly onDecision: (decision: PermissionDecision) => void;
}

const OPTIONS: readonly {
  readonly key: string;
  readonly label: string;
  readonly decision: PermissionDecision;
}[] = [
  { key: "y", label: "Yes (allow)", decision: "allow" },
  { key: "n", label: "No (deny)", decision: "deny" },
  { key: "a", label: "Always allow", decision: "always-allow" },
];

function riskVariant(level: RiskLevel): StatusVariant {
  switch (level) {
    case "low":
      return "ok";
    case "medium":
      return "warn";
    case "high":
      return "fail";
  }
}

function riskBorderStyle(level: RiskLevel): "round" | "double" {
  // Heavy border for high risk — the visual weight should match the
  // consequence so the user can't misread a destructive prompt.
  return level === "high" ? "double" : "round";
}

export function PermissionPrompt({
  toolName,
  description,
  riskLevel,
  onDecision,
}: PermissionPromptProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
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

  const variant = riskVariant(riskLevel);
  const borderColor =
    riskLevel === "high" ? tone.error : riskLevel === "medium" ? tone.warning : tone.success;

  return (
    <Box
      flexDirection="column"
      borderStyle={riskBorderStyle(riskLevel)}
      borderColor={borderColor}
      paddingX={1}
      paddingY={0}
    >
      <Box gap={1}>
        <Pill tone={tone} label={riskLevel.toUpperCase()} variant={variant} />
        <Text color={tone.text} bold>
          Permission required: {toolName}
        </Text>
      </Box>

      <Box paddingLeft={2}>
        <Text color={tone.muted}>{description}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => (
          <Box key={opt.key} gap={1}>
            <Text color={i === selected ? tone.primary : tone.border}>
              {i === selected ? glyph.pointer : " "}
            </Text>
            <Text bold={i === selected} color={tone.text}>
              [{opt.key}] {opt.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
