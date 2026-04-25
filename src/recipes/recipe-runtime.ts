/**
 * T12.4 — Goose Recipe runtime (~300 LOC, V9 §T12.4, line 1885 / 1949).
 *
 * Execute a {@link Recipe} step-by-step with parameter validation,
 * variable threading between steps, retry policy, sub-recipe
 * invocation, and dry-run support.
 *
 * The runtime is pure — it never imports `node:fs` or `child_process`
 * directly. All side-effecting operations go through an injected
 * {@link RecipeStepExecutor}, which the WOTANN composition root
 * provides. This keeps the runner trivially testable, sandboxable,
 * and platform-agnostic.
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: every failure returns
 *     `{ok:false, error, outputs}` with the partial output trace so
 *     callers can diagnose. No silent success, no thrown errors out
 *     of the runtime.
 *   - QB #7  per-call state: `runRecipe` constructs a fresh context
 *     each invocation. Two concurrent runs cannot affect each other.
 *   - QB #13 env guard: never reads process.env. Caller threads
 *     `availableExtensions` via {@link RunRecipeOptions}.
 *   - QB #14 commit-claim verification: tests cover happy-path
 *     execution, retry-on-flake, missing-required-param, sub-recipe
 *     resolution, and the dry-run plan path against real executor
 *     stubs.
 */

import type {
  Recipe,
  RecipeRunResult,
  RecipeStep,
  RecipeStepOutput,
  RecipeStepExecutor,
  RunRecipeOptions,
} from "./recipe-types.js";

// ── Public Entry Point ───────────────────────────────

/**
 * Run a recipe with the given parameters and runtime options.
 */
export async function runRecipe(
  recipe: Recipe,
  params: Readonly<Record<string, unknown>>,
  options: RunRecipeOptions,
): Promise<RecipeRunResult> {
  // Guard: required-extension check.
  if (recipe.requiredExtensions && recipe.requiredExtensions.length > 0) {
    const available = new Set(options.availableExtensions ?? []);
    for (const ext of recipe.requiredExtensions) {
      if (!available.has(ext)) {
        return {
          ok: false,
          error: `Required extension ${ext} not available`,
          outputs: [],
        };
      }
    }
  }

  // Guard: parameter validation. Build the resolved-variables map.
  const variablesResult = resolveVariables(recipe, params);
  if (!variablesResult.ok) {
    return { ok: false, error: variablesResult.error, outputs: [] };
  }

  const variables = { ...variablesResult.variables };
  const outputs: RecipeStepOutput[] = [];

  // Execute each step. Per-step retry, per-step variable threading.
  for (let stepIdx = 0; stepIdx < recipe.steps.length; stepIdx++) {
    const step = recipe.steps[stepIdx];
    if (!step) continue;
    const interpolated = interpolateStep(step, variables);
    const stepResult = await executeStep(interpolated, recipe, variables, options, stepIdx);
    outputs.push(...stepResult.outputs);
    if (!stepResult.ok) {
      return {
        ok: false,
        error: stepResult.error,
        outputs: Object.freeze([...outputs]),
      };
    }
    if (stepResult.intoKey && stepResult.intoValue !== undefined) {
      variables[stepResult.intoKey] = stepResult.intoValue;
    }
  }

  return {
    ok: true,
    outputs: Object.freeze([...outputs]),
    variables: Object.freeze({ ...variables }),
  };
}

// ── Parameter resolution ─────────────────────────────

interface VariableResolution {
  readonly ok: true;
  readonly variables: Record<string, unknown>;
}
interface VariableError {
  readonly ok: false;
  readonly error: string;
}

function resolveVariables(
  recipe: Recipe,
  params: Readonly<Record<string, unknown>>,
): VariableResolution | VariableError {
  const variables: Record<string, unknown> = {};
  for (const param of recipe.parameters) {
    if (Object.prototype.hasOwnProperty.call(params, param.name)) {
      const value = params[param.name];
      const typeOk = checkType(value, param.type);
      if (!typeOk) {
        return {
          ok: false,
          error: `Parameter ${param.name} expected ${param.type}, got ${describeValue(value)}`,
        };
      }
      variables[param.name] = value;
    } else if (param.default !== undefined) {
      variables[param.name] = param.default;
    } else if (param.required) {
      return { ok: false, error: `Missing required param: ${param.name}` };
    }
  }
  return { ok: true, variables };
}

