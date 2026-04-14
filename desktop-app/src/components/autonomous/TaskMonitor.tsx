/**
 * Task Monitor — autonomous task progress with proof bundles.
 * Shows running/completed/failed tasks with real-time progress.
 * Reads agent data from the Zustand store (polled via refreshAgents).
 */

import type React from "react";
import { useState, useMemo, useEffect } from "react";
import { useStore } from "../../store";
import type { AgentInfo } from "../../types";
import { ProofViewer } from "./ProofViewer";

export function TaskMonitor() {
  const agents = useStore((s) => s.agents);
  const [filter, setFilter] = useState<"all" | "running" | "idle" | "completed" | "error">("all");

  const filtered = useMemo(() => {
    if (filter === "all") return agents;
    return agents.filter((a) => a.status === filter);
  }, [agents, filter]);

  return (
    <div className="h-full overflow-y-auto" style={{ padding: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--color-text-primary)" }}>Active Tasks</h2>
        <div className="flex" style={{ gap: 4 }}>
          {(["all", "running", "completed", "error"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-label={`Filter tasks: ${f}`}
              aria-pressed={filter === f}
              style={{
                padding: "4px 8px",
                fontSize: "var(--font-size-xs)",
                borderRadius: "var(--radius-lg)",
                border: "none",
                cursor: "pointer",
                transition: "all 150ms ease",
                ...(filter === f
                  ? { background: "var(--accent)", color: "white" }
                  : { background: "var(--surface-3)", color: "var(--color-text-secondary)" }),
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 rounded-xl border flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
              <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 7h6M5 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {filter === "all" ? "No active tasks" : `No ${filter} tasks`}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            Tasks appear here when agents are running in autopilot mode
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((agent) => (
            <TaskCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { readonly status: string }) {
  switch (status) {
    case "running":
      return <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" fill="var(--info)" className="animate-pulse" /></svg>;
    case "completed":
      return <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="var(--color-success)" strokeWidth="1.5" /><path d="M3 5l1.5 1.5L7 4" stroke="var(--color-success)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "error":
      return <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="var(--color-error)" strokeWidth="1.5" /><path d="M3.5 3.5l3 3M6.5 3.5l-3 3" stroke="var(--color-error)" strokeWidth="1.2" strokeLinecap="round" /></svg>;
    default:
      return <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="var(--color-warning)" strokeWidth="1.5" /><path d="M4 4v2M6 4v2" stroke="var(--color-warning)" strokeWidth="1.2" strokeLinecap="round" /></svg>;
  }
}

function TaskCard({ agent }: { readonly agent: AgentInfo }) {
  const [showProof, setShowProof] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [proofData, setProofData] = useState<any>(null);
  const duration = (Date.now() - agent.startedAt) / 1000;

  // Fetch real proof data from daemon when proof viewer is opened
  useEffect(() => {
    if (!showProof || proofData) return;
    let cancelled = false;
    async function fetchProof() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<Record<string, unknown>>("get_agent_proof", { taskId: agent.id });
        if (!cancelled && result) setProofData(result);
      } catch { /* daemon unavailable or no proof data */ }
    }
    fetchProof();
    return () => { cancelled = true; };
  }, [showProof, proofData, agent.id]);
  const statusColorStyle: React.CSSProperties = {
    running: { color: "var(--info)" },
    completed: { color: "var(--color-success)" },
    error: { color: "var(--color-error)" },
    idle: { color: "var(--color-warning)" },
  }[agent.status];

  const statusLabel = {
    running: "Running",
    completed: "Completed",
    error: "Failed",
    idle: "Idle",
  }[agent.status];

  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }} role="article" aria-label={`Task: ${agent.task || agent.name}, status: ${agent.status}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{agent.task || agent.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="flex items-center gap-1 text-xs font-medium" style={statusColorStyle}>
              <StatusIcon status={agent.status} /> {statusLabel}
            </span>
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{agent.model}</span>
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>${agent.cost.toFixed(3)}</span>
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{Math.floor(duration)}s</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agent.status === "completed" && (
            <button
              onClick={() => setShowProof(!showProof)}
              className="btn-press"
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-success-muted)",
                color: "var(--color-success)",
                border: "none",
                fontSize: "var(--font-size-2xs)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {showProof ? "Hide Proof" : "View Proof"}
            </button>
          )}
          {agent.status === "running" && (
            <button
              onClick={() => {
                // Kill is handled by the agent store
                useStore.getState().removeAgent(agent.id);
              }}
              className="btn-press"
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-error-muted)",
                color: "var(--color-error)",
                border: "none",
                fontSize: "var(--font-size-2xs)",
                fontWeight: 600,
                cursor: "pointer",
              }}
              aria-label={`Kill task: ${agent.task || agent.name}`}
            >
              Kill
            </button>
          )}
          <span className="text-sm font-mono" style={{ color: "var(--color-text-secondary)" }}>{agent.progress}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "var(--surface-3)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${agent.progress}%`,
            background: agent.status === "completed" ? "var(--color-success)" :
              agent.status === "error" ? "var(--color-error)" :
              "var(--color-primary)",
          }}
        />
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
        <span>{agent.provider}</span>
        <span>{agent.tokensUsed.toLocaleString()} tokens</span>
      </div>

      {/* Proof viewer (expanded) */}
      {showProof && (
        <div style={{ marginTop: "var(--space-md)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-md)" }}>
          <ProofViewer
            proof={proofData ?? {
              sessionId: agent.id,
              timestamp: agent.startedAt,
              testsPassed: 0,
              testsFailed: agent.status === "error" ? 1 : 0,
              testsTotal: 0,
              typecheckClean: agent.status === "completed",
              diffSummary: { filesChanged: 0, additions: 0, deletions: 0 },
              cost: agent.cost,
              elapsed: Math.floor(duration),
              errors: agent.status === "error" ? [agent.task ?? "Task failed"] : [],
            }}
            onClose={() => setShowProof(false)}
          />
        </div>
      )}
    </div>
  );
}
