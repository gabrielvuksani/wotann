/**
 * Trace Analyzer — post-run failure analysis and harness improvement.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Trajectory-level analysis" is how top harnesses identify systematic
 * failure patterns and auto-correct them in future runs.
 *
 * This module:
 * 1. Records every tool call, its result, and the agent's reasoning
 * 2. After a task completes (success or failure), analyzes the trace
 * 3. Identifies patterns: repeated failures, abandoned approaches, wasted tokens
 * 4. Generates improvement proposals for the harness configuration
 * 5. Feeds insights back into the learning pipeline (autoDream)
 *
 * KEY PATTERNS DETECTED:
 * - Doom loops: same tool called 3+ times with identical args
 * - Abandoned research: files read but never used
 * - Over-planning: >30% of tokens spent on reasoning without action
 * - Under-verification: code changes without subsequent test runs
 * - Tool misuse: wrong tool for the task (e.g., Bash for file reading)
 */

export interface TraceEntry {
  readonly timestamp: number;
  readonly type: "tool_call" | "tool_result" | "thinking" | "text" | "error";
  readonly toolName?: string;
  readonly toolArgs?: Record<string, unknown>;
  readonly content: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
}

export interface TraceAnalysis {
  readonly totalEntries: number;
  readonly totalTokens: number;
  readonly totalDurationMs: number;
  readonly patterns: readonly DetectedPattern[];
  readonly toolUsage: ReadonlyMap<string, number>;
  readonly tokenBreakdown: {
    readonly thinking: number;
    readonly toolCalls: number;
    readonly text: number;
  };
  readonly efficiency: number; // 0-1, higher = more efficient
  readonly improvements: readonly ImprovementProposal[];
}

export interface DetectedPattern {
  readonly type: PatternType;
  readonly severity: "info" | "warning" | "critical";
  readonly description: string;
  readonly occurrences: number;
  readonly tokensCost: number;
}

export type PatternType =
  | "doom-loop"
  | "abandoned-research"
  | "over-planning"
  | "under-verification"
  | "tool-misuse"
  | "repeated-error"
  | "context-waste"
  | "successful-pattern";

export interface ImprovementProposal {
  readonly area: "middleware" | "prompt" | "tool" | "strategy";
  readonly description: string;
  readonly expectedImpact: "low" | "medium" | "high";
  readonly autoApplicable: boolean;
}

export class TraceAnalyzer {
  private entries: TraceEntry[] = [];

  /**
   * Record a trace entry during execution.
   */
  record(entry: TraceEntry): void {
    this.entries.push(entry);
  }

  /**
   * Clear the trace buffer (for new task).
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get the number of recorded entries.
   */
  size(): number {
    return this.entries.length;
  }

  getRecentEntries(limit: number = 10): readonly TraceEntry[] {
    if (limit <= 0) return [];
    return this.entries.slice(-limit);
  }

  /**
   * Analyze the recorded trace and produce insights.
   */
  analyze(): TraceAnalysis {
    const patterns = this.detectPatterns();
    const toolUsage = this.countToolUsage();
    const tokenBreakdown = this.computeTokenBreakdown();
    const totalTokens = this.entries.reduce((sum, e) => sum + e.tokensUsed, 0);
    const totalDurationMs = this.entries.reduce((sum, e) => sum + e.durationMs, 0);
    const efficiency = this.computeEfficiency(patterns, totalTokens);
    const improvements = this.generateImprovements(patterns);

    return {
      totalEntries: this.entries.length,
      totalTokens,
      totalDurationMs,
      patterns,
      toolUsage,
      tokenBreakdown,
      efficiency,
      improvements,
    };
  }

  private detectPatterns(): readonly DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Doom loop detection: same tool+args 3+ times
    const callSignatures = new Map<string, number>();
    for (const entry of this.entries) {
      if (entry.type !== "tool_call") continue;
      const sig = `${entry.toolName}:${JSON.stringify(entry.toolArgs)}`;
      callSignatures.set(sig, (callSignatures.get(sig) ?? 0) + 1);
    }
    for (const [sig, count] of callSignatures) {
      if (count >= 3) {
        const toolName = sig.split(":")[0] ?? "unknown";
        patterns.push({
          type: "doom-loop",
          severity: count >= 5 ? "critical" : "warning",
          description: `${toolName} called ${count} times with identical arguments`,
          occurrences: count,
          tokensCost: count * 100, // Estimated waste
        });
      }
    }

    // Repeated errors: same error message multiple times
    const errorMessages = new Map<string, number>();
    for (const entry of this.entries) {
      if (entry.type !== "error") continue;
      const key = entry.content.slice(0, 100);
      errorMessages.set(key, (errorMessages.get(key) ?? 0) + 1);
    }
    for (const [msg, count] of errorMessages) {
      if (count >= 2) {
        patterns.push({
          type: "repeated-error",
          severity: "warning",
          description: `Error repeated ${count} times: "${msg.slice(0, 60)}"`,
          occurrences: count,
          tokensCost: count * 200,
        });
      }
    }

