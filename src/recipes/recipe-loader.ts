/**
 * T12.4 — Goose Recipe YAML loader (~250 LOC, V9 §T12.4, line 1885).
 *
 * Parse a YAML recipe string into a typed {@link Recipe}, validating
 * shape, required fields, parameter declarations, step kinds, and
 * sub-recipe references. Mirrors Goose's recipe format so a recipe
 * authored for Goose loads in WOTANN unchanged.
 *
 * The file-path entry point ({@link loadRecipeFromFile}) is exposed
 * for callers that want to read from disk; the canonical parser
 * ({@link parseRecipeYaml}) is pure-string and easy to test.
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: every parse / validation failure returns
 *     `{ok:false, error}` with a precise field-pointing message.
 *     Never throws on bad input.
 *   - QB #7  per-call state: zero module globals.
 *   - QB #13 env guard: never reads process.env.
 *   - QB #14 commit-claim verification: tests round-trip a real YAML
 *     recipe and assert each rejected-field path actually rejects.
 */

import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import type {
  Recipe,
  RecipeCron,
  RecipeLoadResult,
  RecipeParam,
  RecipeRetry,
  RecipeStep,
  RecipeSubRecipe,
} from "./recipe-types.js";

// ── Public Entry Points ──────────────────────────────

/**
 * Parse a YAML string into a Recipe. Honest-stub on any failure.
 */
export function parseRecipeYaml(source: string): RecipeLoadResult {
  if (typeof source !== "string") {
    return { ok: false, error: "recipe-loader: source must be a string" };
  }
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `recipe-loader: YAML parse error: ${reason}` };
  }
  return validateRecipe(raw);
}

/**
 * Read a YAML file from disk and parse it.
 */
export async function loadRecipeFromFile(absPath: string): Promise<RecipeLoadResult> {
  if (typeof absPath !== "string" || absPath.length === 0) {
    return { ok: false, error: "recipe-loader: path must be a non-empty string" };
  }
  let source: string;
  try {
    source = await readFile(absPath, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `recipe-loader: failed to read ${absPath} — ${reason}` };
  }
  return parseRecipeYaml(source);
}

// ── Validation ───────────────────────────────────────

/**
 * Validate an unknown parsed-YAML root and produce a typed Recipe.
 * Field-by-field validation so error messages point at the offending
 * key — "parameters[2].name missing", not "validation failed."
 */
export function validateRecipe(raw: unknown): RecipeLoadResult {
  if (raw === null || raw === undefined) {
    return { ok: false, error: "recipe-loader: empty document" };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "recipe-loader: root must be a YAML mapping" };
  }
  const obj = raw as Record<string, unknown>;

  // version
  const version = obj["version"];
  if (version !== 1) {
    return {
      ok: false,
      error: `recipe-loader: version must be 1 (got ${stringifyForError(version)})`,
    };
  }

  // id
  const id = obj["id"];
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, error: "recipe-loader: id must be a non-empty string" };
  }

  // title
  const title = obj["title"];
  if (typeof title !== "string" || title.length === 0) {
    return { ok: false, error: "recipe-loader: title must be a non-empty string" };
  }

  // instructions
  const instructions = obj["instructions"];
  if (typeof instructions !== "string" || instructions.length === 0) {
    return { ok: false, error: "recipe-loader: instructions must be a non-empty string" };
  }

  // author (optional)
  const author = obj["author"];
  if (author !== undefined && typeof author !== "string") {
    return { ok: false, error: "recipe-loader: author must be a string when present" };
  }

  // description (optional)
  const description = obj["description"];
  if (description !== undefined && typeof description !== "string") {
    return { ok: false, error: "recipe-loader: description must be a string when present" };
  }

  // required_extensions (optional)
  let requiredExtensions: readonly string[] | undefined;
  const reRaw = obj["required_extensions"] ?? obj["requiredExtensions"];
  if (reRaw !== undefined) {
    if (!Array.isArray(reRaw)) {
      return { ok: false, error: "recipe-loader: required_extensions must be an array" };
    }
    for (const ext of reRaw) {
      if (typeof ext !== "string" || ext.length === 0) {
        return {
          ok: false,
          error: "recipe-loader: required_extensions entries must be non-empty strings",
        };
      }
    }
    requiredExtensions = Object.freeze([...(reRaw as string[])]);
  }

  // parameters (required, may be empty)
  const paramsResult = validateParameters(obj["parameters"]);
  if (!paramsResult.ok) return { ok: false, error: paramsResult.error };

  // retry (optional)
  const retryResult = validateRetry(obj["retry"]);
  if (!retryResult.ok) return { ok: false, error: retryResult.error };

  // steps (required)
  const stepsResult = validateSteps(obj["steps"]);
  if (!stepsResult.ok) return { ok: false, error: stepsResult.error };

  // sub_recipes (optional)
  const subResult = validateSubRecipes(obj["sub_recipes"] ?? obj["subRecipes"]);
  if (!subResult.ok) return { ok: false, error: subResult.error };

  // cron (optional)
  const cronResult = validateCron(obj["cron"]);
  if (!cronResult.ok) return { ok: false, error: cronResult.error };

  const recipe: Recipe = {
    version: 1,
    id,
    title,
    ...(author !== undefined ? { author } : {}),
    ...(description !== undefined ? { description } : {}),
    instructions,
    ...(requiredExtensions ? { requiredExtensions } : {}),
    parameters: paramsResult.value,
    ...(retryResult.value ? { retry: retryResult.value } : {}),
    steps: stepsResult.value,
    ...(subResult.value ? { subRecipes: subResult.value } : {}),
    ...(cronResult.value ? { cron: cronResult.value } : {}),
  };
  return { ok: true, recipe };
}

