/**
 * ToolCallCard -- Displays agent tool invocations as visible, expandable cards.
 * Replaces the nearly-invisible 7px tool indicators.
 */

import { useState } from "react";

interface ToolCallCardProps {
  readonly toolName: string;
  readonly toolInput?: Record<string, unknown>;
  readonly toolResult?: string;
  readonly status: "running" | "complete" | "error";
  readonly durationMs?: number;
}

export function ToolCallCard({ toolName, toolInput, toolResult, status, durationMs }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const icon = status === "running" ? "\u27F3" : status === "complete" ? "\u2713" : "\u2717";
  const statusColor = status === "running" ? "#0A84FF"
    : status === "complete" ? "#30D158"
    : "#FF453A";

  const summary = formatToolSummary(toolName, toolInput);

  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "10px",
        padding: "8px 12px",
        margin: "4px 0",
        background: "var(--surface-1)",
        cursor: "pointer",
        fontSize: "13px",
        overflow: "hidden",
      }}
      onClick={() => setExpanded((prev) => !prev)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((prev) => !prev);
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`Tool call: ${toolName}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ color: statusColor, fontWeight: 600 }}>{icon}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>{toolName}</span>
        <span style={{ color: "var(--color-text-muted)", flex: 1 }}>{summary}</span>
        {durationMs !== undefined && (
          <span style={{ color: "var(--color-text-dim)", fontSize: "11px" }}>{durationMs}ms</span>
        )}
        <span style={{ color: "var(--color-text-dim)", fontSize: "11px" }}>{expanded ? "\u25B2" : "\u25BC"}</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          {toolInput && (
            <pre style={{
              marginTop: "8px",
              padding: "8px",
              background: "var(--surface-2)",
              borderRadius: "6px",
              fontSize: "12px",
              overflow: "auto",
              maxHeight: "200px",
              color: "var(--color-text-secondary)",
            }}>
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          )}
          {toolResult && (
            <pre style={{
              marginTop: "4px",
              padding: "8px",
              background: "var(--surface-2)",
              borderRadius: "6px",
              fontSize: "12px",
              overflow: "auto",
              maxHeight: "300px",
              color: "var(--color-text-secondary)",
            }}>
              {toolResult.slice(0, 2000)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function formatToolSummary(name: string, input?: Record<string, unknown>): string {
  if (!input) return "";
  if (name === "read_file" || name === "Read") return String(input.file_path ?? input.path ?? "");
  if (name === "write_file" || name === "Write") return String(input.file_path ?? input.path ?? "");
  if (name === "edit_file" || name === "Edit") return String(input.file_path ?? input.path ?? "");
  if (name === "bash" || name === "Bash") return String(input.command ?? "").slice(0, 60);
  if (name === "glob" || name === "Glob") return String(input.pattern ?? "");
  if (name === "grep" || name === "Grep") return String(input.pattern ?? "");
  if (name === "web_fetch") return String(input.url ?? "");
  return Object.values(input).map(String).join(", ").slice(0, 60);
}
