/**
 * `wotann login` — unified provider authentication.
 *
 * Supports 6 auth flows:
 * 1. Anthropic: delegates to `claude login` (subscription) OR direct OAuth (API)
 * 2. Codex/ChatGPT: PKCE browser flow via auth.openai.com, stores to ~/.codex/auth.json
 * 3. GitHub Copilot: device code flow (shows code, user enters in browser)
 * 4. Gemini: opens browser to AI Studio API key page (user copies key)
 * 5. Ollama: no login needed — verifies server and suggests models
 * 6. OpenAI: env var check + instructions
 *
 * PORT FALLBACK: If the OAuth callback port is taken (18920-18930),
 * the browser flow falls back to device code flow automatically.
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { runDeviceCodeFlow, getGitHubDeviceCodeConfig } from "./oauth-server.js";

export type LoginProvider = "anthropic" | "codex" | "copilot" | "openai" | "gemini" | "ollama";

export interface LoginResult {
  readonly provider: LoginProvider;
  readonly success: boolean;
  readonly message: string;
  readonly method: string;
}

// ── Anthropic Login ────────────────────────────────────────

async function loginAnthropic(): Promise<LoginResult> {
  // Only path: delegate to Claude Code CLI. Per V9 T0.1, WOTANN must not
  // hold its own copy of a Claude subscription OAuth token — the `claude`
  // binary is the credential holder, WOTANN just invokes it.
  try {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 5000 });
      console.log(chalk.dim("  Found Claude Code CLI. Delegating login..."));
      execFileSync("claude", ["login"], { stdio: "inherit", timeout: 120_000 });
      return {
        provider: "anthropic",
        success: true,
        message: "Logged in via Claude Code CLI. Your subscription is now active.",
        method: "cli-delegation",
      };
    } catch {
      // Claude CLI not installed — fall through to API-key instructions.
    }
  } catch {
    // Module import failed — fall through.
  }

  // CLI unavailable: print actionable instructions. Subscription auth
  // requires the Claude CLI (WOTANN cannot legally hold a Claude Pro/Max
  // OAuth token itself); pay-per-token auth uses ANTHROPIC_API_KEY.
  console.log(chalk.dim("\n  Claude Code CLI not found."));
  console.log(chalk.dim("  For your Claude Max/Pro subscription, install the CLI:"));
  console.log(chalk.dim("    npm i -g @anthropic-ai/claude-code"));
  console.log(chalk.dim("    claude login"));
  console.log(chalk.dim("    wotann login anthropic   # re-run after install\n"));
  console.log(chalk.dim("  For pay-per-token access, set your API key manually:"));
  console.log(chalk.dim("    export ANTHROPIC_API_KEY=sk-ant-..."));
  console.log(chalk.dim("    (get a key at https://console.anthropic.com/settings/keys)\n"));

  return {
    provider: "anthropic",
    success: false,
    message:
      "Install Claude Code CLI (npm i -g @anthropic-ai/claude-code) for subscription access, or set ANTHROPIC_API_KEY for pay-per-token.",
    method: "manual",
  };
}

// ── Codex/ChatGPT Login ────────────────────────────────────

async function loginCodex(): Promise<LoginResult> {
  // Only path: delegate to Codex CLI. Per V9 T0.2, WOTANN no longer runs
  // its own PKCE flow against auth.openai.com with Codex CLI's public
  // client_id — that would masquerade as the official CLI. The Codex
  // CLI is the legitimate credential holder.
  console.log(chalk.dim("  Delegating to Codex CLI...\n"));
  console.log(chalk.dim("  This uses your ChatGPT Plus/Pro/Team subscription."));
  console.log(
    chalk.dim("  Codex models (codexplan, codexspark) require a ChatGPT subscription.\n"),
  );

  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("npx", ["@openai/codex", "login"], {
      stdio: "inherit",
      timeout: 180_000,
    });
    return {
      provider: "codex",
      success: true,
      message: "Authenticated via Codex CLI. Tokens saved by the CLI to ~/.codex/auth.json.",
      method: "cli-delegation",
    };
  } catch {
    console.log(chalk.dim("\n  Codex CLI delegation failed."));
    console.log(chalk.dim("  Install and run the Codex CLI directly:"));
    console.log(chalk.dim("    npm i -g @openai/codex"));
    console.log(chalk.dim("    codex login"));
    console.log(chalk.dim("    wotann login codex   # re-run after login\n"));

    return {
      provider: "codex",
      success: false,
      message:
        "Install and run: npm i -g @openai/codex && codex login. WOTANN detects existing ~/.codex/auth.json.",
      method: "manual",
    };
  }
}

// ── GitHub Copilot Login ───────────────────────────────────

async function loginCopilot(): Promise<LoginResult> {
  console.log(chalk.dim("  Starting GitHub device code flow...\n"));
  console.log(chalk.dim("  This uses your GitHub Copilot subscription."));
  console.log(chalk.dim("  Free: GPT-4.1-mini, Claude 3.5 Haiku (2K completions/mo)"));
  console.log(chalk.dim("  Pro ($10/mo): GPT-4.1, Claude Sonnet 4, Gemini 2.5 Pro"));
  console.log(chalk.dim("  Pro+ ($39/mo): GPT-5, Claude Opus 4, o3, unlimited\n"));

  const config = getGitHubDeviceCodeConfig();

  const result = await runDeviceCodeFlow(config, (response) => {
    console.log();
    console.log(chalk.bold("  Enter this code at GitHub:"));
    console.log(chalk.cyan(`  ${response.userCode}`));
    console.log(chalk.dim(`  URL: ${response.verificationUri}`));
    console.log(chalk.dim("  Waiting for authorization..."));
    console.log();
  });

  if (!result.success || !result.tokens) {
    return {
      provider: "copilot",
      success: false,
      message: result.error ?? "Device code flow failed. Try: export GH_TOKEN=$(gh auth token)",
      method: "device-code",
    };
  }

  // Save the token for use as GH_TOKEN
  const wotannConfigDir = join(homedir(), ".wotann");
  if (!existsSync(wotannConfigDir)) mkdirSync(wotannConfigDir, { recursive: true });

  const tokenData = {
    provider: "copilot",
    token: result.tokens.accessToken,
    refresh_token: result.tokens.refreshToken,
    expires_in: result.tokens.expiresIn,
    scope: result.tokens.scope,
    saved_at: new Date().toISOString(),
  };

  writeFileSync(join(wotannConfigDir, "copilot-token.json"), JSON.stringify(tokenData, null, 2));

  return {
    provider: "copilot",
    success: true,
    message: "GitHub Copilot authenticated. Token saved to ~/.wotann/copilot-token.json",
    method: "device-code",
  };
}

// ── Gemini Login ───────────────────────────────────────────

async function loginGemini(): Promise<LoginResult> {
  console.log(chalk.dim("  Opening Google AI Studio for API key...\n"));
  console.log(chalk.dim("  Gemini has a generous free tier:"));
  console.log(chalk.dim("  - Flash: 1.5M tokens/day, 1000 RPM"));
  console.log(chalk.dim("  - Pro: 50 requests/day (free), unlimited with billing\n"));

  const { execFileSync } = await import("node:child_process");
  const { platform: osPlatform } = await import("node:os");

  const url = "https://aistudio.google.com/app/apikey";
  try {
    if (osPlatform() === "darwin") {
      execFileSync("open", [url], { stdio: "pipe" });
    } else {
      execFileSync("xdg-open", [url], { stdio: "pipe" });
    }
  } catch {
    console.log(chalk.dim(`  Open this URL: ${url}`));
  }

  console.log(chalk.bold("  Get your free API key from Google AI Studio."));
  console.log(chalk.dim("  Then set it: export GEMINI_API_KEY=<your-key>"));
  console.log(chalk.dim("  Or add to .wotann/config.yaml:\n"));
  console.log(chalk.dim("  providers:"));
  console.log(chalk.dim("    gemini:"));
  console.log(chalk.dim("      enabled: true"));
  console.log(chalk.dim("      apiKey: AI...\n"));

  return {
    provider: "gemini",
    success: true,
    message: "Opened AI Studio. Set GEMINI_API_KEY after getting your key.",
    method: "manual",
  };
}

// ── Ollama Check ───────────────────────────────────────────

async function loginOllama(): Promise<LoginResult> {
  console.log(chalk.dim("  Checking Ollama status...\n"));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as {
        models?: readonly { name: string; size: number }[];
      };
      const models = data.models ?? [];
      const modelCount = models.length;

      console.log(chalk.green(`  Ollama is running with ${modelCount} model(s):`));
      for (const m of models.slice(0, 10)) {
        const sizeGB = (m.size / 1e9).toFixed(1);
        console.log(chalk.dim(`    - ${m.name} (${sizeGB}GB)`));
      }

      if (modelCount === 0) {
        console.log(chalk.yellow("\n  No models installed. Recommended for coding:"));
        console.log(
          chalk.dim("    ollama pull qwen3-coder-next    # 80B MoE, best coding (18GB VRAM)"),
        );
        console.log(
          chalk.dim("    ollama pull qwen3.5:27b         # multimodal, 256K context (20GB)"),
        );
        console.log(chalk.dim("    ollama pull devstral:24b         # fast coding agent (16GB)"));
        console.log(chalk.dim("    ollama pull qwen3-coder:7b       # entry level (5GB)"));
      }

      return {
        provider: "ollama",
        success: true,
        message: `Ollama is running with ${modelCount} model(s). No login needed.`,
        method: "local-check",
      };
    }
  } catch {
    // Not running
  }

  console.log(chalk.yellow("  Ollama is not running."));
  console.log(chalk.dim("\n  Install:  https://ollama.ai"));
  console.log(chalk.dim("  Start:    ollama serve"));
  console.log(chalk.dim("  Pull:     ollama pull qwen3-coder-next"));
  console.log(chalk.dim("  Verify:   ollama list\n"));

  return {
    provider: "ollama",
    success: false,
    message:
      "Ollama is not running. Install from https://ollama.ai, then: ollama serve && ollama pull qwen3-coder-next",
    method: "local-check",
  };
}

// ── OpenAI API Key ─────────────────────────────────────────

async function loginOpenAI(): Promise<LoginResult> {
  if (process.env["OPENAI_API_KEY"]) {
    return {
      provider: "openai",
      success: true,
      message: "OPENAI_API_KEY is already set.",
      method: "env-var",
    };
  }

  console.log(chalk.bold("  Set your OpenAI API key:"));
  console.log(chalk.dim("  export OPENAI_API_KEY=sk-..."));
  console.log(chalk.dim("  Get a key at: https://platform.openai.com/api-keys"));
  console.log(chalk.dim("  Note: OpenAI API models (GPT-5.x, o-series) require API billing."));
  console.log(chalk.dim("  For ChatGPT subscription models (Codex), use: wotann login codex\n"));

  return {
    provider: "openai",
    success: false,
    message: "OPENAI_API_KEY not set. Set it in your shell profile.",
    method: "manual",
  };
}

// ── Unified Login Command ──────────────────────────────────

export async function runLogin(provider?: string): Promise<void> {
  console.log(chalk.bold("\nWOTANN Login\n"));

  if (provider) {
    const result = await loginSingleProvider(provider as LoginProvider);
    printLoginResult(result);
    return;
  }

  // Interactive: show all providers with status
  const providers: readonly { name: LoginProvider; label: string; cost: string }[] = [
    {
      name: "anthropic",
      label: "Anthropic Claude (subscription or API key)",
      cost: "subscription / pay-per-use",
    },
    { name: "codex", label: "OpenAI Codex (ChatGPT subscription)", cost: "ChatGPT Plus $20/mo" },
    { name: "copilot", label: "GitHub Copilot (free tier available)", cost: "Free / $10 / $39/mo" },
    { name: "gemini", label: "Google Gemini (generous free tier)", cost: "free" },
    { name: "ollama", label: "Ollama (local, free, private)", cost: "free" },
    { name: "openai", label: "OpenAI API (pay-per-use)", cost: "pay-per-use" },
  ];

  console.log(chalk.dim("  Select a provider to authenticate:\n"));
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    if (p) console.log(`  ${chalk.cyan(`${i + 1}`)}. ${p.label} ${chalk.dim(`[${p.cost}]`)}`);
  }
  console.log();
  console.log(chalk.dim("  Usage: wotann login <provider>"));
  console.log(chalk.dim("  Example: wotann login anthropic"));
  console.log(chalk.dim("           wotann login codex"));
  console.log(chalk.dim("           wotann login copilot"));
  console.log(chalk.dim("           wotann login gemini"));
  console.log(chalk.dim("           wotann login ollama\n"));
}

async function loginSingleProvider(provider: LoginProvider): Promise<LoginResult> {
  switch (provider) {
    case "anthropic":
      return loginAnthropic();
    case "codex":
      return loginCodex();
    case "copilot":
      return loginCopilot();
    case "gemini":
      return loginGemini();
    case "ollama":
      return loginOllama();
    case "openai":
      return loginOpenAI();
    default:
      return {
        provider,
        success: false,
        message: `Unknown provider: ${provider}. Available: anthropic, codex, copilot, gemini, ollama, openai`,
        method: "none",
      };
  }
}

function printLoginResult(result: LoginResult): void {
  const icon = result.success ? chalk.green("ok") : chalk.red("--");
  const msg = result.success ? chalk.green(result.message) : chalk.yellow(result.message);
  console.log(`  ${icon} ${msg}\n`);
}