// ── Field validators ──────────────────────────────────

type FieldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

function validateParameters(raw: unknown): FieldResult<readonly RecipeParam[]> {
  if (raw === undefined) return { ok: true, value: Object.freeze([]) };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "recipe-loader: parameters must be an array" };
  }
  const out: RecipeParam[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!p || typeof p !== "object") {
      return { ok: false, error: `recipe-loader: parameters[${String(i)}] must be an object` };
    }
    const obj = p as Record<string, unknown>;
    const name = obj["name"];
    if (typeof name !== "string" || name.length === 0) {
      return {
        ok: false,
        error: `recipe-loader: parameters[${String(i)}].name must be a non-empty string`,
      };
    }
    const type = obj["type"] ?? "string";
    if (type !== "string" && type !== "number" && type !== "boolean") {
      return {
        ok: false,
        error: `recipe-loader: parameters[${String(i)}].type must be string|number|boolean`,
      };
    }
    const required = obj["required"];
    if (required !== undefined && typeof required !== "boolean") {
      return {
        ok: false,
        error: `recipe-loader: parameters[${String(i)}].required must be a boolean`,
      };
    }
    const description = obj["description"];
    if (description !== undefined && typeof description !== "string") {
      return {
        ok: false,
        error: `recipe-loader: parameters[${String(i)}].description must be a string`,
      };
    }
    const def = obj["default"];
    if (def !== undefined) {
      const t = typeof def;
      if (t !== "string" && t !== "number" && t !== "boolean") {
        return {
          ok: false,
          error: `recipe-loader: parameters[${String(i)}].default must be string|number|boolean`,
        };
      }
    }
    out.push({
      name,
      type,
      required: required ?? false,
      ...(description !== undefined ? { description } : {}),
      ...(def !== undefined ? { default: def as string | number | boolean } : {}),
    });
  }
  return { ok: true, value: Object.freeze(out) };
}

function validateRetry(raw: unknown): FieldResult<RecipeRetry | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "recipe-loader: retry must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  const maxAttempts = obj["maxAttempts"] ?? obj["max_attempts"];
  if (typeof maxAttempts !== "number" || !Number.isFinite(maxAttempts) || maxAttempts < 1) {
    return { ok: false, error: "recipe-loader: retry.maxAttempts must be >= 1" };
  }
  const strategy = obj["strategy"] ?? "fixed";
  if (strategy !== "fixed" && strategy !== "exponential") {
    return { ok: false, error: "recipe-loader: retry.strategy must be fixed|exponential" };
  }
  const baseDelayMs = obj["baseDelayMs"] ?? obj["base_delay_ms"];
  if (baseDelayMs !== undefined) {
    if (typeof baseDelayMs !== "number" || baseDelayMs < 0) {
      return { ok: false, error: "recipe-loader: retry.baseDelayMs must be >= 0" };
    }
  }
  return {
    ok: true,
    value: {
      maxAttempts: Math.floor(maxAttempts),
      strategy,
      ...(typeof baseDelayMs === "number" ? { baseDelayMs } : {}),
    },
  };
}

