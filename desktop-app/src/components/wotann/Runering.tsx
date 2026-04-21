/**
 * Runering — signature WOTANN feedback glyph that fires when memory is saved.
 *
 * Design spec §4.1 (UI_DESIGN_SPEC_2026-04-16): on `mem_save`, an Elder Futhark
 * glyph (Ansuz for decisions, Raidho for patterns, Kenaz for discoveries,
 * Naudhiz for blockers) appears at the top-right of the active panel. A 1px
 * gold stroke traces a full 360° circle around it in 480ms `cubic-bezier(0.65,
 * 0, 0.35, 1)`, the glyph pulses once (scale 1→1.08→1, opacity 1→0.6 over
 * 280ms), then both fade over 600ms.
 *
 * This component subscribes to the global `wotann:rune-event` window event
 * — any code path that wants to emit the ritual dispatches a `CustomEvent`
 * with `detail: { kind, message? }`. Multiple events queue so bursts stay
 * visible rather than overwriting.
 */

import { useEffect, useState, useRef, useId, type JSX } from "react";
import { color as tokenColor } from "../../design/tokens.generated";

/** Rune kinds mapped to Elder Futhark glyphs + semantic names. */
export type RuneKind = "decision" | "pattern" | "discovery" | "blocker" | "case" | "feedback" | "reference" | "project";

const RUNE_GLYPH: Record<RuneKind, string> = {
  decision: "ᚨ",    // Ansuz — the messenger / wisdom
  pattern: "ᚱ",     // Raidho — journey / process
  discovery: "ᚲ",   // Kenaz — flame / insight
  blocker: "ᚾ",     // Naudhiz — need / constraint
  case: "ᛉ",        // Algiz — protection (post-debug)
  feedback: "ᚹ",    // Wunjo — joy / validation
  reference: "ᛟ",   // Othala — inheritance / pointers
  project: "ᚦ",     // Thurisaz — giant / undertaking
};

const RUNE_COLOR: Record<RuneKind, string> = {
  decision: tokenColor("warning"),
  pattern: tokenColor("toolMessage"),
  discovery: tokenColor("warning"),
  blocker: tokenColor("error"),
  case: tokenColor("success"),
  feedback: tokenColor("warning"),
  reference: tokenColor("toolMessage"),
  project: tokenColor("warning"),
};

interface RuneEvent {
  readonly id: string;
  readonly kind: RuneKind;
  readonly message?: string;
  readonly spawnedAt: number;
}

/** Global dispatcher — call this from anywhere in the app to trigger the ritual. */
export function emitRuneEvent(kind: RuneKind, message?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("wotann:rune-event", { detail: { kind, message } }));
}

/** Total lifetime of one rune in ms — circle (480) + pulse (280) + fade (600). */
const RUNE_LIFETIME_MS = 1360;

export function Runering(): JSX.Element | null {
  const [events, setEvents] = useState<readonly RuneEvent[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    injectRuneringKeyframes();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: RuneKind; message?: string }>).detail;
      if (!detail || !RUNE_GLYPH[detail.kind]) return;
      const id = `rune-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const event: RuneEvent = {
        id,
        kind: detail.kind,
        message: detail.message,
        spawnedAt: Date.now(),
      };
      setEvents((prev) => [...prev, event]);
      const timer = setTimeout(() => {
        setEvents((prev) => prev.filter((e) => e.id !== id));
        timersRef.current.delete(id);
      }, RUNE_LIFETIME_MS);
      timersRef.current.set(id, timer);
    };
    window.addEventListener("wotann:rune-event", handler);
    return () => {
      window.removeEventListener("wotann:rune-event", handler);
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  if (events.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Memory saved"
      style={{
        position: "fixed",
        top: 52,
        right: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 12,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {events.map((e, idx) => (
        <SingleRune key={e.id} event={e} stackIndex={idx} />
      ))}
    </div>
  );
}

function SingleRune({ event, stackIndex }: { event: RuneEvent; stackIndex: number }): JSX.Element {
  const titleId = useId();
  const color = RUNE_COLOR[event.kind];
  const glyph = RUNE_GLYPH[event.kind];

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        animation: "wotann-rune-fade 1360ms cubic-bezier(0.65, 0, 0.35, 1) forwards",
        animationDelay: `${stackIndex * 60}ms`,
      }}
      role="status"
      aria-labelledby={titleId}
    >
      {/* 1px gold stroke tracing a 360° circle around the glyph */}
      <svg
        width={36}
        height={36}
        viewBox="0 0 36 36"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke={color}
          strokeWidth="1"
          strokeDasharray="101"
          strokeDashoffset="101"
          style={{
            animation: "wotann-rune-trace 480ms cubic-bezier(0.65, 0, 0.35, 1) forwards",
            transformOrigin: "center",
            transform: "rotate(-90deg)",
          }}
        />
      </svg>
      {/* The rune glyph itself — pulses once after the circle completes */}
      <span
        id={titleId}
        style={{
          position: "relative",
          fontFamily: "var(--wotann-font-rune, 'Noto Sans Runic', system-ui)",
          fontSize: 20,
          lineHeight: 1,
          color,
          width: 36,
          height: 36,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          animation: "wotann-rune-pulse 280ms cubic-bezier(0.34, 1.56, 0.64, 1) 480ms both",
        }}
      >
        {glyph}
      </span>
      {event.message && (
        <span
          style={{
            fontSize: 12,
            color: tokenColor("muted"),
            fontWeight: 500,
            whiteSpace: "nowrap",
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {event.message}
        </span>
      )}
    </div>
  );
}

const KEYFRAMES_ID = "wotann-runering-keyframes";

export function injectRuneringKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `
@keyframes wotann-rune-trace {
  from { stroke-dashoffset: 101; }
  to { stroke-dashoffset: 0; }
}

@keyframes wotann-rune-pulse {
  0%   { transform: scale(1); opacity: 1; }
  50%  { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 0.6; }
}

@keyframes wotann-rune-fade {
  0%, 55%  { opacity: 1; transform: translateX(0); }
  100%     { opacity: 0; transform: translateX(8px); }
}

@media (prefers-reduced-motion: reduce) {
  @keyframes wotann-rune-trace { from, to { stroke-dashoffset: 0; } }
  @keyframes wotann-rune-pulse { 0%, 100% { transform: scale(1); opacity: 1; } }
  @keyframes wotann-rune-fade  { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
}
`;
  document.head.appendChild(style);
}
