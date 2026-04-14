/**
 * Graph DSL for orchestration: chain, fanout, merge, on_failure.
 * Defines agent workflows as directed acyclic graphs.
 */

export type NodeType = "task" | "fanout" | "merge" | "conditional" | "checkpoint";

export interface GraphNode {
  readonly id: string;
  readonly type: NodeType;
  readonly label: string;
  readonly handler?: string;
  readonly successCriteria?: string;
  readonly onFailure?: "retry" | "skip" | "abort" | "fallback";
  readonly maxRetries?: number;
  readonly fallbackNode?: string;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly condition?: string;
}

export interface ExecutionGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly entryNode: string;
}

export interface GraphExecutionResult {
  readonly nodeId: string;
  readonly status: "success" | "failure" | "skipped";
  readonly output?: string;
  readonly duration: number;
}

// ── DSL Builder ─────────────────────────────────────────────

export class GraphBuilder {
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private entryNode: string = "";

  chain(...nodeIds: string[]): GraphBuilder {
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const from = nodeIds[i]!;
      const to = nodeIds[i + 1]!;
      this.edges.push({ from, to });
    }
    if (nodeIds[0] && !this.entryNode) {
      this.entryNode = nodeIds[0];
    }
    return this;
  }

  fanout(sourceId: string, targetIds: readonly string[]): GraphBuilder {
    this.addNode({ id: `${sourceId}_fanout`, type: "fanout", label: `Fan out from ${sourceId}` });
    this.edges.push({ from: sourceId, to: `${sourceId}_fanout` });
    for (const target of targetIds) {
      this.edges.push({ from: `${sourceId}_fanout`, to: target });
    }
    return this;
  }

  merge(sourceIds: readonly string[], targetId: string): GraphBuilder {
    const mergeId = `${targetId}_merge`;
    this.addNode({ id: mergeId, type: "merge", label: `Merge into ${targetId}` });
    for (const source of sourceIds) {
      this.edges.push({ from: source, to: mergeId });
    }
    this.edges.push({ from: mergeId, to: targetId });
    return this;
  }

  addNode(node: GraphNode): GraphBuilder {
    this.nodes.push(node);
    return this;
  }

  onFailure(nodeId: string, strategy: "retry" | "skip" | "abort" | "fallback", fallbackNode?: string): GraphBuilder {
    const idx = this.nodes.findIndex((n) => n.id === nodeId);
    if (idx >= 0) {
      this.nodes[idx] = { ...this.nodes[idx]!, onFailure: strategy, fallbackNode };
    }
    return this;
  }

  build(): ExecutionGraph {
    return {
      nodes: [...this.nodes],
      edges: [...this.edges],
      entryNode: this.entryNode || (this.nodes[0]?.id ?? ""),
    };
  }
}

// ── Graph Executor ──────────────────────────────────────────

export async function executeGraph(
  graph: ExecutionGraph,
  executor: (node: GraphNode) => Promise<{ success: boolean; output: string }>,
): Promise<readonly GraphExecutionResult[]> {
  const results: GraphExecutionResult[] = [];
  const completed = new Set<string>();
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  async function executeNode(nodeId: string): Promise<void> {
    if (completed.has(nodeId)) return;

    const node = nodeMap.get(nodeId);
    if (!node) return;

    // Execute dependencies first
    const deps = graph.edges.filter((e) => e.to === nodeId).map((e) => e.from);
    for (const dep of deps) {
      await executeNode(dep);
    }

    const startTime = Date.now();
    let retries = 0;
    const maxRetries = node.maxRetries ?? 1;

    while (retries < maxRetries) {
      try {
        if (node.type === "fanout") {
          // Execute all outgoing edges in parallel
          const targets = graph.edges.filter((e) => e.from === nodeId).map((e) => e.to);
          await Promise.all(targets.map((t) => executeNode(t)));
          results.push({ nodeId, status: "success", duration: Date.now() - startTime });
          completed.add(nodeId);
          return;
        }

        if (node.type === "merge") {
          results.push({ nodeId, status: "success", duration: Date.now() - startTime });
          completed.add(nodeId);
          return;
        }

        const result = await executor(node);
        results.push({
          nodeId,
          status: result.success ? "success" : "failure",
          output: result.output,
          duration: Date.now() - startTime,
        });

        if (result.success) {
          completed.add(nodeId);
          return;
        }

        // Handle failure
        if (node.onFailure === "skip") {
          results.push({ nodeId, status: "skipped", duration: Date.now() - startTime });
          completed.add(nodeId);
          return;
        }
        if (node.onFailure === "abort") {
          throw new Error(`Node ${nodeId} failed and abort was specified`);
        }
        if (node.onFailure === "fallback" && node.fallbackNode) {
          await executeNode(node.fallbackNode);
          completed.add(nodeId);
          return;
        }

        retries++;
      } catch (error) {
        if (retries >= maxRetries - 1) {
          results.push({ nodeId, status: "failure", duration: Date.now() - startTime });
          completed.add(nodeId);
          return;
        }
        retries++;
      }
    }
  }

  await executeNode(graph.entryNode);

  // Execute remaining unexecuted nodes (those reachable from entry)
  const visited = new Set<string>();
  function collectReachable(nodeId: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const outgoing = graph.edges.filter((e) => e.from === nodeId);
    for (const edge of outgoing) {
      collectReachable(edge.to);
    }
  }
  collectReachable(graph.entryNode);

  for (const nodeId of visited) {
    if (!completed.has(nodeId)) {
      await executeNode(nodeId);
    }
  }

  return results;
}
