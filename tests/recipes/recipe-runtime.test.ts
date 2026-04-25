/**
 * Tests for src/recipes/recipe-runtime.ts (T12.4).
 *
 * Drives the V9 integration-matrix rows:
 *   - missing required param → honest-stub error
 *   - sub-recipe resolution → loaded + executed
 *   - retry on flake → 2nd attempt succeeds
 *   - unknown extension → honest-stub error
 *   - dry-run → plan only, no executor calls
 *   - variable threading (read → prompt)
 *   - bash `expect` substring check
 */

import { describe, it, expect, vi } from "vitest";
import { runRecipe } from "../../src/recipes/recipe-runtime.js";
import type {
  Recipe,
  RecipeStepExecutor,
  RunRecipeOptions,
} from "../../src/recipes/recipe-types.js";

// ── Helpers ───────────────────────────────────────────

function makeExecutor(
  overrides: Partial<RecipeStepExecutor> = {},
): RecipeStepExecutor {
  return {
    read: vi.fn(async (_p: string) => ({ ok: true, content: "file-contents" })),
    write: vi.fn(async (_p: string, _c: string) => ({ ok: true })),
    bash: vi.fn(async (_c: string) => ({
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
    })),
    prompt: vi.fn(async (_t: string) => ({ ok: true, response: "ai-response" })),
    ...overrides,
  };
}

function baseRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    version: 1,
    id: "t",
    title: "t",
    instructions: "do it",
    parameters: [],
    steps: [],
    ...overrides,
  };
}

function baseOptions(executor: RecipeStepExecutor): RunRecipeOptions {
  return { executor };
}

// ── Happy path ────────────────────────────────────────

