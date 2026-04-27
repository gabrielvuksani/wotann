/**
 * Hierarchical config system: YAML file + env vars + CLI args.
 * Each layer overrides the previous. Immutable config objects.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, parse } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { WotannConfig, HookProfile, ProviderName } from "./types.js";

// ── Zod Schemas ─────────────────────────────────────────────

const ProviderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  priority: z.number().optional(),
});

const HookConfigSchema = z.object({
  profile: z.enum(["minimal", "standard", "strict"]).default("standard"),
  custom: z.array(z.string()).optional(),
});

const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dbPath: z.string().optional(),
  maxEntries: z.number().optional(),
});

const UIConfigSchema = z.object({
  theme: z.string().default("default"),
  panels: z.array(z.string()).default(["chat"]),
});

const DaemonConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tickInterval: z.number().optional(),
  heartbeatPath: z.string().optional(),
});

const WotannConfigSchema = z.object({
  version: z.string().default("0.1.0"),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  hooks: HookConfigSchema.default(() => ({ profile: "standard" as const })),
  memory: MemoryConfigSchema.default(() => ({ enabled: true })),
  ui: UIConfigSchema.default(() => ({ theme: "default", panels: ["chat"] })),
  daemon: DaemonConfigSchema.default(() => ({ enabled: false })),
});

// ── Default Config ──────────────────────────────────────────

const DEFAULT_CONFIG: WotannConfig = {
  version: "0.1.0",
  providers: {},
  hooks: { profile: "standard" as HookProfile },
  memory: { enabled: true },
  ui: { theme: "default", panels: ["chat"] },
  daemon: { enabled: false },
};

// ── Config Loading ──────────────────────────────────────────

export function findWorkspaceRoot(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  const { root } = parse(dir);
  while (dir !== root) {
    if (existsSync(join(dir, ".wotann"))) {
      return dir;
    }
    // Also check legacy .nexus directory for backwards compatibility
    if (existsSync(join(dir, ".nexus"))) {
      return dir;
    }
    dir = join(dir, "..");
  }
  return null;
}

export function loadConfigFromFile(configPath: string): Partial<WotannConfig> {
  if (!existsSync(configPath)) {
    return {};
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);
  // Guard: YAML might parse to a non-object (string, number, null, array)
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Partial<WotannConfig>;
}

export function loadConfigFromEnv(): Partial<WotannConfig> {
  const providers: Record<string, { enabled: boolean; apiKey?: string; baseUrl?: string }> = {};

  // Gap-4 fix: prior implementation only read 7 env vars (anthropic,
  // openai, codex, copilot, ollama, huggingface, azure). The downstream
  // WotannConfig snapshot is consumed by `wotann doctor` and the desktop
  // UI's getConfig path; for users who only set GROQ_API_KEY (or any of
  // 12 other supported providers) the snapshot reported "no providers
  // configured" even when discovery picked the key up at a different
  // layer. This now mirrors the full ProviderName union from
  // src/core/types.ts so the config view stays honest across all 19
  // supported providers.

  // ── Frontier providers (subscription / API key) ──
  if (process.env["ANTHROPIC_API_KEY"] || process.env["CLAUDE_CODE_OAUTH_TOKEN"]) {
    providers["anthropic"] = { enabled: true, apiKey: process.env["ANTHROPIC_API_KEY"] };
  }
  if (process.env["OPENAI_API_KEY"]) {
    providers["openai"] = { enabled: true, apiKey: process.env["OPENAI_API_KEY"] };
  }
  if (process.env["CODEX_API_KEY"]) {
    providers["codex"] = { enabled: true, apiKey: process.env["CODEX_API_KEY"] };
  }
  if (process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"]) {
    providers["copilot"] = {
      enabled: true,
      apiKey: process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"],
    };
  }
  if (process.env["GEMINI_API_KEY"] || process.env["GOOGLE_AI_API_KEY"]) {
    providers["gemini"] = {
      enabled: true,
      apiKey: process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_AI_API_KEY"],
    };
  }
  if (process.env["MISTRAL_API_KEY"]) {
    providers["mistral"] = { enabled: true, apiKey: process.env["MISTRAL_API_KEY"] };
  }
  if (process.env["DEEPSEEK_API_KEY"]) {
    providers["deepseek"] = { enabled: true, apiKey: process.env["DEEPSEEK_API_KEY"] };
  }
  if (process.env["XAI_API_KEY"]) {
    providers["xai"] = { enabled: true, apiKey: process.env["XAI_API_KEY"] };
  }
  if (process.env["PERPLEXITY_API_KEY"]) {
    providers["perplexity"] = { enabled: true, apiKey: process.env["PERPLEXITY_API_KEY"] };
  }

  // ── Aggregator / cross-provider router ──
  if (process.env["OPENROUTER_API_KEY"]) {
    providers["openrouter"] = {
      enabled: true,
      apiKey: process.env["OPENROUTER_API_KEY"],
      baseUrl: "https://openrouter.ai/api/v1",
    };
  }

  // ── Free-tier / fast inference providers ──
  if (process.env["GROQ_API_KEY"]) {
    providers["groq"] = {
      enabled: true,
      apiKey: process.env["GROQ_API_KEY"],
      baseUrl: "https://api.groq.com/openai/v1",
    };
  }
  if (process.env["CEREBRAS_API_KEY"]) {
    providers["cerebras"] = { enabled: true, apiKey: process.env["CEREBRAS_API_KEY"] };
  }
  if (process.env["TOGETHER_API_KEY"]) {
    providers["together"] = { enabled: true, apiKey: process.env["TOGETHER_API_KEY"] };
  }
  if (process.env["FIREWORKS_API_KEY"]) {
    providers["fireworks"] = { enabled: true, apiKey: process.env["FIREWORKS_API_KEY"] };
  }
  if (process.env["SAMBANOVA_API_KEY"]) {
    providers["sambanova"] = { enabled: true, apiKey: process.env["SAMBANOVA_API_KEY"] };
  }

  // ── Local models ──
  if (process.env["OLLAMA_URL"] || process.env["OLLAMA_HOST"]) {
    providers["ollama"] = {
      enabled: true,
      baseUrl: process.env["OLLAMA_URL"] ?? process.env["OLLAMA_HOST"] ?? "http://localhost:11434",
    };
  }

  // ── Cloud-hosted enterprise providers ──
  if (
    process.env["HF_TOKEN"] ||
    process.env["HUGGINGFACE_API_KEY"] ||
    process.env["HUGGING_FACE_HUB_TOKEN"]
  ) {
    providers["huggingface"] = {
      enabled: true,
      apiKey:
        process.env["HF_TOKEN"] ??
        process.env["HUGGINGFACE_API_KEY"] ??
        process.env["HUGGING_FACE_HUB_TOKEN"],
      baseUrl: "https://router.huggingface.co/v1",
    };
  }
  if (process.env["AZURE_OPENAI_API_KEY"]) {
    providers["azure"] = {
      enabled: true,
      apiKey: process.env["AZURE_OPENAI_API_KEY"],
      baseUrl: process.env["AZURE_OPENAI_ENDPOINT"],
    };
  }
  // AWS Bedrock uses IAM credentials rather than a single API key. Treat
  // the presence of either AWS_ACCESS_KEY_ID or AWS_PROFILE as the enable
  // signal; the actual signing happens in the bedrock adapter at request
  // time. Skip apiKey since SigV4 doesn't use one.
  if (process.env["AWS_ACCESS_KEY_ID"] || process.env["AWS_PROFILE"]) {
    providers["bedrock"] = { enabled: true };
  }
  // Google Vertex AI uses a service-account JSON file at the standard
  // GOOGLE_APPLICATION_CREDENTIALS path. Presence enables the provider;
  // adapter loads the credentials at request time.
  if (process.env["GOOGLE_APPLICATION_CREDENTIALS"]) {
    providers["vertex"] = { enabled: true };
  }

  return Object.keys(providers).length > 0 ? { providers } : {};
}

export interface CLIOverrides {
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly mode?: string;
  readonly hookProfile?: HookProfile;
}

export function loadConfigFromCLI(overrides: CLIOverrides): Partial<WotannConfig> {
  const config: Partial<WotannConfig> = {};

  if (overrides.hookProfile) {
    return { ...config, hooks: { profile: overrides.hookProfile } };
  }

  return config;
}

// ── Merge Logic ─────────────────────────────────────────────

function mergeConfig(base: WotannConfig, override: Partial<WotannConfig>): WotannConfig {
  return {
    version: override.version ?? base.version,
    providers: {
      ...base.providers,
      ...override.providers,
    },
    hooks: override.hooks ? { ...base.hooks, ...override.hooks } : base.hooks,
    memory: override.memory ? { ...base.memory, ...override.memory } : base.memory,
    ui: override.ui ? { ...base.ui, ...override.ui } : base.ui,
    daemon: override.daemon ? { ...base.daemon, ...override.daemon } : base.daemon,
  };
}

/**
 * Load config with hierarchical merge: defaults → file → env → CLI.
 * Each layer overrides the previous. Returns an immutable config.
 */
