/**
 * Core agent bridge: routes prompts through the provider fallback chain.
 *
 * FALLBACK ARCHITECTURE (never degrade the model):
 *   preferred provider → other authenticated providers → free tier
 *
 * When a provider is rate-limited, the bridge walks the entire fallback chain
 * until it finds one that works. Free models (Ollama + community APIs) are the
 * ultimate safety net — the user always gets a response.
 */

import type { ProviderName, WotannQueryOptions } from "./types.js";
import type { ProviderAdapter, StreamChunk, UnifiedQueryOptions } from "../providers/types.js";
import { ModelRouter } from "../providers/model-router.js";
import { RateLimitManager } from "../providers/rate-limiter.js";
import { buildFallbackChain, resolveNextProvider } from "../providers/fallback-chain.js";
import { augmentQuery, parseToolCallsFromText } from "../providers/capability-augmenter.js";
import { AccountPool } from "../providers/account-pool.js";
import { SemanticCache, bigramEmbedding } from "../memory/semantic-cache.js";
import { estimatePromptTokens, estimateCost } from "../telemetry/token-estimator.js";

export interface AgentBridgeConfig {
  readonly adapters: ReadonlyMap<ProviderName, ProviderAdapter>;
  readonly router: ModelRouter;
  readonly rateLimiter: RateLimitManager;
  readonly accountPool?: AccountPool;
  readonly defaultModel?: string;
  readonly defaultProvider?: ProviderName;
  /**
   * Pre-flight cost/token estimator hook. Called once per query() before
   * the fallback chain walks. Use for budget display, cost audit, or
   * routing-aware decisions. Optional — wire only when a consumer wants
   * the signal (telemetry emitter, cost preview UI, etc.).
   */
  readonly onPreflightEstimate?: (e: {
    readonly provider: ProviderName;
    readonly model: string | undefined;
    readonly estimatedTokens: number;
    readonly estimatedCostUsd: number;
  }) => void;
}

export interface QueryResult {
  readonly content: string;
  readonly model: string;
  readonly provider: ProviderName;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly usedFallback: boolean;
  readonly fallbackChain?: readonly string[];
}

export class AgentBridge {
  private readonly adapters: ReadonlyMap<ProviderName, ProviderAdapter>;
  private readonly router: ModelRouter;
  private readonly rateLimiter: RateLimitManager;
  private readonly accountPool: AccountPool | null;
  private readonly defaultModel: string;
  private readonly defaultProvider: ProviderName;
  private readonly onPreflightEstimate: AgentBridgeConfig["onPreflightEstimate"] | undefined;
  /**
   * Phase 13 Wave-3C — optional semantic LLM response cache. Gated via
   * WOTANN_SEMANTIC_CACHE=1. Uses a lightweight char-bigram surrogate
   * embedding so the cache stays self-contained (no ML dep). Per-session
   * (per-bridge-instance) state — never module-global.
   */
  private semanticCache: SemanticCache<QueryResult> | null = null;

  constructor(config: AgentBridgeConfig) {
    this.adapters = config.adapters;
    this.router = config.router;
    this.rateLimiter = config.rateLimiter;
    this.accountPool = config.accountPool ?? null;
    this.defaultModel = config.defaultModel ?? "gemma4:e4b";
    this.defaultProvider = config.defaultProvider ?? ("ollama" as ProviderName);
    this.onPreflightEstimate = config.onPreflightEstimate;
    if (process.env["WOTANN_SEMANTIC_CACHE"] === "1") {
      this.semanticCache = new SemanticCache<QueryResult>({
        similarityThreshold: 0.95,
        embed: async (text) => bigramEmbedding(text),
      });
    }
  }

