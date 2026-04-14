import { describe, it, expect } from "vitest";
import { AgentBridge } from "../../src/core/agent-bridge.js";
import { ModelRouter } from "../../src/providers/model-router.js";
import { RateLimitManager } from "../../src/providers/rate-limiter.js";
import { AccountPool } from "../../src/providers/account-pool.js";
import type { ProviderAdapter } from "../../src/providers/types.js";

describe("AgentBridge", () => {
  it("rotates to the next account on rate limit before leaving the provider", async () => {
    const accountPool = new AccountPool();
    accountPool.addAccount({
      id: "openai-1",
      provider: "openai",
      token: "key-1",
      type: "api-key",
      priority: 1,
    });
    accountPool.addAccount({
      id: "openai-2",
      provider: "openai",
      token: "key-2",
      type: "api-key",
      priority: 2,
    });

    const adapter: ProviderAdapter = {
      id: "openai",
      name: "openai",
      transport: "chat_completions",
      capabilities: {
        supportsComputerUse: false,
        supportsToolCalling: true,
        supportsVision: true,
        supportsStreaming: true,
        supportsThinking: true,
        maxContextWindow: 128_000,
      },
      async *query(options) {
        if (options.authToken === "key-1") {
          yield {
            type: "error",
            content: "rate limit exceeded",
            provider: "openai",
          };
          return;
        }

        yield {
          type: "text",
          content: "success via second key",
          provider: "openai",
          model: "gpt-5.4",
        };
        yield {
          type: "done",
          content: "",
          provider: "openai",
          model: "gpt-5.4",
          tokensUsed: 42,
        };
      },
      async listModels() {
        return ["gpt-5.4"];
      },
      async isAvailable() {
        return true;
      },
    };

    const bridge = new AgentBridge({
      adapters: new Map([["openai", adapter]]),
      router: new ModelRouter({ availableProviders: new Set(["openai"]), ollamaModels: [] }),
      rateLimiter: new RateLimitManager(["openai"]),
      accountPool,
      defaultProvider: "openai",
      defaultModel: "gpt-5.4",
    });

    const chunks: Array<{ type: string; content: string }> = [];
    for await (const chunk of bridge.query({
      prompt: "hello",
      provider: "openai",
      model: "gpt-5.4",
    })) {
      chunks.push({ type: chunk.type, content: chunk.content });
    }

    expect(chunks.some((chunk) => chunk.type === "text" && chunk.content.includes("second key"))).toBe(true);
    expect(accountPool.getHealth("openai-1")?.rateLimitedUntil ?? 0).toBeGreaterThan(0);
    expect(accountPool.getHealth("openai-2")?.requestCount).toBe(1);
  });
});
