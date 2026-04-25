/**
 * Status bar: model | provider | mode | cost | context | tool counts.
 * Always visible at the bottom, updates in real-time during streaming.
 *
 * V9 design polish:
 *   - Pulls border + content colors from the design token graph rather
 *     than literal "gray"/"cyan" strings, so theme switches flow through.
 *   - Mode rendered as a Pill primitive — uniform "[mode]" badge with
 *     palette-aware coloring per intent.
 *   - Context bar uses the GradientBar primitive: green prefix → yellow
 *     midsection → red tail makes the danger zone unambiguous at a glance.
 *   - Streaming dot animates via the Spinner primitive (same dot style
 *     used in ChatView), giving a single coherent "we're working" cue.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ProviderName } from "../../core/types.js";
import { PALETTES } from "../themes.js";
import { buildTone, glyph, rune } from "../theme/tokens.js";
import { GradientBar, Pill, type StatusVariant } from "./primitives/index.js";

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

/**
 * Mode → visual variant mapping.
 *   plan/auto/autonomous get distinct accents so muscle memory pairs
 *   color with intent.
 */
function modeVariant(mode: string): StatusVariant {
  switch (mode) {
    case "plan":
    case "interview":
    case "review":
      return "info";
    case "auto":
    case "autonomous":
      return "ok";
    case "bypass":
    case "guardrails-off":
    case "exploit":
      return "fail";
    case "acceptEdits":
    case "focus":
    case "teach":
      return "running";
    default:
      return "idle";
  }
}

/**
 * Map mode → optional rune. Three command modes get the canonical
 * Norse glyphs so "[plan]" + "ᚱ" reinforces the brand without being
 * crowded.
 */
function modeRune(mode: string): string | undefined {
  switch (mode) {
    case "default":
      return rune.ask;
    case "auto":
    case "autonomous":
      return rune.autopilot;
    case "interview":
    case "review":
      return rune.relay;
    default:
      return undefined;
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
  const tone = buildTone(PALETTES.dark);
  const borderColor = isStreaming ? tone.success : tone.border;
  const variant = modeVariant(mode);
  const decorativeRune = modeRune(mode);

  // Strip vendor prefixes for compact display (gpt-/claude-).
  const compactModel = model.replace("claude-", "").replace("gpt-", "");

  return (
    <Box borderStyle="single" borderColor={borderColor} paddingX={1} justifyContent="space-between">
      {/* ── Left cluster: streaming dot + model + provider ── */}
      <Box gap={1}>
        {isStreaming && (
          <Text color={tone.success} bold>
            {glyph.statusActive}
          </Text>
        )}
        {decorativeRune !== undefined && !isStreaming && (
          <Text color={tone.rune} bold>
            {decorativeRune}
          </Text>
        )}
        <Text color={tone.primary} bold>
          {compactModel}
        </Text>
        <Text color={tone.muted}>via</Text>
        <Text color={tone.text}>{provider}</Text>
      </Box>

      {/* ── Center cluster: mode pill + ROE indicator + counters ── */}
      <Box gap={1}>
        <Pill tone={tone} label={mode} variant={variant} />
        {mode === "guardrails-off" && roeSessionActive && (
          <Pill tone={tone} label="ROE" variant="warn" />
        )}
        {mode === "guardrails-off" && !roeSessionActive && (
          <Pill tone={tone} label="NO-ROE" variant="fail" />
        )}
        {turnCount > 0 && <Text color={tone.muted}>T{turnCount}</Text>}
        {skillCount !== undefined && <Text color={tone.muted}>S{skillCount}</Text>}
      </Box>

      {/* ── Right cluster: cost + gradient context bar + tool counts ── */}
      <Box gap={1}>
        <Text color={tone.success}>${cost.toFixed(3)}</Text>
        <GradientBar tone={tone} percent={contextPercent} width={12} />
        <Text color={tone.muted}>{contextPercent}%</Text>
        <Text color={tone.muted}>
          R{reads} E{edits} B{bashCalls}
        </Text>
      </Box>
    </Box>
  );
}
