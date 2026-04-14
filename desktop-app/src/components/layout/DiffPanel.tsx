/**
 * Diff/Changes right side panel — independent toggle, works on any view.
 * Codex pattern: shows file-by-file diffs with accept/reject actions.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useStore } from "../../store";

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 380;
const DIVIDER_WIDTH = 4;

/**
 * Real diffs arrive via `window.dispatchEvent(new CustomEvent('wotann:diff-update', {detail: FileDiff}))`.
 * TODO(Phase-D): wire useStreaming.ts to emit these on edit_file / write_file tool calls.
 */
interface FileDiff {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffHunkData[];
}

interface DiffHunkData {
  readonly header: string;
  readonly lines: readonly { readonly type: "add" | "remove" | "context"; readonly content: string }[];
}

function PanelDivider({
  onPointerDown,
  isDragging,
}: {
  readonly onPointerDown: (e: React.PointerEvent) => void;
  readonly isDragging: boolean;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize changes panel"
      tabIndex={0}
      style={{
        width: DIVIDER_WIDTH,
        cursor: "col-resize",
        background: isDragging ? "var(--color-primary)" : "var(--border-subtle)",
        transition: isDragging ? "none" : "background var(--transition-fast)",
        flexShrink: 0,
        position: "relative",
        zIndex: 1,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 2,
          height: 24,
          borderRadius: 1,
          background: isDragging ? "var(--color-text-secondary)" : "var(--color-text-dim)",
          opacity: isDragging ? 0.8 : 0.4,
        }}
      />
    </div>
  );
}

function DiffFileCard({ diff }: { readonly diff: FileDiff }) {
  const [expanded, setExpanded] = useState(true);
  const filename = diff.path.split("/").pop() ?? diff.path;

  return (
    <div
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)",
        overflow: "hidden",
        background: "var(--surface-1)",
      }}
    >
      {/* File header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
        style={{
          padding: "8px 12px",
          background: "var(--surface-2)",
          border: "none",
          cursor: "pointer",
        }}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: "var(--color-text-dim)", flexShrink: 0 }}>
            <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span
            className="truncate"
            style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}
          >
            {filename}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--green)", fontFamily: "var(--font-mono)" }}>
            +{diff.additions}
          </span>
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--red)", fontFamily: "var(--font-mono)" }}>
            -{diff.deletions}
          </span>
        </div>
      </button>

      {/* Diff lines */}
      {expanded && (
        <div style={{ fontSize: "var(--font-size-2xs)", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
          {diff.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div style={{ padding: "2px 12px", color: "var(--color-text-dim)", background: "var(--surface-2)", fontSize: "var(--font-size-2xs)" }}>
                {hunk.header}
              </div>
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  style={{
                    padding: "0 12px",
                    background: line.type === "add"
                      ? "rgba(74, 222, 128, 0.06)"
                      : line.type === "remove"
                        ? "rgba(248, 113, 113, 0.06)"
                        : "transparent",
                    color: line.type === "add"
                      ? "var(--green)"
                      : line.type === "remove"
                        ? "var(--red)"
                        : "var(--color-text-muted)",
                    whiteSpace: "pre",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <span style={{ width: 12, display: "inline-block", opacity: 0.5 }}>
                    {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  </span>
                  {line.content}
                </div>
              ))}
            </div>
          ))}

          {/* Accept / Reject actions */}
          <div className="flex items-center gap-2 p-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <button
              className="flex-1 py-1 text-center rounded"
              style={{
                fontSize: "var(--font-size-2xs)",
                fontWeight: 500,
                background: "rgba(74, 222, 128, 0.1)",
                color: "var(--green)",
                border: "none",
                cursor: "pointer",
              }}
              aria-label={`Accept changes to ${filename}`}
            >
              Accept
            </button>
            <button
              className="flex-1 py-1 text-center rounded"
              style={{
                fontSize: "var(--font-size-2xs)",
                fontWeight: 500,
                background: "rgba(248, 113, 113, 0.1)",
                color: "var(--red)",
                border: "none",
                cursor: "pointer",
              }}
              aria-label={`Reject changes to ${filename}`}
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DiffPanel() {
  const toggleDiffPanel = useStore((s) => s.toggleDiffPanel);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Real diffs from engine — populated via custom events dispatched by the streaming handler
  const [diffs, setDiffs] = useState<readonly FileDiff[]>([]);

  // Listen for diff events from the agent's edit_file tool calls
  useEffect(() => {
    function handleDiff(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.path && detail?.hunks) {
        setDiffs((prev) => {
          // Replace existing diff for same file, or append
          const existing = prev.findIndex((d) => d.path === detail.path);
          const newDiff: FileDiff = {
            path: detail.path,
            additions: detail.additions ?? 0,
            deletions: detail.deletions ?? 0,
            hunks: detail.hunks ?? [],
          };
          if (existing >= 0) {
            return [...prev.slice(0, existing), newDiff, ...prev.slice(existing + 1)];
          }
          return [...prev, newDiff];
        });
      }
    }
    function handleClearDiffs() {
      setDiffs([]);
    }
    window.addEventListener("wotann:diff-update", handleDiff);
    window.addEventListener("wotann:diff-clear", handleClearDiffs);
    return () => {
      window.removeEventListener("wotann:diff-update", handleDiff);
      window.removeEventListener("wotann:diff-clear", handleClearDiffs);
    };
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = startXRef.current - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + deltaX));
      setWidth(newWidth);
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  useEffect(() => {
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [handlePointerMove, handlePointerUp]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [width],
  );

  return (
    <div
      className="flex shrink-0 h-full animate-slideInRight"
      style={{
        width,
        transition: isDragging ? "none" : "width var(--transition-normal)",
      }}
      role="region"
      aria-label="Changes panel"
    >
      <PanelDivider onPointerDown={handlePointerDown} isDragging={isDragging} />

      <div className="flex-1 flex flex-col min-w-0" style={{ background: "rgba(255,255,255,0.002)" }}>
        {/* Panel header — compact, mockup-aligned */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            height: 22,
            padding: "0 8px",
            borderBottom: "1px solid rgba(255,255,255,0.012)",
          }}
        >
          <span
            style={{
              fontSize: 7,
              fontWeight: 600,
              color: "var(--color-text-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.4px",
              flex: 1,
            }}
          >
            Changes
          </span>

          <button
            onClick={toggleDiffPanel}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 7, color: "var(--color-text-invisible)",
              padding: "1px 3px", borderRadius: 2,
            }}
            aria-label="Close changes panel"
          >
            &times;
          </button>
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3" role="list" aria-label="Changed files">
          {diffs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center" style={{ padding: 32 }}>
              <svg width="32" height="32" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: "var(--color-text-ghost)", opacity: 0.5 }}>
                <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" />
                <path d="M7 7v4M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                No pending changes
              </p>
              <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
                Changes from agent edits will appear here
              </p>
            </div>
          ) : (
            diffs.map((diff, i) => <DiffFileCard key={i} diff={diff} />)
          )}
        </div>
      </div>
    </div>
  );
}
