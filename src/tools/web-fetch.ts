/**
 * Web Fetch Tool — lightweight web content retrieval using undici's fetch().
 *
 * Fills the #5 competitive gap: WOTANN needs web capability.
 *
 * Features:
 * - HTML tag stripping with script/style removal
 * - Title extraction
 * - Content truncation at configurable byte limit
 * - SSRF protection via protocol allowlist + post-resolution IP check +
 *   IP-pinned undici dispatcher (defeats DNS rebinding TOCTOU — without
 *   the dispatcher, `fetch()` internally re-resolves the hostname and an
 *   attacker-controlled nameserver with TTL=0 could return a private IP
 *   on that second lookup, slipping past our validation)
 * - Parallel multi-URL fetching
 *
 * Session 3 (2026-04-15) discovered that Node's bundled undici and an
 * `npm install undici` can diverge on the Dispatcher handler protocol
 * (Node 25 rejects a v8.1.0 Agent with "invalid onRequestStart method").
 * The fix: use `undici.fetch` paired with `undici.Agent` from the SAME
 * installed package so request/response protocol matches. Test mode
 * (dispatcher null) still uses `globalThis.fetch` so existing mocks work.
 */

import { Agent, fetch as undiciFetch } from "undici";

// ── Types ────────────────────────────────────────────────

export interface WebFetchResult {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly content: string;
  readonly markdown: string;
  readonly title: string | null;
  readonly byteLength: number;
  readonly fetchDurationMs: number;
  readonly truncated: boolean;
}

export interface WebFetchConfig {
  readonly maxContentBytes: number;
  readonly timeoutMs: number;
  readonly userAgent: string;
  readonly followRedirects: boolean;
  readonly allowedProtocols: readonly string[];
}

// ── Defaults ─────────────────────────────────────────────

const DEFAULT_CONFIG: WebFetchConfig = {
  maxContentBytes: 100_000,
  timeoutMs: 10_000,
  userAgent: "WOTANN/1.0",
  followRedirects: true,
  allowedProtocols: ["https:", "http:"],
};

// ── HTML Processing ──────────────────────────────────────

/**
 * Extract <title> text from HTML content.
 * Returns null if no title tag is found.
 */
function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1].trim());
}

/**
 * Decode common HTML entities to their text equivalents.
 */
function decodeHtmlEntities(text: string): string {
  const entities: Readonly<Record<string, string>> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.split(entity).join(char);
  }

  // Numeric entities: &#123; and &#x1A;
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCharCode(parseInt(hex as string, 16)),
  );

  return result;
}

/**
 * Strip HTML tags, producing readable plain text.
 * Removes script/style blocks first, then strips remaining tags.
 * Collapses excessive whitespace.
 */
