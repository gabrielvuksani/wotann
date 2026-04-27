/**
 * Model picker — interactive provider/model overlay (Ctrl+M).
 *
 * Replaces the prior `cycleModel` round-robin behaviour where Ctrl+M
 * advanced one slot through a flattened list. The cycle pattern works
 * for two providers but breaks down at five+ — users have no idea where
 * in the cycle they are and can never reach a specific model
 * predictably.
 *
 * UX (modeled on OpenClaw's `Ctrl+L` picker, Hermes' overlay pattern,
 * and HistoryPicker's existing fuzzy-search idiom so muscle memory
 * carries over):
 *
 *   - Triggered by Ctrl+M from App.tsx when `model-switch` action fires.
 *   - Renders as a Card overlay over the chat, mirroring HistoryPicker
 *     and CommandPalette dimensions so the visual rhythm holds.
 *   - Entries are derived from the live `providers[]` auth state, NOT
 *     from a static config — so the picker shows models the user
 *     actually has access to (the OpenClaw bug #28254 lesson).
 *   - Each entry renders as `<provider>/<model>` for OpenRouter-style
 *     disambiguation; selecting "ollama/gemma4:latest" produces both
 *     the provider switch and the model id.
 *   - Search box filters via fuzzy substring matching identical to
 *     HistoryPicker so the search semantics are uniform.
 *   - Numeric prefixes (1-9) jump straight to that visible row,
 *     borrowing OpenClaw's index-select pattern. Holding Shift+digit
 *     selects rows 10-18.
 *   - Active provider+model is rendered with a `●` glyph and bold
 *     primary color so the user always sees their current selection.
 *   - Footer shows the active credential billing tier (subscription /
 *     api-key / free) so the user knows what each model costs at a
 *     glance — derived from the same provider auth state.
 *   - Esc cancels (no change), Enter applies, Arrow keys move,
 *     Tab + Shift+Tab also navigate (matching CommandPalette muscle).
 *
 * Honest fallback (QB#10): if `providers` is empty, the picker renders
 * an empty state pointing at `wotann login <provider>` rather than a
 * deceptive "no models available" message.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProviderName } from "../../core/types.js";
import type { ProviderStatus } from "../../core/types.js";
import { PALETTES } from "../themes.js";
import { buildTone, glyph } from "../theme/tokens.js";
import { Card, KeyHintBar } from "./primitives/index.js";

interface ModelPickerProps {
  readonly providers: readonly ProviderStatus[];
  readonly currentProvider: ProviderName;
  readonly currentModel: string;
  readonly onSelect: (provider: ProviderName, model: string) => void;
  readonly onCancel: () => void;
  readonly maxVisible?: number;
}

interface ModelEntry {
  readonly provider: ProviderName;
  readonly model: string;
  readonly billing: string;
  readonly available: boolean;
}

interface ScoredEntry {
  readonly entry: ModelEntry;
  readonly score: number;
  readonly originalIndex: number;
}

const DEFAULT_MAX_VISIBLE = 12;

const FOOTER_HINTS = [
  { keys: "Enter", description: "select" },
  { keys: "Esc", description: "cancel" },
  { keys: "↑/↓", description: "nav" },
  { keys: "1–9", description: "jump" },
  { keys: "Type", description: "filter" },
];

/**
 * Fuzzy-score "provider/model" against query. Mirrors HistoryPicker
 * scoring so search behaviour is uniform across the TUI's three
 * pickers (history / command / model).
 */
function fuzzyScore(candidate: string, query: string): number {
  if (query.length === 0) return 1;
  const lower = candidate.toLowerCase();
  const queryLower = query.toLowerCase();
  if (lower === queryLower) return 1000;
  if (lower.startsWith(queryLower)) {
    return 500 + (queryLower.length / lower.length) * 100;
  }
  const pos = lower.indexOf(queryLower);
  if (pos >= 0) {
    const positionBonus = Math.max(0, 100 - pos * 2);
    const coverageBonus = (queryLower.length / lower.length) * 50;
    return 100 + positionBonus + coverageBonus;
  }
  // Subsequence match — every query char appears in order
  let qi = 0;
  let consecutiveBonus = 0;
  let lastMatchPos = -2;
  for (let ci = 0; ci < lower.length && qi < queryLower.length; ci++) {
    if (lower[ci] === queryLower[qi]) {
      if (ci === lastMatchPos + 1) consecutiveBonus += 10;
      lastMatchPos = ci;
      qi++;
    }
  }
  if (qi === queryLower.length) {
    return 10 + consecutiveBonus + (queryLower.length / lower.length) * 20;
  }
  return -1;
}

/**
 * Flatten providers[].models into one row per (provider, model) pair.
 * Unavailable providers contribute zero rows — the picker never
 * shows a model the user can't actually use.
 */
