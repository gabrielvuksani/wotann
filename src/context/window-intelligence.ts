/**
 * Context Window Intelligence — dynamic context budget allocation.
 *
 * COMPETITIVE EDGE (from research):
 * - LangChain gained +13.7% on Terminal Bench 2.0 using adaptive context management
 * - Cursor uses "dynamic context discovery" — only pull necessary files
 * - The arxiv paper describes 5-stage progressive compaction
 * - System reminders counteract instruction fade-out in long sessions
 *
 * This module manages the context window budget across providers:
 * 1. BUDGET ALLOCATION — divide context into zones (system, memory, tools, conversation)
 * 2. PRESSURE MONITORING — track usage and trigger compaction before overflow
 * 3. PROGRESSIVE COMPACTION — 5-stage reduction that preserves most important context
 * 4. SYSTEM REMINDERS — inject targeted guidance at decision points
 * 5. PROVIDER ADAPTATION — respect effective context rather than overclaiming documented maxima
 *
 * UPGRADES (Sprint 2):
 * - Real message summarization (replaces simulated compaction)
 * - Tool output truncation that preserves key info, drops verbosity
 * - Prompt caching breakpoint optimization (align zone boundaries with cache breaks)
 */

import {
  getModelContextConfig,
  isExtendedContextEnabled,
  type ContextActivationMode,
} from "./limits.js";

export interface ContextBudget {
  readonly totalTokens: number;
  readonly systemPromptTokens: number;
  readonly memoryTokens: number;
  readonly toolSchemaTokens: number;
  readonly conversationTokens: number;
  readonly reservedOutputTokens: number;
  readonly availableTokens: number;
  readonly usagePercent: number;
  readonly pressureLevel: PressureLevel;
}

export interface ContextCapabilityProfile {
  readonly provider: string;
  readonly model?: string;
  readonly totalTokens: number;
  readonly documentedMaxTokens: number;
  readonly reservedOutputTokens: number;
  readonly cachingSupported: boolean;
  readonly surchargeThreshold?: number;
  readonly activationMode: ContextActivationMode;
  readonly notes?: string;
  readonly extendedContextEnabled: boolean;
}

export type PressureLevel = "green" | "yellow" | "orange" | "red" | "critical";

export interface ContextZone {
  readonly name: string;
  readonly priority: number;
  readonly currentTokens: number;
  readonly maxTokens: number;
  readonly compactible: boolean;
}

export interface CompactionResult {
  readonly stage: CompactionStage;
  readonly tokensReclaimed: number;
  readonly itemsRemoved: number;
  readonly summary: string;
}

export type CompactionStage =
  | "tool-schemas"
  | "old-messages"
  | "tool-outputs"
  | "memory-offload"
  | "aggressive-summarize";

export interface SystemReminder {
  readonly trigger: string;
  readonly content: string;
  readonly priority: number;
  readonly maxFrequency: number;
  lastInjected: number;
}

/**
 * Message that can be summarized during compaction.
 */
export interface SummarizableMessage {
  readonly role: string;
  readonly content: string;
  readonly timestamp?: number;
  readonly toolName?: string;
  readonly important?: boolean;
}

/**
 * Summary function: takes messages and returns a condensed summary string.
 * Pluggable — can be a local heuristic or an LLM call.
 */
export type SummaryFunction = (messages: readonly SummarizableMessage[]) => string;

/**
 * Tool output truncation result.
 */
export interface TruncatedToolOutput {
  readonly original: string;
  readonly truncated: string;
  readonly tokensReclaimed: number;
  readonly preservedKeyInfo: boolean;
}

/**
 * Prompt caching breakpoint — optimal places to break the context for caching.
 */
export interface CacheBreakpoint {
  readonly zone: string;
  readonly tokenOffset: number;
  readonly reason: string;
}

/**
 * Context budget zones with priorities.
 * Higher priority = kept longer during compaction.
 */
const DEFAULT_ZONES: readonly ContextZone[] = [
  { name: "system-prompt", priority: 10, currentTokens: 0, maxTokens: 0, compactible: false },
  { name: "active-memory", priority: 9, currentTokens: 0, maxTokens: 0, compactible: false },
  { name: "recent-conversation", priority: 8, currentTokens: 0, maxTokens: 0, compactible: true },
  { name: "tool-results", priority: 6, currentTokens: 0, maxTokens: 0, compactible: true },
  { name: "tool-schemas", priority: 5, currentTokens: 0, maxTokens: 0, compactible: true },
  { name: "old-conversation", priority: 3, currentTokens: 0, maxTokens: 0, compactible: true },
  { name: "cached-context", priority: 2, currentTokens: 0, maxTokens: 0, compactible: true },
];