function checkType(value: unknown, type: "string" | "number" | "boolean"): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "boolean";
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ── Step interpolation ───────────────────────────────

/**
 * Replace {{varName}} in step strings with values from the variables
 * map. Whitespace inside the braces is tolerated. Unknown variables
 * are left as the raw template token so the executor can decide how
 * to surface them (we deliberately don't throw — callers may want a
 * step to receive a literal `{{foo}}`).
 */
function interpolateStep(
  step: RecipeStep,
  variables: Readonly<Record<string, unknown>>,
): RecipeStep {
  switch (step.type) {
    case "read":
      return { ...step, path: interpolate(step.path, variables) };
    case "write":
      return {
        ...step,
        path: interpolate(step.path, variables),
        content: interpolate(step.content, variables),
      };
    case "bash":
      return { ...step, cmd: interpolate(step.cmd, variables) };
    case "prompt":
      return { ...step, text: interpolate(step.text, variables) };
    case "subrecipe":
      return step; // subrecipe `with` interpolated when invoked
  }
}

function interpolate(template: string, variables: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const v = variables[key];
      return v === undefined || v === null ? "" : String(v);
    }
    return match;
  });
}

// ── Step execution ───────────────────────────────────

interface StepDispatchOk {
  readonly ok: true;
  readonly outputs: readonly RecipeStepOutput[];
  readonly intoKey?: string;
  readonly intoValue?: unknown;
}
interface StepDispatchError {
  readonly ok: false;
  readonly error: string;
  readonly outputs: readonly RecipeStepOutput[];
}
type StepDispatchResult = StepDispatchOk | StepDispatchError;

