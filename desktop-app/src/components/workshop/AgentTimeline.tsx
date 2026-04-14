/**
 * Agent Step Timeline -- vertical progress display showing agent execution phases.
 * Each step has a status dot, optional duration, and expandable details.
 *
 * Steps: Planning -> Reading -> Writing -> Testing -> Complete
 */

import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────

export interface TimelineStep {
  readonly label: string;
  readonly status: "pending" | "active" | "complete" | "error";
  readonly durationMs?: number;
  readonly details?: string;
}

interface AgentTimelineProps {
  readonly steps: readonly TimelineStep[];
  readonly agentName?: string;
}

// ── Helpers ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<TimelineStep["status"], string> = {
  complete: "var(--color-success)",
  active: "var(--color-primary)",
  error: "var(--color-error)",
  pending: "var(--text-dim)",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Inline pulse animation ─────────────────────────────────────────

const PULSE_KEYFRAMES = `
@keyframes agentTimelinePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
`;

// ── Component ──────────────────────────────────────────────────────

export function AgentTimeline({ steps, agentName }: AgentTimelineProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  return (
    <div style={{ padding: "8px 0" }}>
      <style>{PULSE_KEYFRAMES}</style>

      {agentName && (
        <div style={{
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginBottom: "8px",
        }}>
          {agentName}
        </div>
      )}

      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const dotColor = STATUS_COLORS[step.status];
        const isExpanded = expandedStep === i;
        const hasDetails = Boolean(step.details);

        return (
          <div key={i} style={{ display: "flex", gap: "10px", minHeight: "28px" }}>
            {/* Vertical line + dot */}
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "16px",
            }}>
              <div style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: dotColor,
                flexShrink: 0,
                boxShadow: step.status === "active" ? `0 0 6px ${dotColor}` : "none",
                animation: step.status === "active"
                  ? "agentTimelinePulse 2s ease-in-out infinite"
                  : "none",
              }} />
              {!isLast && (
                <div style={{
                  width: "1px",
                  flex: 1,
                  minHeight: "12px",
                  background: step.status === "complete"
                    ? "var(--color-success)"
                    : "var(--border-subtle)",
                }} />
              )}
            </div>

            {/* Content */}
            <div
              style={{
                flex: 1,
                cursor: hasDetails ? "pointer" : "default",
                paddingBottom: isLast ? 0 : "4px",
              }}
              onClick={() => hasDetails && setExpandedStep(isExpanded ? null : i)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{
                  fontSize: "12px",
                  fontWeight: step.status === "active" ? 600 : 400,
                  color: step.status === "active"
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                }}>
                  {step.label}
                </span>
                {step.durationMs !== undefined && (
                  <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                    {formatDuration(step.durationMs)}
                  </span>
                )}
                {hasDetails && (
                  <span style={{ fontSize: "9px", color: "var(--text-dim)" }}>
                    {isExpanded ? "\u25B2" : "\u25BC"}
                  </span>
                )}
              </div>
              {isExpanded && step.details && (
                <div style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  lineHeight: 1.4,
                  padding: "4px 0",
                  maxHeight: "100px",
                  overflow: "auto",
                }}>
                  {step.details}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
