/**
 * BYOA — Bring Your Own Anthropic.
 *
 * Detects whether the user has a personal Anthropic API key available
 * (from console.anthropic.com) so WOTANN can route requests directly
 * to that account instead of through a pooled provider. Keeps the
 * user's existing Anthropic subscription the billing source.
 *
 * Detection priority:
 *   1. `ANTHROPIC_API_KEY` environment variable
 *   2. Claude CLI config at `~/.claude.json` (reads `anthropicApiKey`)
 *
 * Separate from `anthropic-subscription.ts` which handles the Claude
 * Code CLI OAuth / Max/Pro subscription flow. BYOA is the **raw API
 * key** path — the user's console.anthropic.com API key lives outside
 * the CLI's OAuth store, so we need a dedicated detector.
 *
 * Security bar: the raw key bytes MUST NEVER appear in any
 * user-facing string (logs, thrown errors, printed status). Every
 * public API that touches the key returns it alongside a `masked`
 * form so callers can make the right choice by default.
 *
 * WOTANN quality bars:
 *  - QB #6 honest failures: distinct error classes for
 *    `invalid-key` (Anthropic said 401) vs `unreachable`
 *    (network/DNS/other HTTP failure). Never conflate them.
 *  - QB #7 per-call state: no module-level caches. Every call
 *    reads from the provided `ByoaEnv` snapshot.
 *  - QB #13 env guard: we never read `process.env` implicitly —
 *    callers pass `ByoaEnv` so tests, IPC, and the TUI can
 *    inject their own environment cleanly.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Public types ──────────────────────────────────────────────────────────

export interface ByoaEnv {
  readonly envVars: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}

export type ByoaSource = "env-var" | "claude-cli-config" | "none";

export interface ByoaDetectionResult {
  readonly detected: boolean;
  /**
   * Raw key (only present when detected=true). Callers must use
   * `masked` for any user-visible output. The raw key is here only
   * so downstream providers can actually make authenticated calls.
   */
  readonly apiKey?: string;
  readonly masked?: string;
  readonly source: ByoaSource;
}

export type ByoaValidator = (apiKey: string) => Promise<ByoaValidatorResponse>;

export interface ByoaValidatorResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ByoaValidationSuccess {
  readonly ok: true;
  readonly maskedKey: string;
}

// ── Errors ────────────────────────────────────────────────────────────────

/**
 * Thrown when Anthropic rejects the key (HTTP 401). Message is
 * guaranteed to contain only the masked form of the key.
 */
export class ByoaKeyInvalidError extends Error {
  readonly maskedKey: string;
  constructor(maskedKey: string, upstream?: string) {
    super(`Anthropic rejected the BYOA key (${maskedKey}): ${upstream ?? "authentication_error"}`);
    this.name = "ByoaKeyInvalidError";
    this.maskedKey = maskedKey;
  }
}

/**
 * Thrown when the validator could not reach Anthropic — network
 * failure, DNS, 5xx, timeout, anything that's not a clean 401.
 * Message contains only the masked key.
 */
export class ByoaValidationUnreachableError extends Error {
  readonly maskedKey: string;
  constructor(maskedKey: string, upstream?: string) {
    super(
      `Could not validate BYOA key (${maskedKey}) — validator unreachable: ${upstream ?? "unknown"}`,
    );
    this.name = "ByoaValidationUnreachableError";
    this.maskedKey = maskedKey;
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Mask an API key for safe display. Preserves the `sk-ant-` prefix
 * (so operators can tell it's an Anthropic key) and shows only the
 * last 4 chars so operators can tell two keys apart without seeing
 * their secret bodies.
 *
 * For keys shorter than 8 chars we never echo any substring; we
 * emit a fixed stars form so the function cannot be used as a leak
 * vector.
 */
export function maskApiKey(key: string): string {
  if (typeof key !== "string" || key.length < 8) {
    return "sk-ant-…****";
  }
  const last4 = key.slice(-4);
  return `sk-ant-…${last4}`;
}

/**
 * Detect whether a BYOA key is configured. Pure — does not
 * hit the network and does not mutate the environment.
 */
export function detectByoa(env: ByoaEnv): ByoaDetectionResult {
  // 1. env var takes priority
  const envKey = env.envVars["ANTHROPIC_API_KEY"];
  if (typeof envKey === "string" && envKey.length > 0) {
    return {
      detected: true,
      apiKey: envKey,
      masked: maskApiKey(envKey),
      source: "env-var",
    };
  }

  // 2. Claude CLI config
  const configPath = join(env.homeDir, ".claude.json");
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        const candidate = rec["anthropicApiKey"] ?? rec["apiKey"];
        if (typeof candidate === "string" && candidate.length > 0) {
          return {
            detected: true,
            apiKey: candidate,
            masked: maskApiKey(candidate),
            source: "claude-cli-config",
          };
        }
      }
    } catch {
      // Malformed JSON — treat as absent, never throw.
    }
  }

