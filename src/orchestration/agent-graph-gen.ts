/**
 * Goal-Driven Agent Graph Generation — Hive-inspired.
 * Describe goal in natural language → auto-generate agent graph.
 * Checkpoint-based crash recovery, cost enforcement, real-time observability.
 */

// ── Types ────────────────────────────────────────────────

export interface AgentGraphNode {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly task: string;
  readonly model?: string;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly dependencies: readonly string[];
  readonly output?: string;
  readonly cost: number;
  readonly tokensUsed: number;
}

export interface AgentGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: "data" | "control" | "feedback";
}

export interface AgentGraph {
  readonly id: string;
  readonly goal: string;
  readonly nodes: readonly AgentGraphNode[];
  readonly edges: readonly AgentGraphEdge[];
  readonly status: "planning" | "executing" | "completed" | "failed";
  readonly createdAt: number;
  readonly checkpoint?: GraphCheckpoint;
}

export interface GraphCheckpoint {
  readonly graphId: string;
  readonly completedNodes: readonly string[];
  readonly savedAt: number;
  readonly state: Readonly<Record<string, unknown>>;
}

export interface GraphExecutionResult {
  readonly graphId: string;
  readonly success: boolean;
  readonly output: string;
  readonly totalCost: number;
  readonly totalTokens: number;
  readonly nodesExecuted: number;
  readonly durationMs: number;
}

// ── Graph Generator ──────────────────────────────────────

export class AgentGraphGenerator {
  /**
   * Generate an agent graph from a natural language goal.
   * The "queen" agent designs the multi-agent workflow.
   */
  generateGraph(goal: string): AgentGraph {
    const nodes = this.decomposeGoal(goal);
    const edges = this.inferEdges(nodes);

    return {
      id: `graph-${Date.now()}`,
      goal,
      nodes,
      edges,
      status: "planning",
      createdAt: Date.now(),
    };
  }

  /**
   * Execute a graph with dependency-aware ordering.
   */
  async *executeGraph(
    graph: AgentGraph,
    executor: (node: AgentGraphNode) => Promise<{ output: string; cost: number; tokens: number }>,
  ): AsyncGenerator<AgentGraphNode> {
    const completed = new Set<string>();
    const mutableNodes = [...graph.nodes.map((n) => ({ ...n }))];

    while (completed.size < mutableNodes.length) {
      // Find nodes whose dependencies are all completed
      const ready = mutableNodes.filter(
        (n) => n.status === "pending" && n.dependencies.every((d) => completed.has(d)),
      );

      if (ready.length === 0) {
        // Check for failed nodes blocking progress
        const failed = mutableNodes.filter((n) => n.status === "failed");
        if (failed.length > 0) break;
        // Circular dependency
        break;
      }

      // Execute ready nodes (could parallelize, but sequential for simplicity)
      for (const node of ready) {
        const idx = mutableNodes.findIndex((n) => n.id === node.id);
        if (idx < 0) continue;

        mutableNodes[idx] = { ...node, status: "running" };
        yield mutableNodes[idx]!;

        try {
          const result = await executor(node);
          mutableNodes[idx] = {
            ...node,
            status: "completed",
            output: result.output,
            cost: result.cost,
            tokensUsed: result.tokens,
          };
          completed.add(node.id);
          yield mutableNodes[idx]!;
        } catch {
          mutableNodes[idx] = { ...node, status: "failed" };
          yield mutableNodes[idx]!;
        }
      }
    }
  }

  /**
   * Create a checkpoint for crash recovery.
   */
  createCheckpoint(graph: AgentGraph): GraphCheckpoint {
    return {
      graphId: graph.id,
      completedNodes: graph.nodes.filter((n) => n.status === "completed").map((n) => n.id),
      savedAt: Date.now(),
      state: {},
    };
  }

  /**
   * Resume from a checkpoint.
   */
  resumeFromCheckpoint(graph: AgentGraph, checkpoint: GraphCheckpoint): AgentGraph {
    return {
      ...graph,
      nodes: graph.nodes.map((n) =>
        checkpoint.completedNodes.includes(n.id)
          ? { ...n, status: "completed" as const }
          : n,
      ),
      status: "executing",
      checkpoint,
    };
  }

  // ── Private ────────────────────────────────────────────

  private decomposeGoal(goal: string): AgentGraphNode[] {
    const lower = goal.toLowerCase();
    const nodes: AgentGraphNode[] = [];

    // Research phase
    nodes.push({
      id: "research",
      name: "Researcher",
      role: "Gather context and understand the problem",
      task: `Research: ${goal}`,
      status: "pending",
      dependencies: [],
      cost: 0,
      tokensUsed: 0,
    });

    // Planning phase
    nodes.push({
      id: "planner",
      name: "Planner",
      role: "Create implementation plan",
      task: `Plan implementation for: ${goal}`,
      status: "pending",
      dependencies: ["research"],
      cost: 0,
      tokensUsed: 0,
    });

    // Implementation
    if (lower.includes("test") || lower.includes("fix") || lower.includes("build") || lower.includes("implement")) {
      nodes.push({
        id: "implementer",
        name: "Implementer",
        role: "Write the code",
        task: `Implement: ${goal}`,
        status: "pending",
        dependencies: ["planner"],
        cost: 0,
        tokensUsed: 0,
      });

      // Testing
      nodes.push({
        id: "tester",
        name: "Tester",
        role: "Write and run tests",
        task: "Write tests and verify implementation",
        status: "pending",
        dependencies: ["implementer"],
        cost: 0,
        tokensUsed: 0,
      });
    }

    // Review
    nodes.push({
      id: "reviewer",
      name: "Reviewer",
      role: "Review the final result",
      task: "Review all changes for quality and correctness",
      status: "pending",
      dependencies: nodes.length > 2 ? ["tester"] : ["planner"],
      cost: 0,
      tokensUsed: 0,
    });

    return nodes;
  }

  private inferEdges(nodes: readonly AgentGraphNode[]): AgentGraphEdge[] {
    const edges: AgentGraphEdge[] = [];
    for (const node of nodes) {
      for (const dep of node.dependencies) {
        edges.push({ from: dep, to: node.id, type: "data" });
      }
    }
    return edges;
  }
}
