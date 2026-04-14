/**
 * Structured inter-agent messaging with path-based addresses.
 * Inspired by Codex CLI v2's multi-agent messaging system.
 *
 * Agents have addresses like /root/planner, /root/worker-1, /root/reviewer.
 * They can fork_context, send_message, assign_task, and list_agents.
 *
 * All state is immutable — mutations return new objects, internal maps
 * are never exposed.
 */

import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────────────────────

export type AgentStatus = "idle" | "busy" | "done" | "failed";

export type MessageType = "task" | "result" | "context" | "status" | "error";

export interface AgentAddress {
  readonly path: string;
  readonly role: string;
  readonly status: AgentStatus;
}

export interface AgentMessage {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly type: MessageType;
  readonly content: string;
  readonly timestamp: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ForkedContext {
  readonly parentPath: string;
  readonly childPath: string;
  readonly contextSlice: string;
  readonly forkedAt: number;
}

export interface DeliveryResult {
  readonly delivered: boolean;
  readonly messageId: string;
  readonly reason?: string;
}

export type MessageFilter = {
  readonly type?: MessageType;
  readonly from?: string;
};

// ── Validation ───────────────────────────────────────────────

const AGENT_PATH_PATTERN = /^\/[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;
const BROADCAST_ADDRESS = "*";

function isValidAgentPath(path: string): boolean {
  return AGENT_PATH_PATTERN.test(path);
}

function validateAgentPath(path: string): void {
  if (!isValidAgentPath(path)) {
    throw new Error(
      `Invalid agent path "${path}". Must match pattern like /root/worker-1`,
    );
  }
}

// ── Agent Message Bus ────────────────────────────────────────

export class AgentMessageBus {
  private readonly agents: Map<string, AgentAddress> = new Map();
  private readonly messages: AgentMessage[] = [];
  private readonly contexts: ForkedContext[] = [];

  /**
   * Register an agent at a unique path.
   * Throws if path is already taken or invalid.
   */
  register(path: string, role: string): AgentAddress {
    validateAgentPath(path);

    if (this.agents.has(path)) {
      throw new Error(`Agent path already registered: ${path}`);
    }

    const agent: AgentAddress = { path, role, status: "idle" };
    this.agents.set(path, agent);
    return agent;
  }

  /**
   * Unregister an agent, removing it from the bus.
   * Returns true if the agent was found and removed.
   */
  unregister(path: string): boolean {
    return this.agents.delete(path);
  }

  /**
   * Update an agent's status. Returns the updated address.
   * Throws if the agent is not registered.
   */
  updateStatus(path: string, status: AgentStatus): AgentAddress {
    const existing = this.agents.get(path);
    if (!existing) {
      throw new Error(`Agent not registered: ${path}`);
    }

    const updated: AgentAddress = { ...existing, status };
    this.agents.set(path, updated);
    return updated;
  }

  /**
   * Send a message between agents.
   * Validates sender exists and recipient exists (or is broadcast).
   */
  send(
    message: Omit<AgentMessage, "id" | "timestamp">,
  ): DeliveryResult {
    if (!this.agents.has(message.from)) {
      return {
        delivered: false,
        messageId: "",
        reason: `Sender not registered: ${message.from}`,
      };
    }

    if (message.to !== BROADCAST_ADDRESS && !this.agents.has(message.to)) {
      return {
        delivered: false,
        messageId: "",
        reason: `Recipient not registered: ${message.to}`,
      };
    }

    const fullMessage: AgentMessage = {
      ...message,
      id: randomUUID(),
      timestamp: Date.now(),
      metadata: message.metadata ? { ...message.metadata } : undefined,
    };

    this.messages.push(fullMessage);

    return { delivered: true, messageId: fullMessage.id };
  }

  /**
   * Get messages for an agent (including broadcasts).
   * Optionally filter by timestamp and message type.
   */
  getMessages(
    agentPath: string,
    since?: number,
    filter?: MessageFilter,
  ): readonly AgentMessage[] {
    const cutoff = since ?? 0;

    return this.messages.filter((msg) => {
      if (msg.timestamp < cutoff) return false;
      if (msg.to !== agentPath && msg.to !== BROADCAST_ADDRESS) return false;
      if (filter?.type && msg.type !== filter.type) return false;
      if (filter?.from && msg.from !== filter.from) return false;
      return true;
    });
  }

  /**
   * Get all messages sent by an agent.
   */
  getSentMessages(agentPath: string, since?: number): readonly AgentMessage[] {
    const cutoff = since ?? 0;
    return this.messages.filter(
      (msg) => msg.from === agentPath && msg.timestamp >= cutoff,
    );
  }

  /**
   * Fork context from parent to child agent.
   * Both agents must be registered. The child receives a slice
   * of the parent's context to operate on independently.
   */
  forkContext(
    parentPath: string,
    childPath: string,
    contextSlice: string,
  ): ForkedContext {
    if (!this.agents.has(parentPath)) {
      throw new Error(`Parent agent not registered: ${parentPath}`);
    }
    if (!this.agents.has(childPath)) {
      throw new Error(`Child agent not registered: ${childPath}`);
    }

    const forked: ForkedContext = {
      parentPath,
      childPath,
      contextSlice,
      forkedAt: Date.now(),
    };

    this.contexts.push(forked);

    // Also send a context message to the child
    this.send({
      from: parentPath,
      to: childPath,
      type: "context",
      content: contextSlice,
      metadata: { forkedAt: forked.forkedAt },
    });

    return forked;
  }

  /**
   * Get all forked contexts for an agent (as child or parent).
   */
  getForkedContexts(agentPath: string): readonly ForkedContext[] {
    return this.contexts.filter(
      (ctx) => ctx.parentPath === agentPath || ctx.childPath === agentPath,
    );
  }

  /**
   * List all registered agents, optionally filtered by status.
   */
  listAgents(statusFilter?: AgentStatus): readonly AgentAddress[] {
    const all = [...this.agents.values()];
    if (!statusFilter) return all;
    return all.filter((a) => a.status === statusFilter);
  }

  /**
   * Get a specific agent by path. Returns undefined if not found.
   */
  getAgent(path: string): AgentAddress | undefined {
    return this.agents.get(path);
  }

  /**
   * Assign a task to an agent. Sets the agent to "busy" status
   * and sends a task message with file assignments.
   */
  assignTask(
    agentPath: string,
    task: string,
    files: readonly string[],
  ): DeliveryResult {
    const agent = this.agents.get(agentPath);
    if (!agent) {
      return {
        delivered: false,
        messageId: "",
        reason: `Agent not registered: ${agentPath}`,
      };
    }

    if (agent.status === "busy") {
      return {
        delivered: false,
        messageId: "",
        reason: `Agent is busy: ${agentPath}`,
      };
    }

    // Transition agent to busy
    this.updateStatus(agentPath, "busy");

    // Find the assigner — use the parent path or /root as default
    const parentPath = agentPath.split("/").slice(0, -1).join("/") || "/root";
    const fromPath = this.agents.has(parentPath) ? parentPath : agentPath;

    return this.send({
      from: fromPath,
      to: agentPath,
      type: "task",
      content: task,
      metadata: { files: [...files], assignedAt: Date.now() },
    });
  }

  /**
   * Broadcast a message to all agents (using "*" address).
   */
  broadcast(
    fromPath: string,
    type: MessageType,
    content: string,
  ): DeliveryResult {
    return this.send({
      from: fromPath,
      to: BROADCAST_ADDRESS,
      type,
      content,
    });
  }

  /**
   * Get total message count for monitoring.
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * Get total registered agent count.
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Clear all messages (for testing or memory management).
   */
  clearMessages(): void {
    this.messages.length = 0;
  }
}
