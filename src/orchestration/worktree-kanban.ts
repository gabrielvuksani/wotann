/**
 * Worktree Kanban (C19) — 3-state board over TaskIsolationManager.
 *
 * Superset's innovation over the typical worktree list was bucketing
 * tasks into an "In Progress" / "Ready for review" / "Completed"
 * board instead of a flat list. This module is the pure presentation
 * layer — worktree creation/merge/cleanup live in task-isolation.ts.
 *
 * Status mapping (from IsolatedTaskStatus):
 *   active    → in-progress
 *   completed → ready     (verified clean but not merged to main)
 *   merged    → completed (merged, safe to delete worktree)
 *   failed    → in-progress (still yours to fix, keeps user's work visible)
 *
 * Tests cover each mapping + rendering + column stats.
 */

import type { IsolatedTask } from "../sandbox/task-isolation.js";

// ── Types ────────────────────────────────────────────────────

export type KanbanColumn = "in-progress" | "ready" | "completed";

export interface KanbanCard {
  readonly id: string;
  readonly task: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly column: KanbanColumn;
  readonly ageMs: number;
  readonly raw: IsolatedTask;
}

export interface KanbanBoard {
  readonly columns: Record<KanbanColumn, readonly KanbanCard[]>;
  readonly totals: Record<KanbanColumn, number>;
  readonly oldestActive: KanbanCard | undefined;
  readonly generatedAt: number;
}

// ── Pure projection ──────────────────────────────────────────

export function mapTaskToColumn(task: IsolatedTask): KanbanColumn {
  switch (task.status) {
    case "active":
    case "failed":
      return "in-progress";
    case "completed":
      return "ready";
    case "merged":
      return "completed";
  }
}

export function toCard(task: IsolatedTask, now: number = Date.now()): KanbanCard {
  return {
    id: task.id,
    task: task.task,
    branch: task.branch,
    worktreePath: task.worktreePath,
    column: mapTaskToColumn(task),
    ageMs: Math.max(0, now - new Date(task.createdAt).getTime()),
    raw: task,
  };
}

export function buildBoard(tasks: readonly IsolatedTask[], now: number = Date.now()): KanbanBoard {
  const cards = tasks.map((t) => toCard(t, now));
  const columns: Record<KanbanColumn, KanbanCard[]> = {
    "in-progress": [],
    ready: [],
    completed: [],
  };
  for (const card of cards) columns[card.column].push(card);

  const totals: Record<KanbanColumn, number> = {
    "in-progress": columns["in-progress"].length,
    ready: columns.ready.length,
    completed: columns.completed.length,
  };

  const oldestActive = columns["in-progress"].reduce<KanbanCard | undefined>(
    (acc, card) => (acc === undefined || card.ageMs > acc.ageMs ? card : acc),
    undefined,
  );

  return {
    columns,
    totals,
    oldestActive,
    generatedAt: now,
  };
}

// ── Rendering ────────────────────────────────────────────────

export interface RenderOptions {
  /** Maximum chars per task description before ellipsis. */
  readonly maxDescLen?: number;
  /** Maximum cards to show per column. */
  readonly maxPerColumn?: number;
}

export function renderBoard(board: KanbanBoard, options: RenderOptions = {}): string {
  const maxDescLen = options.maxDescLen ?? 60;
  const maxPerColumn = options.maxPerColumn ?? 8;

  const total = board.totals["in-progress"] + board.totals.ready + board.totals.completed;
  if (total === 0) return "No worktrees — create one with `wotann autonomous <task>`.";

  const lines: string[] = [
    `# Worktree Kanban (${total} total)`,
    `In Progress: ${board.totals["in-progress"]}   |   Ready: ${board.totals.ready}   |   Completed: ${board.totals.completed}`,
  ];

  if (board.oldestActive) {
    const hours = Math.floor(board.oldestActive.ageMs / 3_600_000);
    lines.push(`Oldest active: "${truncate(board.oldestActive.task, 40)}" (${hours}h)`);
  }
  lines.push("");

  for (const col of ["in-progress", "ready", "completed"] as const) {
    const cards = board.columns[col];
    lines.push(`## ${columnLabel(col)} (${cards.length})`);
    if (cards.length === 0) {
      lines.push("_(empty)_");
    } else {
      const head = cards.slice(0, maxPerColumn);
      for (const card of head) {
        const ageStr = formatAge(card.ageMs);
        lines.push(
          `- [${card.id.slice(0, 8)}] ${truncate(card.task, maxDescLen)} ` +
            `(${card.branch}, ${ageStr})`,
        );
      }
      if (cards.length > head.length) {
        lines.push(`- …plus ${cards.length - head.length} more`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function columnLabel(col: KanbanColumn): string {
  switch (col) {
    case "in-progress":
      return "In Progress";
    case "ready":
      return "Ready for review";
    case "completed":
      return "Completed";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function formatAge(ms: number): string {
  if (ms < 60_000) return "<1m";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

// ── Transition suggestions ───────────────────────────────────

/**
 * Pure advisory: given a card, suggest what the user could do next.
 * The actual action (mergeTask, cleanup, etc.) happens in
 * TaskIsolationManager.
 */
export function suggestNextAction(card: KanbanCard): {
  readonly action: "merge" | "cleanup" | "resume" | "retry" | "none";
  readonly reason: string;
} {
  switch (card.raw.status) {
    case "active":
      return { action: "resume", reason: "still running — open the worktree" };
    case "failed":
      return { action: "retry", reason: "failed verification — retry or abandon" };
    case "completed":
      return { action: "merge", reason: "verification passed — ready to merge" };
    case "merged":
      return { action: "cleanup", reason: "merged — safe to delete the worktree" };
  }
}