  return { detected: false, source: "none" };
}

/**
 * Validate a BYOA key by calling the provided validator. The
 * validator is the network boundary — tests pass a mock, production
 * wires it to a real `fetch` against Anthropic's `/v1/models`.
 *
 * Returns `{ ok: true, maskedKey }` on a 200 response. On a 401,
 * throws `ByoaKeyInvalidError`. On any other failure (network,
 * timeout, 5xx, transport exception), throws
 * `ByoaValidationUnreachableError`. The error messages never
 * contain the raw key.
 */
export async function validateByoaKey(
  apiKey: string,
  validator: ByoaValidator,
): Promise<ByoaValidationSuccess> {
  const masked = maskApiKey(apiKey);
  try {
    const res = await validator(apiKey);
    if (res.status === 200) {
      return { ok: true, maskedKey: masked };
    }
    if (res.status === 401 || res.status === 403) {
      throw new ByoaKeyInvalidError(masked, extractErrorSummary(res.body));
    }
    // Everything else is treated as unreachable/unknown. We never
    // want to *claim* a key is invalid because of a transient 5xx.
    throw new ByoaValidationUnreachableError(
      masked,
      `http ${res.status}: ${extractErrorSummary(res.body)}`,
    );
  } catch (err) {
    if (err instanceof ByoaKeyInvalidError) throw err;
    if (err instanceof ByoaValidationUnreachableError) throw err;
    // Transport error — e.g. fetch threw, timeout, DNS. We still
    // carry the masked key, never the raw key.
    const upstream = err instanceof Error ? sanitizeUpstream(err.message, apiKey) : "unknown";
    throw new ByoaValidationUnreachableError(masked, upstream);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function extractErrorSummary(body: unknown): string {
  if (!body || typeof body !== "object") return "no details";
  const rec = body as Record<string, unknown>;
  const err = rec["error"];
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const innerRec = err as Record<string, unknown>;
    const msg = innerRec["message"] ?? innerRec["type"];
    if (typeof msg === "string") return msg;
  }
  return "no details";
}

/**
 * Defence-in-depth: if the transport error itself happens to contain
 * the raw key (very rare, but some HTTP libraries echo headers back
 * in error messages), strip it out before forwarding. This guarantees
 * the key can never escape via upstream error text.
 */
function sanitizeUpstream(msg: string, apiKey: string): string {
  if (!msg) return "unknown";
  if (apiKey.length >= 8 && msg.includes(apiKey)) {
    return msg.split(apiKey).join("<redacted>");
  }
  return msg;
}

// ── Preference file ──────────────────────────────────────────────────────
//
// User config: `~/.wotann/byoa-preference.json` with shape
//   { "mode": "prefer-byoa" | "prefer-pooled" | "byoa-only" }
// The preference lives outside the detector (which is a pure function
// of ByoaEnv) so the detector stays cacheable and side-effect-free.

export type ByoaPreferenceMode = "prefer-byoa" | "prefer-pooled" | "byoa-only";

export interface ByoaPreference {
  readonly mode: ByoaPreferenceMode;
}

export function defaultByoaPreference(): ByoaPreference {
  return { mode: "prefer-byoa" };
}

export function readByoaPreference(homeDir: string): ByoaPreference {
  const path = join(homeDir, ".wotann", "byoa-preference.json");
  if (!existsSync(path)) return defaultByoaPreference();
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const mode = rec["mode"];
      if (mode === "prefer-byoa" || mode === "prefer-pooled" || mode === "byoa-only") {
        return { mode };
      }
    }
  } catch {
    // malformed — fall through to default
  }
  return defaultByoaPreference();
}
