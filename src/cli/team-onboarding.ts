/**
 * /team-onboarding (C22) — replayable setup guide.
 *
 * Detects what a teammate cloning this repo needs to do to reach parity
 * with the committing developer. Produces an ordered checklist keyed
 * off the project's StackProfile and the WOTANN workspace state, then
 * renders it as either a printable markdown plan or a runnable shell
 * recipe.
 *
 * Non-destructive by default: `record` writes `.wotann/onboarding.yaml`,
 * `plan` prints the checklist, `run --execute` actually runs each step
 * (after confirmation, via the caller) — the module here only produces
 * the plan; execution lives in the CLI wrapper.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StackProfile } from "../core/project-onboarding.js";

// ── Types ────────────────────────────────────────────────────

export type OnboardingStepCategory =
  | "prereq"
  | "install"
  | "env"
  | "init"
  | "mcp"
  | "build"
  | "verify";

export interface OnboardingStep {
  readonly category: OnboardingStepCategory;
  readonly title: string;
  readonly command: string | null; // null = manual action
  readonly reason: string;
  readonly optional: boolean;
}

export interface OnboardingRecipe {
  readonly version: 1;
  readonly projectName: string;
  readonly generatedAt: string;
  readonly steps: readonly OnboardingStep[];
}

// ── Detection heuristics ─────────────────────────────────────

export interface OnboardingDetectorInputs {
  readonly projectDir: string;
  readonly stack: StackProfile;
  /** e.g. ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] — secrets the user needs. */
  readonly requiredEnvVars?: readonly string[];
  readonly enableWotann?: boolean;
}

export function detectOnboardingSteps(input: OnboardingDetectorInputs): readonly OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  const { projectDir, stack } = input;

  // 1. Node prereq (most WOTANN-adjacent projects use node)
  const isNode =
    stack.primaryLanguage === "TypeScript" ||
    stack.primaryLanguage === "JavaScript" ||
    existsSync(join(projectDir, "package.json"));
  if (isNode) {
    steps.push({
      category: "prereq",
      title: "Install Node.js 20+",
      command: null,
      reason: "package.json detected; WOTANN targets Node 20+",
      optional: false,
    });
  }

  // 2. Package-manager install
  const pm = stack.packageManager;
  if (pm && isNode) {
    const installCmd =
      pm === "pnpm" ? "pnpm install" : pm === "yarn" ? "yarn install" : "npm install";
    steps.push({
      category: "install",
      title: `Install dependencies via ${pm}`,
      command: installCmd,
      reason: `lockfile for ${pm} detected`,
      optional: false,
    });
  }

  // 3. Python deps (if stack contains Python)
  const hasPython = stack.languages.some((l) => l.name === "Python");
  if (hasPython) {
    if (existsSync(join(projectDir, "pyproject.toml"))) {
      steps.push({
        category: "install",
        title: "Install Python dependencies",
        command: "pip install -e .",
        reason: "pyproject.toml detected",
        optional: false,
      });
    } else if (existsSync(join(projectDir, "requirements.txt"))) {
      steps.push({
        category: "install",
        title: "Install Python dependencies",
        command: "pip install -r requirements.txt",
        reason: "requirements.txt detected",
        optional: false,
      });
    }
  }

  // 4. Docker (optional — useful for integration tests)
  if (stack.hasDocker) {
    steps.push({
      category: "prereq",
      title: "Install Docker Desktop",
      command: null,
      reason: "project uses Docker (Dockerfile or compose file detected)",
      optional: true,
    });
  }

  // 5. Environment variables
  for (const envVar of input.requiredEnvVars ?? []) {
    steps.push({
      category: "env",
      title: `Set ${envVar}`,
      command: null,
      reason: "required secret (do not commit)",
      optional: false,
    });
  }

  // 6. WOTANN init if enabled and no workspace yet
  if (input.enableWotann) {
    const hasWorkspace = existsSync(join(projectDir, ".wotann"));
    if (!hasWorkspace) {
      steps.push({
        category: "init",
        title: "Bootstrap WOTANN workspace",
        command: "wotann init",
        reason: "no .wotann/ directory found",
        optional: false,
      });
    }
  }

  // 7. MCP registry import (opt-in — respects Cognee/Omi default-disabled)
  if (input.enableWotann) {
    steps.push({
      category: "mcp",
      title: "Import MCP servers from Claude Code settings",
      command: "wotann mcp import --from=claude-code",
      reason: "pulls in user's existing MCP servers",
      optional: true,
    });
  }

  // 8. Build
  if (existsSync(join(projectDir, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8")) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.["build"]) {
        steps.push({
          category: "build",
          title: "Run build",
          command: `${pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm"} run build`,
          reason: "package.json has a build script",
          optional: false,
        });
      }
    } catch {
      /* best-effort */
    }
  }

  // 9. Verify (tests + typecheck)
  const verifyBaseCmd = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm";
  if (existsSync(join(projectDir, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8")) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.["test"]) {
        steps.push({
          category: "verify",
          title: "Run tests",
          command: `${verifyBaseCmd} test`,
          reason: "verifies the setup worked",
          optional: false,
        });
      }
      if (pkg.scripts?.["typecheck"] || pkg.scripts?.["tsc"]) {
        steps.push({
          category: "verify",
          title: "Run typecheck",
          command: `${verifyBaseCmd} run ${pkg.scripts?.["typecheck"] ? "typecheck" : "tsc"}`,
          reason: "catches TS breakage",
          optional: false,
        });
      }
    } catch {
      /* best-effort */
    }
  }

  return steps;
}

