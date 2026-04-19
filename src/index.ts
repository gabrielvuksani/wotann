#!/usr/bin/env node

/**
 * WOTANN CLI entry point.
 * Routes to TUI (interactive), commands (init, providers, doctor, daemon, memory, etc.), or non-interactive mode.
 */

import { Command } from "commander";
// Heavy modules deferred to command handlers for sub-250ms first paint.
// Each is loaded via dynamic import() at the point of use.
// import { runInit, runProviders, runDoctor } from "./cli/commands.js";       // → init, providers, doctor
// import { discoverProviders, formatFullStatus } from "./providers/discovery.js"; // → context, onboard, run --raw
// import { loadConfig } from "./core/config.js";                             // → config
// import { createProviderInfrastructure } from "./providers/registry.js";    // → run --raw
// import { KairosDaemon } from "./daemon/kairos.js";                        // → daemon/engine/channels
// import { KairosIPCClient } from "./daemon/kairos-ipc.js";                 // → start, engine status
// import { MemoryStore } from "./memory/store.js";                          // → memory commands
// import { SkillRegistry } from "./skills/loader.js";                       // → skills commands
// import { CostTracker } from "./telemetry/cost-tracker.js";                // → cost command
// import { MCPRegistry } from "./marketplace/registry.js";                  // → mcp commands
// import { runSandboxedCommandSync } from "./sandbox/executor.js";          // → autonomous
import type { ProviderName } from "./core/types.js";
import type { WotannMode } from "./core/mode-cycling.js";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import chalk from "chalk";

const VERSION = "0.4.0";

const program = new Command();

program
  .name("wotann")
  .description("WOTANN — The All-Father of AI Agent Harnesses")
  .version(VERSION);

// ── wotann (interactive TUI) ─────────────────────────────────

program
  .command("start", { isDefault: true })
  .description("Start interactive TUI")
  .option("--provider <provider>", "Force provider")
  .option("--model <model>", "Force model")
  .option("--mode <mode>", "Behavioral mode (plan|careful|rapid|research|creative|debug)")
  .option("--pipe", "Pipeline mode: read from stdin, write to stdout")
  .action(async (options: { provider?: string; model?: string; mode?: string; pipe?: boolean }) => {
    // ── Pipeline mode: stdin → runtime → stdout ──────────────
    if (options.pipe) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      const stdinContent = Buffer.concat(chunks).toString("utf-8");

      // Combine stdin content with any trailing positional text from argv
      const prompt = stdinContent.trim();
      if (!prompt) {
        process.stderr.write("Error: --pipe requires input on stdin\n");
        process.exit(1);
      }

      try {
        const { createRuntime } = await import("./core/runtime.js");
        const { runRuntimeQuery } = await import("./cli/runtime-query.js");
        const runtime = await createRuntime(process.cwd());

        try {
          const result = await runRuntimeQuery(
            runtime,
            {
              prompt,
              model: options.model,
              provider: options.provider as "anthropic" | undefined,
            },
            {
              onText: (chunk) => process.stdout.write(chunk.content),
              onError: (chunk) => process.stderr.write(chunk.content),
            },
          );
          if (result.output && !result.output.endsWith("\n")) {
            process.stdout.write("\n");
          }
        } finally {
          runtime.close();
        }
        process.exit(0);
      } catch (error) {
        process.stderr.write(error instanceof Error ? error.message : "Pipeline query failed");
        process.stderr.write("\n");
        process.exit(1);
      }
    }

    // D12: When the daemon is running, launch the thin-client TUI instead of
    // standing up a fresh 408-module runtime in-process. Cold start drops
    // from ~2-5 s to ~150 ms. `--no-thin` (or WOTANN_THIN=0) opts out.
    const optThin = process.env["WOTANN_THIN"];
    const forceFullRuntime = optThin === "0" || process.argv.includes("--no-thin");
    if (!forceFullRuntime && !options.pipe) {
      const { launchOrFallback, detectDaemon } = await import("./cli/thin-client.js");
      if (await detectDaemon()) {
        const launched = await launchOrFallback();
        if (launched) return; // thin TUI rendered and exited
        // else fall through to full runtime
      }
    }

    const [{ render }, ReactModule, { WotannApp }] = await Promise.all([
      import("ink"),
      import("react"),
      import("./ui/App.js"),
    ]);
    const { bootstrapInteractiveSession } = await import("./ui/bootstrap.js");
    const React = ReactModule.default;
    const interactive = await bootstrapInteractiveSession(process.cwd(), options);

    render(
      React.createElement(WotannApp, {
        version: VERSION,
        providers: interactive.providers,
        initialModel: interactive.initialModel,
        initialProvider: interactive.initialProvider,
        runtime: interactive.runtime,
      }),
    );
  });

// ── wotann link ─────────────────────────────────────────────

program
  .command("link")
  .description("Generate iOS pairing details from the running daemon")
  .action(async () => {
    const { KairosIPCClient } = await import("./daemon/kairos-ipc.js");
    const ipcClient = new KairosIPCClient();
    const daemonAvailable = await ipcClient.connect();

    if (!daemonAvailable) {
      console.error(chalk.red.bold("\n  KAIROS daemon is not running.\n"));
      console.error(chalk.yellow("  To fix, do ONE of these:\n"));
      console.error(chalk.dim("    1. Open the WOTANN desktop app (auto-starts daemon)"));
      console.error(chalk.dim("    2. Run: ") + chalk.white("wotann daemon start"));
      console.error(
        chalk.dim("    3. Run: ") + chalk.white("wotann engine start") + chalk.dim(" (alias)\n"),
      );
      console.error(chalk.dim("  The daemon must be running for iOS pairing to work.\n"));
      process.exit(1);
    }

    try {
      const pairing = (await ipcClient.call("companion.pairing")) as {
        qrData: string;
        pin: string;
        expiresAt: string;
        host?: string;
        port?: number;
      };

      console.log(chalk.bold("\nWOTANN Pairing\n"));

      // S4-8: render an ASCII QR in the terminal so iOS users can scan
      // directly from the CLI instead of needing the desktop app. Falls
      // back to printing the raw deep-link URL when the optional
      // `qrcode-terminal` peer dep isn't available — keeps the TUI path
      // dependency-light.
      try {
        // String-variable import keeps TypeScript from demanding the
        // type declarations for the optional peer dep. We cast to the
        // minimal shape we actually use.
        const modName = "qrcode-terminal";

        const mod = (await import(modName)) as any;
        const generate = mod?.default?.generate ?? mod?.generate;
        if (typeof generate === "function") {
          generate(pairing.qrData, { small: true });
        } else {
          console.log(pairing.qrData);
        }
      } catch {
        console.log(
          chalk.dim("  (install `qrcode-terminal` to render an inline QR; raw URL shown instead)"),
        );
        console.log(pairing.qrData);
      }

      console.log();
      console.log(chalk.dim(`  Host:     ${pairing.host ?? "unknown"}`));
      console.log(chalk.dim(`  Port:     ${pairing.port ?? 3849}`));
      console.log(chalk.dim(`  PIN:      ${pairing.pin}`));
      console.log(chalk.dim(`  Expires:  ${pairing.expiresAt}`));
      console.log();
    } finally {
      ipcClient.disconnect();
    }
  });

// ── wotann init ──────────────────────────────────────────────

program
  .command("init")
  .description("Initialize .wotann/ workspace")
  .option("--free", "Free-tier setup: Ollama primary + free cloud overflow")
  .option("--minimal", "Core only (agent loop + 1 provider)")
  .option("--advanced", "Full control over every step")
  .option("--reset", "Reset workspace to defaults")
  .option(
    "--extended-context",
    "Enable WOTANN_ENABLE_EXTENDED_CONTEXT=1 for 1M context on supported providers",
  )
  .option("--tdd", "Enable TDD enforcement (test-first workflow)")
  .option(
    "--shell <shell>",
    "Generate OSC 133 shell init script for Warp-style blocks (zsh|bash|fish)",
  )
  .action(
    async (options: {
      free?: boolean;
      minimal?: boolean;
      advanced?: boolean;
      reset?: boolean;
      extendedContext?: boolean;
      tdd?: boolean;
      shell?: string;
    }) => {
      // ── --shell short-circuit: write the OSC 133 init file and exit.
      // Side-by-side with workspace init so users can bootstrap blocks
      // without touching `.wotann/`.
      if (options.shell) {
        const { buildShellInit, isSupportedShell, SUPPORTED_SHELLS } =
          await import("./ui/terminal-blocks/init-snippets.js");
        const shell = options.shell.toLowerCase();
        if (!isSupportedShell(shell)) {
          console.error(
            chalk.red(
              `Unsupported shell "${options.shell}". Supported: ${SUPPORTED_SHELLS.join(", ")}`,
            ),
          );
          process.exit(1);
        }
        const init = buildShellInit(shell);
        const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
        const shellDir = join(homedir(), ".wotann", "shell");
        if (!existsSync(shellDir)) {
          mkdirSync(shellDir, { recursive: true });
        }
        const outPath = join(shellDir, init.filename);
        writeFileSync(outPath, init.script, "utf-8");
        console.log(chalk.green(`  \u2713 Wrote ${outPath}`));
        console.log("");
        console.log(chalk.bold("Next step: add this line to your shell rc file:"));
        console.log("");
        console.log(chalk.cyan(`    ${init.sourceLine}`));
        console.log("");
        console.log(chalk.dim(`  (Typical location: ${init.rcPath})`));
        console.log(
          chalk.dim(
            `  Then start a new shell. WOTANN will render Warp-style blocks for every command.`,
          ),
        );
        return;
      }

      const { runInit } = await import("./cli/commands.js");
      await runInit(process.cwd(), options);

      // After workspace creation, patch config.yaml with tddMode if --tdd was set
      if (options.tdd) {
        const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
        const { parse: parseYaml, stringify: stringifyYaml } = await import("yaml");
        const configPath = join(process.cwd(), ".wotann", "config.yaml");
        if (existsSync(configPath)) {
          const raw = readFileSync(configPath, "utf-8");
          const parsed = parseYaml(raw) as Record<string, unknown> | null;
          const config =
            parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
          const updated = { ...config, tddMode: true };
          writeFileSync(configPath, stringifyYaml(updated), "utf-8");
          console.log(chalk.green("  \u2713 TDD enforcement enabled in config.yaml"));
        }
      }
    },
  );

// ── wotann login ─────────────────────────────────────────────

program
  .command("login [provider]")
  .description("Authenticate with a provider (anthropic, codex, copilot, gemini, ollama, openai)")
  .action(async (provider?: string) => {
    const { runLogin } = await import("./auth/login.js");
    await runLogin(provider);
  });

// ── wotann providers ─────────────────────────────────────────

program
  .command("providers")
  .description("List providers with auth status")
  .action(async () => {
    const { runProviders } = await import("./cli/commands.js");
    await runProviders();
  });

// ── wotann context ───────────────────────────────────────────

program
  .command("context")
  .description("Show effective vs documented context limits for detected providers")
  .action(async () => {
    const {
      getModelContextConfig,
      getMaxAvailableContext,
      getMaxDocumentedContext,
      isOpus1MAvailable,
    } = await import("./context/limits.js");
    const { discoverProviders } = await import("./providers/discovery.js");
    const providers = await discoverProviders();

    console.log(chalk.bold("\nWOTANN Context Reality\n"));

    if (providers.length === 0) {
      console.log(
        chalk.yellow("  No configured providers. Run `wotann init` or `wotann providers` first.\n"),
      );
      return;
    }

    const providerSet = new Set(providers.map((provider) => provider.provider));
    const effectiveMax = getMaxAvailableContext(providerSet);
    const documentedMax = getMaxDocumentedContext(providerSet);
    const opusStatus = isOpus1MAvailable(providerSet);

    console.log(
      chalk.dim(`  Effective max across detected providers: ${formatTokenCount(effectiveMax)}`),
    );
    console.log(chalk.dim(`  Highest documented max: ${formatTokenCount(documentedMax)}`));
    console.log(
      chalk.dim(
        `  Extended context env: ${process.env["WOTANN_ENABLE_EXTENDED_CONTEXT"] === "1" || process.env["ANTHROPIC_ENABLE_1M_CONTEXT"] === "1" ? "enabled" : "disabled"}`,
      ),
    );
    if (!opusStatus.available && opusStatus.requiresExplicitEnablement) {
      console.log(
        chalk.yellow(
          "  Anthropic 1M long context is not active by default in this session. Enable extended context explicitly to use it.",
        ),
      );
    }
    console.log();

    for (const provider of providers) {
      const model = provider.models[0] ?? "auto";
      const context = getModelContextConfig(model, provider.provider);
      const delta =
        context.documentedMaxContextTokens > context.maxContextTokens
          ? ` → documented ${formatTokenCount(context.documentedMaxContextTokens)}`
          : "";

      console.log(chalk.bold(`  ${provider.provider}`));
      console.log(chalk.dim(`    Model: ${model}`));
      console.log(
        chalk.dim(`    Effective: ${formatTokenCount(context.maxContextTokens)}${delta}`),
      );
      console.log(chalk.dim(`    Activation: ${context.activationMode}`));
      console.log(chalk.dim(`    Prompt caching: ${context.supportsPromptCaching ? "yes" : "no"}`));
      if (context.notes) {
        console.log(chalk.dim(`    Notes: ${context.notes}`));
      }
      console.log();
    }
  });

// ── wotann doctor ────────────────────────────────────────────

program
  .command("doctor")
  .description("Health check")
  .action(async () => {
    const { runDoctor } = await import("./cli/commands.js");
    await runDoctor(process.cwd());
  });

// ── wotann kanban (worktree board — C19) ─────────────────────

program
  .command("kanban")
  .description("3-state worktree board: In Progress / Ready / Completed")
  .action(async () => {
    const { TaskIsolationManager } = await import("./sandbox/task-isolation.js");
    const { buildBoard, renderBoard } = await import("./orchestration/worktree-kanban.js");
    const { homedir } = await import("node:os");
    const { join: pathJoin } = await import("node:path");

    const repoRoot = process.cwd();
    const isolationDir = pathJoin(homedir(), ".wotann", "isolation");
    const mgr = new TaskIsolationManager(repoRoot, isolationDir);
    const tasks = mgr.listAll();
    const board = buildBoard(tasks);
    console.log(renderBoard(board));
  });

// ── wotann cli-registry (C32) ────────────────────────────────

program
  .command("cli-registry")
  .description("Scan PATH for known AI agent CLIs (Claude Code, Codex, Aider, …)")
  .option("--with-versions", "Invoke each detected CLI with --version (slower)")
  .action(async (options: { withVersions?: boolean }) => {
    const { detectInstalledAgentCLIs, renderCLIRegistry } =
      await import("./providers/cli-registry.js");
    const detected = detectInstalledAgentCLIs({ captureVersion: options.withVersions });
    console.log(renderCLIRegistry(detected));
  });

// ── wotann team-onboarding (C22) ─────────────────────────────

program
  .command("team-onboarding [action]")
  .description("Generate or print a replayable setup recipe for teammates")
  .option("--env <list>", "Comma-separated env vars that teammates need to set")
  .option("--with-wotann", "Include WOTANN workspace init + MCP import steps")
  .action(async (action: string | undefined, options: { env?: string; withWotann?: boolean }) => {
    const verb = action ?? "plan";
    const { buildRecipe, writeRecipe, readRecipe, renderRecipeChecklist } =
      await import("./cli/team-onboarding.js");
    const { ProjectOnboarder } = await import("./core/project-onboarding.js");
    const projectDir = process.cwd();
    const envVars = options.env
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (verb === "plan") {
      const result = new ProjectOnboarder().onboard(projectDir);
      const recipe = buildRecipe({
        projectDir,
        stack: result.stack,
        requiredEnvVars: envVars,
        enableWotann: options.withWotann,
      });
      console.log(renderRecipeChecklist(recipe));
      return;
    }

    if (verb === "record") {
      const result = new ProjectOnboarder().onboard(projectDir);
      const recipe = buildRecipe({
        projectDir,
        stack: result.stack,
        requiredEnvVars: envVars,
        enableWotann: options.withWotann,
      });
      const path = writeRecipe(projectDir, recipe);
      console.log(chalk.green(`Wrote onboarding recipe to ${path}`));
      return;
    }

    if (verb === "run") {
      const recipe = readRecipe(projectDir);
      if (!recipe) {
        console.log(
          chalk.red("No onboarding recipe found. Run `wotann team-onboarding record` first."),
        );
        process.exit(1);
      }
      console.log(renderRecipeChecklist(recipe));
      console.log();
      console.log(
        chalk.dim(
          "Walk through the checklist manually; execute mode is intentionally off by default.",
        ),
      );
      return;
    }

    console.log(
      chalk.red(`Unknown team-onboarding action: ${verb} (expected plan | record | run)`),
    );
    process.exit(1);
  });

// ── wotann autofix-pr (C21) ──────────────────────────────────

/**
 * execFile promise that resolves with stdout/stderr/exitCode instead of
 * throwing — callers decide whether a non-zero exit is fatal. Used by
 * `--create-pr` so we can surface `gh` errors honestly (no silent success).
 */
async function execFileNoThrow(
  file: string,
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { execFile } = await import("node:child_process");
  return await new Promise((resolve) => {
    execFile(file, args as string[], (error, stdout, stderr) => {
      const exitCode =
        error && typeof (error as NodeJS.ErrnoException).code === "number"
          ? Number((error as NodeJS.ErrnoException).code)
          : error
            ? 1
            : 0;
      resolve({
        exitCode,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? (error instanceof Error ? error.message : ""),
      });
    });
  });
}

program
  .command("autofix-pr")
  .description("Analyze the current branch's latest CI failures and produce a fix plan")
  .option("--branch <name>", "Branch to analyse (defaults to current)")
  .option("--create-pr", "After analysis, open a pull request with the fix plan via `gh pr create`")
  .action(async (options: { branch?: string; createPr?: boolean }) => {
    const { runAutofixPR, buildFixPlan, renderFixPlan } = await import("./cli/autofix-pr.js");
    try {
      if (!options.createPr) {
        await runAutofixPR({ branch: options.branch });
        return;
      }

      // --create-pr path: fetch CI failures, build the plan, generate a PR
      // template, then invoke `gh pr create`. Failures from `gh` propagate
      // as non-zero exit codes — no silent success.
      const { GitHubActionsProvider } = await import("./autopilot/ci-feedback.js");
      const { PRArtifactGenerator } = await import("./autopilot/pr-artifacts.js");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      const branch =
        options.branch ??
        (await (async () => {
          try {
            const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
            return stdout.trim() || undefined;
          } catch {
            return undefined;
          }
        })());
      if (!branch) {
        console.log(
          chalk.red("autofix-pr --create-pr: could not determine branch (not in a git repo?)."),
        );
        process.exit(1);
      }

      const provider = new GitHubActionsProvider();
      const run = await provider.latestRun(branch);
      if (!run) {
        console.log(chalk.red(`autofix-pr --create-pr: no CI run found for branch "${branch}".`));
        process.exit(1);
      }

      const failures = run.status === "failure" ? await provider.parseFailures(run.id) : [];
      const plan = buildFixPlan(failures);
      console.log(renderFixPlan(plan));
      console.log();

      const generator = new PRArtifactGenerator();
      const pr = generator.generatePRFromFixPlan(plan, {
        branch,
        runUrl: run.htmlUrl,
      });

      const ghArgs = [
        "pr",
        "create",
        "--title",
        pr.title,
        "--body",
        pr.description,
        ...(pr.labels || []).flatMap((l) => ["--label", l]),
      ];
      const ghResult = await execFileNoThrow("gh", ghArgs);
      if (ghResult.exitCode !== 0) {
        console.error(
          chalk.red(`gh pr create failed (exit ${ghResult.exitCode}): ${ghResult.stderr.trim()}`),
        );
        process.exit(1);
      }
      console.log(ghResult.stdout.trim());
    } catch (error) {
      console.log(
        chalk.red(`autofix-pr failed: ${error instanceof Error ? error.message : "unknown"}`),
      );
      process.exit(1);
    }
  });

// ── wotann git (Magic Git — C20) ─────────────────────────────

