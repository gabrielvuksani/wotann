/**
 * Startup screen: gradient ASCII logo, version, detected providers.
 * Shown when `wotann` launches — the first thing the user sees.
 *
 * V9 design polish:
 *   - Gradient logo retained, but trailing rune line + tagline added
 *     so the brand voice ("Norse all-father of wisdom") shows up
 *     immediately.
 *   - Provider list rendered with StatusBadge so the green/idle
 *     conventions match the rest of the TUI.
 *   - Welcome card pulled into a framed Card so it visually
 *     differentiates from the status list.
 *   - All colors now flow through the design tokens (cyan signature
 *     stays the brand). Light/sepia themes inherit automatically.
 */

import React from "react";
import { Box, Text } from "ink";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderStatus } from "../../core/types.js";
import { STARTUP_GRADIENT, PALETTES } from "../themes.js";
import { buildTone, rune as runes, glyph } from "../theme/tokens.js";
import { Card, Notification, StatusBadge } from "./primitives/index.js";

const LOGO_LINES = [
  " __        _____  _____  _    _   _ _   _ ",
  " \\ \\      / / _ \\|_   _|/ \\  | \\ | | \\ | |",
  "  \\ \\ /\\ / / | | | | | / _ \\ |  \\| |  \\| |",
  "   \\ V  V /| |_| | | |/ ___ \\| |\\  | |\\  |",
  "    \\_/\\_/  \\___/  |_/_/   \\_\\_| \\_|_| \\_|",
];

/** Palette-backed logo gradient — replaces legacy purple stand-ins. */
const GRADIENT_COLORS = STARTUP_GRADIENT;

/**
 * Decorative runic flourish printed below the logo. The three signature
 * runes spell out the WOTANN command modes: Ask, Relay, Autopilot.
 */
const RUNIC_TAGLINE = `${runes.ask}  ${runes.relay}  ${runes.autopilot}`;

interface StartupScreenProps {
  readonly version: string;
  readonly providers: readonly ProviderStatus[];
}

export function StartupScreen({ version, providers }: StartupScreenProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const activeProviders = providers.filter((p) => p.available);
  const inactiveProviders = providers.filter((p) => !p.available);
  const hasWorkspace = existsSync(join(process.cwd(), ".wotann"));

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

      {/* Runic tagline + version meta */}
      <Box marginTop={1} justifyContent="space-between">
        <Box gap={2}>
          <Text color={tone.rune} bold>
            {RUNIC_TAGLINE}
          </Text>
          <Text color={tone.muted}>Ask · Relay · Autopilot</Text>
        </Box>
        <Box gap={1}>
          <Text color={tone.muted}>Unified Agent Harness</Text>
          <Text color={tone.primary} bold>
            v{version}
          </Text>
        </Box>
      </Box>

      {/* Provider status — palette-aware badges replace literal colors */}
      <Box flexDirection="column" marginTop={1}>
        <Text color={tone.text} bold>
          Providers
        </Text>
        {activeProviders.map((p) => (
          <Box key={`${p.provider}-${p.authMethod}`} gap={1}>
            <StatusBadge tone={tone} variant="ok" />
            <Text color={tone.text}>{p.label}</Text>
            <Text color={tone.muted}>({p.billing})</Text>
            <Text color={tone.muted}>
              {glyph.bullet} {p.models.slice(0, 3).join(", ")}
            </Text>
          </Box>
        ))}
        {inactiveProviders.length > 0 && (
          <Box gap={1}>
            <StatusBadge tone={tone} variant="idle" />
            <Text color={tone.muted}>
              {inactiveProviders.length} provider{inactiveProviders.length > 1 ? "s" : ""} not
              configured
            </Text>
          </Box>
        )}
      </Box>

      {activeProviders.length === 0 && (
        <Box marginTop={1}>
          <Notification
            tone={tone}
            kind="warning"
            title="No providers detected"
            body="Run `wotann init` to configure one — free-tier setup takes <90s."
          />
        </Box>
      )}

      {!hasWorkspace && (
        <Box marginTop={1}>
          <Card tone={tone} title="Welcome to WOTANN" rune={runes.ask} accent="primary">
            <Box flexDirection="column">
              <Text color={tone.muted}>First time? Try one of these:</Text>
              <Box gap={1}>
                <Text color={tone.primary} bold>
                  wotann init
                </Text>
                <Text color={tone.muted}>Set up workspace + providers</Text>
              </Box>
              <Box gap={1}>
                <Text color={tone.primary} bold>
                  wotann init --free
                </Text>
                <Text color={tone.muted}>Free-tier setup (Ollama + free APIs)</Text>
              </Box>
              <Box gap={1}>
                <Text color={tone.primary} bold>
                  /help
                </Text>
                <Text color={tone.muted}>List all slash commands</Text>
              </Box>
            </Box>
          </Card>
        </Box>
      )}
    </Box>
  );
}
