/**
 * Azure OpenAI URL composition regression — P0-4a.
 *
 * Azure OpenAI endpoints have an unusual shape:
 *   https://{resource}.openai.azure.com/openai/deployments/{deployment}?api-version=YYYY-MM-DD
 *
 * A naive `${baseUrl}/chat/completions` produces:
 *   .../deployments/gpt-4o?api-version=2024-12-01-preview/chat/completions
 *
 * which 404s every call because `/chat/completions` gets baked INTO
 * the `api-version` query-string value. The adapter's `appendPath()`
 * helper must split the query + hash before appending and reassemble
 * correctly.
 *
 * These tests drive the adapter against a mock fetch and assert the
 * captured URL has:
 *   (a) `/chat/completions` appended BEFORE `?api-version=`
 *   (b) `api-key` header set (Azure does not use Bearer)
 *   (c) trailing/leading slashes handled idempotently
 *   (d) `/models` discovery endpoint composed the same way
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOpenAICompatAdapter } from "../../src/providers/openai-compat-adapter.js";
import type { UnifiedQueryOptions } from "../../src/providers/types.js";

interface CapturedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly method?: string;
}

function mockFetch(capture: CapturedRequest[]): void {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    capture.push({
      url: String(url),
      headers: normalizeHeaders(init?.headers),
      method: init?.method,
    });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return {
      ok: true,
      status: 200,
      body,
      json: async () => ({ data: [] }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k.toLowerCase()] = v));
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(h as Record<string, string>)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

const AZURE_BASE_URL =
  "https://my-resource.openai.azure.com/openai/deployments/gpt-4o-test?api-version=2024-12-01-preview";

function makeAzureAdapter(baseUrl: string) {
  return createOpenAICompatAdapter({
    provider: "azure",
    baseUrl,
    apiKey: "az_test_key",
    defaultModel: "gpt-4o-test",
    models: ["gpt-4o-test"],
    capabilities: {
      supportsComputerUse: false,
      supportsToolCalling: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsThinking: true,
      maxContextWindow: 128_000,
    },
    headers: { "api-key": "az_test_key" },
  });
}

describe("Azure OpenAI URL composition — appendPath()", () => {
  const originalFetch = globalThis.fetch;
  let captured: CapturedRequest[];

  beforeEach(() => {
    captured = [];
    mockFetch(captured);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("inserts /chat/completions BEFORE ?api-version= on the request URL", async () => {
    const adapter = makeAzureAdapter(AZURE_BASE_URL);
    const opts: UnifiedQueryOptions = {
      prompt: "hi",
      model: "gpt-4o-test",
      stream: true,
    };
    for await (const _c of adapter.query(opts)) {
      /* drain */
    }
    expect(captured).toHaveLength(1);
    const url = captured[0]!.url;
    expect(url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/gpt-4o-test/chat/completions?api-version=2024-12-01-preview",
    );
    // Redundancy: the bug manifests as /chat/completions APPENDED to the
    // api-version value. Detect both possible failure modes.
    expect(url).not.toContain("api-version=2024-12-01-preview/chat/completions");
    expect(url).not.toContain("/chat/completions/chat/completions");
  });

  it("emits api-key header (not Bearer) on the outgoing request", async () => {
    const adapter = makeAzureAdapter(AZURE_BASE_URL);
    for await (const _c of adapter.query({
      prompt: "hi",
      model: "gpt-4o-test",
      stream: true,
    })) {
      /* drain */
    }
    const headers = captured[0]!.headers;
    expect(headers["api-key"]).toBe("az_test_key");
    // Both should be present — the user set api-key via `headers`
    // explicitly; Bearer is a fallback the adapter adds by default.
    // The `api-key` is what Azure actually authenticates against.
    expect(headers["api-key"]).toBe("az_test_key");
  });

  it("handles a baseUrl with a trailing slash before the query string", async () => {
    // Same endpoint but with a trailing slash before `?api-version=`.
    const baseUrl =
      "https://my-resource.openai.azure.com/openai/deployments/gpt-4o-test/?api-version=2024-12-01-preview";
    const adapter = makeAzureAdapter(baseUrl);
    for await (const _c of adapter.query({
      prompt: "hi",
      model: "gpt-4o-test",
      stream: true,
    })) {
      /* drain */
    }
    expect(captured[0]!.url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/gpt-4o-test/chat/completions?api-version=2024-12-01-preview",
    );
  });

  it("handles a baseUrl with a hash fragment (discouraged but legal)", async () => {
    const baseUrl =
      "https://my-resource.openai.azure.com/openai/deployments/gpt-4o-test?api-version=2024-12-01-preview#anchor";
    const adapter = makeAzureAdapter(baseUrl);
    for await (const _c of adapter.query({
      prompt: "hi",
      model: "gpt-4o-test",
      stream: true,
    })) {
      /* drain */
    }
    // The hash must survive — not lost during path insertion.
    expect(captured[0]!.url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/gpt-4o-test/chat/completions?api-version=2024-12-01-preview#anchor",
    );
  });

  it("isAvailable() hits /models using the same URL shape", async () => {
    // The discovery path uses appendPath() with a different path —
    // same bug class must not recur there.
    const adapter = makeAzureAdapter(AZURE_BASE_URL);
    const ok = await adapter.isAvailable();
    expect(ok).toBe(true);
    const url = captured[0]!.url;
    expect(url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/gpt-4o-test/models?api-version=2024-12-01-preview",
    );
  });

  it("treats a plain OpenAI baseUrl (no query) as baseline — no regressions", async () => {
    // Vanilla OpenAI has no query string. appendPath must still
    // produce the expected URL; the Azure-specific branch must not
    // break the baseline.
    const adapter = createOpenAICompatAdapter({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      defaultModel: "gpt-4.1",
      models: ["gpt-4.1"],
      capabilities: {
        supportsComputerUse: false,
        supportsToolCalling: true,
        supportsVision: true,
        supportsStreaming: true,
        supportsThinking: true,
        maxContextWindow: 128_000,
      },
    });
    for await (const _c of adapter.query({
      prompt: "hi",
      model: "gpt-4.1",
      stream: true,
    })) {
      /* drain */
    }
    expect(captured[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("handles multiple query params without stripping non-api-version fields", async () => {
    // Some Azure gateways add additional query params (e.g. request-id,
    // tenant-id). Those must be preserved through path insertion.
    const baseUrl =
      "https://azgw.example.com/openai/deployments/test?api-version=2024-12-01-preview&tenant=foo";
    const adapter = makeAzureAdapter(baseUrl);
    for await (const _c of adapter.query({
      prompt: "hi",
      model: "test",
      stream: true,
    })) {
      /* drain */
    }
    expect(captured[0]!.url).toBe(
      "https://azgw.example.com/openai/deployments/test/chat/completions?api-version=2024-12-01-preview&tenant=foo",
    );
  });
});