function buildEntries(providers: readonly ProviderStatus[]): readonly ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const provider of providers) {
    if (!provider.available) continue;
    for (const model of provider.models) {
      entries.push({
        provider: provider.provider,
        model,
        billing: provider.billing,
        available: true,
      });
    }
  }
  return entries;
}

export function ModelPicker({
  providers,
  currentProvider,
  currentModel,
  onSelect,
  onCancel,
  maxVisible = DEFAULT_MAX_VISIBLE,
}: ModelPickerProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const allEntries = useMemo(() => buildEntries(providers), [providers]);

  const filtered: readonly ScoredEntry[] = useMemo(() => {
    const scored: ScoredEntry[] = [];
    for (let i = 0; i < allEntries.length; i++) {
      const entry = allEntries[i];
      if (entry === undefined) continue;
      const candidate = `${entry.provider}/${entry.model}`;
      const score = fuzzyScore(candidate, query);
      if (score > 0) {
        scored.push({ entry, score, originalIndex: i });
      }
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex;
    });
    return scored;
  }, [allEntries, query]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  const apply = useCallback(
    (entry: ModelEntry) => {
      onSelect(entry.provider, entry.model);
    },
    [onSelect],
  );

  const handleSelect = useCallback(() => {
    const scored = filtered[clampedIndex];
    if (scored) apply(scored.entry);
  }, [filtered, clampedIndex, apply]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      handleSelect();
      return;
    }
    if (key.upArrow || (key.shift && key.tab)) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow || key.tab) {
      setSelectedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
      return;
    }
    // Numeric jump: 1-9 selects visible row N (OpenClaw-style index).
    // Only fires when the query is empty so digits in search terms
    // (e.g. "claude-4-7") still type normally.
    if (query.length === 0 && /^[1-9]$/.test(input) && !key.ctrl && !key.meta) {
      const target = Number(input) - 1;
      if (target < filtered.length) {
        const scored = filtered[target];
        if (scored) {
          apply(scored.entry);
          return;
        }
      }
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((prev) => prev + input);
      setSelectedIndex(0);
    }
  });

  // Window the visible slice around the cursor so long lists scroll.
  const visibleStart = Math.max(0, clampedIndex - Math.floor(maxVisible / 2));
  const visibleEntries = filtered.slice(visibleStart, visibleStart + maxVisible);

  const meta = allEntries.length === 0 ? "no providers" : `${filtered.length}/${allEntries.length}`;

  return (
    <Card tone={tone} title="Switch model" meta={meta} accent="primary">
      {/* Search input (mirrors HistoryPicker / CommandPalette so muscle memory carries over) */}
      <Box gap={1}>
        <Text color={tone.primary}>{">"}</Text>
        <Text color={tone.text}>{query}</Text>
        <Text color={tone.primary}>{glyph.cursorBlock}</Text>
      </Box>

      {/* Empty state — honest fallback (QB#10 / QB#6) */}
      {allEntries.length === 0 && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text color={tone.muted}>No providers configured.</Text>
          <Text color={tone.muted}>
            Run{" "}
            <Text color={tone.primary} bold>
              wotann login &lt;provider&gt;
            </Text>{" "}
            or set an API key in env (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY /
            GROQ_API_KEY / OPENROUTER_API_KEY / …).
          </Text>
        </Box>
      )}

      {/* Result list */}
      {allEntries.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {visibleEntries.length === 0 && (
            <Text color={tone.muted}>No models match &quot;{query}&quot;</Text>
          )}
          {visibleEntries.map((scored, displayIdx) => {
            const entry = scored.entry;
            const absoluteIdx = visibleStart + displayIdx;
            const isSelected = absoluteIdx === clampedIndex;
            const isCurrent = entry.provider === currentProvider && entry.model === currentModel;
            const indexLabel = displayIdx < 9 ? String(displayIdx + 1) : " ";
            return (
              <Box key={`mp-${entry.provider}-${entry.model}`} gap={1}>
                <Text color={isSelected ? tone.primary : tone.border}>
                  {isSelected ? glyph.pointer : " "}
                </Text>
                <Text color={tone.muted} dimColor>
                  {indexLabel}
                </Text>
                <Text color={isCurrent ? tone.success : tone.muted} bold={isCurrent}>
                  {isCurrent ? "●" : " "}
                </Text>
                <Text color={tone.muted}>{entry.provider}</Text>
                <Text color={tone.muted}>/</Text>
                <Text color={isSelected ? tone.text : tone.text} bold={isSelected}>
                  {entry.model}
                </Text>
                <Box flexGrow={1} />
                <Text color={tone.muted} dimColor>
                  [{entry.billing}]
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Footer hints */}
      <Box marginTop={1}>
        <KeyHintBar bindings={FOOTER_HINTS} tone={tone} />
      </Box>
    </Card>
  );
}
