/**
 * OptionPicker — generic single-select overlay for any list-of-strings
 * choice. Reused from the slash commands the user previously had to
 * memorize values for: `/mode`, `/theme`, `/thinking`, `/permission`.
 *
 * Design — same skeleton as ModelPicker so muscle memory carries across
 * pickers (Hermes pattern: "3 modal pickers with identical UX"):
 *   - Card primitive overlay with title + meta count.
 *   - Fuzzy substring search.
 *   - Numeric jump 1-9 selects visible row N.
 *   - Arrow keys (and Tab/Shift+Tab) navigate; Enter applies.
 *   - Esc cancels.
 *
 * Honest fallback (QB#5 / QB#10): an empty option list renders an
 * informational message instead of an empty card so the user knows
 * the picker is gated behind some prerequisite (e.g. theme requires
 * a runtime, mode requires a session).
 */

import React, { useCallback, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { PALETTES } from "../themes.js";
import { buildTone, glyph } from "../theme/tokens.js";
import { Card, KeyHintBar } from "./primitives/index.js";

export interface OptionPickerEntry {
  /** The value passed back to onSelect — usually the canonical id. */
  readonly value: string;
  /** Display label; falls back to `value` when omitted. */
  readonly label?: string;
  /** Optional one-line description rendered in muted text. */
  readonly description?: string;
}

interface OptionPickerProps {
  readonly title: string;
  readonly options: readonly OptionPickerEntry[];
  readonly currentValue?: string;
  readonly onSelect: (value: string) => void;
  readonly onCancel: () => void;
  readonly maxVisible?: number;
}

interface ScoredEntry {
  readonly entry: OptionPickerEntry;
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

function fuzzyScore(candidate: string, query: string): number {
  if (query.length === 0) return 1;
  const lower = candidate.toLowerCase();
  const queryLower = query.toLowerCase();
  if (lower === queryLower) return 1000;
  if (lower.startsWith(queryLower)) return 500 + (queryLower.length / lower.length) * 100;
  const pos = lower.indexOf(queryLower);
  if (pos >= 0) {
    const positionBonus = Math.max(0, 100 - pos * 2);
    const coverageBonus = (queryLower.length / lower.length) * 50;
    return 100 + positionBonus + coverageBonus;
  }
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

export function OptionPicker({
  title,
  options,
  currentValue,
  onSelect,
  onCancel,
  maxVisible = DEFAULT_MAX_VISIBLE,
}: OptionPickerProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered: readonly ScoredEntry[] = useMemo(() => {
    const scored: ScoredEntry[] = [];
    for (let i = 0; i < options.length; i++) {
      const entry = options[i];
      if (entry === undefined) continue;
      const candidate = `${entry.value} ${entry.label ?? ""} ${entry.description ?? ""}`;
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
  }, [options, query]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  const apply = useCallback(
    (entry: OptionPickerEntry) => {
      onSelect(entry.value);
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

  const visibleStart = Math.max(0, clampedIndex - Math.floor(maxVisible / 2));
  const visibleEntries = filtered.slice(visibleStart, visibleStart + maxVisible);

  const meta = options.length === 0 ? "no options" : `${filtered.length}/${options.length}`;

  return (
    <Card tone={tone} title={title} meta={meta} accent="primary">
      <Box gap={1}>
        <Text color={tone.primary}>{">"}</Text>
        <Text color={tone.text}>{query}</Text>
        <Text color={tone.primary}>{glyph.cursorBlock}</Text>
      </Box>

      {options.length === 0 && (
        <Box marginTop={1}>
          <Text color={tone.muted}>No options available.</Text>
        </Box>
      )}

      {options.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {visibleEntries.length === 0 && (
            <Text color={tone.muted}>No options match &quot;{query}&quot;</Text>
          )}
          {visibleEntries.map((scored, displayIdx) => {
            const entry = scored.entry;
            const absoluteIdx = visibleStart + displayIdx;
            const isSelected = absoluteIdx === clampedIndex;
            const isCurrent = entry.value === currentValue;
            const indexLabel = displayIdx < 9 ? String(displayIdx + 1) : " ";
            const display = entry.label ?? entry.value;
            return (
              <Box key={`opt-${entry.value}`} gap={1}>
                <Text color={isSelected ? tone.primary : tone.border}>
                  {isSelected ? glyph.pointer : " "}
                </Text>
                <Text color={tone.muted} dimColor>
                  {indexLabel}
                </Text>
                <Text color={isCurrent ? tone.success : tone.muted} bold={isCurrent}>
                  {isCurrent ? "●" : " "}
                </Text>
                <Text color={isSelected ? tone.text : tone.text} bold={isSelected}>
                  {display}
                </Text>
                {entry.description && (
                  <>
                    <Box flexGrow={1} />
                    <Text color={tone.muted} dimColor>
                      {entry.description}
                    </Text>
                  </>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <KeyHintBar bindings={FOOTER_HINTS} tone={tone} />
      </Box>
    </Card>
  );
}
