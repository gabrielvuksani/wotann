/**
 * Reusable horizontal split pane: left workspace + right chat pane with draggable divider.
 * Used by Editor, Workshop, and Exploit spaces.
 *
 * Features:
 * - Controlled right-pane width via props (parent owns the state)
 * - Draggable 4px divider with pointer events (touch/pen compatible)
 * - Right pane collapsible to width=0 with CSS transition
 * - All dimensions and colors via WOTANN design system CSS variables
 */

import { useState, useRef, useCallback, useEffect } from "react";

// ── Types ────────────────────────────────────────────────

export interface SplitPaneProps {
  readonly left: React.ReactNode;
  readonly right: React.ReactNode;
  readonly rightWidth: number;
  readonly onRightWidthChange: (w: number) => void;
  readonly rightCollapsed: boolean;
  readonly minRightWidth?: number;
  readonly maxRightWidth?: number;
  readonly minLeftWidth?: number;
}

// ── Constants ────────────────────────────────────────────

const DEFAULT_MIN_RIGHT = 320;
const DEFAULT_MAX_RIGHT = 560;
const DEFAULT_MIN_LEFT = 400;
const DIVIDER_WIDTH = 4;

// ── Split Divider (inline sub-component) ─────────────────

interface SplitDividerProps {
  readonly onPointerDown: (e: React.PointerEvent) => void;
  readonly isDragging: boolean;
}

function SplitDivider({ onPointerDown, isDragging }: SplitDividerProps) {
  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat pane"
      tabIndex={0}
      style={{
        width: DIVIDER_WIDTH,
        cursor: "col-resize",
        background: isDragging ? "var(--color-primary)" : "var(--border-subtle)",
        transition: isDragging ? "none" : "background var(--transition-fast)",
        position: "relative",
        flexShrink: 0,
        zIndex: 1,
      }}
    >
      {/* Centered grab indicator -- subtle vertical line */}
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
          opacity: isDragging ? 0.8 : 0.5,
          transition: isDragging ? "none" : "opacity var(--transition-fast), background var(--transition-fast)",
        }}
      />
    </div>
  );
}

// ── SplitPane ────────────────────────────────────────────

export function SplitPane({
  left,
  right,
  rightWidth,
  onRightWidthChange,
  rightCollapsed,
  minRightWidth = DEFAULT_MIN_RIGHT,
  maxRightWidth = DEFAULT_MAX_RIGHT,
  minLeftWidth = DEFAULT_MIN_LEFT,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Visual dragging state -- only updates on drag start/end (not during move)
  const [isDragging, setIsDragging] = useState(false);

  const clampWidth = useCallback(
    (w: number): number => {
      const container = containerRef.current;
      if (!container) return Math.max(minRightWidth, Math.min(maxRightWidth, w));

      const containerWidth = container.getBoundingClientRect().width;
      const maxFromContainer = containerWidth - minLeftWidth - DIVIDER_WIDTH;
      const effectiveMax = Math.min(maxRightWidth, maxFromContainer);

      return Math.max(minRightWidth, Math.min(effectiveMax, w));
    },
    [minRightWidth, maxRightWidth, minLeftWidth],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDraggingRef.current) return;

      // Dragging leftward increases right pane width (divider moves left)
      const deltaX = startXRef.current - e.clientX;
      const newWidth = clampWidth(startWidthRef.current + deltaX);
      onRightWidthChange(newWidth);
    },
    [clampWidth, onRightWidthChange],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      setIsDragging(false);

      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      // Release pointer capture
      (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    },
    [],
  );

  // Attach/detach global pointer listeners
  useEffect(() => {
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      // Clean up body styles in case unmount happens mid-drag
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [handlePointerMove, handlePointerUp]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (rightCollapsed) return;

      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = rightWidth;

      // Prevent text selection during drag
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      // Set pointer capture on the divider for reliable tracking
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [rightCollapsed, rightWidth],
  );

  // Effective right pane width: 0 when collapsed, otherwise controlled value
  const effectiveRightWidth = rightCollapsed ? 0 : rightWidth;

  // Use transition only for collapse/expand, not during drag
  const rightPaneTransition = isDragging
    ? "none"
    : "width var(--transition-normal), opacity var(--transition-normal)";

  return (
    <div
      ref={containerRef}
      className="flex-1 flex min-h-0 min-w-0"
      style={{ position: "relative" }}
    >
      {/* Left pane -- takes all remaining space */}
      <div className="flex-1 flex flex-col min-w-0" style={{ minWidth: minLeftWidth }}>
        {left}
      </div>

      {/* Divider -- only visible when right pane is not collapsed */}
      {!rightCollapsed && (
        <SplitDivider onPointerDown={handlePointerDown} isDragging={isDragging} />
      )}

      {/* Right pane -- collapsible with transition */}
      <aside
        aria-label="Chat pane"
        className="shrink-0 flex flex-col min-h-0"
        style={{
          width: effectiveRightWidth,
          overflow: "hidden",
          transition: rightPaneTransition,
          borderLeft: rightCollapsed ? "none" : "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="h-full flex flex-col min-h-0"
          style={{
            width: rightCollapsed ? 0 : rightWidth,
            opacity: rightCollapsed ? 0 : 1,
            transition: rightPaneTransition,
          }}
        >
          {right}
        </div>
      </aside>
    </div>
  );
}