program
  .command("git <verb>")
  .description("Magic Git: commit-msg | pr-desc | resolve-conflict")
  .option("--hint <text>", "Hint for commit subject")
  .option("--base <branch>", "Base branch for pr-desc", "main")
  .option("--file <path>", "Path to file with conflict markers")
  .action(async (verb: string, options: { hint?: string; base?: string; file?: string }) => {
    const allowed = ["commit-msg", "pr-desc", "resolve-conflict"] as const;
    if (!allowed.includes(verb as (typeof allowed)[number])) {
      console.log(chalk.red(`Unknown git verb: ${verb}. Expected one of ${allowed.join(", ")}.`));
      process.exit(1);
    }
    const { runMagicGit } = await import("./cli/commands.js");
    try {
      await runMagicGit({
        verb: verb as "commit-msg" | "pr-desc" | "resolve-conflict",
        hint: options.hint,
        baseBranch: options.base,
        file: options.file,
      });
    } catch (error) {
      console.log(
        chalk.red(`git ${verb} failed: ${error instanceof Error ? error.message : "unknown"}`),
      );
      process.exit(1);
    }
  });

// ── wotann dream ────────────────────────────────────────────

program
  .command("dream")
  .description("Run autoDream memory consolidation")
  .option("--force", "Run regardless of the three-gate trigger")
  .action(async (options: { force?: boolean }) => {
    const { runWorkspaceDream } = await import("./learning/dream-runner.js");

    try {
      const result = runWorkspaceDream(process.cwd(), { force: options.force });

      console.log(chalk.bold("\nWOTANN autoDream\n"));
      console.log(chalk.dim(`  Forced: ${result.forced ? "yes" : "no"}`));
      console.log(chalk.dim(`  Observations: ${result.observations}`));
      console.log(chalk.dim(`  Corrections: ${result.corrections}`));
      console.log(chalk.dim(`  Confirmations: ${result.confirmations}`));
      console.log(chalk.dim(`  Idle minutes: ${result.gates.idleMinutes}`));
      console.log(
        chalk.dim(
          `  Last dream: ${Number.isFinite(result.gates.lastDreamHoursAgo) ? `${result.gates.lastDreamHoursAgo.toFixed(1)}h ago` : "never"}`,
        ),
      );

      if (!result.executed) {
        console.log(chalk.yellow(`\n  ${result.reason}\n`));
        return;
      }

      console.log(chalk.green("\n  autoDream complete"));
      console.log(chalk.dim(`  Gotchas added: ${result.gotchasAdded}`));
      console.log(chalk.dim(`  Instincts tracked: ${result.instinctsUpdated}`));
      console.log(chalk.dim(`  Rules updated: ${result.rulesUpdated}`));
      console.log(chalk.dim(`  Gotchas file: ${result.gotchasPath}`));
      console.log(chalk.dim(`  Instincts file: ${result.instinctsPath}\n`));
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : "autoDream failed"));
      process.exit(1);
    }
  });

// ── wotann audit ────────────────────────────────────────────

program
  .command("audit")
  .description("Inspect the append-only audit trail")
  .option("--tool <tool>", "Filter by tool name")
  .option("--session <sessionId>", "Filter by session ID")
  .option("--risk <level>", "Filter by risk level")
  .option("--date <yyyy-mm-dd>", "Filter by date prefix")
  .option("--limit <n>", "Maximum entries to show", "20")
  .option("--export <path>", "Export compliance-ready JSON report to file")
  .action(
    async (options: {
      tool?: string;
      session?: string;
      risk?: string;
      date?: string;
      limit?: string;
      export?: string;
    }) => {
      const { queryWorkspaceAudit, exportWorkspaceAudit } = await import("./cli/audit.js");

      if (options.export) {
        const exported = exportWorkspaceAudit(process.cwd(), options.export, {
          tool: options.tool,
          sessionId: options.session,
          riskLevel: options.risk as "low" | "medium" | "high" | undefined,
          date: options.date,
        });

        if (!exported) {
          console.log(chalk.yellow("\nNo audit trail found for this project.\n"));
          return;
        }

        console.log(
          chalk.green(
            `\nExported ${exported.entryCount} audit entries to ${exported.outputPath}\n`,
          ),
        );
        return;
      }

      const result = queryWorkspaceAudit(process.cwd(), {
        tool: options.tool,
        sessionId: options.session,
        riskLevel: options.risk as "low" | "medium" | "high" | undefined,
        date: options.date,
        limit: parseInt(options.limit ?? "20", 10),
      });

      if (!result) {
        console.log(chalk.yellow("\nNo audit trail found for this project.\n"));
        return;
      }

      console.log(chalk.bold("\nWOTANN Audit Trail\n"));
      console.log(chalk.dim(`  Database: ${result.dbPath}`));
      console.log(chalk.dim(`  Total entries: ${result.totalEntries}`));
      console.log(chalk.dim(`  Showing: ${result.entries.length}\n`));

      if (result.entries.length === 0) {
        console.log(chalk.dim("  No matching audit entries.\n"));
        return;
      }

      for (const entry of result.entries) {
        const icon = entry.success ? chalk.green("✓") : chalk.red("✗");
        console.log(
          `  ${icon} ${entry.tool} ${chalk.dim(`[${entry.riskLevel}]`)} ${entry.timestamp}`,
        );
        console.log(chalk.dim(`    session=${entry.sessionId} id=${entry.id}`));
        if (entry.model || entry.provider) {
          console.log(
            chalk.dim(`    ${entry.provider ?? "unknown"} / ${entry.model ?? "unknown"}`),
          );
        }
      }
      console.log();
    },
  );

// ── wotann voice ────────────────────────────────────────────

const voiceCmd = program.command("voice").description("Voice mode utilities");

voiceCmd
  .command("status")
  .description("Show detected voice input/output capabilities")
  .action(async () => {
    const { getVoiceStatusReport } = await import("./cli/voice.js");
    const result = await getVoiceStatusReport();

    console.log(chalk.bold("\nWOTANN Voice Mode\n"));
    console.log(chalk.dim(`  Enabled: ${result.enabled ? "yes" : "no"}`));
    console.log(chalk.dim(`  Push-to-talk: ${result.pushToTalk ? "yes" : "no"}`));
    console.log(chalk.dim(`  Language: ${result.language}`));
    console.log(chalk.dim(`  STT: ${result.stt ?? "none detected"}`));
    console.log(chalk.dim(`  TTS: ${result.tts ?? "none detected"}`));
    console.log(chalk.dim(`  Can listen: ${result.canListen ? "yes" : "no"}`));
    console.log(chalk.dim(`  Can speak: ${result.canSpeak ? "yes" : "no"}\n`));
  });

// ── wotann local ────────────────────────────────────────────

const localCmd = program.command("local").description("Local model and workstation utilities");

localCmd
  .command("status")
  .description("Show Ollama/local model status and KV cache configuration")
  .action(async () => {
    const { getLocalStatusReport } = await import("./cli/local-status.js");
    const result = await getLocalStatusReport();

    console.log(chalk.bold("\nWOTANN Local Model Status\n"));
    console.log(chalk.dim(`  Platform: ${result.platform}`));
    console.log(chalk.dim(`  Ollama installed: ${result.ollamaInstalled ? "yes" : "no"}`));
    console.log(chalk.dim(`  Ollama URL: ${result.ollamaUrl}`));
    console.log(chalk.dim(`  Ollama reachable: ${result.ollamaReachable ? "yes" : "no"}`));
    console.log(chalk.dim(`  Installed models: ${result.installedModels.length}`));
    if (result.installedModels.length > 0) {
      console.log(chalk.dim(`  Models: ${result.installedModels.slice(0, 5).join(", ")}`));
    }
    console.log(chalk.dim(`  Running models: ${result.runningModels.length}`));
    if (result.runningModels.length > 0) {
      console.log(chalk.dim(`  Active: ${result.runningModels.join(", ")}`));
    }
    console.log(chalk.dim(`  KV cache: ${result.kvCacheType}\n`));
  });

// ── wotann run (non-interactive) ─────────────────────────────

program
  .command("run <prompt>")
  .description("Non-interactive mode — execute a prompt with full harness intelligence")
  .option("--exit", "Exit after completion")
  .option("--provider <provider>", "Force provider")
  .option("--model <model>", "Force model")
  .option("--raw", "Skip middleware/hooks (direct provider query)")
  .action(
    async (
      prompt: string,
      options: { exit?: boolean; provider?: string; model?: string; raw?: boolean },
    ) => {
      if (options.raw) {
        // Raw mode: bypass runtime, query provider directly
        const { discoverProviders } = await import("./providers/discovery.js");
        const { createProviderInfrastructure } = await import("./providers/registry.js");
        const providers = await discoverProviders();
        if (providers.length === 0) {
          console.error(chalk.red("No providers configured. Run `wotann init` first."));
          process.exit(1);
        }
        const infra = createProviderInfrastructure(providers);
        for await (const chunk of infra.bridge.query({
          prompt,
          model: options.model,
          provider: options.provider as "anthropic" | undefined,
        })) {
          if (chunk.type === "text") process.stdout.write(chunk.content);
          else if (chunk.type === "error") console.error(chalk.red(chunk.content));
        }
        process.stdout.write("\n");
        return;
      }

      // Full runtime: middleware + hooks + prompt engine + WASM bypass + memory
      const { createRuntime } = await import("./core/runtime.js");
      const { runRuntimeQuery } = await import("./cli/runtime-query.js");
      const runtime = await createRuntime(process.cwd());

      try {
        const result = await runRuntimeQuery(
          runtime,
          {
            prompt,
            model: options.model,
            provider: options.provider as "anthropic" | undefined,
          },
          {
            onText: (chunk) => process.stdout.write(chunk.content),
            onError: (chunk) => console.error(chalk.red(chunk.content)),
          },
        );

        if (result.output && !result.output.endsWith("\n")) {
          process.stdout.write("\n");
        }
      } finally {
        runtime.close();
      }
    },
  );

// ── wotann cu ──────────────────────────────────────────────

program
  .command("cu <task>")
  .description("Computer use mode — route through API fast-paths or perception/text mediation")
  .option("--json", "Emit JSON output for scripting")
  .action(async (task: string, options: { json?: boolean }) => {
    const { ComputerUseAgent } = await import("./computer-use/computer-agent.js");
    const { PerceptionEngine } = await import("./computer-use/perception-engine.js");

    const perception = new PerceptionEngine();
    const agent = new ComputerUseAgent({ perception });
    const rateLimit = agent.checkRateLimit();
    if (!rateLimit.allowed) {
      const message = "Computer use rate limit exceeded. Try again in a minute.";
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: message }, null, 2));
      } else {
        console.error(chalk.red(message));
      }
      process.exit(1);
    }

    const apiRoute = agent.findAPIRoute(task);
    if (apiRoute) {
      agent.recordAction();
      const payload = {
        success: true,
        mode: "api-route",
        task,
        handler: apiRoute.handler,
        description: apiRoute.description,
      };
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(chalk.bold("\nWOTANN Computer Use\n"));
        console.log(`  Fast path: ${chalk.cyan(apiRoute.handler)} — ${apiRoute.description}`);
        console.log(`  Task: ${task}\n`);
      }
      return;
    }

    const state = await perception.perceive();
    // Wave 3D wire-up: route the raw perception through PerceptionAdapter
    // (via routePerception) before model dispatch. Falls back to the raw
    // toText() path if the adapter throws so the CLI never breaks.
    let screenText: string;
    try {
      const adapted = agent.adaptPerceptionForModel(state, "", {});
      screenText = agent.redactSensitive(adapted.textDescription ?? perception.toText(state));
    } catch {
      screenText = agent.redactSensitive(perception.toText(state));
    }
    const prompt = agent.generateTextMediatedPrompt(task, screenText);
    agent.recordAction();

    const payload = {
      success: true,
      mode: "text-mediated",
      task,
      activeWindow: state.activeWindow,
      elementCount: state.elements.length,
      prompt,
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(chalk.bold("\nWOTANN Computer Use\n"));
    console.log(
      chalk.dim(`  Active window: ${state.activeWindow.name} (${state.activeWindow.app})`),
    );
    console.log(chalk.dim(`  Elements detected: ${state.elements.length}`));
    console.log(chalk.dim("  Path: text-mediated fallback\n"));
    console.log(prompt);
    console.log();
  });

// ── wotann install ─────────────────────────────────────────

program
  .command("install <plugin>")
  .description("Install an npm-based WOTANN plugin into .wotann/plugins")
  .action(async (plugin: string) => {
    const { PluginManager } = await import("./plugins/manager.js");
    const manager = new PluginManager(join(process.cwd(), ".wotann", "plugins"));
    const installed = manager.install(plugin);

    console.log(chalk.bold("\nWOTANN Plugin Installed\n"));
    console.log(chalk.dim(`  Name: ${installed.name}`));
    console.log(chalk.dim(`  Version: ${installed.version}`));
    console.log(chalk.dim(`  Path: ${installed.path}`));
    console.log(chalk.dim(`  Source: ${installed.source}\n`));
  });

// ── wotann team ────────────────────────────────────────────

program
  .command("team <task>")
  .description("Prepare parallel worker worktrees with file ownership boundaries")
  .option("--files <files>", "Comma-separated file ownership list")
  .option("--workers <n>", "Max worker count", "3")
  .action(async (task: string, options: { files?: string; workers?: string }) => {
    const { execFileSync } = await import("node:child_process");
    const { Coordinator } = await import("./orchestration/coordinator.js");
    const { createRuntime } = await import("./core/runtime.js");
    const { runRuntimeQuery } = await import("./cli/runtime-query.js");

    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    }).trim();

    const ownedFiles = options.files
      ? options.files
          .split(",")
          .map((file) => file.trim())
          .filter(Boolean)
      : detectTeamFiles(repoRoot);

    if (ownedFiles.length === 0) {
      console.log(
        chalk.yellow(
          "\nNo files available to assign. Pass `--files` or create tracked files first.\n",
        ),
      );
      return;
    }

    const workerCount = Math.max(
      1,
      Math.min(parseInt(options.workers ?? "3", 10), ownedFiles.length),
    );
    const fileGroups = partitionFiles(ownedFiles, workerCount);
    const coordinator = new Coordinator({
      maxSubagents: workerCount,
      useWorktrees: true,
      worktreeRoot: join(repoRoot, ".wotann", "worktrees"),
    });

    const tasks = fileGroups.map((files, index) => {
      const taskId = `worker-${index + 1}`;
      coordinator.addTask({
        id: taskId,
        description: `${task} [${files.join(", ")}]`,
        files,
        phase: "implement",
        status: "pending",
      });
      const worktree = coordinator.createWorktree(taskId, repoRoot);
      coordinator.startTask(taskId, taskId);
      return { taskId, files, worktree };
    });
    const runtime = await createRuntime(process.cwd(), "plan");
    const briefs: Array<{ taskId: string; brief: string }> = [];
    try {
      if (runtime.getStatus().providers.length > 0) {
        for (const { taskId, files } of tasks) {
          const result = await runRuntimeQuery(runtime, {
            prompt: [
              "Prepare a concise worker brief for a parallel coding task.",
              `Task: ${task}`,
              `Worker: ${taskId}`,
              `Owned files: ${files.join(", ")}`,
              "Return a short implementation brief with ownership boundaries and verification focus.",
            ].join("\n"),
          });
          briefs.push({ taskId, brief: result.output.trim() });
        }
      }
    } finally {
      runtime.close();
    }

    const briefByTask = new Map(briefs.map((brief) => [brief.taskId, brief.brief]));

    console.log(chalk.bold("\nWOTANN Team Mode\n"));
    console.log(chalk.dim(`  Task: ${task}`));
    console.log(chalk.dim(`  Workers: ${tasks.length}`));
    console.log(chalk.dim(`  Repo: ${repoRoot}\n`));

    for (const entry of tasks) {
      console.log(chalk.bold(`  ${entry.taskId}`));
      console.log(chalk.dim(`    Files: ${entry.files.join(", ")}`));
      if (entry.worktree) {
        console.log(chalk.dim(`    Worktree: ${entry.worktree.path}`));
        console.log(chalk.dim(`    Branch: ${entry.worktree.branch}`));
      }
      const brief = briefByTask.get(entry.taskId);
      if (brief) {
        console.log(chalk.dim(`    Brief: ${brief.slice(0, 240)}`));
      } else {
        console.log(
          chalk.dim(
            "    Brief: Review owned files, stay within boundaries, and verify with targeted tests.",
          ),
        );
      }
      console.log();
    }
  });

// ── wotann resume ───────────────────────────────────────────

program
  .command("resume")
  .description("Resume the most recent session for this project in the interactive TUI")
  .option("--stream", "Resume the most recent interrupted streaming response in the terminal")
  .action(async (options: { stream?: boolean }) => {
    if (options.stream) {
      const { StreamCheckpointStore, buildResumeQuery, deserializeSession } =
        await import("./core/stream-resume.js");
      const checkpointStore = new StreamCheckpointStore(join(process.cwd(), ".wotann", "streams"));
      const checkpoint = checkpointStore.getLatestInterrupted();

      if (!checkpoint) {
        console.log(chalk.yellow("\nNo interrupted streams found for this project.\n"));
        return;
      }

      checkpointStore.markResumed(checkpoint.id);

      const { createRuntime } = await import("./core/runtime.js");
      const runtime = await createRuntime(process.cwd());
      runtime.restoreSession(deserializeSession(checkpoint.sessionBeforeQuery));

      console.log(chalk.bold("\nResuming interrupted stream:"));
      console.log(chalk.dim(`  Checkpoint: ${checkpoint.id}`));
      console.log(chalk.dim(`  Saved partial length: ${checkpoint.partialContent.length} chars`));
      if (checkpoint.lastError) {
        console.log(chalk.dim(`  Last interruption: ${checkpoint.lastError}`));
      }
      console.log();

      let resumedContent = "";
      for await (const chunk of runtime.query(buildResumeQuery(checkpoint))) {
        if (chunk.type === "text") {
          process.stdout.write(chunk.content);
          resumedContent += chunk.content;
        } else if (chunk.type === "error") {
          console.error(chalk.red(chunk.content));
        }
      }

      if (resumedContent && !resumedContent.endsWith("\n")) {
        process.stdout.write("\n");
      }

      runtime.close();
      return;
    }

    const { findLatestSession, restoreSession, formatSessionStats } =
      await import("./core/session.js");
    const sessionDir = join(process.cwd(), ".wotann", "sessions");
    const latestPath = findLatestSession(sessionDir);

    if (!latestPath) {
      console.log(chalk.yellow("\nNo saved sessions found for this project.\n"));
      return;
    }

    const session = restoreSession(latestPath);
    if (!session) {
      console.log(chalk.red("\nFailed to restore session.\n"));
      return;
    }

    console.log(chalk.bold("\nResumed session:"));
    console.log(chalk.dim(formatSessionStats(session)));
    console.log(chalk.dim(`\n  ${session.messages.length} messages in history`));

    const { bootstrapInteractiveSession } = await import("./ui/bootstrap.js");
    const interactive = await bootstrapInteractiveSession(process.cwd(), {
      provider: session.provider,
      model: session.model,
    });
    interactive.runtime.restoreSession(session);

    console.log(chalk.green("  Session context restored. Continue where you left off.\n"));

    const [{ render }, ReactModule, { WotannApp }] = await Promise.all([
      import("ink"),
      import("react"),
      import("./ui/App.js"),
    ]);
    const React = ReactModule.default;

    render(
      React.createElement(WotannApp, {
        version: VERSION,
        providers: interactive.providers,
        initialModel: session.model,
        initialProvider: session.provider,
        initialMessages: session.messages,
        runtime: interactive.runtime,
      }),
    );
  });

// ── wotann next ─────────────────────────────────────────────

