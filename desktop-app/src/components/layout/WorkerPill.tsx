/**
 * Worker Pill — ambient floating indicator at the bottom of the sidebar.
 * Shows active worker count + cost. Clicking opens a drawer/popover with full worker details.
 * This IS the workshop entry point — replaces the dedicated Workshop view tab.
 */

import { useRef, useEffect, useCallback } from "react";
import { useStore } from "../../store";
import { color } from "../../design/tokens.generated";

/** Compact pill at the sidebar bottom. */
export function WorkerPill() {
  const agents = useStore((s) => s.agents);
  const cost = useStore((s) => s.cost);
  const workerDrawerOpen = useStore((s) => s.workerDrawerOpen);
  const toggleWorkerDrawer = useStore((s) => s.toggleWorkerDrawer);
  const runningAgents = agents.filter((a) => a.status === "running");
  const totalWorkerCost = agents.reduce((sum, a) => sum + a.cost, 0);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close drawer on click outside
  useEffect(() => {
    if (!workerDrawerOpen) return;
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        toggleWorkerDrawer();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") toggleWorkerDrawer();
    }
    // Delay to avoid immediate close from the click that opened it
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClick);
      window.addEventListener("keydown", handleEscape);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [workerDrawerOpen, toggleWorkerDrawer]);

  const handleKillWorker = useCallback((agentId: string) => {
    useStore.getState().removeAgent(agentId);
  }, []);

  // Hidden when no agents and drawer is closed
  if (agents.length === 0 && !workerDrawerOpen) {
    return (
      <div className="shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.012)", padding: "3px 6px 6px", position: "relative", zIndex: 1 }}>
        <div
          className="flex items-center justify-center gap-2"
          style={{
            padding: "4px 8px",
            background: "rgba(255,255,255,0.006)",
            border: "1px solid rgba(255,255,255,0.015)",
            borderRadius: 5,
            fontSize: 7,
            color: "var(--color-text-dim)",
          }}
        >
          <span style={{ color: "var(--color-text-ghost)" }}>No workers</span>
          <span style={{ color: "var(--color-text-invisible)" }}>|</span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-invisible)" }}>
            ${cost.todayCost.toFixed(2)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 relative" ref={drawerRef}>
      {/* Expanded drawer — pops up above the pill */}
      {workerDrawerOpen && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 animate-slideUp"
          style={{
            background: "var(--color-bg-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            maxHeight: 320,
            overflow: "hidden",
            zIndex: 20,
          }}
          role="dialog"
          aria-label="Worker details"
        >
          {/* Drawer header */}
          <div
            className="flex items-center justify-between"
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
              }}
            >
              Workers ({agents.length})
            </span>
            <button
              onClick={toggleWorkerDrawer}
              className="header-icon-btn"
              aria-label="Close worker drawer"
              style={{ padding: 2 }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 12l8-8M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Worker list */}
          <div className="overflow-y-auto" style={{ maxHeight: 260 }} role="list" aria-label="Active workers">
            {agents.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                No active workers
              </div>
            ) : (
              agents.map((agent) => (
                <div
                  key={agent.id}
                  role="listitem"
                  className="flex flex-col gap-1.5"
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${agent.status === "running" ? "animate-pulse" : ""}`}
                      style={{
                        background: agent.status === "running"
                          ? "var(--blue)"
                          : agent.status === "completed"
                            ? "var(--green)"
                            : agent.status === "error"
                              ? "var(--red)"
                              : "var(--color-text-dim)",
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="flex-1 truncate"
                      style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--color-text-primary)" }}
                    >
                      {agent.name}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--font-size-2xs)",
                        color: "var(--color-text-dim)",
                        fontFamily: "var(--font-mono)",
                        padding: "1px 6px",
                        background: "var(--surface-2)",
                        borderRadius: "var(--radius-xs)",
                      }}
                    >
                      {agent.model}
                    </span>
                  </div>

                  <p className="truncate" style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", paddingLeft: 16 }}>
                    {agent.task}
                  </p>

                  {agent.status === "running" && (
                    <div className="flex items-center gap-2" style={{ paddingLeft: 16 }}>
                      <div
                        className="flex-1 h-1 rounded-full overflow-hidden"
                        style={{ background: "var(--surface-3)" }}
                        role="progressbar"
                        aria-valuenow={agent.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ background: "var(--blue)", width: `${agent.progress}%`, transition: "width 300ms ease" }}
                        />
                      </div>
                      <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
                        {agent.progress}%
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between" style={{ paddingLeft: 16 }}>
                    <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
                      ${agent.cost.toFixed(4)}
                    </span>
                    {agent.status === "running" && (
                      <button
                        onClick={() => handleKillWorker(agent.id)}
                        style={{
                          fontSize: "var(--font-size-2xs)",
                          color: "var(--red)",
                          background: "rgba(248, 113, 113, 0.1)",
                          border: "none",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-xs)",
                          cursor: "pointer",
                        }}
                        aria-label={`Kill worker ${agent.name}`}
                      >
                        Kill
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Cost summary */}
          <div
            className="flex items-center justify-between"
            style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--border-subtle)",
              background: "var(--surface-1)",
              fontSize: "var(--font-size-2xs)",
              color: "var(--color-text-dim)",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span>Worker cost: ${totalWorkerCost.toFixed(4)}</span>
            <span>Today: ${cost.todayCost.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* The pill itself — mockup-compact */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.012)", padding: "3px 6px 6px", position: "relative", zIndex: 1 }}>
        <button
          onClick={toggleWorkerDrawer}
          className="w-full flex items-center justify-center gap-1.5 btn-press"
          style={{
            padding: "4px 8px",
            borderRadius: 5,
            background: "rgba(255,255,255,0.006)",
            border: "1px solid rgba(255,255,255,0.015)",
            cursor: "pointer",
          }}
          aria-label={`${agents.length} workers. Click to view details.`}
          aria-expanded={workerDrawerOpen}
        >
          {/* Status dots — tiny 3px */}
          <div className="flex items-center gap-0.5">
            {runningAgents.slice(0, 5).map((a) => (
              <span
                key={a.id}
                className="rounded-full animate-pulse"
                style={{ width: 3, height: 3, background: color("info"), boxShadow: "0 0 2px rgba(56,189,248,0.25)" }}
                aria-hidden="true"
              />
            ))}
            {agents.filter((a) => a.status === "completed").length > 0 && (
              <span
                className="rounded-full"
                style={{ width: 3, height: 3, background: color("success"), boxShadow: "0 0 2px rgba(74,222,128,0.25)" }}
                aria-hidden="true"
              />
            )}
          </div>

          <span style={{ fontSize: 7, fontWeight: 500, color: "var(--color-text-dim)", flex: 1 }}>
            {agents.length} worker{agents.length !== 1 ? "s" : ""}
          </span>

          <span style={{ fontSize: 6, color: "var(--color-text-invisible)", fontFamily: "var(--font-mono)" }}>
            ${totalWorkerCost.toFixed(3)}
          </span>
        </button>
      </div>
    </div>
  );
}
