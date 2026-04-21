/**
 * WorkflowBuilder — visual DAG editor for WOTANN workflows.
 * SVG-based canvas with node palette, property panel, and toolbar.
 * Receives workflow data as props; reports changes via callbacks.
 */

import { useState, useCallback, useMemo } from "react";
import {
  computeDAGLayout,
  deriveEdges,
  type WorkflowNodeDef,
  type WorkflowNodeType,
  type WorkflowNodeStatus,
} from "./dag-layout";
import { WorkflowNode } from "./WorkflowNode";
import { WorkflowEdge, EdgeArrowDefs } from "./WorkflowEdge";
import { PropertyPanel } from "./PropertyPanel";
import { commands } from "../../hooks/useTauriCommand";
import { color } from "../../design/tokens.generated";

// ── RPC Helper ──────────────────────────────────────────

interface JsonRpcResponse {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
}

async function workflowRpc(
  method: string,
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params,
    id: Date.now(),
  });
  const response = await commands.sendMessage(payload);
  if (!response) return null;
  try {
    const parsed = JSON.parse(response) as JsonRpcResponse;
    if (parsed.error) {
      throw new Error(parsed.error.message);
    }
    return parsed.result ?? parsed;
  } catch {
    return null;
  }
}

// ── Node Palette Config ─────────────────────────────────

interface PaletteEntry {
  readonly type: WorkflowNodeType;
  readonly label: string;
  readonly color: string;
}

const PALETTE: readonly PaletteEntry[] = [
  { type: "agent", label: "Agent", color: color("accent") },
  { type: "loop", label: "Loop", color: color("info") },
  { type: "approval", label: "Approval", color: color("warning") },
  { type: "parallel", label: "Parallel", color: color("success") },
  { type: "shell", label: "Shell", color: color("muted") },
];

// ── Props ───────────────────────────────────────────────

interface WorkflowBuilderProps {
  readonly initialNodes: readonly WorkflowNodeDef[];
  readonly workflowName: string;
  readonly onNameChange: (name: string) => void;
}

// ── Component ───────────────────────────────────────────

