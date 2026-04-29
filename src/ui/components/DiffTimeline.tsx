/**
 * Diff Timeline: shows historical diffs with scrubbing.
 * Allows navigating through file changes over time, showing
 * which lines were added/removed at each point.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Palette } from "../themes.js";
import { PALETTES } from "../themes.js";
import { buildTone, type Tone } from "../theme/tokens.js";

// ── Types ──────────────────────────────────────────────────────

export interface DiffEntry {
  readonly id: string;
  readonly file: string;
  readonly timestamp: number;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffHunk[];
  readonly author: string;
  readonly message: string;
}

export interface DiffHunk {
  readonly startLine: number;
  readonly lines: readonly DiffLine[];
}

export interface DiffLine {
  readonly type: "add" | "remove" | "context";
  readonly content: string;
  readonly lineNumber: number;
}

interface DiffTimelineProps {
  readonly entries: readonly DiffEntry[];
  readonly maxHunksVisible?: number;
  /**
   * Active palette — wired from App so theme cycling carries through to
   * the timeline. Falls back to the dark canonical palette when unset.
   */
  readonly palette?: Palette;
}

// ── Helpers ────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function lineColor(type: DiffLine["type"], tone: Tone): string {
  if (type === "add") return tone.success;
  if (type === "remove") return tone.error;
  return tone.muted;
}

function linePrefix(type: DiffLine["type"]): string {
  if (type === "add") return "+";
  if (type === "remove") return "-";
  return " ";
}

// ── Component ──────────────────────────────────────────────────

export function DiffTimeline({
  entries,
  maxHunksVisible = 4,
  palette,
}: DiffTimelineProps): React.ReactElement {
  const tone = buildTone(palette ?? PALETTES.dark);
  const [selectedEntry, setSelectedEntry] = useState(0);
  const [selectedHunk, setSelectedHunk] = useState(0);
  const entry = entries[selectedEntry];

  useInput((_input, key) => {
    if (key.leftArrow && selectedEntry > 0) {
      setSelectedEntry(selectedEntry - 1);
      setSelectedHunk(0);
    }
    if (key.rightArrow && selectedEntry < entries.length - 1) {
      setSelectedEntry(selectedEntry + 1);
      setSelectedHunk(0);
    }
    if (key.upArrow && selectedHunk > 0) {
      setSelectedHunk(selectedHunk - 1);
    }
    if (entry && key.downArrow && selectedHunk < entry.hunks.length - 1) {
      setSelectedHunk(selectedHunk + 1);
    }
  });

  if (entries.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={tone.primary}>
          📊 Diff Timeline
        </Text>
        <Text color={tone.muted} dimColor>
          No changes recorded
        </Text>
      </Box>
    );
  }

  if (!entry) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={tone.primary}>
          📊 Diff Timeline
        </Text>
        <Text color={tone.muted}>No entry selected</Text>
      </Box>
    );
  }

  const visibleHunks = entry.hunks.slice(selectedHunk, selectedHunk + maxHunksVisible);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Text bold color={tone.primary}>
        📊 Diff Timeline
      </Text>

      {/* Timeline scrubber */}
      <Box marginTop={1}>
        {entries.map((e, i) => {
          const isSelected = i === selectedEntry;
          return (
            <Box key={e.id} marginRight={1}>
              <Text
                color={isSelected ? tone.text : tone.muted}
                bold={isSelected}
                inverse={isSelected}
              >
                {` ${formatTime(e.timestamp)} `}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Entry details */}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold>{entry.file}</Text>
          <Text color={tone.success}> +{entry.additions}</Text>
          <Text color={tone.error}> -{entry.deletions}</Text>
        </Box>
        <Text color={tone.muted}>{entry.message}</Text>
      </Box>

      {/* Diff hunks */}
      <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1}>
        {visibleHunks.map((hunk, hi) => (
          <Box key={`hunk-${hi}`} flexDirection="column">
            <Text color={tone.primary} dimColor>
              @@ Line {hunk.startLine} @@
            </Text>
            {hunk.lines.map((line, li) => (
              <Box key={`line-${hi}-${li}`}>
                <Text color={tone.muted} dimColor>
                  {String(line.lineNumber).padStart(4)}
                </Text>
                <Text color={lineColor(line.type, tone)}>
                  {" "}
                  {linePrefix(line.type)} {line.content}
                </Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      {entry.hunks.length > maxHunksVisible && (
        <Text color={tone.muted} dimColor>
          Showing hunks {selectedHunk + 1}-
          {Math.min(selectedHunk + maxHunksVisible, entry.hunks.length)} of {entry.hunks.length}
        </Text>
      )}

      {/* Controls */}
      <Box marginTop={1}>
        <Text color={tone.muted} dimColor>
          ←→ scrub timeline ↑↓ scroll hunks ({selectedEntry + 1}/{entries.length})
        </Text>
      </Box>
    </Box>
  );
}

export default DiffTimeline;
