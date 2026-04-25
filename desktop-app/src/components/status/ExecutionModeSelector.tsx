/**
 * T12.19 — ExecutionModeSelector (~110 LOC, V9 §T12.19 desktop UI surface).
 *
 * Compact dropdown that lets the user pick the active execution mode for
 * the current session. The five modes mirror `src/core/execution-modes.ts`
 * exactly (interactive / autopilot / dry-run / review / audit) — duplicating
 * the descriptor table here would drift, so we pin the canonical IDs in
 * code via the EXECUTION_MODE_DESCRIPTORS constant and surface them as
 * label + hint pairs. Switching the mode persists to localStorage and
 * fires a `wotann:execution-mode` window event so other surfaces (chat
 * input affordances, status bar, command palette) can re-render without
 * polling.
 *
 * Why localStorage + window event rather than a Tauri invoke? The daemon
 * does not yet expose an `execution_mode.set` RPC — wiring one would force
 * an extra commit out of scope. The window-event channel mirrors how
 * AppShell.tsx already broadcasts agent-edit events, so future RPC plumbing
 * can subscribe with zero refactor.
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: invalid-mode reads from localStorage are caught
 *     and fall back to "interactive" rather than throwing.
 *   - QB #7  per-call state: component holds local React state; no module
 *     globals. Persistence is via localStorage (DOM-owned) and a custom
 *     event (DOM-owned).
 *   - QB #13 env guard: never reads import.meta.env or process.env. The
 *     mode list is hardcoded to match execution-modes.ts.
 */

import { useState, useEffect, useCallback } from "react";

// Canonical execution mode IDs — must stay in sync with
// src/core/execution-modes.ts EXECUTION_MODE_IDS (5 modes).
type ExecutionMode = "interactive" | "autopilot" | "dry-run" | "review" | "audit";

interface ModeDescriptor {
  readonly id: ExecutionMode;
  readonly label: string;
  readonly hint: string;
}

// Mirrors src/core/execution-modes.ts EXECUTION_MODES — kept narrow
// (label+hint only) since the desktop UI surfaces these two fields.
const EXECUTION_MODE_DESCRIPTORS: readonly ModeDescriptor[] = [
  { id: "interactive", label: "Interactive", hint: "Approve each step" },
  { id: "autopilot", label: "Autopilot", hint: "Run free, log all" },
  { id: "dry-run", label: "Dry-run", hint: "Plan only" },
  { id: "review", label: "Review", hint: "Propose, human merges" },
  { id: "audit", label: "Audit", hint: "Read-only trace" },
];

const STORAGE_KEY = "wotann-execution-mode";
const EVENT_NAME = "wotann:execution-mode";

function isExecutionMode(value: string): value is ExecutionMode {
  return EXECUTION_MODE_DESCRIPTORS.some((d) => d.id === value);
}

function readPersistedMode(): ExecutionMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isExecutionMode(raw)) return raw;
  } catch {
    // localStorage may be disabled in private mode; fall through.
  }
  return "interactive";
}

export function ExecutionModeSelector() {
  const [mode, setMode] = useState<ExecutionMode>(() => readPersistedMode());

  // Keep instances in sync — if another surface dispatches the event,
  // reflect the change here too.
  useEffect(() => {
    function onExternalChange(evt: Event) {
      const detail = (evt as CustomEvent<{ readonly mode: string }>).detail;
      if (detail && isExecutionMode(detail.mode) && detail.mode !== mode) {
        setMode(detail.mode);
      }
    }
    window.addEventListener(EVENT_NAME, onExternalChange);
    return () => window.removeEventListener(EVENT_NAME, onExternalChange);
  }, [mode]);

  const onChange = useCallback((next: ExecutionMode) => {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence best-effort — UI stays correct even if storage fails.
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { mode: next } }));
  }, []);

  const current = EXECUTION_MODE_DESCRIPTORS.find((d) => d.id === mode) ?? EXECUTION_MODE_DESCRIPTORS[0]!;

  return (
    <label
      className="execution-mode-selector"
      title={`Execution mode: ${current.label} — ${current.hint}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--font-size-detail, 11px)",
        color: "var(--color-text-dim, #888)",
      }}
    >
      <span style={{ opacity: 0.7 }}>mode:</span>
      <select
        value={mode}
        onChange={(e) => {
          const next = e.target.value;
          if (isExecutionMode(next)) onChange(next);
        }}
        aria-label="Execution mode"
        style={{
          background: "transparent",
          color: "inherit",
          border: "none",
          font: "inherit",
          cursor: "pointer",
          padding: "2px 4px",
        }}
      >
        {EXECUTION_MODE_DESCRIPTORS.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}
