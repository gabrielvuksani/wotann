/**
 * Onboarding Wizard — guided first-time setup (Appendix W).
 *
 * 7-step interactive setup:
 * 1. Welcome + project type detection
 * 2. Provider selection and authentication
 * 3. Model selection (recommended based on hardware/subscription)
 * 4. Workspace creation (.wotann/ with 8 bootstrap files)
 * 5. Skill installation (auto-detect from project type)
 * 6. Import existing config (from Claude Code, Cursor, etc.)
 * 7. Health check + first prompt suggestion
 *
 * Modes:
 * - --quick: auto-detect everything, minimal prompts
 * - --free: Ollama-first with free cloud overflow
 * - --advanced: full control over every step
 */

import chalk from "chalk";
import { discoverProviders, formatFullStatus } from "../providers/discovery.js";
import { createWorkspace } from "../core/workspace.js";
import { gatherLocalContext } from "../middleware/local-context.js";
import { discoverImportableSkills } from "../skills/eval.js";

export interface OnboardingOptions {
  readonly quick?: boolean;
  readonly free?: boolean;
  readonly advanced?: boolean;
}

export interface OnboardingResult {
  readonly providersFound: number;
  readonly workspaceCreated: boolean;
  readonly skillsImported: number;
  readonly configImported: boolean;
  readonly healthPassed: boolean;
}

/**
 * Run the full 7-step onboarding wizard.
 */
export async function runOnboarding(
  targetDir: string,
  options: OnboardingOptions,
): Promise<OnboardingResult> {
  // ── Step 1: Welcome ──────────────────────────────────────
  console.log(chalk.bold("\n  Welcome to WOTANN — Unified AI Agent Harness\n"));

  const ctx = gatherLocalContext(targetDir);
  console.log(chalk.dim(`  Project: ${ctx.projectType} | Dir: ${targetDir}`));
  if (ctx.languages.length > 0) {
    console.log(chalk.dim(`  Languages: ${ctx.languages.join(", ")}`));
  }
  console.log();

  // ── Step 2: Provider Discovery ───────────────────────────
  console.log(chalk.bold("  Step 1: Detecting providers...\n"));

  const providers = await discoverProviders();
  const statuses = formatFullStatus(providers);
  const active = statuses.filter((s) => s.available);

  for (const status of statuses) {
    const icon = status.available ? chalk.green("  ok") : chalk.dim("  --");
    const name = status.available ? chalk.white(status.label) : chalk.dim(status.label);
    const models = status.available && status.models.length > 0
      ? chalk.dim(` — ${status.models.slice(0, 2).join(", ")}`)
      : "";
    console.log(`${icon} ${name}${models}`);
  }
  console.log();

  if (active.length === 0) {
    console.log(chalk.yellow("  No providers detected. Set up at least one:"));
    console.log(chalk.dim("    wotann login anthropic   — Claude subscription or API key"));
    console.log(chalk.dim("    wotann login copilot     — GitHub Copilot (free tier available)"));
    console.log(chalk.dim("    wotann login ollama      — Local models (free, private)"));
    console.log(chalk.dim("    wotann login gemini      — Google Gemini (free tier: 1.5M tokens/day)"));
    console.log();
  }

  if (options.free) {
    console.log(chalk.bold("  Free-tier mode:"));
    console.log(chalk.dim("    Primary: Ollama local (zero cost, private)"));
    console.log(chalk.dim("    Overflow: Gemini Flash → Cerebras → Groq → OpenRouter"));
    console.log(chalk.dim("    KV cache: q8_0 (2x context for same VRAM)"));
    console.log();
  }

  // ── Step 3: Workspace Creation ───────────────────────────
  console.log(chalk.bold("  Step 2: Creating workspace...\n"));

  const workspace = createWorkspace({
    targetDir,
    freeMode: options.free,
    minimal: options.quick,
  });

  if (workspace.created) {
    console.log(chalk.green("  Created .wotann/ workspace:"));
    for (const file of workspace.filesCreated) {
      console.log(chalk.dim(`    + ${file}`));
    }
  } else if (workspace.alreadyExists) {
    console.log(chalk.dim("  .wotann/ already exists — keeping existing config."));
  }
  console.log();

  // ── Step 4: Skill Discovery ──────────────────────────────
  console.log(chalk.bold("  Step 3: Discovering skills...\n"));

  const importableSkills = discoverImportableSkills(targetDir);
  if (importableSkills.length > 0) {
    console.log(`  Found ${importableSkills.length} importable skill(s):`);
    const bySource = new Map<string, string[]>();
    for (const skill of importableSkills) {
      const list = bySource.get(skill.source) ?? [];
      list.push(skill.name);
      bySource.set(skill.source, list);
    }
    for (const [source, skills] of bySource) {
      console.log(chalk.dim(`    ${source}: ${skills.slice(0, 5).join(", ")}${skills.length > 5 ? ` (+${skills.length - 5} more)` : ""}`));
    }
  } else {
    console.log(chalk.dim("  No existing skills found. Using built-in skill library."));
  }
  console.log();

  // ── Step 5: Health Check ─────────────────────────────────
  console.log(chalk.bold("  Step 4: Health check...\n"));

  const checks: { name: string; ok: boolean; detail: string }[] = [];

  // Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: "Node.js",
    ok: majorVersion >= 20,
    detail: `${nodeVersion} (requires >=20)`,
  });

  // Providers
  checks.push({
    name: "Providers",
    ok: active.length > 0,
    detail: active.length > 0 ? `${active.length} active` : "None configured",
  });

  // Workspace
  checks.push({
    name: "Workspace",
    ok: workspace.created || workspace.alreadyExists,
    detail: workspace.created ? "Created" : workspace.alreadyExists ? "Exists" : "Missing",
  });

  for (const check of checks) {
    const icon = check.ok ? chalk.green("  ok") : chalk.red("  --");
    console.log(`${icon} ${check.name}: ${check.detail}`);
  }

  const allOk = checks.every((c) => c.ok);
  console.log();

  // ── Summary ──────────────────────────────────────────────
  if (allOk) {
    console.log(chalk.green("  Ready! Run `wotann` to start the interactive harness.\n"));
    console.log(chalk.dim("  Quick commands:"));
    console.log(chalk.dim("    wotann                   — Interactive TUI"));
    console.log(chalk.dim("    wotann run \"<prompt>\"     — Non-interactive query"));
    console.log(chalk.dim("    wotann auto \"<prompt>\"    — Autonomous mode"));
    console.log(chalk.dim("    wotann arena \"<prompt>\"   — Blind model comparison"));
    console.log();
  } else {
    console.log(chalk.yellow("  Setup incomplete. Fix the issues above, then run `wotann init` again.\n"));
  }

  return {
    providersFound: active.length,
    workspaceCreated: workspace.created,
    skillsImported: importableSkills.length,
    configImported: false,
    healthPassed: allOk,
  };
}
