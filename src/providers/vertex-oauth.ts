/**
 * Google Vertex AI adapter with real OAuth2 access-token exchange.
 *
 * Session-10 audit fix: the prior Vertex registration passed the
 * service-account JSON file *path* as the Bearer token and hit
 * `/chat/completions`. Real auth requires:
 *   1. Read the service-account JSON (`GOOGLE_APPLICATION_CREDENTIALS`).
 *   2. Build a signed JWT (RS256) with audience
 *      `https://oauth2.googleapis.com/token` and scope
 *      `https://www.googleapis.com/auth/cloud-platform`.
 *   3. POST the JWT to `oauth2.googleapis.com/token` → access token + expiry.
 *   4. Cache the access token until ~5 min before expiry.
 *   5. Call Vertex's REST endpoint with `Authorization: Bearer <access_token>`.
 *
 * Inline implementation using `node:crypto.createSign` — no
 * `google-auth-library` dep (100+ KB).
 */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import type { ProviderAuth } from "../core/types.js";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
  StopReason,
} from "./types.js";
import { openAIToAnthropic } from "./format-translator.js";

/**
 * Map Anthropic's raw stop_reason to the normalised StopReason vocabulary.
 * Vertex Claude streams the same values as native Anthropic — see types.ts.
 */
function mapStop(reason: string | undefined): StopReason {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  return "stop";
}

interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
  readonly project_id: string;
  readonly token_uri?: string;
}

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

