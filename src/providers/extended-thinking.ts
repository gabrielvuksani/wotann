/**
 * Provider-Agnostic Extended Thinking — works across all providers.
 *
 * Normalizes thinking/reasoning across:
 * - Claude: native thinking blocks with budget_tokens
 * - OpenAI: o-series reasoning with reasoning_effort
 * - Gemini: thinking_config with thinking_budget
 * - Ollama: /think tags in stream
 * - Others: chain-of-thought prompting (software emulation)
 *
 * Single API: requestThinking(prompt, config) → { thinking, response }
 * The harness handles the provider-specific details.
 */

import type { ProviderName } from "../core/types.js";

export interface ThinkingConfig {
  /** Maximum tokens for thinking (maps to provider-specific params) */
  readonly budgetTokens: number;
  /** Whether to show thinking to the user */
  readonly showThinking: boolean;
  /** Effort level (maps to OpenAI reasoning_effort) */
  readonly effort: "low" | "medium" | "high";
  /** Force thinking even if the provider doesn't natively support it */
  readonly forceThinking: boolean;
}

export interface ThinkingResult {
  readonly thinking: string;
  readonly response: string;
  readonly provider: string;
  readonly model: string;
  readonly thinkingTokens: number;
  readonly responseTokens: number;
  readonly method: ThinkingMethod;
}

export type ThinkingMethod =
  | "native_thinking_blocks" // Claude thinking blocks
  | "native_reasoning" // OpenAI o-series
  | "native_thinking_config" // Gemini thinking_config
  | "stream_think_tags" // Ollama /think tags
  | "chain_of_thought" // Software emulation
  | "none"; // No thinking

const DEFAULT_THINKING_CONFIG: ThinkingConfig = {
  budgetTokens: 16_000,
  showThinking: false,
  effort: "high",
  forceThinking: false,
};

/**
 * Determine the best thinking method for a provider/model combination.
 *
 * Bug 6 (extended-thinking 4 providers): the prior switch hard-coded
 * 4 ProviderName variants (anthropic/openai/gemini/ollama) and silently
 * collapsed the remaining 4 first-class providers (codex, copilot,
 * openrouter, huggingface — see types.ts:27-35) to `chain_of_thought`,
 * losing native reasoning hooks even when the underlying model
 * supports them. The fix routes:
 *   - codex   -> openai-style native_reasoning (Codex slugs are gpt-5.x)
 *   - copilot -> introspect proxied model: anthropic/* gets native_thinking_blocks,
 *                openai-shaped (gpt-5/o3) gets native_reasoning, "copilot-default"
 *                stays chain_of_thought (test pin: tests/unit/extended-thinking.test.ts:29)
 *   - openrouter -> extract underlying provider from `<vendor>/<model>` slug
 *                  and dispatch to that vendor's native method
 *   - huggingface -> chain_of_thought (most HF community models lack native
 *                    thinking; documented gap, not silent loss)
 */
export function getThinkingMethod(provider: ProviderName, model: string): ThinkingMethod {
  switch (provider) {
    case "anthropic":
      return "native_thinking_blocks";
    case "openai":
      if (
        model.includes("o1") ||
        model.includes("o3") ||
        model.includes("o4") ||
        model.startsWith("gpt-5")
      ) {
        return "native_reasoning";
      }
      return "chain_of_thought";
    case "gemini":
      if (model.includes("2.5") || model.includes("3.")) {
        return "native_thinking_config";
      }
      return "chain_of_thought";
    case "ollama":
      return "stream_think_tags";
    case "codex":
      // Bug 6: Codex transports gpt-5.x family (codexplan / codexspark
      // wrap gpt-5.4 / gpt-5.3). Use OpenAI-style reasoning_effort.
      return "native_reasoning";
    case "copilot": {
      // Bug 6: Copilot proxies BOTH Anthropic Claude AND OpenAI models
      // under the GitHub Copilot subscription. The proxied model id
      // determines which native reasoning hook the underlying API
      // accepts. Order matters: check Claude before generic gpt-5
      // because Copilot exposes "claude-sonnet-4-copilot" aliases that
      // include both substrings.
      const lower = model.toLowerCase();
      if (lower.includes("claude")) return "native_thinking_blocks";
      if (
        lower.includes("o1") ||
        lower.includes("o3") ||
        lower.includes("o4") ||
        lower.startsWith("gpt-5")
      ) {
        return "native_reasoning";
      }
      return "chain_of_thought";
    }
    case "openrouter": {
      // Bug 6: OpenRouter slugs are <vendor>/<model>. Dispatch the
      // underlying provider's native reasoning method so users on
      // OpenRouter don't lose extended thinking on their Pro models.
      const lower = model.toLowerCase();
      if (lower.startsWith("anthropic/")) return "native_thinking_blocks";
      if (lower.startsWith("openai/")) {
        if (
          lower.includes("o1") ||
          lower.includes("o3") ||
          lower.includes("o4") ||
          lower.includes("gpt-5")
        ) {
          return "native_reasoning";
        }
        return "chain_of_thought";
      }
      if (lower.startsWith("google/") || lower.startsWith("gemini/")) {
        if (lower.includes("2.5") || lower.includes("3.")) {
          return "native_thinking_config";
        }
        return "chain_of_thought";
      }
      if (lower.startsWith("deepseek/") && lower.includes("r1")) {
        // DeepSeek R1 emits <think> tags inline like Ollama/qwen.
        return "stream_think_tags";
      }
      // Free-tier llama, mistral, qwen, x-ai/grok via OpenRouter — no
      // standardised native reasoning hook. Fall back to CoT prompt.
      return "chain_of_thought";
    }
    case "huggingface":
      // Bug 6: HF community models seldom expose a standardised native
      // reasoning surface. CoT is the honest fallback (vs pretending we
      // have native via a fake stub). Document the gap so callers know
      // this is intentional, not silent loss.
      return "chain_of_thought";
    default:
      return "chain_of_thought";
  }
}

