/**
 * Individual agent card with status indicators, progress bars, cost, kill button.
 * Status color: running=green, idle=yellow, completed=blue, failed=red.
 */

import type React from "react";
import type { AgentInfo } from "../../types";

interface AgentCardProps {
  readonly agent: AgentInfo;
  readonly onKill?: (id: string) => void;
}

function formatDuration(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const STATUS_CONFIG: Record<string, { color: string; bgStyle: React.CSSProperties; label: string; dotColor: string; dotAnimate: boolean }> = {
  running: { color: "var(--color-success)", bgStyle: { background: "var(--color-success-muted)", borderColor: "rgba(16, 185, 129, 0.2)" }, label: "Running", dotColor: "var(--color-success)", dotAnimate: true },
  idle: { color: "var(--color-warning)", bgStyle: { background: "var(--color-warning-muted)", borderColor: "rgba(245, 158, 11, 0.2)" }, label: "Idle", dotColor: "var(--color-warning)", dotAnimate: false },
  completed: { color: "var(--info)", bgStyle: { background: "var(--color-info-muted)", borderColor: "rgba(96, 165, 250, 0.2)" }, label: "Completed", dotColor: "var(--info)", dotAnimate: false },
  error: { color: "var(--color-error)", bgStyle: { background: "var(--color-error-muted)", borderColor: "rgba(239, 68, 68, 0.2)" }, label: "Error", dotColor: "var(--color-error)", dotAnimate: false },
};

export function AgentCard({ agent, onKill }: AgentCardProps) {
  const config = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG["idle"]!;

  return (
    <div
      className="rounded-xl border p-4 transition-all hover:shadow-md animate-slideUp"
      style={config.bgStyle}
      role="article"
      aria-label={`Worker: ${agent.name}, status: ${config.label}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${config.dotAnimate ? "animate-pulse" : ""}`}
            style={{ background: config.dotColor }}
            aria-hidden="true"
          />
          <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{agent.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium" style={{ color: config.color }}>{config.label}</span>
          {agent.status === "running" && onKill && (
            <button
              onClick={() => onKill(agent.id)}
              className="px-1.5 py-0.5 text-[10px] rounded transition-colors"
              style={{ background: "var(--color-error-muted)", color: "var(--color-error)" }}
              aria-label={`Kill worker ${agent.name}`}
            >
              Kill
            </button>
          )}
        </div>
      </div>

      {/* Task description */}
      <p className="text-xs mb-3 line-clamp-2" style={{ color: "var(--color-text-secondary)" }}>{agent.task}</p>

      {/* Progress bar (running only) */}
      {agent.status === "running" && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] mb-1" style={{ color: "var(--color-text-muted)" }}>
            <span>Progress</span>
            <span>{agent.progress}%</span>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--surface-3)" }}
            role="progressbar"
            aria-valuenow={agent.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${agent.name} progress`}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ background: "var(--gradient-accent)", width: `${agent.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
        <span>{agent.model}</span>
        <span>{agent.tokensUsed.toLocaleString()} tok</span>
        <span>${agent.cost.toFixed(3)}</span>
        <span className="ml-auto">{formatDuration(agent.startedAt)}</span>
      </div>
    </div>
  );
}
