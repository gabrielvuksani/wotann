/**
 * AWS Bedrock adapter with SigV4 signing.
 *
 * Session-10 audit fix: the prior Bedrock registration used
 * `createOpenAICompatAdapter` with a Bearer token and an invented
 * `/model` path. Bedrock rejects that — real requests must be
 * SigV4-signed and posted to
 * `/model/{modelId}/converse-stream` (or `/converse` / `/invoke`).
 *
 * We implement SigV4 inline (HMAC-SHA256 canonical request + signing
 * key derivation per the AWS spec) to avoid adding
 * `@aws-sdk/client-bedrock-runtime` as a dependency (8+ MB).
 * `node:crypto` is sufficient.
 *
 * Auth envs:
 *   AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY  — static keys
 *   AWS_SESSION_TOKEN                          — STS temporary credentials
 *   AWS_REGION                                 — fallback "us-east-1"
 */

import { createHash, createHmac } from "node:crypto";
import type { ProviderAuth, AgentMessage } from "../core/types.js";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
  StopReason,
  ToolSchema,
} from "./types.js";
import {
  decodeEventStreamFrames,
  getEventType,
  getMessageType,
  type EventStreamMessage,
} from "./bedrock-eventstream.js";
import { toBedrockTools, type BedrockToolParam } from "./tool-serializer.js";

interface BedrockCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly region: string;
}

function resolveCredentials(): BedrockCredentials | null {
  const accessKeyId = process.env["AWS_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"];
  if (!accessKeyId || !secretAccessKey) return null;
  const sessionToken = process.env["AWS_SESSION_TOKEN"];
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken !== undefined ? { sessionToken } : {}),
    region: process.env["AWS_REGION"] ?? "us-east-1",
  };
}

// ── SigV4 ──────────────────────────────────────────────────────────

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function getSigningKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function signBedrockRequest(creds: BedrockCredentials, path: string, body: string): SignedRequest {
  const service = "bedrock";
  const host = `bedrock-runtime.${creds.region}.amazonaws.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    (creds.sessionToken ? `x-amz-security-token:${creds.sessionToken}\n` : "");
  const signedHeaders = creds.sessionToken
    ? "content-type;host;x-amz-date;x-amz-security-token"
    : "content-type;host;x-amz-date";

  const canonicalRequest = `POST\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${creds.region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const signingKey = getSigningKey(creds.secretAccessKey, dateStamp, creds.region, service);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const headers: Record<string, string> = {
    Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "Content-Type": "application/json",
    "X-Amz-Date": amzDate,
    Host: host,
  };
  if (creds.sessionToken) headers["X-Amz-Security-Token"] = creds.sessionToken;

  return { url: `https://${host}${path}`, headers, body };
}

// ── Body construction ──────────────────────────────────────────────

// Bedrock Converse content block shapes. Kept local to this file so we don't
// leak Bedrock-specific types into the shared provider types module.
interface BedrockTextBlock {
  readonly text: string;
}
interface BedrockToolUseBlock {
  readonly toolUse: {
    readonly toolUseId: string;
    readonly name: string;
    readonly input: Record<string, unknown>;
  };
}
interface BedrockToolResultBlock {
  readonly toolResult: {
    readonly toolUseId: string;
    readonly content: readonly { readonly text: string }[];
  };
}
type BedrockContentBlock = BedrockTextBlock | BedrockToolUseBlock | BedrockToolResultBlock;

interface BedrockMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly BedrockContentBlock[];
}

// Tool envelope type lives in the shared tool-serializer so every
// provider's shape is defined in one canonical location. Aliased here
// to `BedrockToolSpec` for readability at call sites that predate P1-B2.
type BedrockToolSpec = BedrockToolParam;

interface BedrockRequestBody {
  readonly messages: readonly BedrockMessage[];
  readonly inferenceConfig: {
    readonly maxTokens: number;
    readonly temperature: number;
  };
  readonly system?: readonly { readonly text: string }[];
  readonly toolConfig?: { readonly tools: readonly BedrockToolSpec[] };
}

/**
 * Convert the runtime's AgentMessage history into Bedrock Converse
 * content-block format. Preserves role alternation and tool_result turns by
 * inspecting toolCallId — messages with role "tool" become a user-role
 * toolResult block (Bedrock models tool results as user turns, matching
 * Anthropic's on-API-direct convention).
 */
