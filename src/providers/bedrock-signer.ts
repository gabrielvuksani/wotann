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
import type { ProviderAuth } from "../core/types.js";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";

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

// ── Adapter ────────────────────────────────────────────────────────

export function createBedrockAdapter(auth: ProviderAuth): ProviderAdapter {
  const defaultModel = auth.models?.[0] ?? "anthropic.claude-sonnet-4-6:0";
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 200_000,
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
    const body = JSON.stringify({
      messages: [{ role: "user", content: [{ text: opts.prompt }] }],
      inferenceConfig: {
        maxTokens: opts.maxTokens ?? 4096,
        temperature: typeof opts.temperature === "number" ? opts.temperature : 0.7,
      },
    });
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

    // Minimal event-stream text extraction (naive — upgrade to a real
    // event-stream decoder once Bedrock sees production traffic).
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const deltaMatches = buffer.matchAll(/"contentBlockDelta"[^}]*"text"\s*:\s*"([^"]*)"/g);
        for (const m of deltaMatches) {
          const text = m[1] ?? "";
          if (text) yield { type: "text", content: text, model, provider: "bedrock" };
        }
        if (buffer.length > 65_536) buffer = buffer.slice(-32_768);
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "done", content: "", model, provider: "bedrock", stopReason: "stop" };
  }

  return {
    id: "bedrock",
    name: "bedrock",
    transport: "chat_completions",
    capabilities,
    query: (opts) => queryImpl(opts),
    listModels: async () =>
      auth.models ?? [
        "anthropic.claude-sonnet-4-6:0",
        "anthropic.claude-opus-4-6:0",
        "anthropic.claude-haiku-4-5:0",
        "meta.llama4-70b-instruct",
      ],
    isAvailable: async () => resolveCredentials() !== null,
  };
}