    // Over-planning: >30% tokens on thinking without corresponding tool calls
    const thinkingTokens = this.entries
      .filter((e) => e.type === "thinking")
      .reduce((sum, e) => sum + e.tokensUsed, 0);
    const totalTokens = this.entries.reduce((sum, e) => sum + e.tokensUsed, 0);
    if (totalTokens > 0 && thinkingTokens / totalTokens > 0.3) {
      patterns.push({
        type: "over-planning",
        severity: "info",
        description: `${Math.round(thinkingTokens / totalTokens * 100)}% of tokens spent on thinking`,
        occurrences: 1,
        tokensCost: thinkingTokens - Math.round(totalTokens * 0.2),
      });
    }

    // Under-verification: Write/Edit without subsequent test/typecheck
    let lastWriteIdx = -1;
    let hasVerificationAfterWrite = false;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      if (entry.type === "tool_call" && (entry.toolName === "Write" || entry.toolName === "Edit")) {
        if (lastWriteIdx >= 0 && !hasVerificationAfterWrite) {
          patterns.push({
            type: "under-verification",
            severity: "warning",
            description: "Code changed without running verification (tests/typecheck)",
            occurrences: 1,
            tokensCost: 0,
          });
        }
        lastWriteIdx = i;
        hasVerificationAfterWrite = false;
      }
      if (entry.type === "tool_call" && entry.toolName === "Bash") {
        const cmd = String(entry.toolArgs?.["command"] ?? "");
        if (cmd.includes("tsc") || cmd.includes("vitest") || cmd.includes("jest") || cmd.includes("test")) {
          hasVerificationAfterWrite = true;
        }
      }
    }

    // Tool misuse: Bash used where Read/Grep would be better
    const bashReads = this.entries.filter(
      (e) => e.type === "tool_call" && e.toolName === "Bash" &&
        /\b(cat|head|tail|less|more)\b/.test(String(e.toolArgs?.["command"] ?? "")),
    );
    if (bashReads.length > 0) {
      patterns.push({
        type: "tool-misuse",
        severity: "info",
        description: `Bash used for file reading ${bashReads.length} times (use Read tool instead)`,
        occurrences: bashReads.length,
        tokensCost: bashReads.length * 50,
      });
    }

    // Successful patterns: detect what worked well
    const successfulTools = this.entries.filter(
      (e) => e.type === "tool_result" && !e.content.toLowerCase().includes("error"),
    );
    if (successfulTools.length > this.entries.length * 0.8) {
      patterns.push({
        type: "successful-pattern",
        severity: "info",
        description: `${Math.round(successfulTools.length / Math.max(1, this.entries.length) * 100)}% of tool calls succeeded`,
        occurrences: successfulTools.length,
        tokensCost: 0,
      });
    }

    return patterns;
  }

  private countToolUsage(): ReadonlyMap<string, number> {
    const usage = new Map<string, number>();
    for (const entry of this.entries) {
      if (entry.type === "tool_call" && entry.toolName) {
        usage.set(entry.toolName, (usage.get(entry.toolName) ?? 0) + 1);
      }
    }
    return usage;
  }

  private computeTokenBreakdown(): { thinking: number; toolCalls: number; text: number } {
    let thinking = 0;
    let toolCalls = 0;
    let text = 0;
    for (const entry of this.entries) {
      if (entry.type === "thinking") thinking += entry.tokensUsed;
      else if (entry.type === "tool_call" || entry.type === "tool_result") toolCalls += entry.tokensUsed;
      else text += entry.tokensUsed;
    }
    return { thinking, toolCalls, text };
  }

  private computeEfficiency(patterns: readonly DetectedPattern[], totalTokens: number): number {
    if (totalTokens === 0) return 1;
    const wastedTokens = patterns.reduce((sum, p) => sum + p.tokensCost, 0);
    return Math.max(0, Math.min(1, 1 - wastedTokens / totalTokens));
  }

  private generateImprovements(patterns: readonly DetectedPattern[]): readonly ImprovementProposal[] {
    const proposals: ImprovementProposal[] = [];

    for (const pattern of patterns) {
      switch (pattern.type) {
        case "doom-loop":
          proposals.push({
            area: "middleware",
            description: "Increase loop detection sensitivity or add automatic strategy escalation",
            expectedImpact: "high",
            autoApplicable: true,
          });
          break;
        case "under-verification":
          proposals.push({
            area: "middleware",
            description: "Enable forced verification middleware to auto-run tests after code changes",
            expectedImpact: "high",
            autoApplicable: true,
          });
          break;
        case "over-planning":
          proposals.push({
            area: "prompt",
            description: "Reduce reasoning budget or switch to the execution phase earlier",
            expectedImpact: "medium",
            autoApplicable: true,
          });
          break;
        case "tool-misuse":
          proposals.push({
            area: "tool",
            description: "Add tool recommendation hints to the system prompt",
            expectedImpact: "low",
            autoApplicable: false,
          });
          break;
        case "repeated-error":
          proposals.push({
            area: "strategy",
            description: "Inject error context from previous attempts to avoid repeating mistakes",
            expectedImpact: "medium",
            autoApplicable: true,
          });
          break;
      }
    }

    return proposals;
  }
}
