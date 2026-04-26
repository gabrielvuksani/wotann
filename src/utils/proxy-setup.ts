/**
 * proxy-setup.ts — HTTP(S)_PROXY env var support for Node fetch().
 *
 * WHY: WOTANN runs in corporate environments where outbound traffic is
 * required to traverse a forward proxy (Anthropic / OpenAI / Ollama-cloud /
 * package mirrors). Node 22's built-in `fetch` is undici-backed but does
 * NOT honor HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars by default —
 * every request goes direct, and corporate users see ECONNREFUSED /
 * ETIMEDOUT on every provider call. This module wires the env-driven
 * undici dispatcher BEFORE any provider code runs, so the standard
 * Unix proxy contract works out of the box.
 *
 * APPROACH: undici v8 ships `EnvHttpProxyAgent`, an RFC-compliant
 * dispatcher that reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY from the
 * environment on construction. We install it as the global dispatcher
 * with `setGlobalDispatcher`, which routes EVERY subsequent fetch()
 * call through the proxy (and respects NO_PROXY exemptions) without
 * touching call sites.
 *
 * ADDRESSES: corporate-proxy users (V9 Wave 3-R audit gap).
 *
 * QUALITY BARS:
 *   - QB#6 honest fallback: if dispatcher construction throws (malformed
 *     URL, missing dep, unsupported scheme), we log + continue WITHOUT a
 *     dispatcher install. Startup never crashes due to proxy config.
 *   - QB#7 process-global by design: setGlobalDispatcher mutates an
 *     undici-internal singleton, but that's the documented contract for
 *     "all fetch() goes through this." No other module touches it.
 *   - QB#11 sibling-site scan: confirmed no other src/ file calls
 *     setGlobalDispatcher or constructs a ProxyAgent (ripgrep clean).
 *   - QB#15 source-verified: undici ^8.1.0 is in package.json:73, and
 *     types/env-http-proxy-agent.d.ts ships with the package.
 */

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

/**
 * Result of proxy setup. `configured` is true when a global dispatcher was
 * installed; the caller may log `proxyUrl` (the HTTPS variant preferred,
 * else HTTP) for operator visibility.
 */
export interface ProxySetupResult {
  readonly configured: boolean;
  readonly proxyUrl?: string;
  readonly noProxy?: string;
  readonly error?: string;
}

/** Internal flag — guarantees idempotency on repeat calls. */
let installed = false;

/**
 * Inspect HTTP_PROXY / HTTPS_PROXY / NO_PROXY (and lowercase variants per
 * the de-facto Unix convention) and install an env-driven undici dispatcher
 * if any proxy var is set. Safe to call multiple times — second and later
 * calls are no-ops.
 *
 * Returns a structured result so the caller (typically src/index.ts at
 * startup) can log "Proxy: configured (https://corp.example:8080)" or
 * surface failures via doctor / diagnostics.
 */
export function setupProxyFromEnv(): ProxySetupResult {
  if (installed) {
    // Idempotent: report the proxy that's already configured without
    // re-installing the dispatcher. Re-reading env keeps the result honest
    // if the caller mutated process.env between calls (unusual but legal).
    const proxyUrl = readProxyUrl();
    return Object.freeze({
      configured: true,
      ...(proxyUrl !== undefined ? { proxyUrl } : {}),
      ...(readNoProxy() !== undefined ? { noProxy: readNoProxy() } : {}),
    });
  }

  const proxyUrl = readProxyUrl();
  if (proxyUrl === undefined) {
    // No proxy env var set — direct connections, no dispatcher install.
    return Object.freeze({ configured: false });
  }

  try {
    // EnvHttpProxyAgent reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY on
    // construction and routes per RFC 3986 host matching. Passing zero
    // options means "use the env vars as-is."
    const dispatcher = new EnvHttpProxyAgent();
    setGlobalDispatcher(dispatcher);
    installed = true;
    const noProxy = readNoProxy();
    return Object.freeze({
      configured: true,
      proxyUrl,
      ...(noProxy !== undefined ? { noProxy } : {}),
    });
  } catch (err) {
    // QB#6 honest fallback: do NOT crash WOTANN startup if proxy setup
    // fails. The user gets a clear message and direct connections will
    // try (and likely fail with a clearer "ECONNREFUSED" than a silent
    // dispatcher install bug).
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console -- startup log, no logger yet
    console.warn(
      `[wotann] proxy setup failed: ${message}. ` +
        `HTTP_PROXY/HTTPS_PROXY env vars present but undici dispatcher ` +
        `could not be installed. Network calls will go direct.`,
    );
    return Object.freeze({
      configured: false,
      proxyUrl,
      error: message,
    });
  }
}

/**
 * Read the active proxy URL from env, preferring HTTPS_PROXY (matches the
 * de-facto Unix convention where HTTPS_PROXY overrides HTTP_PROXY for
 * https:// requests). Lowercase variants are checked as fallback because
 * many tools (curl, git) accept either casing.
 */
function readProxyUrl(): string | undefined {
  const env = process.env;
  return (
    env["HTTPS_PROXY"] || env["https_proxy"] || env["HTTP_PROXY"] || env["http_proxy"] || undefined
  );
}

/** Read NO_PROXY (uppercase preferred, lowercase fallback). */
function readNoProxy(): string | undefined {
  const env = process.env;
  return env["NO_PROXY"] || env["no_proxy"] || undefined;
}