function stripHtml(html: string): string {
  let text = html;

  // Remove script and style blocks entirely
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Replace block-level elements with newlines for readability
  text = text.replace(
    /<\/?(?:div|p|br|h[1-6]|li|tr|blockquote|section|article|header|footer|nav|aside|main|pre|hr)[^>]*>/gi,
    "\n",
  );

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Collapse whitespace: multiple spaces to one, multiple newlines to two
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/**
 * Heuristically extract main content by removing nav/header/footer regions.
 * Uses a simple approach: strip elements that commonly wrap navigation.
 */
function extractMainContent(html: string): string {
  let content = html;

  // Remove common non-content regions
  content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  content = content.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  content = content.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

  // Try to find <main> or <article> content
  const mainMatch = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(content);
  if (mainMatch?.[1]) return stripHtml(mainMatch[1]);

  const articleMatch = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(content);
  if (articleMatch?.[1]) return stripHtml(articleMatch[1]);

  // Fall back to full stripped content
  return stripHtml(content);
}

// ── SSRF Protection ─────────────────────────────────────

/**
 * Check if an IP literal or hostname token matches a private/reserved IP range.
 *
 * Hostnames alone aren't enough: an attacker-controlled DNS server can
 * return a public IP on the first resolve and a private IP on the second
 * (classic DNS rebinding). `isPrivateHost` is therefore used as a *fast
 * pre-filter* on the URL hostname, and `isPrivateIP` is applied to the
 * actually-resolved address before the fetch runs (S2-20).
 */
function isPrivateHost(hostname: string): boolean {
  const privatePatterns = [
    /^127\./, // Loopback
    /^10\./, // Private Class A
    /^172\.(1[6-9]|2\d|3[01])\./, // Private Class B
    /^192\.168\./, // Private Class C
    /^169\.254\./, // Link-local / AWS metadata
    /^0\./, // Current network
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // Shared address space (CGNAT)
    /^192\.0\.0\./, // IETF Protocol Assignments (RFC 6890)
    /^192\.0\.2\./, // TEST-NET-1 (RFC 5737) — not routable
    /^198\.(1[89])\./, // Benchmarking (198.18.0.0/15, RFC 2544)
    /^198\.51\.100\./, // TEST-NET-2 (RFC 5737)
    /^203\.0\.113\./, // TEST-NET-3 (RFC 5737)
    /^22[4-9]\./, // Multicast 224.0.0.0/4 (first half)
    /^23\d\./, // Multicast 224.0.0.0/4 (second half, 230-239)
    /^24\d\./, // Reserved 240.0.0.0/4 (240-249)
    /^25[0-5]\./, // Reserved 240.0.0.0/4 (250-255) + 255.255.255.255 broadcast
    /^localhost\.?$/i, // Localhost hostname (trailing-dot tolerant)
    /^\[?::1\]?$/, // IPv6 loopback
    /^\[?::$/, // IPv6 unspecified
    /^\[?fc[0-9a-f]{0,2}:/i, // IPv6 unique local (fc00::/7 — prefix must be boundary-safe)
    /^\[?fd[0-9a-f]{0,2}:/i, // IPv6 unique local (fd00::/8)
    /^\[?fe80:/i, // IPv6 link-local
    /^\[?ff[0-9a-f]{2}:/i, // IPv6 multicast
  ];

  return privatePatterns.some((p) => p.test(hostname));
}

/**
 * Check whether a resolved IP literal is in a private/reserved range.
 * Must accept both IPv4 and IPv6 addresses from `dns.lookup`. This is the
 * post-resolution check that defeats DNS rebinding.
 */
function isPrivateIP(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    return isPrivateHost(address);
  }
  // Normalise IPv6 to lowercase for prefix checks.
  const a = address.toLowerCase();
  if (a === "::1" || a === "::") return true;
  if (a.startsWith("fc") || a.startsWith("fd")) return true; // unique local
  if (a.startsWith("fe80")) return true; // link-local
  if (a.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — re-check the embedded IPv4.
    return isPrivateHost(a.slice("::ffff:".length));
  }
  return false;
}

/**
 * Resolve a hostname via node:dns and reject when it maps to a
 * private/reserved IP range. Returns the validated address set so the
 * caller can build an IP-pinned dispatcher that doesn't re-resolve
 * (defeating the DNS rebinding TOCTOU where an attacker-controlled
 * nameserver with TTL=0 returns a different IP on the second lookup).
 *
 * Returns an empty array in test mode — the caller interprets that as
 * "skip pinning, let the unit-test fetch mock run."
 */
async function assertPublicResolvable(
  hostname: string,
): Promise<ReadonlyArray<{ readonly address: string; readonly family: 4 | 6 }>> {
  // IP literals — short-circuit on the string form; no DNS lookup needed.
  const literalV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const literalV6 = hostname.includes(":");
  if (literalV4 || literalV6) {
    if (isPrivateHost(hostname)) {
      throw new Error(`SSRF blocked: private/reserved IP literal "${hostname}"`);
    }
    return [{ address: hostname, family: literalV6 ? 6 : 4 }];
  }

  // In unit tests the mock `fetch` intercepts before the network, so a
  // real DNS call would either hit the network (flaky) or fail with
  // ENOTFOUND for mock hostnames like `api.example.com`. The URL-string
  // check in validateUrl's isPrivateHost is still in effect.
  //
  // Why the strict env-var equality checks: the session-3 adversarial
  // audit found that the prior `||` chain accepted `VITEST=1` alone (which
  // is auto-set by vitest but also falsely present in any script that
  // shares env) AND treated `WOTANN_TEST_MODE=0` as truthy (strings are).
  // Explicit string equality closes both holes — NODE_ENV=test is
  // mandatory, and the test-runner signal must be an explicit "1" / "true".
  if (isTestEnvironment()) {
    return [];
  }

  const { lookup } = await import("node:dns");
  const { promisify } = await import("node:util");
  const lookupAsync = promisify(lookup);
  // `all:true` returns every A/AAAA record so we reject even if ONE of
  // several resolved addresses lands in a private range.
  const addresses = (await lookupAsync(hostname, { all: true })) as Array<{
    address: string;
    family: 4 | 6;
  }>;
  for (const { address, family } of addresses) {
    if (isPrivateIP(address, family)) {
      throw new Error(`SSRF blocked: hostname "${hostname}" resolves to private IP ${address}`);
    }
  }
  return addresses;
}

/**
 * Build an undici Agent that pins the connection to a pre-validated IP.
 * The lookup callback synthesises the dns response so undici never queries
 * the resolver for this hostname — closing the gap where our manual
 * resolve could return a public IP and undici's internal resolve could
 * return a private one a microsecond later (rebinding TOCTOU).
 *
 * Returns null when no pinning is required (test mode's empty addresses).
 * The caller then skips the dispatcher option and the stub fetch mock
 * intercepts normally.
 */
function createPinnedDispatcher(
  addresses: ReadonlyArray<{ readonly address: string; readonly family: 4 | 6 }>,
): Agent | null {
  if (addresses.length === 0) return null;
  const primary = addresses[0];
  if (!primary) return null;
  // undici's connect.lookup follows the dns.lookup contract — including the
  // `options.all === true` branch where the callback receives an array of
  // `{address, family}` records rather than two separate positional args.
  // Without this branch the socket layer crashes with
  // "Invalid IP address: undefined" because the positional signature's
  // second arg (a string address) arrives as an array element.
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options && options.all === true) {
          callback(null, [
            { address: primary.address, family: primary.family },
          ] as unknown as Parameters<typeof callback>[1]);
          return;
        }
        callback(null, primary.address, primary.family);
      },
    },
  });
}

