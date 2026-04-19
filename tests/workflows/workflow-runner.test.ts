import { describe, it, expect, vi } from "vitest";
import {
  parseWorkflow,
  topoSort,
  runWorkflow,
  interpolate,
  evaluateCondition,
  type WorkflowNode,
  type WorkflowExecutors,
  type RunContext,
  type NodeResult,
} from "../../src/workflows/workflow-runner.js";

function mockExecutors(overrides: Partial<WorkflowExecutors> = {}): WorkflowExecutors {
  return {
    runPrompt: vi.fn(async (p: string) => `prompt-response: ${p}`),
    runBash: vi.fn(async (_cmd: string) => ({ stdout: "bash-output", stderr: "", exitCode: 0 })),
    runInteractive: vi.fn(async (_id: string, _q: string) => "user-input"),
    ...overrides,
  };
}

describe("parseWorkflow", () => {
  it("parses a minimal workflow", () => {
    const yaml = `
name: simple
nodes:
  - id: step1
    kind: prompt
    prompt: hello
`;
    const wf = parseWorkflow(yaml);
    expect(wf.name).toBe("simple");
    expect(wf.nodes).toHaveLength(1);
    expect(wf.nodes[0]?.kind).toBe("prompt");
  });

  it("rejects missing name", () => {
    expect(() => parseWorkflow(`nodes: [{id: x, kind: prompt}]`)).toThrow(/name is required/);
  });

  it("rejects empty nodes", () => {
    expect(() => parseWorkflow(`name: x\nnodes: []`)).toThrow(/non-empty array/);
  });

  it("rejects invalid kind", () => {
    expect(() => parseWorkflow(`name: x\nnodes:\n  - id: a\n    kind: made-up`)).toThrow(
      /kind must be one of/,
    );
  });

  it("rejects missing id", () => {
    expect(() => parseWorkflow(`name: x\nnodes:\n  - kind: prompt`)).toThrow(/id is required/);
  });

  it("preserves all optional fields", () => {
    const yaml = `
name: all-fields
description: A test workflow
version: "1.0"
nodes:
  - id: check
    kind: bash
    bash: ls
    timeout_ms: 5000
    continue_on_error: true
    depends_on: []
`;
    const wf = parseWorkflow(yaml);
    expect(wf.description).toBe("A test workflow");
    expect(wf.version).toBe("1.0");
    expect(wf.nodes[0]?.bash).toBe("ls");
    expect(wf.nodes[0]?.timeout_ms).toBe(5000);
    expect(wf.nodes[0]?.continue_on_error).toBe(true);
  });
});

