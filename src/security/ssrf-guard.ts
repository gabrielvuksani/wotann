/**
 * SSRF Guard — universal outbound-URL validator for agent-callable tools.
 *
 * Rejects URLs that target private/reserved IPs, cloud metadata endpoints,
 * loopback, or non-http(s) schemes. Callers should invoke `isSafeUrl` or
 * `requireSafeUrl`/`assertOutboundUrl` before issuing any outbound
 * request on behalf of the model so the agent cannot be tricked into
 * exfiltrating credentials from instance metadata or reaching internal
 * services.
 *
 * SECURITY CONTRACT:
 * - Only `http:` and `https:` accepted (no `file:`, `ftp:`, `data:`, etc.)
 * - Cloud metadata IPs (169.254.169.254, metadata.google.internal, etc.) rejected
 * - RFC-1918 private ranges + loopback + link-local + mDNS rejected
 * - Opt-in `allowPrivate` for test fixtures only — production must never set it
 *
 * This is a URL-structural check (hostname/IP literal); DNS-rebinding
 * defence requires IP-pinning at transport level (see web-fetch.ts).
 */

export type SSRFRejectionReason =
  | "invalid-url"
  | "bad-scheme"
  | "metadata-host"
  | "private-ip"
  | "localhost";

export interface SSRFCheckOptions {
  /** Allow private / reserved IPs. Tests only — production must never set. */
  readonly allowPrivate?: boolean;
  /** Additional hostnames to deny (exact match, case-insensitive). */
  readonly denyHosts?: readonly string[];
}

export interface SSRFCheckResult {
  readonly ok: boolean;
  readonly reason?: SSRFRejectionReason;
  readonly detail?: string;
}

/** Class thrown by `requireSafeUrl` so call sites can branch on the type. */
export class SSRFBlockedError extends Error {
  readonly url: string;
  readonly reason: SSRFRejectionReason;

  constructor(url: string, reason: SSRFRejectionReason, detail: string) {
    super(`SSRF blocked (${reason}): ${url} — ${detail}`);
    this.name = "SSRFBlockedError";
    this.url = url;
    this.reason = reason;
  }
}

const METADATA_HOSTS: ReadonlySet<string> = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.ec2.internal",
  "metadata.amazonaws.com",
  "metadata",
  "metadata.azure.com",
  "100.100.100.200", // Alibaba
]);

/** Check whether a hostname / IP literal is private or reserved. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h.endsWith(".internal")) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^0\./.test(h)) return true;
  // CGNAT (100.64.0.0/10)
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h === "::" || h === "::1") return true;
  if (/^fc[0-9a-f]{0,2}:/i.test(h)) return true; // IPv6 unique-local
  if (/^fd[0-9a-f]{0,2}:/i.test(h)) return true;
  if (/^fe80:/i.test(h)) return true; // IPv6 link-local
  return false;
}

/**
 * Non-throwing validation. Returns a structured result for call sites
 * that have their own error-envelope discipline.
 */
export function checkUrl(url: string, opts: SSRFCheckOptions = {}): SSRFCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url", detail: "URL parse failed" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "bad-scheme", detail: `scheme "${parsed.protocol}" not allowed` };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(host)) {
    return { ok: false, reason: "metadata-host", detail: `cloud metadata endpoint: ${host}` };
  }
  const denyHosts = new Set((opts.denyHosts ?? []).map((h) => h.toLowerCase()));
  if (denyHosts.has(host)) {
    return { ok: false, reason: "localhost", detail: `deny-listed host: ${host}` };
  }
  if (!opts.allowPrivate && isPrivateHost(host)) {
    return { ok: false, reason: "private-ip", detail: `private/reserved host: ${host}` };
  }
  return { ok: true };
}

/** Convenience boolean wrapper. */
export function isSafeUrl(url: string, opts: SSRFCheckOptions = {}): boolean {
  return checkUrl(url, opts).ok;
}

/**
 * Throw-style guard. Returns the parsed URL on success; throws
 * `SSRFBlockedError` with the rejection reason on failure.
 */
export function requireSafeUrl(url: string, opts: SSRFCheckOptions = {}): URL {
  const result = checkUrl(url, opts);
  if (!result.ok) {
    throw new SSRFBlockedError(url, result.reason ?? "invalid-url", result.detail ?? "unsafe URL");
  }
  return new URL(url);
}

/**
 * Backwards-compatible alias. Legacy callers (e.g.
 * `src/connectors/guarded-fetch.ts`) import `assertOutboundUrl`; keep
 * the name exported so those call sites keep working without churn.
 */
export const assertOutboundUrl = requireSafeUrl;

/**
 * `validateOutboundUrl` — legacy paperless-ngx-style structured
 * validator. Same semantics as `checkUrl` but with a shape that
 * includes the parsed URL on success for consumers that want to
 * avoid re-parsing.
 */
export function validateOutboundUrl(
  url: string,
  opts: SSRFCheckOptions = {},
):
  | { readonly valid: true; readonly parsed: URL }
  | { readonly valid: false; readonly reason: string; readonly category: SSRFRejectionReason } {
  const result = checkUrl(url, opts);
  if (result.ok) {
    return { valid: true, parsed: new URL(url) };
  }
  return {
    valid: false,
    reason: result.detail ?? "unsafe URL",
    category: result.reason ?? "invalid-url",
  };
}