export function loadConfig(
  workspaceRoot: string | null = findWorkspaceRoot(),
  cliOverrides: CLIOverrides = {},
): WotannConfig {
  let config: WotannConfig = { ...DEFAULT_CONFIG };

  // S2-13: guard against `.wotann/.wotann/` nesting. If the caller passes
  // an already-.wotann'd path (which happened when findWorkspaceRoot
  // returned the workspace and a second caller layered `.wotann` on top
  // without checking), strip the trailing `.wotann` segment so we don't
  // produce `…/.wotann/.wotann/config.yaml`.
  const normalizedRoot =
    workspaceRoot && workspaceRoot.endsWith("/.wotann")
      ? workspaceRoot.slice(0, -".wotann".length - 1)
      : workspaceRoot;

  // Layer 1: YAML file
  if (normalizedRoot) {
    const filePath = join(normalizedRoot, ".wotann", "config.yaml");
    const fileConfig = loadConfigFromFile(filePath);
    config = mergeConfig(config, fileConfig);
  }

  // Layer 2: Environment variables
  const envConfig = loadConfigFromEnv();
  config = mergeConfig(config, envConfig);

  // Layer 3: CLI arguments
  const cliConfig = loadConfigFromCLI(cliOverrides);
  config = mergeConfig(config, cliConfig);

  // Validate final config
  const validated = WotannConfigSchema.safeParse(config);
  if (validated.success) {
    return validated.data as WotannConfig;
  }

  // Return unvalidated config on parse failure (best effort)
  return config;
}

export function getDefaultConfig(): WotannConfig {
  return { ...DEFAULT_CONFIG };
}
