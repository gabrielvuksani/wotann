/**
 * Ollama host resolution — single source of truth.
 *
 * Round 8 audit (2026-04-30): WOTANN had 8+ sites that resolved the
 * Ollama base URL independently — some honored `OLLAMA_URL`, some
 * `OLLAMA_HOST`, some honored both with flipped precedence, and 5
 * literal hardcodes had no env override at all. The result: a user
 * who set `OLLAMA_HOST=http://192.168.1.50:11434` (e.g. running
 * Ollama on a beefy LAN box, a Tailscale exit node, or a Docker
 * container on a different port) saw it honored in some code paths
 * and silently ignored in others. Free-tier-first principle violated.
 *
 * **Real capability this unlocks**: a user can now point WOTANN at:
 *   - Remote Ollama on their LAN: `OLLAMA_HOST=http://nas.local:11434`
 *   - Tailscale exit node: `OLLAMA_HOST=http://hetzner-tailnet.ts.net:11434`
 *   - Docker port-remap: `OLLAMA_HOST=http://localhost:8080`
 *   - Cloudflare Tunnel: `OLLAMA_HOST=https://ollama.example.com`
 * …and every code path inside WOTANN reads the same value.
 *
 * **Precedence** (matches upstream Ollama CLI convention):
 *   1. `OLLAMA_HOST` — canonical (the one Ollama itself documents)
 *   2. `OLLAMA_URL`  — alias for back-compat with WOTANN's older code
 *   3. `http://127.0.0.1:11434` — literal default. We use 127.0.0.1
 *      rather than `localhost` because `localhost` resolution can
 *      land on IPv6 ::1 and Ollama may bind only IPv4 on some hosts.
 *
 * **Schema normalization**: if the env value is just `host:port`
 * (matching the upstream Ollama CLI which accepts bare host:port),
 * we prepend `http://` so callers get a complete URL.
 */

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * Resolve the Ollama base URL from environment. Always returns a
 * complete URL (scheme + host + port) — never a bare host:port.
 *
 * Optional `env` parameter lets tests inject a controlled environment
 * without touching `process.env`.
 */
export function resolveOllamaHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    (typeof env["OLLAMA_HOST"] === "string" && env["OLLAMA_HOST"].trim().length > 0
      ? env["OLLAMA_HOST"]
      : undefined) ??
    (typeof env["OLLAMA_URL"] === "string" && env["OLLAMA_URL"].trim().length > 0
      ? env["OLLAMA_URL"]
      : undefined) ??
    DEFAULT_OLLAMA_URL;
  return normalizeOllamaUrl(raw.trim());
}

/**
 * Append a path to the Ollama base URL, handling the trailing-slash
 * edge case so callers don't have to think about it.
 *
 *   ollamaUrl("/api/tags") → "http://127.0.0.1:11434/api/tags"
 *   ollamaUrl("api/tags")  → "http://127.0.0.1:11434/api/tags"
 *
 * Pass `env` for tests; defaults to process.env.
 */
export function ollamaUrl(path: string = "", env: NodeJS.ProcessEnv = process.env): string {
  const base = resolveOllamaHost(env).replace(/\/+$/, "");
  if (path.length === 0) return base;
  return base + (path.startsWith("/") ? path : `/${path}`);
}

/**
 * Normalize a user-supplied Ollama host string into a full URL.
 * Accepts:
 *   - "http://host:port" / "https://host:port"  → returned as-is
 *   - "host:port"                               → "http://host:port"
 *   - "host"                                    → "http://host:11434"
 *   - "http://host"                             → "http://host" (caller's choice)
 *
 * Exported for testing; most callers should use `resolveOllamaHost()`.
 */
export function normalizeOllamaUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_OLLAMA_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  if (trimmed.includes(":")) return `http://${trimmed.replace(/\/+$/, "")}`;
  return `http://${trimmed}:11434`;
}

/**
 * Pre-normalized literal default. Consumers that want the bare
 * fallback (e.g. for surfacing in a "current Ollama URL" indicator
 * when no env is set) can use this directly.
 */
export const OLLAMA_DEFAULT_URL = DEFAULT_OLLAMA_URL;
