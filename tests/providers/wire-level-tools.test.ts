/**
 * Wire-level coverage: every provider adapter actually serializes `tools`
 * onto the outbound HTTP request body when a caller supplies them.
 *
 * Session-10 audit finding: MASTER_AUDIT §10 + the re-audit dispatched
 * this session both confirmed that pre-session-1 Anthropic / Codex /
 * Copilot / openai-compat adapters silently stripped `tools:` from their
 * requests — the "capability equalization" moat was broken in 4 of 5
 * adapters. Session-1 fixed the strip but only Copilot + Codex shipped
 * wire-level regression tests (tests/providers/adapter-multi-turn.test.ts
 * covers those two). The remaining 16+ adapters had no wire-level
 * coverage at all.
 *
 * This file closes the gap by intercepting `fetch`, driving each
 * adapter through a single `query()` call with a minimal tool schema,
 * and asserting the captured request body contains a `tools` field
 * (or the provider-specific equivalent for non-OpenAI-compat shapes).
 *
 * For providers that wrap `createOpenAICompatAdapter` we only check
 * one representative since the compat path is shared — running 10
 * identical assertions would be noise. A dedicated compat-path test
 * captures that the shared builder always serializes tools.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createAnthropicAdapter,
} from "../../src/providers/anthropic-adapter.js";
import { createCodexAdapter } from "../../src/providers/codex-adapter.js";
import { createCopilotAdapter } from "../../src/providers/copilot-adapter.js";
import {
  createOpenAIAdapter,
  createOpenAICompatAdapter,
} from "../../src/providers/openai-compat-adapter.js";
import { createGeminiNativeAdapter } from "../../src/providers/gemini-native-adapter.js";
import type { ToolSchema, UnifiedQueryOptions } from "../../src/providers/types.js";

const TEST_TOOL: ToolSchema = {
  name: "echo",
  description: "Echo the input back",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
};

/** Drain an async generator into a single collected string. */
async function drain(gen: AsyncGenerator<{ content: string }>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk.content;
  return out;
}

function buildEmptyStreamResponse(lastCalledBody: { value?: unknown }) {
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    // Some adapters hit a token-exchange endpoint first; return a bland
    // success for those and only capture the body on the actual model
    // endpoint (which is always a POST with tools+messages).
    if (init?.body && init.method === "POST") {
      try {
        lastCalledBody.value = JSON.parse(init.body as string);
      } catch {
        lastCalledBody.value = init.body;
      }
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    // Some adapters also call json() on the token exchange. Return empty.
    return {
      ok: true,
      status: 200,
      body,
      json: async () => ({ token: "t", expires_at: Date.now() + 60_000 }),
      text: async () => "",
    } as unknown as Response;
  });
}

describe("wire-level tools serialization — every adapter family", () => {
  const originalFetch = globalThis.fetch;
  const captured: { value?: unknown } = {};

  beforeEach(() => {
    captured.value = undefined;
    globalThis.fetch = buildEmptyStreamResponse(captured) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("anthropic: tools[] present on the `/v1/messages` request", async () => {
    const adapter = createAnthropicAdapter("sk-ant-test");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "claude-sonnet-4-6",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools?.length).toBeGreaterThan(0);
  });

  it("openai-compat (OpenAI flavour): tools[] present", async () => {
    const adapter = createOpenAIAdapter("sk-openai-test");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gpt-4o",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools?.length).toBeGreaterThan(0);
  });

  it("openai-compat (generic — covers groq/mistral/deepseek/perplexity/xai/together/fireworks/sambanova/hf): tools[] present", async () => {
    // The 9 third-party compat providers share this builder. One shared
    // assertion covers all of them because the compat path is identical
    // aside from baseUrl + apiKey.
    const adapter = createOpenAICompatAdapter({
      provider: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: "mstrl-test",
      defaultModel: "mistral-large-latest",
      models: ["mistral-large-latest"],
      capabilities: {
        supportsComputerUse: false,
        supportsToolCalling: true,
        supportsVision: false,
        supportsStreaming: true,
        supportsThinking: false,
        maxContextWindow: 32_768,
      },
    });
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "mistral-large-latest",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it("codex: tools[] present on the `/v1/responses` request", async () => {
    const adapter = createCodexAdapter("cdx-test");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gpt-5-codex",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it("copilot: tools[] present on the chat-completions request", async () => {
    const adapter = createCopilotAdapter("ghp_test");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "claude-sonnet-4",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as { tools?: unknown[] };
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it("gemini-native: tools translated to `tools: [{ functionDeclarations }]`", async () => {
    const adapter = createGeminiNativeAdapter("AIzaTest");
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gemini-2.5-pro",
      tools: [TEST_TOOL],
      stream: true,
    };
    await drain(adapter.query(opts) as AsyncGenerator<{ content: string }>).catch(() => {});
    expect(captured.value).toBeDefined();
    const body = captured.value as {
      tools?: readonly { functionDeclarations?: readonly unknown[] }[];
    };
    // Gemini uses a different envelope than OpenAI-compat: `tools` is an
    // array of one object with a `functionDeclarations` field. Just verify
    // the envelope is non-empty — the format-translator test covers the
    // exact shape conversion.
    expect(Array.isArray(body.tools)).toBe(true);
    expect((body.tools?.[0]?.functionDeclarations ?? []).length).toBeGreaterThan(0);
  });
});
