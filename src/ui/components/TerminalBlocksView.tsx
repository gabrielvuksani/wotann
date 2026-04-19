/**
 * TerminalBlocksView — Ink TUI component that renders a list of OSC 133
 * terminal blocks (Warp parity). Supports collapse/expand per block,
 * j/k keyboard navigation, and a footer hint.
 *
 * Data layer:
 *   - Pure presentation over a readonly list of `Block` records.
 *   - Parent owns the parser + buffer; this component is side-effect-free.
 *
 * Keys:
 *   j / ↓  — next block
 *   k / ↑  — prev block
 *   return — toggle expand/collapse on selected
 *   e      — expand all
 *   c      — collapse all
 *
 * Phase D — closes the UNKNOWN_UNKNOWNS.md §6 gap (OSC 133 has zero UI).
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import type { Block } from "../terminal-blocks/block.js";

export interface TerminalBlocksViewProps {
  readonly blocks: readonly Block[];
  /** If true, all blocks start expanded. Default: only the most recent. */
  readonly initiallyExpandAll?: boolean;
  /** Called when the user presses return on a block (for copy-command, etc). */
  readonly onActivate?: (block: Block) => void;
  /** Max output lines shown per expanded block (default 20). */
  readonly maxOutputLines?: number;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(2)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1_000);
  return `${mins}m${secs}s`;
}

function statusColor(exitCode: number | undefined, isRunning: boolean): string {
  if (isRunning) return "cyan";
  if (exitCode === undefined) return "gray";
  if (exitCode === 0) return "green";
  return "red";
}

function statusSymbol(exitCode: number | undefined, isRunning: boolean): string {
  if (isRunning) return "◐";
  if (exitCode === undefined) return "◦";
  if (exitCode === 0) return "✓";
  return "✗";
}

function truncateOutput(
  output: string,
  maxLines: number,
): {
  shown: string;
  truncated: boolean;
  totalLines: number;
} {
  const lines = output.split("\n");
  // Drop a trailing empty line from the final newline (cosmetic).
  const effective = lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  if (effective.length <= maxLines) {
    return { shown: effective.join("\n"), truncated: false, totalLines: effective.length };
  }
  return {
    shown: effective.slice(effective.length - maxLines).join("\n"),
    truncated: true,
    totalLines: effective.length,
  };
}

export function TerminalBlocksView({
  blocks,
  initiallyExpandAll = false,
  onActivate,
  maxOutputLines = 20,
}: TerminalBlocksViewProps): React.ReactElement {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    blocks.length > 0 ? (blocks[blocks.length - 1]?.id ?? null) : null,
  );
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => {
    if (initiallyExpandAll) return new Set(blocks.map((b) => b.id));
    // Default: expand the most recent block, collapse older.
    const newest = blocks[blocks.length - 1];
    return newest ? new Set([newest.id]) : new Set();
  });

  // If the selected id no longer exists (buffer trimmed), fall back to newest.
  React.useEffect(() => {
    if (blocks.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !blocks.some((b) => b.id === selectedId)) {
      setSelectedId(blocks[blocks.length - 1]?.id ?? null);
    }
  }, [blocks, selectedId]);

  const selectedIndex = React.useMemo(() => {
    if (!selectedId) return -1;
    return blocks.findIndex((b) => b.id === selectedId);
  }, [blocks, selectedId]);

  useInput((input, key) => {
    if (blocks.length === 0) return;

    // Navigate: j / down = next, k / up = prev.
    if (input === "j" || key.downArrow) {
      const next = Math.min(selectedIndex + 1, blocks.length - 1);
      setSelectedId(blocks[next]?.id ?? null);
      return;
    }
    if (input === "k" || key.upArrow) {
      const prev = Math.max(selectedIndex - 1, 0);
      setSelectedId(blocks[prev]?.id ?? null);
      return;
    }

    // Expand / collapse.
    if (key.return) {
      if (!selectedId) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(selectedId)) {
          next.delete(selectedId);
        } else {
          next.add(selectedId);
        }
        return next;
      });
      const current = blocks.find((b) => b.id === selectedId);
      if (current && onActivate) onActivate(current);
      return;
    }
    if (input === "e") {
      setExpanded(new Set(blocks.map((b) => b.id)));
      return;
    }
    if (input === "c") {
      setExpanded(new Set());
      return;
    }
  });

  if (blocks.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Terminal Blocks</Text>
        <Box marginTop={1}>
          <Text dimColor>
            No blocks yet. Run `wotann init --shell zsh` (or bash/fish) and start a new shell to
            enable OSC 133 block capture.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>Terminal Blocks</Text>
        <Text dimColor> ({blocks.length})</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {blocks.map((block) => {
          const isSelected = block.id === selectedId;
          const isRunning = block.endedAt === undefined;
          const isExpanded = expanded.has(block.id);
          const color = statusColor(block.exitCode, isRunning);
          const symbol = statusSymbol(block.exitCode, isRunning);
          const duration = formatDuration(block.durationMs);
          const trimmedCommand = block.commandText.replace(/\n+$/, "").trim() || "(empty)";

          return (
            <Box key={block.id} flexDirection="column" marginBottom={isExpanded ? 1 : 0}>
              {/* Header row */}
              <Box>
                <Text color={color} bold={isSelected}>
                  {isSelected ? "▸ " : "  "}
                  {symbol}{" "}
                </Text>
                <Text bold={isSelected}>{trimmedCommand}</Text>
                {duration && <Text dimColor> · {duration}</Text>}
                {block.exitCode !== undefined && block.exitCode !== 0 && (
                  <Text color="red"> · exit {block.exitCode}</Text>
                )}
              </Box>

              {/* Expanded body: scoped output with line-count hint. */}
              {isExpanded &&
                block.output.length > 0 &&
                (() => {
                  const { shown, truncated, totalLines } = truncateOutput(
                    block.output,
                    maxOutputLines,
                  );
                  return (
                    <Box flexDirection="column" marginLeft={4} marginTop={0}>
                      {truncated && (
                        <Text dimColor>… {totalLines - maxOutputLines} earlier lines hidden</Text>
                      )}
                      <Text>{shown}</Text>
                    </Box>
                  );
                })()}
            </Box>
          );
        })}
      </Box>

      {/* Footer hint. */}
      <Box marginTop={1}>
        <Text dimColor>j/k: navigate · enter: toggle · e: expand all · c: collapse all</Text>
      </Box>
    </Box>
  );
}
