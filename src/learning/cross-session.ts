/**
 * Cross-Session Learning — learn from every session to improve future ones.
 *
 * Automatically extracts:
 * - Error patterns that were successfully debugged
 * - Tool invocation sequences that worked well
 * - Code patterns the user prefers
 * - Common file editing patterns
 * - Successful strategies for different task types
 *
 * Persists learnings in the memory store with provenance tracking.
 * Loads relevant learnings into future session system prompts.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import type { MemoryStore } from "../memory/store.js";

export interface Learning {
  readonly id: string;
  readonly type: LearningType;
  readonly trigger: string;
  readonly content: string;
  readonly frequency: number;
  readonly lastSeen: string;
  readonly firstSeen: string;
  readonly confidence: number;
  readonly source: string;
}

export type LearningType =
  | "error_pattern"
  | "tool_sequence"
  | "code_style"
  | "file_pattern"
  | "strategy"
  | "preference";

export interface SessionTrace {
  readonly sessionId: string;
  readonly actions: readonly TraceAction[];
  readonly outcome: "success" | "failure" | "partial";
  readonly duration: number;
}

export interface TraceAction {
  readonly type: string;
  readonly tool?: string;
  readonly input?: string;
  readonly output?: string;
  readonly success: boolean;
  readonly timestamp: number;
}

export class CrossSessionLearner {
  private learnings: Map<string, Learning> = new Map();
  private currentTrace: TraceAction[] = [];
  private sessionId: string;
  private readonly persistPath: string | undefined;
  private memoryStore: MemoryStore | null = null;

  constructor(sessionId?: string, persistPath?: string) {
    this.sessionId = sessionId ?? randomUUID();
    this.persistPath = persistPath;
    if (persistPath && existsSync(persistPath)) {
      try {
        const raw = readFileSync(persistPath, "utf-8");
        this.restore(raw);
      } catch {
        // Ignore corrupt data
      }
    }
  }

  /**
   * Attach a MemoryStore for persisting learnings with layer="learning".
   */
  setMemoryStore(store: MemoryStore): void {
    this.memoryStore = store;
  }

  /**
   * Create a CrossSessionLearner pre-loaded from a persisted file.
   */
  static loadFrom(path: string, sessionId?: string): CrossSessionLearner {
    return new CrossSessionLearner(sessionId, path);
  }

  /** Record an action in the current session trace */
  recordAction(action: Omit<TraceAction, "timestamp">): void {
    this.currentTrace.push({ ...action, timestamp: Date.now() });
  }

  /**
   * Extract learnings from the current session trace.
   * Call this at session end.
   */
  extractLearnings(outcome: "success" | "failure" | "partial"): readonly Learning[] {
    const extracted: Learning[] = [];

    // Extract error -> fix patterns
    extracted.push(...this.extractErrorPatterns());

    // Extract successful tool sequences
    extracted.push(...this.extractToolSequences());

    // Extract strategy patterns
    extracted.push(...this.extractStrategyPatterns(outcome));

    // Extract code style conventions from edits
    extracted.push(...this.extractCodeStylePatterns());

    // Extract file co-editing patterns
    extracted.push(...this.extractFilePatterns());

    // Extract user preference signals from corrections
    extracted.push(...this.extractPreferencePatterns());

    // Merge with existing learnings
    for (const learning of extracted) {
      const existing = this.findSimilarLearning(learning);
      if (existing) {
        // Increment frequency for existing learning
        this.learnings.set(existing.id, {
          ...existing,
          frequency: existing.frequency + 1,
          lastSeen: new Date().toISOString(),
          confidence: Math.min(1.0, existing.confidence + 0.1),
        });
      } else {
        this.learnings.set(learning.id, learning);
      }
    }

    this.persist();
    this.persistToMemoryStore(extracted);

    return extracted;
  }

  /**
   * Write current learnings to disk as JSON.
   * No-op if no persistPath was configured.
   */
  persist(): void {
    if (!this.persistPath) return;
    try {
      const dir = this.persistPath.replace(/[/\\][^/\\]+$/, "");
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.persistPath, this.serialize());
    } catch {
      // Best-effort — do not crash if disk write fails
    }
  }

  /**
   * Get relevant learnings for a task description.
   */
  getRelevantLearnings(taskDescription: string, limit: number = 5): readonly Learning[] {
    const keywords = taskDescription.toLowerCase().split(/\s+/);

    return [...this.learnings.values()]
      .filter((l) => {
        const triggerLower = l.trigger.toLowerCase();
        const contentLower = l.content.toLowerCase();
        return keywords.some((kw) => triggerLower.includes(kw) || contentLower.includes(kw));
      })
      .sort((a, b) => {
        // Sort by relevance: frequency × confidence
        return (b.frequency * b.confidence) - (a.frequency * a.confidence);
      })
      .slice(0, limit);
  }

  /**
   * Build a system prompt section from relevant learnings.
   */
  buildLearningPrompt(taskDescription: string): string {
    const relevant = this.getRelevantLearnings(taskDescription);
    if (relevant.length === 0) return "";

    const lines = [
      "## Learnings from Previous Sessions",
      "",
    ];

    for (const learning of relevant) {
      lines.push(`- **${learning.type}** (seen ${learning.frequency}x, confidence ${(learning.confidence * 100).toFixed(0)}%): ${learning.content}`);
    }

    return lines.join("\n");
  }

  /** Get all learnings */
  getAllLearnings(): readonly Learning[] {
    return [...this.learnings.values()];
  }

  /** Serialize for persistence */
  serialize(): string {
    return JSON.stringify([...this.learnings.values()]);
  }

  /** Restore from serialized state */
  restore(serialized: string): void {
    try {
      const entries = JSON.parse(serialized) as Learning[];
      for (const entry of entries) {
        this.learnings.set(entry.id, entry);
      }
    } catch {
      // Ignore invalid data
    }
  }

  /** Get the current session trace as readonly */
  getSessionTrace(): readonly TraceAction[] {
    return [...this.currentTrace];
  }

  /** Clear current session trace */
  clearTrace(): void {
    this.currentTrace = [];
  }

  // ── Private extraction methods ────────────────────────

  private extractErrorPatterns(): Learning[] {
    const learnings: Learning[] = [];
    const actions = this.currentTrace;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      if (!action.success && action.output) {
        // Look for subsequent successful action that fixed the error
        for (let j = i + 1; j < Math.min(i + 5, actions.length); j++) {
          const fix = actions[j]!;
          if (fix.success && fix.tool === action.tool) {
            learnings.push({
              id: randomUUID(),
              type: "error_pattern",
              trigger: action.output.slice(0, 200),
              content: `When ${action.tool} fails with "${action.output.slice(0, 100)}", fix by: ${fix.input?.slice(0, 200) ?? "retry"}`,
              frequency: 1,
              lastSeen: new Date().toISOString(),
              firstSeen: new Date().toISOString(),
              confidence: 0.5,
              source: this.sessionId,
            });
            break;
          }
        }
      }
    }

    return learnings;
  }

  private extractToolSequences(): Learning[] {
    const learnings: Learning[] = [];
    const successfulSequences: string[][] = [];
    let currentSequence: string[] = [];

    for (const action of this.currentTrace) {
      if (action.success && action.tool) {
        currentSequence.push(action.tool);
      } else {
        if (currentSequence.length >= 3) {
          successfulSequences.push([...currentSequence]);
        }
        currentSequence = [];
      }
    }

    if (currentSequence.length >= 3) {
      successfulSequences.push(currentSequence);
    }

    for (const seq of successfulSequences) {
      learnings.push({
        id: randomUUID(),
        type: "tool_sequence",
        trigger: seq[0] ?? "",
        content: `Effective tool sequence: ${seq.join(" → ")}`,
        frequency: 1,
        lastSeen: new Date().toISOString(),
        firstSeen: new Date().toISOString(),
        confidence: 0.4,
        source: this.sessionId,
      });
    }

    return learnings;
  }

  private extractStrategyPatterns(outcome: "success" | "failure" | "partial"): Learning[] {
    if (outcome === "failure") return [];

    const learnings: Learning[] = [];
    const actions = this.currentTrace;

    if (actions.length < 3) return learnings;

    // Extract the overall approach
    const tools = actions.filter((a) => a.tool).map((a) => a.tool!);
    const uniqueTools = [...new Set(tools)];

    learnings.push({
      id: randomUUID(),
      type: "strategy",
      trigger: actions[0]?.type ?? "unknown",
      content: `Strategy using ${uniqueTools.join(", ")} with ${actions.length} actions resulted in ${outcome}`,
      frequency: 1,
      lastSeen: new Date().toISOString(),
      firstSeen: new Date().toISOString(),
      confidence: outcome === "success" ? 0.6 : 0.3,
      source: this.sessionId,
    });

    return learnings;
  }

  /**
   * Extract code_style learnings by detecting naming conventions from edits.
   * Looks at file_edit actions to identify camelCase, snake_case, kebab-case usage.
   */
  private extractCodeStylePatterns(): Learning[] {
    const learnings: Learning[] = [];
    const editActions = this.currentTrace.filter(
      (a) => a.type === "file_edit" && a.success && a.input,
    );

    if (editActions.length < 2) return learnings;

    // Detect naming conventions from edit content
    const conventions = new Map<string, number>();
    for (const action of editActions) {
      const content = action.input ?? "";
      const camelMatches = content.match(/[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*/g);
      const snakeMatches = content.match(/[a-z]+_[a-z]+/g);
      const kebabMatches = content.match(/[a-z]+-[a-z]+/g);

      if (camelMatches) conventions.set("camelCase", (conventions.get("camelCase") ?? 0) + camelMatches.length);
      if (snakeMatches) conventions.set("snake_case", (conventions.get("snake_case") ?? 0) + snakeMatches.length);
      if (kebabMatches) conventions.set("kebab-case", (conventions.get("kebab-case") ?? 0) + kebabMatches.length);
    }

    // Report the dominant convention
    let dominant = "";
    let maxCount = 0;
    for (const [style, count] of conventions) {
      if (count > maxCount) {
        dominant = style;
        maxCount = count;
      }
    }

    if (dominant && maxCount >= 3) {
      learnings.push({
        id: randomUUID(),
        type: "code_style",
        trigger: "naming_convention",
        content: `Dominant naming convention: ${dominant} (${maxCount} occurrences)`,
        frequency: 1,
        lastSeen: new Date().toISOString(),
        firstSeen: new Date().toISOString(),
        confidence: Math.min(0.9, maxCount / 20),
        source: this.sessionId,
      });
    }

    return learnings;
  }

  /**
   * Extract file_pattern learnings by detecting commonly co-edited files.
   * Files edited in the same session within a short window are likely related.
   */
  private extractFilePatterns(): Learning[] {
    const learnings: Learning[] = [];
    const editActions = this.currentTrace.filter(
      (a) => a.type === "file_edit" && a.success && a.tool,
    );

    if (editActions.length < 2) return learnings;

    // Build co-occurrence map: which files are edited close together
    const coEdits = new Map<string, Set<string>>();
    for (let i = 0; i < editActions.length; i++) {
      const current = editActions[i]!;
      const currentFile = current.tool ?? "";
      if (!currentFile) continue;

      // Look at next 5 actions for co-edited files
      for (let j = i + 1; j < Math.min(i + 6, editActions.length); j++) {
        const other = editActions[j]!;
        const otherFile = other.tool ?? "";
        if (!otherFile || otherFile === currentFile) continue;

        // Within 5 minutes
        if (other.timestamp - current.timestamp <= 300_000) {
          const key = [currentFile, otherFile].sort().join(" <-> ");
          const existing = coEdits.get(key) ?? new Set<string>();
          existing.add(currentFile);
          existing.add(otherFile);
          coEdits.set(key, existing);
        }
      }
    }

    for (const [pair, files] of coEdits) {
      if (files.size >= 2) {
        learnings.push({
          id: randomUUID(),
          type: "file_pattern",
          trigger: pair,
          content: `Files commonly co-edited: ${[...files].join(", ")}`,
          frequency: 1,
          lastSeen: new Date().toISOString(),
          firstSeen: new Date().toISOString(),
          confidence: 0.5,
          source: this.sessionId,
        });
      }
    }

    return learnings;
  }

  /**
   * Extract preference learnings by detecting user corrections.
   * When a user retries an action shortly after failure, the retry
   * signals a preference for the corrected approach.
   */
  private extractPreferencePatterns(): Learning[] {
    const learnings: Learning[] = [];
    const actions = this.currentTrace;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      if (action.success || !action.output) continue;

      // Look for a correction: user sends a different input within the next 3 actions
      for (let j = i + 1; j < Math.min(i + 4, actions.length); j++) {
        const correction = actions[j]!;
        if (
          correction.success
          && correction.type === action.type
          && correction.input !== action.input
          && correction.input
        ) {
          learnings.push({
            id: randomUUID(),
            type: "preference",
            trigger: action.input?.slice(0, 100) ?? action.type,
            content: `User preferred: "${correction.input.slice(0, 150)}" over "${action.input?.slice(0, 150) ?? ""}"`,
            frequency: 1,
            lastSeen: new Date().toISOString(),
            firstSeen: new Date().toISOString(),
            confidence: 0.6,
            source: this.sessionId,
          });
          break;
        }
      }
    }

    return learnings;
  }

  /**
   * Persist extracted learnings to MemoryStore with layer="learning".
   */
  private persistToMemoryStore(extracted: readonly Learning[]): void {
    if (!this.memoryStore || extracted.length === 0) return;
    try {
      const summary = extracted
        .map((l) => `[${l.type}] ${l.content.slice(0, 150)}`)
        .join("; ");
      this.memoryStore.captureEvent(
        "cross_session_extraction",
        summary.slice(0, 2000),
        "learning",
      );
    } catch {
      // Best-effort
    }
  }

  private findSimilarLearning(candidate: Learning): Learning | null {
    for (const existing of this.learnings.values()) {
      if (existing.type === candidate.type && existing.trigger === candidate.trigger) {
        return existing;
      }
    }
    return null;
  }
}
