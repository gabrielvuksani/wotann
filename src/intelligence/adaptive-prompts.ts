/**
 * Adaptive System Prompt Generator — dynamically adjusts prompt complexity
 * based on model capability tier.
 *
 * Weaker models get simpler, more directive prompts with scaffolding.
 * Stronger models get nuanced, flexible prompts with minimal guardrails.
 * This ensures WOTANN amplifies every model to its maximum potential.
 */

// -- Types -------------------------------------------------------------------

export type ModelTier = "frontier" | "strong" | "standard" | "lightweight" | "local";

export interface PromptProfile {
  readonly tier: ModelTier;
  readonly maxSystemPromptTokens: number;
  readonly useStructuredReasoning: boolean;
  readonly useChainOfThought: boolean;
  readonly toolCallStyle: "native" | "xml" | "json";
  readonly instructionStyle: "minimal" | "detailed" | "verbose";
  readonly includeExamples: boolean;
  readonly verificationLevel: "none" | "self-check" | "multi-step";
}

// -- Classification rules ----------------------------------------------------

interface ClassificationRule {
  readonly tier: ModelTier;
  readonly patterns: readonly RegExp[];
}

/**
 * Classification rules ordered from most-specific to least-specific.
 * Lightweight/local patterns must precede strong/standard to prevent
 * partial matches (e.g., "gpt-4o-mini" hitting "gpt-4" before "mini",
 * or "gemini-2.0-flash" hitting "mini" in "gemini").
 */
const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    tier: "frontier",
    patterns: [/opus/i, /gpt-5/i, /gemini-ultra/i, /gemini-3-pro/i],
  },
  {
    tier: "lightweight",
    patterns: [/\bmini\b/i, /\bphi\b/i, /gemma-2b/i, /tinyllama/i],
  },
  {
    tier: "local",
    patterns: [/ollama/i, /gguf/i, /\bllama\b/i, /\bqwen/i, /codestral/i],
  },
  {
    tier: "standard",
    patterns: [/haiku/i, /gpt-3\.5/i, /gemini-flash/i, /mistral-large/i],
  },
  {
    tier: "strong",
    patterns: [/sonnet/i, /gpt-4/i, /gemini-pro/i, /claude-3/i],
  },
];

// -- Tier profiles -----------------------------------------------------------

const TIER_PROFILES: ReadonlyMap<ModelTier, PromptProfile> = new Map([
  [
    "frontier",
    {
      tier: "frontier",
      maxSystemPromptTokens: 16_000,
      useStructuredReasoning: false,
      useChainOfThought: false,
      toolCallStyle: "native",
      instructionStyle: "minimal",
      includeExamples: false,
      verificationLevel: "none",
    },
  ],
  [
    "strong",
    {
      tier: "strong",
      maxSystemPromptTokens: 12_000,
      useStructuredReasoning: false,
      useChainOfThought: true,
      toolCallStyle: "native",
      instructionStyle: "minimal",
      includeExamples: false,
      verificationLevel: "self-check",
    },
  ],
  [
    "standard",
    {
      tier: "standard",
      maxSystemPromptTokens: 8_000,
      useStructuredReasoning: true,
      useChainOfThought: true,
      toolCallStyle: "xml",
      instructionStyle: "detailed",
      includeExamples: true,
      verificationLevel: "self-check",
    },
  ],
  [
    "lightweight",
    {
      tier: "lightweight",
      maxSystemPromptTokens: 4_000,
      useStructuredReasoning: true,
      useChainOfThought: true,
      toolCallStyle: "json",
      instructionStyle: "verbose",
      includeExamples: true,
      verificationLevel: "multi-step",
    },
  ],
  [
    "local",
    {
      tier: "local",
      maxSystemPromptTokens: 4_000,
      useStructuredReasoning: true,
      useChainOfThought: true,
      toolCallStyle: "json",
      instructionStyle: "verbose",
      includeExamples: true,
      verificationLevel: "multi-step",
    },
  ],
]);

// -- Scaffolding templates ---------------------------------------------------

const REASONING_SCAFFOLD = [
  "Think step by step before responding:",
  "1. Understand what is being asked",
  "2. Identify the relevant information",
  "3. Plan your approach",
  "4. Execute the plan",
  "5. Verify the result",
].join("\n");

const TOOL_CALL_INSTRUCTIONS: ReadonlyMap<"native" | "xml" | "json", string> = new Map([
  ["native", ""],
  [
    "xml",
    [
      "To call a tool, use this exact format:",
      "<tool_call>",
      "  <name>tool_name</name>",
      "  <args>",
      '    <param_name>value</param_name>',
      "  </args>",
      "</tool_call>",
    ].join("\n"),
  ],
  [
    "json",
    [
      "To call a tool, respond with this exact JSON format:",
      '{"tool": "tool_name", "args": {"param_name": "value"}}',
      "Only output the JSON. No extra text before or after.",
    ].join("\n"),
  ],
]);