function agentMessagesToBedrock(messages: readonly AgentMessage[]): readonly BedrockMessage[] {
  const out: BedrockMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue; // system handled via top-level `system` block
    if (msg.role === "tool") {
      // Bedrock requires tool_result to appear inside a user message.
      const toolUseId = msg.toolCallId ?? "";
      out.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId,
              content: [{ text: msg.content }],
            },
          },
        ],
      });
      continue;
    }
    // user | assistant — plain text for now. If upstream ever embeds
    // structured tool_use markup in assistant messages we'll need a richer
    // parser here; the shared AgentMessage type keeps content as a plain
    // string so splitting is not needed at this layer.
    out.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: [{ text: msg.content }],
    });
  }
  return out;
}

/**
 * Thin alias over the shared serializer so call sites read as
 * "to Bedrock tools" but actually go through the one canonical home
 * (src/providers/tool-serializer.ts). Routes all adapters through the
 * same pass-through + $ref-reject pattern introduced in P0-4. Preserves
 * the exact wire shape Bedrock Converse expects
 * (`toolSpec.inputSchema.json`) so no regression vs. the pre-P1-B2
 * inline serializer.
 */
function toolSchemasToBedrock(tools: readonly ToolSchema[]): readonly BedrockToolSpec[] {
  return toBedrockTools(tools);
}

/**
 * Build the full Converse request body. Uses opts.messages when provided
 * (preserving roles + tool_result turns), otherwise falls back to a
 * single-user-message built from opts.prompt. Pure function — does not
 * mutate opts.
 */
function buildBedrockRequestBody(opts: UnifiedQueryOptions): BedrockRequestBody {
  const hasMessages = Array.isArray(opts.messages) && opts.messages.length > 0;
  const messages: readonly BedrockMessage[] = hasMessages
    ? agentMessagesToBedrock(opts.messages ?? [])
    : [{ role: "user", content: [{ text: opts.prompt }] }];

  const inferenceConfig = {
    maxTokens: opts.maxTokens ?? 4096,
    temperature: typeof opts.temperature === "number" ? opts.temperature : 0.7,
  };

  const hasTools = Array.isArray(opts.tools) && opts.tools.length > 0;
  const hasSystem = typeof opts.systemPrompt === "string" && opts.systemPrompt.length > 0;

  return {
    messages,
    inferenceConfig,
    ...(hasSystem ? { system: [{ text: opts.systemPrompt as string }] } : {}),
    ...(hasTools ? { toolConfig: { tools: toolSchemasToBedrock(opts.tools ?? []) } } : {}),
  };
}

// ── Stream parser helpers ──────────────────────────────────────────

/**
 * Map Bedrock Converse stopReason vocabulary to the runtime's
 * normalised StopReason. Unknown values default to "stop" to avoid
 * leaking provider-specific values into downstream consumers.
 */
function mapBedrockStopReason(reason: string): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_calls";
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "max_tokens";
    case "content_filtered":
      return "content_filter";
    case "guardrail_intervened":
      return "content_filter";
    default:
      return "stop";
  }
}

// Payload shapes inside Bedrock event-stream frames. Each event-type
// header pairs with a JSON payload whose schema below captures the
// fields we care about. Parsing with these interfaces (rather than
// `any`) means the TypeScript strict-mode checker flags incorrect
// field access at compile time and the regex-era ambiguity goes away.
interface ContentBlockStartPayload {
  readonly start?: {
    readonly toolUse?: { readonly toolUseId?: string; readonly name?: string };
    readonly text?: unknown;
  };
  readonly contentBlockIndex?: number;
}

interface ContentBlockDeltaPayload {
  readonly delta?: {
    readonly text?: string;
    readonly toolUse?: { readonly input?: string };
  };
  readonly contentBlockIndex?: number;
}

interface ContentBlockStopPayload {
  readonly contentBlockIndex?: number;
}

interface MessageStopPayload {
  readonly stopReason?: string;
}

interface ExceptionPayload {
  readonly message?: string;
  readonly Message?: string;
}

/**
 * Parse an event-stream message payload into one of the known shapes.
 * Returns null on JSON parse failure so the caller can surface a
 * structured error without crashing the stream.
 */
