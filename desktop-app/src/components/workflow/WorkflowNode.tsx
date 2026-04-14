/**
 * WorkflowNode — individual DAG node rendered as a styled SVG card.
 * Shows type icon, node ID, and status indicator.
 */

import { useMemo } from "react";
import type { WorkflowNodeType, WorkflowNodeStatus, LayoutNode } from "./dag-layout";

// ── Node Color Map ──────────────────────────────────────

const NODE_COLORS: Readonly<Record<WorkflowNodeType, string>> = {
  agent: "#0A84FF",
  loop: "#3b82f6",
  approval: "#f59e0b",
  parallel: "#22c55e",
  shell: "#6b7280",
};

// ── Status Colors ───────────────────────────────────────

const STATUS_COLORS: Readonly<Record<WorkflowNodeStatus, string>> = {
  pending: "var(--color-text-dim)",
  running: "#0A84FF",
  completed: "var(--green)",
  failed: "var(--red)",
};

// ── Type Icons (SVG paths) ──────────────────────────────

function NodeTypeIcon({ type }: { readonly type: WorkflowNodeType }) {
  const color = NODE_COLORS[type];

  switch (type) {
    case "agent":
      return (
        <g fill={color}>
          <circle cx="8" cy="5" r="3" />
          <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        </g>
      );
    case "loop":
      return (
        <path
          d="M12 3c-4.4 0-8 3.1-8 7s3.6 7 8 7c2.2 0 4.2-.8 5.5-2.1M12 3V1m0 2l2-2"
          stroke={color}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "approval":
      return (
        <g fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 12l2 2 4-4" />
          <rect x="3" y="3" width="14" height="14" rx="2" />
        </g>
      );
    case "parallel":
      return (
        <g fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
          <path d="M4 4v12M10 4v12M16 4v12" />
        </g>
      );
    case "shell":
      return (
        <g fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7l4 4-4 4" />
          <path d="M12 15h4" />
        </g>
      );
  }
}

// ── Status Indicator ────────────────────────────────────

function StatusDot({ status }: { readonly status: WorkflowNodeStatus }) {
  const color = STATUS_COLORS[status];
  const isRunning = status === "running";

  return (
    <g>
      {isRunning && (
        <circle cx="0" cy="0" r="5" fill={color} opacity="0.3">
          <animate attributeName="r" values="4;7;4" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0.1;0.3" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx="0" cy="0" r="4" fill={color} />
      {status === "completed" && (
        <path d="M-2 0l1.5 1.5 3-3" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {status === "failed" && (
        <g stroke="white" strokeWidth="1.2" strokeLinecap="round">
          <path d="M-1.5 -1.5l3 3" />
          <path d="M1.5 -1.5l-3 3" />
        </g>
      )}
    </g>
  );
}

// ── Props ───────────────────────────────────────────────

interface WorkflowNodeProps {
  readonly layout: LayoutNode;
  readonly nodeType: WorkflowNodeType;
  readonly status: WorkflowNodeStatus;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

// ── Component ───────────────────────────────────────────

export function WorkflowNode({
  layout,
  nodeType,
  status,
  selected,
  onSelect,
}: WorkflowNodeProps) {
  const color = NODE_COLORS[nodeType];

  const borderColor = useMemo(() => {
    if (selected) return "var(--accent)";
    return "var(--border-subtle)";
  }, [selected]);

  const bgColor = useMemo(() => {
    if (selected) return "var(--bg-surface)";
    return "var(--surface-2)";
  }, [selected]);

  return (
    <g
      transform={`translate(${layout.x}, ${layout.y})`}
      onClick={() => onSelect(layout.id)}
      style={{ cursor: "pointer" }}
      role="button"
      aria-label={`Node ${layout.id}, type ${nodeType}, status ${status}`}
    >
      {/* Card background */}
      <rect
        x="0"
        y="0"
        width={layout.width}
        height={layout.height}
        rx="8"
        ry="8"
        fill={bgColor}
        stroke={borderColor}
        strokeWidth={selected ? 2 : 1}
      />

      {/* Type color accent bar */}
      <rect
        x="0"
        y="0"
        width="4"
        height={layout.height}
        rx="2"
        fill={color}
      />

      {/* Type icon */}
      <svg x="12" y="12" width="20" height="20" viewBox="0 0 20 20">
        <NodeTypeIcon type={nodeType} />
      </svg>

      {/* Node ID label */}
      <text
        x="38"
        y="26"
        fontSize="11"
        fontWeight="500"
        fill="var(--color-text-primary)"
        style={{ userSelect: "none" }}
      >
        {layout.id.length > 12 ? `${layout.id.slice(0, 11)}...` : layout.id}
      </text>

      {/* Type label */}
      <text
        x="12"
        y="52"
        fontSize="9"
        fill="var(--color-text-muted)"
        style={{ userSelect: "none" }}
      >
        {nodeType}
      </text>

      {/* Status dot */}
      <g transform={`translate(${layout.width - 14}, 16)`}>
        <StatusDot status={status} />
      </g>

      {/* Running pulse border */}
      {status === "running" && (
        <rect
          x="0"
          y="0"
          width={layout.width}
          height={layout.height}
          rx="8"
          ry="8"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          opacity="0.5"
        >
          <animate attributeName="opacity" values="0.5;0.15;0.5" dur="2s" repeatCount="indefinite" />
        </rect>
      )}
    </g>
  );
}