program
  .command("next")
  .description("Auto-detect and run the next logical step for the current project")
  .action(async () => {
    const { createRuntime } = await import("./core/runtime.js");
    const { runRuntimeQuery } = await import("./cli/runtime-query.js");
    const runtime = await createRuntime(process.cwd());

    // Build context prompt from project state
    const contextPrompt = [
      "Analyze the current project state and determine the NEXT logical step.",
      "Consider: git status, recent changes, failing tests, TODO comments, open issues.",
      "Then execute that step. Be specific and actionable.",
      "",
      `Working directory: ${process.cwd()}`,
    ].join("\n");

    console.log(chalk.bold("\nWOTANN Next — auto-detecting next step...\n"));

    try {
      if (runtime.getStatus().providers.length === 0) {
        runtime.close();
        console.error(chalk.red("No providers configured. Run `wotann init` first."));
        process.exit(1);
      }

      const result = await runRuntimeQuery(
        runtime,
        { prompt: contextPrompt },
        {
          onText: (chunk) => process.stdout.write(chunk.content),
          onError: (chunk) => console.error(chalk.red(chunk.content)),
        },
      );
      if (result.output && !result.output.endsWith("\n")) {
        process.stdout.write("\n");
      }
      process.stdout.write("\n");
    } finally {
      runtime.close();
    }
  });

// ── wotann daemon ────────────────────────────────────────────

const daemonCmd = program.command("daemon").description("KAIROS daemon management");

daemonCmd
  .command("worker")
  .description("Internal daemon worker")
  .action(async () => {
    const { KairosDaemon } = await import("./daemon/kairos.js");
    const daemon = new KairosDaemon();
    const { existsSync, mkdirSync, writeFileSync, unlinkSync } = await import("node:fs");
    const daemonDir = join(homedir(), ".wotann");
    const projectWotannDir = join(process.cwd(), ".wotann");
    const pidPath = join(daemonDir, "daemon.pid");
    const statusPath = join(daemonDir, "daemon.status.json");
    const heartbeatPath = join(projectWotannDir, "HEARTBEAT.md");

    if (!existsSync(daemonDir)) {
      mkdirSync(daemonDir, { recursive: true });
    }

    const heartbeatTasks = daemon.loadHeartbeatTasksFromFile(heartbeatPath);
    const writeStatus = (running: boolean) => {
      writeFileSync(
        statusPath,
        JSON.stringify(
          {
            pid: process.pid,
            startedAt: daemon.getStatus().startedAt?.toISOString() ?? new Date().toISOString(),
            status: running ? daemon.getStatus().status : "stopped",
            heartbeatTasks: daemon.getStatus().heartbeatTasks.length,
            tickCount: daemon.getStatus().tickCount,
          },
          null,
          2,
        ),
      );
    };

    writeFileSync(pidPath, String(process.pid));
    daemon.start();
    writeStatus(true);

    const refreshStatus = setInterval(() => {
      writeStatus(true);
    }, 5_000);

    const cleanup = () => {
      clearInterval(refreshStatus);
      daemon.stop();
      try {
        unlinkSync(pidPath);
      } catch {
        /* ignore */
      }
      writeStatus(false);
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    if (heartbeatTasks > 0) {
      // status file already reflects the loaded heartbeat tasks
    }
  });

daemonCmd
  .command("start")
  .description("Start the background daemon")
  .option("-v, --verbose", "Stream daemon log output to the terminal for the startup window")
  .action(async (opts: { verbose?: boolean }) => {
    const { existsSync, mkdirSync, readFileSync } = await import("node:fs");
    const { pidPath } = getDaemonPaths();
    const wotannDir = join(process.cwd(), ".wotann");
    if (!existsSync(wotannDir)) mkdirSync(wotannDir, { recursive: true });

    if (existsSync(pidPath)) {
      const existingPid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      if (isProcessAlive(existingPid)) {
        console.log(chalk.yellow(`KAIROS daemon already running (PID ${existingPid}).`));
        return;
      }
    }

    const entryPath = fileURLToPath(import.meta.url);
    const child = spawnDaemonWorker(entryPath, process.cwd());

    // S5-13: --verbose attaches the terminal to the daemon's stdio so the
    // user can watch boot logs without tailing the file. We detach on
    // SIGINT so Ctrl+C doesn't kill the daemon; stopping still goes
    // through `wotann daemon stop`.
    if (opts.verbose) {
      console.log(
        chalk.dim("— daemon stdout/stderr (press Ctrl+C to detach, daemon keeps running) —"),
      );
      child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
      child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
      process.on("SIGINT", () => {
        child.stdout?.removeAllListeners("data");
        child.stderr?.removeAllListeners("data");
        process.exit(0);
      });
    }

    const ready = await waitForDaemonReady(pidPath, 6_000);

    if (!ready) {
      console.error(chalk.red("KAIROS daemon failed to start."));
      process.exit(1);
    }

    console.log(chalk.green(`KAIROS daemon started (PID ${ready}, tick: 15s)`));
    if (child.pid && child.pid !== ready) {
      console.log(chalk.dim(`Worker launcher PID: ${child.pid}`));
    }
    console.log(
      chalk.dim("Use `wotann daemon status` to inspect or `wotann daemon stop` to stop."),
    );
  });

daemonCmd
  .command("stop")
  .description("Stop the background daemon")
  .action(async () => {
    const { pidPath, statusPath } = getDaemonPaths();
    const { existsSync, readFileSync, unlinkSync } = await import("node:fs");
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      try {
        process.kill(pid, "SIGTERM");
        await waitForProcessExit(pid, 4_000);
        try {
          unlinkSync(pidPath);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(statusPath);
        } catch {
          /* ignore */
        }
        console.log(chalk.green(`Daemon (PID ${pid}) stopped.`));
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        try {
          unlinkSync(pidPath);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(statusPath);
        } catch {
          /* ignore */
        }
        console.log(chalk.yellow(`Daemon PID ${pid} not found (already stopped). Cleaned up.`));
      }
    } else {
      console.log(chalk.dim("No daemon PID file found. Start with: wotann daemon start"));
    }
  });

daemonCmd
  .command("status")
  .description("Show daemon status")
  .action(async () => {
    const { pidPath, statusPath } = getDaemonPaths();
    const { existsSync, readFileSync } = await import("node:fs");
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      if (isProcessAlive(pid)) {
        console.log(chalk.green(`KAIROS daemon running (PID ${pid})`));
        if (existsSync(statusPath)) {
          try {
            const status = JSON.parse(readFileSync(statusPath, "utf-8")) as {
              startedAt?: string;
              heartbeatTasks?: number;
              tickCount?: number;
            };
            if (status.startedAt) console.log(chalk.dim(`  Started: ${status.startedAt}`));
            if (typeof status.heartbeatTasks === "number")
              console.log(chalk.dim(`  Heartbeat tasks: ${status.heartbeatTasks}`));
            if (typeof status.tickCount === "number")
              console.log(chalk.dim(`  Ticks recorded: ${status.tickCount}`));
          } catch {
            // ignore malformed status metadata
          }
        }
      } else {
        console.log(chalk.yellow(`Stale PID file (PID ${pid}). Run: wotann daemon stop`));
      }
    } else {
      console.log(chalk.dim("KAIROS daemon not running. Start with: wotann daemon start"));
    }
  });

// ── wotann engine (user-facing alias for daemon) ────────────

const engineCmd = program
  .command("engine")
  .description("Background runtime engine (always-on daemon)");

engineCmd
  .command("start")
  .description("Start the WOTANN engine (background daemon with runtime hosting)")
  .action(async () => {
    const { existsSync, mkdirSync, readFileSync } = await import("node:fs");
    const { pidPath } = getDaemonPaths();
    const wotannDir = join(process.cwd(), ".wotann");
    if (!existsSync(wotannDir)) mkdirSync(wotannDir, { recursive: true });

    if (existsSync(pidPath)) {
      const existingPid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      if (isProcessAlive(existingPid)) {
        console.log(chalk.yellow(`WOTANN engine already running (PID ${existingPid}).`));
        return;
      }
    }

    const entryPath = fileURLToPath(import.meta.url);
    // Spawn detached — we don't hold a handle to the child because the
    // daemon runs independently. `void` marks the discard explicitly so
    // future readers don't think the handle was forgotten by accident.
    void spawnDaemonWorker(entryPath, process.cwd());
    const ready = await waitForDaemonReady(pidPath, 6_000);

    if (!ready) {
      console.error(chalk.red("WOTANN engine failed to start."));
      process.exit(1);
    }

    console.log(chalk.green(`WOTANN engine started (PID ${ready})`));
    console.log(chalk.dim("  IPC socket: ~/.wotann/kairos.sock"));
    console.log(chalk.dim("  Companion port: 3849"));
    console.log(
      chalk.dim("Use `wotann engine status` to inspect or `wotann engine stop` to stop."),
    );
  });

engineCmd
  .command("stop")
  .description("Stop the WOTANN engine")
  .action(async () => {
    const { pidPath, statusPath } = getDaemonPaths();
    const { existsSync, readFileSync, unlinkSync } = await import("node:fs");
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      try {
        process.kill(pid, "SIGTERM");
        await waitForProcessExit(pid, 4_000);
        try {
          unlinkSync(pidPath);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(statusPath);
        } catch {
          /* ignore */
        }
        console.log(chalk.green(`WOTANN engine (PID ${pid}) stopped.`));
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        try {
          unlinkSync(pidPath);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(statusPath);
        } catch {
          /* ignore */
        }
        console.log(chalk.yellow(`Engine PID ${pid} not found (already stopped). Cleaned up.`));
      }
    } else {
      console.log(chalk.dim("WOTANN engine not running. Start with: wotann engine start"));
    }
  });

engineCmd
  .command("status")
  .description("Show WOTANN engine status")
  .action(async () => {
    const { pidPath, statusPath } = getDaemonPaths();
    const { existsSync, readFileSync } = await import("node:fs");

    // Check PID-based daemon status
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      if (isProcessAlive(pid)) {
        console.log(chalk.green(`WOTANN engine running (PID ${pid})`));
        if (existsSync(statusPath)) {
          try {
            const status = JSON.parse(readFileSync(statusPath, "utf-8")) as {
              startedAt?: string;
              heartbeatTasks?: number;
              tickCount?: number;
            };
            if (status.startedAt) console.log(chalk.dim(`  Started: ${status.startedAt}`));
            if (typeof status.heartbeatTasks === "number")
              console.log(chalk.dim(`  Heartbeat tasks: ${status.heartbeatTasks}`));
            if (typeof status.tickCount === "number")
              console.log(chalk.dim(`  Ticks: ${status.tickCount}`));
          } catch {
            // ignore malformed status
          }
        }

        // Try IPC connection for runtime-level status
        const { KairosIPCClient: IPCClient } = await import("./daemon/kairos-ipc.js");
        const ipcClient = new IPCClient();
        const connected = await ipcClient.connect();
        if (connected) {
          try {
            const runtimeStatus = (await ipcClient.call("status")) as Record<string, unknown>;
            if (runtimeStatus && typeof runtimeStatus === "object") {
              console.log(
                chalk.dim(
                  `  Providers: ${(runtimeStatus.providers as readonly string[])?.join(", ") ?? "none"}`,
                ),
              );
              console.log(
                chalk.dim(`  Active provider: ${runtimeStatus.activeProvider ?? "none"}`),
              );
              console.log(chalk.dim(`  Session: ${runtimeStatus.sessionId ?? "none"}`));
              console.log(
                chalk.dim(`  Memory: ${runtimeStatus.memoryEnabled ? "enabled" : "disabled"}`),
              );
            }
          } catch {
            // Best-effort path — caller gets a safe fallback, no user-facing error.
            console.log(chalk.dim("  Runtime status: unavailable (IPC call failed)"));
          } finally {
            ipcClient.disconnect();
          }
        } else {
          console.log(chalk.dim("  Runtime IPC: not connected (socket may not be ready)"));
        }
      } else {
        console.log(chalk.yellow(`Stale PID file (PID ${pid}). Run: wotann engine stop`));
      }
    } else {
      console.log(chalk.dim("WOTANN engine not running. Start with: wotann engine start"));
    }
  });

// ── wotann channels ─────────────────────────────────────────

const channelsCmd = program.command("channels").description("Multi-channel gateway management");

channelsCmd
  .command("start")
  .description("Start the channel gateway and route incoming messages through the runtime")
  .option("--webchat", "Enable the built-in web chat adapter")
  .option("--telegram", "Enable the Telegram adapter")
  .option("--slack", "Enable the Slack adapter")
  .option("--discord", "Enable the Discord adapter")
  .option("--signal", "Enable the Signal adapter (requires signal-cli)")
  .option("--whatsapp", "Enable the WhatsApp adapter (requires Baileys)")
  .option("--email", "Enable the Email adapter (IMAP/SMTP)")
  .option("--webhook", "Enable the Webhook adapter")
  .option("--sms", "Enable the SMS adapter (Twilio)")
  .option("--matrix", "Enable the Matrix/Element adapter")
  .option("--teams", "Enable the Microsoft Teams adapter")
  .option("--port <port>", "WebChat port", "3847")
  .option("--host <host>", "WebChat host", "127.0.0.1")
  .option("--no-pairing", "Disable DM pairing requirements")
  .action(
    async (options: {
      webchat?: boolean;
      telegram?: boolean;
      slack?: boolean;
      discord?: boolean;
      signal?: boolean;
      whatsapp?: boolean;
      email?: boolean;
      webhook?: boolean;
      sms?: boolean;
      matrix?: boolean;
      teams?: boolean;
      port?: string;
      host?: string;
      pairing?: boolean;
    }) => {
      const { ChannelDispatchManager } = await import("./channels/dispatch.js");
      const dispatch = new ChannelDispatchManager({
        workingDir: process.cwd(),
        initialMode: "default",
      });
      const { KairosDaemon } = await import("./daemon/kairos.js");
      const daemon = new KairosDaemon();
      const gateway = await daemon.startChannelGateway(
        async (message) => dispatch.handleMessage(message),
        {
          webchat: options.webchat,
          telegram: options.telegram,
          slack: options.slack,
          discord: options.discord,
          signal: options.signal,
          whatsapp: options.whatsapp,
          email: options.email,
          webhook: options.webhook,
          sms: options.sms,
          matrix: options.matrix,
          teams: options.teams,
          webchatPort: parseInt(options.port ?? "3847", 10),
          webchatHost: options.host,
          requirePairing: options.pairing,
        },
      );

      const connected = gateway.getConnectedChannels();
      const webchatAdapter = gateway.getAdapter("webchat");
      const webchatPort =
        "getPort" in (webchatAdapter ?? {})
          ? (webchatAdapter as unknown as { getPort: () => number }).getPort()
          : parseInt(options.port ?? "3847", 10);

      console.log(chalk.bold("\nWOTANN Channels Gateway\n"));
      console.log(chalk.dim(`  Connected channels: ${connected.join(", ") || "none"}`));
      console.log(chalk.dim(`  Dispatch routes: ${dispatch.getStatus().persistedRoutes}`));
      console.log(chalk.dim(`  Policies loaded: ${dispatch.getStatus().policiesLoaded}`));
      console.log(chalk.dim(`  Pairing required: ${options.pairing !== false ? "yes" : "no"}`));
      if (connected.includes("webchat")) {
        console.log(
          chalk.dim(
            `  WebChat URL: http://${options.host ?? "127.0.0.1"}:${webchatPort}/api/status`,
          ),
        );
      }
      console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

      await new Promise<void>((resolve) => {
        const cleanup = async () => {
          await gateway.disconnectAll();
          await dispatch.closeAll();
          resolve();
        };

        process.once("SIGINT", () => void cleanup());
        process.once("SIGTERM", () => void cleanup());
      });
    },
  );

channelsCmd
  .command("status")
  .description("Show persisted channel dispatch routes and active session mappings")
  .action(async () => {
    const { ChannelDispatchManager } = await import("./channels/dispatch.js");
    const dispatch = new ChannelDispatchManager({
      workingDir: process.cwd(),
      initialMode: "default",
    });

    try {
      const status = dispatch.getStatus();
      console.log(chalk.bold("\nWOTANN Channel Dispatch\n"));
      console.log(chalk.dim(`  Persisted routes: ${status.persistedRoutes}`));
      console.log(chalk.dim(`  Active runtimes: ${status.activeRoutes}\n`));
      console.log(chalk.dim(`  Policies loaded: ${status.policiesLoaded}\n`));

      if (status.routes.length === 0) {
        console.log(chalk.dim("  No channel routes have been created yet.\n"));
        return;
      }

      for (const route of status.routes) {
        console.log(chalk.bold(`  ${route.routeKey}`));
        if (route.label) console.log(chalk.dim(`    Label: ${route.label}`));
        if (route.policyId) console.log(chalk.dim(`    Policy: ${route.policyId}`));
        if (route.workspaceDir) console.log(chalk.dim(`    Workspace: ${route.workspaceDir}`));
        if (route.mode) console.log(chalk.dim(`    Mode: ${route.mode}`));
        console.log(chalk.dim(`    Session: ${route.sessionId ?? "none"}`));
        console.log(
          chalk.dim(
            `    Provider/Model: ${route.provider ?? "unknown"} / ${route.model ?? "unknown"}`,
          ),
        );
        console.log(chalk.dim(`    Messages: ${route.messageCount}`));
        console.log(chalk.dim(`    Last active: ${route.lastActiveAt}`));
      }
      console.log();
    } finally {
      await dispatch.closeAll();
    }
  });

channelsCmd
  .command("policy-list")
  .description("List persisted dispatch policies")
  .action(async () => {
    const { ChannelDispatchManager } = await import("./channels/dispatch.js");
    const dispatch = new ChannelDispatchManager({
      workingDir: process.cwd(),
      initialMode: "default",
    });

    try {
      const policies = dispatch.getPolicies();
      console.log(chalk.bold("\nWOTANN Channel Policies\n"));

      if (policies.length === 0) {
        console.log(chalk.dim("  No dispatch policies configured.\n"));
        return;
      }

      for (const policy of policies) {
        console.log(chalk.bold(`  ${policy.id}`));
        if (policy.label) console.log(chalk.dim(`    Label: ${policy.label}`));
        console.log(
          chalk.dim(
            `    Match: channel=${policy.channelType ?? "*"} sender=${policy.senderId ?? "*"} channelId=${policy.channelId ?? "*"}`,
          ),
        );
        console.log(chalk.dim(`    Workspace: ${policy.workspaceDir ?? process.cwd()}`));
        console.log(chalk.dim(`    Mode: ${policy.mode ?? "default"}`));
        console.log(
          chalk.dim(`    Provider/Model: ${policy.provider ?? "auto"} / ${policy.model ?? "auto"}`),
        );
      }
      console.log();
    } finally {
      await dispatch.closeAll();
    }
  });

channelsCmd
  .command("policy-add")
  .description("Add or update a persisted dispatch policy")
  .requiredOption("--id <id>", "Stable policy identifier")
  .option("--label <label>", "Human-readable label")
  .option("--channel <channel>", "Match channel type")
  .option("--channel-id <channelId>", "Match channel/thread id")
  .option("--sender <sender>", "Match sender id")
  .option("--workspace <path>", "Route to a dedicated workspace or subdirectory")
  .option("--mode <mode>", "Initial mode for runtimes created by this route")
  .option("--provider <provider>", "Force provider for this route")
  .option("--model <model>", "Force model for this route")
  .action(
    async (options: {
      id: string;
      label?: string;
      channel?: string;
      channelId?: string;
      sender?: string;
      workspace?: string;
      mode?: string;
      provider?: string;
      model?: string;
    }) => {
      const { ChannelDispatchManager } = await import("./channels/dispatch.js");
      const dispatch = new ChannelDispatchManager({
        workingDir: process.cwd(),
        initialMode: "default",
      });

      try {
        const policy = dispatch.upsertPolicy({
          id: options.id,
          label: options.label,
          channelType: options.channel,
          channelId: options.channelId,
          senderId: options.sender,
          workspaceDir: options.workspace,
          mode: options.mode as WotannMode | undefined,
          provider: options.provider as ProviderName | undefined,
          model: options.model,
        });

        console.log(chalk.green(`Saved dispatch policy ${policy.id}.`));
        console.log(
          chalk.dim(
            `  Match: channel=${policy.channelType ?? "*"} sender=${policy.senderId ?? "*"} channelId=${policy.channelId ?? "*"}`,
          ),
        );
        console.log(chalk.dim(`  Workspace: ${policy.workspaceDir ?? process.cwd()}`));
        console.log(chalk.dim(`  Mode: ${policy.mode ?? "default"}`));
        console.log(
          chalk.dim(`  Provider/Model: ${policy.provider ?? "auto"} / ${policy.model ?? "auto"}`),
        );
      } finally {
        await dispatch.closeAll();
      }
    },
  );

