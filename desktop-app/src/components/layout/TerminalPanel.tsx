/**
 * Terminal bottom panel — independent toggle, works on any view.
 * VS Code / Cursor pattern: slides up from the bottom with a draggable divider.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useStore } from "../../store";
import { EditorTerminal } from "../editor/EditorTerminal";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 500;
const DEFAULT_HEIGHT = 220;
const DIVIDER_HEIGHT = 4;

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
      aria-orientation="horizontal"
      aria-label="Resize terminal panel"
      tabIndex={0}
      style={{
        height: DIVIDER_HEIGHT,
        cursor: "row-resize",
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
          width: 24,
          height: 2,
          borderRadius: 1,
          background: isDragging ? "var(--color-text-secondary)" : "var(--color-text-dim)",
          opacity: isDragging ? 0.8 : 0.4,
          transition: isDragging ? "none" : "opacity var(--transition-fast)",
        }}
      />
    </div>
  );
}

export function TerminalPanel() {
  const toggleTerminalPanel = useStore((s) => s.toggleTerminalPanel);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      // Dragging upward increases height
      const deltaY = startYRef.current - e.clientY;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeightRef.current + deltaY));
      setHeight(newHeight);
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
      startYRef.current = e.clientY;
      startHeightRef.current = height;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [height],
  );

  return (
    <div
      className="flex flex-col shrink-0 animate-slideUp"
      style={{
        height,
        borderTop: "1px solid rgba(255,255,255,0.018)",
        background: "rgba(0,0,0,0.1)",
        transition: isDragging ? "none" : "height var(--transition-normal)",
      }}
      role="region"
      aria-label="Terminal panel"
    >
      <PanelDivider onPointerDown={handlePointerDown} isDragging={isDragging} />

      {/* Panel header — compact, mockup-aligned */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          height: 22,
          padding: "0 8px",
          borderBottom: "1px solid rgba(255,255,255,0.01)",
        }}
      >
        <span
          style={{
            fontSize: 6,
            fontWeight: 600,
            color: "var(--color-text-ghost)",
            textTransform: "uppercase",
            letterSpacing: "0.4px",
          }}
        >
          Terminal
        </span>

        <button
          onClick={toggleTerminalPanel}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 7, color: "var(--color-text-invisible)",
            padding: "1px 3px", borderRadius: 2,
          }}
          aria-label="Close terminal panel"
        >
          &times;
        </button>
      </div>

      {/* Inline last-error banner. Polls the daemon's terminal monitor
          (`terminal.lastError` RPC). When a recent error is captured we
          surface it with the suggested fix so the user sees actionable
          guidance without having to run a separate command. */}
      <TerminalLastErrorBanner />

      {/* Terminal content */}
      <div className="flex-1 min-h-0">
        <EditorTerminal />
      </div>
    </div>
  );
}

/**
 * Inline banner rendered at the top of TerminalPanel. Polls
 * `terminal.lastError` every 5s and renders the captured error with its
 * suggested fix when present. Hidden when no error has been observed.
 */
function TerminalLastErrorBanner() {
  const [lastError, setLastError] = useState<{
    error: string;
    suggestion?: string;
    when?: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const { commands } = await import("../../hooks/useTauriCommand");
        const result = (await commands.rpcCall("terminal.lastError")) as {
          error?: string;
          suggestion?: string;
          when?: number;
        } | null;
        if (cancelled) return;
        if (result && typeof result.error === "string" && result.error.length > 0) {
          setLastError({
            error: result.error,
            ...(result.suggestion ? { suggestion: result.suggestion } : {}),
            ...(typeof result.when === "number" ? { when: result.when } : {}),
          });
        } else {
          setLastError(null);
        }
      } catch {
        // best-effort — daemon may be unreachable; clear any stale error
        if (!cancelled) setLastError(null);
      }
    }

    poll();
    intervalHandle = setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      if (intervalHandle !== null) clearInterval(intervalHandle);
    };
  }, []);

  if (!lastError) return null;

  return (
    <div
      role="alert"
      style={{
        padding: "6px 10px",
        background: "var(--color-error-muted)",
        borderBottom: "1px solid var(--color-error-muted)",
        fontSize: "var(--font-size-xs)",
        color: "var(--color-text-muted)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "var(--radius-pill)",
            background: "var(--color-error)",
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <span style={{ fontWeight: 600, color: "var(--color-error)" }}>Last error</span>
        <span style={{ fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {lastError.error}
        </span>
      </div>
      {lastError.suggestion && (
        <div style={{ marginLeft: 12, fontStyle: "italic" }}>
          Suggestion: {lastError.suggestion}
        </div>
      )}
    </div>
  );
}