/**
 * Build provider-specific API parameters for thinking.
 */
export function buildThinkingParams(
  provider: ProviderName,
  model: string,
  config: Partial<ThinkingConfig> = {},
): Record<string, unknown> {
  const cfg = { ...DEFAULT_THINKING_CONFIG, ...config };
  const method = getThinkingMethod(provider, model);

  switch (method) {
    case "native_thinking_blocks":
      return {
        thinking: {
          type: "enabled",
          budget_tokens: cfg.budgetTokens,
        },
      };

    case "native_reasoning":
      return {
        reasoning_effort: cfg.effort,
        max_completion_tokens: cfg.budgetTokens,
      };

    case "native_thinking_config":
      return {
        thinking_config: {
          thinking_budget: cfg.budgetTokens,
        },
      };

    case "stream_think_tags":
      // Ollama uses /think tags naturally — just set temperature
      return {
        options: {
          temperature: 0.3, // Lower temperature for more focused reasoning
        },
      };

    case "chain_of_thought":
      // No special params — handled via prompt engineering
      return {};

    default:
      return {};
  }
}

/**
 * Build a chain-of-thought prompt wrapper for providers without native thinking.
 */
export function buildChainOfThoughtPrompt(originalPrompt: string): string {
  return [
    "<thinking>",
    "Think step by step about this problem before answering.",
    "Consider edge cases and potential issues.",
    "Then provide your answer after </thinking>.",
    "</thinking>",
    "",
    originalPrompt,
  ].join("\n");
}

/**
 * Extract thinking content from different provider response formats.
 */
export function extractThinking(
  response: string | Record<string, unknown>,
  method: ThinkingMethod,
): { thinking: string; response: string } {
  if (typeof response === "string") {
    return extractFromText(response, method);
  }

  // Structured response (API response object)
  switch (method) {
    case "native_thinking_blocks": {
      const content = response["content"] as readonly Record<string, unknown>[] | undefined;
      if (Array.isArray(content)) {
        const thinkingBlocks = content.filter((b) => b["type"] === "thinking");
        const textBlocks = content.filter((b) => b["type"] === "text");
        return {
          thinking: thinkingBlocks.map((b) => (b["thinking"] as string) ?? "").join("\n"),
          response: textBlocks.map((b) => (b["text"] as string) ?? "").join("\n"),
        };
      }
      return { thinking: "", response: String(response["content"] ?? "") };
    }

    case "native_reasoning": {
      const reasoning = response["reasoning"] as string | undefined;
      const output = response["output"] as string | undefined;
      return {
        thinking: reasoning ?? "",
        response: output ?? String(response["content"] ?? ""),
      };
    }

    default:
      return { thinking: "", response: JSON.stringify(response) };
  }
}

function extractFromText(
  text: string,
  method: ThinkingMethod,
): { thinking: string; response: string } {
  switch (method) {
    case "stream_think_tags": {
      // Ollama: <think>...</think> tags
      const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        return {
          thinking: thinkMatch[1]?.trim() ?? "",
          response: text.replace(/<think>[\s\S]*?<\/think>/, "").trim(),
        };
      }
      return { thinking: "", response: text };
    }

    case "chain_of_thought": {
      // Extract from <thinking>...</thinking> wrapper
      const cotMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
      if (cotMatch) {
        return {
          thinking: cotMatch[1]?.trim() ?? "",
          response: text.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim(),
        };
      }
      return { thinking: "", response: text };
    }

    default:
      return { thinking: "", response: text };
  }
}
