/**
 * OpenCode (sst) provider adapter.
 *
 * PORT OF: sst/opencode — SST's AI code assistant (github.com/sst/opencode,
 * 147k+ stars). OpenCode SST is a CLI-first coding agent that speaks an
 * OpenAI-compatible wire format with SST-specific extensions. This
 * adapter lets WOTANN consumers select "opencode" as their provider and
 * get streaming chat completions + tool calling + usage accounting the
 * same way they'd get from the built-in OpenAI adapter.
 *
 * API SURFACE:
 *   POST /v1/chat/completions            — OpenAI-compat streaming SSE
 *   GET  /v1/models                      — list available backing models
 *   GET  /health                         — liveness probe
 *
 * RELATIONSHIP TO EXISTING MODULES:
 *   - src/providers/openai-compat-adapter.ts — OpenAI-compat SSE parsing
 *     + tool-call reassembly lives there. We DO NOT call into it
 *     directly because the caller-side composition (registry +
 *     model-router) is owned by another agent's file set. Instead we
 *     ship this as a DROP-IN adapter with its own query lifecycle and
 *     expose an OpenAI-compat factory so the registry can register
 *     OpenCode SST under whatever ProviderName it decides.
 *   - src/providers/types.ts — we re-export the public types from here
 *     so this file remains self-contained for the tests.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): every non-2xx yields an "error" chunk
 *     with typed message; malformed tool-call JSON surfaces as an
 *     error chunk, not a silent drop.
 *   - QB #7 (per-session state): createOpenCodeSstAdapter() returns a
 *     closure; two adapters never share auth headers or usage counters.
 *   - QB #11 (sibling-site scan): registry.ts lives under another
 *     agent's ownership; we expose a minimal contract so registration
 *     is a one-line site update when that agent's fileset lands.
 *   - QB #13 (env guard): zero process.env reads. apiKey + baseUrl are
 *     injected at construction time.
 *   - QB #15 (immutable data): every stream chunk is a fresh object;
 *     no mutation of shared state across yields.
 */

// ── Wire-level types ─────────────────────────────────────

/**
 * OpenCode-SST tool schema — OpenAI-compat with a slight SST twist
 * (`sst_function_type` tag used by some SST skills). We accept that
 * field when present but never require it, and always forward a clean
 * OpenAI-shaped `{type: "function", function: {name, description,
 * parameters}}` to the server.
 */
export interface OpenCodeToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface OpenCodeMessage {
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
}

export interface OpenCodeQueryOptions {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly messages?: readonly OpenCodeMessage[];
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly stream?: boolean;
  readonly tools?: readonly OpenCodeToolSchema[];
}

/** Shape of the yielded stream pieces. OpenAI-compat vocabulary. */
export interface OpenCodeStreamChunk {
  readonly type: "text" | "tool_use" | "thinking" | "done" | "error";
  readonly content: string;
  readonly model?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly tokensUsed?: number;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly stopReason?: "stop" | "tool_calls" | "max_tokens" | "content_filter" | "error";
}

/**
 * Opaque adapter surface. Mirrors WOTANN's ProviderAdapter shape so a
 * registration PR can bind this directly — but we keep the signatures
 * local so the tests don't need the broader types.
 */
export interface OpenCodeSstAdapter {
  readonly id: "opencode-sst";
  readonly query: (options: OpenCodeQueryOptions) => AsyncGenerator<OpenCodeStreamChunk>;
  readonly listModels: () => Promise<readonly string[]>;
  readonly isAvailable: () => Promise<boolean>;
}

// ── Config ────────────────────────────────────────────────

export interface OpenCodeSstConfig {
  /** OpenCode SST endpoint. Defaults to "https://api.opencode.sst.dev". */
  readonly baseUrl?: string;
  /** Bearer token — held in closure, never leaked. */
  readonly apiKey: string;
  /** Default model to use when a query omits one. Defaults to "default". */
  readonly defaultModel?: string;
  /** Injected fetch for testability. */
  readonly fetcher?: OpenCodeFetcher;
  /** Extra headers forwarded on every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Clock for deterministic tests. */
  readonly now?: () => number;
}

export type OpenCodeFetcher = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
  readonly body: ReadableStream<Uint8Array> | null;
}>;

// ── Factory ───────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://api.opencode.sst.dev";
const DEFAULT_MODEL = "default";