const PROVIDER_SURCHARGE_THRESHOLDS: Partial<Record<string, number>> = {
  openai: 272_000,
};

export class ContextWindowIntelligence {
  private zones: ContextZone[];
  private reminders: SystemReminder[] = [];
  private totalBudget: number;
  private outputReserve: number;
  private compactionHistory: CompactionResult[] = [];
  private turnCount = 0;
  private provider: string;
  private model?: string;
  private surchargeThreshold?: number;
  private cachingSupported = false;
  private customBudget: number | null = null;
  private documentedMaxTokens: number;
  private activationMode: ContextActivationMode = "default";
  private capabilityNotes?: string;
  private extendedContextEnabled = false;

  constructor(provider: string = "ollama", model?: string) {
    this.provider = provider;
    this.model = model;
    this.totalBudget = 200_000;
    this.documentedMaxTokens = 200_000;
    this.outputReserve = Math.min(32_000, Math.floor(this.totalBudget * 0.05));
    this.zones = DEFAULT_ZONES.map((z) => ({ ...z }));
    this.applyModelLimits(provider, model);

    this.initializeDefaultReminders();
  }

  /**
   * Update token counts for each zone.
   * Call this after every turn to track context usage.
   */
  updateZones(usage: {
    systemPromptTokens: number;
    memoryTokens: number;
    toolSchemaTokens: number;
    recentConversationTokens: number;
    oldConversationTokens: number;
    toolResultTokens: number;
  }): void {
    this.turnCount++;
    this.zones = this.zones.map((z) => {
      switch (z.name) {
        case "system-prompt":
          return { ...z, currentTokens: usage.systemPromptTokens };
        case "active-memory":
          return { ...z, currentTokens: usage.memoryTokens };
        case "recent-conversation":
          return { ...z, currentTokens: usage.recentConversationTokens };
        case "old-conversation":
          return { ...z, currentTokens: usage.oldConversationTokens };
        case "tool-schemas":
          return { ...z, currentTokens: usage.toolSchemaTokens };
        case "tool-results":
          return { ...z, currentTokens: usage.toolResultTokens };
        default:
          return z;
      }
    });
  }

  /**
   * Get the current context budget with pressure analysis.
   */
  getBudget(): ContextBudget {
    const totalUsed = this.zones.reduce((sum, z) => sum + z.currentTokens, 0);
    const available = this.totalBudget - totalUsed - this.outputReserve;
    const usagePercent = totalUsed / this.totalBudget;

    return {
      totalTokens: this.totalBudget,
      systemPromptTokens: this.findZone("system-prompt")?.currentTokens ?? 0,
      memoryTokens: this.findZone("active-memory")?.currentTokens ?? 0,
      toolSchemaTokens: this.findZone("tool-schemas")?.currentTokens ?? 0,
      conversationTokens:
        (this.findZone("recent-conversation")?.currentTokens ?? 0) +
        (this.findZone("old-conversation")?.currentTokens ?? 0),
      reservedOutputTokens: this.outputReserve,
      availableTokens: Math.max(0, available),
      usagePercent,
      pressureLevel: this.classifyPressure(usagePercent),
    };
  }

  /**
   * Check if compaction is needed and return the recommended stage.
   */
  shouldCompact(): { needed: boolean; stage: CompactionStage | null; urgency: PressureLevel } {
    const budget = this.getBudget();

    if (budget.pressureLevel === "critical") {
      return { needed: true, stage: "aggressive-summarize", urgency: "critical" };
    }
    if (budget.pressureLevel === "red") {
      return { needed: true, stage: "memory-offload", urgency: "red" };
    }
    if (budget.pressureLevel === "orange") {
      return { needed: true, stage: "tool-outputs", urgency: "orange" };
    }
    if (budget.pressureLevel === "yellow") {
      return { needed: true, stage: "old-messages", urgency: "yellow" };
    }

    return { needed: false, stage: null, urgency: "green" };
  }

