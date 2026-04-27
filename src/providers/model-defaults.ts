/**
 * Single source of truth for provider defaults (S1-16/17/18 follow-up).
 *
 * Every file that needs to know "what model should I use for provider X" or
 * "what worker/oracle pair should I escalate between" reads from this table
 * instead of hardcoding strings inline. Updating a model default or adding a
 * new provider happens in exactly one place.
 *
 * The table is intentionally data, not code — if the user wants to override
 * (for example to pin to an older Sonnet version), they can do so via
 * `~/.wotann/wotann.yaml` providers.<name>.model. Those user values beat
 * everything here.
 *
 * All values verified against provider docs on April 14, 2026.
 *
 * Wave DH-1: per-provider model id consts. Each provider's namespace is
 * distinct, so its current canonical model ids are pinned in a single block
 * here. When a provider ships a new flagship version, this is the ONLY place
 * the literal needs to change — every other file reads through
 * PROVIDER_DEFAULTS or these named consts. Keeping the literals here (rather
 * than scattered across adapters) makes future bumps a 1-line change.
 */

// ── Per-provider model id consts (source of truth) ────────────────────────
// Anthropic's current production lineup. claude-cli-backend.ts and
// anthropic-adapter.ts re-declare matching consts at top-of-file so each
// provider module owns its own copy of its provider-scoped namespace
// (QB#7 — no module-globals across provider boundaries).
const ANTHROPIC_OPUS = "claude-opus-4-7";
const ANTHROPIC_SONNET = "claude-sonnet-4-7";
// OpenAI's current production lineup as it appears in defaults below.
const OPENAI_DEFAULT = "gpt-5";
const OPENAI_ORACLE = "gpt-5.4";
// AWS Bedrock uses Anthropic models with an `anthropic.` namespace prefix.
const BEDROCK_SONNET = "anthropic.claude-sonnet-4-7";
const BEDROCK_OPUS = "anthropic.claude-opus-4-7";

export interface ProviderDefault {
  /** Canonical flagship model — used when the user picks the provider with no
   *  model override. This is the "safe default" for chat/coding. */
  readonly defaultModel: string;
  /** Cheaper/faster model used as the worker in oracle/worker escalation. For
   *  Anthropic we use Sonnet (not Haiku) — Sonnet is the cheap-but-capable
   *  tier; Haiku is too weak for real coding loops. */
  readonly workerModel: string;
  /** Heavyweight model used on escalation. Must be strictly stronger than
   *  workerModel or escalation is a no-op. */
  readonly oracleModel: string;
  /** Env var names we check to detect whether the user has this provider
   *  configured. First-present-wins at discovery time. */
  readonly envKeys: readonly string[];
  /** One-line display label for UI attribution. */
  readonly label: string;
}

/**
 * Lookup table for all 17 providers WOTANN supports.
 */