const VERIFICATION_TEMPLATES: ReadonlyMap<"none" | "self-check" | "multi-step", string> = new Map([
  ["none", ""],
  ["self-check", "After responding, briefly verify your answer is correct."],
  [
    "multi-step",
    [
      "After completing each step:",
      "1. Check: did I follow the instruction correctly?",
      "2. Check: is the output in the required format?",
      "3. Check: did I miss anything?",
      "If any check fails, redo that step before continuing.",
    ].join("\n"),
  ],
]);

// -- Implementation ----------------------------------------------------------

export class AdaptivePromptGenerator {
  /**
   * Classify a model into a capability tier based on its model ID string.
   * Scans classification rules in priority order (frontier first).
   */
  classifyModel(modelId: string): ModelTier {
    const normalized = modelId.toLowerCase();

    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(normalized)) {
          return rule.tier;
        }
      }
    }

    // Unknown models default to "standard" — safe middle ground
    return "standard";
  }

  /**
   * Get the full prompt profile for a given tier.
   */
  getProfile(tier: ModelTier): PromptProfile {
    return TIER_PROFILES.get(tier) ?? TIER_PROFILES.get("standard")!;
  }

  /**
   * Generate an adaptive system prompt section tailored to the model's
   * capabilities. Adds scaffolding for weaker models, strips it for
   * frontier models.
   */
  generateAdaptiveSection(modelId: string, basePrompt: string): string {
    const tier = this.classifyModel(modelId);
    const profile = this.getProfile(tier);
    const sections: string[] = [];

    // Frontier models: trust their judgment, minimal additions
    if (tier === "frontier") {
      sections.push(basePrompt);
      return sections.join("\n\n");
    }

    // Strong models: full prompt + light chain-of-thought
    if (tier === "strong") {
      sections.push(basePrompt);
      if (profile.verificationLevel !== "none") {
        sections.push(VERIFICATION_TEMPLATES.get(profile.verificationLevel) ?? "");
      }
      return sections.filter(Boolean).join("\n\n");
    }

    // Standard/lightweight/local: add progressively more scaffolding
    if (profile.useStructuredReasoning) {
      sections.push(REASONING_SCAFFOLD);
    }

    // Truncate base prompt for token-constrained models
    const truncatedPrompt = truncateToTokenBudget(
      basePrompt,
      profile.maxSystemPromptTokens,
    );
    sections.push(truncatedPrompt);

    // Add explicit tool call format instructions
    const toolInstructions = TOOL_CALL_INSTRUCTIONS.get(profile.toolCallStyle) ?? "";
    if (toolInstructions) {
      sections.push(toolInstructions);
    }

    // Add verification instructions
    const verificationInstructions =
      VERIFICATION_TEMPLATES.get(profile.verificationLevel) ?? "";
    if (verificationInstructions) {
      sections.push(verificationInstructions);
    }

    return sections.filter(Boolean).join("\n\n");
  }

  /**
   * Wrap a single instruction with appropriate scaffolding for the model tier.
   * Weaker models get reasoning steps prepended; frontier models get the
   * instruction as-is.
   */
  wrapInstruction(instruction: string, tier: ModelTier): string {
    const profile = this.getProfile(tier);

    if (tier === "frontier") {
      return instruction;
    }

    if (tier === "strong") {
      return profile.useChainOfThought
        ? `Think through this step by step, then:\n${instruction}`
        : instruction;
    }

    // standard, lightweight, local — full scaffolding
    const parts: string[] = [];

    if (profile.useStructuredReasoning) {
      parts.push("Follow these steps carefully:");
      parts.push(`Step 1: Read the instruction below completely.`);
      parts.push(`Step 2: Plan your response before writing.`);
      parts.push(`Step 3: Execute the instruction.`);

      if (profile.verificationLevel === "multi-step") {
        parts.push(`Step 4: Verify your response matches the instruction.`);
      }

      parts.push("");
      parts.push(`Instruction: ${instruction}`);
    } else {
      parts.push(instruction);
    }

    return parts.join("\n");
  }
}

// -- Helpers -----------------------------------------------------------------

/**
 * Rough truncation to stay within a token budget.
 * Uses the ~4 chars/token approximation for English text.
 */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const approxCharsPerToken = 4;
  const maxChars = maxTokens * approxCharsPerToken;

  if (text.length <= maxChars) {
    return text;
  }

  // Truncate at the last complete line within budget
  const truncated = text.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf("\n");

  if (lastNewline > maxChars * 0.8) {
    return truncated.slice(0, lastNewline) + "\n\n[...truncated for model context limit]";
  }

  return truncated + "\n\n[...truncated for model context limit]";
}
