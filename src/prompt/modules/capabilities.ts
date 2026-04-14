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

  // Tier 1: Full native support
  if (provider === "anthropic") {
    native.push("tool calling", "vision", "extended thinking", "computer use");
    if (model.includes("opus")) native.push("1M context window");
  } else if (provider === "openai") {
    native.push("tool calling", "vision", "function calling", "JSON mode");
    if (model.includes("gpt-4") || model.includes("o3")) native.push("128K context");
  } else if (provider === "google") {
    native.push("tool calling", "vision", "grounding", "code execution");
    if (model.includes("gemini")) native.push("1M context window");

  // Tier 2: Partial native + emulation
  } else if (provider === "ollama") {
    native.push("local inference", "privacy");
    if (model.includes("gemma4")) {
      native.push("tool calling", "vision", "128K context");
    } else {
      emulated.push("tool calling (XML extraction)");
    }

  // Tier 3: API-only providers
  } else if (provider === "groq") {
    native.push("fast inference");
    emulated.push("tool calling (XML extraction)");
  } else if (provider === "deepseek") {
    native.push("tool calling", "reasoning");
  } else {
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
