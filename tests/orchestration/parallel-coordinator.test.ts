import { describe, it, expect, vi } from "vitest";
import {
  coordinateParallel,
  defaultSynthesizer,
  createLlmSynthesizer,
  type AgentTask,
} from "../../src/orchestration/parallel-coordinator.js";

const tasks: AgentTask[] = [
  { id: "t1", prompt: "explore angle A" },
  { id: "t2", prompt: "explore angle B" },
  { id: "t3", prompt: "explore angle C" },
];

describe("coordinateParallel", () => {
  it("runs all tasks and synthesizes", async () => {
    const exec = async (t: AgentTask) => `result-${t.id}`;
    const outcome = await coordinateParallel(tasks, exec, defaultSynthesizer);
    expect(outcome.successCount).toBe(3);
    expect(outcome.failureCount).toBe(0);
    expect(outcome.synthesis).toContain("result-t1");
    expect(outcome.synthesis).toContain("result-t2");
    expect(outcome.synthesis).toContain("result-t3");
  });

  it("isolates failures per-task", async () => {
    const exec = async (t: AgentTask) => {
      if (t.id === "t2") throw new Error("boom");
      return `ok-${t.id}`;
    };
    const outcome = await coordinateParallel(tasks, exec, defaultSynthesizer);
    expect(outcome.successCount).toBe(2);
    expect(outcome.failureCount).toBe(1);
    const failed = outcome.results.find((r) => r.taskId === "t2");
    expect(failed?.error).toContain("boom");
  });

  it("respects concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const exec = async (t: AgentTask) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return t.id;
    };
    await coordinateParallel(
      Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, prompt: "x" })),
      exec,
      defaultSynthesizer,
      { concurrency: 3 },
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("times out slow tasks", async () => {
    const exec = async (t: AgentTask) => {
      if (t.id === "t2") await new Promise((r) => setTimeout(r, 100));
      return t.id;
    };
    const outcome = await coordinateParallel(tasks, exec, defaultSynthesizer, {
      perTaskTimeoutMs: 50,
    });
    const t2 = outcome.results.find((r) => r.taskId === "t2");
    expect(t2?.error).toContain("timed out");
  });

  it("calls onTaskComplete per task", async () => {
    const completed: string[] = [];
    const exec = async (t: AgentTask) => t.id;
    await coordinateParallel(tasks, exec, defaultSynthesizer, {
      onTaskComplete: (r) => completed.push(r.taskId),
    });
    expect(completed.sort()).toEqual(["t1", "t2", "t3"]);
  });
});

describe("defaultSynthesizer", () => {
  it("joins successful results", async () => {
    const results = [
      { taskId: "a", output: "A out", durationMs: 0 },
      { taskId: "b", output: "B out", durationMs: 0 },
    ];
    const synth = await defaultSynthesizer(results);
    expect(synth).toContain("A out");
    expect(synth).toContain("B out");
  });

  it("skips failed results", async () => {
    const results = [
      { taskId: "a", output: "A out", durationMs: 0 },
      { taskId: "b", output: "", error: "fail", durationMs: 0 },
    ];
    const synth = await defaultSynthesizer(results);
    expect(synth).toContain("A out");
    expect(synth).not.toContain("[b]");
  });
});

describe("createLlmSynthesizer", () => {
  it("feeds successful outputs to LLM", async () => {
    let captured = "";
    const synth = createLlmSynthesizer(async (p) => {
      captured = p;
      return "unified answer";
    });
    const results = [
      { taskId: "a", output: "angle A", durationMs: 0 },
      { taskId: "b", output: "angle B", durationMs: 0 },
    ];
    const out = await synth(results);
    expect(out).toBe("unified answer");
    expect(captured).toContain("angle A");
    expect(captured).toContain("angle B");
  });

  it("returns placeholder when all failed", async () => {
    const synth = createLlmSynthesizer(vi.fn() as never);
    const results = [{ taskId: "a", output: "", error: "x", durationMs: 0 }];
    const out = await synth(results);
    expect(out).toContain("no successful");
  });
});