/**
 * Strict test-environment detection. Both signals must match exactly:
 * (a) NODE_ENV === "test" (node/runners override this explicitly) AND
 * (b) a test-runner marker is explicitly set to "1" or "true".
 *
 * Returns false in production even if an operator set WOTANN_TEST_MODE=0
 * (old `||` chain treated string "0" as truthy — opposite of intent).
 * Exported for use by the caller in choosing globalThis.fetch vs undiciFetch.
 */
function isTestEnvironment(): boolean {
  if (process.env["NODE_ENV"] !== "test") return false;
  const testMode = process.env["WOTANN_TEST_MODE"];
  const vitest = process.env["VITEST"];
  return testMode === "1" || testMode === "true" || vitest === "1" || vitest === "true";
}

// ── URL Validation ───────────────────────────────────────

/**
 * Validate a URL against the allowed protocol list and private IP ranges.
 * Prevents SSRF by rejecting file://, ftp://, private/reserved hosts, etc.
 */
function validateUrl(
  url: string,
  allowedProtocols: readonly string[],
):
  | { readonly valid: true; readonly parsed: URL }
  | { readonly valid: false; readonly error: string } {
  try {
    const parsed = new URL(url);
    if (!allowedProtocols.includes(parsed.protocol)) {
      return {
        valid: false,
        error: `Protocol "${parsed.protocol}" not allowed. Allowed: ${allowedProtocols.join(", ")}`,
      };
    }
    if (isPrivateHost(parsed.hostname)) {
      return {
        valid: false,
        error: `SSRF blocked: private/reserved hostname "${parsed.hostname}"`,
      };
    }
    return { valid: true, parsed };
  } catch {
    return { valid: false, error: `Invalid URL: ${url}` };
  }
}

// ── Truncation ───────────────────────────────────────────

/**
 * Truncate string content to a maximum byte length (UTF-8 aware).
 * Returns the truncated string and whether truncation occurred.
 */
