/**
 * PropertyPanel — right sidebar for editing workflow node properties.
 * Shows fields specific to the selected node's type.
 */

import { useCallback } from "react";
import type { WorkflowNodeDef, WorkflowNodeType } from "./dag-layout";

// ── Props ───────────────────────────────────────────────

interface PropertyPanelProps {
  readonly node: WorkflowNodeDef;
  readonly allNodeIds: readonly string[];
  readonly onUpdate: (updates: Partial<WorkflowNodeDef>) => void;
}

// ── Component ───────────────────────────────────────────

export function PropertyPanel({ node, allNodeIds, onUpdate }: PropertyPanelProps) {
  // Available dependency targets (all nodes except self)
  const depOptions = allNodeIds.filter((id) => id !== node.id);

  const toggleDependency = useCallback(
    (depId: string) => {
      const current = node.dependencies;
      const updated = current.includes(depId)
        ? current.filter((d) => d !== depId)
        : [...current, depId];
      onUpdate({ dependencies: updated });
    },
    [node.dependencies, onUpdate],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: "var(--font-size-2xs)", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Properties
      </div>

      {/* Node ID */}
      <FieldGroup label="Node ID">
        <input
          type="text"
          value={node.id}
          onChange={(e) => onUpdate({ id: e.target.value })}
          style={inputStyle}
        />
      </FieldGroup>

      {/* Node Type */}
      <FieldGroup label="Type">
        <select
          value={node.type}
          onChange={(e) => onUpdate({ type: e.target.value as WorkflowNodeType })}
          style={inputStyle}
        >
          <option value="agent">Agent</option>
          <option value="loop">Loop</option>
          <option value="approval">Approval</option>
          <option value="parallel">Parallel</option>
          <option value="shell">Shell</option>
        </select>
      </FieldGroup>

      {/* Prompt */}
      <FieldGroup label="Prompt">
        <textarea
          value={node.prompt ?? ""}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </FieldGroup>

      {/* Dependencies */}
      <FieldGroup label="Dependencies">
        {depOptions.length === 0 ? (
          <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
            No other nodes yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {depOptions.map((depId) => (
              <label
                key={depId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "var(--font-size-2xs)",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={node.dependencies.includes(depId)}
                  onChange={() => toggleDependency(depId)}
                />
                {depId}
              </label>
            ))}
          </div>
        )}
      </FieldGroup>

      {/* Loop-specific fields */}
      {node.type === "loop" && (
        <>
          <FieldGroup label="Max Iterations">
            <input
              type="number"
              value={node.maxIterations ?? 3}
              onChange={(e) => onUpdate({ maxIterations: parseInt(e.target.value, 10) || 1 })}
              min={1}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Exit Condition">
            <input
              type="text"
              value={node.exitCondition ?? ""}
              onChange={(e) => onUpdate({ exitCondition: e.target.value })}
              placeholder="e.g., tests pass"
              style={inputStyle}
            />
          </FieldGroup>
        </>
      )}

      {/* Shell-specific fields */}
      {node.type === "shell" && (
        <FieldGroup label="Command">
          <input
            type="text"
            value={node.command ?? ""}
            onChange={(e) => onUpdate({ command: e.target.value })}
            placeholder="e.g., npm test"
            style={inputStyle}
          />
        </FieldGroup>
      )}

      {/* Approval-specific fields */}
      {node.type === "approval" && (
        <FieldGroup label="Approval Prompt">
          <textarea
            value={node.approvalPrompt ?? ""}
            onChange={(e) => onUpdate({ approvalPrompt: e.target.value })}
            rows={2}
            placeholder="Review prompt..."
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </FieldGroup>
      )}
    </div>
  );
}

// ── Field Group ─────────────────────────────────────────

function FieldGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--font-size-2xs)",
          color: "var(--color-text-muted)",
          marginBottom: 4,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Shared Styles ───────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-1)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 8px",
  fontSize: "var(--font-size-2xs)",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
};
