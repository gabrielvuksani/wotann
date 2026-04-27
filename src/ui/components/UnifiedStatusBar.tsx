/**
 * UnifiedStatusBar — single dense top-of-screen status row.
 *
 * Replaces the prior ContextHUD + StatusBar pair that stacked redundant
 * information (both showed model, provider, cost). Per the user's TUI
 * screenshot: "two status bars stacking the same info" was wasted real
 * estate.
 *
 * Design synthesized from:
 *   - Claude Hud — 4 zones of info (model+context | active tool +
 *     aggregated counts | subagent | todo) packed densely without
 *     feeling cluttered
 *   - Hermes — persistent top bar with color-coded context band
 *     (green <50%, yellow 50-80%, red >80%) and per-mode skin
 *   - Codex — responsive collapse hierarchy (most-important info
 *     stays visible under width pressure; least-important hides
 *     first)
 *
 * Layout (single row, three zones, justify-space-between):
 *
 *   [████░░░ 45% (8K/131K)] [ᚠ opus-4-7 via anthropic][default]   $0.003 R3·E1·B0 T2 S89 ◇62%
 *   └─── context ─────────┘ └─── identity ────────────────────┘   └─── activity ────────────┘
 *
 *   - Context cluster: gradient bar + percent + raw counts. Green→
 *     yellow→red severity follows token usage. Always visible.
 *   - Identity cluster: rune brand mark + model + provider + mode
 *     pill + ROE indicator + streaming dot. Always visible.
 *   - Activity cluster: cost + aggregated tool counts (Read·Edit·
 *     Bash with middle-dot separators) + turn count + skill count
 *     + cache hit rate. Tool counts AGGREGATE (R3 not three rows)
 *     per Claude Hud's "kill statusline noise" lesson.
 *
 * Streaming behaviour: when the runtime is producing output, the
 * border color flips to success-green and a dot precedes the rune
 * — same dot the prior StatusBar used so muscle memory carries over.
 *
 * Honest fallbacks (QB#5 / QB#6):
 *   - Cache hit rate omitted entirely when 0 (don't lie about a
 *     warm cache; the prior ContextHUD hardcoded 62% which was
 *     theatrical).
 *   - Turn / skill counts omitted when 0 to keep the line tight.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ProviderName } from "../../core/types.js";
import { PALETTES } from "../themes.js";
import { buildTone, glyph, rune } from "../theme/tokens.js";
import { GradientBar, Pill, type StatusVariant } from "./primitives/index.js";

interface UnifiedStatusBarProps {
  // Identity
  readonly model: string;
  readonly provider: ProviderName;
  readonly mode?: string;
  // Context
  readonly usedTokens: number;
  readonly maxTokens: number;
  readonly cacheHitRate?: number;
  // Activity
  readonly costUsd: number;
  readonly reads: number;
  readonly edits: number;
  readonly bashCalls: number;
  readonly turnCount?: number;
  readonly skillCount?: number;
  readonly tokensPerMinute?: number;
  readonly costPerHour?: number;
  // State
  readonly isStreaming?: boolean;
  readonly roeSessionActive?: boolean;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function severityFromContextPct(pct: number, tone: ReturnType<typeof buildTone>): string {
  if (pct < 50) return tone.success;
  if (pct < 80) return tone.warning;
  return tone.error;
}

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

export function UnifiedStatusBar(props: UnifiedStatusBarProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const {
    model,
    provider,
    mode = "default",
    usedTokens,
    maxTokens,
    cacheHitRate,
    costUsd,
    reads,
    edits,
    bashCalls,
    turnCount = 0,
    skillCount,
    isStreaming = false,
    roeSessionActive = false,
  } = props;

  const contextPct = maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 100) : 0;
  const accentColor = severityFromContextPct(contextPct, tone);
  const borderColor = isStreaming ? tone.success : tone.border;
  const variant = modeVariant(mode);

  // Strip vendor prefixes for compact display (gpt-/claude-).
  // Same compaction the legacy StatusBar did so muscle memory carries.
  const compactModel = model.replace("claude-", "").replace("gpt-", "");

  // Aggregated tool counts — Claude Hud "Read ×3" pattern, but with a
  // tighter middle-dot separator that fits inline. Skip the cluster
  // entirely when nothing has happened yet.
  const hasToolActivity = reads > 0 || edits > 0 || bashCalls > 0;

  // Cache cluster suppressed when 0 (honest fallback — don't lie about
  // a warm cache the way the prior ContextHUD hardcoded 62%).
  const hasCache = typeof cacheHitRate === "number" && cacheHitRate > 0;

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      justifyContent="space-between"
      width="100%"
    >
      {/* ── Left cluster: context gauge ── */}
      <Box gap={1}>
        <GradientBar tone={tone} percent={contextPct} width={16} />
        <Text color={accentColor} bold>
          {contextPct}%
        </Text>
        <Text color={tone.muted}>
          ({formatTokens(usedTokens)}/{formatTokens(maxTokens)})
        </Text>
      </Box>

      {/* ── Center cluster: identity (rune + model + provider + mode) ── */}
      <Box gap={1}>
        {isStreaming ? (
          <Text color={tone.success} bold>
            {glyph.statusActive}
          </Text>
        ) : (
          <Text color={tone.rune} bold>
            {rune.ask}
          </Text>
        )}
        <Text color={tone.primary} bold>
          {compactModel}
        </Text>
        <Text color={tone.muted}>via</Text>
        <Text color={tone.text}>{provider}</Text>
        <Pill tone={tone} label={mode} variant={variant} />
        {mode === "guardrails-off" && roeSessionActive && (
          <Pill tone={tone} label="ROE" variant="warn" />
        )}
        {mode === "guardrails-off" && !roeSessionActive && (
          <Pill tone={tone} label="NO-ROE" variant="fail" />
        )}
      </Box>

      {/* ── Right cluster: cost + tool counts + counters + cache ── */}
      <Box gap={1}>
        <Text color={tone.success}>${costUsd.toFixed(3)}</Text>
        {hasToolActivity && (
          <Text color={tone.muted}>
            R{reads}·E{edits}·B{bashCalls}
          </Text>
        )}
        {turnCount > 0 && <Text color={tone.muted}>T{turnCount}</Text>}
        {skillCount !== undefined && skillCount > 0 && (
          <Text color={tone.muted}>S{skillCount}</Text>
        )}
        {hasCache && (
          <Box gap={0}>
            <Text color={tone.muted}>{glyph.statusActive}</Text>
            <Text color={tone.success} bold>
              {Math.round((cacheHitRate ?? 0) * 100)}%
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
