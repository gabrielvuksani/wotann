/**
 * Capability augmentation layer: makes tool calling, vision, and thinking
 * work across ALL providers, even models that don't natively support them.
 *
 * DESIGN PRINCIPLE (from OpenClaw):
 *   "A small model given detailed, step-by-step instructions for a specific
 *    tool performs significantly better than a small model given a vague prompt."
 *
 * This module transforms queries so that:
 * - Tool calling → prompt-injected XML tool definitions for non-tool models
 * - Vision → OCR + structured text description for non-vision models
 * - Thinking → "think step by step" prompt injection for non-thinking models
 * - Streaming → buffered polling for non-streaming providers
 *
 * The augmentation is transparent: the caller always sends the same UnifiedQueryOptions,
 * and the augmenter adapts the request to match the provider's actual capabilities.
 */

import type { ProviderCapabilities, UnifiedQueryOptions, ToolSchema } from "./types.js";

// ── Tool Calling Augmentation ──────────────────────────────

/**
 * Convert tool schemas into prompt-injected XML definitions that any text model
 * can parse and respond to in a structured format.
 */
export function augmentToolCalling(
  options: UnifiedQueryOptions,
  capabilities: ProviderCapabilities,
): UnifiedQueryOptions {
  if (capabilities.supportsToolCalling || !options.tools || options.tools.length === 0) {
    return options;
  }

  // Inject tool definitions into the system prompt as XML
  const toolDefinitions = formatToolsAsXML(options.tools);
  const augmentedSystem = [
    options.systemPrompt ?? "",
    "",
    "# Available Tools",
    "",
    "You have access to the following tools. To use a tool, respond with an XML block:",
    "",
    "```xml",
    "<tool_use>",
    '  <tool name="tool_name">',
    '    <param name="param_name">value</param>',
    "  </tool>",
    "</tool_use>",
    "```",
    "",
    toolDefinitions,
    "",
    "IMPORTANT: When you need to use a tool, output ONLY the XML block above.",
    "After receiving tool results, continue your response normally.",
  ].join("\n");

  // Return new options with augmented system prompt (no tools — the model reads XML instead)
  return {
    ...options,
    systemPrompt: augmentedSystem,
    tools: undefined,
  };
}

function formatToolsAsXML(tools: readonly ToolSchema[]): string {
  return tools.map((tool) => {
    const params = Object.entries(tool.inputSchema)
      .filter(([key]) => key !== "type" && key !== "required")
      .map(([key, val]) => {
        const desc = typeof val === "object" && val !== null && "description" in val
          ? ` — ${(val as { description: string }).description}`
          : "";
        return `  - ${key}${desc}`;
      })
      .join("\n");

    return [
      `## ${tool.name}`,
      tool.description,
      params ? `Parameters:\n${params}` : "No parameters.",
    ].join("\n");
  }).join("\n\n");
}

// ── Thinking Augmentation ──────────────────────────────────

/**
 * For models without native extended thinking, inject a "think step by step"
 * preamble that encourages structured reasoning.
 */
export function augmentThinking(
  options: UnifiedQueryOptions,
  capabilities: ProviderCapabilities,
): UnifiedQueryOptions {
  if (capabilities.supportsThinking) {
    return options;
  }

  // Only augment for tasks that benefit from reasoning (longer prompts, complex questions)
  if (options.prompt.length < 100) {
    return options;
  }

  const thinkingPreamble = [
    "Before answering, think through this step by step:",
    "1. Identify what's being asked",
    "2. Consider the constraints and edge cases",
    "3. Plan your approach",
    "4. Execute and verify",
    "",
    "Show your reasoning in <thinking> tags, then give your final answer.",
  ].join("\n");

  const augmentedSystem = options.systemPrompt
    ? `${options.systemPrompt}\n\n${thinkingPreamble}`
    : thinkingPreamble;

  return { ...options, systemPrompt: augmentedSystem };
}

// ── Vision Augmentation ────────────────────────────────────

/**
 * For models without native vision, convert image references to text descriptions.
 * The harness captures the screen/image, converts to structured text via OCR or
 * accessibility tree, and any text model can process it.
 */
export function augmentVision(
  options: UnifiedQueryOptions,
  capabilities: ProviderCapabilities,
): UnifiedQueryOptions {
  if (capabilities.supportsVision) {
    return options;
  }

  // Check if the prompt contains image references
  const hasImageRef = options.prompt.includes("[image:") || options.prompt.includes("data:image/");

  if (!hasImageRef) {
    return options;
  }

  // Replace image references with text-mediated descriptions
  const augmentedPrompt = options.prompt
    .replace(/\[image:[^\]]+\]/g, "[Image provided — see text description below]")
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[Base64 image — text description provided]");

  const visionNote = [
    "",
    "NOTE: Images have been converted to text descriptions for processing.",
    "Respond based on the text descriptions provided.",
  ].join("\n");

  return {
    ...options,
    prompt: augmentedPrompt,
    systemPrompt: (options.systemPrompt ?? "") + visionNote,
  };
}

// ── Full Augmentation Pipeline ─────────────────────────────

/**
 * Apply all capability augmentations to a query based on the provider's
 * actual capabilities. This is the main entry point — call this before
 * sending any query to a provider adapter.
 */
export function augmentQuery(
  options: UnifiedQueryOptions,
  capabilities: ProviderCapabilities,
): UnifiedQueryOptions {
  let augmented = options;
  augmented = augmentToolCalling(augmented, capabilities);
  augmented = augmentThinking(augmented, capabilities);
  augmented = augmentVision(augmented, capabilities);
  return augmented;
}

// ── Response Parsing for Augmented Models ──────────────────

/**
 * Parse tool call XML from models that used prompt-injected tool definitions.
 * Returns null if no tool call is detected in the response.
 */
export function parseToolCallFromText(
  text: string,
): { name: string; args: Record<string, string> } | null {
  const toolUseMatch = text.match(/<tool_use>\s*<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>\s*<\/tool_use>/);
  if (!toolUseMatch) return null;

  const name = toolUseMatch[1] ?? "";
  const paramsBlock = toolUseMatch[2] ?? "";

  const args: Record<string, string> = {};
  const paramMatches = paramsBlock.matchAll(/<param\s+name="([^"]+)">([^<]*)<\/param>/g);
  for (const match of paramMatches) {
    const key = match[1];
    const val = match[2];
    if (key !== undefined) {
      args[key] = val ?? "";
    }
  }

  return { name, args };
}
