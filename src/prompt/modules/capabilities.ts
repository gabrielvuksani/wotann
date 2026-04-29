/**
 * Capabilities prompt module — what this model can do natively vs emulated.
 * WOTANN's key differentiator: every feature works with every provider through emulation.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

interface ProviderProfile {
  readonly native: readonly string[];
  readonly emulated: readonly string[];
}

function getProviderProfile(provider: string, model: string): ProviderProfile {
  const native: string[] = ["text generation", "code editing", "reasoning"];
  const emulated: string[] = [];

  // Normalise the provider string so "google" and "gemini" map to the same
  // profile — the adapter is called `gemini` internally but the README
  // refers to Google; both names must produce the same capability prompt.
  const p = provider === "google" ? "gemini" : provider;

  // Tier 1: Full native support
  if (p === "anthropic" || p === "anthropic-cli") {
    native.push("tool calling", "vision", "extended thinking", "computer use");
    if (model.includes("opus")) native.push("1M context window");
    if (model.includes("sonnet")) native.push("200K context window");
  } else if (p === "openai") {
    native.push("tool calling", "vision", "function calling", "JSON mode");
    if (model.includes("gpt-5")) native.push("parallel tool calls", "256K context");
    else if (model.includes("gpt-4") || model.includes("o3")) native.push("128K context");
  } else if (p === "gemini" || p === "vertex") {
    native.push(
      "tool calling",
      "vision",
      "google_search grounding (FREE)",
      "code_execution sandbox (FREE)",
      "url_context (FREE)",
    );
    if (model.includes("gemini-3")) native.push("1M context window", "native video understanding");
    else if (model.includes("gemini-2")) native.push("1M context window");

    // Tier 2: Partial native + emulation
  } else if (p === "ollama") {
    native.push("local inference", "privacy", "offline");
    if (model.includes("gemma4")) {
      native.push("tool calling", "vision", "audio", "128K context");
    } else {
      emulated.push("tool calling (XML extraction)");
    }

    // Tier 3: API-only providers with tool support
  } else if (p === "copilot") {
    native.push("tool calling", "vision");
    if (model.includes("gpt-5") || model.includes("sonnet")) native.push("128K context");
  } else if (p === "codex") {
    native.push("tool calling", "reasoning");
    if (model.includes("codexplan")) native.push("extended thinking (high effort)");
  } else if (p === "deepseek") {
    native.push("tool calling", "reasoning");
    if (model.includes("r1")) native.push("extended thinking");
  } else if (p === "xai") {
    native.push("tool calling", "vision", "real-time web");
    if (model.includes("grok-4")) native.push("128K context");
  } else if (p === "mistral") {
    native.push("tool calling", "multilingual");
    if (model.includes("large")) native.push("128K context");
    if (model.includes("codestral")) native.push("code specialist");
  } else if (p === "free" || p === "groq") {
    native.push("fast inference (300+ tok/s)");
    emulated.push("tool calling (XML extraction)");
  } else if (p === "together" || p === "fireworks" || p === "perplexity") {
    native.push("tool calling");
  } else if (p === "huggingface") {
    native.push("open-model access");
    emulated.push("tool calling (XML extraction)");
  } else if (p === "openrouter") {
    // Bug 4 (capabilities openrouter): ProviderName "openrouter" (types.ts:33)
    // is one of the 8 first-class providers but had no capabilities branch.
    // OpenRouter is a meta-router — its capability profile is dynamic by
    // slug (anthropic/* gets Anthropic native, openai/* gets OpenAI native,
    // free-tier llama-* often gets emulated tool calling). Default to
    // optimistic: native function calling + vision on the high-end slugs,
    // because OpenRouter's most-trafficked routes (anthropic/, openai/,
    // google/) all support both natively. The model-router will gate
    // vision-aware queries to the vision branch above so this never
    // promises a capability the underlying model can't deliver.
    native.push("tool calling", "vision", "extended thinking");
    if (model.startsWith("anthropic/")) native.push("computer use", "200K-1M context window");
    else if (model.startsWith("openai/")) native.push("parallel tool calls", "JSON mode");
    else if (model.startsWith("google/") || model.startsWith("gemini/")) {
      native.push("1M context window", "google_search grounding");
    } else if (model.includes(":free") || model.startsWith("meta-llama/")) {
      // Free-tier routes are usually small llama; tool-call quality varies.
      emulated.push("tool calling (XML extraction fallback)");
    }
  } else if (p === "azure" || p === "bedrock") {
    // Hosted versions of upstream models — capability depends on the model.
    native.push("tool calling", "vision");
  } else if (p === "sambanova") {
    native.push("fast inference");
    emulated.push("tool calling (XML extraction)");
  } else {
    // Unknown provider — fall back to emulated XML tool calling so the
    // agent doesn't lose tool capability entirely. Bug 4 follow-up: this
    // path also catches future ProviderName additions whose capability
    // profile hasn't been written yet (and any auth that landed at runtime
    // before the prompt-side branch was added). Honest stub > silent
    // success: callers see emulated rather than thinking they have native.
    emulated.push("tool calling (XML extraction)", "vision (text description fallback)");
  }

  return { native, emulated };
}

export const capabilitiesPromptModule: PromptModuleEntry = {
  name: "capabilities",
  priority: 95,
  build(ctx: PromptContext): readonly string[] {
    const profile = getProviderProfile(ctx.provider, ctx.model);
    const lines: string[] = [];

    lines.push(`Native: ${profile.native.join(", ")}.`);
    if (profile.emulated.length > 0) {
      lines.push(`Emulated by harness: ${profile.emulated.join(", ")}.`);
    }

    // Context window awareness
    lines.push(
      `Context window: ${(ctx.contextWindow / 1000).toFixed(0)}K tokens.`,
      "WOTANN amplifies your capabilities through middleware, skills, and memory. Use them.",
    );

    return lines;
  },
};
