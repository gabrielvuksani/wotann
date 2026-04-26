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
import { createBedrockAdapter } from "./bedrock-signer.js";
import { createVertexAdapter } from "./vertex-oauth.js";
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
      case "azure": {
        // Azure uses /openai/deployments/{deployment}/chat/completions with
        // `api-version` as a query param (not a header). The audit found
        // that session-8's config used the endpoint verbatim + a header,
        // which Azure rejects (expects path-level deployment + query
        // param). Also surface a deployment name from env so the registry
        // isn't hardcoded to gpt-4o.
        const endpoint = (process.env["AZURE_OPENAI_ENDPOINT"] ?? "").replace(/\/+$/, "");
        const deployment =
          process.env["AZURE_OPENAI_DEPLOYMENT"] ??
          process.env["AZURE_OPENAI_DEPLOYMENT_NAME"] ??
          "gpt-4o";
        const apiVersion = process.env["AZURE_OPENAI_API_VERSION"] ?? "2024-12-01-preview";
        const baseUrl = endpoint
          ? `${endpoint}/openai/deployments/${deployment}?api-version=${apiVersion}`
          : "";
        adapters.set(
          "azure",
          createOpenAICompatAdapter({
            provider: "azure",
            baseUrl,
            apiKey: auth.token,
            defaultModel: deployment,
            models: auth.models,
            capabilities: {
              supportsComputerUse: false,
              supportsToolCalling: true,
              supportsVision: true,
              supportsStreaming: true,
              supportsThinking: true,
              maxContextWindow: getMaxContextWindow("openai", "gpt-4.1"),
            },
            // Azure uses `api-key` header style instead of Bearer. api-version
            // already lives in the query string above.
            headers: { "api-key": auth.token },
          }),
        );
        break;
      }
      case "bedrock":
        // Session-10 audit fix: Bedrock requires AWS SigV4 signing + the
        // `/converse` or `/invoke-model` path, not `/chat/completions`
        // with a Bearer token. The prior fabricated adapter would 403
        // on every real request. We now hand-build a SigV4-signed
        // adapter via `bedrock-signer.ts` which implements canonical
        // request hashing + HMAC-SHA256 key derivation per the AWS
        // SigV4 spec — no `@aws-sdk/client-bedrock-runtime` dependency.
        adapters.set("bedrock", createBedrockAdapter(auth));
        break;
      case "vertex":
        // Session-10 audit fix: Vertex requires Google OAuth2 access-token
        // exchange (JWT-signed with the service-account private key,
        // exchanged against `oauth2.googleapis.com/token` for a Bearer).
        // The prior fabricated adapter passed the JSON key *file path*
        // as the bearer token — every real request 401'd. Now a lazy
        // adapter handles the JWT exchange inline.
        adapters.set("vertex", createVertexAdapter(auth));
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
