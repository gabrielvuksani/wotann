import { describe, it, expect, afterEach } from "vitest";
import { SelfHealingExecutor, type Task } from "../../src/orchestration/self-healing.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Self-Healing Execution (§12)", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  const makeTask = (desc: string): Task => ({
    id: "t1",
    description: desc,
    attempt: 0,
  });

  it("succeeds on first attempt with no retries needed", async () => {
    const executor = new SelfHealingExecutor();
    const result = await executor.execute(
      makeTask("simple task"),
      async () => ({ success: true, output: "done", tokensUsed: 100, durationMs: 50 }),
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it("retries on failure and succeeds on second attempt", async () => {
    const executor = new SelfHealingExecutor();
    let attempt = 0;

    const result = await executor.execute(
      makeTask("failing then succeeding"),
      async () => {
        attempt++;
        if (attempt === 1) return { success: false, output: "error", tokensUsed: 200, durationMs: 100 };
        return { success: true, output: "fixed", tokensUsed: 150, durationMs: 80 };
      },
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("fails after max retries exhausted", async () => {
    const executor = new SelfHealingExecutor({ maxRetries: 2 });
    const result = await executor.execute(
      makeTask("always fails"),
      async () => ({ success: false, output: "error", tokensUsed: 100, durationMs: 50 }),
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it("NEVER degrades the model (architecture invariant)", async () => {
    // The executor passes the task to the runner unchanged across retries.
    // Model stays constant — provider fallback happens at AgentBridge, not here.
    const executor = new SelfHealingExecutor({ maxRetries: 3 });
    const modelsUsed: Array<string | undefined> = [];

    await executor.execute(
      { ...makeTask("test"), model: "claude-opus-4-6" },
      async (task) => {
        modelsUsed.push(task.model);
        return { success: false, output: "fail", tokensUsed: 100, durationMs: 50 };
      },
    );

    // Every retry uses the SAME model — zero degradation
    expect(modelsUsed.every((m) => m === "claude-opus-4-6")).toBe(true);
    expect(modelsUsed).toHaveLength(3);
  });

  it("calls checkpointer.create before each attempt", async () => {
    const executor = new SelfHealingExecutor({ maxRetries: 2 });
    const checkpoints: string[] = [];

    await executor.execute(
      makeTask("with checkpoints"),
      async () => ({ success: false, output: "fail", tokensUsed: 50, durationMs: 50 }),
      {
        create: async (label) => { checkpoints.push(label); return `hash-${label}`; },
        restore: async () => true,
      },
    );

    expect(checkpoints).toEqual(["attempt-0", "attempt-1"]);
  });

  it("calls checkpointer.restore on failure", async () => {
    const executor = new SelfHealingExecutor({ maxRetries: 2 });
    const restored: string[] = [];

    await executor.execute(
      makeTask("restore on fail"),
      async () => ({ success: false, output: "fail", tokensUsed: 50, durationMs: 50 }),
      {
        create: async (label) => `hash-${label}`,
        restore: async (hash) => { restored.push(hash); return true; },
      },
    );

    expect(restored).toContain("hash-attempt-0");
  });

  it("handles exceptions gracefully", async () => {
    const executor = new SelfHealingExecutor({ maxRetries: 2 });
    const result = await executor.execute(
      makeTask("throws"),
      async () => { throw new Error("unexpected crash"); },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it("tracks total tokens used across retries", async () => {
    const executor = new SelfHealingExecutor({ maxRetries: 3 });
    let attempt = 0;

    await executor.execute(
      makeTask("token tracking"),
      async () => {
        attempt++;
        if (attempt < 3) return { success: false, output: "fail", tokensUsed: 200, durationMs: 50 };
        return { success: true, output: "done", tokensUsed: 100, durationMs: 50 };
      },
    );

    expect(executor.getTotalTokensUsed()).toBe(500);
  });

  it("reset() clears token counter", () => {
    const executor = new SelfHealingExecutor();
    executor.reset();
    expect(executor.getTotalTokensUsed()).toBe(0);
  });

  it("uses ShadowGit checkpoints when a working directory is provided", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-shadow-git-"));
    const filePath = join(tempDir, "example.txt");
    writeFileSync(filePath, "original\n");

    const executor = new SelfHealingExecutor({ maxRetries: 1 });
    await executor.execute(
      { ...makeTask("shadow git restore"), workingDir: tempDir },
      async () => {
        writeFileSync(filePath, "mutated\n");
        return { success: false, output: "fail", tokensUsed: 10, durationMs: 10 };
      },
    );

    expect(readFileSync(filePath, "utf-8")).toBe("original\n");
  });
});
