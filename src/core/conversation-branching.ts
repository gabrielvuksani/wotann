/**
 * Conversation Branching — explore alternate paths from any turn.
 *
 * Like git branches for conversations. Fork at any point, try different
 * approaches, compare results, merge back the best branch.
 *
 * Builds on the existing conversation-tree.ts but adds:
 * - Named branches
 * - Branch comparison (diff two branches' outputs)
 * - Merge best results
 * - Branch persistence across sessions
 */

import { randomUUID } from "node:crypto";

export interface ConversationTurn {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly timestamp: number;
  readonly parentId: string | null;
  readonly branchId: string;
  readonly metadata?: Record<string, string>;
}

export interface ConversationBranch {
  readonly id: string;
  readonly name: string;
  readonly forkPoint: string | null; // Turn ID where this branch forked
  readonly createdAt: number;
  readonly turns: readonly ConversationTurn[];
  readonly metadata?: Record<string, string>;
}

export interface BranchComparison {
  readonly branchA: string;
  readonly branchB: string;
  readonly commonTurns: number;
  readonly divergentTurnsA: number;
  readonly divergentTurnsB: number;
  readonly forkPointId: string | null;
}

export class ConversationBranchManager {
  private branches: Map<string, ConversationBranch> = new Map();
  private activeBranchId: string;
  private turnIdCounter = 0;

  constructor() {
    const mainId = "main";
    const mainBranch: ConversationBranch = {
      id: mainId,
      name: "main",
      forkPoint: null,
      createdAt: Date.now(),
      turns: [],
    };
    this.branches.set(mainId, mainBranch);
    this.activeBranchId = mainId;
  }

  /** Get the active branch */
  getActiveBranch(): ConversationBranch {
    return this.branches.get(this.activeBranchId)!;
  }

  /** Get a branch by name or ID */
  getBranch(nameOrId: string): ConversationBranch | null {
    // Try by ID first
    const byId = this.branches.get(nameOrId);
    if (byId) return byId;

    // Then by name
    for (const branch of this.branches.values()) {
      if (branch.name === nameOrId) return branch;
    }

    return null;
  }

  /** List all branches */
  listBranches(): readonly ConversationBranch[] {
    return [...this.branches.values()];
  }

  /** Add a turn to the active branch */
  addTurn(role: "user" | "assistant" | "system" | "tool", content: string, metadata?: Record<string, string>): ConversationTurn {
    const branch = this.getActiveBranch();
    const lastTurn = branch.turns[branch.turns.length - 1];

    const turn: ConversationTurn = {
      id: `turn_${++this.turnIdCounter}`,
      role,
      content,
      timestamp: Date.now(),
      parentId: lastTurn?.id ?? null,
      branchId: this.activeBranchId,
      metadata,
    };

    this.branches.set(this.activeBranchId, {
      ...branch,
      turns: [...branch.turns, turn],
    });

    return turn;
  }

  /**
   * Fork a new branch from a specific turn (or from current position).
   */
  fork(name: string, fromTurnId?: string): ConversationBranch {
    const currentBranch = this.getActiveBranch();
    const forkIdx = fromTurnId
      ? currentBranch.turns.findIndex((t) => t.id === fromTurnId)
      : currentBranch.turns.length - 1;

    // Copy turns up to fork point
    const inheritedTurns = forkIdx >= 0
      ? currentBranch.turns.slice(0, forkIdx + 1)
      : [];

    const branchId = randomUUID().slice(0, 8);
    const newBranch: ConversationBranch = {
      id: branchId,
      name,
      forkPoint: fromTurnId ?? currentBranch.turns[forkIdx]?.id ?? null,
      createdAt: Date.now(),
      turns: inheritedTurns.map((t) => ({ ...t, branchId })),
    };

    this.branches.set(branchId, newBranch);
    return newBranch;
  }

  /** Switch to a different branch */
  switchBranch(nameOrId: string): boolean {
    const branch = this.getBranch(nameOrId);
    if (!branch) return false;
    this.activeBranchId = branch.id;
    return true;
  }

  /** Delete a branch (cannot delete main or active) */
  deleteBranch(nameOrId: string): boolean {
    const branch = this.getBranch(nameOrId);
    if (!branch || branch.name === "main" || branch.id === this.activeBranchId) {
      return false;
    }
    this.branches.delete(branch.id);
    return true;
  }

  /** Compare two branches */
  compare(branchA: string, branchB: string): BranchComparison | null {
    const a = this.getBranch(branchA);
    const b = this.getBranch(branchB);
    if (!a || !b) return null;

    // Find common turns
    let commonCount = 0;
    for (let i = 0; i < Math.min(a.turns.length, b.turns.length); i++) {
      if (a.turns[i]!.content === b.turns[i]!.content && a.turns[i]!.role === b.turns[i]!.role) {
        commonCount++;
      } else {
        break;
      }
    }

    return {
      branchA: a.id,
      branchB: b.id,
      commonTurns: commonCount,
      divergentTurnsA: a.turns.length - commonCount,
      divergentTurnsB: b.turns.length - commonCount,
      forkPointId: commonCount > 0 ? a.turns[commonCount - 1]?.id ?? null : null,
    };
  }

  /**
   * Merge a branch into the active branch.
   * Appends the divergent turns from sourceBranch after the fork point.
   */
  merge(sourceBranchNameOrId: string): boolean {
    const source = this.getBranch(sourceBranchNameOrId);
    if (!source) return false;

    const target = this.getActiveBranch();
    const comparison = this.compare(target.id, source.id);
    if (!comparison) return false;

    // Get divergent turns from source
    const newTurns = source.turns.slice(comparison.commonTurns).map((t) => ({
      ...t,
      branchId: target.id,
      id: `turn_${++this.turnIdCounter}`,
    }));

    this.branches.set(target.id, {
      ...target,
      turns: [...target.turns, ...newTurns],
    });

    return true;
  }

  /** Serialize all branches to JSON (for persistence) */
  serialize(): string {
    return JSON.stringify({
      branches: [...this.branches.entries()],
      activeBranchId: this.activeBranchId,
      turnIdCounter: this.turnIdCounter,
    });
  }

  /** Restore from serialized state */
  static deserialize(json: string): ConversationBranchManager {
    const data = JSON.parse(json) as {
      branches: [string, ConversationBranch][];
      activeBranchId: string;
      turnIdCounter: number;
    };

    const manager = new ConversationBranchManager();
    manager.branches = new Map(data.branches);
    manager.activeBranchId = data.activeBranchId;
    manager.turnIdCounter = data.turnIdCounter;
    return manager;
  }
}