describe("runRecipe — happy path", () => {
  it("executes each step in order and records outputs", async () => {
    const executor = makeExecutor();
    const recipe = baseRecipe({
      steps: [
        { type: "read", path: "/a" },
        { type: "bash", cmd: "echo hi" },
      ],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outputs).toHaveLength(2);
    expect(r.outputs[0]?.type).toBe("read");
    expect(r.outputs[1]?.type).toBe("bash");
    expect(executor.read).toHaveBeenCalledWith("/a");
    expect(executor.bash).toHaveBeenCalledWith("echo hi");
  });
});

// ── Parameter validation (V9 matrix row) ─────────────

describe("runRecipe — parameter validation", () => {
  it("returns ok:false with documented message on missing required param (matrix row 2)", async () => {
    const recipe = baseRecipe({
      parameters: [
        { name: "filePath", type: "string", required: true },
      ],
      steps: [{ type: "bash", cmd: "ls" }],
    });
    const r = await runRecipe(recipe, {}, baseOptions(makeExecutor()));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Missing required param: filePath");
  });

  it("uses default when param omitted", async () => {
    const executor = makeExecutor();
    const recipe = baseRecipe({
      parameters: [
        { name: "mode", type: "string", required: false, default: "fast" },
      ],
      steps: [{ type: "bash", cmd: "echo {{mode}}" }],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(true);
    expect(executor.bash).toHaveBeenCalledWith("echo fast");
  });

  it("rejects wrongly-typed param", async () => {
    const recipe = baseRecipe({
      parameters: [{ name: "n", type: "number", required: true }],
      steps: [{ type: "bash", cmd: "echo {{n}}" }],
    });
    const r = await runRecipe(recipe, { n: "oops" }, baseOptions(makeExecutor()));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/expected number/);
  });
});

// ── Required-extension check (V9 matrix row 7) ───────

describe("runRecipe — required extensions", () => {
  it("refuses when required extension is absent (matrix row 7)", async () => {
    const recipe = baseRecipe({
      requiredExtensions: ["fake-ext"],
      steps: [{ type: "bash", cmd: "ls" }],
    });
    const r = await runRecipe(recipe, {}, {
      executor: makeExecutor(),
      availableExtensions: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Required extension fake-ext not available");
  });

  it("allows execution when all extensions available", async () => {
    const executor = makeExecutor();
    const recipe = baseRecipe({
      requiredExtensions: ["typescript"],
      steps: [{ type: "bash", cmd: "ls" }],
    });
    const r = await runRecipe(
      recipe,
      {},
      { executor, availableExtensions: ["typescript", "vitest"] },
    );
    expect(r.ok).toBe(true);
  });
});

// ── Retry on flake (V9 matrix row 4) ─────────────────

describe("runRecipe — retry on flake (matrix row 4)", () => {
  it("first attempt fails, second succeeds — outputs record both attempts", async () => {
    const calls = { n: 0 };
    const executor = makeExecutor({
      bash: vi.fn(async (_c: string) => {
        calls.n++;
        if (calls.n === 1) {
          return { ok: false, exitCode: 1, stdout: "", stderr: "flake", error: "failed" };
        }
        return { ok: true, exitCode: 0, stdout: "pass", stderr: "" };
      }),
    });
    const recipe = baseRecipe({
      retry: { maxAttempts: 2, strategy: "fixed", baseDelayMs: 0 },
      steps: [{ type: "bash", cmd: "flaky-test" }],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Runtime records both attempts on the outputs list for this step.
    const bashOutputs = r.outputs.filter((o) => o.type === "bash");
    expect(bashOutputs.length).toBe(2);
    expect(bashOutputs[0]?.ok).toBe(false);
    expect(bashOutputs[0]?.attempt).toBe(1);
    expect(bashOutputs[1]?.ok).toBe(true);
    expect(bashOutputs[1]?.attempt).toBe(2);
  });

  it("gives up and surfaces failure after maxAttempts", async () => {
    const executor = makeExecutor({
      bash: vi.fn(async () => ({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "nope",
        error: "failed",
      })),
    });
    const recipe = baseRecipe({
      retry: { maxAttempts: 2, strategy: "fixed", baseDelayMs: 0 },
      steps: [{ type: "bash", cmd: "always-flaky" }],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/after 2 attempt/);
    expect(executor.bash).toHaveBeenCalledTimes(2);
  });
});

// ── Sub-recipe resolution (V9 matrix row 3) ──────────

describe("runRecipe — sub-recipe resolution (matrix row 3)", () => {
  it("resolves + executes sub-recipe + surfaces its outputs", async () => {
    const sub: Recipe = baseRecipe({
      id: "sub",
      title: "sub",
      instructions: "do sub",
      steps: [{ type: "bash", cmd: "echo in-sub" }],
    });
    const executor = makeExecutor({
      resolveSubRecipe: vi.fn(async (ref: string) => {
        if (ref === "code-review/typescript") return { ok: true, recipe: sub };
        return { ok: false, error: "not found" };
      }),
    });
    const recipe = baseRecipe({
      steps: [
        { type: "subrecipe", ref: "code-review/typescript" },
      ],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outputs[0]?.type).toBe("subrecipe");
    expect(r.outputs[0]?.ok).toBe(true);
    expect(executor.bash).toHaveBeenCalledWith("echo in-sub");
  });

  it("surfaces honest-stub error when executor has no resolveSubRecipe", async () => {
    const recipe = baseRecipe({
      steps: [{ type: "subrecipe", ref: "x" }],
    });
    const r = await runRecipe(recipe, {}, baseOptions(makeExecutor()));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/subrecipe/);
  });

  it("surfaces resolve failure with the resolver's error", async () => {
    const executor = makeExecutor({
      resolveSubRecipe: vi.fn(async () => ({ ok: false, error: "not found" })),
    });
    const recipe = baseRecipe({
      steps: [{ type: "subrecipe", ref: "ghost" }],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/failed to resolve sub-recipe ghost: not found/);
  });
});

// ── Bash expect semantics ─────────────────────────────

describe("runRecipe — bash `expect` substring", () => {
  it("passes when stdout contains the expected string", async () => {
    const executor = makeExecutor({
      bash: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: "tests: 5 passing",
        stderr: "",
      })),
    });
    const recipe = baseRecipe({
      steps: [{ type: "bash", cmd: "npx vitest run", expect: "passing" }],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(true);
  });

  it("fails when stdout lacks the expected string", async () => {
    const executor = makeExecutor({
      bash: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: "everything broke",
        stderr: "",
      })),
    });
    const recipe = baseRecipe({
      steps: [{ type: "bash", cmd: "test", expect: "passing" }],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/expected stdout to contain/);
  });
});

// ── Variable threading (read → prompt via `into`) ────

describe("runRecipe — variable threading", () => {
  it("reads file contents into a variable and interpolates later", async () => {
    const promptSpy = vi.fn(async (text: string) => ({ ok: true, response: `got:${text}` }));
    const executor = makeExecutor({
      read: vi.fn(async (_p: string) => ({ ok: true, content: "hello-world" })),
      prompt: promptSpy,
    });
    const recipe = baseRecipe({
      steps: [
        { type: "read", path: "/foo", into: "fileContent" },
        { type: "prompt", text: "Summarize: {{fileContent}}" },
      ],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(true);
    expect(promptSpy).toHaveBeenCalledWith("Summarize: hello-world");
  });

  it("supports prompt → bash threading via `into`", async () => {
    const bashSpy = vi.fn(async (cmd: string) => ({
      ok: true,
      exitCode: 0,
      stdout: cmd,
      stderr: "",
    }));
    const executor = makeExecutor({
      prompt: vi.fn(async () => ({ ok: true, response: "generated-code" })),
      bash: bashSpy,
    });
    const recipe = baseRecipe({
      steps: [
        { type: "prompt", text: "Write code", into: "code" },
        { type: "bash", cmd: "echo {{code}}" },
      ],
    });
    const r = await runRecipe(recipe, {}, baseOptions(executor));
    expect(r.ok).toBe(true);
    expect(bashSpy).toHaveBeenCalledWith("echo generated-code");
  });
});

// ── Dry-run ────────────────────────────────────────────

describe("runRecipe — dry-run", () => {
  it("never calls the executor when dryRun: true", async () => {
    const executor = makeExecutor();
    const recipe = baseRecipe({
      steps: [
        { type: "bash", cmd: "rm -rf /" },
        { type: "write", path: "/a", content: "danger" },
      ],
    });
    const r = await runRecipe(recipe, {}, { executor, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(executor.bash).not.toHaveBeenCalled();
    expect(executor.write).not.toHaveBeenCalled();
    for (const out of r.outputs) {
      expect(out.message).toMatch(/^dry-run:/);
    }
  });
});

// ── Per-call state (QB #7) ────────────────────────────

describe("runRecipe — per-call state (QB #7)", () => {
  it("two concurrent runs don't share state", async () => {
    const executor = makeExecutor({
      bash: vi.fn(async (cmd: string) => ({
        ok: true,
        exitCode: 0,
        stdout: cmd,
        stderr: "",
      })),
    });
    const recipe = baseRecipe({
      parameters: [{ name: "n", type: "number", required: true }],
      steps: [{ type: "bash", cmd: "echo {{n}}" }],
    });
    const [a, b] = await Promise.all([
      runRecipe(recipe, { n: 1 }, baseOptions(executor)),
      runRecipe(recipe, { n: 2 }, baseOptions(executor)),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(executor.bash).toHaveBeenCalledWith("echo 1");
    expect(executor.bash).toHaveBeenCalledWith("echo 2");
  });
});
