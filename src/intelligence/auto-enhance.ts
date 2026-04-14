/**
 * Auto-Enhance — detect vague prompts and silently improve them.
 * Shows subtle "Enhanced ✨" indicator. User can tap to see original vs enhanced.
 */

// ── Types ────────────────────────────────────────────────

export interface EnhanceResult {
  readonly original: string;
  readonly enhanced: string;
  readonly wasEnhanced: boolean;
  readonly improvements: readonly string[];
  readonly sensitivity: "off" | "subtle" | "aggressive";
}

export interface AutoEnhanceConfig {
  readonly enabled: boolean;
  readonly sensitivity: "off" | "subtle" | "aggressive";
  readonly minPromptLength: number;
  readonly maxPromptLength: number;  // Don't enhance very long prompts
}

// ── Vagueness Detector ───────────────────────────────────

function isVague(prompt: string, sensitivity: AutoEnhanceConfig["sensitivity"]): { vague: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const words = prompt.trim().split(/\s+/);

  // Too short
  if (words.length <= 3) {
    reasons.push("Very short prompt");
  }

  // No specific nouns (files, functions, etc.)
  if (!/[A-Z][a-z]+|\.ts|\.js|\.py|function |class |const |let |var /.test(prompt)) {
    if (sensitivity === "aggressive") reasons.push("No specific code references");
  }

  // Vague verbs without objects
  if (/^(fix|help|do|make|change)\s+(it|this|that)$/i.test(prompt.trim())) {
    reasons.push("Vague verb without specific object");
  }

  // No context clues
  if (words.length < 8 && !/error|bug|test|file|function|class|api|database|auth/i.test(prompt)) {
    if (sensitivity !== "off") reasons.push("No domain-specific keywords");
  }

  const threshold = sensitivity === "aggressive" ? 1 : sensitivity === "subtle" ? 2 : 999;
  return { vague: reasons.length >= threshold, reasons };
}

// ── Enhancement ──────────────────────────────────────────

function enhance(prompt: string, reasons: readonly string[]): { enhanced: string; improvements: string[] } {
  const improvements: string[] = [];
  let enhanced = prompt;

  // Add specificity request
  if (reasons.includes("Very short prompt") || reasons.includes("Vague verb without specific object")) {
    enhanced = `${prompt}\n\nPlease be thorough and specific. If you need more context about which files or functions to modify, read the relevant code first. Show your reasoning before making changes.`;
    improvements.push("Added specificity request");
  }

  // Add verification request
  if (!prompt.toLowerCase().includes("test") && !prompt.toLowerCase().includes("verify")) {
    enhanced += "\n\nAfter making changes, verify that tests still pass and types check.";
    improvements.push("Added verification step");
  }

  // Add error handling reminder
  if (prompt.toLowerCase().includes("implement") || prompt.toLowerCase().includes("create") || prompt.toLowerCase().includes("build")) {
    enhanced += "\n\nInclude proper error handling and edge case coverage.";
    improvements.push("Added error handling reminder");
  }

  return { enhanced, improvements };
}

// ── Auto-Enhancer ────────────────────────────────────────

export class AutoEnhancer {
  private readonly config: AutoEnhanceConfig;

  constructor(config?: Partial<AutoEnhanceConfig>) {
    this.config = {
      enabled: true,
      sensitivity: "subtle",
      minPromptLength: 5,
      maxPromptLength: 2000,
      ...config,
    };
  }

  /**
   * Analyze a prompt and enhance it if it's vague.
   */
  process(prompt: string): EnhanceResult {
    if (!this.config.enabled || this.config.sensitivity === "off") {
      return { original: prompt, enhanced: prompt, wasEnhanced: false, improvements: [], sensitivity: this.config.sensitivity };
    }

    if (prompt.length < this.config.minPromptLength || prompt.length > this.config.maxPromptLength) {
      return { original: prompt, enhanced: prompt, wasEnhanced: false, improvements: [], sensitivity: this.config.sensitivity };
    }

    const { vague, reasons } = isVague(prompt, this.config.sensitivity);
    if (!vague) {
      return { original: prompt, enhanced: prompt, wasEnhanced: false, improvements: [], sensitivity: this.config.sensitivity };
    }

    const { enhanced, improvements } = enhance(prompt, reasons);
    return {
      original: prompt,
      enhanced,
      wasEnhanced: true,
      improvements,
      sensitivity: this.config.sensitivity,
    };
  }

  /**
   * Update sensitivity level.
   */
  setSensitivity(sensitivity: AutoEnhanceConfig["sensitivity"]): void {
    (this.config as { sensitivity: string }).sensitivity = sensitivity;
  }

  /**
   * Check if auto-enhance is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled && this.config.sensitivity !== "off";
  }
}
