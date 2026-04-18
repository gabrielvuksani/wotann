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
} from "./types.js";

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
  const defaultModel = auth.models?.[0] ?? "claude-sonnet-4-6@20260101";
  const region = process.env["GOOGLE_CLOUD_REGION"] ?? "us-central1";
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: 200_000,
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
    const publisher = model.toLowerCase().includes("claude") ? "anthropic" : "google";
    const url =
      `https://${region}-aiplatform.googleapis.com/v1/projects/${project}` +
      `/locations/${region}/publishers/${publisher}/models/${model}:streamRawPredict`;

    const body = JSON.stringify({
      anthropic_version: "vertex-2023-10-16",
      messages: [{ role: "user", content: opts.prompt }],
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      temperature: typeof opts.temperature === "number" ? opts.temperature : 0.7,
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
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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
              delta?: { type?: string; text?: string };
            };
            if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
              yield {
                type: "text",
                content: json.delta.text ?? "",
                model,
                provider: "vertex",
              };
            }
          } catch {
            /* ignore malformed events */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "done", content: "", model, provider: "vertex", stopReason: "stop" };
  }

  return {
    id: "vertex",
    name: "vertex",
    transport: "chat_completions",
    capabilities,
    query: (opts) => queryImpl(opts),
    listModels: async () =>
      auth.models ?? [
        "claude-sonnet-4-6@20260101",
        "claude-opus-4-6@20260101",
        "claude-haiku-4-5@20260101",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
      ],
    isAvailable: async () => loadServiceAccount() !== null,
  };
}
