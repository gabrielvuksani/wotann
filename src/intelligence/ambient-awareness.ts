/**
 * Ambient Awareness — proactive context loading and anticipation.
 *
 * Monitors the agent's work patterns and preemptively loads relevant context:
 * - File proximity: editing auth.ts → pre-load auth.test.ts, auth.types.ts
 * - Task trajectory: finished "implement login" → pre-load "registration"
 * - Decision replay: working on auth module → load prior auth decisions
 * - Git awareness: recent commits indicate active areas
 * - Time patterns: morning = review PRs, afternoon = deep work
 */

import { existsSync, readdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";

export interface AwarenessSignal {
  readonly type: "file-proximity" | "task-trajectory" | "decision-replay" | "git-activity" | "time-pattern";
  readonly source: string;
  readonly suggestedFiles: readonly string[];
  readonly suggestedMemoryKeys: readonly string[];
  readonly confidence: number;
  readonly reason: string;
}

// ── Ambient Desktop Intelligence (Phase 19E) ───────────────

export type AmbientSignalType =
  | "clipboard-change"
  | "file-save"
  | "terminal-output";

export interface AmbientSignal {
  readonly type: AmbientSignalType;
  readonly content: string;
  readonly timestamp: number;
  readonly relevance: number;
}

export interface AmbientContext {
  readonly signals: readonly AwarenessSignal[];
  readonly preloadedFiles: readonly string[];
  readonly preloadedMemoryKeys: readonly string[];
  readonly generatedAt: number;
}

/**
 * Given a file being edited, suggest related files to preload.
 */
export function fileProximity(filePath: string, workspaceDir: string): AwarenessSignal {
  const dir = dirname(filePath);
  const base = basename(filePath, extname(filePath));
  const ext = extname(filePath);

  const candidates: string[] = [];

  // Test file
  const testPatterns = [
    join(dir, `${base}.test${ext}`),
    join(dir, `${base}.spec${ext}`),
    join(dir, "__tests__", `${base}.test${ext}`),
    join(workspaceDir, "tests", "unit", `${base}.test${ext}`),
  ];
  for (const p of testPatterns) {
    if (existsSync(p)) candidates.push(p);
  }

  // Types file
  const typesPatterns = [
    join(dir, `${base}.types${ext}`),
    join(dir, "types.ts"),
    join(dir, "types", `${base}.ts`),
  ];
  for (const p of typesPatterns) {
    if (existsSync(p)) candidates.push(p);
  }

  // Related files in same directory
  try {
    const siblings = readdirSync(dir).filter(
      (f) => f !== basename(filePath) && f.startsWith(base.split("-")[0] ?? base.slice(0, 3)),
    );
    for (const sibling of siblings.slice(0, 5)) {
      candidates.push(join(dir, sibling));
    }
  } catch {
    // Directory may not be readable
  }

  return {
    type: "file-proximity",
    source: filePath,
    suggestedFiles: [...new Set(candidates)],
    suggestedMemoryKeys: [],
    confidence: 0.8,
    reason: `Files related to ${basename(filePath)} by naming convention and directory proximity`,
  };
}

/**
 * Given a completed task, suggest the likely next task's context.
 */
export function taskTrajectory(completedTask: string): AwarenessSignal {
  const trajectories: Record<string, { files: string[]; keys: string[] }> = {
    "login": { files: ["registration", "signup", "auth"], keys: ["auth-flow", "user-creation"] },
    "registration": { files: ["email-verification", "welcome"], keys: ["onboarding"] },
    "api-endpoint": { files: ["test", "middleware", "validation"], keys: ["api-design"] },
    "database-schema": { files: ["migration", "seed", "model"], keys: ["data-model"] },
    "component": { files: ["test", "story", "style"], keys: ["ui-design"] },
    "deploy": { files: ["ci", "docker", "env"], keys: ["deployment", "infrastructure"] },
  };

  const lower = completedTask.toLowerCase();
  for (const [keyword, suggestions] of Object.entries(trajectories)) {
    if (lower.includes(keyword)) {
      return {
        type: "task-trajectory",
        source: completedTask,
        suggestedFiles: suggestions.files,
        suggestedMemoryKeys: suggestions.keys,
        confidence: 0.6,
        reason: `After "${keyword}" tasks, users typically work on: ${suggestions.files.join(", ")}`,
      };
    }
  }

  return {
    type: "task-trajectory",
    source: completedTask,
    suggestedFiles: [],
    suggestedMemoryKeys: [],
    confidence: 0.2,
    reason: "No trajectory pattern matched",
  };
}

/**
 * Git activity signal: detect recently changed files from git status.
 */
export function gitActivity(workspaceDir: string): AwarenessSignal {
  const gitDir = join(workspaceDir, ".git");
  if (!existsSync(gitDir)) {
    return {
      type: "git-activity",
      source: workspaceDir,
      suggestedFiles: [],
      suggestedMemoryKeys: [],
      confidence: 0,
      reason: "No git repository found",
    };
  }

  // Read MERGE_HEAD, REBASE_HEAD, etc. to detect in-progress operations
  const suggestedKeys: string[] = [];
  if (existsSync(join(gitDir, "MERGE_HEAD"))) {
    suggestedKeys.push("merge-conflict-resolution");
  }
  if (existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"))) {
    suggestedKeys.push("rebase-workflow");
  }

  return {
    type: "git-activity",
    source: workspaceDir,
    suggestedFiles: [],
    suggestedMemoryKeys: suggestedKeys,
    confidence: suggestedKeys.length > 0 ? 0.9 : 0.3,
    reason: suggestedKeys.length > 0
      ? `Git operations in progress: ${suggestedKeys.join(", ")}`
      : "No active git operations detected",
  };
}

/**
 * Time pattern signal: infer work context from time of day.
 * Morning = review/planning, afternoon = deep work, evening = documentation.
 */
export function timePattern(): AwarenessSignal {
  const hour = new Date().getHours();
  let context: string;
  let suggestedKeys: string[];

  if (hour >= 6 && hour < 10) {
    context = "morning session -- review and planning phase";
    suggestedKeys = ["daily-standup", "pr-review", "planning"];
  } else if (hour >= 10 && hour < 17) {
    context = "afternoon session -- deep work phase";
    suggestedKeys = ["implementation", "debugging"];
  } else if (hour >= 17 && hour < 22) {
    context = "evening session -- documentation and wrap-up";
    suggestedKeys = ["documentation", "cleanup"];
  } else {
    context = "late session -- quick fixes or exploration";
    suggestedKeys = ["exploration"];
  }

  return {
    type: "time-pattern",
    source: `hour-${hour}`,
    suggestedFiles: [],
    suggestedMemoryKeys: suggestedKeys,
    confidence: 0.4,
    reason: context,
  };
}

/**
 * Compile ambient context from multiple signals.
 */
export function compileAmbientContext(
  currentFile: string | undefined,
  completedTask: string | undefined,
  workspaceDir: string,
): AmbientContext {
  const signals: AwarenessSignal[] = [];

  if (currentFile) {
    signals.push(fileProximity(currentFile, workspaceDir));
  }

  if (completedTask) {
    signals.push(taskTrajectory(completedTask));
  }

  // Only add supplementary signals when there is primary context
  if (currentFile || completedTask) {
    // Git activity signal
    signals.push(gitActivity(workspaceDir));

    // Time pattern signal
    signals.push(timePattern());
  }

  // Deduplicate suggested files
  const allFiles = new Set<string>();
  const allKeys = new Set<string>();
  for (const signal of signals) {
    for (const f of signal.suggestedFiles) allFiles.add(f);
    for (const k of signal.suggestedMemoryKeys) allKeys.add(k);
  }

  return {
    signals,
    preloadedFiles: [...allFiles],
    preloadedMemoryKeys: [...allKeys],
    generatedAt: Date.now(),
  };
}

// ── Ambient Desktop Intelligence ─────────────────────────

// Patterns that indicate an error was pasted or output from a terminal
const ERROR_PATTERNS: readonly RegExp[] = [
  /\b(error|exception|traceback|panic|fatal|failed|ENOENT|EACCES|EPERM)\b/i,
  /at\s+\S+\s*\(\S+:\d+:\d+\)/,    // JS stack trace
  /File\s+"[^"]+",\s+line\s+\d+/,   // Python traceback
  /^\s*\^/m,                          // Caret pointing to error position
];

