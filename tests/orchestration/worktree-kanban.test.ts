/**
 * C19 — worktree Kanban tests.
 */

import { describe, it, expect } from "vitest";
import {
  buildBoard,
  mapTaskToColumn,
  renderBoard,
  suggestNextAction,
  toCard,
} from "../../src/orchestration/worktree-kanban.js";
import type { IsolatedTask } from "../../src/sandbox/task-isolation.js";

function mkTask(over: Partial<IsolatedTask> = {}): IsolatedTask {
  return {
    id: "abcdef1234567890",
    task: "fix auth bug",
    branch: "wotann/task/abc",
    worktreePath: "/tmp/iso/abc",
    status: "active",
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...over,
  };
}

describe("mapTaskToColumn", () => {
  it("active → in-progress", () => {
    expect(mapTaskToColumn(mkTask({ status: "active" }))).toBe("in-progress");
  });
  it("failed → in-progress (keeps user work visible)", () => {
    expect(mapTaskToColumn(mkTask({ status: "failed" }))).toBe("in-progress");
  });
  it("completed → ready", () => {
    expect(mapTaskToColumn(mkTask({ status: "completed" }))).toBe("ready");
  });
  it("merged → completed", () => {
    expect(mapTaskToColumn(mkTask({ status: "merged" }))).toBe("completed");
  });
});

describe("toCard", () => {
  it("computes ageMs as non-negative ms since createdAt", () => {
    const now = Date.now();
    const created = new Date(now - 5 * 60_000).toISOString();
    const card = toCard(mkTask({ createdAt: created }), now);
    expect(card.ageMs).toBeGreaterThanOrEqual(5 * 60_000 - 10);
    expect(card.ageMs).toBeLessThan(6 * 60_000);
  });

  it("clamps negative age to 0 when createdAt is in the future", () => {
    const now = Date.now();
    const created = new Date(now + 10_000).toISOString();
    const card = toCard(mkTask({ createdAt: created }), now);
    expect(card.ageMs).toBe(0);
  });
});

describe("buildBoard", () => {
  it("buckets tasks into the three columns", () => {
    const now = Date.now();
    const board = buildBoard(
      [
        mkTask({ status: "active", task: "a" }),
        mkTask({ status: "active", task: "b" }),
        mkTask({ status: "completed", task: "c" }),
        mkTask({ status: "merged", task: "d" }),
        mkTask({ status: "failed", task: "e" }),
      ],
      now,
    );
    expect(board.totals["in-progress"]).toBe(3); // 2 active + 1 failed
    expect(board.totals.ready).toBe(1);
    expect(board.totals.completed).toBe(1);
  });

  it("identifies oldest active card", () => {
    const now = Date.now();
    const board = buildBoard(
      [
        mkTask({ status: "active", task: "young", createdAt: new Date(now - 60_000).toISOString() }),
        mkTask({ status: "active", task: "old", createdAt: new Date(now - 24 * 60 * 60_000).toISOString() }),
      ],
      now,
    );
    expect(board.oldestActive?.task).toBe("old");
  });

  it("oldestActive is undefined when no active tasks", () => {
    const board = buildBoard([mkTask({ status: "merged" })], Date.now());
    expect(board.oldestActive).toBeUndefined();
  });
});

describe("renderBoard", () => {
  it("empty board renders a helpful message", () => {
    const board = buildBoard([], Date.now());
    expect(renderBoard(board)).toMatch(/create one/);
  });

  it("renders all three columns with counts", () => {
    const board = buildBoard(
      [
        mkTask({ status: "active" }),
        mkTask({ status: "completed" }),
        mkTask({ status: "merged" }),
      ],
      Date.now(),
    );
    const rendered = renderBoard(board);
    expect(rendered).toMatch(/In Progress \(1\)/);
    expect(rendered).toMatch(/Ready for review \(1\)/);
    expect(rendered).toMatch(/Completed \(1\)/);
  });

  it("truncates long task descriptions", () => {
    const long = "x".repeat(120);
    const board = buildBoard([mkTask({ task: long })], Date.now());
    const rendered = renderBoard(board, { maxDescLen: 30 });
    // Long description should be truncated and end with ellipsis
    expect(rendered).toMatch(/x{29}…/);
  });

  it("caps cards per column and shows overflow", () => {
    const tasks = Array.from({ length: 15 }, (_, i) =>
      mkTask({ id: `id${i}`, task: `task ${i}`, status: "active" }),
    );
    const board = buildBoard(tasks, Date.now());
    const rendered = renderBoard(board, { maxPerColumn: 5 });
    expect(rendered).toMatch(/plus 10 more/);
  });
});

describe("suggestNextAction", () => {
  it("active → resume", () => {
    const card = toCard(mkTask({ status: "active" }));
    expect(suggestNextAction(card).action).toBe("resume");
  });
  it("completed → merge", () => {
    const card = toCard(mkTask({ status: "completed" }));
    expect(suggestNextAction(card).action).toBe("merge");
  });
  it("merged → cleanup", () => {
    const card = toCard(mkTask({ status: "merged" }));
    expect(suggestNextAction(card).action).toBe("cleanup");
  });
  it("failed → retry", () => {
    const card = toCard(mkTask({ status: "failed" }));
    expect(suggestNextAction(card).action).toBe("retry");
  });
});
