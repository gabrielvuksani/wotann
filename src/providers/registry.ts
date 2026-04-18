/**
 * Provider registry: initializes adapters from discovered providers.
 * Each provider gets its own dedicated adapter with correct auth flow.
 */

import type { ProviderName, ProviderAuth } from "../core/types.js";
import type { ProviderAdapter } from "./types.js";
import { createAnthropicAdapter } from "./anthropic-adapter.js";
import { createAnthropicSubscriptionAdapter } from "./anthropic-subscription.js";
import { createCodexAdapter } from "./codex-adapter.js";
import { createCopilotAdapter } from "./copilot-adapter.js";
import { createOllamaAdapter } from "./ollama-adapter.js";
import { createOpenAIAdapter, createOpenAICompatAdapter } from "./openai-compat-adapter.js";
import { createGeminiNativeAdapter } from "./gemini-native-adapter.js";
import { ModelRouter } from "./model-router.js";
import { RateLimitManager } from "./rate-limiter.js";
import { AgentBridge } from "../core/agent-bridge.js";
import { AccountPool } from "./account-pool.js";
import { getModelContextConfig, isExtendedContextEnabled } from "../context/limits.js";

export interface ProviderInfrastructure {
  readonly adapters: ReadonlyMap<ProviderName, ProviderAdapter>;
  readonly router: ModelRouter;
  readonly rateLimiter: RateLimitManager;
  readonly accountPool: AccountPool;
  readonly bridge: AgentBridge;
}

