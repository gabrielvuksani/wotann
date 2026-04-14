/**
 * Horizontal phase stepper for the PWR development cycle.
 *
 * Renders 6 phase badges connected by lines. Current phase
 * is highlighted, completed phases show checkmarks, and
 * the next phase is clickable to advance.
 */

import { useCallback } from "react";

// ── Types ─────────────────────────────────────────────

interface PWRStepperProps {
  readonly currentPhase: string;
  readonly phases: readonly string[];
  readonly onAdvance?: (nextPhase: string) => void;
}

type PhaseState = "completed" | "current" | "future";

// ── Helpers ───────────────────────────────────────────

function getPhaseState(
  phaseIndex: number,
  currentIndex: number,
): PhaseState {
  if (phaseIndex < currentIndex) return "completed";
  if (phaseIndex === currentIndex) return "current";
  return "future";
}

function phaseStyles(state: PhaseState): {
  readonly bg: string;
  readonly border: string;
  readonly text: string;
  readonly connector: string;
} {
  switch (state) {
    case "completed":
      return {
        bg: "var(--color-success-muted)",
        border: "var(--color-success)",
        text: "var(--color-success)",
        connector: "var(--color-success)",
      };
    case "current":
      return {
        bg: "rgba(10, 132, 255, 0.15)",
        border: "var(--accent)",
        text: "var(--color-text-primary)",
        connector: "var(--border-subtle)",
      };
    case "future":
      return {
        bg: "transparent",
        border: "var(--border-subtle)",
        text: "var(--color-text-dim)",
        connector: "var(--border-subtle)",
      };
  }
}

// ── Checkmark SVG ─────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5l3.5 3.5L13 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────

export function PWRStepper({ currentPhase, phases, onAdvance }: PWRStepperProps) {
  const currentIndex = phases.indexOf(currentPhase);
  const resolvedIndex = currentIndex === -1 ? 0 : currentIndex;

  const handleAdvance = useCallback(
    (phaseIndex: number) => {
      if (!onAdvance) return;
      if (phaseIndex !== resolvedIndex + 1) return;
      const nextPhase = phases[phaseIndex];
      if (nextPhase) {
        onAdvance(nextPhase);
      }
    },
    [onAdvance, resolvedIndex, phases],
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        width: "100%",
        overflowX: "auto",
      }}
      role="list"
      aria-label="PWR development phases"
    >
      {phases.map((phase, index) => {
        const state = getPhaseState(index, resolvedIndex);
        const styles = phaseStyles(state);
        const isNext = index === resolvedIndex + 1;
        const isLast = index === phases.length - 1;

        return (
          <div
            key={phase}
            style={{
              display: "flex",
              alignItems: "center",
              flex: 1,
              minWidth: 0,
            }}
            role="listitem"
          >
            {/* Phase badge */}
            <button
              onClick={() => handleAdvance(index)}
              disabled={!isNext || !onAdvance}
              className={isNext && onAdvance ? "btn-press" : ""}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${styles.border}`,
                background: styles.bg,
                color: styles.text,
                fontSize: "var(--font-size-2xs)",
                fontWeight: state === "current" ? 600 : 400,
                cursor: isNext && onAdvance ? "pointer" : "default",
                whiteSpace: "nowrap",
                minWidth: 0,
                opacity: state === "future" && !isNext ? 0.5 : 1,
                transition: "all 0.2s ease",
              }}
              aria-label={`${phase} — ${state}`}
              aria-current={state === "current" ? "step" : undefined}
              title={isNext && onAdvance ? `Advance to ${phase}` : phase}
            >
              {state === "completed" && <CheckIcon />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {phase}
              </span>
            </button>

            {/* Connector line */}
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  minWidth: 8,
                  background: styles.connector,
                  transition: "background 0.2s ease",
                }}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
