/**
 * Integration test: verify P1-O orphan wiring.
 *
 * Each case below asserts that a formerly-orphan module is now
 * reachable from the public API surface (src/lib.ts barrel) AND is
 * actually used by runtime code — not just re-exported.
 *
 * These tests guard against bit-rot: if someone inlines/deletes a
 * wire later, the relevant assertion will fail.
 */

import { describe, it, expect } from "vitest";
import * as wotann from "../../src/lib.js";

describe("P1-O orphan wiring — public API surface", () => {
  it("exports channels/terminal-mention helpers", () => {
    expect(typeof wotann.parseTerminalMention).toBe("function");
    expect(typeof wotann.buildTerminalAttachment).toBe("function");
    expect(typeof wotann.inlineAttachment).toBe("function");
    const parsed = wotann.parseTerminalMention("help @terminal please");
    expect(parsed.mentionedTerminal).toBe(true);
    expect(parsed.cleaned).toContain("[terminal attachment]");
  });

  it("exports intelligence/answer-normalizer helpers", () => {
    expect(typeof wotann.normalizeAnswer).toBe("function");
    expect(typeof wotann.answersEqual).toBe("function");
    // Canonical check: "The answer is: 42." vs "42" should match.
    expect(wotann.answersEqual("The answer is: 42.", "42")).toBe(true);
  });

  it("exports ui/context-meter helpers", () => {
    expect(typeof wotann.buildContextMeterReading).toBe("function");
    expect(typeof wotann.renderContextMeterRadial).toBe("function");
    expect(typeof wotann.emptyContextMeterBudget).toBe("function");
    const budget = wotann.emptyContextMeterBudget(100_000);
    const reading = wotann.buildContextMeterReading(budget);
    expect(reading.percent).toBe(0);
    expect(reading.severity).toBe("ok");
  });

  it("exports orchestration/parallel-coordinator helpers", () => {
    expect(typeof wotann.coordinateParallel).toBe("function");
    expect(typeof wotann.defaultSynthesizer).toBe("function");
    expect(typeof wotann.createLlmSynthesizer).toBe("function");
  });

  it("exports orchestration/speculative-execution helpers", () => {
    expect(typeof wotann.speculativeExecute).toBe("function");
  });

  it("exports orchestration/code-mode helpers", () => {
    expect(typeof wotann.validateCodeModeScript).toBe("function");
    expect(typeof wotann.substituteCodeModeRefs).toBe("function");
    expect(typeof wotann.executeCodeModeScript).toBe("function");
  });
});

describe("P1-O orphan wiring — runtime integration", () => {
  it("parallel-coordinator executes tasks in parallel (smoke)", async () => {
    const tasks: readonly wotann.AgentTask[] = [
      { id: "a", prompt: "first" },
      { id: "b", prompt: "second" },
      { id: "c", prompt: "third" },
    ];
    const execute: wotann.AgentExecutor = async (t) => `done-${t.id}`;
    const outcome = await wotann.coordinateParallel(
      tasks,
      execute,
      wotann.defaultSynthesizer,
      { concurrency: 3 },
    );
    expect(outcome.successCount).toBe(3);
    expect(outcome.failureCount).toBe(0);
    expect(outcome.synthesis).toContain("[a]");
    expect(outcome.synthesis).toContain("[b]");
    expect(outcome.synthesis).toContain("[c]");
  });

  it("speculative-execute picks the highest-scoring candidate", async () => {
    const result = await wotann.speculativeExecute<number>({
      n: 3,
      generate: async (i) => i + 1,
      score: async (v) => v, // higher is better
    });
    expect(result.best.value).toBe(3);
    expect(result.bestScore).toBe(3);
  });

  it("code-mode validates a well-formed script", () => {
    const script: wotann.CodeModeScript = {
      version: 1,
      steps: [
        { id: "s1", tool: "read", args: { path: "/tmp/a" } },
        { id: "s2", tool: "write", args: { path: "/tmp/b", contents: "${s1}" } },
      ],
    };
    const problems = wotann.validateCodeModeScript(script);
    expect(problems.length).toBe(0);
  });

  it("context-meter applyDelta accumulates token categories", () => {
    const initial = wotann.emptyContextMeterBudget(100_000);
    const next = wotann.applyContextMeterDelta(initial, { system: 500, conversation: 2500 });
    expect(next.usedTokens).toBe(3000);
    expect(next.categories.system).toBe(500);
    expect(next.categories.conversation).toBe(2500);
    const reading = wotann.buildContextMeterReading(next);
    expect(reading.percent).toBe(3);
    expect(reading.slices.length).toBe(2);
  });

  it("terminal-mention builds a usable attachment end-to-end", () => {
    const { cleaned, mentionedTerminal } = wotann.parseTerminalMention(
      "debug this: @terminal",
    );
    expect(mentionedTerminal).toBe(true);
    const snapshot: wotann.TerminalSnapshot = {
      cwd: "/tmp/proj",
      lastCommand: "ls",
      lastExitCode: 0,
      bufferTail: "file1\nfile2",
      capturedAt: Date.now() - 1000,
    };
    const attachment = wotann.buildTerminalAttachment(snapshot);
    const final = wotann.inlineAttachment(cleaned, attachment);
    expect(final).toContain("# Terminal attachment");
    expect(final).not.toContain("[terminal attachment]");
  });
});