export const PROVIDER_DEFAULTS: Readonly<Record<string, ProviderDefault>> = {
  anthropic: {
    defaultModel: ANTHROPIC_SONNET,
    workerModel: ANTHROPIC_SONNET,
    oracleModel: ANTHROPIC_OPUS,
    envKeys: ["ANTHROPIC_API_KEY"],
    label: "Anthropic",
  },
  "anthropic-cli": {
    defaultModel: ANTHROPIC_SONNET,
    workerModel: ANTHROPIC_SONNET,
    oracleModel: ANTHROPIC_OPUS,
    envKeys: [],
    label: "Claude (subscription)",
  },
  openai: {
    defaultModel: OPENAI_DEFAULT,
    workerModel: OPENAI_DEFAULT,
    oracleModel: OPENAI_ORACLE,
    envKeys: ["OPENAI_API_KEY"],
    label: "OpenAI",
  },
  "openai-compat": {
    defaultModel: OPENAI_DEFAULT,
    workerModel: OPENAI_DEFAULT,
    oracleModel: OPENAI_ORACLE,
    envKeys: [],
    label: "OpenAI-compatible",
  },
  codex: {
    defaultModel: "codexspark",
    workerModel: "codexspark",
    oracleModel: "codexplan",
    envKeys: [],
    label: "Codex (ChatGPT subscription)",
  },
  copilot: {
    defaultModel: "gpt-4.1",
    workerModel: "gpt-4.1",
    oracleModel: "gpt-5",
    envKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
    label: "GitHub Copilot",
  },
  gemini: {
    defaultModel: "gemini-3.1-pro",
    workerModel: "gemini-2.5-flash",
    oracleModel: "gemini-3.1-pro",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"],
    label: "Google Gemini",
  },
  vertex: {
    defaultModel: "gemini-3.1-pro",
    workerModel: "gemini-2.5-flash",
    oracleModel: "gemini-3.1-pro",
    envKeys: ["GOOGLE_APPLICATION_CREDENTIALS"],
    label: "Google Vertex AI",
  },
  deepseek: {
    defaultModel: "deepseek-v4",
    workerModel: "deepseek-v4",
    oracleModel: "deepseek-r1",
    envKeys: ["DEEPSEEK_API_KEY"],
    label: "DeepSeek",
  },
  xai: {
    defaultModel: "grok-4.1-fast",
    workerModel: "grok-4.1-fast",
    oracleModel: "grok-4",
    envKeys: ["XAI_API_KEY"],
    label: "xAI Grok",
  },
  mistral: {
    defaultModel: "mistral-large-3",
    workerModel: "codestral",
    oracleModel: "mistral-large-3",
    envKeys: ["MISTRAL_API_KEY"],
    label: "Mistral",
  },
  free: {
    defaultModel: "llama-3.3-70b-versatile",
    workerModel: "llama-3.1-8b-instant",
    oracleModel: "llama-3.3-70b-versatile",
    envKeys: ["GROQ_API_KEY"],
    label: "Groq (free tier)",
  },
  together: {
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    workerModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    oracleModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    envKeys: ["TOGETHER_API_KEY"],
    label: "Together AI",
  },
  fireworks: {
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    workerModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    oracleModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    envKeys: ["FIREWORKS_API_KEY"],
    label: "Fireworks AI",
  },
  perplexity: {
    defaultModel: "sonar",
    workerModel: "sonar",
    oracleModel: "sonar-pro",
    envKeys: ["PERPLEXITY_API_KEY"],
    label: "Perplexity",
  },
  huggingface: {
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    workerModel: "meta-llama/Meta-Llama-3.1-8B-Instruct",
    oracleModel: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    envKeys: ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
    label: "HuggingFace",
  },
  azure: {
    defaultModel: OPENAI_DEFAULT,
    workerModel: OPENAI_DEFAULT,
    oracleModel: OPENAI_ORACLE,
    envKeys: ["AZURE_OPENAI_API_KEY"],
    label: "Azure OpenAI",
  },
  bedrock: {
    defaultModel: BEDROCK_SONNET,
    workerModel: BEDROCK_SONNET,
    oracleModel: BEDROCK_OPUS,
    envKeys: ["AWS_ACCESS_KEY_ID"],
    label: "AWS Bedrock",
  },
  sambanova: {
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    workerModel: "Meta-Llama-3.3-70B-Instruct",
    oracleModel: "Meta-Llama-3.3-70B-Instruct",
    envKeys: ["SAMBANOVA_API_KEY"],
    label: "SambaNova",
  },
  ollama: {
    defaultModel: "gemma4:e4b",
    workerModel: "gemma4:e4b",
    oracleModel: "gemma4:26b",
    envKeys: [],
    label: "Ollama (local)",
  },
  cerebras: {
    defaultModel: "llama-4-scout-17b-16e",
    workerModel: "llama-4-scout-17b-16e",
    oracleModel: "llama-4-scout-17b-16e",
    envKeys: ["CEREBRAS_API_KEY"],
    label: "Cerebras",
  },
  // Groq named entry: registry.ts has its own `case "groq":` independent
  // of the `free` umbrella, so getProviderDefaults("groq") needs a real
  // entry rather than falling through to ollama. Mirrors the `free`
  // defaults since both adapter configs target the same Groq endpoint.
  groq: {
    defaultModel: "llama-3.3-70b-versatile",
    workerModel: "llama-3.1-8b-instant",
    oracleModel: "llama-3.3-70b-versatile",
    envKeys: ["GROQ_API_KEY"],
    label: "Groq",
  },
  // OpenRouter cross-surface gap (Gap-1): users picking OpenRouter on iOS
  // pairing or desktop onboarding got silent registry drop. Now both the
  // registry case and these defaults exist. Default model is a free,
  // capable Llama variant so first-run works without a paid plan; users
  // override per-call. Worker model uses the same free tier; oracle
  // model uses Claude Sonnet which OpenRouter proxies.
  openrouter: {
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    workerModel: "meta-llama/llama-3.3-70b-instruct:free",
    oracleModel: "anthropic/claude-sonnet-4.5",
    envKeys: ["OPENROUTER_API_KEY"],
    label: "OpenRouter",
  },
} as const;

/**
 * Resolve the canonical model pair for a given provider. Unknown providers
 * fall back to a neutral "no opinion" pair (Ollama local), avoiding any
 * vendor-biased default.
 */
export function getProviderDefaults(provider: string | null | undefined): ProviderDefault {
  if (!provider) return PROVIDER_DEFAULTS["ollama"]!;
  return PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS["ollama"]!;
}

/**
 * Reverse lookup: given a set of env vars present, which provider should we
 * default to? Returns null when nothing is configured. Order follows the
 * defined key order in PROVIDER_DEFAULTS (iteration order of a Record
 * preserves insertion order in JS).
 */
export function detectProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { provider: string; model: string } | null {
  for (const [name, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
    for (const key of defaults.envKeys) {
      if (env[key]) {
        return { provider: name, model: defaults.defaultModel };
      }
    }
  }
  return null;
}