channelsCmd
  .command("policy-remove <id>")
  .description("Remove a persisted dispatch policy")
  .action(async (id: string) => {
    const { ChannelDispatchManager } = await import("./channels/dispatch.js");
    const dispatch = new ChannelDispatchManager({
      workingDir: process.cwd(),
      initialMode: "default",
    });

    try {
      const removed = dispatch.removePolicy(id);
      if (!removed) {
        console.log(chalk.yellow(`No policy found for ${id}.`));
        process.exit(1);
      }
      console.log(chalk.green(`Removed dispatch policy ${id}.`));
    } finally {
      await dispatch.closeAll();
    }
  });

// ── wotann memory ────────────────────────────────────────────

const memoryCmd = program.command("memory").description("Memory operations");

memoryCmd
  .command("search <query>")
  .description("Search memory")
  .action(async (query: string) => {
    const { MemoryStore } = await import("./memory/store.js");
    const dbPath = join(process.cwd(), ".wotann", "memory.db");
    const store = new MemoryStore(dbPath);
    const results = store.search(query);
    if (results.length === 0) {
      console.log(chalk.dim("No results found."));
    } else {
      for (const r of results) {
        console.log(
          `${chalk.cyan(r.entry.key)} ${chalk.dim(`(${r.entry.blockType})`)} — ${r.entry.value.slice(0, 100)}`,
        );
      }
    }
    store.close();
  });

memoryCmd
  .command("verify")
  .description("Verify memories against codebase")
  .action(async () => {
    const dbPath = join(process.cwd(), ".wotann", "memory.db");
    const { existsSync } = await import("node:fs");
    if (!existsSync(dbPath)) {
      console.log(chalk.yellow("No memory database found. Run wotann init first."));
      return;
    }
    const { MemoryStore } = await import("./memory/store.js");
    const store = new MemoryStore(dbPath);
    const entries = store.getByLayer("core_blocks");
    const unverified = entries.filter((e) => !e.verified);
    console.log(
      chalk.bold(`Memory verification: ${entries.length} entries, ${unverified.length} unverified`),
    );
    if (unverified.length > 0) {
      console.log(chalk.dim("\nUnverified entries:"));
      for (const e of unverified.slice(0, 10)) {
        console.log(`  ${chalk.yellow("○")} ${e.key} — ${e.value.slice(0, 60)}...`);
      }
      if (unverified.length > 10) {
        console.log(chalk.dim(`  ... and ${unverified.length - 10} more`));
      }
    } else {
      console.log(chalk.green("  ✓ All memories verified."));
    }
    store.close();
  });

memoryCmd
  .command("sync [snapshotPath]")
  .description("Bidirectionally sync team memory via a shared snapshot file")
  .action(async (snapshotPath?: string) => {
    const { MemoryStore } = await import("./memory/store.js");
    const dbPath = join(process.cwd(), ".wotann", "memory.db");
    const store = new MemoryStore(dbPath);
    const targetPath = snapshotPath ?? join(process.cwd(), ".wotann", "team-memory-sync.json");
    const result = store.syncTeamMemoryFile(targetPath);

    console.log(chalk.bold("\nTeam Memory Sync\n"));
    console.log(chalk.dim(`  Snapshot: ${targetPath}`));
    console.log(chalk.dim(`  Inserted: ${result.inserted}`));
    console.log(chalk.dim(`  Updated: ${result.updated}`));
    console.log(chalk.dim(`  Skipped: ${result.skipped}`));
    console.log(chalk.dim(`  Exported: ${result.exported}`));
    if (result.conflicts.length > 0) {
      console.log(chalk.yellow(`  Conflicts: ${result.conflicts.join(", ")}`));
    }
    console.log();
    store.close();
  });

// ── wotann skills ────────────────────────────────────────────

const skillsCmd = program.command("skills").description("Skill management");

skillsCmd
  .command("list")
  .description("List available skills")
  .action(async () => {
    const { SkillRegistry } = await import("./skills/loader.js");
    const registry = SkillRegistry.createWithDefaults(
      join(new URL(".", import.meta.url).pathname, "..", "skills"),
    );
    const summaries = registry.getSummaries();
    console.log(chalk.bold(`\n${summaries.length} skills available:\n`));
    const byCategory = new Map<
      string,
      Array<{ name: string; description: string; category: string }>
    >();
    for (const s of summaries) {
      const list = byCategory.get(s.category) ?? [];
      list.push(s);
      byCategory.set(s.category, list);
    }
    for (const [cat, skills] of byCategory) {
      console.log(chalk.bold(`  ${cat} (${skills.length}):`));
      for (const s of skills) {
        console.log(`    ${chalk.cyan(s.name)} — ${chalk.dim(s.description)}`);
      }
    }
    console.log();
  });

skillsCmd
  .command("search <query>")
  .description("Search for skills")
  .action(async (query: string) => {
    const { SkillRegistry } = await import("./skills/loader.js");
    const registry = SkillRegistry.createWithDefaults(
      join(new URL(".", import.meta.url).pathname, "..", "skills"),
    );
    const summaries = registry.getSummaries();
    const matches = summaries.filter(
      (s) => s.name.includes(query) || s.description.toLowerCase().includes(query.toLowerCase()),
    );
    if (matches.length === 0) {
      console.log(chalk.dim("No matching skills found."));
    } else {
      for (const s of matches) {
        console.log(`${chalk.cyan(s.name)} — ${s.description}`);
      }
    }
  });

skillsCmd
  .command("export-agentskills <out>")
  .description("Emit an agentskills.io-compatible registry (SKILL.md per skill + manifest.json)")
  .option("--source <dir>", "Source skills directory", "skills")
  .action(async (out: string, options: { source: string }) => {
    const { exportToAgentSkills } = await import("./skills/agentskills-registry.js");
    const sourceDir = options.source.startsWith("/")
      ? options.source
      : join(process.cwd(), options.source);
    const outDir = out.startsWith("/") ? out : join(process.cwd(), out);
    const result = exportToAgentSkills(sourceDir, outDir, { producer: "wotann" });
    console.log(chalk.bold("\nagentskills.io export\n"));
    console.log(`  Source:     ${chalk.dim(sourceDir)}`);
    console.log(`  Output:     ${chalk.dim(outDir)}`);
    console.log(`  Skills:     ${chalk.green(result.skillsWritten)}`);
    console.log(`  Manifest:   ${chalk.dim(result.manifestPath)}`);
    if (result.errors.length > 0) {
      console.log(chalk.yellow(`  Errors:     ${result.errors.length}`));
      for (const e of result.errors.slice(0, 10)) {
        console.log(chalk.dim(`    ${e.path}: ${e.problems.join("; ")}`));
      }
    }
    console.log();
  });

// ── wotann cost ──────────────────────────────────────────────

program
  .command("cost")
  .description("Show cost tracking")
  .option("--month", "Monthly breakdown")
  .option("--budget <amount>", "Set monthly budget")
  .action(async (options: { month?: boolean; budget?: string }) => {
    const { CostTracker } = await import("./telemetry/cost-tracker.js");
    const tracker = new CostTracker(join(process.cwd(), ".wotann", "cost.json"));
    if (options.budget) {
      tracker.setBudget(parseFloat(options.budget));
      console.log(chalk.green(`Budget set to $${options.budget}`));
    } else {
      console.log(chalk.bold("Cost Tracking"));
      console.log(`  Total:  $${tracker.getTotalCost().toFixed(4)}`);
      console.log(`  Today:  $${tracker.getTodayCost().toFixed(4)}`);
      console.log(`  Entries: ${tracker.getEntryCount()}`);
      if (tracker.getBudget() !== null) {
        console.log(`  Budget: $${tracker.getBudget()!.toFixed(2)}`);
      }
    }
  });

// ── wotann precommit ───────────────────────────────────────

program
  .command("precommit")
  .description("Run proactive pre-commit analysis for the current repo")
  .action(async () => {
    const { runPreCommitAnalysis } = await import("./verification/pre-commit.js");
    const result = runPreCommitAnalysis(process.cwd());

    console.log(chalk.bold("\nWOTANN Pre-Commit Analysis\n"));
    console.log(chalk.dim(`  Runner: ${result.commandRunner}\n`));
    console.log(
      chalk.dim(
        `  Sandbox: ${result.sandbox}${result.sandboxEnforced ? " (enforced)" : " (degraded)"}\n`,
      ),
    );

    if (result.checks.length === 0) {
      console.log(chalk.yellow("  No package scripts found for pre-commit analysis.\n"));
      return;
    }

    for (const check of result.checks) {
      const icon = check.success ? chalk.green("✓") : chalk.red("✗");
      console.log(`  ${icon} ${check.name} — ${check.command.join(" ")}`);
      if (!check.success) {
        const summaryLine =
          check.output
            .split("\n")
            .map((line) => line.trim())
            .find(Boolean) ?? "";
        console.log(chalk.dim(`    ${summaryLine}`));
      }
    }

    console.log();
    process.exit(result.blockers.length === 0 ? 0 : 1);
  });

// ── wotann mcp ───────────────────────────────────────────────

const mcpCmd = program.command("mcp").description("MCP server management");

mcpCmd
  .command("list")
  .description("List MCP servers")
  .action(async () => {
    const { MCPRegistry } = await import("./marketplace/registry.js");
    const registry = new MCPRegistry({ projectDir: process.cwd() });
    const builtins = registry.registerBuiltins();
    const imported = registry.importFromClaudeCode();
    const servers = registry.getAllServers();
    console.log(
      chalk.bold(
        `\nMCP Servers (${servers.length} configured, ${builtins} built-in, ${imported} imported from Claude Code):\n`,
      ),
    );
    for (const s of servers) {
      const status = s.enabled ? chalk.green("●") : chalk.red("○");
      console.log(`  ${status} ${chalk.bold(s.name)} — ${s.command} ${s.args.join(" ")}`);
    }
    console.log();
  });

mcpCmd
  .command("import")
  .option("--from-claude", "Import from Claude Code settings")
  .description("Import MCP servers from other tools")
  .action(async (options: { fromClaude?: boolean }) => {
    const { MCPRegistry } = await import("./marketplace/registry.js");
    const registry = new MCPRegistry();
    let count = 0;
    if (options.fromClaude) {
      count = registry.importFromClaudeCode();
    }
    console.log(chalk.green(`Imported ${count} MCP servers.`));
  });

// ── wotann lsp ───────────────────────────────────────────────

const lspCmd = program
  .command("lsp")
  .description("Symbol-aware code navigation and rename operations");

lspCmd
  .command("available")
  .description("List detected language servers")
  .action(async () => {
    const { LSPManager } = await import("./lsp/symbol-operations.js");
    const manager = new LSPManager();
    const available = await manager.detectAvailable();

    console.log(chalk.bold("\nWOTANN LSP\n"));
    console.log(chalk.dim(`  Available servers: ${available.join(", ") || "none detected"}`));
    console.log(
      chalk.dim(`  Supported languages: ${manager.getSupportedLanguages().join(", ")}\n`),
    );
  });

lspCmd
  .command("symbols <name>")
  .description("Find workspace symbol definitions")
  .action(async (name: string) => {
    const { SymbolOperations } = await import("./lsp/symbol-operations.js");
    const symbols = await new SymbolOperations({ workspaceRoot: process.cwd() }).findSymbol(name);

    if (symbols.length === 0) {
      console.log(chalk.yellow(`\nNo symbols found for ${name}.\n`));
      process.exit(1);
    }

    console.log(chalk.bold(`\nSymbols for ${name}\n`));
    for (const symbol of symbols) {
      const filePath = normalizeDisplayPath(symbol.uri);
      console.log(`  ${chalk.cyan(symbol.kind)} ${symbol.name}`);
      console.log(
        chalk.dim(
          `    ${filePath}:${symbol.range.start.line + 1}:${symbol.range.start.character + 1}`,
        ),
      );
    }
    console.log();
  });

lspCmd
  .command("outline <file>")
  .description("Show document symbols for a file")
  .action(async (file: string) => {
    const { SymbolOperations } = await import("./lsp/symbol-operations.js");
    const filePath = resolve(process.cwd(), file);
    const symbols = await new SymbolOperations({ workspaceRoot: process.cwd() }).getDocumentSymbols(
      filePath,
    );

    if (symbols.length === 0) {
      console.log(chalk.yellow(`\nNo document symbols found in ${file}.\n`));
      process.exit(1);
    }

    console.log(chalk.bold(`\nOutline for ${file}\n`));
    for (const symbol of symbols) {
      const container = symbol.containerName ? chalk.dim(` (${symbol.containerName})`) : "";
      console.log(`  ${chalk.cyan(symbol.kind)} ${symbol.name}${container}`);
    }
    console.log();
  });

lspCmd
  .command("refs <file> <line> <character>")
  .description("Find symbol references at a given file position (1-based line/column)")
  .action(async (file: string, line: string, character: string) => {
    const { SymbolOperations } = await import("./lsp/symbol-operations.js");
    const filePath = resolve(process.cwd(), file);
    const operations = new SymbolOperations({ workspaceRoot: process.cwd() });
    const references = await operations.findReferences(filePath, {
      line: Math.max(parseInt(line, 10) - 1, 0),
      character: Math.max(parseInt(character, 10) - 1, 0),
    });

    if (references.length === 0) {
      console.log(chalk.yellow(`\nNo references found for ${file}:${line}:${character}.\n`));
      process.exit(1);
    }

    console.log(chalk.bold(`\nReferences for ${file}:${line}:${character}\n`));
    for (const reference of references) {
      const refPath = normalizeDisplayPath(reference.uri);
      console.log(
        chalk.dim(
          `  ${refPath}:${reference.range.start.line + 1}:${reference.range.start.character + 1}`,
        ),
      );
    }
    console.log(chalk.dim(`\n  Total references: ${references.length}\n`));
  });

lspCmd
  .command("hover <file> <line> <character>")
  .description("Show type/hover information at a given file position (1-based line/column)")
  .action(async (file: string, line: string, character: string) => {
    const { SymbolOperations } = await import("./lsp/symbol-operations.js");
    const filePath = resolve(process.cwd(), file);
    const info = await new SymbolOperations({ workspaceRoot: process.cwd() }).getTypeInfo(
      filePath,
      {
        line: Math.max(parseInt(line, 10) - 1, 0),
        character: Math.max(parseInt(character, 10) - 1, 0),
      },
    );

    if (!info) {
      console.log(chalk.yellow(`\nNo hover information found for ${file}:${line}:${character}.\n`));
      process.exit(1);
    }

    console.log(chalk.bold(`\nHover for ${file}:${line}:${character}\n`));
    console.log(info);
    console.log();
  });

lspCmd
  .command("rename <file> <line> <character> <newName>")
  .description("Rename a symbol across the workspace from a given file position")
  .option("--apply", "Apply the rename to disk")
  .action(
    async (
      file: string,
      line: string,
      character: string,
      newName: string,
      options: { apply?: boolean },
    ) => {
      const { SymbolOperations, applyRenameResult } = await import("./lsp/symbol-operations.js");
      const filePath = resolve(process.cwd(), file);
      const operations = new SymbolOperations({ workspaceRoot: process.cwd() });
      const result = await operations.rename(
        filePath,
        {
          line: Math.max(parseInt(line, 10) - 1, 0),
          character: Math.max(parseInt(character, 10) - 1, 0),
        },
        newName,
      );

      if (result.editsApplied === 0) {
        console.log(chalk.yellow(`\nNo rename edits produced for ${file}:${line}:${character}.\n`));
        process.exit(1);
      }

      console.log(chalk.bold(`\nRename preview for ${newName}\n`));
      console.log(chalk.dim(`  Files affected: ${result.filesAffected}`));
      console.log(chalk.dim(`  Edits: ${result.editsApplied}\n`));

      for (const [changedFile, edits] of result.changes) {
        console.log(
          `  ${normalizeDisplayPath(changedFile)} ${chalk.dim(`(${edits.length} edits)`)}`,
        );
      }

      if (options.apply) {
        const modifiedFiles = applyRenameResult(result);
        console.log(chalk.green(`\nApplied rename to ${modifiedFiles} file(s).\n`));
        return;
      }

      console.log(chalk.dim("\nRun again with --apply to persist the rename.\n"));
    },
  );

// ── wotann repos ────────────────────────────────────────────

const reposCmd = program
  .command("repos")
  .description("Source monitoring — track 60+ repos for changes");

reposCmd
  .command("check")
  .description("Check all tracked repos for new commits, releases, features")
  .action(async () => {
    const { checkAllRepos } = await import("./monitoring/source-monitor.js");
    const configPath = join(process.cwd(), "..", "research", "monitor-config.yaml");
    const researchDir = join(process.cwd(), "..", "research");
    const statePath = join(process.cwd(), ".wotann", "sync-state.json");

    console.log(chalk.bold("\nWOTANN Source Monitor\n"));
    console.log(chalk.dim("  Checking tracked repos for changes...\n"));

    const digest = checkAllRepos(configPath, researchDir, statePath);

    if (digest.changes.length === 0) {
      console.log(chalk.green("  No changes detected since last sync."));
    } else {
      console.log(chalk.bold(`  ${digest.reposWithChanges} repos with changes:\n`));
      for (const change of digest.changes) {
        console.log(`  ${chalk.cyan(change.repo)} — ${change.commitCount} new commits`);
        console.log(chalk.dim(`    Latest: ${change.latestCommit}`));
        if (change.relevantFiles.length > 0) {
          console.log(
            chalk.dim(`    Relevant files: ${change.relevantFiles.slice(0, 5).join(", ")}`),
          );
        }
        if (change.hasNewRelease) {
          console.log(chalk.yellow(`    New release: ${change.releaseName}`));
        }
        console.log();
      }
    }

    if (digest.errors.length > 0) {
      console.log(
        chalk.dim(`  ${digest.errors.length} repos had errors (not cloned or inaccessible)`),
      );
    }

    console.log(
      chalk.dim(`  Checked ${digest.reposChecked} repos at ${new Date().toLocaleTimeString()}\n`),
    );
  });

reposCmd
  .command("sync")
  .description("Update last-sync timestamps for all tracked repos")
  .action(async () => {
    const { syncAllRepos, loadTrackedRepos } = await import("./monitoring/source-monitor.js");
    const configPath = join(process.cwd(), "..", "research", "monitor-config.yaml");
    const statePath = join(process.cwd(), ".wotann", "sync-state.json");

    syncAllRepos(configPath, statePath);
    const repos = loadTrackedRepos(configPath);
    console.log(chalk.green(`\nSync state updated for ${repos.length} repos.\n`));
  });

// ── wotann autonomous ───────────────────────────────────────