export function createProviderInfrastructure(
  discoveredProviders: readonly ProviderAuth[],
  accountPool?: AccountPool,
): ProviderInfrastructure {
  const adapters = new Map<ProviderName, ProviderAdapter>();
  const ollamaModels: string[] = [];
  const resolvedAccountPool = accountPool ?? new AccountPool();
  if (!accountPool && resolvedAccountPool.size() === 0) {
    resolvedAccountPool.discoverFromEnv();
  }

  const getMaxContextWindow = (provider: ProviderName, model: string): number =>
    getModelContextConfig(model, provider, {
      enableExtendedContext: isExtendedContextEnabled(provider, model),
    }).maxContextTokens;

  for (const auth of discoveredProviders) {
    if (adapters.has(auth.provider)) continue;

    switch (auth.provider) {
      case "anthropic":
        if (auth.method === "oauth-token") {
          adapters.set("anthropic", createAnthropicSubscriptionAdapter());
        } else {
          adapters.set("anthropic", createAnthropicAdapter(auth.token));
        }
        break;
      case "openai":
        adapters.set("openai", createOpenAIAdapter(auth.token));
        break;
      case "codex":
        adapters.set("codex", createCodexAdapter(auth.token));
        break;
      case "copilot":
        adapters.set("copilot", createCopilotAdapter(auth.token));
        break;
      case "ollama":
        adapters.set("ollama", createOllamaAdapter(auth.token));
        ollamaModels.push(...auth.models);
        break;
      case "free": {
        const groqKey = process.env["GROQ_API_KEY"];
        const cerebrasKey = process.env["CEREBRAS_API_KEY"];
        const cfg = groqKey
          ? {
              baseUrl: "https://api.groq.com/openai/v1",
              apiKey: groqKey,
              defaultModel: "llama-3.3-70b-versatile",
            }
          : cerebrasKey
            ? {
                baseUrl: "https://api.cerebras.ai/v1",
                apiKey: cerebrasKey,
                defaultModel: "llama-4-scout-17b-16e",
              }
            : {
                baseUrl: "https://api.groq.com/openai/v1",
                apiKey: "",
                defaultModel: "llama-3.3-70b-versatile",
              };
        adapters.set(
          "free",
          createOpenAICompatAdapter({
            provider: "free",
            baseUrl: cfg.baseUrl,
            apiKey: cfg.apiKey,
            defaultModel: cfg.defaultModel,
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: false,
              supportsStreaming: true,
              supportsThinking: false,
              maxContextWindow: getMaxContextWindow("free", cfg.defaultModel),
            },
          }),
        );
        break;
      }
      case "gemini":
        // S3-1: use the native Gemini adapter instead of the
        // openai-compat shim. Native adapter unlocks google_search
        // grounding, code_execution, url_context, thinking_budget,
        // and thought signatures — all of which the /openai/
        // endpoint strips away. Opt back into the legacy compat
        // path via WOTANN_GEMINI_SHIM=1 for debugging.
        if (process.env["WOTANN_GEMINI_SHIM"] === "1") {
          adapters.set(
            "gemini",
            createOpenAICompatAdapter({
              provider: "gemini",
              baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
              apiKey: auth.token,
              defaultModel: "gemini-3.1-flash",
              models: auth.models,
              capabilities: {
                supportsComputerUse: false,
                supportsToolCalling: true,
                supportsVision: true,
                supportsStreaming: true,
                supportsThinking: true,
                maxContextWindow: getMaxContextWindow("gemini", "gemini-3.1-pro"),
              },
            }),
          );
        } else {
          adapters.set("gemini", createGeminiNativeAdapter(auth.token));
        }
        break;
      case "huggingface":
        adapters.set(
          "huggingface",
          createOpenAICompatAdapter({
            provider: "huggingface",
            baseUrl: "https://router.huggingface.co/v1",
            apiKey: auth.token,
            defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: true,
              supportsStreaming: true,
              supportsThinking: true,
              maxContextWindow: getMaxContextWindow(
                "huggingface",
                "Qwen/Qwen3-Coder-480B-A35B-Instruct",
              ),
            },
          }),
        );
        break;
      case "azure":
        adapters.set(
          "azure",
          createOpenAICompatAdapter({
            provider: "azure",
            baseUrl: process.env["AZURE_OPENAI_ENDPOINT"] ?? "",
            apiKey: auth.token,
            defaultModel: "gpt-4o",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: true,
              supportsStreaming: true,
              supportsThinking: true,
              maxContextWindow: getMaxContextWindow("openai", "gpt-4.1"),
            },
            headers: { "api-version": "2024-12-01-preview" },
          }),
        );
        break;
      case "bedrock":
        adapters.set(
          "bedrock",
          createOpenAICompatAdapter({
            provider: "bedrock",
            baseUrl: `https://bedrock-runtime.${process.env["AWS_REGION"] ?? "us-east-1"}.amazonaws.com/model`,
            apiKey: auth.token,
            defaultModel: "anthropic.claude-sonnet-4-6",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: true,
              supportsStreaming: true,
              supportsThinking: true,
              maxContextWindow: getMaxContextWindow("anthropic", "claude-sonnet-4-6"),
            },
          }),
        );
        break;
      case "vertex":
        adapters.set(
          "vertex",
          createOpenAICompatAdapter({
            provider: "vertex",
            baseUrl: `https://${process.env["GOOGLE_CLOUD_REGION"] ?? "us-central1"}-aiplatform.googleapis.com/v1/projects/${process.env["GOOGLE_CLOUD_PROJECT"]}/locations/${process.env["GOOGLE_CLOUD_REGION"] ?? "us-central1"}/publishers/anthropic/models`,
            apiKey: auth.token,
            defaultModel: "claude-sonnet-4-6",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: true,
              supportsStreaming: true,
              supportsThinking: true,
              maxContextWindow: getMaxContextWindow("gemini", "gemini-2.5-pro"),
            },
          }),
        );
        break;
      case "mistral":
        adapters.set(
          "mistral",
          createOpenAICompatAdapter({
            provider: "mistral",
            baseUrl: "https://api.mistral.ai/v1",
            apiKey: auth.token,
            defaultModel: "mistral-large-latest",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: true,
              supportsStreaming: true,
              supportsThinking: false,
              maxContextWindow: 128_000,
            },
          }),
        );
        break;
      case "deepseek":
        adapters.set(
          "deepseek",
          createOpenAICompatAdapter({
            provider: "deepseek",
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: auth.token,
            defaultModel: "deepseek-chat",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: false,
              supportsStreaming: true,
              supportsThinking: true,
              maxContextWindow: 128_000,
            },
          }),
        );
        break;
      case "perplexity":
        adapters.set(
          "perplexity",
          createOpenAICompatAdapter({
            provider: "perplexity",
            baseUrl: "https://api.perplexity.ai",
            apiKey: auth.token,
            defaultModel: "sonar",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              // Sonar models support OpenAI-style `tools` parameter since
              // 2026-Q1 (https://docs.perplexity.ai/guides/function-calling).
              // Session 9 audit flipped this from false → true so Perplexity
              // participates in tool-calling flows without going through the
              // capability-augmenter's XML emulation.
              supportsToolCalling: true,
              supportsVision: false,
              supportsStreaming: true,
              supportsThinking: true,
              maxContextWindow: 127_072,
            },
          }),
        );
        break;
      case "xai":
        adapters.set(
          "xai",
          createOpenAICompatAdapter({
            provider: "xai",
            baseUrl: "https://api.x.ai/v1",
            apiKey: auth.token,
            defaultModel: "grok-3",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: true,
              supportsStreaming: true,
              supportsThinking: true,
              maxContextWindow: 131_072,
            },
          }),
        );
        break;
      case "together":
        adapters.set(
          "together",
          createOpenAICompatAdapter({
            provider: "together",
            baseUrl: "https://api.together.xyz/v1",
            apiKey: auth.token,
            defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: false,
              supportsStreaming: true,
              supportsThinking: false,
              maxContextWindow: 131_072,
            },
          }),
        );
        break;
      case "fireworks":
        adapters.set(
          "fireworks",
          createOpenAICompatAdapter({
            provider: "fireworks",
            baseUrl: "https://api.fireworks.ai/inference/v1",
            apiKey: auth.token,
            defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: false,
              supportsStreaming: true,
              supportsThinking: false,
              maxContextWindow: 131_072,
            },
          }),
        );
        break;
      case "sambanova":
        adapters.set(
          "sambanova",
          createOpenAICompatAdapter({
            provider: "sambanova",
            baseUrl: "https://api.sambanova.ai/v1",
            apiKey: auth.token,
            defaultModel: "Meta-Llama-3.3-70B-Instruct",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: false,
              supportsStreaming: true,
              supportsThinking: false,
              maxContextWindow: 131_072,
            },
          }),
        );
        break;
      case "groq":
        // Explicit Groq case (session 9 audit gap): previously Groq was only
        // reachable via the `"free"` pseudo-provider branch, so a user who
        // enabled the named "groq" provider but not the free-tier umbrella
        // ended up with no adapter. Now we wire it directly whenever a
        // GROQ_API_KEY auth record exists, mirroring the free-tier config
        // so its models/capabilities are identical.
        adapters.set(
          "groq",
          createOpenAICompatAdapter({
            provider: "groq",
            baseUrl: "https://api.groq.com/openai/v1",
            apiKey: auth.token,
            defaultModel: "llama-3.3-70b-versatile",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: false,
              supportsStreaming: true,
              supportsThinking: false,
              maxContextWindow: 131_072,
            },
          }),
        );
        break;
    }
  }

  const availableProviders = new Set(adapters.keys());
  const router = new ModelRouter({ availableProviders, ollamaModels });
  const rateLimiter = new RateLimitManager([...availableProviders]);
  const bridge = new AgentBridge({
    adapters,
    router,
    rateLimiter,
    accountPool: resolvedAccountPool,
  });
  return { adapters, router, rateLimiter, accountPool: resolvedAccountPool, bridge };
}
