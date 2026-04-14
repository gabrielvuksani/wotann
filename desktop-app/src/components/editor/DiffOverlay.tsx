/**
 * Diff Overlay — inline green/red diffs for agent changes.
 * Accept or reject per-hunk, like a mini code review inside the editor.
 *
 * applyDiffHunks() wires accepted hunks to write_file via Tauri invoke,
 * so accepted changes are persisted to disk immediately.
 */

import { useCallback, useState } from "react";
import type { EditorDiff, DiffHunk } from "../../types";

interface DiffOverlayProps {
  readonly diff: EditorDiff;
  readonly onAcceptHunk: (hunkIndex: number) => void;
  readonly onRejectHunk: (hunkIndex: number) => void;
  readonly onAcceptAll: () => void;
  readonly onRejectAll: () => void;
}

export function DiffOverlay({
  diff,
  onAcceptHunk,
  onRejectHunk,
  onAcceptAll,
  onRejectAll,
}: DiffOverlayProps) {
  return (
    <div className="border rounded-xl overflow-hidden animate-scaleIn" style={{ background: "var(--color-bg-primary)", borderColor: "var(--border-subtle)" }} role="region" aria-label={`Code changes for ${diff.filePath}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border-subtle)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{diff.filePath}</span>
          <span className="text-xs" style={{ color: "var(--color-success)" }}>+{diff.additions}</span>
          <span className="text-xs" style={{ color: "var(--color-error)" }}>-{diff.deletions}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onAcceptAll}
            className="px-2.5 py-1 text-xs font-medium text-white rounded-md transition-colors"
            style={{ background: "var(--color-success)" }}
          >
            Accept All
          </button>
          <button
            onClick={onRejectAll}
            className="px-2.5 py-1 text-xs font-medium hover:bg-white/10 rounded-md transition-colors"
            style={{ background: "var(--surface-3)", color: "var(--color-text-primary)" }}
          >
            Reject All
          </button>
        </div>
      </div>

      {/* Hunks */}
      <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {diff.hunks.map((hunk, i) => (
          <HunkView
            key={i}
            hunk={hunk}
            index={i}
            onAccept={() => onAcceptHunk(i)}
            onReject={() => onRejectHunk(i)}
          />
        ))}
      </div>
    </div>
  );
}

function HunkView({
  hunk,
  index: _index,
  onAccept,
  onReject,
}: {
  readonly hunk: DiffHunk;
  readonly index: number;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}) {
  return (
    <div className="group">
      <div className="flex items-center justify-between px-4 py-1" style={{ background: "var(--surface-2)" }}>
        <span className="text-[10px] font-mono" style={{ color: "var(--color-text-muted)" }}>
          @@ Line {hunk.startLine} @@
        </span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onAccept}
            className="px-2 py-0.5 text-[10px] rounded transition-colors"
            style={{ background: "var(--color-success-muted)", color: "var(--color-success)" }}
          >
            Accept
          </button>
          <button
            onClick={onReject}
            className="px-2 py-0.5 text-[10px] rounded transition-colors"
            style={{ background: "rgba(239, 68, 68, 0.15)", color: "var(--color-error)" }}
          >
            Reject
          </button>
        </div>
      </div>
      <div className="font-mono text-xs">
        {hunk.lines.map((line, li) => (
          <div
            key={li}
            className="px-4 py-0.5"
            style={
              line.type === "add"
                ? { background: "rgba(var(--green-rgb, 34,197,94), 0.06)", borderLeft: "2px solid var(--green)", color: "var(--color-success)" }
                : line.type === "remove"
                ? { background: "rgba(var(--red-rgb, 239,68,68), 0.08)", borderLeft: "2px solid var(--red)", color: "var(--color-error)" }
                : { color: "var(--color-text-muted)", borderLeft: "2px solid transparent" }
            }
          >
            <span className="inline-block w-4 text-center opacity-50">
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
            </span>
            {line.content}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Diff Application Utilities ─────────────────────────────

/**
 * Applies accepted diff hunks to the original file content.
 * For each hunk, removes "remove" lines and inserts "add" lines
 * at the correct positions. Returns the new file content string.
 *
 * Hunks are processed in reverse order (bottom-up) so line offsets
 * remain correct as content is modified.
 */
export function applyDiffHunks(
  originalContent: string,
  hunks: readonly DiffHunk[],
  acceptedIndices: ReadonlySet<number>,
): string {
  const lines = originalContent.split("\n");

  // Process hunks from bottom to top so earlier line numbers stay valid
  const sortedEntries = [...hunks.entries()]
    .filter(([i]) => acceptedIndices.has(i))
    .sort(([, a], [, b]) => b.startLine - a.startLine);

  for (const [, hunk] of sortedEntries) {
    // startLine is 1-based
    const startIdx = hunk.startLine - 1;
    const newLines: string[] = [];
    let removeCount = 0;

    for (const line of hunk.lines) {
      if (line.type === "add") {
        newLines.push(line.content);
      } else if (line.type === "remove") {
        removeCount++;
      } else {
        // context line — keep as-is
        newLines.push(line.content);
        removeCount++;
      }
    }

    lines.splice(startIdx, removeCount, ...newLines);
  }

  return lines.join("\n");
}

/**
 * Hook that manages per-hunk accept/reject state and provides
 * a write-back function via Tauri's write_file command.
 *
 * Usage:
 *   const actions = useDiffActions(diff, originalContent);
 *   <DiffOverlay diff={diff} {...actions.handlers} />
 *   // After user finishes reviewing:
 *   actions.writeAccepted();
 */
export function useDiffActions(diff: EditorDiff, originalContent: string) {
  const [accepted, setAccepted] = useState<ReadonlySet<number>>(new Set());
  const [rejected, setRejected] = useState<ReadonlySet<number>>(new Set());

  const onAcceptHunk = useCallback((index: number) => {
    setAccepted((prev) => new Set([...prev, index]));
    setRejected((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const onRejectHunk = useCallback((index: number) => {
    setRejected((prev) => new Set([...prev, index]));
    setAccepted((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const onAcceptAll = useCallback(() => {
    setAccepted(new Set(diff.hunks.map((_, i) => i)));
    setRejected(new Set());
  }, [diff.hunks]);

  const onRejectAll = useCallback(() => {
    setRejected(new Set(diff.hunks.map((_, i) => i)));
    setAccepted(new Set());
  }, [diff.hunks]);

  /** Write accepted hunks to disk via Tauri invoke("write_file"). */
  const writeAccepted = useCallback(async (): Promise<boolean> => {
    if (accepted.size === 0) return false;

    const newContent = applyDiffHunks(originalContent, diff.hunks, accepted);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if ((window as any).__TAURI_INTERNALS__) {
        await invoke("write_file", { path: diff.filePath, content: newContent });
        return true;
      }
    } catch (err) {
      console.error("[DiffOverlay] Failed to write accepted hunks:", err);
    }
    return false;
  }, [accepted, originalContent, diff.hunks, diff.filePath]);

  return {
    accepted,
    rejected,
    handlers: { onAcceptHunk, onRejectHunk, onAcceptAll, onRejectAll },
    writeAccepted,
  };
}
