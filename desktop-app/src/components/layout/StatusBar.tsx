/**
 * Bottom status bar — VS Code-inspired, information-rich.
 *
 * Layout (left to right):
 * - Connection dot (5px, green glow when connected, red when not)
 * - Model name (clickable, hover underline)
 * - Mode label
 * - Context progress bar (48x3, color-coded by usage)
 * - Worker count (pulsing when active)
 * - Spacer
 * - Session cost (monospace)
 * - Today cost (monospace, color-coded)
 * - Compare button / Exploit Active label
 *
 * When exploit mode is active the entire bar gets a subtle red tint.
 * All colors via CSS variables. 8pt grid spacing.
 */

import { useState, useEffect, useMemo } from "react";
import { useStore } from "../../store";
import { WORKSPACE_PRESETS } from "../../lib/workspace-presets";

function getCostColor(cost: number): string {
  if (cost >= 5) return "var(--color-error)";
  if (cost >= 1) return "var(--color-warning)";
  return "var(--color-connected)";
}

function getContextColorClass(percent: number): string {
  if (percent > 80) return "statusbar-context--danger";
  if (percent > 60) return "statusbar-context--warn";
  return "statusbar-context--ok";
}

export function StatusBar() {
  const engineConnected = useStore((s) => s.engineConnected);
  const openOverlay = useStore((s) => s.openOverlay);
  const model = useStore((s) => s.model);
  const mode = useStore((s) => s.mode);
  const contextPercent = useStore((s) => s.contextPercent);
  const cost = useStore((s) => s.cost);
  const agents = useStore((s) => s.agents);
  const setView = useStore((s) => s.setView);

  const toggleContextPanel = useStore((s) => s.toggleContextPanel);
  const toggleWorkerDrawer = useStore((s) => s.toggleWorkerDrawer);
  const setMode = useStore((s) => s.setMode);
  const provider = useStore((s) => s.provider);
  const workspacePreset = useStore((s) => s.settings.workspacePreset);
  const exploitFindings = useStore((s) => s.exploitFindings);
  const runningAgents = agents.filter((a) => a.status === "running").length;
  const contextColorClass = getContextColorClass(contextPercent);

  // Workspace preset extras — additional status items per persona
  const presetExtras = useMemo(() => {
    const preset = WORKSPACE_PRESETS[workspacePreset];
    if (!preset?.statusBarExtras) return [];
    return preset.statusBarExtras;
  }, [workspacePreset]);

  // Git branch — polled alongside other status
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function loadGit() {
      try {
        const { getGitStatus } = await import("../../store/engine");
        const status = await getGitStatus();
        if (!cancelled && status?.isRepo && status.branch) {
          setGitBranch(status.branch);
        }
      } catch { /* not available */ }
    }
    loadGit();
    const interval = setInterval(loadGit, 30000); // refresh every 30s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <footer
      className="statusbar"
      role="contentinfo"
      aria-label="Status bar"
    >
      {/* Connection dot — tooltip on hover, click toggles context panel for details */}
      <button
        className="statusbar-connection"
        role="status"
        onClick={toggleContextPanel}
        title={engineConnected
          ? `Engine connected${provider ? ` via ${provider}` : ""}. Click to view context panel.`
          : "Engine disconnected. Click to view context panel."
        }
        aria-label={engineConnected ? "Connected to engine. Click to view details." : "Disconnected from engine. Click for details."}
        style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}
      >
        <span
          className={`statusbar-dot ${engineConnected ? "statusbar-dot--connected" : "statusbar-dot--disconnected"}`}
          aria-hidden="true"
        />
      </button>

      {/* Git branch — shown when in a git repo */}
      {gitBranch && (
        <>
          <span style={{ fontSize: "var(--font-size-detail)", color: "var(--color-text-dim)", display: "flex", alignItems: "center", gap: 3 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="11" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 6v4c0 1.1.9 2 2 2h4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {gitBranch}
          </span>
          <span className="statusbar-separator">&middot;</span>
        </>
      )}

      {/* Model name -- clickable with hover underline */}
      <button
        className="statusbar-model-btn"
        aria-label={`Current model: ${model || "No model"}. Click to switch.`}
        onClick={() => openOverlay("modelPicker")}
      >
        {model || "No model"}
      </button>

      <span className="statusbar-separator">&middot;</span>

      {/* Mode — clickable to cycle through modes */}
      <button
        className="statusbar-mode"
        onClick={() => {
          const modes = ["chat", "build", "review", "autopilot"] as const;
          const idx = modes.indexOf(mode as typeof modes[number]);
          const next = modes[(idx + 1) % modes.length]!;
          setMode(next);
        }}
        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
        title={`Current mode: ${mode}. Click to cycle modes.`}
        aria-label={`Current mode: ${mode}. Click to cycle modes.`}
      >
        {mode}
      </button>

      <span className="statusbar-separator">&middot;</span>

      {/* Context bar — clickable to toggle context panel */}
      <button
        className="statusbar-context"
        role="meter"
        aria-label={`Context usage: ${Math.round(contextPercent)}%. Click to toggle context panel.`}
        aria-valuenow={contextPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        onClick={toggleContextPanel}
        style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <span className="statusbar-context-track" aria-hidden="true">
          <span
            className={`statusbar-context-fill ${contextColorClass}`}
            style={{ width: `${Math.min(contextPercent, 100)}%` }}
          />
        </span>
        <span className={`statusbar-context-label ${contextColorClass}`}>
          {Math.round(contextPercent)}%
        </span>
      </button>

      {/* Workers -- clickable, toggles worker drawer */}
      {runningAgents > 0 && (
        <button
          onClick={toggleWorkerDrawer}
          className="statusbar-workers statusbar-workers--active"
        >
          {runningAgents} worker{runningAgents > 1 ? "s" : ""}
        </button>
      )}

      {/* Workspace preset extras — contextual status per persona */}
      {presetExtras.includes("findings-count") && exploitFindings.length > 0 && (
        <>
          <span className="statusbar-separator">&middot;</span>
          <span style={{ color: "var(--red)" }}>{exploitFindings.length} finding{exploitFindings.length !== 1 ? "s" : ""}</span>
        </>
      )}
      {presetExtras.includes("active-tasks") && agents.length > 0 && (
        <>
          <span className="statusbar-separator">&middot;</span>
          <span>{agents.length} task{agents.length !== 1 ? "s" : ""}</span>
        </>
      )}

      {/* Spacer */}
      <div className="statusbar-spacer" />

      {/* Session cost */}
      <span className="statusbar-cost">
        Session: <span className="statusbar-cost-value">${cost.sessionCost.toFixed(2)}</span>
      </span>

      <span className="statusbar-separator">&middot;</span>

      {/* Today cost -- clickable to go to Cost Dashboard */}
      <button
        onClick={() => setView("cost")}
        className="statusbar-cost-btn"
        style={{ color: getCostColor(cost.todayCost) }}
      >
        Today: <span className="statusbar-cost-value">${cost.todayCost.toFixed(2)}</span>
      </button>

    </footer>
  );
}
