/**
 * Startup screen: gradient ASCII logo, version, detected providers.
 * Shown when `wotann` launches — the first thing the user sees.
 */

import React from "react";
import { Box, Text } from "ink";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderStatus } from "../../core/types.js";

const LOGO_LINES = [
  " __        _____  _____  _    _   _ _   _ ",
  " \\ \\      / / _ \\|_   _|/ \\  | \\ | | \\ | |",
  "  \\ \\ /\\ / / | | | | | / _ \\ |  \\| |  \\| |",
  "   \\ V  V /| |_| | | |/ ___ \\| |\\  | |\\  |",
  "    \\_/\\_/  \\___/  |_/_/   \\_\\_| \\_|_| \\_|",
];

const GRADIENT_COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#c084fc", "#d8b4fe"];

interface StartupScreenProps {
  readonly version: string;
  readonly providers: readonly ProviderStatus[];
}

export function StartupScreen({ version, providers }: StartupScreenProps): React.ReactElement {
  const activeProviders = providers.filter((p) => p.available);
  const inactiveProviders = providers.filter((p) => !p.available);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Logo with gradient colors */}
      <Box flexDirection="column">
        {LOGO_LINES.map((line, i) => (
          <Text key={`logo-${i}`} color={GRADIENT_COLORS[i % GRADIENT_COLORS.length]}>
            {line}
          </Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Unified Agent Harness v{version}</Text>
      </Box>

      {/* Provider status */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Providers:</Text>
        {activeProviders.map((p) => (
          <Box key={`${p.provider}-${p.authMethod}`} gap={1}>
            <Text color="green">●</Text>
            <Text>{p.label}</Text>
            <Text dimColor>({p.billing})</Text>
            <Text dimColor>— {p.models.slice(0, 3).join(", ")}</Text>
          </Box>
        ))}
        {inactiveProviders.length > 0 && (
          <Box gap={1}>
            <Text dimColor>
              ○ {inactiveProviders.length} provider{inactiveProviders.length > 1 ? "s" : ""} not configured
            </Text>
          </Box>
        )}
      </Box>

      {activeProviders.length === 0 && (
        <Box marginTop={1}>
          <Text color="yellow">
            No providers detected. Run `wotann init` to configure.
          </Text>
        </Box>
      )}

      {!existsSync(join(process.cwd(), ".wotann")) && (
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan" bold>Welcome to WOTANN!</Text>
          <Text dimColor>First time? Run these to get started:</Text>
          <Text color="white">  wotann init         Set up workspace + providers</Text>
          <Text color="white">  wotann init --free  Free-tier setup (Ollama + free APIs)</Text>
          <Text dimColor>Or type /help for available slash commands.</Text>
        </Box>
      )}
    </Box>
  );
}
