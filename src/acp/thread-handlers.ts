/**
 * ACP thread handlers — wires ConversationBranchManager to ACP RPC.
 *
 * Exposes thread/fork, thread/rollback, thread/list, thread/switch as
 * first-class ACP methods so IDE hosts (Zed, Kiro, Goose) can drive
 * the conversation tree the same way they drive prompts.
 *
 * Each handler takes an injected `getManager(sessionId)` callback so
 * callers can route to the right per-session branch manager. Pure
 * handlers — no I/O, no side effects beyond manager mutation.
 */

import type {
  AcpThreadForkParams,
  AcpThreadForkResult,
  AcpThreadRollbackParams,
  AcpThreadRollbackResult,
  AcpThreadListParams,
  AcpThreadListResult,
  AcpThreadSwitchParams,
  AcpThreadSwitchResult,
} from "./protocol.js";
import type { ConversationBranchManager } from "../core/conversation-branching.js";

// ── Types ──────────────────────────────────────────────

export type ManagerLookup = (sessionId: string) => ConversationBranchManager | null;

export interface ThreadHandlerDeps {
  readonly getManager: ManagerLookup;
}

// ── Handlers ───────────────────────────────────────────

export function handleThreadFork(
  params: AcpThreadForkParams,
  deps: ThreadHandlerDeps,
): AcpThreadForkResult {
  const manager = deps.getManager(params.sessionId);
  if (!manager) {
    throw new Error(`thread/fork: no branch manager for session ${params.sessionId}`);
  }
  const branch = manager.fork(params.name, params.fromTurnId);
  return {
    branchId: branch.id,
    name: branch.name,
    forkPoint: branch.forkPoint,
    inheritedTurnCount: branch.turns.length,
  };
}

export function handleThreadRollback(
  params: AcpThreadRollbackParams,
  deps: ThreadHandlerDeps,
): AcpThreadRollbackResult {
  const manager = deps.getManager(params.sessionId);
  if (!manager) {
    throw new Error(`thread/rollback: no branch manager for session ${params.sessionId}`);
  }
  if (params.n !== undefined && params.toTurnId !== undefined) {
    throw new Error("thread/rollback: provide exactly one of `n` or `toTurnId`");
  }
  if (params.n === undefined && params.toTurnId === undefined) {
    throw new Error("thread/rollback: must provide `n` or `toTurnId`");
  }

  const dropped =
    params.toTurnId !== undefined
      ? manager.rollbackToTurn(params.toTurnId)
      : manager.rollback(params.n ?? 0);
  if (dropped === null) {
    throw new Error(`thread/rollback: turn ${params.toTurnId} not found in active branch`);
  }
  return {
    droppedTurnCount: dropped.length,
    droppedTurnIds: dropped.map((t) => t.id),
  };
}

export function handleThreadList(
  params: AcpThreadListParams,
  deps: ThreadHandlerDeps,
): AcpThreadListResult {
  const manager = deps.getManager(params.sessionId);
  if (!manager) {
    throw new Error(`thread/list: no branch manager for session ${params.sessionId}`);
  }
  const activeId = manager.getActiveBranch().id;
  return {
    branches: manager.listBranches().map((b) => ({
      id: b.id,
      name: b.name,
      turnCount: b.turns.length,
      forkPoint: b.forkPoint,
      isActive: b.id === activeId,
    })),
  };
}

export function handleThreadSwitch(
  params: AcpThreadSwitchParams,
  deps: ThreadHandlerDeps,
): AcpThreadSwitchResult {
  const manager = deps.getManager(params.sessionId);
  if (!manager) {
    throw new Error(`thread/switch: no branch manager for session ${params.sessionId}`);
  }
  const switched = manager.switchBranch(params.nameOrId);
  return {
    switched,
    activeBranchId: manager.getActiveBranch().id,
  };
}

// ── Dispatch wrapper ──────────────────────────────────

/**
 * Dispatch an ACP thread method by name. Returns the result, or
 * null when the method isn't a thread op.
 */
export function dispatchThreadMethod(
  method: string,
  params: unknown,
  deps: ThreadHandlerDeps,
): unknown | null {
  switch (method) {
    case "thread/fork":
      return handleThreadFork(params as AcpThreadForkParams, deps);
    case "thread/rollback":
      return handleThreadRollback(params as AcpThreadRollbackParams, deps);
    case "thread/list":
      return handleThreadList(params as AcpThreadListParams, deps);
    case "thread/switch":
      return handleThreadSwitch(params as AcpThreadSwitchParams, deps);
    default:
      return null;
  }
}