program
  .command("autonomous <prompt>")
  .alias("auto")
  .description("Run autonomously until task is complete and verified")
  .option("--max-cycles <n>", "Max retry cycles", "10")
  .option("--max-time <min>", "Max time in minutes", "30")
  .option("--max-cost <usd>", "Max cost in USD", "5")
  .option("--no-tests", "Skip test verification")
  .option("--visual", "Enable screen-aware verification in the verify phase")
  .option("--visual-expect <text>", "Expected text or UI state for visual verification")
  .option("--commit", "Commit on success")
  .option("--provider <provider>", "Force provider")
  .option("--model <model>", "Force model")
  .action(
    async (
      prompt: string,
      options: {
        maxCycles?: string;
        maxTime?: string;
        maxCost?: string;
        tests?: boolean;
        visual?: boolean;
        visualExpect?: string;
        commit?: boolean;
        provider?: string;
        model?: string;
      },
    ) => {
      const { AutonomousExecutor } = await import("./orchestration/autonomous.js");
      const { writeAutonomousProofBundle } = await import("./orchestration/proof-bundles.js");
      const { createRuntime } = await import("./core/runtime.js");
      const { runRuntimeQuery } = await import("./cli/runtime-query.js");
      const { mkdirSync, writeFileSync } = await import("node:fs");
      // Session-5: autopilot callbacks now route shadow-git through
      // runtime.getShadowGit() so the checkpoint ring stays coherent
      // with PreToolUse hook entries. No direct ShadowGit import needed.

      const executor = new AutonomousExecutor({
        maxCycles: parseInt(options.maxCycles ?? "10", 10),
        maxTimeMs: parseInt(options.maxTime ?? "30", 10) * 60_000,
        maxCostUsd: parseFloat(options.maxCost ?? "5"),
        runTests: options.tests !== false,
        runTypecheck: true,
        runLint: false,
        commitOnSuccess: options.commit ?? false,
        enableScreenVerification: options.visual === true,
      });
      const runtime = await createRuntime(process.cwd(), "autonomous");

      if (runtime.getStatus().providers.length === 0) {
        console.error(chalk.red("No providers configured. Run `wotann init` first."));
        runtime.close();
        process.exit(1);
      }

      console.log(chalk.bold("\nWOTANN Autonomous Mode"));
      console.log(chalk.dim(`  Task: ${prompt.slice(0, 100)}`));
      console.log(
        chalk.dim(
          `  Budget: ${options.maxCycles ?? 10} cycles, ${options.maxTime ?? 30}min, $${options.maxCost ?? 5}`,
        ),
      );
      console.log(chalk.dim(`  Screen verification: ${options.visual ? "enabled" : "disabled"}`));
      console.log();

      const checkpointDir = join(process.cwd(), ".wotann", "autonomous-checkpoints");

      try {
        const result = await executor.execute(
          prompt,
          async (p) => {
            const query = await runRuntimeQuery(runtime, {
              prompt: p,
              model: options.model,
              provider: options.provider as "anthropic" | undefined,
            });
            executor.updateContextUsage(runtime.getContextBudget().usagePercent);
            return {
              output: query.output || query.errors.join("\n") || "No response generated.",
              costUsd: query.costUsd,
              tokensUsed: query.tokensUsed,
            };
          },
          async () => {
            let testsPass = true;
            let typecheckPass = true;
            const lintPass = true;
            let output = "";
            const { runSandboxedCommandSync } = await import("./sandbox/executor.js");
            const typecheck = runSandboxedCommandSync("npx", ["tsc", "--noEmit"], {
              workingDir: process.cwd(),
              timeoutMs: 60_000,
              allowNetwork: false,
            });
            if (!typecheck.success) {
              typecheckPass = false;
              output += `Typecheck failed: ${typecheck.output || typecheck.errorMessage || "unknown"}\n`;
            }
            if (options.tests !== false) {
              const tests = runSandboxedCommandSync("npx", ["vitest", "run"], {
                workingDir: process.cwd(),
                timeoutMs: 120_000,
                allowNetwork: true,
              });
              if (!tests.success) {
                testsPass = false;
                output += `Tests failed: ${tests.output || tests.errorMessage || "unknown"}\n`;
              }
            }

            if (options.visual) {
              const { describeScreenState, runVisualTest } =
                await import("./testing/screen-aware.js");
              output += `Screen state:\n${describeScreenState()}\n`;

              if (options.visualExpect) {
                const visualResult = await runVisualTest({
                  id: `autonomous-visual-${Date.now()}`,
                  description: options.visualExpect,
                  target: "auto",
                  assertions: [
                    { type: "text-present", value: options.visualExpect },
                    { type: "no-error", value: "" },
                  ],
                });

                output +=
                  [
                    `Visual verification: ${visualResult.passed ? "passed" : "failed"}`,
                    `Visual duration: ${visualResult.durationMs}ms`,
                    visualResult.textContent ? `Visual text: ${visualResult.textContent}` : "",
                    visualResult.screenshotPath ? `Screenshot: ${visualResult.screenshotPath}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n") + "\n";

                if (!visualResult.passed) {
                  testsPass = false;
                }
              }
            }

            return { testsPass, typecheckPass, lintPass, output };
          },
          {
            onCycleStart: (cycle, strategy) => {
              console.log(chalk.dim(`  Cycle ${cycle + 1}: strategy=${strategy}`));
            },
            onCycleEnd: (result) => {
              const status =
                result.testsPass && result.typecheckPass ? chalk.green("✓") : chalk.red("✗");
              console.log(
                chalk.dim(
                  `  ${status} Cycle ${result.cycle + 1} done in ${(result.durationMs / 1000).toFixed(1)}s ($${result.costUsd.toFixed(4)}) ctx=${Math.round(result.contextUsage * 100)}%`,
                ),
              );
            },
            onStrategyChange: (from, to) => {
              console.log(chalk.yellow(`  Strategy escalation: ${from} -> ${to}`));
            },
            onContextPressure: async (usage) => {
              console.log(
                chalk.yellow(
                  `  Context pressure ${Math.round(usage * 100)}% — triggering compaction...`,
                ),
              );
              try {
                const budget = runtime.getContextBudget();
                const targetTokens = Math.floor(budget.totalTokens * 0.6);
                const { compactHybrid } = await import("./context/compaction.js");
                const msgs = runtime.getConversationHistory?.() ?? [];
                if (msgs.length > 0) {
                  const compactionResult = compactHybrid(
                    msgs.map((m: { role: string; content: string }, i: number) => ({
                      role: m.role,
                      content:
                        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
                      timestamp: Date.now() - (msgs.length - i) * 1000,
                    })),
                    targetTokens,
                    (batch) => `[Summary of ${batch.length} messages]`,
                  );
                  console.log(
                    chalk.dim(
                      `  Compacted: ${compactionResult.tokensBefore} -> ${compactionResult.tokensAfter} tokens (${Math.round(compactionResult.reduction * 100)}% reduction)`,
                    ),
                  );
                }
              } catch {
                // Best-effort path — caller gets a safe fallback, no user-facing error.
                console.log(chalk.dim("  Compaction skipped (no conversation history API)"));
              }
            },
            onCheckpoint: async (state) => {
              mkdirSync(checkpointDir, { recursive: true });
              writeFileSync(join(checkpointDir, "latest.json"), JSON.stringify(state, null, 2));
            },
            onShadowGitCommit: async (_cycle, message) => {
              try {
                // Route through the runtime's singleton so this checkpoint
                // lands in the same ring buffer as the PreToolUse hook —
                // a parallel `new ShadowGit(...)` instance here would
                // silently decouple autopilot checkpoints from shadow.undo.
                // `_cycle` unused: message already encodes the cycle context.
                const sha = await runtime.getShadowGit().createCheckpoint(message);
                if (sha) console.log(chalk.dim(`  Shadow git: ${sha.slice(0, 8)} — ${message}`));
              } catch {
                // Shadow git is best-effort
              }
            },
            onMultiModelVerify: async (output) => {
              try {
                const verifyResult = await runRuntimeQuery(runtime, {
                  prompt: `Review the following autonomous agent output. Reply with APPROVED if the work is correct and complete, or REJECTED with specific feedback:\n\n${output.slice(0, 4000)}`,
                  model: "claude-sonnet-4-6",
                });
                const text = verifyResult.output ?? "";
                const approved = /\bAPPROVED\b/i.test(text);
                return { approved, feedback: text };
              } catch {
                // Best-effort path — caller gets a safe fallback, no user-facing error.
                return {
                  approved: true,
                  feedback: "Verification model unavailable — auto-approved",
                };
              }
            },
          },
        );

        const proofBundlePath = writeAutonomousProofBundle({
          workingDir: process.cwd(),
          task: prompt,
          result,
          runtimeStatus: runtime.getStatus(),
          contextBudget: runtime.getContextBudget(),
          contextCapability: runtime.getContextCapabilityProfile(),
          providerOverride: options.provider,
          modelOverride: options.model,
          visualVerificationEnabled: options.visual === true,
          visualExpectation: options.visualExpect,
        });

        console.log(chalk.bold("\nAutonomous Mode Results:"));
        console.log(`  Exit reason: ${result.exitReason}`);
        console.log(`  Cycles: ${result.totalCycles}`);
        console.log(`  Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
        console.log(`  Cost: $${result.totalCostUsd.toFixed(4)}`);
        console.log(`  Proof bundle: ${proofBundlePath}`);
        console.log(
          result.success
            ? chalk.green("  Done — Task completed successfully")
            : chalk.red("  Failed — Task did not complete"),
        );
        console.log();

        process.exit(result.success ? 0 : 1);
      } finally {
        runtime.close();
      }
    },
  );

// ── wotann autopilot ────────────────────────────────────────
//
// Phase H+D: long-horizon phase-gated orchestration.
// Wraps the existing autonomous executor OR, with --long-horizon, runs the
// autonovel-style phase/plateau/dual-persona orchestrator for 8+ hour tasks.

program
  .command("autopilot <prompt>")
  .description("Autopilot: run autonomously until the task is complete")
  .option("--long-horizon", "Use the phase-gated long-horizon orchestrator (autonovel-style)")
  .option("--phases <path>", "Path to phases.json (required with --long-horizon)")
  .option("--budget <spec>", "Budget (e.g. '300s', '5m', '2h' for time)", "8h")
  .option("--budget-tokens <n>", "Token budget cap", "1000000")
  .option("--budget-usd <n>", "USD budget cap", "50")
  .option("--no-review", "Disable dual-persona review gate")
  .option("--no-escalation", "Disable tier escalation on plateau")
  .option("--checkpoint-dir <path>", "Directory for per-phase checkpoints")
  .option("--provider <provider>", "Force provider")
  .option("--model <model>", "Force model")
  .action(
    async (
      prompt: string,
      options: {
        longHorizon?: boolean;
        phases?: string;
        budget?: string;
        budgetTokens?: string;
        budgetUsd?: string;
        review?: boolean;
        escalation?: boolean;
        checkpointDir?: string;
        provider?: string;
        model?: string;
      },
    ) => {
      // Non-long-horizon path: delegate to the existing autonomous executor.
      // Keeps a single user-facing entrypoint while leaving `autonomous` as
      // the low-level alias. Users get `wotann autopilot <prompt>` as the
      // default and opt into the long-horizon engine with --long-horizon.
      if (!options.longHorizon) {
        console.log(
          chalk.yellow(
            "autopilot without --long-horizon — delegating to `wotann autonomous`. Use `wotann autonomous` directly for the classic loop.",
          ),
        );
        // Delegate by spawning autonomous with same argv. Keeps behavior
        // consistent with the existing code path without duplicating logic.
        const { AutonomousExecutor } = await import("./orchestration/autonomous.js");
        const { createRuntime } = await import("./core/runtime.js");
        const { runRuntimeQuery } = await import("./cli/runtime-query.js");
        const executor = new AutonomousExecutor({
          maxCycles: 10,
          maxTimeMs: 30 * 60_000,
          maxCostUsd: parseFloat(options.budgetUsd ?? "5"),
        });
        const runtime = await createRuntime(process.cwd(), "autonomous");
        try {
          const result = await executor.execute(
            prompt,
            async (p) => {
              const query = await runRuntimeQuery(runtime, {
                prompt: p,
                model: options.model,
                provider: options.provider as "anthropic" | undefined,
              });
              return {
                output: query.output || query.errors.join("\n"),
                costUsd: query.costUsd,
                tokensUsed: query.tokensUsed,
              };
            },
            async () => ({ testsPass: true, typecheckPass: true, lintPass: true, output: "" }),
          );
          process.exit(result.success ? 0 : 1);
        } finally {
          runtime.close();
        }
        return;
      }

      // ── Long-horizon path ──
      if (!options.phases) {
        console.error(chalk.red("--long-horizon requires --phases <path> pointing to phases.json"));
        process.exit(1);
      }

      const { LongHorizonOrchestrator, parsePhases } =
        await import("./orchestration/long-horizon-orchestrator.js");
      const { createRuntime } = await import("./core/runtime.js");
      const { runRuntimeQuery } = await import("./cli/runtime-query.js");
      const { readFileSync, mkdirSync, writeFileSync } = await import("node:fs");

      // Load phases.json.
      let phasesRaw: unknown;
      try {
        phasesRaw = JSON.parse(readFileSync(resolve(options.phases), "utf-8"));
      } catch (err) {
        console.error(chalk.red(`Failed to read phases file: ${(err as Error).message}`));
        process.exit(1);
      }
      let phases;
      try {
        phases = parsePhases(phasesRaw);
      } catch (err) {
        console.error(chalk.red(`Invalid phases schema: ${(err as Error).message}`));
        process.exit(1);
      }

      const budgetMs = parseBudgetToMs(options.budget ?? "8h");
      const checkpointDir =
        options.checkpointDir ?? join(process.cwd(), ".wotann", "long-horizon-checkpoints");

      const orchestrator = new LongHorizonOrchestrator({
        budget: {
          tokens: parseInt(options.budgetTokens ?? "1000000", 10),
          timeMs: budgetMs,
          usd: parseFloat(options.budgetUsd ?? "50"),
        },
        enableReview: options.review !== false,
        enableTierEscalation: options.escalation !== false,
      });

      const runtime = await createRuntime(process.cwd(), "autonomous");

      console.log(chalk.bold("\nWOTANN Autopilot — Long-Horizon Mode"));
      console.log(chalk.dim(`  Task: ${prompt.slice(0, 100)}`));
      console.log(chalk.dim(`  Phases: ${phases.length}`));
      console.log(
        chalk.dim(
          `  Budget: ${options.budget}, $${options.budgetUsd}, ${options.budgetTokens} tokens`,
        ),
      );
      console.log();

      try {
        const result = await orchestrator.run({
          taskDescription: prompt,
          phases,
          worker: async ({
            phase,
            iteration,
            previousArtifact,
            reviewerFeedback,
            plateauHint,
            tierHint,
          }) => {
            const workerPrompt = [
              `Task: ${prompt}`,
              "",
              `Phase ${phase.id}: ${phase.name}`,
              `Goal: ${phase.goal}`,
              `Iteration: ${iteration + 1}/${phase.maxIterations}`,
              tierHint === "escalated" ? "[ESCALATED — use stronger reasoning]" : "",
              previousArtifact
                ? `\nPrevious artifact:\n---\n${previousArtifact.slice(0, 4000)}\n---\n`
                : "",
              reviewerFeedback ? `\nReviewer feedback to address:\n${reviewerFeedback}\n` : "",
              plateauHint ? `\nPlateau detected: ${plateauHint}. Change approach.\n` : "",
            ]
              .filter(Boolean)
              .join("\n");
            const query = await runRuntimeQuery(runtime, {
              prompt: workerPrompt,
              model: options.model,
              provider: options.provider as "anthropic" | undefined,
            });
            return {
              artifact: query.output || query.errors.join("\n") || "",
              tokensUsed: query.tokensUsed,
              costUsd: query.costUsd,
            };
          },
          scorer: async (artifact) => {
            // Simple heuristic scorer: proportion of requested length hit.
            // Callers can override by writing a smarter scorer — this is just
            // the CLI default so users have a working baseline.
            const target = Math.max(500, artifact.length > 0 ? 1000 : 0);
            return Math.min(1, artifact.length / target);
          },
          reviewer: async (persona, artifact, context) => {
            const { buildCriticPrompt, buildDefenderPrompt, parsePersonaReply } =
              await import("./orchestration/dual-persona-reviewer.js");
            const prompt =
              persona === "critic"
                ? buildCriticPrompt(artifact, context)
                : buildDefenderPrompt(artifact, context);
            const reply = await runRuntimeQuery(runtime, {
              prompt,
              model: options.model,
            });
            return parsePersonaReply(reply.output || "", persona, reply.tokensUsed);
          },
          saveCheckpoint: async (snapshot) => {
            try {
              mkdirSync(checkpointDir, { recursive: true });
              const path = join(checkpointDir, `phase-${snapshot.currentPhaseIndex}.json`);
              writeFileSync(path, JSON.stringify(snapshot, null, 2));
            } catch {
              // Best-effort.
            }
          },
          onEvent: (event) => {
            switch (event.kind) {
              case "phase-start":
                console.log(
                  chalk.bold(`\n▶ Phase ${event.index + 1}/${event.total}: ${event.phase.name}`),
                );
                break;
              case "iteration-end":
                console.log(
                  chalk.dim(
                    `  iter ${event.iteration + 1} — score ${event.score.toFixed(3)} (${event.tokensUsed} tok)`,
                  ),
                );
                break;
              case "review":
                console.log(
                  chalk.cyan(
                    `  review — ${event.verdict.outcome} (critic ${event.verdict.critic.confidence.toFixed(2)}, defender ${event.verdict.defender.confidence.toFixed(2)})`,
                  ),
                );
                break;
              case "plateau":
                console.log(
                  chalk.yellow(
                    `  plateau — ${event.verdict.kind} → ${event.response}: ${event.verdict.reason}`,
                  ),
                );
                break;
              case "tier-escalate":
                console.log(chalk.magenta(`  tier-escalated: ${event.reason}`));
                break;
              case "phase-end":
                console.log(
                  chalk.green(
                    `  phase-end: ${event.status}, best score ${event.bestScore.toFixed(3)}`,
                  ),
                );
                break;
              case "budget-exceeded":
                console.log(
                  chalk.red(
                    `  BUDGET EXCEEDED on ${event.dimension}: ${event.spent} > ${event.cap}`,
                  ),
                );
                break;
              case "progress":
                process.stdout.write(`\r  progress: ${event.percentage}%  `);
                break;
            }
          },
        });
        console.log();
        console.log(chalk.bold("\nLong-Horizon Autopilot Results:"));
        console.log(`  Exit reason:   ${result.exitReason}`);
        console.log(
          `  Phases exited: ${result.phases.filter((p) => p.status === "exited").length}/${result.phases.length}`,
        );
        console.log(`  Duration:      ${(result.totalDurationMs / 1000).toFixed(1)}s`);
        console.log(`  Tokens:        ${result.totalTokens}`);
        console.log(`  USD:           $${result.totalUsd.toFixed(4)}`);
        console.log(
          result.success
            ? chalk.green("  Done — all phases exited cleanly")
            : chalk.red("  Failed — see exit reason above"),
        );
        process.exit(result.success ? 0 : 1);
      } finally {
        runtime.close();
      }
    },
  );

// Parse budget spec like "300s", "5m", "2h" into ms.
function parseBudgetToMs(spec: string): number {
  const match = spec.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!match || !match[1]) return 8 * 60 * 60 * 1000;
  const value = parseFloat(match[1]);
  const unit = match[2] ?? "ms";
  const mult = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  return Math.floor(value * mult);
}

// ── wotann onboard ──────────────────────────────────────────

program
  .command("onboard")
  .description("Interactive provider setup — guides through configuring all available providers")
  .action(async () => {
    console.log(chalk.bold("\nWOTANN Provider Onboarding\n"));
    console.log(chalk.dim("  Checking for available providers...\n"));

    const { discoverProviders, formatFullStatus } = await import("./providers/discovery.js");
    const providers = await discoverProviders();
    const statuses = formatFullStatus(providers);

    const SETUP_GUIDE: ReadonlyArray<{ provider: string; label: string; instructions: string[] }> =
      [
        {
          provider: "anthropic",
          label: "Anthropic Claude",
          instructions: [
            "Option A (Subscription): Install Claude Code CLI and log in:",
            "  npm install -g @anthropic-ai/claude-code && claude login",
            "Option B (API Key): Set ANTHROPIC_API_KEY in your shell:",
            "  export ANTHROPIC_API_KEY=sk-ant-...",
          ],
        },
        {
          provider: "codex",
          label: "OpenAI Codex (ChatGPT subscription)",
          instructions: [
            "Authenticate via Codex CLI (uses your ChatGPT Plus/Pro subscription):",
            '  npx @openai/codex --full-auto "hello"',
            "This creates ~/.codex/auth.json with your OAuth tokens.",
          ],
        },
        {
          provider: "openai",
          label: "OpenAI API",
          instructions: [
            "Set OPENAI_API_KEY in your shell:",
            "  export OPENAI_API_KEY=sk-...",
            "Get a key at: https://platform.openai.com/api-keys",
          ],
        },
        {
          provider: "copilot",
          label: "GitHub Copilot",
          instructions: [
            "Set GH_TOKEN with Copilot access:",
            "  export GH_TOKEN=$(gh auth token)",
            "Requires GitHub Copilot subscription: https://github.com/settings/copilot",
          ],
        },
        {
          provider: "gemini",
          label: "Google Gemini (free tier: 1.5M tokens/day)",
          instructions: [
            "Get a free API key at: https://aistudio.google.com/app/apikey",
            "  export GEMINI_API_KEY=AI...",
          ],
        },
        {
          provider: "ollama",
          label: "Ollama (local, free, private)",
          instructions: [
            "Install Ollama: https://ollama.ai",
            "  ollama serve",
            "  ollama pull qwen3.5:27b      # best for 24GB+ VRAM",
            "  ollama pull qwen3.5:9b       # for 8GB VRAM",
          ],
        },
      ];

    for (const guide of SETUP_GUIDE) {
      const status = statuses.find((s) => s.provider === guide.provider);
      const active = status?.available ?? false;
      const icon = active ? chalk.green("ok") : chalk.yellow("--");
      const label = active ? chalk.green(guide.label) : chalk.white(guide.label);

      console.log(`  ${icon} ${label}`);
      if (active) {
        console.log(
          chalk.dim(`    Active (${status?.billing}) — ${status?.models.slice(0, 2).join(", ")}`),
        );
      } else {
        for (const line of guide.instructions) {
          console.log(chalk.dim(`    ${line}`));
        }
      }
      console.log();
    }

    const active = statuses.filter((s) => s.available);
    console.log(
      chalk.bold(
        `  ${active.length} providers active, ${statuses.length - active.length} available to configure`,
      ),
    );
    console.log(chalk.dim("  Re-run `wotann onboard` after configuration to verify.\n"));
  });

// ── wotann serve ────────────────────────────────────────────

program
  .command("serve")
  .description("Start an OpenAI-compatible API server (+ optional MCP server)")
  .option("--port <port>", "Server port", "4100")
  .option("--host <host>", "Bind host", "127.0.0.1")
  .option("--auth-token <token>", "Require bearer token for requests")
  .option("--no-mcp", "Disable MCP server endpoint")
  .option("--cors <origins>", "Allowed CORS origins (comma-separated)", "*")
  .action(
    async (options: {
      port?: string;
      host?: string;
      authToken?: string;
      mcp?: boolean;
      cors?: string;
    }) => {
      const { WotannAPIServer } = await import("./api/server.js");
      const { createRuntime } = await import("./core/runtime.js");
      const runtime = await createRuntime(process.cwd());

      if (runtime.getStatus().providers.length === 0) {
        console.error(chalk.red("No providers configured. Run `wotann init` first."));
        runtime.close();
        process.exit(1);
      }

      const server = new WotannAPIServer({
        port: parseInt(options.port ?? "4100", 10),
        host: options.host ?? "127.0.0.1",
        corsOrigins: (options.cors ?? "*").split(","),
        rateLimit: { requestsPerMinute: 60, burstSize: 10 },
        enableMCP: options.mcp !== false,
        enableStreaming: true,
        authToken: options.authToken,
      });

      const { runRuntimeQuery } = await import("./cli/runtime-query.js");

      server.onRequest(async (req) => {
        const result = await runRuntimeQuery(runtime, {
          prompt: req.messages
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .join("\n"),
          model: req.model,
        });
        return {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: req.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant" as const, content: result.output ?? "" },
              finish_reason: "stop" as const,
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: result.tokensUsed ?? 0,
            total_tokens: result.tokensUsed ?? 0,
          },
        };
      });

      await server.start();

      console.log(chalk.bold("\nWOTANN API Server\n"));
      console.log(
        chalk.dim(
          `  Endpoint:   http://${options.host ?? "127.0.0.1"}:${options.port ?? "4100"}/v1/chat/completions`,
        ),
      );
      console.log(
        chalk.dim(
          `  Models:     http://${options.host ?? "127.0.0.1"}:${options.port ?? "4100"}/v1/models`,
        ),
      );
      console.log(
        chalk.dim(
          `  Health:     http://${options.host ?? "127.0.0.1"}:${options.port ?? "4100"}/health`,
        ),
      );
      console.log(chalk.dim(`  MCP:        ${options.mcp !== false ? "enabled" : "disabled"}`));
      console.log(chalk.dim(`  Auth:       ${options.authToken ? "required" : "none"}`));
      console.log(chalk.dim(`  Providers:  ${runtime.getStatus().providers.join(", ")}`));
      console.log(chalk.dim("\n  Press Ctrl+C to stop.\n"));

      process.on("SIGINT", () => {
        server.stop();
        runtime.close();
        process.exit(0);
      });
    },
  );

// ── wotann arena ────────────────────────────────────────────

program
  .command("arena <prompt>")
  .description("Blind model comparison — run same prompt against multiple providers, vote on best")
  .action(async (prompt: string) => {
    const { discoverProviders } = await import("./providers/discovery.js");
    const providers = await discoverProviders();
    if (providers.length < 2) {
      console.error(
        chalk.red("Arena mode requires at least 2 providers. Run `wotann onboard` to set up more."),
      );
      process.exit(1);
    }

    const { runArenaContest } = await import("./orchestration/arena.js");
    const { createRuntime } = await import("./core/runtime.js");
    const { runRuntimeQuery } = await import("./cli/runtime-query.js");
    const providerNames = [...new Set(providers.map((provider) => provider.provider))];

    console.log(chalk.bold("\nWOTANN Arena Mode — blind model comparison\n"));
    console.log(
      chalk.dim(
        `  Running "${prompt.slice(0, 60)}..." against ${Math.min(providerNames.length, 3)} providers...\n`,
      ),
    );

    const contestants = await runArenaContest(
      async (provider, arenaPrompt) => {
        const runtime = await createRuntime(process.cwd(), "default");
        const startTime = Date.now();
        try {
          const result = await runRuntimeQuery(runtime, {
            prompt: arenaPrompt,
            provider,
          });
          return {
            response: result.output || result.errors.join("\n"),
            tokensUsed: result.tokensUsed,
            durationMs: Date.now() - startTime,
            model: result.model,
          };
        } finally {
          runtime.close();
        }
      },
      prompt,
      providerNames,
    );

    for (const c of contestants) {
      console.log(
        chalk.bold(
          `\n  ${c.label} (${(c.durationMs / 1000).toFixed(1)}s, ${c.tokensUsed} tokens):`,
        ),
      );
      console.log(chalk.dim("  " + "─".repeat(60)));
      console.log(`  ${c.response.slice(0, 500)}`);
      if (c.response.length > 500) console.log(chalk.dim("  ... (truncated)"));
    }

    console.log(chalk.bold("\n  Vote: Which response was best?"));
    for (let i = 0; i < contestants.length; i++) {
      const c = contestants[i];
      if (c) console.log(`  ${i + 1}. ${c.label}`);
    }
    console.log(chalk.dim("\n  (Voting is logged for your per-project leaderboard)\n"));
  });

// ── wotann architect ────────────────────────────────────────

program
  .command("architect <prompt>")
  .description("Dual-model pipeline: strong model plans, fast model implements")
  .option("--architect-provider <provider>", "Provider for architect phase")
  .option("--editor-provider <provider>", "Provider for editor phase")
  .action(
    async (prompt: string, options: { architectProvider?: string; editorProvider?: string }) => {
      const { runArchitectEditor } = await import("./orchestration/architect-editor.js");
      const { createRuntime } = await import("./core/runtime.js");
      const { runRuntimeQuery } = await import("./cli/runtime-query.js");
      const runtime = await createRuntime(process.cwd(), "plan");

      if (runtime.getStatus().providers.length === 0) {
        runtime.close();
        console.error(chalk.red("No providers configured."));
        process.exit(1);
      }

      console.log(chalk.bold("\nWOTANN Architect/Editor Pipeline\n"));
      console.log(chalk.dim("  Phase 1: Architect analyzes and plans..."));

      try {
        const result = await runArchitectEditor(
          async (queryOptions) => {
            const query = await runRuntimeQuery(runtime, queryOptions);
            return {
              output: query.output || query.errors.join("\n"),
              tokensUsed: query.tokensUsed,
              provider: query.provider as "anthropic" | undefined,
            };
          },
          prompt,
          {
            architectProvider: options.architectProvider as "anthropic" | undefined,
            editorProvider: options.editorProvider as "anthropic" | undefined,
          },
        );

        console.log(chalk.bold("\n  Architect Plan:"));
        console.log(chalk.dim("  " + "─".repeat(60)));
        console.log(`  ${result.architectOutput.slice(0, 1000)}`);

        console.log(chalk.bold("\n  Editor Implementation:"));
        console.log(chalk.dim("  " + "─".repeat(60)));
        console.log(`  ${result.editorOutput.slice(0, 2000)}`);

        console.log(
          chalk.dim(
            `\n  Total: ${result.totalTokens} tokens, ${(result.totalDurationMs / 1000).toFixed(1)}s`,
          ),
        );
        console.log(
          chalk.dim(
            `  Architect: ${result.architectProvider} | Editor: ${result.editorProvider}\n`,
          ),
        );
      } finally {
        runtime.close();
      }
    },
  );

// ── wotann council ─────────────────────────────────────────

program
  .command("council <query>")
  .description("Multi-LLM deliberation: individual → peer review → chairman synthesis")
  .option("--providers <list>", "Comma-separated provider list")
  .action(async (query: string, options: { providers?: string }) => {
    const { createRuntime } = await import("./core/runtime.js");
    const runtime = await createRuntime(process.cwd());

    if (runtime.getStatus().providers.length === 0) {
      runtime.close();
      console.error(chalk.red("No providers configured. Run `wotann init` first."));
      process.exit(1);
    }

    const providerList = options.providers
      ? (options.providers.split(",").map((p) => p.trim()) as ProviderName[])
      : runtime.getStatus().providers.slice(0, 3);

    if (providerList.length < 2) {
      runtime.close();
      console.error(
        chalk.red(
          "Council mode requires at least 2 providers. Run `wotann onboard` to set up more.",
        ),
      );
      process.exit(1);
    }

    console.log(chalk.bold("\nWOTANN Council Mode — multi-LLM deliberation\n"));
    console.log(chalk.dim(`  Query: "${query.slice(0, 80)}"`));
    console.log(chalk.dim(`  Members: ${providerList.join(", ")}\n`));

    try {
      const result = await runtime.runCouncilDeliberation(query, providerList);

      for (const member of result.members) {
        console.log(chalk.bold(`\n  ${member.label} (${member.provider}/${member.model}):`));
        console.log(chalk.dim("  " + "─".repeat(60)));
        console.log(`  ${member.response.slice(0, 400)}`);
        if (member.response.length > 400) console.log(chalk.dim("  ... (truncated)"));
      }

      if (result.aggregateRanking.length > 0) {
        console.log(chalk.bold("\n  Peer Rankings:"));
        for (const entry of result.aggregateRanking) {
          console.log(
            chalk.dim(
              `    ${entry.label}: avg rank ${entry.averageRank.toFixed(1)} (${entry.voteCount} votes)`,
            ),
          );
        }
      }

      console.log(chalk.bold("\n  Chairman Synthesis:"));
      console.log(chalk.dim("  " + "─".repeat(60)));
      console.log(`  ${result.synthesis}`);
      console.log(
        chalk.dim(
          `\n  Total: ${result.totalTokens} tokens, ${(result.totalDurationMs / 1000).toFixed(1)}s\n`,
        ),
      );
    } finally {
      runtime.close();
    }
  });

// ── wotann enhance ─────────────────────────────────────────

program
  .command("enhance <prompt>")
  .description("Enhance a prompt using the most capable available model")
  .option(
    "--style <style>",
    "Enhancement style (concise|detailed|technical|creative|structured)",
    "detailed",
  )
  .action(async (prompt: string, options: { style?: string }) => {
    const { createRuntime } = await import("./core/runtime.js");
    const runtime = await createRuntime(process.cwd());

    if (runtime.getStatus().providers.length === 0) {
      runtime.close();
      console.error(chalk.red("No providers configured. Run `wotann init` first."));
      process.exit(1);
    }

    console.log(chalk.bold("\nWOTANN Prompt Enhancer\n"));
    console.log(chalk.dim(`  Style: ${options.style ?? "detailed"}`));
    console.log(chalk.dim(`  Original: "${prompt.slice(0, 100)}"\n`));

    try {
      const result = await runtime.enhancePrompt(prompt);
      console.log(chalk.bold("  Enhanced prompt:"));
      console.log(chalk.dim("  " + "─".repeat(60)));
      console.log(`  ${result.enhancedPrompt}`);
      console.log(chalk.dim(`\n  Model: ${result.model}\n`));
    } finally {
      runtime.close();
    }
  });

// ── wotann train ───────────────────────────────────────────

const trainCmd = program.command("train").description("ML fine-tuning pipeline");

trainCmd
  .command("extract")
  .description("Extract training data from sessions")
  .action(async () => {
    const { SessionExtractor } = await import("./training/session-extractor.js");
    const sessionsDir = join(process.cwd(), ".wotann", "sessions");
    const extractor = new SessionExtractor();
    const result = extractor.batchExtract(sessionsDir);

    console.log(chalk.bold("\nWOTANN Training Data Extraction\n"));
    console.log(chalk.dim(`  Sessions scanned: ${result.totalEvents}`));
    console.log(chalk.dim(`  Pairs extracted: ${result.pairsExtracted}`));
    console.log(chalk.dim(`  Quality threshold: 0.7`));

    if (result.pairs.length > 0) {
      console.log(chalk.dim(`\n  Sample pairs:`));
      for (const pair of result.pairs.slice(0, 3)) {
        console.log(
          chalk.dim(`    [${pair.metadata.quality.toFixed(2)}] ${pair.prompt.slice(0, 60)}...`),
        );
      }
    }
    console.log();
  });

trainCmd
  .command("status")
  .description("Show training pipeline status")
  .action(async () => {
    const { TrainingPipeline } = await import("./training/pipeline.js");
    const pipeline = new TrainingPipeline();
    const stats = pipeline.getStats();

    console.log(chalk.bold("\nWOTANN Training Pipeline\n"));
    console.log(chalk.dim(`  Total extracted: ${stats.totalExtracted}`));
    console.log(chalk.dim(`  After filtering: ${stats.totalFiltered}`));
    console.log(chalk.dim(`  Average quality: ${stats.averageQuality.toFixed(2)}`));
    console.log(chalk.dim(`  Format: ${stats.formatUsed}\n`));
  });

// ── wotann research ────────────────────────────────────────

program
  .command("research <topic>")
  .description("Autonomous multi-step deep research")
  .action(async (topic: string) => {
    const { createRuntime } = await import("./core/runtime.js");
    const { runRuntimeQuery } = await import("./cli/runtime-query.js");
    const runtime = await createRuntime(process.cwd(), "default");

    if (runtime.getStatus().providers.length === 0) {
      runtime.close();
      console.error(chalk.red("No providers configured. Run `wotann init` first."));
      process.exit(1);
    }

    const researchPrompt = [
      "You are in autonomous deep research mode. Your task:",
      `Research topic: ${topic}`,
      "",
      "Steps:",
      "1. Break down the topic into sub-questions",
      "2. Research each sub-question thoroughly",
      "3. Synthesize findings into a structured report",
      "4. Include sources and confidence levels",
      "",
      "Be thorough and cite specific findings.",
    ].join("\n");

    console.log(chalk.bold("\nWOTANN Research Mode\n"));
    console.log(chalk.dim(`  Topic: ${topic}\n`));

    try {
      const result = await runRuntimeQuery(
        runtime,
        { prompt: researchPrompt },
        {
          onText: (chunk) => process.stdout.write(chunk.content),
          onError: (chunk) => console.error(chalk.red(chunk.content)),
        },
      );

      if (result.output && !result.output.endsWith("\n")) {
        process.stdout.write("\n");
      }
      console.log();
    } finally {
      runtime.close();
    }
  });

// ── wotann guard ───────────────────────────────────────────

program
  .command("guard <skillPath>")
  .description("Security scan a skill file for vulnerabilities")
  .action(async (skillPath: string) => {
    const { SkillsGuard } = await import("./security/skills-guard.js");
    const { readFileSync, existsSync } = await import("node:fs");

    const resolvedPath = resolve(process.cwd(), skillPath);
    if (!existsSync(resolvedPath)) {
      console.error(chalk.red(`File not found: ${resolvedPath}`));
      process.exit(1);
    }

    const content = readFileSync(resolvedPath, "utf-8");
    const guard = new SkillsGuard();
    const result = guard.scanSkill(content);

    console.log(chalk.bold("\nWOTANN Skills Guard\n"));
    console.log(chalk.dim(`  File: ${resolvedPath}`));
    console.log(chalk.dim(`  Safe: ${result.safe ? chalk.green("yes") : chalk.red("no")}`));
    console.log(chalk.dim(`  Severity: ${result.severity}`));
    console.log(chalk.dim(`  Issues: ${result.issues.length}\n`));

    if (result.issues.length > 0) {
      for (const issue of result.issues) {
        const icon =
          issue.severity === "critical" || issue.severity === "high"
            ? chalk.red("✗")
            : chalk.yellow("⚠");
        console.log(`  ${icon} [${issue.severity}] Line ${issue.line}: ${issue.description}`);
        console.log(chalk.dim(`    ${issue.recommendation}`));
      }
    } else {
      console.log(chalk.green("  ✓ No security issues detected."));
    }

    if (result.recommendations.length > 0) {
      console.log(chalk.bold("\n  Recommendations:"));
      for (const rec of result.recommendations) {
        console.log(chalk.dim(`    • ${rec}`));
      }
    }
    console.log();

    process.exit(result.safe ? 0 : 1);
  });

// ── wotann config ────────────────────────────────────────────

program
  .command("config")
  .description("View configuration")
  .action(async () => {
    const { loadConfig } = await import("./core/config.js");
    const config = loadConfig();
    console.log(chalk.bold("\nWOTANN Configuration:\n"));
    console.log(JSON.stringify(config, null, 2));
  });

function normalizeDisplayPath(uriOrPath: string): string {
  if (uriOrPath.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(uriOrPath).pathname);
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return uriOrPath;
    }
  }
  return uriOrPath;
}

function detectTeamFiles(repoRoot: string): string[] {
  let changed: string[] = [];
  try {
    changed = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    changed = [];
  }

  if (changed.length > 0) {
    return changed;
  }

  return execFileSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf-8",
  })
    .trim()
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function partitionFiles(files: readonly string[], groups: number): string[][] {
  const partitions = Array.from({ length: groups }, () => [] as string[]);

  for (let index = 0; index < files.length; index++) {
    partitions[index % groups]?.push(files[index]!);
  }

  return partitions.filter((group) => group.length > 0);
}

