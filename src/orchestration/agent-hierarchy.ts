/**
 * Agent Hierarchy Limiter -- prevents cascading agent failures by enforcing
 * a maximum hierarchy depth. Inspired by Perplexity's 2-level agent model
 * (parent + children only, no grandchildren).
 *
 * Without depth limits, agents spawning agents can create exponential
 * resource consumption and cascading failures. This module enforces a strict
 * ceiling on nesting depth and tracks the full agent tree.
 *
 * Default max depth: 2 (root at depth 0, children at depth 1).
 */


// -- Types -------------------------------------------------------------------

export type AgentStatus = "pending" | "running" | "completed" | "failed";

export interface AgentNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly taskDescription: string;
  readonly status: AgentStatus;
  readonly startedAt: number;
  readonly childIds: readonly string[];
}

// -- Internal mutable type ---------------------------------------------------

interface MutableAgentNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly taskDescription: string;
  status: AgentStatus;
  readonly startedAt: number;
  childIds: string[];
}

function toReadonly(node: MutableAgentNode): AgentNode {
  return {
    id: node.id,
    parentId: node.parentId,
    depth: node.depth,
    taskDescription: node.taskDescription,
    status: node.status,
    startedAt: node.startedAt,
    childIds: [...node.childIds],
  };
}

// -- Implementation ----------------------------------------------------------

export class AgentHierarchyManager {
  private readonly maxDepth: number;
  private readonly nodes: Map<string, MutableAgentNode> = new Map();

  constructor(maxDepth: number = 2) {
    if (maxDepth < 1) {
      throw new Error(`maxDepth must be >= 1, got ${maxDepth}`);
    }
    this.maxDepth = maxDepth;
  }

  /**
   * Register a new agent in the hierarchy.
   * Throws if adding this agent would exceed the max depth.
   */
  registerAgent(id: string, parentId: string | null, task: string): AgentNode {
    if (this.nodes.has(id)) {
      throw new Error(`Agent "${id}" is already registered`);
    }

    let depth = 0;

    if (parentId !== null) {
      const parent = this.nodes.get(parentId);
      if (!parent) {
        throw new Error(`Parent agent "${parentId}" not found`);
      }

      depth = parent.depth + 1;

      if (depth >= this.maxDepth) {
        throw new Error(
          `Cannot spawn child at depth ${depth}: max depth is ${this.maxDepth}. ` +
          `Agent "${parentId}" at depth ${parent.depth} cannot have children.`,
        );
      }

      // Record this child in the parent
      parent.childIds.push(id);
    }

    const node: MutableAgentNode = {
      id,
      parentId,
      depth,
      taskDescription: task,
      status: "pending",
      startedAt: Date.now(),
      childIds: [],
    };

    this.nodes.set(id, node);
    return toReadonly(node);
  }

  /**
   * Check whether a given parent agent is allowed to spawn a child.
   */
  canSpawnChild(parentId: string): boolean {
    const parent = this.nodes.get(parentId);
    if (!parent) return false;
    return parent.depth + 1 < this.maxDepth;
  }

  /**
   * Get the full hierarchy as an immutable array.
   */
  getTree(): readonly AgentNode[] {
    return [...this.nodes.values()].map(toReadonly);
  }

  /**
   * Get all agents at a specific depth.
   */
  getAtDepth(depth: number): readonly AgentNode[] {
    return [...this.nodes.values()]
      .filter((n) => n.depth === depth)
      .map(toReadonly);
  }

  /**
   * Update an agent's status.
   */
  updateStatus(id: string, status: AgentStatus): void {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Agent "${id}" not found`);
    }
    node.status = status;
  }

  /**
   * Get the count of active (pending or running) agents.
   */
  getActiveCount(): number {
    let count = 0;
    for (const node of this.nodes.values()) {
      if (node.status === "pending" || node.status === "running") {
        count++;
      }
    }
    return count;
  }

  /**
   * Get a single agent by ID.
   */
  getAgent(id: string): AgentNode | null {
    const node = this.nodes.get(id);
    return node ? toReadonly(node) : null;
  }

  /**
   * Get the configured max depth.
   */
  getMaxDepth(): number {
    return this.maxDepth;
  }

  /**
   * Get all children of a given agent.
   */
  getChildren(parentId: string): readonly AgentNode[] {
    const parent = this.nodes.get(parentId);
    if (!parent) return [];

    return parent.childIds
      .map((id) => this.nodes.get(id))
      .filter((n): n is MutableAgentNode => n !== undefined)
      .map(toReadonly);
  }

  /**
   * Get summary statistics for the hierarchy.
   */
  getSummary(): {
    readonly totalAgents: number;
    readonly activeAgents: number;
    readonly completedAgents: number;
    readonly failedAgents: number;
    readonly maxDepthReached: number;
    readonly maxDepthAllowed: number;
  } {
    let active = 0;
    let completed = 0;
    let failed = 0;
    let deepest = 0;

    for (const node of this.nodes.values()) {
      if (node.status === "pending" || node.status === "running") active++;
      if (node.status === "completed") completed++;
      if (node.status === "failed") failed++;
      if (node.depth > deepest) deepest = node.depth;
    }

    return {
      totalAgents: this.nodes.size,
      activeAgents: active,
      completedAgents: completed,
      failedAgents: failed,
      maxDepthReached: deepest,
      maxDepthAllowed: this.maxDepth,
    };
  }
}