function truncateToBytes(
  content: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean; readonly byteLength: number } {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(content);

  if (encoded.byteLength <= maxBytes) {
    return { text: content, truncated: false, byteLength: encoded.byteLength };
  }

  // Truncate at byte boundary, then decode back (handles multi-byte chars safely)
  const truncatedBytes = encoded.slice(0, maxBytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const text = decoder.decode(truncatedBytes);

  return { text, truncated: true, byteLength: maxBytes };
}

// ── Exported Utilities (for testing) ─────────────────────

export {
  stripHtml as _stripHtml,
  extractTitle as _extractTitle,
  validateUrl as _validateUrl,
  extractMainContent as _extractMainContent,
  isTestEnvironment as _isTestEnvironment,
  createPinnedDispatcher as _createPinnedDispatcher,
};

// ── WebFetchTool ─────────────────────────────────────────

export class WebFetchTool {
  private readonly config: WebFetchConfig;

  constructor(config?: Partial<WebFetchConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fetch a URL and return structured content.
   * On error, returns a result with status 0 and the error in the content field.
   */
  async fetch(url: string): Promise<WebFetchResult> {
    const startMs = Date.now();

    // Validate URL
    const validation = validateUrl(url, this.config.allowedProtocols);
    if (!validation.valid) {
      return this.errorResult(url, validation.error, startMs);
    }

    // Agents allocated per hop so we can close them in the finally block;
    // a long-running daemon otherwise leaks sockets across many fetches.
    let dispatcher: Agent | null = null;
    try {
      // S2-20 + 2026-04-15 follow-up: defeat DNS rebinding via IP-pinned
      // dispatcher. assertPublicResolvable validates every A/AAAA record
      // AND returns them so createPinnedDispatcher can pin the connect
      // lookup to a specific public IP. Manual redirect loop re-validates
      // and re-pins per hop so open-redirect on an allowed origin can't
      // pivot to a private target either.
      let addresses: ReadonlyArray<{ readonly address: string; readonly family: 4 | 6 }>;
      try {
        addresses = await assertPublicResolvable(validation.parsed.hostname);
      } catch (ssrfErr) {
        return this.errorResult(
          url,
          ssrfErr instanceof Error ? ssrfErr.message : "SSRF blocked",
          startMs,
        );
      }
      dispatcher = createPinnedDispatcher(addresses);

      let currentUrl = url;
      let response: Response;
      const maxRedirects = this.config.followRedirects ? 5 : 0;
      let redirectsFollowed = 0;

      while (true) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        // When a pinned dispatcher is present we route through the
        // installed undici's `fetch` — `globalThis.fetch` is bound to
        // Node's bundled undici which has a different Dispatcher handler
        // protocol and rejects a v8.1.0 Agent with
        // "invalid onRequestStart method". Tests that mock
        // `globalThis.fetch` still intercept because test mode
        // short-circuits the dispatcher to null, so we only reach for
        // `undiciFetch` when dispatcher is set (production).
        const init = {
          signal: controller.signal,
          headers: {
            "User-Agent": this.config.userAgent,
            Accept: "text/html, application/json, text/plain, */*",
          },
          redirect: "manual" as const,
          ...(dispatcher ? { dispatcher } : {}),
        };
        if (dispatcher) {
          response = (await undiciFetch(currentUrl, init as never)) as unknown as Response;
        } else {
          response = await fetch(currentUrl, init as RequestInit);
        }

        clearTimeout(timeoutId);

        if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
          if (redirectsFollowed >= maxRedirects) break;
          const location = response.headers.get("location")!;
          const nextUrl = new URL(location, currentUrl).toString();
          const nextValidation = validateUrl(nextUrl, this.config.allowedProtocols);
          if (!nextValidation.valid) {
            return this.errorResult(url, `Redirect blocked: ${nextValidation.error}`, startMs);
          }
          let nextAddresses: ReadonlyArray<{ readonly address: string; readonly family: 4 | 6 }>;
          try {
            nextAddresses = await assertPublicResolvable(nextValidation.parsed.hostname);
          } catch (ssrfErr) {
            return this.errorResult(
              url,
              `Redirect blocked: ${ssrfErr instanceof Error ? ssrfErr.message : "SSRF"}`,
              startMs,
            );
          }
          // Close the previous hop's dispatcher before re-pinning — each
          // hop may resolve to a different public IP, so the pin must be
          // refreshed or the connection would be bound to the wrong host.
          await dispatcher?.close().catch(() => undefined);
          dispatcher = createPinnedDispatcher(nextAddresses);
          currentUrl = nextUrl;
          redirectsFollowed++;
          continue;
        }
        break;
      }

      const rawText = await response.text();
      const contentType = response.headers.get("content-type") ?? "unknown";
      const isHtml = contentType.toLowerCase().includes("text/html");

      const {
        text: content,
        truncated,
        byteLength,
      } = truncateToBytes(rawText, this.config.maxContentBytes);

      const markdown = isHtml ? stripHtml(content) : content;
      const title = isHtml ? extractTitle(content) : null;
      const durationMs = Date.now() - startMs;

      return {
        url,
        status: response.status,
        contentType,
        content,
        markdown,
        title,
        byteLength,
        fetchDurationMs: durationMs,
        truncated,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return this.errorResult(url, message, startMs);
    } finally {
      // Release sockets owned by the per-fetch dispatcher; letting them
      // leak would accumulate in a long-running daemon.
      await dispatcher?.close().catch(() => undefined);
    }
  }

  /**
   * Fetch a URL and extract just the main text content.
   * Strips navigation, headers, footers heuristically.
   */
  async fetchText(url: string): Promise<string> {
    const result = await this.fetch(url);
    if (result.status === 0) return result.content;

    const contentType = result.contentType.toLowerCase();
    if (contentType.includes("text/html")) {
      return extractMainContent(result.content);
    }
    return result.markdown;
  }

  /**
   * Fetch multiple URLs in parallel.
   * Each URL is fetched independently; individual failures don't affect others.
   */
  async fetchAll(urls: readonly string[]): Promise<readonly WebFetchResult[]> {
    const results = await Promise.all(urls.map((url) => this.fetch(url)));
    return results;
  }

  // ── Private Helpers ──────────────────────────────────────

  private errorResult(url: string, error: string, startMs: number): WebFetchResult {
    return {
      url,
      status: 0,
      contentType: "error",
      content: `Error: ${error}`,
      markdown: `Error: ${error}`,
      title: null,
      byteLength: 0,
      fetchDurationMs: Date.now() - startMs,
      truncated: false,
    };
  }
}
