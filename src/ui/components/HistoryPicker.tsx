/**
 * History picker: fuzzy-search prompt history overlay.
 * Triggered by Ctrl+R, allows substring filtering with scored results,
 * arrow-key navigation, Enter to select, Escape to cancel.
 */

import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";

interface HistoryPickerProps {
  readonly history: readonly string[];
  readonly onSelect: (prompt: string) => void;
  readonly onCancel: () => void;
}

interface ScoredEntry {
  readonly text: string;
  readonly score: number;
  readonly index: number;
}

const MAX_VISIBLE = 10;

/**
 * Fuzzy-score a candidate against a query using substring matching.
 * Returns -1 for no match, or a positive score (higher = better).
 * Scoring: exact match > prefix > early substring > late substring.
 */
function fuzzyScore(candidate: string, query: string): number {
  if (query.length === 0) return 1;

  const lower = candidate.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match
  if (lower === queryLower) return 1000;

  // Prefix match
  if (lower.startsWith(queryLower)) return 500 + (queryLower.length / lower.length) * 100;

  // Substring match — earlier position scores higher
  const pos = lower.indexOf(queryLower);
  if (pos >= 0) {
    const positionBonus = Math.max(0, 100 - pos * 2);
    const coverageBonus = (queryLower.length / lower.length) * 50;
    return 100 + positionBonus + coverageBonus;
  }

  // Word-boundary match: check if all query chars appear in order
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

export function HistoryPicker({
  history,
  onSelect,
  onCancel,
}: HistoryPickerProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered: readonly ScoredEntry[] = useMemo(() => {
    const scored: ScoredEntry[] = [];
    for (let i = 0; i < history.length; i++) {
      const text = history[i];
      if (text === undefined) continue;
      const score = fuzzyScore(text, query);
      if (score > 0) {
        scored.push({ text, score, index: i });
      }
    }
    // Sort by score descending, then by recency (lower index = more recent)
    return scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
  }, [history, query]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  const handleSelect = useCallback(() => {
    const entry = filtered[clampedIndex];
    if (entry) {
      onSelect(entry.text);
    }
  }, [filtered, clampedIndex, onSelect]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      handleSelect();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setQuery((prev) => prev + input);
      setSelectedIndex(0);
    }
  });

  const visibleStart = Math.max(0, clampedIndex - Math.floor(MAX_VISIBLE / 2));
  const visibleEntries = filtered.slice(visibleStart, visibleStart + MAX_VISIBLE);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box gap={1} marginBottom={1}>
        <Text color="cyan" bold>History Search</Text>
        <Text dimColor>({filtered.length}/{history.length})</Text>
      </Box>

      {/* Search input */}
      <Box gap={1}>
        <Text color="cyan">{">"}</Text>
        <Text>{query}</Text>
        <Text color="cyan">|</Text>
      </Box>

      {/* Results list */}
      <Box flexDirection="column" marginTop={1}>
        {visibleEntries.length === 0 && (
          <Text dimColor>No matching history entries</Text>
        )}
        {visibleEntries.map((entry, displayIdx) => {
          const absoluteIdx = visibleStart + displayIdx;
          const isSelected = absoluteIdx === clampedIndex;
          // Truncate long entries for display
          const displayText = entry.text.length > 80
            ? entry.text.slice(0, 77) + "..."
            : entry.text;

          return (
            <Box key={`hist-${entry.index}`} gap={1}>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? ">" : " "}
              </Text>
              <Text bold={isSelected} color={isSelected ? "white" : undefined}>
                {displayText}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Footer hints */}
      <Box marginTop={1} gap={1}>
        <Text dimColor>Enter: select</Text>
        <Text dimColor>|</Text>
        <Text dimColor>Esc: cancel</Text>
        <Text dimColor>|</Text>
        <Text dimColor>Arrows: navigate</Text>
      </Box>
    </Box>
  );
}
