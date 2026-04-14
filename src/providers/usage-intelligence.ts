/**
 * Usage Intelligence — adapts WOTANN behavior based on provider billing model.
 *
 * PRINCIPLE: Maximum power for subscription/local users. Cost-efficient for pay-as-you-go.
 *
 * Subscription/Local (Claude Pro/Max, ChatGPT Plus, Ollama):
 * - Use the most powerful model available
 * - Maximize thinking tokens (extended reasoning)
 * - Load full context aggressively
 * - Enable all intelligence amplifications
 * - No cost warnings (it's already paid for)
 *
 * Pay-as-you-go API (ANTHROPIC_API_KEY, OPENAI_API_KEY):
 * - Route tasks to optimal model per task type
 * - Use task-appropriate thinking budgets
 * - Apply dynamic context discovery (46.9% token savings)
 * - Show cost predictions before expensive operations
 * - Use prompt caching aggressively (75% savings)
 *
 * The DEFAULT is always maximum power. Cost optimization is opt-in.
 */

// ── Billing Models ──────────────────────────────────────

export type BillingModel = "subscription" | "local" | "api" | "free" | "unknown";

export interface UsageProfile {
  readonly billingModel: BillingModel;
  readonly maxPowerMode: boolean;
  readonly showCostWarnings: boolean;
  readonly useTaskRouting: boolean;
  readonly thinkingBudget: "maximum" | "adaptive" | "minimal";
  readonly contextStrategy: "aggressive" | "dynamic" | "minimal";
  readonly cacheStrategy: "always" | "when-beneficial" | "never";
  readonly recommendCheaperAlternative: boolean;
}

// ── Provider Classification ─────────────────────────────

const SUBSCRIPTION_PROVIDERS = new Set([
  "anthropic-subscription",  // Claude Pro/Max via claude-agent-sdk
  "codex",                   // ChatGPT Plus via Codex backend
  "copilot",                 // GitHub Copilot (subscription)
]);

const LOCAL_PROVIDERS = new Set([
  "ollama",                  // Ollama (free, local)
]);

const FREE_PROVIDERS = new Set([
  "free",                    // Groq/Cerebras/OpenRouter free tiers
  "gemini",                  // Google AI Studio free tier
]);

const API_PROVIDERS = new Set([
  "anthropic",               // Pay-per-token Anthropic API
  "openai",                  // Pay-per-token OpenAI API
  "azure",                   // Azure OpenAI
  "bedrock",                 // AWS Bedrock
  "vertex",                  // Google Vertex AI
]);

/**
 * Classify a provider's billing model.
 */
export function classifyProvider(providerId: string): BillingModel {
  if (SUBSCRIPTION_PROVIDERS.has(providerId)) return "subscription";
  if (LOCAL_PROVIDERS.has(providerId)) return "local";
  if (FREE_PROVIDERS.has(providerId)) return "free";
  if (API_PROVIDERS.has(providerId)) return "api";
  return "unknown";
}

/**
 * Get the optimal usage profile for a provider.
 * Default: maximum power. Cost optimization only for pay-as-you-go API users.
 */
export function getUsageProfile(providerId: string): UsageProfile {
  const billing = classifyProvider(providerId);

  switch (billing) {
    case "subscription":
      return {
        billingModel: "subscription",
        maxPowerMode: true,
        showCostWarnings: false,       // Already paid for
        useTaskRouting: false,          // Use the best model always
        thinkingBudget: "maximum",     // Maximize reasoning
        contextStrategy: "aggressive", // Load everything
        cacheStrategy: "always",       // Cache for speed, not cost
        recommendCheaperAlternative: false,
      };

    case "local":
      return {
        billingModel: "local",
        maxPowerMode: true,
        showCostWarnings: false,       // Free
        useTaskRouting: false,          // Only one model anyway
        thinkingBudget: "maximum",     // No cost to think more
        contextStrategy: "dynamic",    // Respect context window limits
        cacheStrategy: "always",
        recommendCheaperAlternative: false,
      };

    case "free":
      return {
        billingModel: "free",
        maxPowerMode: true,
        showCostWarnings: false,       // Free tier
        useTaskRouting: true,          // Route to best free model per task
        thinkingBudget: "adaptive",    // Some free models have limits
        contextStrategy: "dynamic",
        cacheStrategy: "when-beneficial",
        recommendCheaperAlternative: false,
      };

    case "api":
      return {
        billingModel: "api",
        maxPowerMode: true,            // Default is STILL max power
        showCostWarnings: true,        // Show cost before expensive ops
        useTaskRouting: true,          // Route research→Gemini, reasoning→Claude
        thinkingBudget: "adaptive",    // High for planning, moderate for execution
        contextStrategy: "dynamic",    // 46.9% savings from Cursor pattern
        cacheStrategy: "always",       // 75% savings from Anthropic caching
        recommendCheaperAlternative: true, // "This task would cost $X on Gemini vs $Y here"
      };

    default:
      // Unknown provider — default to maximum power
      return {
        billingModel: "unknown",
        maxPowerMode: true,
        showCostWarnings: false,
        useTaskRouting: false,
        thinkingBudget: "maximum",
        contextStrategy: "aggressive",
        cacheStrategy: "always",
        recommendCheaperAlternative: false,
      };
  }
}

/**
 * Get the recommended thinking budget for a task type and billing model.
 */
export function getThinkingBudget(
  taskType: "planning" | "execution" | "verification" | "research",
  profile: UsageProfile,
): "maximum" | "high" | "medium" | "low" {
  if (profile.thinkingBudget === "maximum") return "maximum";
  if (profile.thinkingBudget === "minimal") return "low";

  // Adaptive: varies by task type
  switch (taskType) {
    case "planning": return "maximum";       // Always think deeply when planning
    case "verification": return "high";      // Verify carefully
    case "research": return "high";          // Research thoroughly
    case "execution": return "medium";       // Execute efficiently
  }
}

/**
 * Should we show a cost prediction before this operation?
 */
export function shouldShowCostPrediction(
  estimatedTokens: number,
  profile: UsageProfile,
): boolean {
  if (!profile.showCostWarnings) return false;
  // Show prediction for operations > 10K tokens (roughly $0.01+ on most APIs)
  return estimatedTokens > 10_000;
}
