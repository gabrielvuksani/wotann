/**
 * Provider-specific header injection.
 *
 * When extended context is enabled, some providers require beta headers.
 * This module centralizes header management across all providers.
 */

import { isExtendedContextEnabled, type ContextActivationMode } from "../context/limits.js";

export interface ProviderHeaders {
  readonly headers: Record<string, string>;
  readonly queryParams?: Record<string, string>;
}

/**
 * Get provider-specific headers for API calls.
 * Injects beta headers, extended context flags, etc.
 */
export function getProviderHeaders(
  provider: string,
  model: string,
  options?: { enableExtendedContext?: boolean },
): ProviderHeaders {
  const extendedContext = options?.enableExtendedContext ?? isExtendedContextEnabled(provider, model);

  switch (provider) {
    case "anthropic":
      return getAnthropicHeaders(model, extendedContext);
    case "openai":
      return getOpenAIHeaders(model, extendedContext);
    case "gemini":
      return getGeminiHeaders(model);
    default:
      return { headers: {} };
  }
}

function getAnthropicHeaders(model: string, extendedContext: boolean): ProviderHeaders {
  const headers: Record<string, string> = {
    "anthropic-version": "2024-10-22",
  };

  // Extended context beta header for Opus 4.6 and Sonnet 4.6
  if (extendedContext && (model.includes("opus") || model.includes("sonnet"))) {
    headers["anthropic-beta"] = "extended-context-2025-04-01";
  }

  // Extended thinking is always enabled for capable models
  if (model.includes("opus") || model.includes("sonnet")) {
    const existingBeta = headers["anthropic-beta"] ?? "";
    const thinkingBeta = "extended-thinking-2025-01-24";
    headers["anthropic-beta"] = existingBeta
      ? `${existingBeta},${thinkingBeta}`
      : thinkingBeta;
  }

  // Prompt caching beta
  if (model.includes("opus") || model.includes("sonnet") || model.includes("haiku")) {
    const existingBeta = headers["anthropic-beta"] ?? "";
    const cachingBeta = "prompt-caching-2024-07-31";
    headers["anthropic-beta"] = existingBeta
      ? `${existingBeta},${cachingBeta}`
      : cachingBeta;
  }

  return { headers };
}

function getOpenAIHeaders(model: string, extendedContext: boolean): ProviderHeaders {
  const headers: Record<string, string> = {};

  // OpenAI doesn't need beta headers for GPT-5.4 1M context — it's default
  // But structured output needs a specific header for some endpoints
  if (model.includes("gpt-5")) {
    headers["OpenAI-Beta"] = "assistants=v2";
  }

  return { headers };
}

function getGeminiHeaders(model: string): ProviderHeaders {
  // Google Gemini uses API version in the URL, not headers
  return {
    headers: {},
    queryParams: {
      "model": model,
    },
  };
}

/**
 * Build the full API URL with any provider-specific modifications.
 */
export function buildProviderUrl(
  baseUrl: string,
  provider: string,
  model: string,
): string {
  switch (provider) {
    case "anthropic":
      return `${baseUrl}/v1/messages`;
    case "openai":
      return `${baseUrl}/v1/chat/completions`;
    case "gemini":
      return `${baseUrl}/v1beta/models/${model}:generateContent`;
    default:
      return baseUrl;
  }
}
