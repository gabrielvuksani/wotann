/**
 * LM Studio provider adapter — V9 Tier 6 T6.3.
 *
 * LM Studio exposes an OpenAI-compatible HTTP server on
 * `http://localhost:1234/v1` when the user launches its "Local Server"
 * feature. Any model the user has loaded in LM Studio becomes
 * available via `/v1/models` and `/v1/chat/completions`. WOTANN
 * treats it as a cloud-free, zero-cost local provider — same family
 * as Ollama but with GGUF quantization options via LM Studio's UI.
 *
 * This adapter is THIN: detection probes `localhost:1234/v1/models`
 * with a short timeout, and the adapter itself delegates to the
 * existing `openai-compat-adapter` factory (no duplicated chat-
 * completion wiring — single source of truth lives in
 * `openai-compat-adapter.ts`).
 *
 * Design choices:
 * - Detection uses an `AbortController` with a short timeout (2 s)
 *   so the onboarding wizard doesn't hang when LM Studio isn't
 *   running. A missing server is the common case — fail fast.
 * - The discovery of loaded model IDs is best-effort. When the
 *   `/v1/models` response shape is unexpected, we return `[]`
 *   (honest empty) and let the caller choose — never invent model
 *   IDs that LM Studio doesn't actually have loaded.
 * - The adapter requires NO API key (LM Studio's server is
 *   unauthenticated by design). The `apiKey` field on the underlying
 *   openai-compat config is populated with `"lm-studio"` as a
 *   sentinel so upstream code that logs "which account?" has
 *   something non-empty to show — but any string works; LM Studio
 *   ignores it.
 *
 * WOTANN quality bars:
 * - QB #6 honest failures: `probeLmStudio` returns `null` on any
 *   error. Never fabricates a model list.
 * - QB #7 per-call state: no module-level caches. Each call
 *   re-probes (the probe is cheap and a user can swap models in
 *   LM Studio without restarting WOTANN).
 * - QB #13 env guard: no ambient env reads. Caller supplies the
 *   baseUrl if it needs to override the LM Studio default.
 */

import type { ProviderAdapter, ProviderCapabilities } from "./types.js";
import type { ProviderName, TransportType } from "../core/types.js";

// ── Constants ─────────────────────────────────────────────────────────────

/** LM Studio's default Local Server endpoint. Per their docs. */
export const LM_STUDIO_DEFAULT_BASE_URL = "http://localhost:1234/v1";

/** Probe timeout — short so onboarding doesn't hang on a missing server. */
const PROBE_TIMEOUT_MS = 2_000;

// ── Detection ─────────────────────────────────────────────────────────────

export interface LmStudioProbeResult {
  readonly available: boolean;
  readonly baseUrl: string;
  readonly models: readonly string[];
}

/**
 * Probe LM Studio's `/v1/models` endpoint. Returns the list of
 * loaded model IDs when available, `null` when the server is
 * unreachable OR the response shape is unexpected.
 *
 * @param baseUrl Override the default URL. Defaults to LM Studio's
 *                canonical `http://localhost:1234/v1`.
 * @param fetchImpl Dependency-injectable fetch — tests pass a
 *                 stub to assert the probe surface without hitting
 *                 the network.
 */
export async function probeLmStudio(
  baseUrl: string = LM_STUDIO_DEFAULT_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<LmStudioProbeResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      signal: controller.signal,
      // LM Studio's server is unauthenticated; no Authorization header.
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: ReadonlyArray<{ id?: unknown }> };
    const entries = Array.isArray(body?.data) ? body.data : [];
    const models: string[] = [];
    for (const entry of entries) {
      if (entry && typeof entry === "object" && typeof entry.id === "string") {
        models.push(entry.id);
      }
    }
    return { available: true, baseUrl, models };
  } catch {
    // ECONNREFUSED / AbortError / malformed JSON all land here —
    // the caller sees a single "not available" signal.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Adapter factory ───────────────────────────────────────────────────────

export interface LmStudioAdapterOptions {
  /** Override LM Studio's base URL (e.g. for remote bridges). */
  readonly baseUrl?: string;
  /**
   * Default model id. When omitted, WOTANN uses whatever the first
   * `/v1/models` entry reports — which matches LM Studio's own UI
   * behavior of "current loaded model."
   */
  readonly defaultModel?: string;
  /** Caller-supplied model list (usually from a prior probe). */
  readonly models?: readonly string[];
  /**
   * Capability overrides. LM Studio can load models with vision,
   * tool-calling, etc., but detecting each model's capability set
   * requires per-model metadata WOTANN doesn't have. We pick
   * conservative defaults (text + streaming) and let callers
   * opt into more when they know their loaded model.
   */
  readonly capabilities?: Partial<ProviderCapabilities>;
}

/**
 * Conservative defaults for a freshly-loaded LM Studio model.
 * Streaming is always on (LM Studio supports SSE). Tool-calling is
 * off by default because many GGUF ports don't implement it; the
 * user can override when they've loaded e.g. a Qwen coder model.
 * Vision is off for the same reason.
 */
const DEFAULT_LM_STUDIO_CAPABILITIES: ProviderCapabilities = {
  supportsComputerUse: false,
  supportsToolCalling: false,
  supportsVision: false,
  supportsStreaming: true,
  supportsThinking: false,
  maxContextWindow: 8_192, // most 7B/13B GGUF builds cap here
};

/**
 * Build a ProviderAdapter for LM Studio. Delegates to the shared
 * `createOpenAICompatAdapter` factory — zero duplicated chat-
 * completion plumbing. This wrapper's only job is to fill in the
 * LM-Studio-specific defaults (base URL, pseudo-apikey, capabilities).
 *
 * The import of `createOpenAICompatAdapter` is LAZY so consumers
 * that only care about `probeLmStudio()` (e.g. the onboarding
 * wizard's hardware/provider ladder) don't pull the full
 * openai-compat adapter transitively.
 */
export async function createLmStudioAdapter(
  opts: LmStudioAdapterOptions = {},
): Promise<ProviderAdapter> {
  const baseUrl = opts.baseUrl ?? LM_STUDIO_DEFAULT_BASE_URL;
  const models = opts.models ?? [];
  const defaultModel = opts.defaultModel ?? models[0] ?? "local-model";
  const capabilities: ProviderCapabilities = {
    ...DEFAULT_LM_STUDIO_CAPABILITIES,
    ...opts.capabilities,
  };

  // Lazy import keeps the onboarding probe path free of the full
  // openai-compat adapter module (and its transitive deps).
  const { createOpenAICompatAdapter } = await import("./openai-compat-adapter.js");
  // TS needs the precise provider name; LM Studio's billing model is
  // local/free so "lm-studio" is the canonical tag. If the
  // ProviderName union doesn't list it yet, the caller can cast at
  // the call-site — adding the tag to ProviderName is a separate
  // concern (would ripple across cost tracker, router, etc.).
  const provider = "lm-studio" as ProviderName;
  // LM Studio speaks OpenAI's chat/completions dialect, so
  // `chat_completions` is the right transport tag for WOTANN's router.
  const transport: TransportType = "chat_completions";

  return createOpenAICompatAdapter({
    provider,
    baseUrl,
    apiKey: "lm-studio", // sentinel; LM Studio ignores it
    defaultModel,
    models,
    capabilities,
    transport,
  });
}