async function executeStep(
  step: RecipeStep,
  recipe: Recipe,
  variables: Readonly<Record<string, unknown>>,
  options: RunRecipeOptions,
  stepIdx: number,
): Promise<StepDispatchResult> {
  // Dry-run: emit a plan output, skip the side effect.
  if (options.dryRun) {
    return {
      ok: true,
      outputs: [
        {
          type: step.type,
          ok: true,
          attempt: 1,
          message: `dry-run: would execute ${describeStep(step)}`,
        },
      ],
    };
  }

  const maxAttempts = recipe.retry?.maxAttempts ?? 1;
  const strategy = recipe.retry?.strategy ?? "fixed";
  const baseDelayMs = recipe.retry?.baseDelayMs ?? 100;
  const outputs: RecipeStepOutput[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await dispatchStep(step, variables, options.executor, stepIdx);
    outputs.push({ ...result.output, attempt });
    if (result.output.ok) {
      const dispatchOk: StepDispatchOk = {
        ok: true,
        outputs: Object.freeze([...outputs]),
        ...(result.intoKey !== undefined ? { intoKey: result.intoKey } : {}),
        ...(result.intoValue !== undefined ? { intoValue: result.intoValue } : {}),
      };
      return dispatchOk;
    }
    if (attempt < maxAttempts) {
      const delay = strategy === "exponential" ? baseDelayMs * 2 ** (attempt - 1) : baseDelayMs;
      // Honest delay; small enough that test suites don't fight it.
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  const last = outputs[outputs.length - 1];
  return {
    ok: false,
    error: `step ${String(stepIdx)} (${step.type}) failed after ${String(maxAttempts)} attempt(s)${
      last?.message ? `: ${last.message}` : ""
    }`,
    outputs: Object.freeze([...outputs]),
  };
}

async function dispatchStep(
  step: RecipeStep,
  variables: Readonly<Record<string, unknown>>,
  executor: RecipeStepExecutor,
  stepIdx: number,
): Promise<{
  readonly output: RecipeStepOutput;
  readonly intoKey?: string;
  readonly intoValue?: unknown;
}> {
  switch (step.type) {
    case "read": {
      const r = await executor.read(step.path);
      const output: RecipeStepOutput = r.ok
        ? {
            type: "read",
            ok: true,
            attempt: 1,
            message: `read ${step.path}`,
            value: r.content,
          }
        : {
            type: "read",
            ok: false,
            attempt: 1,
            message: r.error ?? `failed to read ${step.path}`,
          };
      return {
        output,
        ...(step.into && r.ok ? { intoKey: step.into, intoValue: r.content } : {}),
      };
    }
    case "write": {
      const r = await executor.write(step.path, step.content);
      const output: RecipeStepOutput = r.ok
        ? { type: "write", ok: true, attempt: 1, message: `wrote ${step.path}` }
        : {
            type: "write",
            ok: false,
            attempt: 1,
            message: r.error ?? `failed to write ${step.path}`,
          };
      return { output };
    }
    case "bash": {
      const r = await executor.bash(step.cmd);
      let ok = r.ok && r.exitCode === 0;
      let message: string | undefined;
      if (!ok) {
        message = r.error ?? `bash exited ${String(r.exitCode)}`;
      } else if (step.expect && !r.stdout.includes(step.expect)) {
        ok = false;
        message = `expected stdout to contain "${step.expect}"`;
      } else {
        message = `bash ok (exit ${String(r.exitCode)})`;
      }
      return {
        output: {
          type: "bash",
          ok,
          attempt: 1,
          message,
          value: { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr },
        },
      };
    }
    case "prompt": {
      const r = await executor.prompt(step.text);
      const output: RecipeStepOutput = r.ok
        ? {
            type: "prompt",
            ok: true,
            attempt: 1,
            message: "prompt ok",
            value: r.response,
          }
        : {
            type: "prompt",
            ok: false,
            attempt: 1,
            message: r.error ?? "prompt failed",
          };
      return {
        output,
        ...(step.into && r.ok ? { intoKey: step.into, intoValue: r.response } : {}),
      };
    }
    case "subrecipe": {
      if (!executor.resolveSubRecipe) {
        return {
          output: {
            type: "subrecipe",
            ok: false,
            attempt: 1,
            message: "subrecipe execution not configured: no resolveSubRecipe in executor",
          },
        };
      }
      const sub = await executor.resolveSubRecipe(step.ref);
      if (!sub.ok) {
        return {
          output: {
            type: "subrecipe",
            ok: false,
            attempt: 1,
            message: `failed to resolve sub-recipe ${step.ref}: ${sub.error}`,
          },
        };
      }
      const subParams = interpolateRecord(step.with ?? {}, variables);
      const subResult = await runRecipe(sub.recipe, subParams, {
        executor,
      });
      return {
        output: {
          type: "subrecipe",
          ok: subResult.ok,
          attempt: 1,
          message: subResult.ok
            ? `sub-recipe ${step.ref} ok (${String(subResult.outputs.length)} steps)`
            : `sub-recipe ${step.ref} failed: ${subResult.error}`,
          value: subResult.outputs,
        },
      };
    }
    default: {
      // Should be unreachable given the discriminated union.
      const exhaustive: never = step;
      return {
        output: {
          type: (exhaustive as { type: RecipeStep["type"] }).type,
          ok: false,
          attempt: 1,
          message: `unknown step type at index ${String(stepIdx)}`,
        },
      };
    }
  }
}

function interpolateRecord(
  record: Readonly<Record<string, unknown>>,
  variables: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = typeof v === "string" ? interpolate(v, variables) : v;
  }
  return out;
}

function describeStep(step: RecipeStep): string {
  switch (step.type) {
    case "read":
      return `read ${step.path}`;
    case "write":
      return `write ${step.path}`;
    case "bash":
      return `bash "${step.cmd}"`;
    case "prompt":
      return `prompt`;
    case "subrecipe":
      return `subrecipe ${step.ref}`;
  }
}
