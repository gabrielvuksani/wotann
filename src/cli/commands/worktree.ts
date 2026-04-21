/**
 * `wotann worktree` — Cursor 3 `/worktree` slash-command port (P1-C6).
 *
 * Actions:
 *   create <taskId> [--base <ref>]    Create an isolated worktree
 *   list                              Show active + abandoned + accepted entries
 *   abandon <taskId>                  Discard a worktree and its branch
 *   accept  <taskId> --message <msg>  Merge the branch into the current branch
 *
 * Pure handler — no commander/chalk/process-exit inside. The CLI
 * entrypoint (src/index.ts) wires the subcommand and pipes options
 * here. All output is returned as structured `WorktreeRunResult`
 * plus a list of human-readable lines for the caller to print.
 *
 * Per-session state (QB #7): each invocation constructs a
 * fresh WorktreeManager unless the caller injects one. Two
 * concurrent CLI runs do not cross-contaminate.
 */

import {
  WorktreeError,
  WorktreeManager,
  type WorktreeEntry,
} from "../../orchestration/worktree-manager.js";

// ── Public types ───────────────────────────────────────────

export type WorktreeAction = "create" | "list" | "abandon" | "accept";

export interface WorktreeCommandOptions {
  readonly action: WorktreeAction;
  readonly taskId?: string;
  readonly base?: string;
  readonly message?: string;
  readonly repoRoot?: string;
  readonly worktreesDir?: string;
  /** Test injection — bypass the filesystem and git binary. */
  readonly manager?: WorktreeManager;
}

export interface WorktreeRunResult {
  readonly success: boolean;
  readonly action: WorktreeAction;
  readonly entries: readonly WorktreeEntry[];
  readonly lines: readonly string[];
  readonly error?: string;
}

// ── Entry point ────────────────────────────────────────────

export async function runWorktreeCommand(
  options: WorktreeCommandOptions,
): Promise<WorktreeRunResult> {
  const manager =
    options.manager ??
    new WorktreeManager({
      ...(options.repoRoot !== undefined ? { repoRoot: options.repoRoot } : {}),
      ...(options.worktreesDir !== undefined ? { worktreesDir: options.worktreesDir } : {}),
    });

  try {
    switch (options.action) {
      case "create":
        return await handleCreate(manager, options);
      case "abandon":
        return await handleAbandon(manager, options);
      case "accept":
        return await handleAccept(manager, options);
      case "list":
        return handleList(manager);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      action: options.action,
      entries: manager.list(),
      lines: [`error: ${reason}`],
      error: reason,
    };
  }
}

// ── Action handlers ────────────────────────────────────────

async function handleCreate(
  manager: WorktreeManager,
  options: WorktreeCommandOptions,
): Promise<WorktreeRunResult> {
  if (!options.taskId) {
    throw new WorktreeError("create requires <taskId>");
  }
  const entry = await manager.create(options.taskId, options.base);
  return {
    success: true,
    action: "create",
    entries: [entry],
    lines: [
      `✓ worktree "${entry.taskId}" created`,
      `  branch:     ${entry.branch}`,
      `  baseRef:    ${entry.baseRef}`,
      `  workspace:  ${entry.workspaceRoot}`,
    ],
  };
}

async function handleAbandon(
  manager: WorktreeManager,
  options: WorktreeCommandOptions,
): Promise<WorktreeRunResult> {
  if (!options.taskId) {
    throw new WorktreeError("abandon requires <taskId>");
  }
  const entry = await manager.abandon(options.taskId);
  return {
    success: true,
    action: "abandon",
    entries: [entry],
    lines: [
      `✓ worktree "${entry.taskId}" abandoned (status=${entry.status})`,
      `  branch:     ${entry.branch}`,
      `  workspace:  ${entry.workspaceRoot}`,
    ],
  };
}

async function handleAccept(
  manager: WorktreeManager,
  options: WorktreeCommandOptions,
): Promise<WorktreeRunResult> {
  if (!options.taskId) {
    throw new WorktreeError("accept requires <taskId>");
  }
  if (!options.message || options.message.trim().length === 0) {
    throw new WorktreeError("accept requires --message <msg>");
  }
  const entry = await manager.accept(options.taskId, options.message);
  const mergeLine = entry.mergeCommit
    ? `  merge:      ${entry.mergeCommit}`
    : `  merge:      (no new commits — noop)`;
  return {
    success: true,
    action: "accept",
    entries: [entry],
    lines: [
      `✓ worktree "${entry.taskId}" accepted (status=${entry.status})`,
      `  branch:     ${entry.branch}`,
      mergeLine,
    ],
  };
}

function handleList(manager: WorktreeManager): WorktreeRunResult {
  const entries = manager.list();
  const lines =
    entries.length === 0
      ? ["(no worktrees tracked)"]
      : [
          `Tracked worktrees: ${entries.length}`,
          ...entries.map(
            (e) =>
              `  ${statusGlyph(e.status)} ${e.taskId.padEnd(24)} ${e.branch.padEnd(40)} ${e.status}`,
          ),
        ];
  return {
    success: true,
    action: "list",
    entries,
    lines,
  };
}

function statusGlyph(status: WorktreeEntry["status"]): string {
  switch (status) {
    case "active":
      return "●";
    case "accepted":
      return "✓";
    case "abandoned":
      return "✗";
  }
}

// ── Parse helper for the CLI entrypoint ────────────────────

/**
 * Normalize commander's `<action>` + options into our typed payload.
 * Throws if the action verb is unknown — caller surfaces it as a CLI
 * error. Kept separate so the CLI entrypoint can plug in without
 * reshaping the internal handler contract.
 */
export function parseWorktreeArgs(
  action: string,
  taskId: string | undefined,
  opts: { base?: string; message?: string },
): WorktreeCommandOptions {
  const normalized = action.toLowerCase();
  if (
    normalized !== "create" &&
    normalized !== "list" &&
    normalized !== "abandon" &&
    normalized !== "accept"
  ) {
    throw new WorktreeError(
      `unknown worktree action "${action}" (expected create | list | abandon | accept)`,
    );
  }
  return {
    action: normalized,
    ...(taskId !== undefined ? { taskId } : {}),
    ...(opts.base !== undefined ? { base: opts.base } : {}),
    ...(opts.message !== undefined ? { message: opts.message } : {}),
  };
}
