/**
 * WorkflowEdge — SVG path connecting two DAG nodes.
 * Draws a curved path from source center-bottom to target center-top
 * with an arrowhead marker. Animates dash when source is running.
 */

import { useMemo } from "react";
import type { LayoutEdge, WorkflowNodeStatus } from "./dag-layout";

// ── Arrow Marker Definition ─────────────────────────────

/** Renders once in the SVG <defs> section. Call from parent SVG. */
export function EdgeArrowDefs() {
  return (
    <defs>
      <marker
        id="workflow-arrow"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M0 0L10 5L0 10z" fill="var(--color-text-dim)" />
      </marker>
      <marker
        id="workflow-arrow-active"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M0 0L10 5L0 10z" fill="#0A84FF" />
      </marker>
    </defs>
  );
}

// ── Props ───────────────────────────────────────────────

interface WorkflowEdgeProps {
  readonly edge: LayoutEdge;
  readonly sourceStatus: WorkflowNodeStatus;
}

// ── Component ───────────────────────────────────────────

export function WorkflowEdge({ edge, sourceStatus }: WorkflowEdgeProps) {
  const isActive = sourceStatus === "running";

  // Compute a smooth cubic bezier curve
  const pathData = useMemo(() => {
    const { fromX, fromY, toX, toY } = edge;
    const dy = toY - fromY;
    const controlOffset = Math.max(dy * 0.4, 30);

    return [
      `M ${fromX} ${fromY}`,
      `C ${fromX} ${fromY + controlOffset}`,
      `${toX} ${toY - controlOffset}`,
      `${toX} ${toY}`,
    ].join(" ");
  }, [edge]);

  return (
    <path
      d={pathData}
      fill="none"
      stroke={isActive ? "#0A84FF" : "var(--color-text-dim)"}
      strokeWidth={isActive ? 1.5 : 1}
      strokeDasharray={isActive ? "6 4" : "none"}
      markerEnd={isActive ? "url(#workflow-arrow-active)" : "url(#workflow-arrow)"}
      opacity={isActive ? 0.9 : 0.4}
    >
      {isActive && (
        <animate
          attributeName="stroke-dashoffset"
          values="10;0"
          dur="0.6s"
          repeatCount="indefinite"
        />
      )}
    </path>
  );
}
