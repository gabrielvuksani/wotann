/**
 * C22 — /team-onboarding recipe tests.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRecipe,
  detectOnboardingSteps,
  parseRecipeYaml,
  readRecipe,
  renderRecipeChecklist,
  renderRecipeYaml,
  writeRecipe,
} from "../../src/cli/team-onboarding.js";
import type { StackProfile } from "../../src/core/project-onboarding.js";

function mkStack(overrides: Partial<StackProfile> = {}): StackProfile {
  return {
    languages: [
      { name: "TypeScript", extensions: [".ts"], fileCount: 200, percentage: 80 },
    ],
    frameworks: [],
    buildTools: ["tsc"],
    testFrameworks: ["vitest"],
    cicd: ["github-actions"],
    packageManager: "npm",
    hasDocker: false,
    hasMonorepo: false,
    primaryLanguage: "TypeScript",
    ...overrides,
  };
}

function mkProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "wotann-onboard-"));
  mkdirSync(join(dir, ".wotann"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name: "demo", scripts: { build: "tsc", test: "vitest run", typecheck: "tsc --noEmit" } },
      null,
      2,
    ),
    "utf-8",
  );
  return dir;
}

describe("detectOnboardingSteps", () => {
  it("prescribes Node + npm install + build + test + typecheck for a TS project", () => {
    const dir = mkProject();
    const steps = detectOnboardingSteps({ projectDir: dir, stack: mkStack() });
    const titles = steps.map((s) => s.title);
    expect(titles).toContain("Install Node.js 20+");
    expect(titles).toContain("Install dependencies via npm");
    expect(titles).toContain("Run build");
    expect(titles).toContain("Run tests");
    expect(titles).toContain("Run typecheck");
  });

  it("injects env-var steps for each requested secret", () => {
    const dir = mkProject();
    const steps = detectOnboardingSteps({
      projectDir: dir,
      stack: mkStack(),
      requiredEnvVars: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
    });
    const envSteps = steps.filter((s) => s.category === "env");
    expect(envSteps.map((s) => s.title)).toEqual([
      "Set ANTHROPIC_API_KEY",
      "Set OPENAI_API_KEY",
    ]);
    expect(envSteps.every((s) => s.command === null)).toBe(true);
  });

  it("suggests wotann init when enableWotann and no .wotann/ (uses fresh dir)", () => {
    // Fresh dir without .wotann/
    const dir = mkdtempSync(join(tmpdir(), "wotann-bare-"));
    writeFileSync(join(dir, "package.json"), "{}", "utf-8");
    const steps = detectOnboardingSteps({
      projectDir: dir,
      stack: mkStack(),
      enableWotann: true,
    });
    const init = steps.find((s) => s.category === "init");
    expect(init?.command).toBe("wotann init");
  });

  it("skips wotann init when workspace already exists", () => {
    const dir = mkProject(); // already contains .wotann/
    const steps = detectOnboardingSteps({
      projectDir: dir,
      stack: mkStack(),
      enableWotann: true,
    });
    const init = steps.find((s) => s.category === "init");
    expect(init).toBeUndefined();
  });

  it("adds Docker prereq as optional when hasDocker", () => {
    const dir = mkProject();
    const steps = detectOnboardingSteps({
      projectDir: dir,
      stack: mkStack({ hasDocker: true }),
    });
    const docker = steps.find((s) => s.title === "Install Docker Desktop");
    expect(docker).toBeDefined();
    expect(docker!.optional).toBe(true);
  });

  it("switches install command based on package manager", () => {
    const dir = mkProject();
    const pnpmSteps = detectOnboardingSteps({
      projectDir: dir,
      stack: mkStack({ packageManager: "pnpm" }),
    });
    expect(pnpmSteps.find((s) => s.category === "install")?.command).toBe("pnpm install");

    const yarnSteps = detectOnboardingSteps({
      projectDir: dir,
      stack: mkStack({ packageManager: "yarn" }),
    });
    expect(yarnSteps.find((s) => s.category === "install")?.command).toBe("yarn install");
  });
});

describe("YAML roundtrip", () => {
  it("renders then re-parses to an identical recipe", () => {
    const dir = mkProject();
    const recipe = buildRecipe({
      projectDir: dir,
      stack: mkStack(),
      requiredEnvVars: ["ANTHROPIC_API_KEY"],
    });
    const yaml = renderRecipeYaml(recipe);
    const parsed = parseRecipeYaml(yaml);
    expect(parsed.version).toBe(recipe.version);
    expect(parsed.projectName).toBe(recipe.projectName);
    expect(parsed.steps.length).toBe(recipe.steps.length);
    for (let i = 0; i < recipe.steps.length; i++) {
      expect(parsed.steps[i]?.title).toBe(recipe.steps[i]?.title);
      expect(parsed.steps[i]?.command).toBe(recipe.steps[i]?.command);
      expect(parsed.steps[i]?.optional).toBe(recipe.steps[i]?.optional);
    }
  });

  it("writes to .wotann/onboarding.yaml and reads it back", () => {
    const dir = mkProject();
    const recipe = buildRecipe({ projectDir: dir, stack: mkStack() });
    writeRecipe(dir, recipe);
    const loaded = readRecipe(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.projectName).toBe(recipe.projectName);
  });

  it("readRecipe returns null when file missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "wotann-nullrecipe-"));
    mkdirSync(join(dir, ".wotann"));
    expect(readRecipe(dir)).toBeNull();
  });
});

describe("renderRecipeChecklist", () => {
  it("groups steps by category and marks optional items", () => {
    const dir = mkProject();
    const recipe = buildRecipe({
      projectDir: dir,
      stack: mkStack({ hasDocker: true }),
    });
    const rendered = renderRecipeChecklist(recipe);
    expect(rendered).toMatch(/# demo — team onboarding/);
    expect(rendered).toMatch(/## Prereq/);
    expect(rendered).toMatch(/## Install/);
    expect(rendered).toMatch(/## Verify/);
    // Optional step gets [o]
    expect(rendered).toMatch(/\[o\].*Docker/);
    // Required step gets [ ]
    expect(rendered).toMatch(/\[ \].*Install dependencies/);
  });

  it('shows an empty-state message when no steps are detected', () => {
    const recipe = {
      version: 1 as const,
      projectName: "empty",
      generatedAt: new Date().toISOString(),
      steps: [] as never[],
    };
    const rendered = renderRecipeChecklist(recipe);
    expect(rendered).toMatch(/No steps detected/);
  });
});
