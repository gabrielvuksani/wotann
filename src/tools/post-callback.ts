/**
 * POST callback for tool results (E14).
 *
 * lobe-chat pattern: every tool call can post its result to an external
 * webhook so desktops, dashboards, or automation can react. Use cases:
 *  - Stream a task log to a Slack channel
 *  - Feed test output into a CI dashboard
 *  - Keep a mobile companion in sync when the user is away from the desktop
 *
 * Security:
 *  - Callbacks are whitelisted via config (no arbitrary URL from user input)
 *  - Only http(s) URLs to private networks allowed unless `WOTANN_ALLOW_PUBLIC_CALLBACKS=1`
 *  - Bearer tokens are never forwarded; callback auth must be configured
 *    server-side via HMAC
 *  - Payload size cap 256KB to prevent abuse
 */

import { createHmac } from "node:crypto";

export interface ToolCallbackPayload {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly toolResult: string;
  readonly durationMs: number;
  readonly sessionId?: string;
  readonly timestamp: number;
}

export interface ToolCallbackConfig {
  readonly url: string;
  readonly hmacSecret?: string;
  readonly toolNameFilter?: readonly string[];
  readonly minDurationMs?: number;
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly allowPublicNetwork?: boolean;
  readonly extraHeaders?: Record<string, string>;
}

const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Post a tool result to the configured callback. Non-2xx responses cause
 * retries up to `maxRetries` with exponential backoff. All failures are
 * swallowed so callback reliability never affects the primary path.
 */
export async function postToolCallback(
  payload: ToolCallbackPayload,
  config: ToolCallbackConfig,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  // Skip if tool is filtered out
  if (config.toolNameFilter && !config.toolNameFilter.includes(payload.toolName)) {
    return { ok: true };
  }

  // Skip fast tools if the threshold is set
  if (config.minDurationMs && payload.durationMs < config.minDurationMs) {
    return { ok: true };
  }

  // Validate URL safety
  if (!isSafeCallbackURL(config.url, config.allowPublicNetwork ?? false)) {
    return { ok: false, error: "Callback URL rejected by safety policy" };
  }

  // Trim payload to cap
  const truncated = truncatePayload(payload);
  const body = JSON.stringify(truncated);

  // Compute HMAC signature
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "wotann-tool-callback/1",
    "x-wotann-timestamp": String(truncated.timestamp),
    ...(config.extraHeaders ?? {}),
  };
  if (config.hmacSecret) {
    const sig = createHmac("sha256", config.hmacSecret).update(body).digest("hex");
    headers["x-wotann-signature"] = `sha256=${sig}`;
  }

  const maxRetries = config.maxRetries ?? 3;
  const timeoutMs = config.timeoutMs ?? 5_000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(
        config.url,
        { method: "POST", headers, body },
        timeoutMs,
      );
      if (response.ok) return { ok: true, status: response.status };
      if (response.status === 404 || response.status === 410) {
        return { ok: false, status: response.status, error: "Callback endpoint is gone" };
      }
      // else retry
    } catch (err) {
      if (attempt === maxRetries) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    const backoff = Math.min(2 ** attempt * 100, 5_000);
    await sleep(backoff);
  }

  return { ok: false, error: "Callback retries exhausted" };
}

/** URL safety: reject non-http(s), ssrf targets, and public network unless allowed. */
export function isSafeCallbackURL(url: string, allowPublic: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();

  // Always block cloud metadata
  if (host === "169.254.169.254") return false;
  if (host === "metadata.google.internal") return false;
  if (host === "metadata.azure.com") return false;

  // Private network check
  if (isPrivateHost(host)) return true; // private networks are always fine
  return allowPublic || process.env["WOTANN_ALLOW_PUBLIC_CALLBACKS"] === "1";
}

function isPrivateHost(host: string): boolean {
  if (host === "localhost") return true;
  if (host === "127.0.0.1" || host === "::1") return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

function truncatePayload(payload: ToolCallbackPayload): ToolCallbackPayload {
  const json = JSON.stringify(payload);
  if (json.length <= MAX_PAYLOAD_BYTES) return payload;
  const truncatedResult =
    payload.toolResult.slice(0, 100_000) + "\n\n[payload truncated — exceeded 256KB]";
  return { ...payload, toolResult: truncatedResult };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(handle);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Registry: let config add multiple callback endpoints, each with its own
 * filter. Dispatch to all of them in parallel.
 */
export class ToolCallbackRegistry {
  private readonly configs: ToolCallbackConfig[] = [];

  add(config: ToolCallbackConfig): void {
    this.configs.push(config);
  }

  clear(): void {
    this.configs.length = 0;
  }

  async dispatch(
    payload: ToolCallbackPayload,
  ): Promise<ReadonlyArray<{ url: string; ok: boolean; error?: string; status?: number }>> {
    return Promise.all(
      this.configs.map(async (config) => ({
        url: config.url,
        ...(await postToolCallback(payload, config)),
      })),
    );
  }
}