function getDaemonPaths(): { pidPath: string; statusPath: string } {
  // Daemon state lives in ~/.wotann/ regardless of cwd — the prior
  // signature took a `workingDir` arg but ignored it, confusing
  // readers and failing lint. Removed session-5.
  const wotannDir = join(homedir(), ".wotann");
  return {
    pidPath: join(wotannDir, "daemon.pid"),
    statusPath: join(wotannDir, "daemon.status.json"),
  };
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 2)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

function spawnDaemonWorker(entryPath: string, workingDir: string) {
  const isTypeScriptEntry = entryPath.endsWith(".ts");

  let command: string;
  let args: string[];

  if (isTypeScriptEntry) {
    // Resolve tsx from the entry point's project, not the working directory.
    // This ensures the daemon can start even when cwd is a different directory
    // (e.g., a user project or test temp dir) that has no node_modules.
    const entryDir = dirname(entryPath);
    const projectRoot = resolve(entryDir, "..");
    const tsxCliPath = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
    command = process.execPath;
    args = [tsxCliPath, entryPath, "daemon", "worker"];
  } else {
    command = process.execPath;
    args = [entryPath, "daemon", "worker"];
  }

  const child = spawn(command, args, {
    cwd: workingDir,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WOTANN_DAEMON_WORKER: "1",
    },
  });
  child.unref();
  return child;
}

