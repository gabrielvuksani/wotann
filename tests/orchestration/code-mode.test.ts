/**
 * C25 — Code Mode executor tests.
 */

import { describe, it, expect } from "vitest";
import {
  executeScript,
  substituteRefs,
  validateScript,
  type CodeModeScript,
  type ToolRunner,
} from "../../src/orchestration/code-mode.js";

describe("validateScript", () => {
  it("rejects unknown version", () => {
    const problems = validateScript({ version: 2 as unknown as 1, steps: [] });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("rejects empty script", () => {
    const problems = validateScript({ version: 1, steps: [] });
    expect(problems.some((p) => p.problem.match(/no steps/))).toBe(true);
  });

  it("rejects scripts longer than 20 steps", () => {
    const steps = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      tool: "noop",
      args: {},
    }));
    const problems = validateScript({ version: 1, steps });
    expect(problems.some((p) => p.problem.match(/20-step/))).toBe(true);
  });

  it("rejects duplicate step ids", () => {
    const problems = validateScript({
      version: 1,
      steps: [
        { id: "s1", tool: "a", args: {} },
        { id: "s1", tool: "b", args: {} },
      ],
    });
    expect(problems.some((p) => p.problem.match(/duplicate/))).toBe(true);
  });

  it("rejects invalid step ids", () => {
    const problems = validateScript({
      version: 1,
      steps: [{ id: "has a space", tool: "x", args: {} }],
    });
    expect(problems.some((p) => p.problem.match(/invalid step id/))).toBe(true);
  });

  it("rejects forward references", () => {
    const problems = validateScript({
      version: 1,
      steps: [
        { id: "s1", tool: "a", args: { input: "${s2.output}" } },
        { id: "s2", tool: "b", args: {} },
      ],
    });
    expect(problems.some((p) => p.problem.match(/forward reference/))).toBe(true);
  });

  it("accepts valid backwards reference", () => {
    const problems = validateScript({
      version: 1,
      steps: [
        { id: "s1", tool: "read", args: {} },
        { id: "s2", tool: "grep", args: { pattern: "${s1.output}" } },
      ],
    });
    expect(problems).toEqual([]);
  });
});

describe("substituteRefs", () => {
  const context = {
    s1: {
      id: "s1",
      tool: "read",
      ok: true,
      output: { lines: ["alpha", "beta"], count: 2 },
      durationMs: 5,
    },
  };

  it("replaces ${step.path} with resolved object value", () => {
    const result = substituteRefs({ n: "${s1.count}" }, context);
    expect(result).toMatchObject({ n: "2" });
  });

  it("replaces full step output when no path is provided", () => {
    const result = substituteRefs({ data: "${s1}" }, context);
    expect(result.data).toMatch(/"lines"/);
  });

  it("walks nested objects and arrays", () => {
    const result = substituteRefs(
      { meta: { cells: ["${s1.count}", "raw"] } },
      context,
    );
    expect(result).toMatchObject({ meta: { cells: ["2", "raw"] } });
  });

  it("leaves unresolved refs unchanged", () => {
    const result = substituteRefs({ q: "${nonexistent}" }, context);
    expect(result.q).toBe("${nonexistent}");
  });

  it("returns empty string for null/undefined path", () => {
    const result = substituteRefs({ q: "${s1.missing}" }, context);
    expect(result.q).toBe("");
  });
});

describe("executeScript", () => {
  const makeRunner = (
    impl: (tool: string, args: Record<string, unknown>) => { ok: boolean; output: unknown; error?: string },
  ): ToolRunner => {
    return async (tool, args) => impl(tool, args);
  };

  it("executes steps sequentially, passing output refs", async () => {
    const script: CodeModeScript = {
      version: 1,
      steps: [
        { id: "s1", tool: "echo", args: { text: "hello" } },
        { id: "s2", tool: "upper", args: { input: "${s1.output}" } },
      ],
    };
    const runner = makeRunner((tool, args) => {
      if (tool === "echo") return { ok: true, output: args["text"] };
      if (tool === "upper") return { ok: true, output: String(args["input"]).toUpperCase() };
      return { ok: false, output: null, error: "unknown tool" };
    });
    const result = await executeScript(script, { runner });
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]?.output).toBe("HELLO");
  });

  it("aborts on required failure", async () => {
    const script: CodeModeScript = {
      version: 1,
      steps: [
        { id: "s1", tool: "fail", args: {} },
        { id: "s2", tool: "never-reached", args: {} },
      ],
    };
    const runner = makeRunner((tool) => {
      if (tool === "fail") return { ok: false, output: null, error: "boom" };
      return { ok: true, output: "reached" };
    });
    const result = await executeScript(script, { runner });
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.error).toBe("boom");
  });

  it("continues past a non-required failure", async () => {
    const script: CodeModeScript = {
      version: 1,
      steps: [
        { id: "s1", tool: "fail", args: {}, required: false },
        { id: "s2", tool: "ok", args: {} },
      ],
    };
    const runner = makeRunner((tool) => {
      if (tool === "fail") return { ok: false, output: null, error: "non-fatal" };
      return { ok: true, output: "recovered" };
    });
    const result = await executeScript(script, { runner });
    expect(result.results).toHaveLength(2);
    expect(result.ok).toBe(false); // overall failed because one step failed
    expect(result.results[1]?.output).toBe("recovered");
  });

  it("returns validation failure before running anything", async () => {
    const script: CodeModeScript = {
      version: 1,
      steps: [
        { id: "s1", tool: "a", args: { ref: "${s2.output}" } },
        { id: "s2", tool: "b", args: {} },
      ],
    };
    let ran = false;
    const runner: ToolRunner = async () => {
      ran = true;
      return { ok: true, output: null };
    };
    const result = await executeScript(script, { runner });
    expect(ran).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.results[0]?.error).toMatch(/forward reference/);
  });

  it("catches thrown runner errors", async () => {
    const script: CodeModeScript = {
      version: 1,
      steps: [{ id: "s1", tool: "boom", args: {} }],
    };
    const runner: ToolRunner = async () => {
      throw new Error("explode");
    };
    const result = await executeScript(script, { runner });
    expect(result.results[0]?.error).toBe("explode");
    expect(result.results[0]?.ok).toBe(false);
  });
});