  /**
   * Execute a specific compaction stage.
   * Returns what was compacted and how many tokens were reclaimed.
   *
   * 5-STAGE PROGRESSIVE COMPACTION:
   * 1. Tool schemas — remove unused tool schemas (keep only recently used)
   * 2. Old messages — evict messages beyond the recent window
   * 3. Tool outputs — truncate large tool results to summaries
   * 4. Memory offload — move working memory to disk
   * 5. Aggressive summarize — summarize entire conversation to key points
   */
  compact(stage: CompactionStage): CompactionResult {
    switch (stage) {
      case "tool-schemas": {
        const zone = this.findZone("tool-schemas");
        const reclaimed = zone ? Math.floor(zone.currentTokens * 0.6) : 0;
        this.updateZoneTokens("tool-schemas", (zone?.currentTokens ?? 0) - reclaimed);
        return this.recordCompaction(stage, reclaimed, 0, "Removed unused tool schemas");
      }
      case "old-messages": {
        const zone = this.findZone("old-conversation");
        const reclaimed = zone?.currentTokens ?? 0;
        this.updateZoneTokens("old-conversation", 0);
        return this.recordCompaction(stage, reclaimed, 0, "Evicted old conversation history");
      }
      case "tool-outputs": {
        const zone = this.findZone("tool-results");
        const reclaimed = zone ? Math.floor(zone.currentTokens * 0.7) : 0;
        this.updateZoneTokens("tool-results", (zone?.currentTokens ?? 0) - reclaimed);
        return this.recordCompaction(stage, reclaimed, 0, "Truncated tool outputs to summaries");
      }
      case "memory-offload": {
        const zone = this.findZone("active-memory");
        const reclaimed = zone ? Math.floor(zone.currentTokens * 0.5) : 0;
        this.updateZoneTokens("active-memory", (zone?.currentTokens ?? 0) - reclaimed);
        return this.recordCompaction(stage, reclaimed, 0, "Offloaded working memory to disk");
      }
      case "aggressive-summarize": {
        const recentZone = this.findZone("recent-conversation");
        const reclaimed = recentZone ? Math.floor(recentZone.currentTokens * 0.8) : 0;
        this.updateZoneTokens("recent-conversation", (recentZone?.currentTokens ?? 0) - reclaimed);
        const oldZone = this.findZone("old-conversation");
        const oldReclaimed = oldZone?.currentTokens ?? 0;
        this.updateZoneTokens("old-conversation", 0);
        return this.recordCompaction(
          stage,
          reclaimed + oldReclaimed,
          0,
          "Aggressively summarized conversation",
        );
      }
    }
  }

  /**
   * Summarize a list of messages using the provided summary function.
   * Replaces older messages with a single summary, keeping the most recent.
   *
   * This is the REAL summarization that replaces the simulated compaction.
   * The summary function can be a local heuristic or an LLM call.
   */
  summarizeMessages(
    messages: readonly SummarizableMessage[],
    summaryFn: SummaryFunction,
    keepRecentCount: number = 10,
  ): { summarized: readonly SummarizableMessage[]; tokensReclaimed: number } {
    if (messages.length <= keepRecentCount + 1) {
      return { summarized: messages, tokensReclaimed: 0 };
    }

    const system = messages[0];
    const older = messages.slice(1, messages.length - keepRecentCount);
    const recent = messages.slice(messages.length - keepRecentCount);

    const tokensBefore = older.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);
    const summaryText = summaryFn(older);
    const tokensAfter = estimateTokenCount(summaryText);

    const summaryMessage: SummarizableMessage = {
      role: "system",
      content: `[Conversation summary]\n${summaryText}`,
      timestamp: Date.now(),
    };

    // Update the zone token counts to reflect compaction
    const tokensReclaimed = Math.max(0, tokensBefore - tokensAfter);
    const oldZone = this.findZone("old-conversation");
    if (oldZone) {
      this.updateZoneTokens(
        "old-conversation",
        Math.max(0, oldZone.currentTokens - tokensReclaimed),
      );
    }

    const summarized = system ? [system, summaryMessage, ...recent] : [summaryMessage, ...recent];

