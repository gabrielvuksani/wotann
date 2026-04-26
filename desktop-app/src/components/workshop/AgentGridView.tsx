/**
 * AgentGridView — Multi-agent grid layout showing parallel conversations.
 * From Cursor 3's Agent Tabs pattern.
 */

import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────

export interface AgentCard {
  readonly id: string;
  readonly name: string;
  readonly status: "running" | "complete" | "error" | "queued";
  readonly progress: number;
  readonly lastMessage?: string;
  readonly startedAt: number;
  readonly filesChanged: readonly string[];
}

interface AgentGridViewProps {
  readonly agents: readonly AgentCard[];
  readonly onSelectAgent: (id: string) => void;
  readonly selectedAgentId?: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function statusColor(status: AgentCard["status"]): string {
  switch (status) {
    case "running":
      return "var(--color-primary)";
    case "complete":
      return "var(--color-success)";
    case "error":
      return "var(--color-error)";
    case "queued":
      return "var(--text-dim)";
  }
}

// ── Component ──────────────────────────────────────────────────────

export function AgentGridView({
  agents,
  onSelectAgent,
  selectedAgentId,
}: AgentGridViewProps) {
  const [columns, setColumns] = useState(2);

  if (agents.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-dim)",
        }}
      >
        No agents running. Start a task to see parallel agents here.
      </div>
    );
  }

  const runningCount = agents.filter((a) => a.status === "running").length;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "12px" }}>
      {/* Grid controls */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "12px",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          Layout:
        </span>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => setColumns(n)}
            style={{
              padding: "2px 8px",
              fontSize: "11px",
              borderRadius: "var(--radius-xs)",
              border: "none",
              cursor: "pointer",
              background:
                columns === n ? "var(--color-primary)" : "var(--surface-2)",
              color:
                columns === n ? "white" : "var(--text-secondary)",
            }}
          >
            {n}
            {n === 1 ? "\u00D71" : ""}
          </button>
        ))}
        <span
          style={{
            fontSize: "11px",
            color: "var(--text-dim)",
            marginLeft: "auto",
          }}
        >
          {runningCount} running / {agents.length} total
        </span>
      </div>

      {/* Agent grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: "8px",
        }}
      >
        {agents.map((agent) => {
          const isSelected = agent.id === selectedAgentId;
          const color = statusColor(agent.status);

          return (
            <div
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              style={{
                border: `1px solid ${isSelected ? "var(--color-primary)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-md)",
                padding: "10px",
                background: isSelected
                  ? "rgba(10, 132, 255, 0.05)"
                  : "var(--surface-1)",
                cursor: "pointer",
                transition: "all 150ms ease",
                minHeight: "120px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "6px",
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: color,
                    boxShadow:
                      agent.status === "running"
                        ? `0 0 4px ${color}`
                        : "none",
                  }}
                />
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    flex: 1,
                  }}
                >
                  {agent.name}
                </span>
                <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                  {agent.progress}%
                </span>
              </div>

              {/* Progress bar */}
              <div
                style={{
                  height: 2,
                  background: "var(--surface-3)",
                  borderRadius: 1,
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 1,
                    background: color,
                    width: `${agent.progress}%`,
                    transition: "width 300ms ease",
                  }}
                />
              </div>

              {/* Last message preview */}
              {agent.lastMessage && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-muted)",
                    lineHeight: 1.3,
                    flex: 1,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {agent.lastMessage}
                </div>
              )}

              {/* Files changed */}
              {agent.filesChanged.length > 0 && (
                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "10px",
                    color: "var(--text-dim)",
                  }}
                >
                  {agent.filesChanged.length} file
                  {agent.filesChanged.length !== 1 ? "s" : ""} changed
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