export function WorkflowBuilder({
  initialNodes,
  workflowName,
  onNameChange,
}: WorkflowBuilderProps) {
  const [nodes, setNodes] = useState<readonly WorkflowNodeDef[]>(initialNodes);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeStatuses, setNodeStatuses] = useState<Readonly<Record<string, WorkflowNodeStatus>>>({});
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [draggedNodeType, setDraggedNodeType] = useState<WorkflowNodeType | null>(null);

  // Derive edges from node dependencies
  const edges = useMemo(() => deriveEdges(nodes), [nodes]);

  // Compute layout
  const layout = useMemo(() => computeDAGLayout(nodes, edges), [nodes, edges]);

  // Get the selected node definition
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  // ── Node Actions ────────────────────────────────────────

  const addNode = useCallback((type: WorkflowNodeType) => {
    const existingOfType = nodes.filter((n) => n.type === type).length;
    const newId = `${type}-${existingOfType + 1}`;
    const newNode: WorkflowNodeDef = {
      id: newId,
      type,
      prompt: "",
      dependencies: [],
      ...(type === "loop" ? { maxIterations: 3, exitCondition: "" } : {}),
      ...(type === "shell" ? { command: "" } : {}),
      ...(type === "approval" ? { approvalPrompt: "" } : {}),
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newId);
  }, [nodes]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((prev) => {
      const filtered = prev.filter((n) => n.id !== selectedNodeId);
      // Remove deleted node from all dependency lists
      return filtered.map((n) => ({
        ...n,
        dependencies: n.dependencies.filter((d) => d !== selectedNodeId),
      }));
    });
    setSelectedNodeId(null);
  }, [selectedNodeId]);

  const updateNode = useCallback(
    (id: string, updates: Partial<WorkflowNodeDef>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...updates } : n)),
      );
    },
    [],
  );

  // ── Workflow Actions ────────────────────────────────────

  const handleRun = useCallback(async () => {
    setStatusMessage("Starting workflow...");
    const nodePayload = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      prompt: n.prompt ?? "",
      dependencies: n.dependencies,
      ...(n.maxIterations !== undefined ? { maxIterations: n.maxIterations } : {}),
      ...(n.exitCondition ? { exitCondition: n.exitCondition } : {}),
      ...(n.command ? { command: n.command } : {}),
      ...(n.approvalPrompt ? { approvalPrompt: n.approvalPrompt } : {}),
    }));

    try {
      const result = await workflowRpc("workflow.start", {
        name: workflowName,
        nodes: nodePayload,
      });
      if (result && typeof result === "object" && "id" in result) {
        const typed = result as { readonly id: string };
        setRunningWorkflowId(typed.id);
        setStatusMessage(`Running: ${typed.id}`);
        // Initialize all nodes as pending
        const statuses: Record<string, WorkflowNodeStatus> = {};
        for (const n of nodes) {
          statuses[n.id] = "pending";
        }
        setNodeStatuses(statuses);
        // Start polling
        pollStatus(typed.id);
      } else {
        setStatusMessage("Workflow started (no tracking ID)");
      }
    } catch (err) {
      setStatusMessage(`Failed: ${String(err)}`);
    }
  }, [nodes, workflowName]);

  const pollStatus = useCallback(
    async (workflowId: string) => {
      const poll = async () => {
        try {
          const result = await workflowRpc("workflow.status", { id: workflowId });
          if (result && typeof result === "object" && "nodeStates" in result) {
            const typed = result as {
              readonly status: string;
              readonly nodeStates: Readonly<Record<string, { readonly status: string }>>;
            };
            const newStatuses: Record<string, WorkflowNodeStatus> = {};
            for (const [nodeId, state] of Object.entries(typed.nodeStates)) {
              newStatuses[nodeId] = state.status as WorkflowNodeStatus;
            }
            setNodeStatuses(newStatuses);
            setStatusMessage(`Status: ${typed.status}`);

            if (typed.status === "completed" || typed.status === "failed") {
              setRunningWorkflowId(null);
              return; // Stop polling
            }
          }
        } catch {
          // Polling failure is non-fatal
        }
        // Continue polling if still running
        if (runningWorkflowId === workflowId) {
          setTimeout(poll, 2000);
        }
      };
      setTimeout(poll, 1000);
    },
    [runningWorkflowId],
  );

  const handleSave = useCallback(async () => {
    setStatusMessage("Saving...");
    try {
      await workflowRpc("workflow.save", {
        name: workflowName,
        nodes: nodes.map((n) => ({ ...n })),
      });
      setStatusMessage("Saved");
      setTimeout(() => setStatusMessage(null), 2000);
    } catch {
      setStatusMessage("Save failed");
    }
  }, [workflowName, nodes]);

  // ── Render ──────────────────────────────────────────────

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left: Node Palette */}
      <div
        style={{
          width: 140,
          flexShrink: 0,
          borderRight: "1px solid var(--border-subtle)",
          padding: "var(--space-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: "var(--font-size-2xs)",
            fontWeight: 600,
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 4,
          }}
        >
          Add Node
        </div>
        {PALETTE.map((entry) => (
          <button
            key={entry.type}
            className="btn-press"
            draggable
            onClick={() => addNode(entry.type)}
            onDragStart={(e) => {
              setDraggedNodeType(entry.type);
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData("text/plain", entry.type);
            }}
            onDragEnd={() => setDraggedNodeType(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-2)",
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              cursor: draggedNodeType === entry.type ? "grabbing" : "grab",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: entry.color,
                flexShrink: 0,
              }}
            />
            {entry.label}
          </button>
        ))}
      </div>

      {/* Center: Canvas + Toolbar */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            padding: "8px var(--space-sm)",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={workflowName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Workflow name..."
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              padding: "6px 10px",
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-primary)",
              width: 180,
            }}
          />
          <button
            className="btn-press"
            onClick={handleRun}
            disabled={nodes.length === 0 || runningWorkflowId !== null}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-sm)",
              background: nodes.length === 0 || runningWorkflowId !== null ? "var(--surface-2)" : "var(--green)",
              color: nodes.length === 0 || runningWorkflowId !== null ? "var(--color-text-dim)" : "white",
              border: "none",
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              cursor: nodes.length === 0 || runningWorkflowId !== null ? "default" : "pointer",
            }}
          >
            {runningWorkflowId ? "Running..." : "Run"}
          </button>
          <button
            className="btn-press"
            onClick={handleSave}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface-2)",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--border-subtle)",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Save
          </button>
          {selectedNodeId && (
            <button
              className="btn-press"
              onClick={deleteSelectedNode}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(239,68,68,0.1)",
                color: "var(--red)",
                border: "1px solid rgba(239,68,68,0.2)",
                fontSize: "var(--font-size-xs)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Delete Node
            </button>
          )}
          {statusMessage && (
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", marginLeft: "auto" }}>
              {statusMessage}
            </span>
          )}
        </div>

        {/* SVG Canvas */}
        <div
          style={{ flex: 1, overflow: "auto", position: "relative" }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const nodeType = draggedNodeType ?? e.dataTransfer.getData("text/plain") as WorkflowNodeType;
            if (!nodeType) return;
            // Add the node — layout is computed automatically from DAG structure
            addNode(nodeType);
            setDraggedNodeType(null);
          }}
        >
          {nodes.length === 0 ? (
            <EmptyCanvas />
          ) : (
            <svg
              width={Math.max(layout.width, 400)}
              height={Math.max(layout.height, 300)}
              style={{ display: "block" }}
            >
              <EdgeArrowDefs />

              {/* Edges */}
              {layout.edges.map((edge) => (
                <WorkflowEdge
                  key={`${edge.from}-${edge.to}`}
                  edge={edge}
                  sourceStatus={nodeStatuses[edge.from] ?? "pending"}
                />
              ))}

              {/* Nodes */}
              {layout.nodes.map((layoutNode) => {
                const nodeDef = nodes.find((n) => n.id === layoutNode.id);
                return (
                  <WorkflowNode
                    key={layoutNode.id}
                    layout={layoutNode}
                    nodeType={nodeDef?.type ?? "agent"}
                    status={nodeStatuses[layoutNode.id] ?? "pending"}
                    selected={selectedNodeId === layoutNode.id}
                    onSelect={setSelectedNodeId}
                  />
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Right: Property Panel */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          borderLeft: "1px solid var(--border-subtle)",
          padding: "var(--space-sm)",
          overflow: "auto",
        }}
      >
        {selectedNode ? (
          <PropertyPanel
            node={selectedNode}
            allNodeIds={nodes.map((n) => n.id)}
            onUpdate={(updates) => updateNode(selectedNode.id, updates)}
          />
        ) : (
          <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", padding: "var(--space-md)" }}>
            Select a node to edit its properties.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty Canvas ────────────────────────────────────────

function EmptyCanvas() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--color-text-dim)",
        fontSize: "var(--font-size-sm)",
        gap: 8,
      }}
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="12" cy="5" r="3" />
        <circle cx="5" cy="19" r="3" />
        <circle cx="19" cy="19" r="3" />
        <path d="M12 8v3M9.5 14.5L7 16.5M14.5 14.5L17 16.5" />
      </svg>
      <span>Add nodes from the palette to start building.</span>
    </div>
  );
}

