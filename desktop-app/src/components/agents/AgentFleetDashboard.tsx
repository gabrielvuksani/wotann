/**
 * Agent fleet dashboard: grid of running agents with progress, cost, and health.
 * Features: summary stats, empty state, kill button.
 */

import { useStore } from "../../store";
import { AgentCard } from "./AgentCard";
import { EmptyState } from "../shared/ErrorState";
import { AgentCardSkeleton } from "../shared/Skeleton";

export function AgentFleetDashboard() {
  const agents = useStore((s) => s.agents);
  const engineConnected = useStore((s) => s.engineConnected);
  const running = agents.filter((a) => a.status === "running");
  const completed = agents.filter((a) => a.status === "completed");
  const idle = agents.filter((a) => a.status === "idle");
  const errored = agents.filter((a) => a.status === "error");
  const totalCost = agents.reduce((sum, a) => sum + a.cost, 0);

  // Show loading skeletons when engine is connected but agents haven't loaded yet
  const isInitialLoading = engineConnected && agents.length === 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b p-4 animate-fadeIn" style={{ borderColor: "var(--border-subtle)" }}>
        <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>Workers</h2>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Background agents executing tasks in parallel
        </p>
      </div>

      {/* Summary stats */}
      <div className="border-b px-4 py-3 flex gap-6" style={{ borderColor: "var(--border-subtle)" }} role="group" aria-label="Worker statistics">
        <StatBadge label="Running" value={running.length} color="emerald" />
        <StatBadge label="Idle" value={idle.length} color="amber" />
        <StatBadge label="Completed" value={completed.length} color="blue" />
        <StatBadge label="Errors" value={errored.length} color="rose" />
        <div className="ml-auto text-xs" style={{ color: "var(--color-text-muted)" }}>
          Total cost: <span style={{ color: "var(--color-text-secondary)" }}>${totalCost.toFixed(2)}</span>
        </div>
      </div>

      {/* Agent grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {isInitialLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3" aria-label="Loading workers" role="status">
            <AgentCardSkeleton />
            <AgentCardSkeleton />
            <AgentCardSkeleton />
          </div>
        ) : agents.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              icon='<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="10" height="9" rx="2"/><path d="M6 7v1.5M10 7v1.5M6.5 11h3"/><path d="M5 4V2.5M11 4V2.5"/><path d="M1 8h2M13 8h2"/></svg>'
              title="No workers active"
              message="Workers are dispatched automatically during Build and Autopilot modes"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3" role="list" aria-label="Worker cards">
            {agents.map((agent) => (
              <div key={agent.id} role="listitem">
                <AgentCard agent={agent} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBadge({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}) {
  const styleMap: Record<string, { color: string; background: string }> = {
    emerald: { color: "var(--color-success)", background: "var(--color-success-muted)" },
    amber: { color: "var(--color-warning)", background: "var(--color-warning-muted)" },
    blue: { color: "var(--info)", background: "var(--color-info-muted)" },
    rose: { color: "var(--color-error)", background: "var(--color-error-muted)" },
    zinc: { color: "var(--color-text-muted)", background: "var(--surface-3)" },
  };

  const s = styleMap[color] ?? styleMap["zinc"]!;

  return (
    <div className="flex items-center gap-2" aria-label={`${value} ${label}`}>
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold"
        style={s}
      >
        {value}
      </span>
      <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</span>
    </div>
  );
}
