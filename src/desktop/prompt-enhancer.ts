/**
 * Prompt Enhancer — supercharge user prompts using the most capable model.
 *
 * This is a WOTANN-exclusive feature: a button/command that takes whatever
 * the user has typed and enhances it for clarity, specificity, and effectiveness.
 *
 * Enhancement strategies:
 * 1. concise  — Make shorter and more direct
 * 2. detailed — Add specificity and context  (default)
 * 3. technical — Add technical precision
 * 4. creative — Make more creative/exploratory
 * 5. structured — Add structure (steps, acceptance criteria)
 *
 * USAGE:
 *   /enhance                  — Enhance current prompt (detailed style)
 *   /enhance --style concise  — Enhance with specific style
 *   /enhance <text>           — Enhance provided text
 *
 * In the Desktop app, this appears as a ✨ button next to the send button.
 * In the TUI, it's the /enhance slash command.
 */

import type { EnhancementStyle, PromptEnhancerResult } from "./types.js";

// ── Types ───────────────────────────────────────────────

export interface EnhancerConfig {
  readonly style: EnhancementStyle;
  readonly maxOutputTokens: number;
  readonly includeImprovements: boolean;
}

export type QueryExecutor = (
  prompt: string,
  systemPrompt: string,
) => Promise<{ response: string; model: string; provider: string; tokensUsed: number; durationMs: number }>;

// ── Enhancement System Prompts ──────────────────────────

const STYLE_PROMPTS: Record<EnhancementStyle, string> = {
  concise: [
    "You are a prompt optimization expert. Your task is to make the given prompt more concise and direct.",
    "Rules:",
    "- Remove filler words and redundant context",
    "- Keep the core intent intact",
    "- Make it actionable and specific",
    "- Output ONLY the enhanced prompt, nothing else",
  ].join("\n"),

  detailed: [
    "You are a prompt optimization expert. Your task is to enhance the given prompt with more specificity and context.",
    "Rules:",
    "- Add specific details that clarify intent",
    "- Include relevant constraints or acceptance criteria",
    "- Mention edge cases the user might want handled",
    "- Keep the enhancement natural — don't over-engineer",
    "- Output ONLY the enhanced prompt, nothing else",
  ].join("\n"),

  technical: [
    "You are a technical prompt optimization expert. Your task is to add technical precision to the given prompt.",
    "Rules:",
    "- Add specific technology names, versions, patterns",
    "- Include performance/security/type-safety considerations",
    "- Reference best practices and design patterns",
    "- Be specific about error handling and edge cases",
    "- Output ONLY the enhanced prompt, nothing else",
  ].join("\n"),

  creative: [
    "You are a creative prompt optimization expert. Your task is to make the prompt more exploratory and creative.",
    "Rules:",
    "- Suggest novel approaches the user might not have considered",
    "- Add 'what if' angles that expand the solution space",
    "- Encourage innovative solutions while keeping practicality",
    "- Output ONLY the enhanced prompt, nothing else",
  ].join("\n"),

  structured: [
    "You are a structured prompt optimization expert. Your task is to add clear structure to the given prompt.",
    "Rules:",
    "- Break the task into numbered steps",
    "- Add acceptance criteria for each step",
    "- Define input/output expectations",
    "- Include verification steps",
    "- Output ONLY the enhanced prompt, nothing else",
  ].join("\n"),
};

const DEFAULT_CONFIG: EnhancerConfig = {
  style: "detailed",
  maxOutputTokens: 2000,
  includeImprovements: true,
};

// ── Prompt Enhancer ─────────────────────────────────────

export class PromptEnhancer {
  private readonly config: EnhancerConfig;

  constructor(config?: Partial<EnhancerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Enhance a prompt using the provided query executor.
   * The executor should route to the most capable available model.
   */
  async enhance(
    originalPrompt: string,
    executor: QueryExecutor,
    style?: EnhancementStyle,
  ): Promise<PromptEnhancerResult> {
    const effectiveStyle = style ?? this.config.style;
    const systemPrompt = STYLE_PROMPTS[effectiveStyle];

    const enhanceRequest = [
      "Enhance this prompt:\n",
      "---",
      originalPrompt,
      "---",
      "",
      "Output the enhanced version only. Do not add explanations or meta-commentary.",
    ].join("\n");

    const startTime = Date.now();
    const result = await executor(enhanceRequest, systemPrompt);
    const durationMs = Date.now() - startTime;

    const improvements = this.config.includeImprovements
      ? this.detectImprovements(originalPrompt, result.response)
      : [];

    return {
      originalPrompt,
      enhancedPrompt: result.response.trim(),
      model: result.model,
      provider: result.provider,
      style: effectiveStyle,
      tokensUsed: result.tokensUsed,
      durationMs,
      improvements,
    };
  }

  /**
   * Quick enhance — minimal processing, just add specificity.
   * Used for the ✨ button in the desktop app.
   */
  async quickEnhance(
    originalPrompt: string,
    executor: QueryExecutor,
  ): Promise<PromptEnhancerResult> {
    return this.enhance(originalPrompt, executor, "detailed");
  }

  /**
   * Detect what improvements were made between original and enhanced.
   */
  private detectImprovements(original: string, enhanced: string): readonly string[] {
    const improvements: string[] = [];

    const origWords = original.split(/\s+/).length;
    const enhWords = enhanced.split(/\s+/).length;

    if (enhWords > origWords * 1.3) {
      improvements.push("Added specificity and detail");
    }
    if (enhWords < origWords * 0.8) {
      improvements.push("Made more concise");
    }

    if (enhanced.includes("1.") || enhanced.includes("- ")) {
      if (!original.includes("1.") && !original.includes("- ")) {
        improvements.push("Added structure");
      }
    }

    if (/error|edge case|handle|fallback|validate/i.test(enhanced) &&
      !/error|edge case|handle|fallback|validate/i.test(original)) {
      improvements.push("Added error handling considerations");
    }

    if (/test|verify|assert|expect/i.test(enhanced) &&
      !/test|verify|assert|expect/i.test(original)) {
      improvements.push("Added verification criteria");
    }

    if (/typescript|react|node|api|sql|css/i.test(enhanced) &&
      !/typescript|react|node|api|sql|css/i.test(original)) {
      improvements.push("Added technology specifics");
    }

    if (/performance|security|accessibility|scalab/i.test(enhanced) &&
      !/performance|security|accessibility|scalab/i.test(original)) {
      improvements.push("Added quality considerations");
    }

    if (improvements.length === 0) {
      improvements.push("Refined wording and clarity");
    }

    return improvements;
  }
}

/**
 * Get the enhancement system prompt for a given style.
 * Exported for testing and external use.
 */
export function getStylePrompt(style: EnhancementStyle): string {
  return STYLE_PROMPTS[style];
}

/**
 * List all available enhancement styles with descriptions.
 */
export function listEnhancementStyles(): readonly { style: EnhancementStyle; description: string }[] {
  return [
    { style: "concise", description: "Make shorter and more direct" },
    { style: "detailed", description: "Add specificity and context" },
    { style: "technical", description: "Add technical precision" },
    { style: "creative", description: "Make more creative/exploratory" },
    { style: "structured", description: "Add structure (steps, criteria)" },
  ];
}
