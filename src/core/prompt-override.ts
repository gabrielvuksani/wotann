/**
 * Per-prompt provider/model/effort override (C12 — Jean.build pattern).
 *
 * Jean's UX lets users tag an individual message with a model/effort
 * override without changing session-wide settings. Syntax:
 *
 *   hello there [@opus]                   → force opus for this turn
 *   refactor this [@opus-4-7 thinking=high]
 *   [@gpt-5 effort=medium] review the PR
 *
 * This module owns the parser + merge logic. The runtime consumes
 * `extractOverride(raw)` right before dispatch; whatever the user typed
 * (sans the override tag) becomes the actual prompt, and the override
 * snapshot gets applied on top of the session defaults for exactly that
 * turn. No session-state mutation — the next turn reverts to defaults.
 */

export type ThinkingLevel = "off" | "low" | "medium" | "high";
export type EffortLevel = "low" | "medium" | "high";

export interface PromptOverride {
  readonly provider?: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
  readonly thinking?: ThinkingLevel;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface ExtractedPrompt {
  readonly cleaned: string;
  readonly override: PromptOverride;
  readonly raw: string;
  readonly problems: readonly string[];
}

// ── Tag parser ───────────────────────────────────────────────

// Match "[@tag key=value key2=value2 strays...]" — permissive but
// bounded. The primary token accepts `:` so provider:model shorthand
// works. The tail greedily captures everything up to `]` so we can
// flag malformed bare tokens rather than failing the whole tag match.
const OVERRIDE_TAG_RE = /\[@([a-zA-Z0-9][a-zA-Z0-9.:_-]{0,63})([^\]]*)\]/;

export function extractOverride(raw: string): ExtractedPrompt {
  const problems: string[] = [];
  const match = raw.match(OVERRIDE_TAG_RE);
  if (!match) {
    return { cleaned: raw, override: {}, raw, problems };
  }

  const primary = match[1] ?? "";
  const kvString = (match[2] ?? "").trim();

  // Primary token can be `provider:model`, `model`, or `provider` alone.
  const { provider, model } = splitPrimary(primary, problems);

  const kvPairs = parseKvPairs(kvString, problems);
  const override: PromptOverride = {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(kvPairs.effort ? { effort: kvPairs.effort } : {}),
    ...(kvPairs.thinking ? { thinking: kvPairs.thinking } : {}),
    ...(kvPairs.temperature !== undefined ? { temperature: kvPairs.temperature } : {}),
    ...(kvPairs.maxTokens !== undefined ? { maxTokens: kvPairs.maxTokens } : {}),
  };

  // Strip the tag from the prompt text and normalise whitespace around
  // the cut so `"hello [@opus] world"` → `"hello world"`.
  const cleaned = (raw.slice(0, match.index ?? 0) + raw.slice((match.index ?? 0) + match[0].length))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

  return { cleaned, override, raw, problems };
}

// The 8 first-class providers per src/core/types.ts ProviderName +
// safe aliases that the codebase normalizes elsewhere (e.g.
// capabilities.ts:20 maps "google" → "gemini"; HF_TOKEN env var maps
// "hf" → "huggingface"). Long-tail providers (xai, groq, cerebras,
// azure, bedrock, vertex, etc.) reach via openrouter using the
// `<vendor>/<model>` slug — that's literally what openrouter exists
// for, and accepting them here would only cause downstream registry
// rejections. The "free" umbrella was removed in v9.
const KNOWN_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "codex",
  "copilot",
  "ollama",
  "openrouter",
  "gemini",
  "huggingface",
  // safe aliases — normalized at the call site
  "google", // → gemini (capabilities.ts:20 normalization)
  "hf", // → huggingface (HF_TOKEN convention)
]);

function splitPrimary(
  primary: string,
  problems: string[],
): {
  readonly provider?: string;
  readonly model?: string;
} {
  if (primary.length === 0) {
    problems.push("empty @tag");
    return {};
  }
  if (primary.includes(":")) {
    const [provider, ...rest] = primary.split(":");
    const model = rest.join(":");
    if (!provider || !model) {
      problems.push(`malformed provider:model tag: ${primary}`);
      return {};
    }
    return { provider, model };
  }
  // Disambiguation heuristic: if the token exactly matches a known
  // provider, treat it as provider-only; otherwise treat as model name.
  if (KNOWN_PROVIDERS.has(primary.toLowerCase())) {
    return { provider: primary.toLowerCase() };
  }
  return { model: primary };
}

