import { describe, it, expect } from "vitest";
import { Coordinator } from "../../src/orchestration/coordinator.js";
import { buildWaves, executeWaves, type WaveTask } from "../../src/orchestration/wave-executor.js";
import { runRalphMode } from "../../src/orchestration/ralph-mode.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

describe("Orchestration", () => {
  describe("Coordinator", () => {
    it("manages task lifecycle", () => {
      const coord = new Coordinator({ maxSubagents: 2 });

      coord.addTask({ id: "t1", description: "Task 1", files: ["a.ts"], phase: "implement", status: "pending" });
      coord.addTask({ id: "t2", description: "Task 2", files: ["b.ts"], phase: "implement", status: "pending" });

      expect(coord.getPendingTasks()).toHaveLength(2);

      coord.startTask("t1", "agent-1");
      expect(coord.getTask("t1")?.status).toBe("running");
      expect(coord.getPendingTasks()).toHaveLength(1);

      coord.completeTask("t1");
      expect(coord.getTask("t1")?.status).toBe("completed");
    });

    it("respects max subagent limit", () => {
      const coord = new Coordinator({ maxSubagents: 1 });

      coord.addTask({ id: "t1", description: "Task 1", files: [], phase: "implement", status: "pending" });
      coord.addTask({ id: "t2", description: "Task 2", files: [], phase: "implement", status: "pending" });

      coord.startTask("t1", "agent-1");
      expect(coord.canSpawnWorker()).toBe(false);

      const result = coord.startTask("t2", "agent-2");
      expect(result).toBeNull();
    });

    it("tracks progress", () => {
      const coord = new Coordinator();
      coord.addTask({ id: "t1", description: "A", files: [], phase: "implement", status: "pending" });
      coord.addTask({ id: "t2", description: "B", files: [], phase: "implement", status: "pending" });

      coord.startTask("t1", "a1");
      coord.completeTask("t1");
      coord.startTask("t2", "a2");
      coord.failTask("t2");

      const progress = coord.getProgress();
      expect(progress.total).toBe(2);
      expect(progress.completed).toBe(1);
      expect(progress.failed).toBe(1);
      expect(coord.isComplete()).toBe(true);
    });

    it("creates and removes git worktrees for tasks", () => {
      const repoDir = mkdtempSync(join(tmpdir(), "wotann-coordinator-"));
      const worktreeRoot = join(repoDir, ".wotann", "worktrees");

      try {
        execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
        execFileSync("git", ["config", "user.name", "WOTANN Test"], { cwd: repoDir, stdio: "ignore" });
        writeFileSync(join(repoDir, "README.md"), "# test\n");
        execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir, stdio: "ignore" });

        const coord = new Coordinator({ worktreeRoot });
        coord.addTask({ id: "task-1", description: "Task", files: ["README.md"], phase: "implement", status: "pending" });

        const worktree = coord.createWorktree("task-1", repoDir);
        expect(worktree).not.toBeNull();
        expect(existsSync(worktree!.path)).toBe(true);

        const removed = coord.removeWorktree("task-1", repoDir);
        expect(removed).toBe(true);
        expect(coord.getWorktree("task-1")).toBeUndefined();
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });
  });

  describe("Wave Executor", () => {
    it("builds waves by dependency", () => {
      const tasks: WaveTask[] = [
        { id: "a", description: "A", dependencies: [], status: "pending" },
        { id: "b", description: "B", dependencies: ["a"], status: "pending" },
        { id: "c", description: "C", dependencies: [], status: "pending" },
        { id: "d", description: "D", dependencies: ["b", "c"], status: "pending" },
      ];

      const waves = buildWaves(tasks);
      expect(waves).toHaveLength(3);
      expect(waves[0]!.tasks.map((t) => t.id)).toContain("a");
      expect(waves[0]!.tasks.map((t) => t.id)).toContain("c");
      expect(waves[1]!.tasks.map((t) => t.id)).toContain("b");
      expect(waves[2]!.tasks.map((t) => t.id)).toContain("d");
    });

    it("executes waves in order", async () => {
      const tasks: WaveTask[] = [
        { id: "a", description: "A", dependencies: [], status: "pending" },
        { id: "b", description: "B", dependencies: ["a"], status: "pending" },
      ];

      const waves = buildWaves(tasks);
      const order: string[] = [];

      const results = await executeWaves(waves, async (task) => {
        order.push(task.id);
        return `done-${task.id}`;
      });

      expect(order).toEqual(["a", "b"]);
      expect(results.get("a")).toBe("done-a");
      expect(results.get("b")).toBe("done-b");
    });
  });

  describe("Ralph Mode", () => {
    it("succeeds when verifier passes immediately", async () => {
      const result = await runRalphMode(
        { maxCycles: 10, command: "test", description: "Fix tests" },
        async () => ({ success: true, output: "All tests passed" }),
        async () => "no fix needed",
      );

      expect(result.success).toBe(true);
      expect(result.cycles).toBe(1);
    });

    it("loops until tests pass", async () => {
      let attempt = 0;
      const result = await runRalphMode(
        { maxCycles: 10, command: "test", description: "Fix tests" },
        async () => {
          attempt++;
          return { success: attempt >= 3, output: attempt < 3 ? "Test failed" : "Passed" };
        },
        async (error) => `Fix applied for: ${error}`,
      );

      expect(result.success).toBe(true);
      expect(result.cycles).toBe(3);
      expect(result.fixesApplied).toHaveLength(2);
    });

    it("stops at max cycles", async () => {
      const result = await runRalphMode(
        { maxCycles: 3, command: "test", description: "Fix tests" },
        async () => ({ success: false, output: "Still failing" }),
        async () => "attempted fix",
      );

      expect(result.success).toBe(false);
      expect(result.cycles).toBe(3);
    });
  });
});