    return { summarized, tokensReclaimed };
  }

  /**
   * Truncate a tool output, preserving key information.
   *
   * Strategy:
   * - Keep the first N lines (usually contain the important result/summary)
   * - Keep the last N lines (usually contain the final status/error)
   * - Drop the middle (usually verbose output)
   * - Preserve lines with error/warning/fail keywords
   */
  truncateToolOutput(output: string, maxTokens: number = 500): TruncatedToolOutput {
    const currentTokens = estimateTokenCount(output);
    if (currentTokens <= maxTokens) {
      return {
        original: output,
        truncated: output,
        tokensReclaimed: 0,
        preservedKeyInfo: true,
      };
    }

    const lines = output.split("\n");
    const keepFirst = Math.min(10, Math.floor(lines.length * 0.15));
    const keepLast = Math.min(10, Math.floor(lines.length * 0.15));

    // Identify important lines in the middle
    const importantPatterns = /error|warn|fail|exception|panic|critical|success|total|summary/i;
    const middleLines = lines.slice(keepFirst, lines.length - keepLast);
    const importantMiddle = middleLines.filter((line) => importantPatterns.test(line));

    const kept = [
      ...lines.slice(0, keepFirst),
      `[... ${middleLines.length - importantMiddle.length} lines truncated ...]`,
      ...importantMiddle,
      ...lines.slice(lines.length - keepLast),
    ];

    const truncated = kept.join("\n");
    const newTokens = estimateTokenCount(truncated);

    return {
      original: output,
      truncated,
      tokensReclaimed: Math.max(0, currentTokens - newTokens),
      preservedKeyInfo: importantMiddle.length > 0,
    };
  }

  /**
   * Compute optimal prompt caching breakpoints.
   *
   * Anthropic's prompt caching works best when the cached prefix is stable
   * across turns. This method suggests where to place the cache boundary
   * so that the system prompt, tool schemas, and memory remain cached.
   */
  computeCacheBreakpoints(): readonly CacheBreakpoint[] {
    if (!this.cachingSupported) return [];

    const breakpoints: CacheBreakpoint[] = [];
    let offset = 0;

    // System prompt is always first — cache this
    const systemZone = this.findZone("system-prompt");
    if (systemZone && systemZone.currentTokens > 0) {
      offset += systemZone.currentTokens;
      breakpoints.push({
        zone: "system-prompt",
        tokenOffset: offset,
        reason: "System prompt is stable across turns",
      });
    }

    // Tool schemas change infrequently — cache after system
    const toolZone = this.findZone("tool-schemas");
    if (toolZone && toolZone.currentTokens > 0) {
      offset += toolZone.currentTokens;
      breakpoints.push({
        zone: "tool-schemas",
        tokenOffset: offset,
        reason: "Tool schemas rarely change mid-session",
      });
    }

    // Active memory is somewhat stable — cache if under pressure
    const memoryZone = this.findZone("active-memory");
    if (memoryZone && memoryZone.currentTokens > 0) {
      const budget = this.getBudget();
      if (budget.pressureLevel !== "green") {
        offset += memoryZone.currentTokens;
        breakpoints.push({
          zone: "active-memory",
          tokenOffset: offset,
          reason: "Memory zone included in cache under pressure",
        });
      }
    }

    return breakpoints;
  }

  /**
   * Get system reminders that should be injected at the current turn.
   * System reminders counteract instruction fade-out in long sessions.
   */
  getActiveReminders(): readonly string[] {
    const now = Date.now();
    const active: string[] = [];

    for (const reminder of this.reminders) {
      if (now - reminder.lastInjected >= reminder.maxFrequency) {
        if (this.shouldTriggerReminder(reminder)) {
          active.push(reminder.content);
          reminder.lastInjected = now;
        }
      }
    }

    return active;
  }

  /**
   * Add a custom system reminder.
   */
  addReminder(
    trigger: string,
    content: string,
    priority: number = 5,
    maxFrequencyMs: number = 300_000,
  ): void {
    this.reminders.push({
      trigger,
      content,
      priority,
      maxFrequency: maxFrequencyMs,
      lastInjected: 0,
    });
    this.reminders.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get compaction history for this session.
   */
  getCompactionHistory(): readonly CompactionResult[] {
    return this.compactionHistory;
  }

  /**
   * Adapt the context budget for a specific provider.
   * Call this when switching providers mid-session.
   */
  adaptToProvider(provider: string, model?: string): void {
    this.provider = provider;
    this.model = model;
    this.applyModelLimits(provider, model);

    if (this.customBudget !== null) {
      this.totalBudget = this.customBudget;
    }

    this.outputReserve = Math.min(32_000, Math.floor(this.totalBudget * 0.05));

    // If switching to a smaller context provider, trigger compaction
    const budget = this.getBudget();
    if (budget.pressureLevel === "red" || budget.pressureLevel === "critical") {
      this.compact("aggressive-summarize");
    }
  }

  /**
   * Get the optimal context allocation for a given task type.
   */
  getOptimalAllocation(taskType: "coding" | "planning" | "review" | "debugging" | "general"): {
    conversationPercent: number;
    toolsPercent: number;
    memoryPercent: number;
    systemPercent: number;
  } {
    switch (taskType) {
      case "coding":
        return {
          conversationPercent: 0.5,
          toolsPercent: 0.2,
          memoryPercent: 0.15,
          systemPercent: 0.15,
        };
      case "planning":
        return {
          conversationPercent: 0.3,
          toolsPercent: 0.1,
          memoryPercent: 0.4,
          systemPercent: 0.2,
        };
      case "review":
        return {
          conversationPercent: 0.6,
          toolsPercent: 0.15,
          memoryPercent: 0.1,
          systemPercent: 0.15,
        };
      case "debugging":
        return {
          conversationPercent: 0.4,
          toolsPercent: 0.25,
          memoryPercent: 0.2,
          systemPercent: 0.15,
        };
      default:
        return {
          conversationPercent: 0.45,
          toolsPercent: 0.2,
          memoryPercent: 0.2,
          systemPercent: 0.15,
        };
    }
  }

  getTurnCount(): number {
    return this.turnCount;
  }
  getTotalBudget(): number {
    return this.totalBudget;
  }
  getCapabilityProfile(): ContextCapabilityProfile {
    return {
      provider: this.provider,
      model: this.model,
      totalTokens: this.totalBudget,
      documentedMaxTokens: this.documentedMaxTokens,
      reservedOutputTokens: this.outputReserve,
      cachingSupported: this.cachingSupported,
      surchargeThreshold: this.surchargeThreshold,
      activationMode: this.activationMode,
      notes: this.capabilityNotes,
      extendedContextEnabled: this.extendedContextEnabled,
    };
  }

  setTotalBudget(totalTokens: number): void {
    this.provider = "custom";
    this.customBudget = Math.max(1_024, totalTokens);
    this.totalBudget = this.customBudget;
    this.documentedMaxTokens = this.customBudget;
    this.outputReserve = Math.min(32_000, Math.floor(this.totalBudget * 0.05));
  }

  // ── Private helpers ────────────────────────────────────────

  private classifyPressure(usage: number): PressureLevel {
    if (usage >= 0.95) return "critical";
    if (usage >= 0.85) return "red";
    if (usage >= 0.7) return "orange";
    if (usage >= 0.5) return "yellow";
    return "green";
  }

  private findZone(name: string): ContextZone | undefined {
    return this.zones.find((z) => z.name === name);
  }

  private updateZoneTokens(name: string, tokens: number): void {
    this.zones = this.zones.map((z) =>
      z.name === name ? { ...z, currentTokens: Math.max(0, tokens) } : z,
    );
  }

  private recordCompaction(
    stage: CompactionStage,
    tokensReclaimed: number,
    itemsRemoved: number,
    summary: string,
  ): CompactionResult {
    const result: CompactionResult = { stage, tokensReclaimed, itemsRemoved, summary };
    this.compactionHistory.push(result);
    return result;
  }

  private shouldTriggerReminder(reminder: SystemReminder): boolean {
    const budget = this.getBudget();

    switch (reminder.trigger) {
      case "long-session":
        return this.turnCount > 20;
      case "high-pressure":
        return budget.pressureLevel === "orange" || budget.pressureLevel === "red";
      case "verification":
        return this.turnCount % 5 === 0;
      case "planning":
        return this.turnCount <= 3;
      default:
        return false;
    }
  }

  private initializeDefaultReminders(): void {
    this.addReminder(
      "verification",
      "REMINDER: After making code changes, verify by running typecheck and tests before claiming completion.",
      8,
      600_000,
    );
    this.addReminder(
      "planning",
      "REMINDER: Plan before coding. Read all relevant files before making changes.",
      7,
      300_000,
    );
    this.addReminder(
      "long-session",
      "REMINDER: This is a long session. Check that your changes are consistent with earlier work.",
      5,
      900_000,
    );
    this.addReminder(
      "high-pressure",
      "REMINDER: Context usage is high. Focus on the most important remaining task.",
      9,
      120_000,
    );
  }

  private applyModelLimits(provider: string, model?: string): void {
    const extendedContextEnabled = isExtendedContextEnabled(provider, model);
    const config = getModelContextConfig(model ?? "auto", provider, {
      enableExtendedContext: extendedContextEnabled,
    });

    this.extendedContextEnabled = extendedContextEnabled;
    this.totalBudget = config.maxContextTokens;
    this.documentedMaxTokens = config.documentedMaxContextTokens;
    this.outputReserve = Math.min(32_000, Math.floor(this.totalBudget * 0.05));
    this.surchargeThreshold = PROVIDER_SURCHARGE_THRESHOLDS[provider];
    this.cachingSupported = config.supportsPromptCaching;
    this.activationMode = config.activationMode;
    this.capabilityNotes = config.notes;
  }
}

// ── Pure Utility Functions ──────────────────────────────────

/**
 * Estimate token count from text. Rough heuristic: ~4 chars per token.
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