function parseEventPayload<T>(msg: EventStreamMessage): T | null {
  try {
    const text = msg.payload.toString("utf-8");
    if (text.length === 0) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ── Adapter ────────────────────────────────────────────────────────

export function createBedrockAdapter(auth: ProviderAuth): ProviderAdapter {
  // No hardcoded default model / vendor bias: the caller must supply a
  // model via auth.models or per-query opts.model. If neither is set,
  // the adapter yields a clear error chunk instead of silently assuming
  // a Claude model was intended.
  const defaultModel = auth.models?.[0];
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    // Context window is set by the concrete model at dispatch time via
    // getMaxContextWindow(provider, model); the static capability default
    // is a conservative lower bound the runtime refines per-query.
    maxContextWindow: 128_000,
  };

  async function* queryImpl(opts: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const creds = resolveCredentials();
    if (!creds) {
      yield {
        type: "error",
        content:
          "Bedrock auth unavailable: set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN for STS) before calling the Bedrock adapter.",
        provider: "bedrock",
        stopReason: "error",
      };
      return;
    }
    const model = opts.model ?? defaultModel;
    if (!model) {
      yield {
        type: "error",
        content:
          "Bedrock adapter requires an explicit model — supply via opts.model or configure ProviderAuth.models. No vendor-biased default.",
        provider: "bedrock",
        stopReason: "error",
      };
      return;
    }
    const body = JSON.stringify(buildBedrockRequestBody(opts));
    const path = `/model/${encodeURIComponent(model)}/converse-stream`;
    const signed = signBedrockRequest(creds, path, body);

    let res: Response;
    try {
      res = await fetch(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });
    } catch (err) {
      yield {
        type: "error",
        content: `Bedrock network error: ${err instanceof Error ? err.message : String(err)}`,
        provider: "bedrock",
        stopReason: "error",
      };
      return;
    }
    if (!res.ok || !res.body) {
      const errText = res.body ? await res.text().catch(() => "") : "";
      yield {
        type: "error",
        content: `Bedrock ${res.status}: ${errText.slice(0, 300)}`,
        provider: "bedrock",
        stopReason: "error",
      };
      return;
    }

    // AWS event-stream binary framing decoder. The pre-fix version
    // regex-scanned the raw bytes which broke on three concrete inputs:
    //   (a) payloads straddling TCP chunk boundaries,
    //   (b) `}"` appearing inside a JSON string value (lazy regex
    //       terminated early and truncated the payload),
    //   (c) binary header bytes interleaved with payload bytes
    //       surfacing as UTF-8 replacement chars.
    // `decodeEventStreamFrames` parses the length-prefixed framing
    // directly, so payload byte-identity is preserved and frames are
    // only emitted once fully received. See bedrock-eventstream.ts for
    // the full spec + framing documentation.
    const reader = res.body.getReader();
    // Binary buffer that accumulates partial frame bytes across reads.
    // We deliberately keep this as a Buffer (not a decoded string) so
    // multi-byte payloads survive intact.
    let pending = Buffer.alloc(0);
    // contentBlockIndex -> accumulated tool_use state. Bedrock emits
    // toolUseId + name on contentBlockStart, streams `input` JSON via
    // contentBlockDelta.delta.toolUse.input, and finally contentBlockStop
    // to signal completion. We can only safely parse the JSON once
    // stop arrives.
    const toolBlocks = new Map<
      number,
      { id: string; name: string; args: string; emitted: boolean }
    >();
    let stopReason: StopReason = "stop";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Append newly-read bytes to the pending buffer. Buffer.concat
        // produces a fresh allocation so prior slices into `pending`
        // are never invalidated.
        pending = Buffer.concat([pending, Buffer.from(value)]);

        let frameBatch: {
          readonly messages: readonly EventStreamMessage[];
          readonly remaining: Buffer;
        };
        try {
          frameBatch = decodeEventStreamFrames(pending);
        } catch (err) {
          // Structurally-invalid frame — surface it rather than silently
          // truncate. The stream is no longer trustworthy; stop reading.
          yield {
            type: "error",
            content: `Bedrock event-stream protocol error: ${
              err instanceof Error ? err.message : String(err)
            }`,
            model,
            provider: "bedrock",
            stopReason: "error",
          };
          return;
        }
        pending = Buffer.from(frameBatch.remaining);

        for (const msg of frameBatch.messages) {
          const messageType = getMessageType(msg);
          // Exceptions carry error payloads, not events. Surface them
          // as error chunks. The Bedrock runtime uses `:message-type`
          // for this dispatch — see AWS EventStream spec §3.
          if (messageType === "exception" || messageType === "error") {
            const err = parseEventPayload<ExceptionPayload>(msg);
            const exceptionType = msg.headers[":exception-type"] ?? "BedrockException";
            const errMsg = err?.message ?? err?.Message ?? "unknown";
            yield {
              type: "error",
              content: `Bedrock ${exceptionType}: ${errMsg}`,
              model,
              provider: "bedrock",
              stopReason: "error",
            };
            stopReason = "error";
            continue;
          }

          const eventType = getEventType(msg);
          if (!eventType) continue;

          if (eventType === "contentBlockStart") {
            const p = parseEventPayload<ContentBlockStartPayload>(msg);
            if (!p) continue;
            const tool = p.start?.toolUse;
            const idx = typeof p.contentBlockIndex === "number" ? p.contentBlockIndex : 0;
            if (tool && typeof tool.toolUseId === "string" && typeof tool.name === "string") {
              if (!toolBlocks.has(idx)) {
                toolBlocks.set(idx, {
                  id: tool.toolUseId,
                  name: tool.name,
                  args: "",
                  emitted: false,
                });
              }
            }
            continue;
          }

          if (eventType === "contentBlockDelta") {
            const p = parseEventPayload<ContentBlockDeltaPayload>(msg);
            if (!p) continue;
            const delta = p.delta;
            if (!delta) continue;
            if (typeof delta.text === "string" && delta.text.length > 0) {
              yield { type: "text", content: delta.text, model, provider: "bedrock" };
            } else if (delta.toolUse && typeof delta.toolUse.input === "string") {
              const idx = typeof p.contentBlockIndex === "number" ? p.contentBlockIndex : 0;
              const block = toolBlocks.get(idx);
              if (block && !block.emitted) {
                toolBlocks.set(idx, { ...block, args: block.args + delta.toolUse.input });
              }
            }
            continue;
          }

          if (eventType === "contentBlockStop") {
            const p = parseEventPayload<ContentBlockStopPayload>(msg);
            if (!p) continue;
            const idx = typeof p.contentBlockIndex === "number" ? p.contentBlockIndex : 0;
            const block = toolBlocks.get(idx);
            if (!block || block.emitted || !block.name) continue;
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = block.args ? (JSON.parse(block.args) as Record<string, unknown>) : {};
            } catch {
              yield {
                type: "error",
                content: `Bedrock: malformed tool arguments for ${block.name}`,
                model,
                provider: "bedrock",
                stopReason: "error",
              };
              toolBlocks.set(idx, { ...block, emitted: true });
              continue;
            }
            yield {
              type: "tool_use",
              content: block.args,
              toolName: block.name,
              toolCallId: block.id,
              toolInput: parsedInput,
              model,
              provider: "bedrock",
              stopReason: "tool_calls",
            };
            toolBlocks.set(idx, { ...block, emitted: true });
            stopReason = "tool_calls";
            continue;
          }

          if (eventType === "messageStop") {
            const p = parseEventPayload<MessageStopPayload>(msg);
            if (p?.stopReason) {
              stopReason = mapBedrockStopReason(p.stopReason);
            }
            continue;
          }
          // messageStart / messageDelta / metadata — no action needed;
          // messageDelta can carry usage metrics but the adapter does
          // not forward them (runtime derives usage elsewhere). Any
          // unknown eventType is a silent no-op since Bedrock may add
          // new events without breaking the stream contract.
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "done", content: "", model, provider: "bedrock", stopReason };
  }

  return {
    id: "bedrock",
    name: "bedrock",
    transport: "chat_completions",
    capabilities,
    query: (opts) => queryImpl(opts),
    // listModels returns exactly what discovery gave us. If the caller
    // wants Bedrock's actual catalog they should hit the ListFoundationModels
    // API directly — the adapter does not invent a model list.
    listModels: async () => auth.models ?? [],
    isAvailable: async () => resolveCredentials() !== null,
  };
}