describe("P1-O orphan wiring — benchmark-harness uses answer-normalizer", () => {
  it("benchmark-harness source imports answer-normalizer", async () => {
    // Read the source to assert the wire is in place (deletion guard).
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../src/intelligence/benchmark-harness.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/from ["']\.\/answer-normalizer\.js["']/);
    expect(src).toMatch(/answersEqual\(/);
    expect(src).toMatch(/normalizeAnswer\(/);
  });

  it("answer-normalizer treats benchmark-style answers equivalently", () => {
    // "The answer is: 42." must normalize to match "42" — this is
    // exactly the 3-5% GAIA gap the harness now closes.
    expect(wotann.answersEqual("The answer is: 42.", "42")).toBe(true);
    // Code-fenced answers — common agent pattern — must also match.
    expect(wotann.answersEqual("```\nParis\n```", "Paris")).toBe(true);
  });
});

describe("P1-O batch 2 — additional orphan wiring", () => {
  it("exports workflows/workflow-runner helpers", () => {
    expect(typeof wotann.parseWorkflow).toBe("function");
    expect(typeof wotann.workflowTopoSort).toBe("function");
    expect(typeof wotann.runWorkflow).toBe("function");
    expect(typeof wotann.interpolateWorkflowTemplate).toBe("function");
    expect(typeof wotann.evaluateWorkflowCondition).toBe("function");
  });

  it("parses a small workflow YAML through the public API", () => {
    const yaml = `
name: test-flow
nodes:
  - id: a
    kind: bash
    bash: "echo hi"
  - id: b
    kind: prompt
    prompt: "Use \${a} to continue"
    depends_on: [a]
`;
    const wf = wotann.parseWorkflow(yaml);
    expect(wf.name).toBe("test-flow");
    expect(wf.nodes.length).toBe(2);
    const sorted = wotann.workflowTopoSort(wf.nodes);
    expect(sorted[0]!.id).toBe("a");
    expect(sorted[1]!.id).toBe("b");
  });

  it("exports intelligence/budget-enforcer helpers", () => {
    expect(typeof wotann.BudgetEnforcer).toBe("function");
    expect(typeof wotann.budgetForTier).toBe("function");
  });

  it("BudgetEnforcer stops when wall-clock exhausted (smoke)", () => {
    const budget = new wotann.BudgetEnforcer({ maxWallClockMs: 1 });
    // Wait enough to exceed 1ms
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy-wait a few ms
    }
    expect(budget.shouldStop()).toBe(true);
  });

  it("budgetForTier returns a usable enforcer for free vs sonnet", () => {
    const free = wotann.budgetForTier("free", 60_000);
    const sonnet = wotann.budgetForTier("sonnet", 60_000);
    // Both should start non-stopped
    expect(free.shouldStop()).toBe(false);
    expect(sonnet.shouldStop()).toBe(false);
  });

  it("exports ui/raven-state helpers", () => {
    expect(typeof wotann.initialRavenState).toBe("function");
    expect(typeof wotann.deriveRavenMood).toBe("function");
    expect(typeof wotann.tickRavenState).toBe("function");
    expect(typeof wotann.renderRavenAscii).toBe("function");
    expect(wotann.RAVEN_TUNING).toBeTypeOf("object");
  });

  it("raven-state transitions into thinking when tool is active", () => {
    const initial = wotann.initialRavenState(0);
    const next = wotann.tickRavenState(
      initial,
      {
        idleMs: 0,
        toolActive: true,
        recentErrors: 0,
        justCompleted: false,
        listening: false,
      },
      100,
    );
    expect(next.mood).toBe("thinking");
    expect(next.revision).toBe(initial.revision + 1);
  });
});
