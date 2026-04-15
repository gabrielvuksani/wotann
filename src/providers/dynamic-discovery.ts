/**
 * Dynamic Model Discovery — query each provider's API for available models.
 * No hardcoded model lists. Models are fetched at runtime based on configured credentials.
 *
 * Endpoints:
 * - OpenAI: GET /v1/models
 * - Anthropic: GET /v1/models (rich capabilities)
 * - Google Gemini: GET /v1beta/models
 * - Ollama: GET /api/tags (local, no auth)
 * - GitHub Copilot: GET /catalog/models
 */

export interface DiscoveredModel {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly capabilities: readonly string[];
  readonly tier?: string; // "free" | "pro" | "enterprise"
}

interface ProviderCredentials {
  readonly anthropicKey?: string;
  readonly openaiKey?: string;
  readonly geminiKey?: string;
  readonly githubToken?: string;
  readonly ollamaHost?: string;
  readonly groqKey?: string;
}

/**
 * Discover all available models across configured providers.
 * Queries each provider API in parallel, returns unified model list.
 */
export async function discoverModels(
  creds: ProviderCredentials,
): Promise<readonly DiscoveredModel[]> {
  const promises: Promise<readonly DiscoveredModel[]>[] = [];

  if (creds.ollamaHost || isOllamaRunning()) {
    promises.push(discoverOllamaModels(creds.ollamaHost ?? "http://localhost:11434"));
  }
  if (creds.anthropicKey) {
    promises.push(discoverAnthropicModels(creds.anthropicKey));
  }
  if (creds.openaiKey) {
    promises.push(discoverOpenAIModels(creds.openaiKey));
  }
  if (creds.geminiKey) {
    promises.push(discoverGeminiModels(creds.geminiKey));
  }
  if (creds.githubToken) {
    promises.push(discoverGitHubModels(creds.githubToken));
  }
  if (creds.groqKey) {
    promises.push(discoverGroqModels(creds.groqKey));
  }

  const results = await Promise.allSettled(promises);
  const models: DiscoveredModel[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      models.push(...result.value);
    }
  }
  return models;
}

// ── Ollama (Local) ────────────────────────────────────

async function discoverOllamaModels(host: string): Promise<readonly DiscoveredModel[]> {
  try {
    const resp = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      models?: Array<{
        name: string;
        details?: { parameter_size?: string; family?: string; quantization_level?: string };
      }>;
    };
    return (data.models ?? []).map((m) => ({
      id: m.name,
      name: m.name.split(":")[0] ?? m.name,
      provider: "ollama",
      capabilities: ["chat", "completion"],
      tier: "free",
      maxInputTokens: guessOllamaContext(m.details?.parameter_size),
    }));
  } catch {
    return [];
  }
}

function guessOllamaContext(paramSize?: string): number {
  if (!paramSize) return 8192;
  const num = parseFloat(paramSize);
  if (num >= 70) return 131072;
  if (num >= 27) return 131072;
  if (num >= 8) return 131072;
  return 8192;
}

function isOllamaRunning(): boolean {
  // Synchronous check not available with fetch; this is an optimistic
  // pre-flight — the actual async fetch call downstream handles the
  // connect failure via its own timeout and error path.
  return true;
}

// ── Anthropic ─────────────────────────────────────────

async function discoverAnthropicModels(apiKey: string): Promise<readonly DiscoveredModel[]> {
  try {
    const resp = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      data?: Array<{
        id: string;
        display_name?: string;
        max_input_tokens?: number;
        max_tokens?: number;
        capabilities?: Record<string, { supported?: boolean }>;
      }>;
    };
    return (data.data ?? []).map((m) => {
      const caps: string[] = ["chat"];
      if (m.capabilities) {
        if (m.capabilities["image_input"]?.supported) caps.push("vision");
        if (m.capabilities["thinking"]?.supported) caps.push("thinking");
        if (m.capabilities["code_execution"]?.supported) caps.push("code_execution");
        if (m.capabilities["pdf_input"]?.supported) caps.push("pdf");
      }
      return {
        id: m.id,
        name: m.display_name ?? m.id,
        provider: "anthropic",
        maxInputTokens: m.max_input_tokens,
        maxOutputTokens: m.max_tokens,
        capabilities: caps,
      };
    });
  } catch {
    return [];
  }
}

// ── OpenAI ────────────────────────────────────────────

async function discoverOpenAIModels(apiKey: string): Promise<readonly DiscoveredModel[]> {
  try {
    const resp = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: Array<{ id: string; owned_by?: string }> };
    // Filter to chat-capable models (skip embeddings, tts, whisper, dall-e)
    const chatModels = (data.data ?? []).filter((m) => {
      const id = m.id.toLowerCase();
      return (
        (id.includes("gpt") || id.includes("o1") || id.includes("o3") || id.includes("o4")) &&
        !id.includes("embedding") &&
        !id.includes("tts") &&
        !id.includes("whisper") &&
        !id.includes("dall-e") &&
        !id.includes("realtime")
      );
    });
    return chatModels.map((m) => ({
      id: m.id,
      name: m.id,
      provider: "openai",
      capabilities: ["chat"],
    }));
  } catch {
    return [];
  }
}

// ── Google Gemini ──────────────────────────────────────

async function discoverGeminiModels(apiKey: string): Promise<readonly DiscoveredModel[]> {
  try {
    // SECURITY (B2): pass the API key via the `x-goog-api-key` header instead
    // of the query string, so it does not show up in server access logs.
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=50`,
      {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      models?: Array<{
        name: string;
        displayName?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedGenerationMethods?: string[];
      }>;
    };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => ({
        id: m.name.replace("models/", ""),
        name: m.displayName ?? m.name.replace("models/", ""),
        provider: "google",
        maxInputTokens: m.inputTokenLimit,
        maxOutputTokens: m.outputTokenLimit,
        capabilities: ["chat"],
        tier: "free",
      }));
  } catch {
    return [];
  }
}

// ── GitHub Copilot ────────────────────────────────────

async function discoverGitHubModels(token: string): Promise<readonly DiscoveredModel[]> {
  try {
    const resp = await fetch("https://models.github.ai/catalog/models", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as Array<{
      id: string;
      name?: string;
      publisher?: string;
      rate_limit_tier?: string;
      limits?: { max_input_tokens?: number; max_output_tokens?: number };
      capabilities?: string[];
    }>;
    return data.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      provider: "github-copilot",
      maxInputTokens: m.limits?.max_input_tokens,
      maxOutputTokens: m.limits?.max_output_tokens,
      capabilities: m.capabilities ?? ["chat"],
      tier: m.rate_limit_tier,
    }));
  } catch {
    return [];
  }
}

// ── Groq ──────────────────────────────────────────────

async function discoverGroqModels(apiKey: string): Promise<readonly DiscoveredModel[]> {
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: Array<{ id: string; owned_by?: string }> };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      provider: "groq",
      capabilities: ["chat"],
      tier: "free",
    }));
  } catch {
    return [];
  }
}
