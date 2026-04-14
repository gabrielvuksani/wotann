import { describe, it, expect } from "vitest";
import { buildWaves, executeWaves, type WaveTask } from "../../src/orchestration/wave-executor.js";

describe("Wave Executor (§19)", () => {
  const task = (id: string, dependencies: string[] = []): WaveTask => ({
    id,
    description: `Task ${id}`,
    dependencies,
    status: "pending",
  });

  describe("buildWaves", () => {
    it("groups independent tasks into wave 0", () => {
      const tasks = [task("a"), task("b"), task("c")];
      const waves = buildWaves(tasks);
      expect(waves.length).toBe(1);
      expect(waves[0]!.tasks.length).toBe(3);
    });

    it("chains dependent tasks into sequential waves", () => {
      const tasks = [task("a"), task("b", ["a"]), task("c", ["b"])];
      const waves = buildWaves(tasks);
      expect(waves.length).toBe(3);
      expect(waves[0]!.tasks.map((t) => t.id)).toContain("a");
      expect(waves[1]!.tasks.map((t) => t.id)).toContain("b");
      expect(waves[2]!.tasks.map((t) => t.id)).toContain("c");
    });

    it("puts parallel tasks with same dependency in same wave", () => {
      const tasks = [task("a"), task("b", ["a"]), task("c", ["a"])];
      const waves = buildWaves(tasks);
      expect(waves.length).toBe(2);
      expect(waves[1]!.tasks.length).toBe(2);
    });

    it("handles empty input", () => {
      const waves = buildWaves([]);
      expect(waves.length).toBe(0);
    });

    it("handles circular dependencies by forcing into one wave", () => {
      const tasks = [task("a", ["b"]), task("b", ["a"])];
      const waves = buildWaves(tasks);
      expect(waves.length).toBeGreaterThan(0);
      const allIds = waves.flatMap((w) => w.tasks.map((t) => t.id));
      expect(allIds).toContain("a");
      expect(allIds).toContain("b");
    });
  });

  describe("executeWaves", () => {
    it("executes all tasks and returns results map", async () => {
      const tasks = [task("a"), task("b")];
      const waves = buildWaves(tasks);
      const results = await executeWaves(waves, async (t) => `done-${t.id}`);
      expect(results.size).toBe(2);
      expect(results.get("a")).toBe("done-a");
      expect(results.get("b")).toBe("done-b");
    });

    it("handles task failures gracefully via Promise.allSettled", async () => {
      const tasks = [task("a"), task("b")];
      const waves = buildWaves(tasks);
      const results = await executeWaves(waves, async (t) => {
        if (t.id === "b") throw new Error("fail");
        return `ok-${t.id}`;
      });
      // 'a' succeeds, 'b' is rejected (not in results)
      expect(results.get("a")).toBe("ok-a");
      expect(results.has("b")).toBe(false);
    });

    it("executes dependent tasks in order", async () => {
      const order: string[] = [];
      const tasks = [task("a"), task("b", ["a"])];
      const waves = buildWaves(tasks);
      await executeWaves(waves, async (t) => {
        order.push(t.id);
        return `ok-${t.id}`;
      });
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    });
  });
});
