/**
 * Right panel: context sources with token counts, memory hits, active workers with progress bars.
 */

import { useState } from "react";
import { useStore } from "../../store";
import type { ContextSource } from "../../types";

type PanelTab = "context" | "memory" | "agents";

const TYPE_COLORS: Record<string, string> = {
  system: "var(--color-primary)",
  conversation: "var(--color-accent)",
  files: "var(--color-success)",
  tools: "var(--color-warning)",
  memory: "var(--red)",
  skills: "var(--accent)",
};

function ContextSourceRow({ source, totalTokens }: { readonly source: ContextSource; readonly totalTokens: number }) {
  const percent = totalTokens > 0 ? (source.tokens / totalTokens) * 100 : 0;

  return (
    <div className="group" role="listitem">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[source.type] ?? "var(--color-text-muted)" }} aria-hidden="true" />
          <span className="truncate" style={{ color: "var(--color-text-secondary)" }}>{source.name}</span>
        </div>
        <span className="shrink-0 ml-2" style={{ color: "var(--color-text-dim)" }} aria-label={`${source.tokens.toLocaleString()} tokens`}>
          {source.tokens.toLocaleString()}
        </span>
      </div>
      <div
        className="h-1 rounded-full mt-1 ml-4"
        style={{ background: "var(--surface-2)" }}
        role="meter"
        aria-label={`${source.name} token usage`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full opacity-40 transition-all"
          style={{ background: TYPE_COLORS[source.type] ?? "var(--color-text-muted)", width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function ContextPanel() {
  const [activeTab, setActiveTab] = useState<PanelTab>("context");
  const contextSources = useStore((s) => s.contextSources);
  const contextPercent = useStore((s) => s.contextPercent);
  const totalTokens = useStore((s) => s.totalTokens);
  const agents = useStore((s) => s.agents);
  const memoryEntries = useStore((s) => s.memoryEntries);
  const model = useStore((s) => s.model);

  const maxTokens = model.includes("opus") ? 1_000_000 : 200_000;

  const tabs: readonly { id: PanelTab; label: string; count: number }[] = [
    { id: "context", label: "Context", count: contextSources.length },
    { id: "memory", label: "Memory", count: memoryEntries.length },
    { id: "agents", label: "Workers", count: agents.length },
  ];

  return (
    <aside className="w-72 flex flex-col shrink-0 h-full" style={{ background: "var(--color-bg-primary)", borderLeft: "1px solid var(--border-subtle)" }} aria-label="Context panel">
      {/* Header */}
      <div style={{ padding: "var(--space-md) var(--space-md) 0", fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>
        Inspector
      </div>
      {/* Tab bar */}
      <div className="flex" style={{ padding: "0 var(--space-md)", borderBottom: "1px solid var(--border-subtle)" }} role="tablist" aria-label="Context panel sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`context-panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 transition-colors relative"
            style={{
              padding: "8px 4px",
              fontSize: "var(--font-size-xs)",
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? "var(--color-text-primary)" : "var(--color-text-muted)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{ marginLeft: 4, fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>({tab.count})</span>
            )}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-1 right-1" style={{ height: 2, borderRadius: 1, background: "var(--accent)" }} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {/* Context tab */}
      {activeTab === "context" && (
        <div id="context-panel-context" role="tabpanel" className="flex flex-col flex-1 min-h-0 animate-fadeIn">
          <div style={{ padding: "var(--space-container)", borderBottom: "1px solid var(--border-subtle)" }}>
            <div className="flex justify-between mb-1.5" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
              <span>{totalTokens.toLocaleString()} tokens</span>
              <span>{contextPercent.toFixed(1)}%</span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: "var(--surface-2)" }}
              role="meter"
              aria-label="Context window usage"
              aria-valuenow={contextPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${contextPercent}%`,
                  background: contextPercent > 80
                    ? "var(--gradient-context-danger)"
                    : contextPercent > 60
                      ? "var(--gradient-context-warn)"
                      : "var(--gradient-context-bar)",
                }}
              />
            </div>
            <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", marginTop: 4 }}>
              {maxTokens.toLocaleString()} max ({model})
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" style={{ padding: "8px var(--space-container)" }} role="list" aria-label="Context sources">
            <div className="space-y-2.5">
              {contextSources.map((source, i) => (
                <ContextSourceRow key={i} source={source} totalTokens={totalTokens} />
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "8px var(--space-container)" }}>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
                  <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", textTransform: "capitalize" }}>{type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Memory tab */}
      {activeTab === "memory" && (
        <div id="context-panel-memory" role="tabpanel" className="flex-1 overflow-y-auto animate-fadeIn">
          {memoryEntries.length === 0 ? (
            <div className="p-4 text-center" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
              No memory entries found
            </div>
          ) : (
            <div className="py-1" role="list" aria-label="Memory entries">
              {memoryEntries.map((entry) => (
                <div
                  key={entry.id}
                  role="listitem"
                  className="transition-colors"
                  style={{ padding: "12px var(--space-container)", borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="px-1.5 py-0.5 rounded font-medium"
                      style={{
                        fontSize: "var(--font-size-xs)",
                        ...(entry.type === "case"
                          ? { background: "rgba(59,130,246,0.2)", color: "var(--info)" }
                          : entry.type === "pattern"
                            ? { background: "rgba(16,185,129,0.2)", color: "var(--color-connected)" }
                            : entry.type === "decision"
                              ? { background: "rgba(245,158,11,0.2)", color: "var(--color-warning)" }
                              : { background: "var(--surface-3)", color: "var(--color-text-secondary)" }),
                      }}
                    >
                      {entry.type}
                    </span>
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
                      {(entry.score * 100).toFixed(0)}% match
                    </span>
                  </div>
                  <p className="leading-relaxed line-clamp-3" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
                    {entry.content}
                  </p>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)", marginTop: 4 }}>
                    {entry.source} &middot;{" "}
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Agents tab */}
      {activeTab === "agents" && (
        <div id="context-panel-agents" role="tabpanel" className="flex-1 overflow-y-auto animate-fadeIn">
          {agents.length === 0 ? (
            <div className="p-4 text-center" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
              No workers active
            </div>
          ) : (
            <div className="py-1" role="list" aria-label="Active workers">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  role="listitem"
                  style={{ padding: "12px var(--space-container)", borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        agent.status === "running" ? "animate-pulse" : ""
                      }`}
                      style={{
                        background: agent.status === "running"
                          ? "var(--color-success)"
                          : agent.status === "error"
                            ? "var(--color-error)"
                            : agent.status === "completed"
                              ? "var(--info)"
                              : "var(--color-text-muted)",
                      }}
                      aria-hidden="true"
                    />
                    <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-primary)", fontWeight: 500 }}>{agent.name}</span>
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)", marginLeft: "auto" }}>{agent.model}</span>
                  </div>
                  <p className="truncate ml-4" style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>{agent.task}</p>
                  {agent.status === "running" && (
                    <div className="mt-1.5 ml-4">
                      <div
                        className="h-1 rounded-full overflow-hidden"
                        style={{ background: "var(--surface-2)" }}
                        role="progressbar"
                        aria-valuenow={agent.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${agent.name} progress`}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ background: "var(--color-success)", width: `${agent.progress}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-0.5" style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
                        <span>{agent.progress}%</span>
                        <span>${agent.cost.toFixed(3)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