// Patterns that indicate a file path was copied
const FILE_PATH_PATTERNS: readonly RegExp[] = [
  /^[~/.][\w/\\.-]+\.\w{1,10}$/m,
  /^[A-Z]:\\[\w\\.-]+\.\w{1,10}$/m,
];

function scoreRelevanceForContent(content: string): number {
  const trimmed = content.trim();
  if (trimmed.length === 0) return 0;

  // Errors are highly relevant
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(trimmed)) return 0.9;
  }

  // File paths are moderately relevant
  for (const pattern of FILE_PATH_PATTERNS) {
    if (pattern.test(trimmed)) return 0.6;
  }

  // Code snippets are somewhat relevant
  if (/[{};()=>]/.test(trimmed) && trimmed.length > 20) return 0.5;

  // Short text is less likely to be relevant
  if (trimmed.length < 10) return 0.1;

  return 0.3;
}

function buildSuggestion(signal: AmbientSignal): string | null {
  const { type, content } = signal;
  const trimmed = content.trim();

  if (type === "clipboard-change") {
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(trimmed)) {
        const firstLine = trimmed.split("\n")[0] ?? trimmed;
        return `I noticed you copied an error: "${firstLine.slice(0, 80)}" -- want me to investigate?`;
      }
    }
    for (const pattern of FILE_PATH_PATTERNS) {
      if (pattern.test(trimmed)) {
        return `I noticed you copied a file path: "${trimmed.slice(0, 100)}" -- want me to open it?`;
      }
    }
  }

  if (type === "file-save") {
    return `File saved: "${trimmed.slice(0, 100)}" -- want me to check for issues?`;
  }

  if (type === "terminal-output") {
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(trimmed)) {
        const firstLine = trimmed.split("\n")[0] ?? trimmed;
        return `Terminal error detected: "${firstLine.slice(0, 80)}" -- want me to help fix it?`;
      }
    }
  }

  return null;
}

