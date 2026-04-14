/**
 * Pure DAG layout algorithm for workflow visualization.
 * Computes x/y positions for nodes using topological sort
 * and layered layout. No side effects, no DOM access.
 */

// ── Types ───────────────────────────────────────────────

export type WorkflowNodeType = "agent" | "loop" | "approval" | "parallel" | "shell";

export type WorkflowNodeStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowNodeDef {
  readonly id: string;
  readonly type: WorkflowNodeType;
  readonly prompt?: string;
  readonly dependencies: readonly string[];
  readonly maxIterations?: number;
  readonly exitCondition?: string;
  readonly command?: string;
  readonly approvalPrompt?: string;
}

export interface WorkflowEdgeDef {
  readonly from: string;
  readonly to: string;
}

export interface LayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly layer: number;
}

export interface LayoutEdge {
  readonly from: string;
  readonly to: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

export interface DAGLayout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly width: number;
  readonly height: number;
}

// ── Constants ───────────────────────────────────────────

const NODE_WIDTH = 120;
const NODE_HEIGHT = 80;
const VERTICAL_GAP = 120;
const HORIZONTAL_GAP = 160;
const PADDING = 40;

// ── Topological Sort (Kahn's Algorithm) ─────────────────

function topologicalSort(
  nodeIds: readonly string[],
  edges: readonly WorkflowEdgeDef[],
): readonly string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, readonly string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If nodes remain (cycle detected), append them at the end
  for (const id of nodeIds) {
    if (!sorted.includes(id)) {
      sorted.push(id);
    }
  }

  return sorted;
}

// ── Layer Assignment ────────────────────────────────────

function assignLayers(
  sortedIds: readonly string[],
  edges: readonly WorkflowEdgeDef[],
): ReadonlyMap<string, number> {
  const layers = new Map<string, number>();

  for (const id of sortedIds) {
    layers.set(id, 0);
  }

  // For each node, its layer = max(layer of predecessors) + 1
  for (const id of sortedIds) {
    const predecessorEdges = edges.filter((e) => e.to === id);
    if (predecessorEdges.length > 0) {
      const maxPredLayer = Math.max(
        ...predecessorEdges.map((e) => layers.get(e.from) ?? 0),
      );
      layers.set(id, maxPredLayer + 1);
    }
  }

  return layers;
}

// ── Main Layout Function ────────────────────────────────

export function computeDAGLayout(
  nodes: readonly WorkflowNodeDef[],
  edges: readonly WorkflowEdgeDef[],
): DAGLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const nodeIds = nodes.map((n) => n.id);
  const sorted = topologicalSort(nodeIds, edges);
  const layerMap = assignLayers(sorted, edges);

  // Group nodes by layer
  const layerGroups = new Map<number, string[]>();
  for (const id of sorted) {
    const layer = layerMap.get(id) ?? 0;
    const existing = layerGroups.get(layer) ?? [];
    layerGroups.set(layer, [...existing, id]);
  }

  const maxLayer = Math.max(...layerMap.values(), 0);

  // Find the widest layer for centering
  let maxNodesInLayer = 0;
  for (const group of layerGroups.values()) {
    maxNodesInLayer = Math.max(maxNodesInLayer, group.length);
  }

  const totalWidth = maxNodesInLayer * (NODE_WIDTH + HORIZONTAL_GAP) - HORIZONTAL_GAP + PADDING * 2;

  // Position nodes
  const positionMap = new Map<string, { readonly x: number; readonly y: number }>();

  for (let layer = 0; layer <= maxLayer; layer++) {
    const group = layerGroups.get(layer) ?? [];
    const layerWidth = group.length * (NODE_WIDTH + HORIZONTAL_GAP) - HORIZONTAL_GAP;
    const startX = (totalWidth - layerWidth) / 2;

    for (let i = 0; i < group.length; i++) {
      const nodeId = group[i];
      if (nodeId === undefined) continue;
      const x = startX + i * (NODE_WIDTH + HORIZONTAL_GAP);
      const y = PADDING + layer * (NODE_HEIGHT + VERTICAL_GAP);
      positionMap.set(nodeId, { x, y });
    }
  }

  // Build layout nodes
  const layoutNodes: readonly LayoutNode[] = sorted.map((id) => {
    const pos = positionMap.get(id) ?? { x: PADDING, y: PADDING };
    return {
      id,
      x: pos.x,
      y: pos.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      layer: layerMap.get(id) ?? 0,
    };
  });

  // Build layout edges with pixel coordinates
  const layoutEdges: readonly LayoutEdge[] = edges.map((edge) => {
    const fromPos = positionMap.get(edge.from) ?? { x: 0, y: 0 };
    const toPos = positionMap.get(edge.to) ?? { x: 0, y: 0 };
    return {
      from: edge.from,
      to: edge.to,
      fromX: fromPos.x + NODE_WIDTH / 2,
      fromY: fromPos.y + NODE_HEIGHT,
      toX: toPos.x + NODE_WIDTH / 2,
      toY: toPos.y,
    };
  });

  const totalHeight = (maxLayer + 1) * (NODE_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP + PADDING * 2;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: Math.max(totalWidth, NODE_WIDTH + PADDING * 2),
    height: Math.max(totalHeight, NODE_HEIGHT + PADDING * 2),
  };
}

// ── Edge Helpers ────────────────────────────────────────

/** Derives edges from node dependency arrays. */
export function deriveEdges(nodes: readonly WorkflowNodeDef[]): readonly WorkflowEdgeDef[] {
  const edges: WorkflowEdgeDef[] = [];
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      edges.push({ from: dep, to: node.id });
    }
  }
  return edges;
}
