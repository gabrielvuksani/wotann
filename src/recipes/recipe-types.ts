/**
 * T12.4 — Goose Recipe YAML system: types (~100 LOC, V9 §T12.4, line 1876).
 *
 * TypeScript types for `Recipe`, `RecipeStep`, `RecipeContext`, and
 * the related supporting shapes. WOTANN's recipe format is intended to
 * be Goose-compatible at the YAML level — the loader maps Goose's
 * snake_case YAML to camelCase TS, so a recipe written for Goose
 * round-trips through WOTANN unchanged.
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: discriminated unions for step types so
 *     consumers cannot accidentally treat one step shape as another.
 *   - QB #7  per-call state: only types here, no runtime state.
 *   - QB #13 env guard: no env reads.
 *   - QB #14 commit-claim verification: types verified by the
 *     loader/runtime tests via real YAML round-trips.
 */

// ── Top-level Recipe ──────────────────────────────────

/**
 * A Goose-compatible recipe describing a reusable agent task pipeline.
 *
 * Shape is the camelCase form; the YAML loader maps from snake_case
 * (e.g., `required_extensions` → `requiredExtensions`).
 */
export interface Recipe {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly description?: string;
  readonly instructions: string;
  readonly requiredExtensions?: readonly string[];
  readonly parameters: readonly RecipeParam[];
  readonly retry?: RecipeRetry;
  readonly steps: readonly RecipeStep[];
  readonly subRecipes?: readonly RecipeSubRecipe[];
  readonly cron?: RecipeCron;
}

// ── Parameters ────────────────────────────────────────

export type RecipeParamType = "string" | "number" | "boolean";

export interface RecipeParam {
  readonly name: string;
  readonly type: RecipeParamType;
  readonly required: boolean;
  readonly description?: string;
  readonly default?: string | number | boolean;
}

// ── Retry ─────────────────────────────────────────────

export interface RecipeRetry {
  readonly maxAttempts: number;
  readonly strategy: "fixed" | "exponential";
  /** Optional initial delay in ms (default 100). Only used by
   *  `exponential` strategy. */
  readonly baseDelayMs?: number;
}

// ── Steps (discriminated union) ───────────────────────

export type RecipeStep =
  | RecipeStepRead
  | RecipeStepWrite
  | RecipeStepBash
  | RecipeStepPrompt
  | RecipeStepSubRecipe;

export interface RecipeStepRead {
  readonly type: "read";
  readonly path: string;
  readonly into?: string;
}

export interface RecipeStepWrite {
  readonly type: "write";
  readonly path: string;
  readonly content: string;
}

export interface RecipeStepBash {
  readonly type: "bash";
  readonly cmd: string;
  /** Optional substring the runner expects in stdout to consider the
   *  step a success. When omitted, the step succeeds when the bash
   *  command exits 0. */
  readonly expect?: string;
}

export interface RecipeStepPrompt {
  readonly type: "prompt";
  readonly text: string;
  readonly into?: string;
}

export interface RecipeStepSubRecipe {
  readonly type: "subrecipe";
  readonly ref: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

// ── Sub-recipes ───────────────────────────────────────

export interface RecipeSubRecipe {
  readonly ref: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

// ── Cron ──────────────────────────────────────────────

export interface RecipeCron {
  /** Standard 5-field cron expression. */
  readonly expression: string;
  /** Optional human-readable label. */
  readonly label?: string;
}

// ── Runtime ───────────────────────────────────────────

/**
 * Mutable per-run context threaded between recipe steps. Per QB #7
 * this is per-call: each `runRecipe` invocation gets its own context;
 * never module-global.
 *
 * `variables` holds resolved parameter values (post-validation) and
 * outputs declared via step `into` keys. `outputs` accumulates each
 * step's structured result for the final return.
 */
export interface RecipeContext {
  readonly recipeId: string;
  readonly startedAt: number;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly outputs: readonly RecipeStepOutput[];
}

export interface RecipeStepOutput {
  readonly type: RecipeStep["type"];
  readonly ok: boolean;
  readonly attempt: number;
  readonly message?: string;
  readonly value?: unknown;
}

// ── Result types ──────────────────────────────────────

export type RecipeLoadResult =
  | { readonly ok: true; readonly recipe: Recipe }
  | { readonly ok: false; readonly error: string };

export type RecipeRunResult =
  | {
      readonly ok: true;
      readonly outputs: readonly RecipeStepOutput[];
      readonly variables: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly outputs: readonly RecipeStepOutput[];
    };

// ── Step executor (injected by the runtime) ───────────

/**
 * The runtime injects a `RecipeStepExecutor` to handle each step
 * type. Keeps `runRecipe` pure — no node:fs, no execFile direct calls
 * — so the runner can be tested with stubs and called from
 * non-Node environments (e.g., browser-side recipe planner).
 */
export interface RecipeStepExecutor {
  readonly read: (path: string) => Promise<{ ok: boolean; content?: string; error?: string }>;
  readonly write: (path: string, content: string) => Promise<{ ok: boolean; error?: string }>;
  readonly bash: (
    cmd: string,
  ) => Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; error?: string }>;
  readonly prompt: (text: string) => Promise<{ ok: boolean; response?: string; error?: string }>;
  readonly resolveSubRecipe?: (ref: string) => Promise<RecipeLoadResult>;
}

// ── Run options ───────────────────────────────────────

export interface RunRecipeOptions {
  readonly executor: RecipeStepExecutor;
  /** When true, skip side-effecting steps and emit a plan only. */
  readonly dryRun?: boolean;
  /** Available extensions (e.g., ["typescript", "vitest"]). The runtime
   *  injects what it actually has wired. */
  readonly availableExtensions?: readonly string[];
  /** Optional clock for deterministic timing in tests. */
  readonly now?: () => number;
}
