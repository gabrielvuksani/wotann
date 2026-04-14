/**
 * CLI command definitions for wotann.
 * Each command is a pure function that takes options and returns results.
 */

import chalk from "chalk";
import { createWorkspace } from "../core/workspace.js";
import {
  discoverProviders,
  formatFullStatus,
} from "../providers/discovery.js";
import type { ProviderStatus } from "../core/types.js";

// ── wotann init ──────────────────────────────────────────────

export interface InitOptions {
  readonly free?: boolean;
  readonly minimal?: boolean;
  readonly advanced?: boolean;
  readonly reset?: boolean;
  readonly extendedContext?: boolean;
}

export async function runInit(
  targetDir: string,
  options: InitOptions,
): Promise<void> {
  console.log(chalk.bold("\n  Welcome to WOTANN — Unified Agent Harness\n"));

  // Create workspace (or reset if --reset)
  const result = createWorkspace({
    targetDir,
    freeMode: options.free,
    minimal: options.minimal,
    reset: options.reset,
    extendedContext: options.extendedContext,
  });

  if (result.alreadyExists && !options.reset) {
    console.log(chalk.dim("  .wotann/ already exists (use --reset to recreate)\n"));
  }

  if (result.created) {
    console.log(chalk.green("  ✓ Workspace created:"));
    for (const file of result.filesCreated) {
      console.log(chalk.dim(`    + ${file}`));
    }
    console.log();
  }

  // ── ALWAYS show full provider status (like OpenClaw onboard) ──
  const providers = await discoverProviders();
  const statuses = formatFullStatus(providers);
  const active = statuses.filter((s) => s.available);
  const inactive = statuses.filter((s) => !s.available);

  console.log(chalk.bold(`  Providers: ${active.length}/${statuses.length} active\n`));

  // Show active providers
  for (const p of active) {
    console.log(
      chalk.green("    ●") +
      ` ${p.label}` +
      chalk.dim(` (${p.billing})`) +
      chalk.dim(` — ${p.models.slice(0, 3).join(", ")}`),
    );
  }

  // Show inactive providers with setup instructions
  if (inactive.length > 0) {
    console.log();
    console.log(chalk.dim("  Unconfigured providers (add any you have):"));
    for (const p of inactive) {
      const setupHint = getProviderSetupHint(p.provider);
      console.log(chalk.dim(`    ○ ${p.label}`) + chalk.dim(` — ${setupHint}`));
    }
  }

  // Free-tier guidance
  if (options.free) {
    console.log();
    console.log(chalk.bold("  Free-tier setup:"));
    console.log(chalk.dim("    Primary:  Ollama local (free, private, offline)"));
    console.log(chalk.dim("    Overflow: Cerebras → Groq → Google AI Studio"));
    console.log(chalk.dim("    KV cache: q8_0 (doubles Ollama context window)"));

    const ollamaActive = active.some((p) => p.provider === "ollama");
    if (!ollamaActive) {
      console.log();
      console.log(chalk.yellow("  ⚠ Ollama not detected."));
      console.log(chalk.dim("    Install: https://ollama.ai"));
      console.log(chalk.dim("    Then:    ollama pull qwen3-coder-next"));
    }
  }

  // Extended context guidance
  if (options.extendedContext) {
    console.log();
    console.log(chalk.bold("  Extended context:"));
    console.log(chalk.dim("    Config written with extendedContext: true"));
    console.log(chalk.dim("    For runtime activation, set in your shell:"));
    console.log(chalk.cyan("      export WOTANN_ENABLE_EXTENDED_CONTEXT=1"));
    console.log(chalk.dim("    This enables 1M context on Anthropic Opus models."));
  }

  console.log();
  console.log(chalk.green("  ✓ Ready.") + " Run " + chalk.cyan("wotann") + " to start.\n");
}

function getProviderSetupHint(provider: string): string {
  switch (provider) {
    case "anthropic": return "export ANTHROPIC_API_KEY=sk-ant-...";
    case "openai": return "export OPENAI_API_KEY=sk-...";
    case "codex": return "npx @openai/codex --full-auto \"hello\"";
    case "copilot": return "export GH_TOKEN=ghp_... (GitHub PAT)";
    case "ollama": return "ollama serve (https://ollama.ai)";
    case "gemini": return "export GEMINI_API_KEY=... (free at ai.google.dev)";
    case "huggingface": return "export HF_TOKEN=... (Inference Providers free credits)";
    case "free": return "Auto-configured (Cerebras, Groq, etc.)";
    case "azure": return "export AZURE_OPENAI_API_KEY=...";
    case "bedrock": return "AWS credentials (aws configure)";
    case "vertex": return "gcloud auth application-default login";
    default: return "See docs";
  }
}

// ── wotann providers ─────────────────────────────────────────

export async function runProviders(): Promise<void> {
  console.log(chalk.bold("\nWOTANN Provider Status\n"));

  const providers = await discoverProviders();
  const statuses = formatFullStatus(providers);

  for (const status of statuses) {
    printProviderStatus(status);
  }

  const active = statuses.filter((s) => s.available);
  console.log(
    chalk.dim(`\n  ${active.length} of ${statuses.length} providers active\n`),
  );
}

function printProviderStatus(status: ProviderStatus): void {
  const icon = status.available ? chalk.green("●") : chalk.red("○");
  const name = status.available
    ? chalk.bold(status.label)
    : chalk.dim(status.label);
  const billing = status.available
    ? chalk.dim(` (${status.billing})`)
    : "";
  const models = status.available && status.models.length > 0
    ? chalk.dim(` — ${status.models.slice(0, 3).join(", ")}`)
    : "";
  const error = status.error
    ? chalk.dim(` — ${status.error}`)
    : "";

  console.log(`  ${icon} ${name}${billing}${models}${error}`);
}

// ── wotann doctor ────────────────────────────────────────────

export async function runDoctor(targetDir: string): Promise<void> {
  console.log(chalk.bold("\nWOTANN Health Check\n"));

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // Check workspace
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const hasWorkspace = existsSync(join(targetDir, ".wotann"));
  checks.push({
    name: "Workspace (.wotann/)",
    ok: hasWorkspace,
    detail: hasWorkspace ? "Found" : "Run `wotann init` to create",
  });

  // Check providers
  const providers = await discoverProviders();
  checks.push({
    name: "Providers",
    ok: providers.length > 0,
    detail: providers.length > 0
      ? `${providers.length} detected`
      : "None configured",
  });

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: "Node.js",
    ok: majorVersion >= 20,
    detail: `${nodeVersion} (requires ≥20)`,
  });

  // Print results
  for (const check of checks) {
    const icon = check.ok ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }

  const allOk = checks.every((c) => c.ok);
  console.log();
  console.log(
    allOk
      ? chalk.green("  All checks passed.\n")
      : chalk.yellow("  Some checks failed. Fix issues above.\n"),
  );
}
