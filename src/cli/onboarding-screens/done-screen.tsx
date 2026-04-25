/**
 * DoneScreen — Onboarding wizard terminal screen.
 *
 * Renders the wizard's done-state outcome (success / skip / failed) as
 * one of three semantic cards. Extracted from
 * src/cli/onboarding-screens.tsx during the V9 onboarding-screens split
 * (>800 LOC ceiling enforcement).
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import type { ProviderRung } from "../../providers/provider-ladder.js";

export interface DoneStep {
  readonly kind: "done";
  readonly reason: "success" | "skip" | "failed";
  readonly strategy?: string;
  readonly rung?: ProviderRung | null;
  readonly failureReason?: string;
}

export interface DoneScreenProps {
  readonly step: DoneStep;
  readonly onExit: () => void;
}

export function DoneScreen({ step, onExit }: DoneScreenProps): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) onExit();
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {step.reason === "success" && step.rung ? (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          <Box gap={1}>
            <Text color="green" bold>
              ✓
            </Text>
            <Text color="green" bold>
              You're ready to go.
            </Text>
          </Box>
          <Text dimColor>
            Provider: {step.rung.label} · Strategy: {step.strategy}
          </Text>
          <Box marginTop={1}>
            <Text dimColor>Try </Text>
            <Text color="cyan" bold>
              wotann ask "What can you help me build today?"
            </Text>
          </Box>
        </Box>
      ) : step.reason === "skip" ? (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Box gap={1}>
            <Text color="yellow" bold>
              ◑
            </Text>
            <Text color="yellow" bold>
              Skipped for now.
            </Text>
          </Box>
          <Text dimColor>
            Run <Text bold>wotann init</Text> again any time to finish setup.
          </Text>
          <Text dimColor>
            In the meantime you have 10 free demo queries via WOTANN's hosted backend.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
          <Box gap={1}>
            <Text color="red" bold>
              ✗
            </Text>
            <Text color="red" bold>
              Setup exited with errors.
            </Text>
          </Box>
          {step.failureReason && <Text dimColor>Reason: {step.failureReason}</Text>}
          <Text dimColor>
            Your chosen provider may need configuration before WOTANN can reach it.
          </Text>
        </Box>
      )}
      <Box marginTop={1} gap={1}>
        <Text color="cyan" bold>
          Enter
        </Text>
        <Text dimColor>exit</Text>
      </Box>
    </Box>
  );
}