  /**
   * Stream a query through the agent bridge with full fallback chain.
   *
   * On rate limit or error: walks through ALL authenticated providers,
   * then falls to free tier as ultimate safety net.
   */
  async *query(options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    const startTime = Date.now();

    // Route to best provider for this task
    const routing = this.router.route(this.router.classifyIntent(options.prompt));

    const preferredProvider = options.provider ?? routing.provider;
    // "auto" means let the adapter pick its default — don't pass it through
    const routedModel = routing.model === "auto" ? undefined : routing.model;
    const model = options.model ?? routedModel;

    // Pre-flight token + cost estimate (telemetry). Zero pricing is honest
    // — callers wire real pricing via onPreflightEstimate when they know
    // the active provider's per-1k rate. Wrapped in try/catch so a bad
    // estimate never blocks a query.
    if (this.onPreflightEstimate) {
      try {
        const promptText =
          options.prompt + (options.systemPrompt ? `\n${options.systemPrompt}` : "");
        const estimatedTokens = estimatePromptTokens(promptText);
        const costEstimate = estimateCost({
          prompt: promptText,
          expectedOutputTokens: options.maxTokens ?? 1024,
          pricing: { inputPer1k: 0, outputPer1k: 0 },
        });
        this.onPreflightEstimate({
          provider: preferredProvider,
          model,
          estimatedTokens,
          estimatedCostUsd: costEstimate.totalCostUsd,
        });
      } catch {
        // non-fatal — estimate is best-effort telemetry
      }
    }

    // Build full fallback chain: preferred → other paid → free
    const chain = buildFallbackChain(preferredProvider, new Set(this.adapters.keys()), (p) =>
      this.rateLimiter.isRateLimited(p),
    );

    const queryOptions: UnifiedQueryOptions = {
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      messages: options.context,
      model,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      stream: true,
      // S1-1: forward tools into the adapter layer. Without this, every
      // adapter sees `tools: undefined` and either strips tool calls from
      // the request body or emulates them via XML in the system prompt but
      // never parses the response — breaking the entire capability-
      // equalisation thesis for every non-Ollama provider.
      tools: options.tools?.map(
        (t) =>
          ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }) as const,
      ),
    };

    // Walk the fallback chain until one succeeds
    const triedProviders: ProviderName[] = [];

    for (const entry of chain) {
      if (entry.rateLimited) continue;

      const adapter = this.adapters.get(entry.provider);
      if (!adapter) continue;

      triedProviders.push(entry.provider);

      const triedAccountIds = new Set<string>();
      const maxAccountAttempts = Math.max(
        1,
        this.accountPool?.getAccounts(entry.provider).length ?? 0,
      );

      for (let accountAttempt = 0; accountAttempt < maxAccountAttempts; accountAttempt++) {
        const account = this.accountPool?.getBestAccount(entry.provider) ?? null;
        if (account && triedAccountIds.has(account.id)) {
          break;
        }
        if (account) triedAccountIds.add(account.id);

        // For non-preferred providers, clear the model so the adapter uses its default
        const baseOptions: UnifiedQueryOptions =
          entry.provider === preferredProvider
            ? queryOptions
            : { ...queryOptions, model: undefined };

        // Apply capability augmentation — makes tool calling, vision, thinking work
        // across ALL providers via prompt injection for models that lack native support
        const adapterOptions = augmentQuery(
          account ? { ...baseOptions, authToken: account.token } : baseOptions,
          adapter.capabilities,
        );

        try {
          const attemptStart = Date.now();
          let gotContent = false;
          let lastErrorMessage: string | null = null;
          let hitRateLimit = false;

          // S1-2: When an adapter lacks native tool calling, capability-augmenter
          // injects tool XML into the system prompt. The model responds in text
          // containing <tool_use>...</tool_use>. We accumulate text across
          // chunks so a partial XML block spanning multiple deltas can still be
          // parsed into a structured tool_use chunk.
          const canEmulateTools =
            !adapter.capabilities.supportsToolCalling &&
            Boolean(options.tools && options.tools.length > 0);
          let emulatedTextBuffer = "";
          let emulatedToolEmitted = false;

          for await (const chunk of adapter.query(adapterOptions)) {
            if (chunk.type === "text") gotContent = true;
            if (chunk.type === "error") lastErrorMessage = chunk.content;

            // For adapters with native tool calling, pass chunks through as-is.
            if (!canEmulateTools) {
              yield { ...chunk, provider: entry.provider };
            } else if (chunk.type === "text") {
              emulatedTextBuffer += chunk.content;
              if (!emulatedToolEmitted) {
                // S3-2: pass model name so the parser can dispatch to the
                // family-specific variant (Hermes / Mistral / Llama / Qwen /
                // DeepSeek / Functionary / Jamba / Command R / ToolBench /
                // Glaive). Without the model name the 11-parser dispatch
                // is dead code and every call falls through to parseAny.
                // Session-4: use the array-returning variant so multi-call
                // responses (Mistral/Command-R+/Jamba/DeepSeek routinely
                // emit 2-3 calls per turn) yield every call, not just the
                // first. Prior single-return silently dropped tail calls.
                const calls = parseToolCallsFromText(emulatedTextBuffer, adapterOptions.model);
                if (calls.length > 0) {
                  // Synthesize structured tool_use chunks for each parsed
                  // call. Suppress the raw XML text so downstream consumers
                  // don't see it twice.
                  emulatedToolEmitted = true;
                  for (const parsed of calls) {
                    yield {
                      type: "tool_use",
                      content: JSON.stringify(parsed.args),
                      toolName: parsed.name,
                      toolInput: parsed.args as Record<string, unknown>,
                      provider: entry.provider,
                      stopReason: "tool_calls",
                    };
                  }
                } else {
                  yield { ...chunk, provider: entry.provider };
                }
              }
              // If we already emitted the tool_use chunks, swallow any
              // trailing text fragments from the same XML block.
            } else if (chunk.type === "done") {
              // Re-run the parser on the final buffer in case the tool XML
              // only became complete on the last delta (rare but possible).
              if (!emulatedToolEmitted) {
                const calls = parseToolCallsFromText(emulatedTextBuffer, adapterOptions.model);
                if (calls.length > 0) {
                  emulatedToolEmitted = true;
                  for (const parsed of calls) {
                    yield {
                      type: "tool_use",
                      content: JSON.stringify(parsed.args),
                      toolName: parsed.name,
                      toolInput: parsed.args as Record<string, unknown>,
                      provider: entry.provider,
                      stopReason: "tool_calls",
                    };
                  }
                }
              }
              yield {
                ...chunk,
                provider: entry.provider,
                stopReason: chunk.stopReason ?? (emulatedToolEmitted ? "tool_calls" : "stop"),
              };
            } else {
              yield { ...chunk, provider: entry.provider };
            }

            if (chunk.type === "error" && isRateLimitError(chunk.content)) {
              hitRateLimit = true;
              if (account) this.accountPool?.recordRateLimit(account.id, 60_000);
              if (
                remainingHealthyAccounts(entry.provider, triedAccountIds, this.accountPool) === 0
              ) {
                this.rateLimiter.markRateLimited(entry.provider, 60_000);
              }
              gotContent = false;
              break;
            }
          }

          if (gotContent) {
            // Success — record health and return
            if (account) {
              this.accountPool?.recordSuccess(account.id, Date.now() - attemptStart);
            }
            this.router.recordResult(entry.provider, true, Date.now() - startTime);
            return;
          }

          if (account && lastErrorMessage && isBillingError(lastErrorMessage)) {
            this.accountPool?.recordBillingFailure(account.id);
          }

          if (hitRateLimit) {
            // Try the next account for the same provider before cascading away.
            continue;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          this.router.recordResult(entry.provider, false, Date.now() - startTime);

          if (isRateLimitError(message)) {
            if (account) this.accountPool?.recordRateLimit(account.id, 60_000);
            if (remainingHealthyAccounts(entry.provider, triedAccountIds, this.accountPool) === 0) {
              this.rateLimiter.markRateLimited(entry.provider, 60_000);
            }
            continue;
          }

          if (account && isBillingError(message)) {
            this.accountPool?.recordBillingFailure(account.id);
          }

          // Non-rate-limit error — stop trying this provider and fall through.
          break;
        }
      }
    }

    // If we get here, ALL providers (including free) failed or are rate-limited.
    // As a final attempt, force-resolve through free providers ignoring rate limits.
    const lastResort = resolveNextProvider(chain);
    if (lastResort) {
      const adapter = this.adapters.get(lastResort);
      if (adapter) {
        try {
          yield* adapter.query({ ...queryOptions, model: undefined });
          return;
        } catch {
          // Fall through to error
        }
      }
    }

    yield {
      type: "error",
      content: `All providers exhausted (tried: ${triedProviders.join(" → ")}). Configure additional providers with \`wotann providers\` or install Ollama for local free models.`,
      provider: preferredProvider,
    };
  }

  /**
   * Non-streaming query — collects all chunks into a single result.
   */
  async querySync(options: WotannQueryOptions): Promise<QueryResult> {
    // Phase 13 Wave-3C: semantic cache hit check before running the full
    // streaming pipeline. Cache key is the prompt+system+model combo so
    // different system prompts and models don't collide. Honest:
    // cache.get failure falls through to the full query path.
    if (this.semanticCache) {
      try {
        const cacheKey = `${options.systemPrompt ?? ""}::${options.model ?? ""}::${options.prompt}`;
        const hit = await this.semanticCache.get(cacheKey);
        if (hit !== null) return hit;
      } catch {
        /* honest fall-through: miss treated as cache unavailable */
      }
    }

    const startTime = Date.now();
    let content = "";
    let model = this.defaultModel;
    let provider = this.defaultProvider;
    let tokensUsed = 0;
    let usedFallback = false;
    const fallbackChain: string[] = [];

    for await (const chunk of this.query(options)) {
      if (chunk.type === "text") {
        content += chunk.content;
      }
      if (chunk.model) model = chunk.model;
      if (chunk.provider) {
        if (provider !== chunk.provider && fallbackChain.length > 0) {
          usedFallback = true;
        }
        provider = chunk.provider;
        if (!fallbackChain.includes(chunk.provider)) {
          fallbackChain.push(chunk.provider);
        }
      }
      if (chunk.tokensUsed) tokensUsed = chunk.tokensUsed;
    }

    const result: QueryResult = {
      content,
      model,
      provider,
      tokensUsed,
      durationMs: Date.now() - startTime,
      usedFallback,
      fallbackChain,
    };
    // Phase 13 Wave-3C: populate semantic cache on success. Skip on
    // empty content (errors upstream should not pollute the cache).
    if (this.semanticCache && content.length > 0) {
      try {
        const cacheKey = `${options.systemPrompt ?? ""}::${options.model ?? ""}::${options.prompt}`;
        await this.semanticCache.set(cacheKey, result);
      } catch {
        /* honest fall-through: cache.set failure is non-fatal */
      }
    }
    return result;
  }

  getAvailableProviders(): readonly ProviderName[] {
    return [...this.adapters.keys()];
  }

  /**
   * Return the adapter for a given provider name, if registered.
   * Exposed so callers (e.g. runtime tool-schema assembly) can read
   * capability flags without poking at the private adapter map.
   */
  getAdapter(provider: ProviderName): ProviderAdapter | null {
    return this.adapters.get(provider) ?? null;
  }
}

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("quota exceeded") ||
    lower.includes("usage limit")
  );
}

function isBillingError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("billing") ||
    lower.includes("insufficient funds") ||
    lower.includes("payment") ||
    lower.includes("credit balance") ||
    lower.includes("subscription required")
  );
}

function remainingHealthyAccounts(
  provider: ProviderName,
  triedAccountIds: ReadonlySet<string>,
  accountPool: AccountPool | null,
): number {
  if (!accountPool) return 0;
  return accountPool.getAccounts(provider).filter((account) => !triedAccountIds.has(account.id))
    .length;
}