export function createOpenCodeSstAdapter(config: OpenCodeSstConfig): OpenCodeSstAdapter {
  validate(config);

  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  const fetcher: OpenCodeFetcher = config.fetcher ?? defaultFetcher;

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(config.headers ?? {}),
    };
  }

  async function* query(options: OpenCodeQueryOptions): AsyncGenerator<OpenCodeStreamChunk> {
    const model = options.model ?? defaultModel;
    const url = `${baseUrl}/v1/chat/completions`;

    const messages = buildMessages(options);
    const tools =
      options.tools && options.tools.length > 0 ? toOpenAITools(options.tools) : undefined;
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    };

    let response: Awaited<ReturnType<OpenCodeFetcher>>;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield {
        type: "error",
        content: `opencode-sst transport error: ${err instanceof Error ? err.message : String(err)}`,
        model,
      };
      return;
    }

    if (!response.ok) {
      const errorText = await safeText(response);
      yield {
        type: "error",
        content: `opencode-sst HTTP ${response.status}: ${errorText.slice(0, 256)}`,
        model,
      };
      return;
    }

    if (!response.body) {
      yield {
        type: "error",
        content: "opencode-sst: empty response body",
        model,
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" = "stop";
    const toolCallState = new Map<
      number,
      { id: string; name: string; args: string; emitted: boolean }
    >();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          let parsed: OpenAiSseChunk;
          try {
            parsed = JSON.parse(data) as OpenAiSseChunk;
          } catch {
            continue;
          }

          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            yield { type: "text", content: delta.content, model };
          }
          const thinking = delta?.reasoning ?? delta?.reasoning_content;
          if (thinking) {
            yield { type: "thinking", content: thinking, model };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallState.get(idx) ?? {
                id: "",
                name: "",
                args: "",
                emitted: false,
              };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
              toolCallState.set(idx, existing);
            }
          }
          const finish = parsed.choices?.[0]?.finish_reason;
          if (finish) stopReason = mapFinishReason(finish);
          if (parsed.usage?.total_tokens) totalTokens = parsed.usage.total_tokens;
          if (parsed.usage?.prompt_tokens) inputTokens = parsed.usage.prompt_tokens;
          if (parsed.usage?.completion_tokens) outputTokens = parsed.usage.completion_tokens;
        }
      }
    } catch (err) {
      yield {
        type: "error",
        content: `opencode-sst stream error: ${err instanceof Error ? err.message : String(err)}`,
        model,
      };
      return;
    }

    // Emit accumulated tool calls before the final chunk.
    for (const state of toolCallState.values()) {
      if (state.emitted || !state.name) continue;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs =
          state.args.length > 0 ? (JSON.parse(state.args) as Record<string, unknown>) : {};
      } catch {
        yield {
          type: "error",
          content: `opencode-sst: malformed tool arguments for ${state.name}`,
          model,
        };
        state.emitted = true;
        continue;
      }
      yield {
        type: "tool_use",
        content: state.args,
        toolName: state.name,
        toolCallId: state.id,
        toolInput: parsedArgs,
        model,
        stopReason: "tool_calls",
      };
      state.emitted = true;
      stopReason = "tool_calls";
    }

    const finalInput = inputTokens > 0 ? inputTokens : Math.floor(totalTokens / 2);
    const finalOutput = outputTokens > 0 ? outputTokens : Math.max(0, totalTokens - finalInput);
    yield {
      type: "done",
      content: "",
      model,
      tokensUsed: totalTokens,
      usage: {
        inputTokens: finalInput,
        outputTokens: finalOutput,
      },
      stopReason,
    };
  }

  async function listModels(): Promise<readonly string[]> {
    try {
      const resp = await fetcher(`${baseUrl}/v1/models`, {
        method: "GET",
        headers: authHeaders(),
      });
      if (!resp.ok) return [defaultModel];
      const json = await safeJson(resp);
      if (json && typeof json === "object") {
        const obj = json as { data?: readonly { id?: string }[] };
        if (Array.isArray(obj.data)) {
          const ids = obj.data
            .map((e) => (typeof e.id === "string" ? e.id : undefined))
            .filter((s): s is string => typeof s === "string" && s.length > 0);
          if (ids.length > 0) return ids;
        }
      }
      return [defaultModel];
    } catch {
      return [defaultModel];
    }
  }

  async function isAvailable(): Promise<boolean> {
    try {
      const resp = await fetcher(`${baseUrl}/health`, {
        method: "GET",
        headers: authHeaders(),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  return {
    id: "opencode-sst",
    query,
    listModels,
    isAvailable,
  };
}

// ── Helpers ──────────────────────────────────────────────

function validate(config: OpenCodeSstConfig): void {
  if (!config) throw new Error("opencode-sst: config required");
  if (!config.apiKey || typeof config.apiKey !== "string") {
    throw new Error("opencode-sst: apiKey (string) required");
  }
  if (config.baseUrl !== undefined) {
    if (typeof config.baseUrl !== "string" || !/^https?:\/\//.test(config.baseUrl)) {
      throw new Error("opencode-sst: baseUrl must be an http(s) URL");
    }
  }
}

function buildMessages(options: OpenCodeQueryOptions): readonly Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (options.systemPrompt) {
    out.push({ role: "system", content: options.systemPrompt });
  }
  if (options.messages) {
    for (const msg of options.messages) {
      if (msg.role === "tool") {
        out.push({
          role: "tool",
          content: msg.content,
          tool_call_id: msg.toolCallId,
          ...(msg.toolName !== undefined ? { name: msg.toolName } : {}),
        });
      } else {
        out.push({ role: msg.role, content: msg.content });
      }
    }
  }
  out.push({ role: "user", content: options.prompt });
  return out;
}

function toOpenAITools(tools: readonly OpenCodeToolSchema[]): readonly Record<string, unknown>[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

function mapFinishReason(reason: string): "stop" | "tool_calls" | "max_tokens" | "content_filter" {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

interface OpenAiSseChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string;
      readonly role?: string;
      readonly reasoning?: string;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly {
        readonly index?: number;
        readonly id?: string;
        readonly function?: {
          readonly name?: string;
          readonly arguments?: string;
        };
      }[];
    };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

async function safeText(response: { readonly text: () => Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function safeJson(response: { readonly json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Build an in-memory ReadableStream from a string of SSE lines.
 * Exposed so tests can construct a realistic body without mocking the
 * fetch internals. Uses a typed-array encoder so the chunking matches
 * what an HTTP transport would deliver.
 */
export function sseReadableStream(body: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

/** Build an SSE body text from a list of OpenAI-compat chunks. */
export function toSseBody(chunks: readonly unknown[]): string {
  const lines: string[] = [];
  for (const c of chunks) {
    lines.push(`data: ${JSON.stringify(c)}`);
    lines.push("");
  }
  lines.push("data: [DONE]");
  lines.push("");
  return lines.join("\n");
}

// ── Default fetcher ──────────────────────────────────────

const defaultFetcher: OpenCodeFetcher = async (url, init) => {
  const resp = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
  });
  return {
    ok: resp.ok,
    status: resp.status,
    text: () => resp.text(),
    json: () => resp.json(),
    body: resp.body,
  };
};