export function buildRecipe(input: OnboardingDetectorInputs): OnboardingRecipe {
  return {
    version: 1,
    projectName: detectProjectName(input.projectDir),
    generatedAt: new Date().toISOString(),
    steps: detectOnboardingSteps(input),
  };
}

function detectProjectName(projectDir: string): string {
  const pkgPath = join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
      if (typeof pkg.name === "string" && pkg.name.length > 0) return pkg.name;
    } catch {
      /* fall through to directory-based name */
    }
  }
  return projectDir.split("/").filter(Boolean).pop() ?? "project";
}

// ── Persistence ──────────────────────────────────────────────

export function recipePath(projectDir: string): string {
  return join(projectDir, ".wotann", "onboarding.yaml");
}

export function writeRecipe(projectDir: string, recipe: OnboardingRecipe): string {
  const path = recipePath(projectDir);
  writeFileSync(path, renderRecipeYaml(recipe), "utf-8");
  return path;
}

export function readRecipe(projectDir: string): OnboardingRecipe | null {
  const path = recipePath(projectDir);
  if (!existsSync(path)) return null;
  try {
    return parseRecipeYaml(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Intentionally minimal hand-rolled YAML (the existing registry.ts uses
 * the `yaml` package, but onboarding recipes are simple enough that a
 * dedicated serializer avoids the dep weight + keeps output
 * deterministic for diffing).
 */
export function renderRecipeYaml(recipe: OnboardingRecipe): string {
  const lines: string[] = [
    `version: ${recipe.version}`,
    `projectName: ${JSON.stringify(recipe.projectName)}`,
    `generatedAt: ${JSON.stringify(recipe.generatedAt)}`,
    "steps:",
  ];
  for (const step of recipe.steps) {
    lines.push(`  - category: ${step.category}`);
    lines.push(`    title: ${JSON.stringify(step.title)}`);
    lines.push(`    command: ${step.command === null ? "null" : JSON.stringify(step.command)}`);
    lines.push(`    reason: ${JSON.stringify(step.reason)}`);
    lines.push(`    optional: ${step.optional}`);
  }
  return lines.join("\n") + "\n";
}

export function parseRecipeYaml(content: string): OnboardingRecipe {
  // Scratch (writable) view; copied into the readonly shape at the end.
  const scratch: {
    version?: 1;
    projectName?: string;
    generatedAt?: string;
    steps: OnboardingStep[];
  } = { steps: [] };
  type StepScratch = {
    category?: OnboardingStepCategory;
    title?: string;
    command?: string | null;
    reason?: string;
    optional?: boolean;
  };
  let current: StepScratch | null = null;
  const finalizeCurrent = () => {
    if (
      current &&
      current.category !== undefined &&
      current.title !== undefined &&
      current.command !== undefined &&
      current.reason !== undefined &&
      current.optional !== undefined
    ) {
      scratch.steps.push({
        category: current.category,
        title: current.title,
        command: current.command,
        reason: current.reason,
        optional: current.optional,
      });
    }
  };

  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("version:")) {
      scratch.version = Number.parseInt(line.split(":")[1]?.trim() ?? "1", 10) as 1;
    } else if (line.startsWith("projectName:")) {
      scratch.projectName = JSON.parse(line.slice("projectName:".length).trim());
    } else if (line.startsWith("generatedAt:")) {
      scratch.generatedAt = JSON.parse(line.slice("generatedAt:".length).trim());
    } else if (line.startsWith("  - category:")) {
      finalizeCurrent();
      current = { category: line.split(":")[1]?.trim() as OnboardingStepCategory };
    } else if (current !== null) {
      if (line.startsWith("    title:")) {
        current.title = JSON.parse(line.slice("    title:".length).trim());
      } else if (line.startsWith("    command:")) {
        const val = line.slice("    command:".length).trim();
        current.command = val === "null" ? null : JSON.parse(val);
      } else if (line.startsWith("    reason:")) {
        current.reason = JSON.parse(line.slice("    reason:".length).trim());
      } else if (line.startsWith("    optional:")) {
        current.optional = line.endsWith("true");
      }
    }
  }
  finalizeCurrent();

  return {
    version: scratch.version ?? 1,
    projectName: scratch.projectName ?? "project",
    generatedAt: scratch.generatedAt ?? new Date().toISOString(),
    steps: scratch.steps,
  };
}

// ── Rendering ────────────────────────────────────────────────

export function renderRecipeChecklist(recipe: OnboardingRecipe): string {
  const lines: string[] = [
    `# ${recipe.projectName} — team onboarding`,
    `_Generated ${recipe.generatedAt.slice(0, 10)}_`,
    "",
  ];
  if (recipe.steps.length === 0) {
    lines.push("_(No steps detected — project may need no special setup.)_");
    return lines.join("\n");
  }
  const byCategory = new Map<OnboardingStepCategory, OnboardingStep[]>();
  for (const step of recipe.steps) {
    const list = byCategory.get(step.category) ?? [];
    list.push(step);
    byCategory.set(step.category, list);
  }
  const order: OnboardingStepCategory[] = [
    "prereq",
    "install",
    "env",
    "init",
    "mcp",
    "build",
    "verify",
  ];
  for (const cat of order) {
    const group = byCategory.get(cat);
    if (!group || group.length === 0) continue;
    lines.push(`## ${titleCase(cat)}`);
    for (const step of group) {
      const checkbox = step.optional ? "[o]" : "[ ]";
      lines.push(`- ${checkbox} ${step.title}`);
      if (step.command) lines.push(`  \`${step.command}\``);
      lines.push(`  _${step.reason}_`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
