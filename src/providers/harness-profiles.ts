/**
 * Named harness profiles (E10).
 *
 * A harness profile bundles a provider + model + thinking mode + tool set
 * into a single name the user can invoke from CLI or the TUI. Inspired by
 * deepagents' preset system — "fast-cheap" for quick tweaks, "max-quality"
 * when nothing less will do, "offline" for airplane mode.
 *
 * Profiles resolve to a concrete query plan at call time so that env
 * changes (e.g., new API key added) are picked up without a restart.
 *
 * Usage from CLI:
 *   wotann profile list
 *   wotann profile switch fast-cheap
 *   wotann profile switch max-quality
 *
 * Programmatic:
 *   const profile = resolveProfile("fast-cheap");
 *   runtime.query({ prompt, provider: profile.provider, model: profile.model });
 */

import type { ProviderName } from "../core/types.js";

export interface HarnessProfile {
  readonly name: string;
  readonly description: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly tags: readonly string[];
  readonly thinkingTokens?: number;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Fallback providers in priority order if the primary is unavailable. */
  readonly fallbacks?: readonly { provider: ProviderName; model: string }[];
  /** Restrict which tool surfaces the profile exposes — keeps cheap models on rails. */
  readonly toolScope?: "full" | "read-only" | "edit-only" | "no-tools";
  /** Optional daily cost ceiling in USD; router will switch to fallbacks when hit. */
  readonly dailyBudgetUsd?: number;
}

