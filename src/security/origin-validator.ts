/**
 * Origin validator -- V9 Tier 10 SB-06 (ShadowPrompt fix).
 *
 * ShadowPrompt (Mar 2026 disclosure) abused a wildcard origin
 * allowlist (`*.claude.ai`) plus a DOM-XSS in the CAPTCHA on
 * `a-cdn.claude.ai`. The fix Anthropic shipped: exact-match origin
 * comparison everywhere postMessage handlers do origin checks, so
 * `https://x.claude.ai` no longer passes when the allowlist is
 * `https://claude.ai`.
 *
 * This module is the WOTANN equivalent. Use `isExactOriginMatch` at
 * EVERY postMessage origin check site instead of inline `.endsWith()`
 * or wildcard matching. Tests in `tests/security/comet-shadow-defense.test.ts`
 * codify the exact-match contract.
 *
 * -- Quality bars ----------------------------------------------------
 *  - QB #6 honest stubs: malformed input -> false (deny). Never
 *    throws, never returns true on invalid input.
 *  - QB #7 per-call state: pure function. No module-level mutation.
 *  - QB #11 sibling-site scan: `desktop-app/src/components/mcp-apps/
 *    mcp-bridge.ts` already uses `===` for origin compare and is the
 *    only desktop-side postMessage site. This module exists so daemon
 *    + future surfaces share the same canonical check.
 *  - QB #13 env guard: no `process.env` reads.
 */

// === Public API ===========================================================

/**
 * Returns true iff `actual` matches at least one entry in `allowed`
 * with EXACT, byte-for-byte equality after normalization.
 *
 * Normalization rules (intentionally minimal):
 *   - Trim surrounding whitespace.
 *   - Lowercase the scheme + hostname (RFC 3986 -- they are
 *     case-insensitive; the path is NOT lowercased).
 *   - Strip the trailing slash from the origin form (`https://x.com/`
 *     normalizes to `https://x.com`).
 *
 * Wildcards are NEVER honored. `*.claude.ai` is just a string; it
 * matches only when an entry in `actual` is literally `*.claude.ai`,
 * which no real browser would send.
 *
 * Empty/non-string `actual` -> false.
 * Null/empty `allowed` array -> false (deny by default).
 */
export function isExactOriginMatch(actual: string, allowed: readonly string[]): boolean {
  if (typeof actual !== "string") return false;
  const a = normalizeOrigin(actual);
  if (a === null) return false;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  for (const candidate of allowed) {
    if (typeof candidate !== "string") continue;
    // Reject wildcard entries explicitly so a misconfigured allowlist
    // never silently passes. Callers MUST be explicit -- listing every
    // allowed origin individually is cheap.
    if (containsWildcard(candidate)) continue;
    const c = normalizeOrigin(candidate);
    if (c === null) continue;
    if (a === c) return true;
  }
  return false;
}

/**
 * Convenience for test harnesses: returns `null` when an entry in
 * `allowed` contains a wildcard, otherwise echoes the array. Tests
 * use this to assert that wildcard configs are caught at config
 * load, not silently passed at runtime.
 */
export function rejectWildcardOrigins(allowed: readonly string[]): readonly string[] | null {
  for (const c of allowed) {
    if (typeof c === "string" && containsWildcard(c)) return null;
  }
  return allowed;
}

// === Internals ============================================================

function containsWildcard(s: string): boolean {
  return s.includes("*");
}

/**
 * Normalize an origin string:
 *   - Lowercase scheme + host
 *   - Strip default ports
 *   - Strip trailing slash
 *
 * Returns `null` when the input does not parse as an origin-shaped URL.
 *
 * Note: we accept `"null"` (the literal four-character string the
 * browser uses for opaque origins like `srcdoc` iframes without
 * `allow-same-origin`) as a valid input -- it normalizes to itself.
 */
function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Special-case the opaque-origin literal.
  if (trimmed === "null") return "null";

  // Origin-shaped strings have no path beyond `/` -- but tolerate a
  // single trailing slash (browsers sometimes append it).
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // Reject anything with userinfo, query, or hash -- those don't
  // belong in an origin.
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "") return null;
  if (parsed.hash !== "") return null;
  // Allow only `/` or empty path.
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;

  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();

  // Strip default ports for normalization (so `https://x.com:443`
  // matches `https://x.com`).
  const port = parsed.port;
  const isDefaultPort =
    (scheme === "http:" && (port === "" || port === "80")) ||
    (scheme === "https:" && (port === "" || port === "443"));
  const portSegment = isDefaultPort ? "" : `:${port}`;

  return `${scheme}//${host}${portSegment}`;
}