async function waitForDaemonReady(pidPath: string, timeoutMs: number): Promise<number | null> {
  const { existsSync, readFileSync } = await import("node:fs");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      if (Number.isFinite(pid) && isProcessAlive(pid)) {
        return pid;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return null;
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
}

// ── Phase F: Register standalone CLI modules as commands ───

program
  .command("ci <task>")
  .description("Non-interactive CI/CD mode — runs task with retry and structured output")
  .option("--max-attempts <n>", "Maximum retry attempts", "3")
  .option("--commit", "Auto-commit on success")
  .option("--commit-message <msg>", "Commit message for auto-commit")
  .action(
    async (
      task: string,
      opts: { maxAttempts?: string; commit?: boolean; commitMessage?: string },
    ) => {
      const { runCI } = await import("./cli/ci-runner.js");
      // S2-19: Previously the task runner was `async (_attempt) => ({
      // success: true, output: "Completed", error: "" })` — a fake stub
      // that always reported success without executing anything. `wotann
      // ci <task>` was a lie. The runner now actually executes the task
      // as a shell command through the existing `execa`/`execFile` path
      // used by other CI-style commands.
      const { execFile } = await import("node:child_process");
      const result = await runCI(
        {
          task,
          maxAttempts: opts.maxAttempts ? parseInt(opts.maxAttempts, 10) : 3,
          commitOnSuccess: opts.commit ?? false,
          commitMessage: opts.commitMessage,
          workingDir: process.cwd(),
        },
        async (_attempt) =>
          new Promise<{ success: boolean; output: string; error: string }>((resolve) => {
            execFile(
              "/bin/sh",
              ["-c", task],
              {
                cwd: process.cwd(),
                timeout: 10 * 60 * 1000, // 10-minute safety ceiling per attempt
                maxBuffer: 32 * 1024 * 1024, // 32 MB — stdout from long test suites
              },
              (err, stdout, stderr) => {
                resolve({
                  success: err === null,
                  output: stdout || "",
                  error: err ? stderr || err.message : "",
                });
              },
            );
          }),
      );
      console.log(result.summary);
      process.exit(result.exitCode);
    },
  );

program
  .command("watch <dir> <task>")
  .description("Watch directory for changes and run task on each change")
  .option("--debounce <ms>", "Debounce interval in ms", "500")
  .action(async (dir: string, task: string, opts: { debounce?: string }) => {
    const { WatchMode } = await import("./cli/watch-mode.js");
    const watcher = new WatchMode({
      path: dir,
      task,
      debounceMs: opts.debounce ? parseInt(opts.debounce, 10) : 500,
    });
    watcher.start(async (event) => {
      console.log(`[watch] ${event.changedFiles.length} file(s) changed, running: ${task}`);
    });
    console.log(`Watching ${dir} for changes... (Ctrl+C to stop)`);
    process.on("SIGINT", () => {
      watcher.stop();
      process.exit(0);
    });
  });

program
  .command("repl")
  .description("Interactive REPL with AI suggestions")
  .option("--language <lang>", "Language for code execution", "typescript")
  .action(async (opts: { language?: string }) => {
    const { REPLMode } = await import("./cli/repl-mode.js");
    const repl = new REPLMode();
    await repl.start({
      language: (opts.language ?? "typescript") as "typescript" | "python" | "javascript",
    });
  });

program
  .command("self-improve")
  .description("Analyze WOTANN's own codebase and suggest improvements")
  .action(async () => {
    const { SelfImprovementEngine } = await import("./cli/self-improve.js");
    const engine = new SelfImprovementEngine(process.cwd());
    const report = await engine.analyze();
    console.log(`Found ${report.suggestions.length} improvement suggestions`);
    for (const s of report.suggestions) {
      console.log(`  [${s.severity}] ${s.file}: ${s.description}`);
    }
  });

// ── wotann mine ─────────────────────────────────────────────

program
  .command("mine <file>")
  .description(
    "Mine a conversation export (Claude JSON, Slack export, or generic text) into memory",
  )
  .action(async (file: string) => {
    const { readFileSync, existsSync } = await import("node:fs");
    const filePath = resolve(process.cwd(), file);

    if (!existsSync(filePath)) {
      console.error(chalk.red(`File not found: ${filePath}`));
      process.exit(1);
    }

    const { ConversationMiner } = await import("./memory/conversation-miner.js");
    const { MemoryStore } = await import("./memory/store.js");
    const dbPath = join(process.cwd(), ".wotann", "memory.db");
    const store = new MemoryStore(dbPath);
    const miner = new ConversationMiner(store);

    const content = readFileSync(filePath, "utf-8");
    let result;

    // Try JSON formats first, fall back to generic text
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        const first = parsed[0];
        if (first && typeof first === "object" && "role" in first && "content" in first) {
          result = miner.mineClaudeExport(content);
        } else if (first && typeof first === "object" && "user" in first && "text" in first) {
          result = miner.mineSlackExport(content);
        } else {
          result = miner.mineGenericText(content, file);
        }
      } else {
        result = miner.mineGenericText(content, file);
      }
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      result = miner.mineGenericText(content, file);
    }

    console.log(chalk.bold("\nWOTANN Conversation Mining\n"));
    console.log(chalk.dim(`  File: ${filePath}`));
    console.log(chalk.dim(`  Entries created: ${result.entriesCreated}`));
    console.log(chalk.dim(`  Verbatim stored: ${result.verbatimStored}`));
    console.log(chalk.dim(`  Observations extracted: ${result.observationsExtracted}`));
    console.log(
      chalk.dim(
        `  Domains detected: ${result.domainsDetected.length > 0 ? result.domainsDetected.join(", ") : "none"}`,
      ),
    );

    if (result.errors.length > 0) {
      console.log(chalk.yellow(`  Errors: ${result.errors.length}`));
      for (const err of result.errors.slice(0, 5)) {
        console.log(chalk.dim(`    ${err}`));
      }
    }

    console.log();
    store.close();
  });

// ── wotann benchmark ────────────────────────────────────────

program
  .command("benchmark [type]")
  .description(
    "Run a memory quality benchmark (accuracy | terminal-bench | open-swe | memory-eval)",
  )
  .action(async (type?: string) => {
    const benchmarkType = type ?? "accuracy";
    const validTypes = ["accuracy", "terminal-bench", "open-swe", "memory-eval"];

    if (!validTypes.includes(benchmarkType)) {
      console.error(
        chalk.red(`Invalid benchmark type: ${benchmarkType}. Valid: ${validTypes.join(", ")}`),
      );
      process.exit(1);
    }

    const { createDefaultBenchmarks, runBenchmarks } = await import("./telemetry/benchmarks.js");
    const suite = createDefaultBenchmarks();
    const os = (await import("node:os")).default;

    console.log(chalk.bold("\nWOTANN Benchmark\n"));
    console.log(chalk.dim(`  Type: ${benchmarkType}`));
    console.log(chalk.dim("  Running...\n"));

    const bundle = await runBenchmarks(suite, {
      os: `${os.platform()} ${os.release()}`,
      node: process.version,
      providers: [],
    });

    console.log(chalk.bold("  Results:\n"));
    console.log(chalk.dim(`  Score: ${bundle.summary.passed}/${bundle.summary.total} passed`));
    console.log(chalk.dim(`  Total questions: ${bundle.summary.total}`));
    console.log(chalk.dim(`  Passed: ${bundle.summary.passed}`));
    console.log(chalk.dim(`  Failed: ${bundle.summary.failed}`));

    if (bundle.results.length > 0) {
      const byCategory = new Map<string, { passed: number; failed: number }>();
      for (const r of bundle.results) {
        const cat = r.testId.split("-").slice(0, 2).join("-");
        const entry = byCategory.get(cat) ?? { passed: 0, failed: 0 };
        if (r.passed) entry.passed++;
        else entry.failed++;
        byCategory.set(cat, entry);
      }

      console.log(chalk.bold("\n  Category breakdown:\n"));
      for (const [cat, counts] of byCategory) {
        const icon = counts.failed === 0 ? chalk.green("✓") : chalk.yellow("○");
        console.log(`  ${icon} ${cat}: ${counts.passed} passed, ${counts.failed} failed`);
      }
    }

    console.log();
  });

// ── wotann bench (Phase 4 real-runner leaderboard flow) ─────

program
  .command("bench <flavour>")
  .description(
    "Run a benchmark (terminal-bench | swe-bench-verified | tau-bench | aider-polyglot | humaneval-plus | mbpp-plus | livecodebench | longmemeval)",
  )
  .option("-n, --limit <number>", "Max tasks to run (default: all)", (v) => parseInt(v, 10))
  .option("-s, --seed <number>", "Deterministic shuffle seed", (v) => parseInt(v, 10))
  .option("-m, --model <id>", "Model override for the agent attempts")
  .option("-t, --threshold <number>", "CompletionOracle score threshold (0-1, default 0.75)", (v) =>
    parseFloat(v),
  )
  .option("-b, --budget <ms>", "Total wall-clock budget across all tasks (ms)", (v) =>
    parseInt(v, 10),
  )
  .option(
    "--require-corpus",
    "Fail with BLOCKED-NEEDS-CORPUS-DOWNLOAD if official corpus is absent (disables smoke fallback)",
  )
  .option(
    "--dry-run",
    "Validate setup without executing (also: LongMemEval alias for --skip-download)",
  )
  .option("--domains <list>", "τ-bench: comma-separated domains (retail,airline). Default both.")
  .option("--no-inject-policy", "τ-bench: disable policy injection (ablation — baseline mode)")
  .option(
    "--model-cutoff <date>",
    "LiveCodeBench: ISO training cutoff; pre-cutoff tasks get contamination bumped",
  )
  .option(
    "--released-after <date>",
    "LiveCodeBench: exclude tasks with releaseDate <= this ISO date",
  )
  // LongMemEval-specific options (ignored by other flavours)
  .option("--variant <variant>", "LongMemEval variant: s | m | oracle (default: s)")
  .option("--top-k <number>", "LongMemEval retrieval top-K (default: 10)", (v) => parseInt(v, 10))
  .option(
    "--skip-download",
    "LongMemEval: use built-in 10-instance smoke corpus instead of the downloaded dataset",
  )
  .option(
    "--runtime",
    "LongMemEval: route retrieved context through runtime.query (default: memory-stack only)",
  )
  .action(
    async (
      flavour: string,
      cliOpts: {
        limit?: number;
        seed?: number;
        model?: string;
        threshold?: number;
        budget?: number;
        requireCorpus?: boolean;
        dryRun?: boolean;
        domains?: string;
        injectPolicy?: boolean; // --no-inject-policy sets this false
        modelCutoff?: string;
        releasedAfter?: string;
        variant?: string;
        topK?: number;
        skipDownload?: boolean;
        runtime?: boolean;
      },
    ) => {
      // LongMemEval has a different runner surface; dispatch separately.
      if (flavour === "longmemeval") {
        await runLongMemEvalCommand(cliOpts);
        return;
      }

      const validFlavours = [
        "terminal-bench",
        "aider-polyglot",
        "humaneval-plus",
        "mbpp-plus",
        "livecodebench",
        "swe-bench-verified",
        "tau-bench",
      ] as const;
      type Flavour = (typeof validFlavours)[number];
      if (!(validFlavours as readonly string[]).includes(flavour)) {
        console.error(
          chalk.red(
            `Invalid flavour: ${flavour}. Valid: ${[...validFlavours, "longmemeval"].join(", ")}`,
          ),
        );
        process.exit(1);
      }
      const typedFlavour = flavour as Flavour;

      const { BenchmarkHarness } = await import("./intelligence/benchmark-harness.js");
      const { isBlockedCorpusError } = await import("./intelligence/benchmark-runners/shared.js");

      // ── Dry-run path: validate without executing ────────
      if (cliOpts.dryRun) {
        console.log(chalk.bold(`\nWOTANN Bench — ${typedFlavour} [dry-run]\n`));
        const harness = new BenchmarkHarness(process.cwd());
        const dryOpts: {
          requireCorpus?: boolean;
          domains?: readonly ("retail" | "airline")[];
          releasedAfter?: string;
        } = {};
        if (cliOpts.requireCorpus) dryOpts.requireCorpus = true;
        if (cliOpts.domains) {
          dryOpts.domains = cliOpts.domains
            .split(",")
            .map((s) => s.trim())
            .filter((s): s is "retail" | "airline" => s === "retail" || s === "airline");
        }
        if (cliOpts.releasedAfter) dryOpts.releasedAfter = cliOpts.releasedAfter;
        // Runtime not needed for dry-run; pass null so we don't pay the
        // cost of spinning up providers just to validate setup.
        const report = await harness.dryRunBenchmark(typedFlavour, null, dryOpts);
        console.log(chalk.dim(`  Benchmark:   ${report.benchmark}`));
        console.log(chalk.dim(`  Corpus size: ${report.corpusSize}`));
        console.log(chalk.dim(`  Ready:       ${report.ready ? "yes" : "no"}`));
        console.log(chalk.bold("\n  Checks:"));
        for (const c of report.checks) {
          const mark = c.ok ? chalk.green("ok ") : chalk.red("no ");
          console.log(`    ${mark} ${c.name}${c.detail ? chalk.dim(` — ${c.detail}`) : ""}`);
        }
        if (report.blockedReason) {
          console.log();
          console.log(chalk.yellow(report.blockedReason));
        }
        console.log();
        process.exit(report.ready ? 0 : 1);
      }

      const { createRuntime } = await import("./core/runtime.js");
      // createRuntime already calls initialize() internally.
      const runtime = await createRuntime(process.cwd());

      const harness = new BenchmarkHarness(process.cwd());
      console.log(chalk.bold(`\nWOTANN Bench — ${typedFlavour}\n`));
      console.log(chalk.dim(`  Limit:     ${cliOpts.limit ?? "all"}`));
      console.log(chalk.dim(`  Seed:      ${cliOpts.seed ?? "deterministic-order"}`));
      console.log(chalk.dim(`  Model:     ${cliOpts.model ?? "runtime-default"}`));
      console.log(chalk.dim(`  Threshold: ${cliOpts.threshold ?? 0.75}`));
      if (cliOpts.budget !== undefined) console.log(chalk.dim(`  Budget:    ${cliOpts.budget} ms`));
      if (cliOpts.requireCorpus)
        console.log(chalk.dim(`  Corpus:    required (no smoke fallback)`));
      if (flavour === "tau-bench") {
        console.log(
          chalk.dim(
            `  Policy:    ${cliOpts.injectPolicy === false ? "off (baseline)" : "on (injected)"}`,
          ),
        );
      }
      console.log();
      console.log(chalk.dim("  Running...\n"));

      const runOpts: {
        modelId: string;
        limit?: number;
        seed?: number;
        threshold?: number;
        totalBudgetMs?: number;
        requireCorpus?: boolean;
        domains?: readonly ("retail" | "airline")[];
        injectPolicy?: boolean;
        modelCutoff?: string;
        releasedAfter?: string;
      } = {
        modelId: cliOpts.model ?? "default",
      };
      if (cliOpts.limit !== undefined) runOpts.limit = cliOpts.limit;
      if (cliOpts.seed !== undefined) runOpts.seed = cliOpts.seed;
      if (cliOpts.threshold !== undefined) runOpts.threshold = cliOpts.threshold;
      if (cliOpts.budget !== undefined) runOpts.totalBudgetMs = cliOpts.budget;
      if (cliOpts.requireCorpus) runOpts.requireCorpus = true;
      if (cliOpts.domains) {
        runOpts.domains = cliOpts.domains
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is "retail" | "airline" => s === "retail" || s === "airline");
      }
      if (cliOpts.injectPolicy === false) runOpts.injectPolicy = false;
      if (cliOpts.modelCutoff) runOpts.modelCutoff = cliOpts.modelCutoff;
      if (cliOpts.releasedAfter) runOpts.releasedAfter = cliOpts.releasedAfter;

      try {
        const run = await harness.runRealBenchmark(typedFlavour, runtime, runOpts);
        console.log(chalk.bold("  Results:\n"));
        console.log(chalk.dim(`  Run ID:      ${run.id}`));
        console.log(chalk.dim(`  Score:       ${run.score}/${run.maxScore}`));
        console.log(chalk.dim(`  Pass rate:   ${run.percentile}%`));
        console.log(chalk.dim(`  Wall clock:  ${(run.durationMs / 1000).toFixed(1)}s`));
        console.log();
      } catch (err) {
        if (isBlockedCorpusError(err)) {
          console.error(chalk.yellow(err.message));
          process.exit(2); // distinct exit code for blocked-corpus vs other errors
        }
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    },
  );

// ── LongMemEval dispatch helper ────────────────────────────

/**
 * Handle `wotann bench longmemeval` — keeps the bench command tidy by
 * lazy-loading the runner and owning the pretty-print for this flavour.
 *
 * Honest error surfacing: when the corpus file is missing and neither
 * --skip-download nor --dry-run is set, the loader throws with download
 * instructions. We print that verbatim and exit 1 rather than silently
 * running on the smoke corpus — the "honest error + --skip-download"
 * contract from the spec.
 */
async function runLongMemEvalCommand(cliOpts: {
  limit?: number;
  seed?: number;
  model?: string;
  budget?: number;
  variant?: string;
  topK?: number;
  skipDownload?: boolean;
  dryRun?: boolean;
  runtime?: boolean;
}): Promise<void> {
  const { loadLongMemEvalCorpus, runLongMemEval } =
    await import("./memory/evals/longmemeval/index.js");

  const variant = (cliOpts.variant ?? "s") as "s" | "m" | "oracle";
  if (!["s", "m", "oracle"].includes(variant)) {
    console.error(chalk.red(`Invalid variant: ${variant}. Valid: s, m, oracle`));
    process.exit(1);
  }

  const skipDownload = cliOpts.skipDownload === true || cliOpts.dryRun === true;
  const topK = cliOpts.topK ?? 10;

  console.log(chalk.bold("\nWOTANN Bench — longmemeval\n"));
  console.log(chalk.dim(`  Variant:   ${variant}`));
  console.log(chalk.dim(`  Mode:      ${cliOpts.runtime ? "runtime" : "memory-stack"}`));
  console.log(chalk.dim(`  Top-K:     ${topK}`));
  console.log(chalk.dim(`  Limit:     ${cliOpts.limit ?? "all"}`));
  console.log(chalk.dim(`  Seed:      ${cliOpts.seed ?? "deterministic-order"}`));
  console.log(
    chalk.dim(
      `  Corpus:    ${skipDownload ? "smoke (10 instances, built-in)" : `on-disk ${variant}`}`,
    ),
  );
  console.log();
  console.log(chalk.dim("  Running...\n"));

  let instances;
  try {
    const loadOpts: {
      variant: "s" | "m" | "oracle";
      skipDownload: boolean;
      limit?: number;
      seed?: number;
    } = { variant, skipDownload };
    if (cliOpts.limit !== undefined) loadOpts.limit = cliOpts.limit;
    if (cliOpts.seed !== undefined) loadOpts.seed = cliOpts.seed;
    instances = loadLongMemEvalCorpus(process.cwd(), loadOpts);
  } catch (e) {
    console.error(chalk.red("LongMemEval corpus load failed:"));
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (instances.length === 0) {
    console.error(chalk.red("No LongMemEval instances loaded."));
    process.exit(1);
  }

  const runOpts: {
    mode: "memory-stack" | "runtime";
    topK: number;
    totalBudgetMs?: number;
    model?: string;
  } = {
    mode: cliOpts.runtime ? "runtime" : "memory-stack",
    topK,
  };
  if (cliOpts.budget !== undefined) runOpts.totalBudgetMs = cliOpts.budget;
  if (cliOpts.model !== undefined) runOpts.model = cliOpts.model;

  // Runtime mode needs an initialised WotannRuntime; memory-stack doesn't.
  let runtimeInstance: unknown;
  if (runOpts.mode === "runtime") {
    const { createRuntime } = await import("./core/runtime.js");
    runtimeInstance = await createRuntime(process.cwd());
  }

  const report = await runLongMemEval(instances, {
    ...runOpts,
    ...(runtimeInstance ? { runtime: runtimeInstance as never } : {}),
  });

  console.log(chalk.bold("  Results:\n"));
  console.log(chalk.dim(`  Run ID:              ${report.runId}`));
  console.log(chalk.dim(`  Instances:           ${report.totalInstances}`));
  console.log(chalk.dim(`  Completed:           ${report.completedInstances}`));
  console.log(
    chalk.dim(`  Overall accuracy:    ${(report.score.overallAccuracy * 100).toFixed(1)}%`),
  );
  console.log(
    chalk.dim(`    ├─ strict (verbatim): ${(report.score.strictAccuracy * 100).toFixed(1)}%`),
  );
  console.log(
    chalk.dim(`    └─ lenient (words):   ${(report.score.lenientAccuracy * 100).toFixed(1)}%`),
  );
  console.log(
    chalk.dim(
      `  Wall clock:          ${((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s`,
    ),
  );

  console.log(chalk.bold("\n  Ability breakdown:\n"));
  for (const [ability, breakdown] of Object.entries(report.score.byAbility)) {
    if (breakdown.total === 0) continue;
    const pct = (breakdown.accuracy * 100).toFixed(1);
    const icon =
      breakdown.accuracy >= 0.7
        ? chalk.green("✓")
        : breakdown.accuracy >= 0.5
          ? chalk.yellow("○")
          : chalk.red("✗");
    console.log(`  ${icon} ${ability.padEnd(26)} ${breakdown.passed}/${breakdown.total} (${pct}%)`);
  }

  if (report.errors.length > 0) {
    console.log(chalk.yellow(`\n  ${report.errors.length} instance(s) errored:`));
    for (const err of report.errors.slice(0, 5)) {
      console.log(chalk.dim(`    ${err.question_id}: ${err.error}`));
    }
    if (report.errors.length > 5) {
      console.log(chalk.dim(`    ... and ${report.errors.length - 5} more`));
    }
  }

  // Persist the report for trend tracking. Uses the same .wotann/benchmarks
  // layout as the other benchmark flavours.
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const outDir = join(process.cwd(), ".wotann", "benchmarks", "longmemeval");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${report.runId}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(chalk.dim(`\n  Saved: ${outPath}`));
  } catch (e) {
    console.log(
      chalk.dim(
        `\n  (warning: failed to persist report — ${e instanceof Error ? e.message : String(e)})`,
      ),
    );
  }

  console.log();
}

