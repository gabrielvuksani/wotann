/**
 * Memory inspector: view memory entries, search by query,
 * and show layer breakdown with counts and scores.
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type {
  MemoryStore,
  MemoryEntry,
  MemoryLayer,
  MemorySearchResult,
} from "../../memory/store.js";
import { SEVERITY } from "../themes.js";

// ── Types ──────────────────────────────────────────────────────

interface MemoryInspectorProps {
  readonly memoryStore: MemoryStore | null;
  readonly query?: string;
}

interface LayerSummary {
  readonly layer: MemoryLayer;
  readonly count: number;
  readonly label: string;
  readonly color: string;
}

// ── Constants ──────────────────────────────────────────────────

const MAX_ENTRIES_SHOWN = 15;

const LAYER_CONFIG: Readonly<Record<MemoryLayer, { label: string; color: string }>> = {
  auto_capture: { label: "Auto-Capture", color: "gray" },
  core_blocks: { label: "Core Blocks", color: "cyan" },
  working: { label: "Working", color: "green" },
  knowledge_graph: { label: "Knowledge Graph", color: "magenta" },
  archival: { label: "Archival", color: "yellow" },
  recall: { label: "Recall", color: "blue" },
  team: { label: "Team", color: SEVERITY.orange },
  proactive: { label: "Proactive", color: SEVERITY.accent },
};

const ALL_LAYERS: readonly MemoryLayer[] = [
  "auto_capture",
  "core_blocks",
  "working",
  "knowledge_graph",
  "archival",
  "recall",
  "team",
  "proactive",
];

const VERIFICATION_ICONS: Readonly<Record<string, { icon: string; color: string }>> = {
  verified: { icon: "V", color: "green" },
  stale: { icon: "?", color: "yellow" },
  unverified: { icon: "-", color: "gray" },
  conflicting: { icon: "!", color: "red" },
};

// ── Helpers ────────────────────────────────────────────────────

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function buildLayerBreakdown(layerStats: Record<string, number>): readonly LayerSummary[] {
  return ALL_LAYERS.filter((layer) => (layerStats[layer] ?? 0) > 0).map((layer) => ({
    layer,
    count: layerStats[layer] ?? 0,
    label: LAYER_CONFIG[layer].label,
    color: LAYER_CONFIG[layer].color,
  }));
}

function layerBar(count: number, maxCount: number, width: number = 20): string {
  if (maxCount === 0) return "░".repeat(width);
  const filled = Math.max(1, Math.round((count / maxCount) * width));
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// ── Component ──────────────────────────────────────────────────

export function MemoryInspector({ memoryStore, query }: MemoryInspectorProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);

  // Retrieve entries from the store
  const { entries, searchResults, totalCount, layerStats } = useMemo(() => {
    if (memoryStore === null) {
      return {
        entries: [] as readonly MemoryEntry[],
        searchResults: null,
        totalCount: 0,
        layerStats: {} as Record<string, number>,
      };
    }

    try {
      const stats = memoryStore.getLayerStats();
      const count = memoryStore.getEntryCount();

      if (query !== undefined && query.length > 0) {
        const results: readonly MemorySearchResult[] = memoryStore.search(query);
        return {
          entries: results.map((r) => r.entry),
          searchResults: results,
          totalCount: results.length,
          layerStats: stats,
        };
      }

      // Show core_blocks entries as the default view (most useful overview)
      const coreEntries: readonly MemoryEntry[] = memoryStore.getByLayer("core_blocks");
      return {
        entries: coreEntries,
        searchResults: null,
        totalCount: count,
        layerStats: stats,
      };
    } catch {
      return {
        entries: [] as readonly MemoryEntry[],
        searchResults: null,
        totalCount: 0,
        layerStats: {} as Record<string, number>,
      };
    }
  }, [memoryStore, query, scrollOffset]);

  const layerBreakdown = useMemo(() => buildLayerBreakdown(layerStats), [layerStats]);
  const maxLayerCount = layerBreakdown.reduce((max, l) => Math.max(max, l.count), 0);

  const visibleEntries = entries.slice(scrollOffset, scrollOffset + MAX_ENTRIES_SHOWN);

  useInput((_input, key) => {
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setScrollOffset((prev) =>
        Math.min(Math.max(0, entries.length - MAX_ENTRIES_SHOWN), prev + 1),
      );
    }
  });

  // No memory store connected
  if (memoryStore === null) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold color="yellow">
          Memory Inspector
        </Text>
        <Text dimColor>No memory store connected.</Text>
        <Text dimColor>Run `wotann memory` to initialize.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Header */}
      <Box gap={1} marginBottom={1}>
        <Text bold color="cyan">
          Memory Inspector
        </Text>
        <Text dimColor>({totalCount} entries)</Text>
        {query !== undefined && query.length > 0 && (
          <Box gap={1}>
            <Text dimColor>searching:</Text>
            <Text color="yellow">{query}</Text>
          </Box>
        )}
      </Box>

      {/* Layer breakdown */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold dimColor>
          Layer Breakdown:
        </Text>
        {layerBreakdown.length === 0 && <Text dimColor> No entries found</Text>}
        {layerBreakdown.map((layer) => (
          <Box key={layer.layer} gap={1}>
            <Text color={layer.color}>{layer.label.padEnd(16)}</Text>
            <Text color={layer.color}>{layerBar(layer.count, maxLayerCount, 15)}</Text>
            <Text dimColor>{String(layer.count).padStart(4)}</Text>
          </Box>
        ))}
      </Box>

      {/* Entries list */}
      <Box flexDirection="column">
        <Text bold dimColor>
          {searchResults !== null ? "Search Results:" : "Recent Entries:"}
        </Text>

        {visibleEntries.length === 0 && <Text dimColor> No entries to display</Text>}

        {visibleEntries.map((entry, idx) => {
          const verif =
            VERIFICATION_ICONS[entry.verificationStatus] ?? VERIFICATION_ICONS["unverified"]!;
          const score =
            searchResults !== null
              ? (searchResults[scrollOffset + idx]?.score ?? 0)
              : entry.freshnessScore;

          return (
            <Box key={entry.id} flexDirection="column" marginBottom={0}>
              <Box gap={1}>
                <Text color={verif.color}>[{verif.icon}]</Text>
                <Text color={LAYER_CONFIG[entry.layer].color} dimColor>
                  {entry.layer}
                </Text>
                <Text dimColor>/</Text>
                <Text>{entry.blockType}</Text>
                <Text dimColor>score:{formatScore(score)}</Text>
              </Box>
              <Box paddingLeft={4}>
                <Text dimColor>{truncateText(entry.key, 30)}:</Text>
                <Text> {truncateText(entry.value, 50)}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box marginTop={1} gap={1}>
        <Text dimColor>Arrows: scroll</Text>
        {totalCount > MAX_ENTRIES_SHOWN && (
          <Text dimColor>
            | Showing {scrollOffset + 1}-{Math.min(scrollOffset + MAX_ENTRIES_SHOWN, totalCount)} of{" "}
            {totalCount}
          </Text>
        )}
      </Box>
    </Box>
  );
}
