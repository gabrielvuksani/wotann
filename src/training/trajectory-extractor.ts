/**
 * Trajectory Extractor — converts session logs into training data.
 *
 * FROM RESEARCH:
 * - Hermes Agent: trajectory compression preserving training signal quality
 * - AgentDiet: "useless, redundant, and expired information" auto-removed
 * - ATLaS: extract critical decision steps, not exploratory noise
 *
 * Pipeline: Session Logs → Filter → Compress → Format → Quality Gate → JSONL
 *
 * Output format: chat-format JSONL compatible with MLX-LM and Unsloth:
 * {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────

export interface TrajectoryEntry {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly timestamp: number;
  readonly tokens?: number;
  readonly toolName?: string;
  readonly toolResult?: string;
  readonly isDecisive?: boolean; // ATLaS-style critical step marker
}

export interface TrainingExample {
  readonly messages: readonly { role: string; content: string }[];
  readonly metadata: {
    readonly sessionId: string;
    readonly taskSuccess: boolean;
    readonly totalTokens: number;
    readonly compressionRatio: number;
  };
}

export interface ExtractionConfig {
  readonly maxTokensPerExample: number;  // Target compressed size (default: 15250 per Hermes)
  readonly minTurns: number;             // Minimum turns for a valid example
  readonly requireSuccess: boolean;      // Only include successful sessions
  readonly compressMiddle: boolean;      // Compress middle turns (Hermes pattern)
  readonly extractDecisive: boolean;     // ATLaS-style critical step extraction
}

const DEFAULT_CONFIG: ExtractionConfig = {
  maxTokensPerExample: 15250,
  minTurns: 4,
  requireSuccess: true,
  compressMiddle: true,
  extractDecisive: true,
};

// ── Trajectory Extractor ─────────────────────────────────

export class TrajectoryExtractor {
  private readonly config: ExtractionConfig;
  private readonly outputDir: string;

  constructor(config?: Partial<ExtractionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.outputDir = join(homedir(), ".wotann", "training-data");
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Extract training examples from session logs.
   * Reads from ~/.wotann/sessions/ and outputs to ~/.wotann/training-data/
   */
  extractFromSessions(): readonly TrainingExample[] {
    const sessionsDir = join(homedir(), ".wotann", "sessions");
    if (!existsSync(sessionsDir)) return [];

    const sessionFiles = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"));

    const examples: TrainingExample[] = [];

    for (const file of sessionFiles) {
      try {
        const content = readFileSync(join(sessionsDir, file), "utf-8");
        const entries = this.parseSessionLog(content);

        if (entries.length < this.config.minTurns) continue;

        // Apply quality gate
        const isSuccessful = this.assessSuccess(entries);
        if (this.config.requireSuccess && !isSuccessful) continue;

        // Compress trajectory
        const compressed = this.compressTrajectory(entries);

        // Format as training example
        const example = this.formatExample(compressed, file, isSuccessful);
        if (example) examples.push(example);
      } catch {
        // Skip malformed session files
      }
    }

    return examples;
  }

  /**
   * Parse session log file into trajectory entries.
   */
  private parseSessionLog(content: string): readonly TrajectoryEntry[] {
    const entries: TrajectoryEntry[] = [];
    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.role && parsed.content) {
          entries.push({
            role: parsed.role,
            content: typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed.content),
            timestamp: parsed.timestamp ?? Date.now(),
            tokens: parsed.tokens,
            toolName: parsed.toolName,
            toolResult: parsed.toolResult,
          });
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    return entries;
  }

  /**
   * Assess whether a session was successful.
   * Looks for: tests passing, user acceptance, no error loops.
   */
  private assessSuccess(entries: readonly TrajectoryEntry[]): boolean {
    const lastAssistant = [...entries].reverse().find((e) => e.role === "assistant");
    if (!lastAssistant) return false;

    const content = lastAssistant.content.toLowerCase();
    const successSignals = ["test", "pass", "success", "complete", "done", "fixed", "implemented"];
    const failureSignals = ["error", "failed", "cannot", "unable", "stuck"];

    const successScore = successSignals.filter((s) => content.includes(s)).length;
    const failureScore = failureSignals.filter((s) => content.includes(s)).length;

    return successScore > failureScore;
  }

  /**
   * Compress trajectory using Hermes-style middle compression.
   * Protects first 3 and last 3 turns. Compresses middle.
   */
  private compressTrajectory(entries: readonly TrajectoryEntry[]): readonly TrajectoryEntry[] {
    if (!this.config.compressMiddle || entries.length <= 8) return entries;

    const head = entries.slice(0, 3);  // Protect first 3
    const tail = entries.slice(-3);    // Protect last 3
    const middle = entries.slice(3, -3);

    // Filter middle: keep decisive steps, remove redundant tool calls
    const filtered = middle.filter((entry) => {
      // Always keep user messages
      if (entry.role === "user") return true;

      // Keep decisive steps
      if (entry.isDecisive) return true;

      // Remove redundant Read/Glob/Grep (keep only the last one per file)
      if (entry.toolName && ["Read", "Glob", "Grep"].includes(entry.toolName)) {
        return false;
      }

      // Keep Write/Edit/Bash (these are actions, not exploration)
      if (entry.toolName && ["Write", "Edit", "Bash"].includes(entry.toolName)) {
        return true;
      }

      // Keep assistant responses that contain decisions
      if (entry.role === "assistant" && entry.content.length > 100) {
        return true;
      }

      return false;
    });

    // Summarize if still too long
    const estimatedTokens = [...head, ...filtered, ...tail]
      .reduce((sum, e) => sum + (e.tokens ?? Math.ceil(e.content.length / 4)), 0);

    if (estimatedTokens > this.config.maxTokensPerExample) {
      // Truncate middle content to fit budget
      const budget = this.config.maxTokensPerExample -
        [...head, ...tail].reduce((sum, e) => sum + (e.tokens ?? Math.ceil(e.content.length / 4)), 0);

      let used = 0;
      const trimmed: TrajectoryEntry[] = [];
      for (const entry of filtered) {
        const tokens = entry.tokens ?? Math.ceil(entry.content.length / 4);
        if (used + tokens > budget) break;
        trimmed.push(entry);
        used += tokens;
      }

      return [...head, ...trimmed, ...tail];
    }

    return [...head, ...filtered, ...tail];
  }

  /**
   * Format compressed trajectory as a training example.
   */
  private formatExample(
    entries: readonly TrajectoryEntry[],
    sessionId: string,
    taskSuccess: boolean,
  ): TrainingExample | null {
    const messages = entries
      .filter((e) => e.role !== "tool") // Exclude raw tool results
      .map((e) => ({
        role: e.role === "tool" ? "assistant" : e.role,
        content: e.content,
      }));

    if (messages.length < this.config.minTurns) return null;

    const totalTokens = entries.reduce(
      (sum, e) => sum + (e.tokens ?? Math.ceil(e.content.length / 4)), 0,
    );

    return {
      messages,
      metadata: {
        sessionId,
        taskSuccess,
        totalTokens,
        compressionRatio: entries.length / messages.length,
      },
    };
  }

  /**
   * Export training examples as JSONL for MLX-LM / Unsloth.
   */
  exportAsJsonl(examples: readonly TrainingExample[]): string {
    const outputPath = join(this.outputDir, `training-${Date.now()}.jsonl`);

    const lines = examples.map((ex) =>
      JSON.stringify({ messages: ex.messages }),
    );

    const content = lines.join("\n") + "\n";
    writeFileSync(outputPath, content);

    return outputPath;
  }

  /**
   * Full pipeline: extract → compress → export.
   * Returns the path to the generated JSONL file.
   */
  runPipeline(): { path: string; exampleCount: number; totalTokens: number } {
    const examples = this.extractFromSessions();

    if (examples.length === 0) {
      return { path: "", exampleCount: 0, totalTokens: 0 };
    }

    const path = this.exportAsJsonl(examples);
    const totalTokens = examples.reduce((sum, ex) => sum + ex.metadata.totalTokens, 0);

    return {
      path,
      exampleCount: examples.length,
      totalTokens,
    };
  }
}