function validateSteps(raw: unknown): FieldResult<readonly RecipeStep[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "recipe-loader: steps must be a non-empty array" };
  }
  const out: RecipeStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const step = raw[i];
    if (!step || typeof step !== "object") {
      return { ok: false, error: `recipe-loader: steps[${String(i)}] must be an object` };
    }
    const obj = step as Record<string, unknown>;
    const type = obj["type"];
    switch (type) {
      case "read": {
        const path = obj["path"];
        if (typeof path !== "string" || path.length === 0) {
          return { ok: false, error: `recipe-loader: steps[${String(i)}].path required` };
        }
        const into = obj["into"];
        if (into !== undefined && typeof into !== "string") {
          return { ok: false, error: `recipe-loader: steps[${String(i)}].into must be a string` };
        }
        out.push({ type: "read", path, ...(into !== undefined ? { into } : {}) });
        break;
      }
      case "write": {
        const path = obj["path"];
        const content = obj["content"];
        if (typeof path !== "string" || path.length === 0) {
          return { ok: false, error: `recipe-loader: steps[${String(i)}].path required` };
        }
        if (typeof content !== "string") {
          return {
            ok: false,
            error: `recipe-loader: steps[${String(i)}].content must be a string`,
          };
        }
        out.push({ type: "write", path, content });
        break;
      }
      case "bash": {
        const cmd = obj["cmd"];
        if (typeof cmd !== "string" || cmd.length === 0) {
          return {
            ok: false,
            error: `recipe-loader: steps[${String(i)}].cmd required`,
          };
        }
        const expect = obj["expect"];
        if (expect !== undefined && typeof expect !== "string") {
          return {
            ok: false,
            error: `recipe-loader: steps[${String(i)}].expect must be a string`,
          };
        }
        out.push({ type: "bash", cmd, ...(expect !== undefined ? { expect } : {}) });
        break;
      }
      case "prompt": {
        const text = obj["text"];
        if (typeof text !== "string" || text.length === 0) {
          return {
            ok: false,
            error: `recipe-loader: steps[${String(i)}].text required`,
          };
        }
        const into = obj["into"];
        if (into !== undefined && typeof into !== "string") {
          return { ok: false, error: `recipe-loader: steps[${String(i)}].into must be a string` };
        }
        out.push({ type: "prompt", text, ...(into !== undefined ? { into } : {}) });
        break;
      }
      case "subrecipe": {
        const ref = obj["ref"];
        if (typeof ref !== "string" || ref.length === 0) {
          return {
            ok: false,
            error: `recipe-loader: steps[${String(i)}].ref required`,
          };
        }
        const withVars = obj["with"];
        if (withVars !== undefined && (typeof withVars !== "object" || Array.isArray(withVars))) {
          return {
            ok: false,
            error: `recipe-loader: steps[${String(i)}].with must be a mapping`,
          };
        }
        out.push({
          type: "subrecipe",
          ref,
          ...(withVars ? { with: withVars as Record<string, unknown> } : {}),
        });
        break;
      }
      default:
        return {
          ok: false,
          error: `recipe-loader: steps[${String(i)}].type must be read|write|bash|prompt|subrecipe (got ${stringifyForError(type)})`,
        };
    }
  }
  return { ok: true, value: Object.freeze(out) };
}

function validateSubRecipes(raw: unknown): FieldResult<readonly RecipeSubRecipe[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "recipe-loader: sub_recipes must be an array" };
  }
  const out: RecipeSubRecipe[] = [];
  for (let i = 0; i < raw.length; i++) {
    const sub = raw[i];
    if (!sub || typeof sub !== "object") {
      return { ok: false, error: `recipe-loader: sub_recipes[${String(i)}] must be an object` };
    }
    const obj = sub as Record<string, unknown>;
    const ref = obj["ref"];
    if (typeof ref !== "string" || ref.length === 0) {
      return { ok: false, error: `recipe-loader: sub_recipes[${String(i)}].ref required` };
    }
    const withVars = obj["with"];
    if (withVars !== undefined && (typeof withVars !== "object" || Array.isArray(withVars))) {
      return {
        ok: false,
        error: `recipe-loader: sub_recipes[${String(i)}].with must be a mapping`,
      };
    }
    out.push({
      ref,
      ...(withVars ? { with: withVars as Record<string, unknown> } : {}),
    });
  }
  return { ok: true, value: Object.freeze(out) };
}

function validateCron(raw: unknown): FieldResult<RecipeCron | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  // YAML scalar form: cron: "0 * * * *"
  if (typeof raw === "string" && raw.length > 0) {
    return { ok: true, value: { expression: raw } };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "recipe-loader: cron must be a string or mapping" };
  }
  const obj = raw as Record<string, unknown>;
  const expression = obj["expression"];
  if (typeof expression !== "string" || expression.length === 0) {
    return { ok: false, error: "recipe-loader: cron.expression required" };
  }
  const label = obj["label"];
  if (label !== undefined && typeof label !== "string") {
    return { ok: false, error: "recipe-loader: cron.label must be a string" };
  }
  return {
    ok: true,
    value: { expression, ...(label !== undefined ? { label } : {}) },
  };
}

// ── Helpers ──────────────────────────────────────────

function stringifyForError(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