describe("topoSort", () => {
  const makeNode = (id: string, depends_on?: string[]): WorkflowNode => ({
    id,
    kind: "prompt",
    prompt: "_",
    ...(depends_on ? { depends_on } : {}),
  });

  it("orders a chain correctly", () => {
    const nodes = [makeNode("c", ["b"]), makeNode("b", ["a"]), makeNode("a")];
    const sorted = topoSort(nodes);
    expect(sorted.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("handles independent nodes", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const sorted = topoSort(nodes);
    expect(sorted).toHaveLength(3);
  });

  it("throws on cycle", () => {
    const nodes = [makeNode("a", ["b"]), makeNode("b", ["a"])];
    expect(() => topoSort(nodes)).toThrow(/cycle detected/);
  });

  it("throws on unknown dependency", () => {
    const nodes = [makeNode("a", ["doesnt-exist"])];
    expect(() => topoSort(nodes)).toThrow(/unknown node/);
  });
});

describe("runWorkflow", () => {
  it("runs a single prompt node", async () => {
    const wf = parseWorkflow(`name: t\nnodes:\n  - id: a\n    kind: prompt\n    prompt: hi`);
    const execs = mockExecutors();
    const result = await runWorkflow(wf, execs);
    expect(result.success).toBe(true);
    expect(result.results.get("a")?.output).toContain("prompt-response: hi");
  });

  it("runs dependent nodes in order", async () => {
    const wf = parseWorkflow(`
name: t
nodes:
  - id: second
    kind: prompt
    prompt: "second"
    depends_on: [first]
  - id: first
    kind: prompt
    prompt: "first"
`);
    const execs = mockExecutors();
    const callOrder: string[] = [];
    execs.runPrompt = vi.fn(async (p: string) => {
      callOrder.push(p);
      return p;
    });
    await runWorkflow(wf, execs);
    expect(callOrder).toEqual(["first", "second"]);
  });

  it("halts on error by default", async () => {
    const wf = parseWorkflow(`
name: t
nodes:
  - id: a
    kind: bash
    bash: "will fail"
  - id: b
    kind: prompt
    prompt: should-not-run
    depends_on: [a]
`);
    const execs = mockExecutors({
      runBash: async () => ({ stdout: "", stderr: "boom", exitCode: 1 }),
    });
    const result = await runWorkflow(wf, execs);
    expect(result.success).toBe(false);
    expect(result.failedNodeId).toBe("a");
    expect(result.results.has("b")).toBe(false);
  });

  it("continues on error when continue_on_error: true", async () => {
    const wf = parseWorkflow(`
name: t
nodes:
  - id: a
    kind: bash
    bash: "will fail"
    continue_on_error: true
  - id: b
    kind: prompt
    prompt: should-run
    depends_on: [a]
`);
    const execs = mockExecutors({
      runBash: async () => ({ stdout: "", stderr: "boom", exitCode: 1 }),
    });
    const result = await runWorkflow(wf, execs);
    expect(result.results.has("b")).toBe(true);
  });

  it("calls onNodeComplete after each node", async () => {
    const wf = parseWorkflow(`
name: t
nodes:
  - id: a
    kind: prompt
    prompt: _
  - id: b
    kind: prompt
    prompt: _
    depends_on: [a]
`);
    const onComplete: string[] = [];
    const execs = mockExecutors({
      onNodeComplete: (r: NodeResult) => onComplete.push(r.nodeId),
    });
    await runWorkflow(wf, execs);
    expect(onComplete).toEqual(["a", "b"]);
  });

  it("runs parallel children concurrently", async () => {
    const wf = parseWorkflow(`
name: t
nodes:
  - id: p
    kind: parallel
    children:
      - id: x
        kind: prompt
        prompt: X
      - id: y
        kind: prompt
        prompt: Y
`);
    let maxConcurrent = 0;
    let concurrent = 0;
    const execs = mockExecutors({
      runPrompt: async (p: string) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return p;
      },
    });
    await runWorkflow(wf, execs);
    expect(maxConcurrent).toBe(2);
  });
});

describe("interpolate", () => {
  const ctx: RunContext = {
    results: new Map([
      ["first", {
        nodeId: "first",
        output: "HELLO",
        durationMs: 5,
      } as NodeResult],
    ]),
    state: { model: "gpt-5" },
  };

  it("substitutes results.{id}.output", () => {
    expect(interpolate("Got: ${results.first.output}", ctx)).toBe("Got: HELLO");
  });

  it("substitutes state.{key}", () => {
    expect(interpolate("Using model=${state.model}", ctx)).toBe("Using model=gpt-5");
  });

  it("leaves unknown refs as-is", () => {
    expect(interpolate("unknown: ${results.xyz.output}", ctx)).toBe(
      "unknown: ${results.xyz.output}",
    );
  });
});

describe("evaluateCondition", () => {
  const ctx: RunContext = {
    results: new Map([
      ["t", { nodeId: "t", output: "tests passed", exitCode: 0, durationMs: 0 } as NodeResult],
      ["f", { nodeId: "f", output: "fail", exitCode: 1, durationMs: 0 } as NodeResult],
    ]),
    state: { found: true },
  };

  it("evaluates == equality for numbers", () => {
    expect(evaluateCondition("results.t.exitCode == 0", ctx)).toBe(true);
    expect(evaluateCondition("results.f.exitCode == 0", ctx)).toBe(false);
  });

  it("evaluates contains on output strings", () => {
    expect(evaluateCondition('results.t.output contains "passed"', ctx)).toBe(true);
    expect(evaluateCondition('results.f.output contains "passed"', ctx)).toBe(false);
  });

  it("evaluates exists on state keys", () => {
    expect(evaluateCondition("state.found exists", ctx)).toBe(true);
    expect(evaluateCondition("state.missing exists", ctx)).toBe(false);
  });

  it("returns false on invalid expression", () => {
    expect(evaluateCondition("not a valid expr", ctx)).toBe(false);
  });
});