export const BUILT_IN_PROFILES: Record<string, HarnessProfile> = {
  "fast-cheap": {
    name: "fast-cheap",
    description:
      "Haiku + Cerebras fallback — sub-second responses for quick edits, under $0.50 / hour.",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    tags: ["cheap", "fast", "daily-driver"],
    temperature: 0.2,
    fallbacks: [
      { provider: "ollama", model: "gemma3:latest" },
      { provider: "deepseek", model: "deepseek-chat" },
      { provider: "sambanova", model: "Meta-Llama-3.3-70B-Instruct" },
    ],
    toolScope: "full",
    dailyBudgetUsd: 5,
  },

  "max-quality": {
    name: "max-quality",
    description:
      "Opus 4.6 + 128k thinking — use when the task is ambiguous, architectural, or mission-critical.",
    provider: "anthropic",
    model: "claude-opus-4-6",
    tags: ["smart", "expensive", "deep-reasoning"],
    thinkingTokens: 128_000,
    temperature: 0.3,
    fallbacks: [
      { provider: "openai", model: "gpt-5-thinking" },
      { provider: "xai", model: "grok-4-0709" },
    ],
    toolScope: "full",
    dailyBudgetUsd: 100,
  },

  offline: {
    name: "offline",
    description: "Ollama + local MLX only — airplane mode, zero network, zero cost.",
    provider: "ollama",
    model: "gemma3:latest",
    tags: ["offline", "free", "local"],
    temperature: 0.4,
    fallbacks: [],
    toolScope: "full",
  },

  research: {
    name: "research",
    description: "Perplexity Sonar Pro for web-grounded research, then synthesize with Sonnet.",
    provider: "perplexity",
    model: "sonar-pro",
    tags: ["web-search", "citations", "research"],
    temperature: 0.2,
    fallbacks: [{ provider: "anthropic", model: "claude-sonnet-4-6" }],
    toolScope: "read-only",
  },

  reasoner: {
    name: "reasoner",
    description:
      "DeepSeek R1 + Qwen3-Coder fallback — strong CoT for hard logic puzzles at open-source pricing.",
    provider: "deepseek",
    model: "deepseek-reasoner",
    tags: ["oss", "reasoning", "cheap"],
    temperature: 0.3,
    fallbacks: [
      { provider: "fireworks", model: "accounts/fireworks/models/deepseek-r1" },
      { provider: "together", model: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B" },
    ],
    toolScope: "full",
  },

  "code-fast": {
    name: "code-fast",
    description:
      "Grok-code-fast + Codestral — specialised code autocomplete and edits at bottom-tier latency.",
    provider: "xai",
    model: "grok-code-fast-1",
    tags: ["code", "fast", "autocomplete"],
    temperature: 0.1,
    fallbacks: [
      { provider: "mistral", model: "codestral-latest" },
      { provider: "fireworks", model: "accounts/fireworks/models/qwen3-coder-480b" },
    ],
    toolScope: "edit-only",
  },

  "safe-review": {
    name: "safe-review",
    description:
      "Read-only Opus — analyse but cannot mutate. For code review, audit, or exploring unfamiliar code.",
    provider: "anthropic",
    model: "claude-opus-4-6",
    tags: ["safe", "read-only", "audit"],
    temperature: 0.2,
    toolScope: "read-only",
  },

  exploit: {
    name: "exploit",
    description:
      "Offensive-security profile — MITRE ATT&CK prompts, no tool limits, requires explicit --exploit flag.",
    provider: "anthropic",
    model: "claude-opus-4-6",
    tags: ["security", "offensive", "ctf"],
    temperature: 0.3,
    toolScope: "full",
  },
};

/**
 * Resolve a profile by name. Falls back to `fast-cheap` if the requested
 * profile doesn't exist so callers don't have to branch on that case.
 */
export function resolveProfile(name: string): HarnessProfile {
  return BUILT_IN_PROFILES[name] ?? BUILT_IN_PROFILES["fast-cheap"]!;
}

/** List the names of every built-in profile. */
export function listProfileNames(): readonly string[] {
  return Object.keys(BUILT_IN_PROFILES);
}

/**
 * Simple search — returns profiles whose name, description, or tags
 * include the query. Case-insensitive.
 */
export function searchProfiles(query: string): readonly HarnessProfile[] {
  const q = query.toLowerCase();
  return Object.values(BUILT_IN_PROFILES).filter(
    (p) =>
      p.name.includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

/**
 * Determine whether a profile can be activated right now — checks that the
 * primary provider has credentials, or that a fallback does.
 */
export function canActivate(
  profile: HarnessProfile,
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; reason?: string } {
  const hasPrimary = hasCredentialsFor(profile.provider, env);
  if (hasPrimary) return { ok: true };
  for (const fallback of profile.fallbacks ?? []) {
    if (hasCredentialsFor(fallback.provider, env)) {
      return { ok: true };
    }
  }
  return {
    ok: false,
    reason: `No credentials for ${profile.provider} or fallbacks (${
      (profile.fallbacks ?? []).map((f) => f.provider).join(", ") || "none"
    }).`,
  };
}

function hasCredentialsFor(provider: ProviderName, env: NodeJS.ProcessEnv): boolean {
  switch (provider) {
    case "anthropic":
      return !!(env["ANTHROPIC_API_KEY"] ?? env["CLAUDE_CODE_OAUTH_TOKEN"]);
    case "openai":
      return !!env["OPENAI_API_KEY"];
    case "codex":
      return !!env["CODEX_API_KEY"];
    case "copilot":
      return !!(env["GH_TOKEN"] ?? env["GITHUB_TOKEN"]);
    case "ollama":
      return true; // local — no auth, always "available" (pings on use)
    case "gemini":
      return !!(env["GEMINI_API_KEY"] ?? env["GOOGLE_API_KEY"]);
    case "huggingface":
      return !!(env["HF_TOKEN"] ?? env["HUGGINGFACE_API_KEY"] ?? env["HUGGING_FACE_HUB_TOKEN"]);
    case "mistral":
      return !!env["MISTRAL_API_KEY"];
    case "deepseek":
      return !!env["DEEPSEEK_API_KEY"];
    case "perplexity":
      return !!env["PERPLEXITY_API_KEY"];
    case "xai":
      return !!env["XAI_API_KEY"];
    case "together":
      return !!env["TOGETHER_API_KEY"];
    case "fireworks":
      return !!env["FIREWORKS_API_KEY"];
    case "sambanova":
      return !!env["SAMBANOVA_API_KEY"];
    case "free":
      return true;
    case "azure":
      return !!(env["AZURE_OPENAI_ENDPOINT"] && env["AZURE_OPENAI_API_KEY"]);
    case "bedrock":
      return !!env["AWS_BEDROCK_REGION"];
    case "vertex":
      return !!env["GOOGLE_VERTEX_PROJECT"];
  }
}
