/**
 * Provider registry: initializes adapters from discovered providers.
 * Each provider gets its own dedicated adapter with correct auth flow.
 */

import type { ProviderName, ProviderAuth } from "../core/types.js";
import type { ProviderAdapter } from "./types.js";
import { createAnthropicAdapter } from "./anthropic-adapter.js";
import { createAnthropicCliAdapter } from "./claude-cli-backend.js";
import { createCodexAdapter } from "./codex-adapter.js";
import { createCopilotAdapter } from "./copilot-adapter.js";
import { createOllamaAdapter } from "./ollama-adapter.js";
import { createOpenAIAdapter, createOpenAICompatAdapter } from "./openai-compat-adapter.js";
import { createGeminiNativeAdapter } from "./gemini-native-adapter.js";
// bedrock-signer + vertex-oauth imports removed alongside the
// consolidation that dropped Bedrock/Vertex from ProviderName.
// Re-introduce them only if those providers move back into the
// first-class set (and their type entries return).
import { createOpenCodeSstAdapter } from "./opencode-sst-adapter.js";
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
          adapters.set("anthropic", createAnthropicCliAdapter());
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
        adapters.set("ollama", createOllamaAdapter(auth.token, auth.models));
        ollamaModels.push(...auth.models);
        break;
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
      case "openrouter":
        // OpenRouter cross-surface gap (independent v9 audit Gap-1):
        // OpenRouter was offered to users in iOS PairingProviderConfig,
        // desktop-app onboarding, Tauri commands fallback list, and
        // OPENROUTER_API_KEY env discovery — but the registry switch
        // had no `case "openrouter":`, so a user pasting an `sk-or-…`
        // key got silent registry drop and no adapter. Now wired as
        // an OpenAI-compatible provider against `openrouter.ai/api/v1`.
        // Default model is a free, capable Llama variant so first-run
        // works without a paid plan; users override per-call.
        adapters.set(
          "openrouter",
          createOpenAICompatAdapter({
            provider: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
            apiKey: auth.token,
            defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              // Vision support is per-model on OpenRouter (claude-*, gpt-4o-*,
              // gemini-* support it; llama-* generally don't). Default to
              // false so unaware callers don't attach images that get dropped;
              // the model-router can flip this when a vision-capable model is
              // explicitly chosen.
              supportsVision: false,
              supportsStreaming: true,
              supportsThinking: false,
              // OpenRouter supports models up to 2M ctx (Gemini Pro 1.5);
              // declare the conservative 200K floor that most flagship
              // models offer so capacity assumptions don't over-promise.
              maxContextWindow: 200_000,
            },
          }),
        );
        break;
    }

    // Audit gap (T12.21): src/providers/opencode-sst-adapter.ts (sst/opencode
    // port) was written + tested but never registered, so `wotann login
    // opencode` could not produce an adapter. The OpenCode SST adapter
    // exposes its own surface (id "opencode-sst", an AsyncGenerator query,
    // listModels, isAvailable) — we wrap it inline into the canonical
    // ProviderAdapter shape so it slots into the rest of the registry's
    // Map<ProviderName, ProviderAdapter>. The cast to ProviderName is the
    // narrow, file-scoped concession needed to register a provider whose
    // name isn't yet in the central ProviderName union (extending that
    // union touches dozens of files; doing it here keeps the wiring
    // local until the union is expanded).
    if ((auth.provider as string) === "opencode" && !adapters.has(auth.provider)) {
      const inner = createOpenCodeSstAdapter({
        apiKey: auth.token,
      });
      const wrapped: ProviderAdapter = {
        id: inner.id,
        // Reuse the auth.provider string so downstream lookups (router,
        // rate-limiter) match the same key.
        name: auth.provider,
        transport: "chat_completions",
        capabilities: {
          supportsComputerUse: false,
          supportsToolCalling: true,
          supportsVision: false,
          supportsStreaming: true,
          supportsThinking: true,
          // OpenCode SST proxies to backing models; default to a generous
          // window since the actual ceiling depends on the chosen model.
          maxContextWindow: 131_072,
        },
        async *query(options) {
          const queryOptions: Parameters<typeof inner.query>[0] = {
            prompt: options.prompt,
            ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
            ...(options.messages !== undefined
              ? {
                  messages: options.messages.map((msg) => ({
                    role: msg.role as "user" | "assistant" | "system" | "tool",
                    content: msg.content,
                    ...(msg.toolCallId !== undefined ? { toolCallId: msg.toolCallId } : {}),
                    ...(msg.toolName !== undefined ? { toolName: msg.toolName } : {}),
                  })),
                }
              : {}),
            ...(options.model !== undefined ? { model: options.model } : {}),
            ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options.stream !== undefined ? { stream: options.stream } : {}),
            ...(options.tools !== undefined
              ? {
                  tools: options.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema,
                  })),
                }
              : {}),
          };
          for await (const chunk of inner.query(queryOptions)) {
            yield {
              type: chunk.type,
              content: chunk.content,
              ...(chunk.model !== undefined ? { model: chunk.model } : {}),
              provider: auth.provider,
              ...(chunk.tokensUsed !== undefined ? { tokensUsed: chunk.tokensUsed } : {}),
              ...(chunk.toolName !== undefined ? { toolName: chunk.toolName } : {}),
              ...(chunk.toolInput !== undefined ? { toolInput: chunk.toolInput } : {}),
              ...(chunk.toolCallId !== undefined ? { toolCallId: chunk.toolCallId } : {}),
              ...(chunk.stopReason !== undefined ? { stopReason: chunk.stopReason } : {}),
              ...(chunk.usage !== undefined
                ? {
                    usage: {
                      inputTokens: chunk.usage.inputTokens,
                      outputTokens: chunk.usage.outputTokens,
                    },
                  }
                : {}),
            };
          }
        },
        listModels: () => inner.listModels(),
        isAvailable: () => inner.isAvailable(),
      };
      adapters.set(auth.provider, wrapped);
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
