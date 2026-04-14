/**
 * Extra provider adapters (E5).
 *
 * Seven OpenAI-compatible providers that the spec enumerates but that
 * previously had no adapter wired. Each uses `createOpenAICompatAdapter`
 * from `openai-compat-adapter.ts` — the REST shape matches OpenAI's
 * `/v1/chat/completions` for all of them, so we just parameterise base
 * URL, default model, and capability flags.
 *
 * Providers:
 *  1. Mistral       — mistral-large-2, codestral
 *  2. DeepSeek      — deepseek-chat, deepseek-reasoner
 *  3. Perplexity    — sonar-pro (web-grounded)
 *  4. xAI           — grok-4
 *  5. Together AI   — mixed OSS (Llama, Qwen, DeepSeek R1)
 *  6. Fireworks AI  — mixed OSS, fast inference
 *  7. SambaNova     — OSS models on RDU hardware, very fast
 *
 * All seven are pure key-in-env setup. The router auto-registers whichever
 * ones have credentials available.
 */

import type { ProviderAdapter, ProviderCapabilities } from "./types.js";
import { createOpenAICompatAdapter } from "./openai-compat-adapter.js";

const COMMON_CAPS: ProviderCapabilities = {
  supportsComputerUse: false,
  supportsToolCalling: true,
  supportsVision: false,
  supportsStreaming: true,
  supportsThinking: false,
  maxContextWindow: 128_000,
};

// ── Mistral ────────────────────────────────────────────────
export function createMistralAdapter(apiKey: string): ProviderAdapter {
  return createOpenAICompatAdapter({
    provider: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKey,
    defaultModel: "mistral-large-latest",
    models: [
      "mistral-large-latest",
      "mistral-large-2411",
      "codestral-latest",
      "ministral-8b-latest",
      "pixtral-large-latest",
    ],
    capabilities: {
      ...COMMON_CAPS,
      supportsVision: true,
      maxContextWindow: 128_000,
    },
    transport: "chat_completions",
  });
}

// ── DeepSeek ───────────────────────────────────────────────
export function createDeepSeekAdapter(apiKey: string): ProviderAdapter {
  return createOpenAICompatAdapter({
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey,
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    capabilities: {
      ...COMMON_CAPS,
      supportsThinking: true,
      maxContextWindow: 64_000,
    },
    transport: "chat_completions",
  });
}

// ── Perplexity (web-grounded) ─────────────────────────────
export function createPerplexityAdapter(apiKey: string): ProviderAdapter {
  return createOpenAICompatAdapter({
    provider: "perplexity",
    baseUrl: "https://api.perplexity.ai",
    apiKey,
    defaultModel: "sonar-pro",
    models: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"],
    capabilities: {
      ...COMMON_CAPS,
      supportsToolCalling: false, // web search is implicit, not a tool
      maxContextWindow: 128_000,
    },
    transport: "chat_completions",
  });
}

// ── xAI (Grok) ─────────────────────────────────────────────
export function createXAIAdapter(apiKey: string): ProviderAdapter {
  return createOpenAICompatAdapter({
    provider: "xai",
    baseUrl: "https://api.x.ai/v1",
    apiKey,
    defaultModel: "grok-4-0709",
    models: ["grok-4-0709", "grok-4-fast-0719", "grok-code-fast-1", "grok-3-mini"],
    capabilities: {
      ...COMMON_CAPS,
      supportsVision: true,
      maxContextWindow: 256_000,
    },
    transport: "chat_completions",
  });
}

// ── Together AI ────────────────────────────────────────────
export function createTogetherAdapter(apiKey: string): ProviderAdapter {
  return createOpenAICompatAdapter({
    provider: "together",
    baseUrl: "https://api.together.xyz/v1",
    apiKey,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
      "Qwen/Qwen2.5-Coder-32B-Instruct",
      "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
      "mistralai/Mistral-Small-24B-Instruct-2501",
    ],
    capabilities: {
      ...COMMON_CAPS,
      maxContextWindow: 131_072,
    },
    transport: "chat_completions",
  });
}

// ── Fireworks AI ───────────────────────────────────────────
export function createFireworksAdapter(apiKey: string): ProviderAdapter {
  return createOpenAICompatAdapter({
    provider: "fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKey,
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    models: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/llama4-maverick-instruct-basic",
      "accounts/fireworks/models/deepseek-r1",
      "accounts/fireworks/models/qwen3-coder-480b",
      "accounts/fireworks/models/kimi-k2-instruct",
    ],
    capabilities: {
      ...COMMON_CAPS,
      maxContextWindow: 131_072,
    },
    transport: "chat_completions",
  });
}

// ── SambaNova ──────────────────────────────────────────────
export function createSambaNovaAdapter(apiKey: string): ProviderAdapter {
  return createOpenAICompatAdapter({
    provider: "sambanova",
    baseUrl: "https://api.sambanova.ai/v1",
    apiKey,
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    models: [
      "Meta-Llama-3.3-70B-Instruct",
      "Meta-Llama-3.1-405B-Instruct",
      "Qwen2.5-Coder-32B-Instruct",
      "DeepSeek-R1-Distill-Llama-70B",
      "Llama-4-Maverick-17B-128E-Instruct",
    ],
    capabilities: {
      ...COMMON_CAPS,
      maxContextWindow: 131_072,
    },
    transport: "chat_completions",
  });
}

/**
 * Auto-register whichever extra providers have keys set in env.
 * Returns the map the registry can splat into its own provider table.
 */
export function discoverExtraProviders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, ProviderAdapter> {
  const out: Record<string, ProviderAdapter> = {};
  if (env["MISTRAL_API_KEY"]) out["mistral"] = createMistralAdapter(env["MISTRAL_API_KEY"]);
  if (env["DEEPSEEK_API_KEY"]) out["deepseek"] = createDeepSeekAdapter(env["DEEPSEEK_API_KEY"]);
  if (env["PERPLEXITY_API_KEY"])
    out["perplexity"] = createPerplexityAdapter(env["PERPLEXITY_API_KEY"]);
  if (env["XAI_API_KEY"]) out["xai"] = createXAIAdapter(env["XAI_API_KEY"]);
  if (env["TOGETHER_API_KEY"]) out["together"] = createTogetherAdapter(env["TOGETHER_API_KEY"]);
  if (env["FIREWORKS_API_KEY"]) out["fireworks"] = createFireworksAdapter(env["FIREWORKS_API_KEY"]);
  if (env["SAMBANOVA_API_KEY"]) out["sambanova"] = createSambaNovaAdapter(env["SAMBANOVA_API_KEY"]);
  return out;
}
