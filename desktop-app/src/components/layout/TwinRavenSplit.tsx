/**
 * TwinRavenSplit — V9 T14.4 motif #1.
 *
 * A side-by-side dual-pane that splits the main chat into Huginn (thought)
 * and Muninn (memory). Triggered by the Cmd+Shift+2 keybinding registered
 * elsewhere in the app; this component just renders the surface when the
 * caller mounts it.
 *
 * Pane convention (from V9 T14.4 spec):
 *   - Left pane  = Huginn = thought = current task / live conversation.
 *   - Right pane = Muninn = memory  = recall context, hits, related sessions.
 *
 * Shape:
 *   - Two equally-weighted flex panes with a 4px draggable splitter.
 *   - Each pane has a small SVG raven icon at the top-left labelled with
 *     its name. The label is muted, lowercase metadata-style — it signals
 *     identity without competing with the content.
 *
 * The component is layout-only — the parent supplies the actual `left`
 * and `right` React content.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";
import "../../styles/norse-motifs.css";

// ── Constants ────────────────────────────────────────────

const DEFAULT_INITIAL_RATIO = 0.5;
const MIN_PANE_PCT = 0.20;
const MAX_PANE_PCT = 0.80;

// ── Types ────────────────────────────────────────────────

export interface TwinRavenSplitProps {
  /** Content for the Huginn (thought / current task) pane. */
  readonly left: ReactNode;
  /** Content for the Muninn (memory / recall) pane. */
  readonly right: ReactNode;
  /** Optional initial split ratio for the left pane (0..1). Defaults to 0.5. */
  readonly initialRatio?: number;
  /** Optional notification when the user finishes dragging the splitter. */
  readonly onRatioChange?: (ratio: number) => void;
  /** Optional override for the Huginn label. Defaults to "Huginn — thought". */
  readonly huginnLabel?: string;
  /** Optional override for the Muninn label. Defaults to "Muninn — memory". */
  readonly muninnLabel?: string;
  /** Optional className to merge into the root element. */
  readonly className?: string;
  /** Optional inline style overrides for the root element. */
  readonly style?: CSSProperties;
}

// ── Raven SVG ─────────────────────────────────────────────

/** Small raven silhouette. Inline SVG — no external assets. */
function RavenIcon(): JSX.Element {
  return (
    <svg
      className="twin-raven-split__raven-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* Stylised raven silhouette: body + beak + wing crest. */}
      <path d="M3.5 12.4 c0.6-2.7 2.6-4.4 5.1-4.7 c1.8-0.2 3.4 0.4 4.7 1.4 l3.4-2.4 l-1.0 2.6 l3.7 0.7 l-2.7 1.6 c0.5 1.0 0.7 2.1 0.5 3.2 c-0.4 2.1-2.0 3.6-4.1 4.0 c-2.4 0.5-4.9-0.4-6.3-2.0 l-2.0 1.4 l0.4-2.6 c-1.0-0.7-1.6-1.7-1.7-3.2 z" />
      <circle cx="13.6" cy="11.0" r="0.55" fill="var(--wotann-bg-canvas, #07090f)" />
    </svg>
  );
}

// ── Pane Header ───────────────────────────────────────────

interface PaneHeaderProps {
  readonly name: string;
  readonly subtitle: string;
}

function PaneHeader({ name, subtitle }: PaneHeaderProps): JSX.Element {
  return (
    <div className="twin-raven-split__label" role="banner">
      <RavenIcon />
      <span className="twin-raven-split__label-name">{name}</span>
      <span aria-hidden="true" style={{ opacity: 0.5 }}>
        —
      </span>
      <span style={{ opacity: 0.7 }}>{subtitle}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────

export function TwinRavenSplit({
  left,
  right,
  initialRatio = DEFAULT_INITIAL_RATIO,
  onRatioChange,
  huginnLabel = "Huginn — thought",
  muninnLabel = "Muninn — memory",
  className,
  style,
}: TwinRavenSplitProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Clamp the initial ratio so we never start out of bounds.
  const clamp = (r: number): number => Math.max(MIN_PANE_PCT, Math.min(MAX_PANE_PCT, r));

  const [ratio, setRatio] = useState<number>(clamp(initialRatio));
  const [isDragging, setIsDragging] = useState(false);

  // Parse the label into "Name — subtitle" pairs so we can render each
  // half with its own emphasis. Using an em dash as the separator is a
  // deliberate choice — a hyphen would crowd the metadata.
  const splitLabel = (raw: string): { name: string; subtitle: string } => {
    const parts = raw.split(/—|--/);
    if (parts.length >= 2) {
      const [first, ...rest] = parts;
      return {
        name: (first ?? "").trim(),
        subtitle: rest.join("—").trim(),
      };
    }
    return { name: raw.trim(), subtitle: "" };
  };

  const huginn = splitLabel(huginnLabel);
  const muninn = splitLabel(muninnLabel);

  // Measure the container width once per drag start so we can convert
  // pointer x-deltas to percentage changes on the leading pane.
  const dragStateRef = useRef<{ startX: number; startRatio: number; width: number }>({
    startX: 0,
    startRatio: ratio,
    width: 1,
  });

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    const { startX, startRatio, width } = dragStateRef.current;
    if (width <= 0) return;
    const delta = (e.clientX - startX) / width;
    const next = clamp(startRatio + delta);
    setRatio(next);
  }, []);

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try {
        (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
      } catch {
        // releasePointerCapture is best-effort — ignore failures.
      }
      onRatioChange?.(ratio);
    },
    [onRatioChange, ratio],
  );

  useEffect(() => {
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      // Defensive cleanup if we unmount mid-drag.
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [handlePointerMove, handlePointerUp]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      dragStateRef.current = {
        startX: e.clientX,
        startRatio: ratio,
        width: rect.width || 1,
      };
      draggingRef.current = true;
      setIsDragging(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture occasionally throws on synthetic events.
      }
    },
    [ratio],
  );

  // Keyboard a11y for the splitter — left/right arrows nudge by 2%.
  const handleSplitterKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const STEP = 0.02;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = clamp(ratio + (e.key === "ArrowRight" ? STEP : -STEP));
        setRatio(next);
        onRatioChange?.(next);
      }
    },
    [ratio, onRatioChange],
  );

  const leftFlex: CSSProperties = { flex: `${ratio} 1 0` };
  const rightFlex: CSSProperties = { flex: `${1 - ratio} 1 0` };

  return (
    <div
      ref={containerRef}
      className={`twin-raven-split${className ? ` ${className}` : ""}`}
      style={style}
      data-testid="twin-raven-split"
      role="group"
      aria-label="Twin raven split — Huginn and Muninn"
    >
      <section
        className="twin-raven-split__pane twin-raven-split__pane--huginn"
        aria-label={huginnLabel}
        style={leftFlex}
      >
        <PaneHeader name={huginn.name} subtitle={huginn.subtitle} />
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{left}</div>
      </section>
      <div
        className="twin-raven-split__divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Huginn / Muninn split"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(MIN_PANE_PCT * 100)}
        aria-valuemax={Math.round(MAX_PANE_PCT * 100)}
        tabIndex={0}
        data-dragging={isDragging ? "true" : "false"}
        onPointerDown={handlePointerDown}
        onKeyDown={handleSplitterKey}
      />
      <section
        className="twin-raven-split__pane twin-raven-split__pane--muninn"
        aria-label={muninnLabel}
        style={rightFlex}
      >
        <PaneHeader name={muninn.name} subtitle={muninn.subtitle} />
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{right}</div>
      </section>
    </div>
  );
}

