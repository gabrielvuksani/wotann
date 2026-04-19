/**
 * Guarded fetch — thin wrapper that applies SSRF validation before every
 * outbound connector request.
 *
 * The connector modules (Jira, Linear, Notion, Confluence, Google-Drive,
 * Slack) all accept a user-configured `domain` credential and splice it
 * into the fetch URL. Without validation a malicious (or misconfigured)
 * user could point the connector at an internal IP — cloud metadata
 * endpoint, private RFC-1918 host, etc. — and the connector would dutifully
 * forward whatever bearer token the config held.
 *
 * This helper closes that path: every connector fetch flows through
 * `guardedFetch` which invokes `assertOutboundUrl` first. A failing
 * URL raises `SSRFBlockedError` rather than returning silently, so the
 * caller's `try/catch` surfaces the denial honestly instead of shrugging.
 */

import { assertOutboundUrl } from "../security/ssrf-guard.js";

/**
 * Drop-in replacement for the global `fetch` — identical signature —
 * that validates the URL against the SSRF deny-list before issuing
 * the request. Throws `SSRFBlockedError` on failure.
 */
export async function guardedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  // Throws SSRFBlockedError on denial — the caller's existing try/catch
  // surfaces the failure honestly (instead of the fetch hitting the wire).
  assertOutboundUrl(url);
  return fetch(url, init);
}