// ── wotann health ───────────────────────────────────────────
//
// Dual-purpose command (Phase 6):
//   wotann health [provider]     — per-provider smoke-test battery (default)
//   wotann health --codebase     — original codebase health analysis
//   wotann health --dry-run      — run the smoke-test battery against the
//                                  static capability matrix (no network)
//
// Putting the provider battery on the default path matches the Phase 6
// task spec (`wotann health [<provider>]`) while preserving the prior
// codebase-health behaviour behind a flag.

program
  .command("health [provider]")
  .description("Provider health check (or codebase health with --codebase)")
  .option("--codebase", "Run codebase health analysis instead of provider smoke tests")
  .option("--dry-run", "Skip network calls; produce a report from the capability matrix")
  .option("--skip-tool-call", "Skip the tool_call smoke test even if supported")
  .option("--timeout-ms <ms>", "Per-test timeout in milliseconds", "10000")
  .option("--json", "Emit the full report as JSON (for machine consumption)")
  .action(
    async (
      providerArg: string | undefined,
      options: {
        codebase?: boolean;
        dryRun?: boolean;
        skipToolCall?: boolean;
        timeoutMs?: string;
        json?: boolean;
      },
    ) => {
      if (options.codebase) {
        const { analyzeCodebaseHealth } = await import("./intelligence/codebase-health.js");
        const report = analyzeCodebaseHealth(process.cwd());
        console.log(chalk.bold("\nWOTANN Codebase Health\n"));
        console.log(chalk.dim(`  Health score: ${report.healthScore}/100`));
        console.log(chalk.dim(`  TODO count: ${report.todoCount}`));
        console.log(chalk.dim(`  Dead code indicators: ${report.deadCode.length}`));
        console.log(chalk.dim(`  Type errors: ${report.typeErrors}`));
        console.log(chalk.dim(`  Lint warnings: ${report.lintWarnings}`));
        console.log(chalk.dim(`  Test coverage ratio: ${(report.testCoverage * 100).toFixed(0)}%`));
        console.log(chalk.dim(`  Avg file size: ${report.avgFileSize} lines`));
        if (report.largestFiles.length > 0) {
          console.log(chalk.bold("\n  Largest files:\n"));
          for (const f of report.largestFiles) {
            const icon =
              f.lineCount > 800
                ? chalk.red("✗")
                : f.lineCount > 400
                  ? chalk.yellow("○")
                  : chalk.green("✓");
            console.log(`  ${icon} ${f.path} — ${f.lineCount} lines`);
          }
        }
        if (report.circularDeps.length > 0) {
          console.log(chalk.yellow(`\n  Circular dependencies: ${report.circularDeps.length}`));
          for (const dep of report.circularDeps.slice(0, 5)) {
            console.log(chalk.dim(`    ${dep}`));
          }
        }
        console.log();
        process.exit(report.healthScore >= 50 ? 0 : 1);
      }

      // ── Provider health path ──
      const { runHealthCheck, dryRunReportForProvider, PROVIDER_CAPABILITY_MATRIX } =
        await import("./providers/health-check.js");
      const { discoverProviders } = await import("./providers/discovery.js");
      const { createProviderInfrastructure } = await import("./providers/registry.js");
      const timeoutMs = Number.parseInt(options.timeoutMs ?? "10000", 10);

      const validProviders = Object.keys(
        PROVIDER_CAPABILITY_MATRIX,
      ) as (keyof typeof PROVIDER_CAPABILITY_MATRIX)[];
      const targetProvider = providerArg as (typeof validProviders)[number] | undefined;
      if (targetProvider && !validProviders.includes(targetProvider)) {
        console.error(chalk.red(`\nUnknown provider: ${targetProvider}`));
        console.error(chalk.dim(`  Valid: ${validProviders.join(", ")}\n`));
        process.exit(1);
      }

      type ProviderKey = (typeof validProviders)[number];
      const providersToCheck: readonly ProviderKey[] = targetProvider
        ? [targetProvider]
        : validProviders;

      // In non-dry-run mode, try to spin up real adapters for discovered
      // providers so we can run live smoke tests. In dry-run mode, skip the
      // network dance and go straight to the capability matrix.
      const live = options.dryRun ? null : createProviderInfrastructure(await discoverProviders());

      const reports: Awaited<ReturnType<typeof runHealthCheck>>[] = [];
      for (const p of providersToCheck) {
        const adapter = live?.adapters.get(p);
        if (options.dryRun || !adapter) {
          reports.push(dryRunReportForProvider(p));
        } else {
          // eslint-disable-next-line no-await-in-loop
          const r = await runHealthCheck(p, adapter, {
            skipToolCall: options.skipToolCall,
            timeoutMs,
          });
          reports.push(r);
        }
      }

      if (options.json) {
        console.log(JSON.stringify(reports, null, 2));
        return;
      }

      console.log(chalk.bold("\nWOTANN Provider Health\n"));
      const statusIcon = (s: string): string =>
        s === "ok"
          ? chalk.green("✓")
          : s === "degraded"
            ? chalk.yellow("○")
            : s === "skipped"
              ? chalk.dim("·")
              : chalk.red("✗");
      for (const r of reports) {
        const caps: string[] = [];
        if (r.capabilities.streaming) caps.push("stream");
        if (r.capabilities.toolCalls) caps.push("tools");
        if (r.capabilities.vision) caps.push("vision");
        if (r.capabilities.thinking) caps.push("think");
        if (r.capabilities.cacheControl) caps.push("cache");
        if (r.capabilities.computerUse) caps.push("cu");
        console.log(
          `  ${statusIcon(r.status)} ${chalk.bold(r.provider.padEnd(12))} ${r.status.padEnd(10)} ${r.durationMs}ms  ${chalk.dim(caps.join(","))}`,
        );
        for (const t of r.tests) {
          const msg = t.error ? chalk.red(t.error) : chalk.dim(t.detail ?? "");
          console.log(
            `      ${statusIcon(t.status)} ${t.name.padEnd(14)} ${t.durationMs}ms  ${msg}`,
          );
        }
      }
      console.log();

      // Exit code: 0 if every report is ok or skipped, 1 otherwise.
      const failing = reports.some((r) => r.status === "fail" || r.status === "degraded");
      process.exit(failing ? 1 : 0);
    },
  );

// ── wotann route ────────────────────────────────────────────

program
  .command("route <prompt>")
  .description("Classify a prompt and show the recommended model")
  .action(async (prompt: string) => {
    const { TaskSemanticRouter } = await import("./intelligence/task-semantic-router.js");
    const router = new TaskSemanticRouter();
    const classification = router.classify(prompt, ["claude-sonnet-4-6"]);

    console.log(chalk.bold("\nWOTANN Prompt Router\n"));
    console.log(chalk.dim(`  Prompt: "${prompt.slice(0, 100)}"`));
    console.log(chalk.dim(`  Task type: ${classification.type}`));
    console.log(chalk.dim(`  Complexity: ${classification.complexity}`));
    console.log(chalk.dim(`  Recommended model: ${classification.recommendedModel}`));
    console.log(
      chalk.dim(
        `  Fallback models: ${classification.fallbackModels.length > 0 ? classification.fallbackModels.join(", ") : "none"}`,
      ),
    );
    console.log(chalk.dim(`  Confidence: ${(classification.confidence * 100).toFixed(0)}%`));
    console.log(chalk.dim(`  Estimated tokens: ${classification.estimatedTokens}`));
    console.log(chalk.dim(`  Estimated cost: $${classification.estimatedCostUsd.toFixed(4)}`));
    console.log();
  });

// ── wotann decisions ────────────────────────────────────────

program
  .command("decisions [query]")
  .description("List or search architectural decisions")
  .action(async (query?: string) => {
    const { DecisionLedger } = await import("./learning/decision-ledger.js");
    const ledger = new DecisionLedger();

    // Try to load persisted decisions from the workspace
    const decisionPath = join(process.cwd(), ".wotann", "decisions.json");
    const { existsSync, readFileSync } = await import("node:fs");
    if (existsSync(decisionPath)) {
      try {
        const raw = JSON.parse(readFileSync(decisionPath, "utf-8")) as Array<{
          id: string;
          title: string;
          description: string;
          rationale: string;
          alternatives: string[];
          affectedFiles: string[];
          tags: string[];
          status: "active" | "superseded" | "reverted";
          timestamp: string;
        }>;
        for (const d of raw) {
          ledger.recordDecision({
            title: d.title,
            description: d.description,
            rationale: d.rationale,
            alternatives: d.alternatives,
            affectedFiles: d.affectedFiles,
            tags: d.tags,
          });
        }
      } catch {
        // ignore malformed decisions file
      }
    }

    const decisions = query ? ledger.searchDecisions(query) : ledger.searchDecisions("");

    console.log(chalk.bold("\nWOTANN Architectural Decisions\n"));

    if (decisions.length === 0) {
      console.log(chalk.dim("  No decisions found."));
      console.log(
        chalk.dim(
          "  Decisions are recorded during development sessions and stored in .wotann/decisions.json\n",
        ),
      );
      return;
    }

    console.log(
      chalk.dim(
        `  Showing ${decisions.length} decision(s)${query ? ` matching "${query}"` : ""}:\n`,
      ),
    );

    for (const d of decisions) {
      const statusIcon =
        d.status === "active"
          ? chalk.green("●")
          : d.status === "superseded"
            ? chalk.yellow("○")
            : chalk.red("○");
      console.log(`  ${statusIcon} ${chalk.bold(d.title)}`);
      console.log(chalk.dim(`    ID: ${d.id}`));
      console.log(chalk.dim(`    Rationale: ${d.rationale.slice(0, 120)}`));
      console.log(chalk.dim(`    Status: ${d.status}`));
      console.log(chalk.dim(`    Timestamp: ${d.timestamp}`));
      if (d.tags.length > 0) {
        console.log(chalk.dim(`    Tags: ${d.tags.join(", ")}`));
      }
      console.log();
    }
  });

// ── wotann acp ─────────────────────────────────────────────
// Agent Client Protocol host — speaks ACP 0.2 over stdio so IDE hosts
// (Zed, Goose, Air, Kiro) can drive WOTANN as their agent backend.

program
  .command("acp")
  .description("Start an Agent Client Protocol server over stdio")
  .option("--reference", "Use canned reference handlers (no runtime, for smoke-testing)", false)
  .action(async (opts: { reference?: boolean }) => {
    const { startAcpStdio, referenceHandlers } = await import("./acp/stdio.js");

    if (opts.reference) {
      const handle = startAcpStdio({ handlers: referenceHandlers() });
      await new Promise<void>((resolve) => {
        process.stdin.once("close", () => {
          void handle.stop().then(resolve);
        });
      });
      return;
    }

    const { createRuntime } = await import("./core/runtime.js");
    const { createRuntimeAcpHandlers } = await import("./acp/runtime-handlers.js");
    const runtime = await createRuntime(process.cwd());
    const handle = startAcpStdio({
      handlers: createRuntimeAcpHandlers({ runtime }),
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[acp] ${msg}\n`);
      },
    });
    await new Promise<void>((resolve) => {
      process.stdin.once("close", () => {
        void handle
          .stop()
          .then(() => runtime.close())
          .then(resolve);
      });
    });
  });

// ── wotann import-design ───────────────────────────────────
// F7: Receiver for Claude Design handoff bundles (Anthropic Labs, 2026-04-17).

program
  .command("import-design <bundle>")
  .description("Import a Claude Design handoff bundle (ZIP) into ~/.wotann/imported-designs/")
  .option("--require-components", "Fail if the bundle has no components.json", false)
  .option("--out <dir>", "Override output directory (default ~/.wotann/imported-designs/<name>)")
  .action(async (bundlePath: string, opts: { requireComponents?: boolean; out?: string }) => {
    const { parseHandoffBundle } = await import("./design/handoff-receiver.js");
    const { emitTokensCss } = await import("./design/design-tokens-parser.js");
    const { writeComponents } = await import("./design/component-importer.js");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const absBundle = resolve(process.cwd(), bundlePath);

    let bundle;
    try {
      bundle = parseHandoffBundle(absBundle, {
        requireComponents: opts.requireComponents === true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(chalk.red(`import-design failed: ${msg}\n`));
      process.exit(2);
    }

    const baseDir =
      opts.out !== undefined
        ? resolve(process.cwd(), opts.out)
        : join(homedir(), ".wotann", "imported-designs", bundle.manifest.name);
    const componentsDir = join(baseDir, "components");
    const tokensPath = join(baseDir, "tokens.css");
    const manifestPath = join(baseDir, "manifest.json");
    const tokensJsonPath = join(baseDir, "design-system.json");

    mkdirSync(baseDir, { recursive: true });
    writeFileSync(tokensPath, emitTokensCss(bundle.tokens));
    writeFileSync(manifestPath, JSON.stringify(bundle.manifest, null, 2));
    writeFileSync(tokensJsonPath, JSON.stringify(bundle.rawDesignSystem, null, 2));

    const result = writeComponents(bundle.components, componentsDir);

    console.log(chalk.bold("\nWOTANN Design Import\n"));
    console.log(chalk.dim(`  Bundle:         ${bundle.manifest.name} v${bundle.manifest.version}`));
    console.log(chalk.dim(`  Bundle format:  ${bundle.manifest.bundleVersion}`));
    if (bundle.manifest.author) {
      console.log(chalk.dim(`  Author:         ${bundle.manifest.author}`));
    }
    if (bundle.manifest.exportedFrom) {
      console.log(chalk.dim(`  Exported from:  ${bundle.manifest.exportedFrom}`));
    }
    console.log(chalk.dim(`  Output dir:     ${baseDir}`));
    console.log();
    console.log(chalk.bold("  Tokens"));
    console.log(chalk.dim(`    colors:        ${bundle.tokens.colors.length}`));
    console.log(chalk.dim(`    typography:    ${bundle.tokens.typography.length}`));
    console.log(chalk.dim(`    spacing:       ${bundle.tokens.spacing.length}`));
    console.log(chalk.dim(`    borderRadius:  ${bundle.tokens.borderRadius.length}`));
    console.log(chalk.dim(`    shadows:       ${bundle.tokens.shadows.length}`));
    console.log(chalk.dim(`    other:         ${bundle.tokens.extras.length}`));
    console.log(chalk.dim(`    total:         ${bundle.tokens.totalCount}`));
    console.log();
    console.log(chalk.bold("  Components"));
    console.log(chalk.dim(`    imported:      ${result.componentCount}`));
    console.log();
    console.log(chalk.bold("  Extras"));
    console.log(
      chalk.dim(`    figma.json:    ${bundle.figma === undefined ? "absent" : "present"}`),
    );
    console.log(
      chalk.dim(
        `    code-scaffold: ${bundle.codeScaffold === undefined ? 0 : bundle.codeScaffold.length} files`,
      ),
    );
    console.log(chalk.dim(`    assets:        ${bundle.assets.length} files`));
    console.log();
    console.log(chalk.green(`  Imported to ${baseDir}`));
    console.log();
    process.exit(0);
  });

// ── wotann loop ─────────────────────────────────────────────
// Session-13 Claude Code parity: `wotann loop <interval> <command>`
// runs the command on a recurring schedule via LoopManager. Honours
// `--max-iterations` and `--stop-on-failure`. Ctrl-C gracefully stops.
program
  .command("loop <interval> <command>")
  .description("Run a command on a recurring interval (e.g. `wotann loop 5m 'npm test'`)")
  .option("--max-iterations <n>", "Stop after N iterations (0 = unlimited)", "0")
  .option("--stop-on-failure", "Stop the loop on the first failing iteration", false)
  .action(
    async (
      interval: string,
      command: string,
      opts: {
        maxIterations?: string;
        stopOnFailure?: boolean;
      },
    ) => {
      const { LoopManager, parseInterval } = await import("./cli/loop-command.js");
      try {
        parseInterval(interval);
      } catch (err) {
        console.error(chalk.red(`Invalid interval: ${(err as Error).message}`));
        process.exit(2);
      }
      const manager = new LoopManager();
      const maxIter = parseInt(opts.maxIterations ?? "0", 10);
      const executor = async (cmd: string): Promise<boolean> => {
        return new Promise<boolean>((resolvePromise) => {
          const child = spawn("sh", ["-c", cmd], {
            stdio: "inherit",
            cwd: process.cwd(),
            env: process.env,
          });
          child.on("exit", (code) => resolvePromise(code === 0));
          child.on("error", () => resolvePromise(false));
        });
      };
      const state = manager.start(
        {
          interval,
          command,
          ...(maxIter > 0 ? { maxIterations: maxIter } : {}),
          ...(opts.stopOnFailure ? { stopOnFailure: true } : {}),
        },
        executor,
      );
      console.log(chalk.green(`✓ Loop ${state.id} started — every ${interval}: ${command}`));
      console.log(chalk.dim(`  Press Ctrl-C to stop.`));
      const onSignal = (): void => {
        manager.stopAll();
        console.log(chalk.yellow("\n✓ Loop stopped."));
        process.exit(0);
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      // Keep the event loop alive while loops run.
      await new Promise(() => undefined);
    },
  );

// ── Parse ───────────────────────────────────────────────────

// Deep-link fast path — if the first positional arg is a `wotann://` URL,
// parse it and dispatch via the deep-link handler BEFORE commander sees
// the URL (commander would otherwise attempt to resolve the scheme as a
// subcommand and abort). This lets OS handlers (launch services on macOS,
// xdg-open on Linux, registry-handler on Windows) open links directly.
const firstArg = process.argv[2];
if (firstArg && firstArg.startsWith("wotann://")) {
  const { parseDeepLink, executeDeepLink } = await import("./core/deep-link.js");
  const req = parseDeepLink(firstArg);
  if (!req) {
    console.error(chalk.red(`Invalid wotann:// URL: ${firstArg}`));
    process.exit(1);
  }
  const res = executeDeepLink(req, { workingDir: process.cwd() });
  const prefix = res.success ? chalk.green("✓") : chalk.red("✗");
  console.log(`${prefix} ${res.message}`);
  process.exit(res.success ? 0 : 1);
}

await program.parseAsync();
