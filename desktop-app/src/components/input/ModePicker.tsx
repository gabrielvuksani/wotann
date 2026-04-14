/**
 * Mode selector: Chat, Build, Autopilot, Compare, Review.
 * Accessible segmented control with arrow key navigation (WAI-ARIA radiogroup).
 */

import { useCallback } from "react";
import { useStore } from "../../store";
import type { ChatMode } from "../../types";

const MODES: readonly { id: ChatMode; label: string; desc: string }[] = [
  { id: "chat", label: "Chat", desc: "Conversational mode" },
  { id: "build", label: "Build", desc: "Agent writes code" },
  { id: "autopilot", label: "Autopilot", desc: "Autonomous execution" },
  { id: "compare", label: "Compare", desc: "Side-by-side models" },
  { id: "review", label: "Review", desc: "Multi-model review" },
];

export function ModePicker() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = MODES.findIndex((m) => m.id === mode);
      let nextIndex = currentIndex;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % MODES.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + MODES.length) % MODES.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = MODES.length - 1;
      } else {
        return;
      }

      setMode(MODES[nextIndex]!.id);
    },
    [mode, setMode],
  );

  return (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded-lg"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
      role="radiogroup"
      aria-label="Conversation mode"
      onKeyDown={handleKeyDown}
    >
      {MODES.map((m) => {
        const isActive = mode === m.id;
        return (
          <button
            key={m.id}
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setMode(m.id)}
            className="px-2.5 py-1 text-[11px] rounded-md transition-all"
            style={isActive ? {
              background: "var(--accent-muted)",
              color: "var(--color-primary)",
              border: "1px solid var(--border-focus)",
            } : {
              color: "var(--color-text-muted)",
              border: "1px solid transparent",
            }}
            title={m.desc}
            aria-label={`${m.label}: ${m.desc}`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
