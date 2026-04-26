/**
 * CLI command definitions for wotann.
 * Each command is a pure function that takes options and returns results.
 */

import chalk from "chalk";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWorkspace } from "../core/workspace.js";
import { discoverProviders, formatFullStatus } from "../providers/discovery.js";
import type { ProviderStatus } from "../core/types.js";
import {
  buildPRDescription,
  parseConflictBlocks,
  parseDiffStat,
  renderCommitMessage,
  suggestCommitMessage,
  suggestConflictResolution,
} from "../git/magic-git.js";

const execFileAsync = promisify(execFile);

// ── wotann init ──────────────────────────────────────────────

export interface InitOptions {
  readonly free?: boolean;
  readonly minimal?: boolean;
  readonly advanced?: boolean;
  readonly reset?: boolean;
  readonly extendedContext?: boolean;
}

export async function runInit(targetDir: string, options: InitOptions): Promise<void> {
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
    case "anthropic":
      return "export ANTHROPIC_API_KEY=sk-ant-...";
    case "openai":
      return "export OPENAI_API_KEY=sk-...";
    case "codex":
      return 'npx @openai/codex --full-auto "hello"';
    case "copilot":
      return "export GH_TOKEN=ghp_... (GitHub PAT)";
    case "ollama":
      return "ollama serve (https://ollama.ai)";
    case "gemini":
      return "export GEMINI_API_KEY=... (free at ai.google.dev)";
    case "huggingface":
      return "export HF_TOKEN=... (Inference Providers free credits)";
    case "free":
      return "Auto-configured (Cerebras, Groq, etc.)";
    case "azure":
      return "export AZURE_OPENAI_API_KEY=...";
    case "bedrock":
      return "AWS credentials (aws configure)";
    case "vertex":
      return "gcloud auth application-default login";
    default:
      return "See docs";
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
  console.log(chalk.dim(`\n  ${active.length} of ${statuses.length} providers active\n`));
}

function printProviderStatus(status: ProviderStatus): void {
  const icon = status.available ? chalk.green("●") : chalk.red("○");
  const name = status.available ? chalk.bold(status.label) : chalk.dim(status.label);
  const billing = status.available ? chalk.dim(` (${status.billing})`) : "";
  const models =
    status.available && status.models.length > 0
      ? chalk.dim(` — ${status.models.slice(0, 3).join(", ")}`)
      : "";
  const error = status.error ? chalk.dim(` — ${status.error}`) : "";

  console.log(`  ${icon} ${name}${billing}${models}${error}`);
}

// ── wotann doctor ────────────────────────────────────────────

