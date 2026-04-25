import { describe, it, expect, vi } from "vitest";
import { createSleepTimeConsumer } from "../../src/orchestration/sleep-time-consumer.js";

function makeAgent() {
  return {
    submit: vi.fn(),
    queueLength: vi.fn(() => 3),
    runIdleSession: vi.fn(async () => ({
      startedAt: 100,
      endedAt: 200,
      results: [
        { taskId: "t1", ok: true, costUsd: 0.01, durationMs: 5 },
        { taskId: "t2", ok: true, costUsd: 0.02, durationMs: 10 },
      ],
      aborted: false,
    })),
    clearQueue: vi.fn(() => 0),
  };
}

describe("createSleepTimeConsumer", () => {
  it("rejects missing options", () => {
    expect(() =>
      // @ts-expect-error — invalid input
      createSleepTimeConsumer(null),
    ).toThrow(/options object/);
  });

  it("rejects agent without runIdleSession", () => {
    expect(() =>
      createSleepTimeConsumer({
        // @ts-expect-error — invalid agent
        agent: { submit: () => {} },
      }),
    ).toThrow(/runIdleSession/);
  });

  it("forwards submit to the agent", () => {
    const agent = makeAgent();
    const consumer = createSleepTimeConsumer({ agent });
    const task = { id: "t1", prompt: "p", maxCostUsd: 0.1, maxDurationMs: 1000 };
    consumer.submitTask(task);
    expect(agent.submit).toHaveBeenCalledWith(task);
  });

  it("queueLength delegates to the agent", () => {
    const agent = makeAgent();
    const consumer = createSleepTimeConsumer({ agent });
    expect(consumer.queueLength()).toBe(3);
  });

  it("maybeRun forwards opportunity and tracks diagnostics", async () => {
    const agent = makeAgent();
    const consumer = createSleepTimeConsumer({ agent });

    const opportunity = { idleStartedAt: 100, idleDurationMs: 30000, source: "user-idle" };
    const report = await consumer.maybeRun(opportunity);

    expect(agent.runIdleSession).toHaveBeenCalledWith(opportunity);
    expect(report).not.toBeNull();
    const diag = consumer.getDiagnostics();
    expect(diag.opportunitiesAttempted).toBe(1);
    expect(diag.sessionsCompleted).toBe(1);
    expect(diag.tasksProcessed).toBe(2);
    expect(diag.lastError).toBeNull();
  });

  it("maybeRun returns null when agent throws", async () => {
    const agent = makeAgent();
    agent.runIdleSession = vi.fn(async () => {
      throw new Error("boom");
    });
    const consumer = createSleepTimeConsumer({ agent });

    const result = await consumer.maybeRun({
      idleStartedAt: 100,
      idleDurationMs: 30000,
      source: "user-idle",
    });
    expect(result).toBeNull();
    expect(consumer.getDiagnostics().lastError).toContain("boom");
  });

  it("maybeRun returns null when opportunity is invalid", async () => {
    const agent = makeAgent();
    const consumer = createSleepTimeConsumer({ agent });

    // @ts-expect-error — invalid opportunity
    const result = await consumer.maybeRun(null);
    expect(result).toBeNull();
    expect(agent.runIdleSession).not.toHaveBeenCalled();
  });

  it("resetDiagnostics clears counters but not agent state", async () => {
    const agent = makeAgent();
    const consumer = createSleepTimeConsumer({ agent });
    await consumer.maybeRun({ idleStartedAt: 0, idleDurationMs: 1000, source: "user-idle" });
    consumer.resetDiagnostics();
    expect(consumer.getDiagnostics().opportunitiesAttempted).toBe(0);
    expect(consumer.getDiagnostics().sessionsCompleted).toBe(0);
    expect(agent.runIdleSession).toHaveBeenCalledOnce();
  });
});
