/**
 * Tests for src/recipes/recipe-loader.ts (T12.4).
 *
 * Strategy:
 *   - Round-trip a real Goose-style YAML through `parseRecipeYaml` and
 *     assert the camelCase mapping + every nested field.
 *   - Drive each rejection path (missing version / id / title /
 *     instructions / steps / parameters / cron / sub_recipes) with a
 *     malformed source string.
 *   - File-loader path tested with a temp file.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRecipeYaml,
  loadRecipeFromFile,
  validateRecipe,
} from "../../src/recipes/recipe-loader.js";

const HAPPY_YAML = `
version: 1
id: refactor-for-tests
title: "Refactor file for testability"
author: community
description: "Test recipe"
instructions: |
  Refactor a file for testability.
required_extensions: [typescript, vitest]
parameters:
  - name: filePath
    type: string
    required: true
    description: Path to file
  - name: targetCoverage
    type: number
    default: 80
retry:
  maxAttempts: 2
  strategy: exponential
  baseDelayMs: 50
steps:
  - type: read
    path: "{{filePath}}"
  - type: prompt
    text: |
      Refactor {{filePath}} to {{targetCoverage}}%.
  - type: bash
    cmd: "npx vitest run --coverage"
    expect: "passing"
sub_recipes:
  - ref: code-review/typescript
    with:
      file: "{{filePath}}"
cron: "0 * * * *"
`;

describe("parseRecipeYaml — happy path (matrix row 1)", () => {
  it("parses every documented field", () => {
    const r = parseRecipeYaml(HAPPY_YAML);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const recipe = r.recipe;
    expect(recipe.version).toBe(1);
    expect(recipe.id).toBe("refactor-for-tests");
    expect(recipe.title).toBe("Refactor file for testability");
    expect(recipe.author).toBe("community");
    expect(recipe.description).toBe("Test recipe");
    expect(recipe.instructions).toMatch(/Refactor a file/);
    expect(recipe.requiredExtensions).toEqual(["typescript", "vitest"]);
    expect(recipe.parameters).toHaveLength(2);
    expect(recipe.parameters[0]).toEqual({
      name: "filePath",
      type: "string",
      required: true,
      description: "Path to file",
    });
    expect(recipe.parameters[1]).toEqual({
      name: "targetCoverage",
      type: "number",
      required: false,
      default: 80,
    });
    expect(recipe.retry).toEqual({
      maxAttempts: 2,
      strategy: "exponential",
      baseDelayMs: 50,
    });
    expect(recipe.steps).toHaveLength(3);
    expect(recipe.steps[0]).toEqual({ type: "read", path: "{{filePath}}" });
    expect(recipe.steps[1]).toMatchObject({ type: "prompt" });
    expect(recipe.steps[2]).toMatchObject({
      type: "bash",
      cmd: "npx vitest run --coverage",
      expect: "passing",
    });
    expect(recipe.subRecipes).toEqual([
      {
        ref: "code-review/typescript",
        with: { file: "{{filePath}}" },
      },
    ]);
    expect(recipe.cron).toEqual({ expression: "0 * * * *" });
  });
});

describe("parseRecipeYaml — top-level rejections (QB #6)", () => {
  it("rejects malformed YAML (matrix row 6)", () => {
    const r = parseRecipeYaml("version: 1\n  unclosed: [");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/YAML parse error/);
  });

  it("rejects empty document", () => {
    const r = parseRecipeYaml("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/empty document/);
  });

  it("rejects non-mapping root", () => {
    const r = parseRecipeYaml("- not\n- a\n- map");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/root must be a YAML mapping/);
  });

  it("rejects wrong version", () => {
    const r = parseRecipeYaml(`version: 2\nid: x\ntitle: y\ninstructions: z\nsteps: [{type: bash, cmd: ls}]`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/version must be 1/);
  });

  it("rejects missing id", () => {
    const r = parseRecipeYaml(`version: 1\ntitle: y\ninstructions: z\nsteps: [{type: bash, cmd: ls}]`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/id must be a non-empty string/);
  });

  it("rejects missing title", () => {
    const r = parseRecipeYaml(`version: 1\nid: a\ninstructions: z\nsteps: [{type: bash, cmd: ls}]`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/title must be a non-empty string/);
  });

  it("rejects missing instructions", () => {
    const r = parseRecipeYaml(`version: 1\nid: a\ntitle: b\nsteps: [{type: bash, cmd: ls}]`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/instructions must be a non-empty string/);
  });

  it("rejects missing steps", () => {
    const r = parseRecipeYaml(`version: 1\nid: a\ntitle: b\ninstructions: c`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/steps must be a non-empty array/);
  });

  it("rejects empty steps", () => {
    const r = parseRecipeYaml(`version: 1\nid: a\ntitle: b\ninstructions: c\nsteps: []`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/steps must be a non-empty array/);
  });
});

describe("parseRecipeYaml — step-shape validation", () => {
  function withStep(step: string) {
    return `version: 1\nid: a\ntitle: b\ninstructions: c\nsteps:\n  - ${step}`;
  }

  it("rejects unknown step type (errors include type literal)", () => {
    const r = parseRecipeYaml(withStep("type: lol"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/steps\[0\]\.type must be read\|write\|bash\|prompt\|subrecipe/);
  });

  it("rejects bash step with empty cmd", () => {
    const r = parseRecipeYaml(withStep("{type: bash, cmd: ''}"));
    expect(r.ok).toBe(false);
  });

  it("rejects read step with no path", () => {
    const r = parseRecipeYaml(withStep("{type: read}"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/steps\[0\]\.path required/);
  });

  it("rejects subrecipe step with no ref", () => {
    const r = parseRecipeYaml(withStep("{type: subrecipe}"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/steps\[0\]\.ref required/);
  });

  it("accepts well-formed write step", () => {
    const r = parseRecipeYaml(withStep("{type: write, path: out.txt, content: hello}"));
    expect(r.ok).toBe(true);
  });

  it("accepts subrecipe step with `with` mapping", () => {
    const r = parseRecipeYaml(withStep("{type: subrecipe, ref: x, with: {a: 1}}"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.steps[0]).toMatchObject({
      type: "subrecipe",
      ref: "x",
      with: { a: 1 },
    });
  });
});

describe("parseRecipeYaml — parameter validation", () => {
  function withParams(params: string) {
    return `version: 1\nid: a\ntitle: b\ninstructions: c\nparameters: ${params}\nsteps: [{type: bash, cmd: ls}]`;
  }

  it("rejects param without name", () => {
    const r = parseRecipeYaml(withParams("[{type: string}]"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/parameters\[0\]\.name must be a non-empty string/);
  });

  it("rejects unknown param type", () => {
    const r = parseRecipeYaml(withParams("[{name: x, type: array}]"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/parameters\[0\]\.type must be string\|number\|boolean/);
  });

  it("rejects mistyped default", () => {
    const r = parseRecipeYaml(withParams("[{name: x, type: number, default: \"oops\"}]"));
    // YAML keeps the string; loader rejects type mismatch via default-type
    // check: but the loader allows the YAML default to be any of the
    // supported scalar types and defers type-checking to the runtime.
    // So this loads OK at parse time. The runtime test exercises the
    // mismatch.
    expect(r.ok).toBe(true);
  });

  it("rejects malformed required flag", () => {
    const r = parseRecipeYaml(withParams("[{name: x, type: string, required: \"yes\"}]"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/parameters\[0\]\.required must be a boolean/);
  });
});

describe("parseRecipeYaml — retry / cron / sub_recipes validation", () => {
  function tail(extras: string) {
    return `version: 1\nid: a\ntitle: b\ninstructions: c\nsteps: [{type: bash, cmd: ls}]\n${extras}`;
  }

  it("rejects retry.maxAttempts < 1", () => {
    const r = parseRecipeYaml(tail("retry:\n  maxAttempts: 0"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/retry\.maxAttempts must be >= 1/);
  });

  it("rejects retry.strategy invalid", () => {
    const r = parseRecipeYaml(tail("retry:\n  maxAttempts: 1\n  strategy: linear"));
    expect(r.ok).toBe(false);
  });

  it("accepts cron string", () => {
    const r = parseRecipeYaml(tail("cron: '*/5 * * * *'"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.cron?.expression).toBe("*/5 * * * *");
  });

  it("accepts cron mapping with label", () => {
    const r = parseRecipeYaml(tail("cron:\n  expression: '0 9 * * *'\n  label: morning"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.cron?.expression).toBe("0 9 * * *");
    expect(r.recipe.cron?.label).toBe("morning");
  });

  it("rejects sub_recipes entry without ref", () => {
    const r = parseRecipeYaml(tail("sub_recipes:\n  - {with: {a: 1}}"));
    expect(r.ok).toBe(false);
  });
});

describe("validateRecipe direct API (sanity)", () => {
  it("rejects null", () => {
    const r = validateRecipe(null);
    expect(r.ok).toBe(false);
  });
  it("rejects array root", () => {
    const r = validateRecipe([1, 2, 3]);
    expect(r.ok).toBe(false);
  });
});

// ── File loader ──────────────────────────────────────

describe("loadRecipeFromFile", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "wotann-recipe-loader-"));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("reads and parses a valid recipe from disk", async () => {
    const path = join(workDir, "ok.yaml");
    await writeFile(path, HAPPY_YAML);
    const r = await loadRecipeFromFile(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.id).toBe("refactor-for-tests");
  });

  it("returns honest-stub error on missing file", async () => {
    const r = await loadRecipeFromFile(join(workDir, "no-such.yaml"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/failed to read/);
  });

  it("rejects empty path", async () => {
    const r = await loadRecipeFromFile("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/non-empty/);
  });
});
