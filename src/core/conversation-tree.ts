/**
 * Conversation Tree — branching conversations with model comparison.
 *
 * FEATURES:
 * - Branch at any point in the conversation to try different approaches
 * - Compare branches side-by-side (model A vs model B for the same prompt)
 * - Merge successful branches back to main
 * - Session replay: replay all tool calls from a saved session
 * - Clipboard integration: quick copy/paste of code blocks
 * - Project-scoped command history with search
 */

import { randomUUID } from "node:crypto";
import type { AgentMessage } from "./types.js";

// ── Conversation Tree ────────────────────────────────────

export interface ConversationNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly message: AgentMessage;
  readonly timestamp: number;
  readonly branchLabel?: string;
  readonly model?: string;
  readonly provider?: string;
}

export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly rootNodeId: string;
  readonly createdAt: number;
  readonly active: boolean;
}

export class ConversationTree {
  private nodes: Map<string, ConversationNode> = new Map();
  private branches: Map<string, Branch> = new Map();
  private currentBranchId: string;
  private currentNodeId: string | null = null;

  constructor() {
    const mainBranch: Branch = {
      id: "main",
      name: "main",
      rootNodeId: "",
      createdAt: Date.now(),
      active: true,
    };
    this.branches.set("main", mainBranch);
    this.currentBranchId = "main";
  }

  /**
   * Add a message to the current branch.
   */
  addMessage(message: AgentMessage, model?: string, provider?: string): string {
    const node: ConversationNode = {
      id: randomUUID(),
      parentId: this.currentNodeId,
      message,
      timestamp: Date.now(),
      model,
      provider,
    };
    this.nodes.set(node.id, node);
    this.currentNodeId = node.id;

    // Update branch root if this is the first node
    const branch = this.branches.get(this.currentBranchId);
    if (branch && !branch.rootNodeId) {
      this.branches.set(this.currentBranchId, { ...branch, rootNodeId: node.id });
    }

    return node.id;
  }

  /**
   * Create a new branch from the current position.
   * The branch starts at the current node and diverges from there.
   */
  createBranch(name: string): string {
    const branchId = randomUUID();
    const branch: Branch = {
      id: branchId,
      name,
      rootNodeId: this.currentNodeId ?? "",
      createdAt: Date.now(),
      active: true,
    };
    this.branches.set(branchId, branch);
    return branchId;
  }

  /**
   * Switch to a different branch.
   */
  switchBranch(branchId: string): boolean {
    const branch = this.branches.get(branchId);
    if (!branch) return false;
    this.currentBranchId = branchId;
    this.currentNodeId = branch.rootNodeId || null;
    return true;
  }

  /**
   * Get the linear history of messages for the current branch.
   */
  getHistory(): readonly ConversationNode[] {
    const history: ConversationNode[] = [];
    let nodeId = this.currentNodeId;

    while (nodeId) {
      const node = this.nodes.get(nodeId);
      if (!node) break;
      history.unshift(node);
      nodeId = node.parentId;
    }

    return history;
  }

  /**
   * Get messages as AgentMessage array (for passing to providers).
   */
  getMessages(): readonly AgentMessage[] {
    return this.getHistory().map((n) => n.message);
  }

  /**
   * Get all branches.
   */
  getBranches(): readonly Branch[] {
    return [...this.branches.values()];
  }

  /**
   * Get the current branch name.
   */
  getCurrentBranch(): string {
    return this.currentBranchId;
  }

  /**
   * Get the total node count.
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Compare two branches: return messages that differ.
   */
  compareBranches(branchAId: string, branchBId: string): {
    readonly common: readonly ConversationNode[];
    readonly onlyA: readonly ConversationNode[];
    readonly onlyB: readonly ConversationNode[];
  } {
    const savedBranch = this.currentBranchId;
    const savedNode = this.currentNodeId;

    this.switchBranch(branchAId);
    const historyA = this.getHistory();

    this.switchBranch(branchBId);
    const historyB = this.getHistory();

    // Restore
    this.currentBranchId = savedBranch;
    this.currentNodeId = savedNode;

    const idsA = new Set(historyA.map((n) => n.id));
    const idsB = new Set(historyB.map((n) => n.id));

    return {
      common: historyA.filter((n) => idsB.has(n.id)),
      onlyA: historyA.filter((n) => !idsB.has(n.id)),
      onlyB: historyB.filter((n) => !idsA.has(n.id)),
    };
  }
}

// ── Session Replay ───────────────────────────────────────

export interface ReplayEvent {
  readonly type: "message" | "tool_call" | "tool_result";
  readonly timestamp: number;
  readonly data: Record<string, unknown>;
}

/**
 * Record events for session replay.
 */
export class SessionRecorder {
  private events: ReplayEvent[] = [];
  private recording = false;

  startRecording(): void {
    this.recording = true;
    this.events = [];
  }

  stopRecording(): readonly ReplayEvent[] {
    this.recording = false;
    return this.events;
  }

  isRecording(): boolean {
    return this.recording;
  }

  recordEvent(event: ReplayEvent): void {
    if (this.recording) {
      this.events.push(event);
    }
  }

  getEvents(): readonly ReplayEvent[] {
    return this.events;
  }

  getEventCount(): number {
    return this.events.length;
  }
}

// ── Command History ──────────────────────────────────────

export class CommandHistory {
  private history: string[] = [];
  private position = -1;
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  add(command: string): void {
    // Don't add duplicates of the last command
    if (this.history.length > 0 && this.history[this.history.length - 1] === command) {
      return;
    }
    this.history.push(command);
    if (this.history.length > this.maxSize) {
      this.history.shift();
    }
    this.position = this.history.length;
  }

  previous(): string | null {
    if (this.position > 0) {
      this.position--;
      return this.history[this.position] ?? null;
    }
    return null;
  }

  next(): string | null {
    if (this.position < this.history.length - 1) {
      this.position++;
      return this.history[this.position] ?? null;
    }
    this.position = this.history.length;
    return null;
  }

  search(query: string): readonly string[] {
    return this.history.filter((h) => h.toLowerCase().includes(query.toLowerCase()));
  }

  getAll(): readonly string[] {
    return this.history;
  }

  size(): number {
    return this.history.length;
  }
}
