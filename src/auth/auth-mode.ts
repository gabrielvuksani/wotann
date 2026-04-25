/**
 * Auth-mode selection — V9 SB-07 dual-auth ship-blocker.
 *
 * Anthropic enforces server-side rejection of non-Claude-Code OAuth
 * tokens since 2026-01-09 with the response:
 *   "This credential is only authorized for use with Claude Code and
 *   cannot be used for other API requests."
 *
 * Per The Register + The New Stack: "if you're building a business on
 * top of the Agent SDK, you should use an API key instead." Personal
 * experimentation via the Claude Code CLI subscription remains
 * unblocked, but a product/business use MUST use an Anthropic API key.
 *
 * WOTANN therefore tracks an explicit `AuthMode` per user so we can
 *   1. Refuse to auto-fall-through to OAuth-via-CC for business mode,
 *   2. Render a clear banner that distinguishes the two paths,
 *   3. Keep an immutable, mode-0600 record on disk for audit.
 *
 * Module is intentionally small + side-effect-free — login.ts owns
 * persistence, the Ink banner owns rendering, and tests can mount
 * pure helpers without touching disk.
 *
 * Quality bars honoured:
 *   - QB#1 no vendor-biased fallbacks (we refuse business+OAuth-only)
 *   - QB#3 honest stubs (no silent success — caller must pick)
 *   - QB#7 per-call state (no module-level cache; immutable returns)
 *   - QB#13 env-guard friendly (pure function over an opts snapshot)
 */

/**
 * The two compliant auth paths WOTANN supports for Anthropic models.
 * Other providers (OpenAI/Gemini/Copilot/Ollama) have their own
 * auth surfaces and don't share this gate — only Anthropic enforces
 * the OAuth-CC-only restriction at the token-rejection layer.
 */
export type AuthMode = "personal-oauth" | "business-api-key";

/**
 * Persisted contract — written to ~/.wotann/auth-mode.json with
 * mode-0600 perms by `login.ts`. Immutable record; new modes overwrite
 * the file rather than mutating in place.
 */
export interface AuthModeConfig {
  readonly mode: AuthMode;
  readonly userAcknowledgedTos: boolean;
  readonly setAt: number; // unix milliseconds
}

/**
 * Hint the wizard / CLI got from the invoker. "personal" + "business"
 * map to user-visible flags; "unknown" means we should ask.
 */
export type AuthInvocation = "personal" | "business" | "unknown";

/**
 * Pure function: given what credentials we can see + how the user
 * invoked us, return the mode we'd nudge them toward — OR null if
 * the situation is genuinely ambiguous and the caller must prompt.
 *
 * Decision matrix (explicit, no silent fallback):
 *
 *   invocation = "personal"  → personal-oauth (always — explicit user choice)
 *   invocation = "business"  → business-api-key (always — explicit user choice)
 *   invocation = "unknown":
 *     hasApiKey  + !hasCcCreds  → business-api-key (strongest signal)
 *     hasCcCreds + !hasApiKey   → personal-oauth (CC-only, can't do business)
 *     both                      → null (genuinely ambiguous, prompt)
 *     neither                   → null (no creds — caller must guide login)
 */
export function detectIntendedAuthMode(opts: {
  readonly hasClaudeCliCreds: boolean;
  readonly hasAnthropicApiKey: boolean;
  readonly userInvocation: AuthInvocation;
}): AuthMode | null {
  if (opts.userInvocation === "personal") return "personal-oauth";
  if (opts.userInvocation === "business") return "business-api-key";

  // userInvocation === "unknown" — fall back to credential signals.
  if (opts.hasAnthropicApiKey && !opts.hasClaudeCliCreds) return "business-api-key";
  if (opts.hasClaudeCliCreds && !opts.hasAnthropicApiKey) return "personal-oauth";

  // Either both creds present (ambiguous — can't infer intent) or
  // neither (no creds — caller must drive login). Honest null beats
  // a silent vendor-biased default.
  return null;
}

/**
 * Banner copy for each mode. Strings are deliberately distinct so
 * tests can assert on substrings without coupling to layout.
 */
export function bannerTextForMode(mode: AuthMode): string {
  switch (mode) {
    case "personal-oauth":
      return (
        "Personal use — your Claude Pro/Max subscription powers inference. " +
        "OAuth-via-Claude-Code is OK for personal experimentation only. " +
        "Do NOT use this mode for product/business work — Anthropic rejects " +
        "non-Claude-Code OAuth tokens server-side."
      );
    case "business-api-key":
      return (
        "Business use — paid Anthropic API key (TOS-compliant). " +
        "All Anthropic calls go through ANTHROPIC_API_KEY billing. " +
        "Per Anthropic policy: products built on the Agent SDK MUST use an API key."
      );
  }
}

/**
 * Short status word the banner can render in colour. Kept separate
 * from the long-form copy so the renderer can compose them freely.
 */
export function bannerLabelForMode(mode: AuthMode): string {
  switch (mode) {
    case "personal-oauth":
      return "Personal (OAuth via Claude Code)";
    case "business-api-key":
      return "Business (Anthropic API key)";
  }
}

/**
 * Tone bucket for the banner — green for the safer compliant path,
 * yellow for the personal-only path that has policy caveats.
 * Returned as a plain string so renderers (Ink, plain stdout, web)
 * can map however they want.
 */
export function bannerToneForMode(mode: AuthMode): "green" | "yellow" {
  switch (mode) {
    case "personal-oauth":
      // Yellow: works, but has policy caveats (personal only).
      return "yellow";
    case "business-api-key":
      // Green: TOS-compliant for any use case.
      return "green";
  }
}

/**
 * Construct an immutable AuthModeConfig. Centralised so login.ts
 * (and the wizard) build the same shape and we don't silently drop
 * the ToS acknowledgement field somewhere.
 */
export function createAuthModeConfig(opts: {
  readonly mode: AuthMode;
  readonly userAcknowledgedTos: boolean;
  readonly setAt?: number;
}): AuthModeConfig {
  return {
    mode: opts.mode,
    userAcknowledgedTos: opts.userAcknowledgedTos,
    setAt: opts.setAt ?? Date.now(),
  };
}

/**
 * Refuse-business-with-only-oauth gate. Returns a refusal reason
 * string when business mode was picked but no API key is present
 * (only OAuth-via-CC creds), or null when business mode is OK.
 *
 * Personal mode is permitted with either credential combo — the
 * banner copy is what flags "do not use for product work".
 */
export function refuseReasonForMode(opts: {
  readonly mode: AuthMode;
  readonly hasClaudeCliCreds: boolean;
  readonly hasAnthropicApiKey: boolean;
}): string | null {
  if (opts.mode === "business-api-key" && !opts.hasAnthropicApiKey) {
    return (
      "Business mode requires an ANTHROPIC_API_KEY. " +
      "OAuth-via-Claude-Code tokens are server-rejected for non-Claude-Code clients " +
      "since 2026-01-09. Get a key at https://console.anthropic.com/settings/keys " +
      "and re-run: wotann login --mode business"
    );
  }
  return null;
}
