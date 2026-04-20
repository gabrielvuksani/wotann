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
  "metadata.goog", // GCE alt metadata host (Tier-0-G port from ghost)
  "metadata.ec2.internal",
  "metadata.amazonaws.com",
  "metadata",
  "metadata.azure.com",
  "100.100.100.200", // Alibaba
]);

/**
 * IPv6 metadata patterns — rejected with `reason: "metadata-host"`.
 *
 * AWS published an IMDSv6 form in 2024; these cloud-provider-specific
 * addresses can leak credentials on the same footing as the classic
 * 169.254.169.254 IPv4 endpoint. Ported from `ssrf-guard 2.ts` during
 * the Tier-0-G security merge-forward.
 */
const METADATA_IPV6_PATTERNS: readonly RegExp[] = [
  /^fd00:ec2:/i, // AWS IMDSv6
  /^fe80::a9fe:a9fe/i, // AWS IMDSv6 link-local alt form
];

/**
 * Check whether a hostname / IP literal is private or reserved.
 *
 * This is the URL-structural pre-filter. DNS-rebinding defence is
 * layered separately at the transport level (see `web-fetch.ts`).
 *
 * The stricter rule set (TEST-NET, Benchmarking, multicast, IPv4-mapped
 * IPv6) was ported forward from `src/security/ssrf-guard 2.ts` during
 * the Tier-0-G security merge. Keeping this sync'd with
 * `src/tools/web-fetch.ts::isPrivateHost` which carries the same rules
 * at the transport-level layer.
 */
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
  // IETF Protocol Assignments (RFC 6890)
  if (/^192\.0\.0\./.test(h)) return true;
  // TEST-NET-1 (RFC 5737) — not routable
  if (/^192\.0\.2\./.test(h)) return true;
  // Benchmarking (198.18.0.0/15, RFC 2544)
  if (/^198\.(1[89])\./.test(h)) return true;
  // TEST-NET-2 (RFC 5737)
  if (/^198\.51\.100\./.test(h)) return true;
  // TEST-NET-3 (RFC 5737)
  if (/^203\.0\.113\./.test(h)) return true;
  // Multicast 224.0.0.0/4 (first half, 224-229)
  if (/^22[4-9]\./.test(h)) return true;
  // Multicast 224.0.0.0/4 (second half, 230-239)
  if (/^23\d\./.test(h)) return true;
  // Reserved 240.0.0.0/4 (240-249)
  if (/^24\d\./.test(h)) return true;
  // Reserved 240.0.0.0/4 (250-255) + 255.255.255.255 broadcast
  if (/^25[0-5]\./.test(h)) return true;
  if (h === "::" || h === "::1") return true;
  if (/^fc[0-9a-f]{0,2}:/i.test(h)) return true; // IPv6 unique-local
  if (/^fd[0-9a-f]{0,2}:/i.test(h)) return true;
  if (/^fe80:/i.test(h)) return true; // IPv6 link-local
  // IPv6 multicast (ff00::/8, RFC 4291)
  if (/^ff[0-9a-f]{2}:/i.test(h)) return true;
  // IPv4-mapped IPv6 (::ffff:<v4>) — classic RFC-1918-bypass form.
  // Unwrap the embedded IPv4 and recurse so the same private-range
  // rules apply.
  //
  // Note: Node's URL parser canonicalizes `::ffff:127.0.0.1` into the
  // hex form `::ffff:7f00:1` (two 16-bit hex groups). Handle BOTH the
  // dotted-quad form (when callers pass raw hostname strings) and the
  // hex-group form (after `new URL(...).hostname` has normalised it).
  if (h.startsWith("::ffff:")) {
    const tail = h.slice("::ffff:".length);
    // Dotted-quad form, e.g. `::ffff:127.0.0.1` — recurse as IPv4.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) {
      return isPrivateHost(tail);
    }
    // Hex-group form, e.g. `::ffff:7f00:1` — decode the two 16-bit
    // groups back to dotted-quad and recurse.
    const mapped = ipv4MappedHexToDotted(tail);
    if (mapped !== null) {
      return isPrivateHost(mapped);
    }
  }
  return false;
}

/**
 * Decode the tail of an IPv4-mapped IPv6 address when it's in
 * hex-group form (e.g. `7f00:1` → `127.0.0.1`). Node's URL parser
 * normalises dotted-quad IPv4-mapped addresses to this form so we
 * need a reverse path to run the RFC-1918 check on the embedded v4.
 *
 * Returns null for any shape that isn't two 16-bit hex groups with
 * optional `::` compression — callers treat null as "not a mappable
 * literal, fall through to the other IPv6 checks."
 */
function ipv4MappedHexToDotted(tail: string): string | null {
  // Compressed zero: `::ffff:1` → tail is "1" (no colon, single group).
  // Expand to "0:<group>".
  let a: number;
  let b: number;
  if (tail.includes(":")) {
    const parts = tail.split(":");
    if (parts.length !== 2) return null;
    if (!/^[0-9a-f]{1,4}$/i.test(parts[0] ?? "")) return null;
    if (!/^[0-9a-f]{1,4}$/i.test(parts[1] ?? "")) return null;
    a = parseInt(parts[0] as string, 16);
    b = parseInt(parts[1] as string, 16);
  } else {
    if (!/^[0-9a-f]{1,4}$/i.test(tail)) return null;
    a = 0;
    b = parseInt(tail, 16);
  }
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  if (a < 0 || a > 0xffff || b < 0 || b > 0xffff) return null;
  const o1 = (a >> 8) & 0xff;
  const o2 = a & 0xff;
  const o3 = (b >> 8) & 0xff;
  const o4 = b & 0xff;
  return `${o1}.${o2}.${o3}.${o4}`;
}

/**
 * Check whether an IPv6 hostname matches a cloud metadata pattern.
 * Distinguished from `isPrivateHost` so the rejection carries the
 * `"metadata-host"` category rather than the generic `"private-ip"`.
 */
function isMetadataIpv6(host: string): boolean {
  const h = host.toLowerCase();
  for (const p of METADATA_IPV6_PATTERNS) {
    if (p.test(h)) return true;
  }
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
  // IPv6-specific metadata ranges (e.g. AWS IMDSv6 fd00:ec2::/8). Checked
  // before the generic private-IP pass so the rejection carries the
  // `metadata-host` reason rather than `private-ip` — callers
  // distinguish the two for telemetry.
  if (isMetadataIpv6(host)) {
    return { ok: false, reason: "metadata-host", detail: `cloud metadata IPv6 endpoint: ${host}` };
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