export async function runDoctor(targetDir: string): Promise<void> {
  console.log(chalk.bold("\nWOTANN Health Check\n"));

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const { existsSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { resolveWotannHomeSubdir } = await import("../utils/wotann-home.js");
  const { createConnection } = await import("node:net");

  // 1. Workspace
  const hasWorkspace = existsSync(join(targetDir, ".wotann"));
  checks.push({
    name: "Workspace (.wotann/)",
    ok: hasWorkspace,
    detail: hasWorkspace ? "Found" : "Run `wotann init` to create",
  });

  // 2. Providers
  const providers = await discoverProviders();
  checks.push({
    name: "Providers",
    ok: providers.length > 0,
    detail: providers.length > 0 ? `${providers.length} detected` : "None configured",
  });

  // 3. Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: "Node.js",
    ok: majorVersion >= 20,
    detail: `${nodeVersion} (requires ≥20)`,
  });

  // S4-9: Expanded doctor checks — daemon health, socket, DB integrity,
  // Ollama reachability, port conflicts, API key validity.

  // 4. Daemon socket reachability
  const socketPath = resolveWotannHomeSubdir("kairos.sock");
  const daemonSocketExists = existsSync(socketPath);
  let daemonAlive = false;
  if (daemonSocketExists) {
    daemonAlive = await new Promise<boolean>((resolve) => {
      const client = createConnection(socketPath);
      const timer = setTimeout(() => {
        client.destroy();
        resolve(false);
      }, 1500);
      client.on("connect", () => {
        clearTimeout(timer);
        client.end();
        resolve(true);
      });
      client.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }
  checks.push({
    name: "KAIROS daemon",
    ok: daemonAlive,
    detail: daemonAlive
      ? `Reachable at ${socketPath}`
      : daemonSocketExists
        ? "Socket file exists but not accepting connections — run `wotann daemon stop` then start"
        : "Not running (start with `wotann daemon start`)",
  });

  // 5. Memory DB integrity (best-effort; skip if not present)
  const memoryDb = resolveWotannHomeSubdir("memory.db");
  if (existsSync(memoryDb)) {
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(memoryDb, { readonly: true });
      const integrity = db.prepare("PRAGMA integrity_check").get() as {
        integrity_check?: string;
      };
      db.close();
      const ok = (integrity.integrity_check ?? "") === "ok";
      checks.push({
        name: "Memory DB",
        ok,
        detail: ok ? "Integrity check passed" : `Corruption detected: ${integrity.integrity_check}`,
      });
    } catch (err) {
      checks.push({
        name: "Memory DB",
        ok: false,
        detail: `Integrity check failed: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  } else {
    checks.push({
      name: "Memory DB",
      ok: true,
      detail: "Not yet created (no-op)",
    });
  }

  // 6. Ollama reachability (if configured)
  const ollamaUrl =
    process.env["OLLAMA_URL"] ?? process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${ollamaUrl}/api/version`, { signal: controller.signal });
    clearTimeout(timer);
    checks.push({
      name: "Ollama",
      ok: res.ok,
      detail: res.ok ? `Reachable at ${ollamaUrl}` : `HTTP ${res.status}`,
    });
  } catch {
    checks.push({
      name: "Ollama",
      ok: false,
      detail: `Not reachable at ${ollamaUrl} (install ollama or set OLLAMA_URL)`,
    });
  }

  // 7. Session token perms (if present) — must be 0o600
  const tokenPath = resolveWotannHomeSubdir("session-token.json");
  if (existsSync(tokenPath)) {
    try {
      const mode = statSync(tokenPath).mode & 0o777;
      const safe = mode === 0o600;
      checks.push({
        name: "Session token perms",
        ok: safe,
        detail: safe ? "0600 (user-only)" : `${mode.toString(8)} — should be 0600`,
      });
    } catch {
      checks.push({ name: "Session token perms", ok: false, detail: "Could not stat" });
    }
  }

  // 8. wotann.yaml perms (S0-11)
  const yamlPath = resolveWotannHomeSubdir("wotann.yaml");
  if (existsSync(yamlPath)) {
    try {
      const mode = statSync(yamlPath).mode & 0o777;
      const safe = mode === 0o600 || mode === 0o400;
      checks.push({
        name: "wotann.yaml perms",
        ok: safe,
        detail: safe ? `${mode.toString(8)} (user-only)` : `${mode.toString(8)} — API keys exposed`,
      });
    } catch {
      checks.push({ name: "wotann.yaml perms", ok: false, detail: "Could not stat" });
    }
  }

  // 9. Daemon PID file liveness (no zombie pid)
  const pidFile = resolveWotannHomeSubdir("daemon.pid");
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      checks.push({
        name: "Daemon PID",
        ok: alive,
        detail: alive ? `PID ${pid} is alive` : `PID ${pid} is stale (safe to delete ${pidFile})`,
      });
    } catch {
      checks.push({ name: "Daemon PID", ok: false, detail: "PID file unreadable" });
    }
  }

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

// ── wotann git (Magic Git — C20) ─────────────────────────────

export type MagicGitVerb = "commit-msg" | "pr-desc" | "resolve-conflict";

export interface MagicGitOptions {
  readonly verb: MagicGitVerb;
  readonly hint?: string;
  readonly baseBranch?: string;
  readonly file?: string;
  readonly cwd?: string;
}

/**
 * `wotann git commit-msg` / `pr-desc` / `resolve-conflict` — surfaces the
 * Magic Git analyzers from src/git/magic-git.ts as CLI verbs. Shells out
 * to `git` for numstat / log data; all inference runs locally with no
 * LLM call, so the verbs are fast and deterministic.
 */
export async function runMagicGit(options: MagicGitOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  if (options.verb === "commit-msg") {
    const { stdout } = await execFileAsync("git", ["diff", "--cached", "--numstat"], { cwd });
    const stats = parseDiffStat(stdout);
    const suggestion = suggestCommitMessage(stats, { hint: options.hint });
    console.log(renderCommitMessage(suggestion));
    console.log();
    console.log(
      chalk.dim(
        `  (type=${suggestion.type}, scope=${suggestion.scope ?? "-"}, ` +
          `confidence=${(suggestion.confidence * 100).toFixed(0)}%)`,
      ),
    );
    return;
  }

  if (options.verb === "pr-desc") {
    const base = options.baseBranch ?? "main";
    const { stdout: logOut } = await execFileAsync(
      "git",
      ["log", "--pretty=%H%x09%s", `${base}..HEAD`],
      { cwd },
    );
    const commits = logOut
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, ...rest] = line.split("\t");
        return { hash: hash ?? "", subject: rest.join("\t") };
      });
    const { stdout: numOut } = await execFileAsync("git", ["diff", `${base}...HEAD`, "--numstat"], {
      cwd,
    });
    const diffStats = parseDiffStat(numOut);
    const body = buildPRDescription({
      title: commits[0]?.subject ?? "Updates",
      commits,
      diffStats,
      baseBranch: base,
    });
    console.log(body);
    return;
  }

  if (options.verb === "resolve-conflict") {
    if (!options.file) {
      console.log(chalk.red("  --file <path> required for resolve-conflict"));
      return;
    }
    const content = readFileSync(options.file, "utf-8");
    const hunks = parseConflictBlocks(content);
    if (hunks.length === 0) {
      console.log(chalk.green(`  No conflict markers in ${options.file}.`));
      return;
    }
    console.log(chalk.bold(`  ${hunks.length} conflict hunk(s) in ${options.file}`) + "\n");
    hunks.forEach((hunk, idx) => {
      const suggestion = suggestConflictResolution(hunk);
      console.log(chalk.bold(`  Hunk ${idx + 1}: ${suggestion.strategy}`));
      console.log(chalk.dim(`    reason: ${suggestion.reason}`));
      if (suggestion.resolved !== undefined) {
        const preview = suggestion.resolved.slice(0, 200).replace(/\n/g, "\n    ");
        console.log(`    resolved:\n    ${preview}`);
      }
      console.log();
    });
    return;
  }

  console.log(chalk.red(`  Unknown magic-git verb: ${options.verb}`));
}