function parseKvPairs(
  src: string,
  problems: string[],
): {
  effort?: EffortLevel;
  thinking?: ThinkingLevel;
  temperature?: number;
  maxTokens?: number;
} {
  const result: {
    effort?: EffortLevel;
    thinking?: ThinkingLevel;
    temperature?: number;
    maxTokens?: number;
  } = {};
  if (!src) return result;

  for (const pair of src.split(/\s+/)) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx === -1) {
      problems.push(`malformed override kv (missing =): "${pair}"`);
      continue;
    }
    const key = pair.slice(0, idx).toLowerCase();
    const rawValue = pair.slice(idx + 1);

    switch (key) {
      case "effort": {
        const v = rawValue.toLowerCase();
        if (v === "low" || v === "medium" || v === "high") result.effort = v;
        else problems.push(`effort must be low|medium|high, got "${rawValue}"`);
        break;
      }
      case "thinking": {
        const v = rawValue.toLowerCase();
        if (v === "off" || v === "low" || v === "medium" || v === "high") result.thinking = v;
        else problems.push(`thinking must be off|low|medium|high, got "${rawValue}"`);
        break;
      }
      case "temperature":
      case "temp": {
        const n = Number(rawValue);
        if (Number.isFinite(n) && n >= 0 && n <= 2) result.temperature = n;
        else problems.push(`temperature out of range [0..2]: "${rawValue}"`);
        break;
      }
      case "maxtokens":
      case "max_tokens":
      case "max-tokens": {
        const n = Number.parseInt(rawValue, 10);
        if (Number.isFinite(n) && n > 0 && n <= 128_000) result.maxTokens = n;
        else problems.push(`maxTokens out of range (1..128000): "${rawValue}"`);
        break;
      }
      default:
        problems.push(`unknown override key: "${key}"`);
    }
  }
  return result;
}

// ── Merge with defaults ──────────────────────────────────────

export interface TurnDispatchConfig {
  readonly provider: string;
  readonly model: string;
  readonly effort?: EffortLevel;
  readonly thinking?: ThinkingLevel;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

/**
 * Overlay a turn-scoped override on session defaults. Missing override
 * fields fall back to the session value. Provider/model pair is atomic
 * — if the user sets only a model, we keep the session's provider
 * unless the model is provider-qualified via `:` in which case the
 * earlier splitPrimary() already populated both.
 */
export function applyOverride(
  defaults: TurnDispatchConfig,
  override: PromptOverride,
): TurnDispatchConfig {
  return {
    provider: override.provider ?? defaults.provider,
    model: override.model ?? defaults.model,
    effort: override.effort ?? defaults.effort,
    thinking: override.thinking ?? defaults.thinking,
    temperature: override.temperature ?? defaults.temperature,
    maxTokens: override.maxTokens ?? defaults.maxTokens,
  };
}

export function hasOverride(override: PromptOverride): boolean {
  return (
    override.provider !== undefined ||
    override.model !== undefined ||
    override.effort !== undefined ||
    override.thinking !== undefined ||
    override.temperature !== undefined ||
    override.maxTokens !== undefined
  );
}

/**
 * Runtime-friendly shape — returns a `{prompt, override}` tuple so
 * callers that only need the cleaned prompt + override (not the raw
 * source nor the problems list) can destructure directly.
 *
 *   const { prompt, override } = extractPromptAndOverride(raw);
 *   if (hasOverride(override)) {
 *     config = applyOverride(sessionDefaults, override);
 *   }
 *
 * Drops the `raw` and `problems` fields from the full ExtractedPrompt
 * for call-sites that want a minimal surface. For diagnostics, call
 * `extractOverride(raw)` directly.
 */
export function extractPromptAndOverride(raw: string): {
  readonly prompt: string;
  readonly override: PromptOverride;
} {
  const result = extractOverride(raw);
  return { prompt: result.cleaned, override: result.override };
}

/**
 * Friendly prefix matcher for known override tokens. Recognises the
 * shorthand forms [@opus-4-7], [@sonnet], [@reasoning] that the TUI
 * uses without waiting for the full parser to validate. Useful when
 * the caller wants to decide whether to show "override chip" UI
 * before dispatching the full extractOverride call.
 */
export function hasOverrideTag(raw: string): boolean {
  return /\[@[a-zA-Z0-9][a-zA-Z0-9.:_-]{0,63}[^\]]*\]/.test(raw);
}
