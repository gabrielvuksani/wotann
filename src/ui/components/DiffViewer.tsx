/**
 * DiffViewer — terminal-based unified diff viewer for the TUI.
 *
 * Displays file changes with:
 * - Color-coded additions (green) and deletions (red)
 * - Line numbers for both old and new versions
 * - Context lines around changes
 * - Collapsible hunks for large diffs
 * - Summary statistics (lines added/removed/modified)
 */

import React from "react";
import { Text, Box } from "ink";

export interface DiffLine {
  readonly type: "add" | "remove" | "context" | "header";
  readonly content: string;
  readonly oldLineNum?: number;
  readonly newLineNum?: number;
}

export interface DiffHunk {
  readonly startOld: number;
  readonly startNew: number;
  readonly lines: readonly DiffLine[];
}

export interface DiffViewerProps {
  readonly filePath: string;
  readonly hunks: readonly DiffHunk[];
  readonly compact?: boolean;
  readonly maxLines?: number;
}

export function DiffViewer({ filePath, hunks, compact = false, maxLines = 100 }: DiffViewerProps): React.ReactElement {
  const stats = computeStats(hunks);
  let totalLines = 0;

  return React.createElement(Box, { flexDirection: "column", paddingX: 1 },
    // File header
    React.createElement(Box, { marginBottom: 1 },
      React.createElement(Text, { bold: true, color: "cyan" }, `--- ${filePath}`),
    ),
    // Stats
    React.createElement(Box, { marginBottom: 1 },
      React.createElement(Text, { color: "green" }, `+${stats.added}`),
      React.createElement(Text, { dimColor: true }, " / "),
      React.createElement(Text, { color: "red" }, `-${stats.removed}`),
      React.createElement(Text, { dimColor: true }, ` (${stats.hunks} hunk${stats.hunks !== 1 ? "s" : ""})`),
    ),
    // Hunks
    ...hunks.map((hunk, hunkIdx) => {
      const hunkLines: React.ReactElement[] = [];

      // Hunk header
      hunkLines.push(
        React.createElement(Text, {
          key: `hdr-${hunkIdx}`,
          color: "cyan",
          dimColor: true,
        }, `@@ -${hunk.startOld} +${hunk.startNew} @@`),
      );

      for (const line of hunk.lines) {
        totalLines++;
        if (totalLines > maxLines) break;

        if (compact && line.type === "context") continue;

        const color = line.type === "add" ? "green"
          : line.type === "remove" ? "red"
          : undefined;
        const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
        const lineNum = line.type === "remove"
          ? String(line.oldLineNum ?? "").padStart(4)
          : String(line.newLineNum ?? "").padStart(4);

        hunkLines.push(
          React.createElement(Text, {
            key: `line-${hunkIdx}-${totalLines}`,
            color,
            dimColor: line.type === "context",
          }, `${lineNum} ${prefix} ${line.content}`),
        );
      }

      return React.createElement(Box, {
        key: `hunk-${hunkIdx}`,
        flexDirection: "column",
        marginBottom: 1,
      }, ...hunkLines);
    }),
    // Truncation notice
    totalLines > maxLines
      ? React.createElement(Text, { dimColor: true }, `... ${totalLines - maxLines} more lines (use --full to see all)`)
      : null,
  );
}

function computeStats(hunks: readonly DiffHunk[]): { added: number; removed: number; hunks: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") added++;
      if (line.type === "remove") removed++;
    }
  }
  return { added, removed, hunks: hunks.length };
}

/**
 * Parse a unified diff string into structured hunks.
 * Works with output from `git diff` or similar tools.
 */
export function parseUnifiedDiff(diffText: string): readonly DiffHunk[] {
  const lines = diffText.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      oldLine = parseInt(hunkMatch[1] ?? "1", 10);
      newLine = parseInt(hunkMatch[2] ?? "1", 10);
      currentHunk = { startOld: oldLine, startNew: newLine, lines: [] };
      continue;
    }

    if (!currentHunk) continue;

    const mutableLines = currentHunk.lines as DiffLine[];

    if (line.startsWith("+") && !line.startsWith("+++")) {
      mutableLines.push({ type: "add", content: line.slice(1), newLineNum: newLine });
      newLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      mutableLines.push({ type: "remove", content: line.slice(1), oldLineNum: oldLine });
      oldLine++;
    } else if (line.startsWith(" ")) {
      mutableLines.push({ type: "context", content: line.slice(1), oldLineNum: oldLine, newLineNum: newLine });
      oldLine++;
      newLine++;
    }
  }

  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}