function loadServiceAccount(): ServiceAccountKey | null {
  const path = process.env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (!path) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    return parsed as ServiceAccountKey;
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildSignedJwt(sa: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(sa.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

const tokenCache = new Map<string, CachedToken>();

async function exchangeJwtForAccessToken(sa: ServiceAccountKey): Promise<string> {
  const cached = tokenCache.get(sa.client_email);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.token;
  const jwt = buildSignedJwt(sa);
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Vertex OAuth2 exchange ${res.status}: ${err.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) {
    throw new Error("Vertex OAuth2 exchange returned no access_token");
  }
  const entry: CachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  tokenCache.set(sa.client_email, entry);
  return entry.token;
}

export function createVertexAdapter(auth: ProviderAuth): ProviderAdapter {
  // No hardcoded default model / vendor bias. The caller must pick.
  const defaultModel = auth.models?.[0];
  const region = process.env["GOOGLE_CLOUD_REGION"] ?? "us-central1";
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    // Conservative static capability ceiling — the runtime refines this
    // per-query via getMaxContextWindow(provider, model).
    maxContextWindow: 128_000,
  };

  async function* queryImpl(opts: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const sa = loadServiceAccount();
    if (!sa) {
      yield {
        type: "error",
        content:
          "Vertex auth unavailable: set GOOGLE_APPLICATION_CREDENTIALS to the path of a service-account JSON key with the `aiplatform.user` role.",
        provider: "vertex",
        stopReason: "error",
      };
      return;
    }
    let token: string;
    try {
      token = await exchangeJwtForAccessToken(sa);
    } catch (err) {
      yield {
        type: "error",
        content: err instanceof Error ? err.message : String(err),
        provider: "vertex",
        stopReason: "error",
      };
      return;
    }
    const project =
      process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["GCP_PROJECT"] ?? sa.project_id;
    const model = opts.model ?? defaultModel;
    if (!model) {
      yield {
        type: "error",
        content:
          "Vertex adapter requires an explicit model — supply via opts.model or configure ProviderAuth.models. No vendor-biased default.",
        provider: "vertex",
        stopReason: "error",
      };
      return;
    }
    // Publisher resolved from model prefix — callers pick the vendor via
    // the model id rather than the adapter guessing. claude-…/gemini-…/
    // mistral-… route to the matching publisher; anything else defaults
    // to "google" (Vertex's home publisher) and lets the endpoint error
    // honestly on an unknown model.
    const lowered = model.toLowerCase();
    const publisher = lowered.startsWith("claude")
      ? "anthropic"
      : lowered.startsWith("gemini")
        ? "google"
        : lowered.startsWith("mistral")
          ? "mistralai"
          : "google";
    const url =
      `https://${region}-aiplatform.googleapis.com/v1/projects/${project}` +
      `/locations/${region}/publishers/${publisher}/models/${model}:streamRawPredict`;

    // Vertex Claude uses Anthropic's Messages API format (same schema as
    // /v1/messages, just fronted by Google's endpoint + OAuth2). Translate
    // the unified opts — multi-turn messages, tool_result blocks, system
    // prompt, tools — into Anthropic's wire format. Without this, multi-turn
    // agent loops die silently because the model only ever sees opts.prompt
    // and never the conversation context or tool_use/tool_result history.
    //
    // opts.messages is translated via the shared format-translator so the
    // Vertex path matches the native Anthropic path exactly (tool_use/tool_result
    // preserved across provider switches). We prepend the translated history
    // then append the current turn's user prompt.
    const anthropicMessages: Array<{ role: "user" | "assistant"; content: unknown }> = [];
    if (opts.messages && opts.messages.length > 0) {
      const translated = openAIToAnthropic(
        opts.messages
          .filter((msg) => msg.role !== "system")
          .map((msg) =>
            msg.role === "tool"
              ? {
                  role: "tool" as const,
                  content: msg.content,
                  tool_call_id: msg.toolCallId,
                }
              : {
                  role: msg.role,
                  content: msg.content,
                },
          ),
      );
      for (const m of translated) {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }
    anthropicMessages.push({ role: "user", content: opts.prompt });

    const anthropicTools =
      opts.tools && opts.tools.length > 0
        ? opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Record<string, unknown>,
          }))
        : undefined;

    const body = JSON.stringify({
      anthropic_version: "vertex-2023-10-16",
      messages: anthropicMessages,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      temperature: typeof opts.temperature === "number" ? opts.temperature : 0.7,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      ...(anthropicTools ? { tools: anthropicTools } : {}),
    });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (err) {
      yield {
        type: "error",
        content: `Vertex network error: ${err instanceof Error ? err.message : String(err)}`,
        provider: "vertex",
        stopReason: "error",
      };
      return;
    }
    if (!res.ok || !res.body) {
      const err = res.body ? await res.text().catch(() => "") : "";
      yield {
        type: "error",
        content: `Vertex ${res.status}: ${err.slice(0, 300)}`,
        provider: "vertex",
        stopReason: "error",
      };
      return;
    }

    // Vertex Claude streams use Anthropic's event format (`data: {...}\n\n`).
    // Full lifecycle:
    //   message_start — message metadata (input tokens)
    //   content_block_start — block begins; for tool_use carries name + id
    //   content_block_delta — text_delta (assistant text) or input_json_delta
    //                         (partial tool-argument JSON, must be concatenated)
    //   content_block_stop — block ends; emit tool_use chunk if this was one
    //   message_delta — final stop_reason + output tokens
    //   message_stop — terminal marker
    // Without the tool-use half, multi-turn tool loops silently die because
    // the runtime never sees the model's tool calls. Mirror the native
    // anthropic-adapter so Vertex behaves identically.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let capturedStopReason: string | undefined;
    const blockState = new Map<
      number,
      {
        kind: "text" | "tool_use" | "thinking" | "other";
        toolName?: string;
        toolId?: string;
        partialJson: string;
      }
    >();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n/);
        buffer = events.pop() ?? "";
        for (const ev of events) {
          const dataLine = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const payload = dataLine.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload) as {
              type?: string;
              index?: number;
              content_block?: { type?: string; name?: string; id?: string };
              delta?: {
                type?: string;
                text?: string;
                partial_json?: string;
                stop_reason?: string;
              };
            };

            if (json.type === "message_start") {
              // Message metadata — nothing to emit yet.
              continue;
            }

            if (json.type === "content_block_start" && typeof json.index === "number") {
              const block = json.content_block ?? {};
              if (block.type === "tool_use") {
                blockState.set(json.index, {
                  kind: "tool_use",
                  toolName: block.name,
                  toolId: block.id,
                  partialJson: "",
                });
              } else if (block.type === "text") {
                blockState.set(json.index, { kind: "text", partialJson: "" });
              } else if (block.type === "thinking") {
                blockState.set(json.index, { kind: "thinking", partialJson: "" });
              } else {
                blockState.set(json.index, { kind: "other", partialJson: "" });
              }
              continue;
            }

            if (json.type === "content_block_delta" && typeof json.index === "number") {
              const delta = json.delta ?? {};
              const state = blockState.get(json.index);
              if (delta.type === "text_delta" && typeof delta.text === "string") {
                yield {
                  type: "text",
                  content: delta.text,
                  model,
                  provider: "vertex",
                };
              } else if (
                delta.type === "input_json_delta" &&
                typeof delta.partial_json === "string"
              ) {
                if (state) state.partialJson += delta.partial_json;
              }
              continue;
            }

            if (json.type === "content_block_stop" && typeof json.index === "number") {
              const state = blockState.get(json.index);
              if (state?.kind === "tool_use") {
                let parsedInput: Record<string, unknown> = {};
                try {
                  parsedInput =
                    state.partialJson.length > 0
                      ? (JSON.parse(state.partialJson) as Record<string, unknown>)
                      : {};
                } catch {
                  yield {
                    type: "error",
                    content: `Vertex: malformed tool_use arguments for ${state.toolName ?? "unknown"}`,
                    model,
                    provider: "vertex",
                  };
                  continue;
                }
                yield {
                  type: "tool_use",
                  content: state.partialJson,
                  toolName: state.toolName,
                  toolCallId: state.toolId,
                  toolInput: parsedInput,
                  model,
                  provider: "vertex",
                  stopReason: "tool_calls",
                };
              }
              continue;
            }

            if (json.type === "message_delta") {
              if (json.delta?.stop_reason) capturedStopReason = json.delta.stop_reason;
              continue;
            }

            if (json.type === "message_stop") {
              // Terminal marker — loop will exit on stream close. Done chunk
              // is emitted outside the reader loop so it fires exactly once.
              continue;
            }
          } catch {
            /* ignore malformed events */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield {
      type: "done",
      content: "",
      model,
      provider: "vertex",
      stopReason: mapStop(capturedStopReason),
    };
  }

  return {
    id: "vertex",
    name: "vertex",
    transport: "chat_completions",
    capabilities,
    query: (opts) => queryImpl(opts),
    // listModels returns exactly what discovery gave us. The Vertex
    // model catalog is enumerable via publishers.models.list in the
    // google-aiplatform API — callers who need the full list should
    // query that endpoint. The adapter does not invent model names.
    listModels: async () => auth.models ?? [],
    isAvailable: async () => loadServiceAccount() !== null,
  };
}