/**
 * Ambient Desktop Intelligence engine.
 *
 * Collects signals from clipboard changes, file saves, and terminal output.
 * Provides proactive suggestions based on recent signals. Opt-in via Settings.
 */
export class AmbientAwareness {
  private readonly signals: AmbientSignal[] = [];
  private readonly maxSignals: number;
  private readonly signalTtlMs: number;

  constructor(options?: { maxSignals?: number; signalTtlMs?: number }) {
    this.maxSignals = options?.maxSignals ?? 100;
    this.signalTtlMs = options?.signalTtlMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Record a clipboard change event.
   */
  recordClipboardChange(content: string): AmbientSignal {
    return this.addSignal("clipboard-change", content);
  }

  /**
   * Record a file save event.
   */
  recordFileSave(filePath: string): AmbientSignal {
    return this.addSignal("file-save", filePath);
  }

  /**
   * Record terminal output.
   */
  recordTerminalOutput(output: string): AmbientSignal {
    return this.addSignal("terminal-output", output);
  }

  /**
   * Get a proactive suggestion based on recent signals, or null
   * if nothing relevant has been detected.
   *
   * Examines signals from most recent to oldest. Returns the first
   * suggestion that meets the relevance threshold.
   */
  getProactiveSuggestion(): string | null {
    this.pruneStale();

    const recentFirst = [...this.signals].reverse();

    for (const signal of recentFirst) {
      if (signal.relevance < 0.5) continue;

      const suggestion = buildSuggestion(signal);
      if (suggestion !== null) return suggestion;
    }

    return null;
  }

  /**
   * Get all recorded signals (most recent first), optionally filtered by type.
   */
  getSignals(type?: AmbientSignalType): readonly AmbientSignal[] {
    this.pruneStale();
    const filtered = type
      ? this.signals.filter((s) => s.type === type)
      : this.signals;
    return [...filtered].reverse();
  }

  /**
   * Get the total number of signals currently tracked.
   */
  getSignalCount(): number {
    this.pruneStale();
    return this.signals.length;
  }

  /**
   * Clear all recorded signals.
   */
  clear(): void {
    this.signals.splice(0, this.signals.length);
  }

  private addSignal(type: AmbientSignalType, content: string): AmbientSignal {
    const signal: AmbientSignal = {
      type,
      content,
      timestamp: Date.now(),
      relevance: scoreRelevanceForContent(content),
    };

    this.signals.push(signal);

    // Evict oldest signals when over capacity
    while (this.signals.length > this.maxSignals) {
      this.signals.shift();
    }

    return signal;
  }

  private pruneStale(): void {
    const cutoff = Date.now() - this.signalTtlMs;
    while (this.signals.length > 0 && (this.signals[0]?.timestamp ?? 0) < cutoff) {
      this.signals.shift();
    }
  }
}
