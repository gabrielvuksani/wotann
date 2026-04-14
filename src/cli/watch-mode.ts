/**
 * Watch Mode — `wotann watch src/ "fix any TS errors"`.
 *
 * Monitors a directory for file changes using fs.watch (recursive),
 * debounces rapid changes, collects the set of changed files, and
 * invokes the task callback with context about what changed.
 *
 * Design:
 * - Immutable WatchOptions and WatchEvent objects
 * - Debounce prevents re-running on save-flurries (IDE auto-format, etc.)
 * - Ignore patterns filter out node_modules, .git, dist by default
 * - Graceful stop cleans up the watcher and pending timers
 */

import { watch, existsSync, statSync, readFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import type { FSWatcher } from "node:fs";

// ── Types ────────────────────────────────────────────────

export interface WatchOptions {
  readonly path: string;
  readonly task: string;
  readonly debounceMs?: number;
  readonly ignorePatterns?: readonly string[];
}

export interface WatchEvent {
  readonly changedFiles: readonly string[];
  readonly task: string;
  readonly timestamp: number;
}

export interface AIComment {
  readonly file: string;
  readonly line: number;
  readonly instruction: string;
}

export interface WatchEventWithAI extends WatchEvent {
  readonly aiComments: readonly AIComment[];
}

export type WatchTaskRunner = (event: WatchEvent) => Promise<void>;

// ── Constants ────────────────────────────────────────────

const DEFAULT_DEBOUNCE_MS = 2_000;

const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  ".wotann",
  ".DS_Store",
  "*.swp",
  "*.swo",
  "*~",
];

// ── AI Comment Detection ────────────────────────────────

/** Pattern matching `// AI: <instruction>` comments in source files. */
const AI_COMMENT_PATTERN = /\/\/\s*AI:\s*(.+)/;

/**
 * Scan file content for `// AI:` comment markers.
 * Returns an immutable array of detected comments with their line numbers.
 */
function detectAIComments(content: string, filePath: string): readonly AIComment[] {
  const comments: AIComment[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = AI_COMMENT_PATTERN.exec(lines[i] ?? "");
    if (match?.[1]) {
      comments.push({
        file: filePath,
        line: i + 1,
        instruction: match[1].trim(),
      });
    }
  }
  return comments;
}

/**
 * Read a file and extract all AI comments. Returns an empty array on
 * read failure (file deleted between event and read, binary file, etc.).
 */
function extractAICommentsFromFile(absolutePath: string, relPath: string): readonly AIComment[] {
  try {
    if (!existsSync(absolutePath)) return [];
    const stat = statSync(absolutePath);
    // Skip large files (>1 MB) and directories
    if (stat.isDirectory() || stat.size > 1_048_576) return [];
    const content = readFileSync(absolutePath, "utf8");
    return detectAIComments(content, relPath);
  } catch {
    return [];
  }
}

// ── Ignore Matcher ───────────────────────────────────────

/**
 * Check if a file path matches any ignore pattern.
 * Supports directory names and simple glob patterns (*.ext).
 */
function shouldIgnore(filePath: string, patterns: readonly string[]): boolean {
  const segments = filePath.split("/");
  for (const pattern of patterns) {
    // Directory name match
    if (!pattern.includes("*")) {
      if (segments.some((seg) => seg === pattern)) return true;
      continue;
    }

    // Simple glob: *.ext
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1); // ".ext"
      const fileName = segments[segments.length - 1] ?? "";
      if (fileName.endsWith(ext)) return true;
    }
  }
  return false;
}

// ── Watch Mode ───────────────────────────────────────────

export class WatchMode {
  private readonly options: Required<Pick<WatchOptions, "path" | "task" | "debounceMs">> & {
    readonly ignorePatterns: readonly string[];
  };
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: Set<string> = new Set();
  private running = false;
  private taskInProgress = false;
  private taskRunner: WatchTaskRunner | null = null;
  private runCount = 0;

  constructor(options: WatchOptions) {
    this.options = {
      path: resolve(options.path),
      task: options.task,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      ignorePatterns: options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS,
    };
  }

  /**
   * Start watching the directory for changes.
   * The taskRunner is called with change context after debounce settles.
   */
  start(taskRunner: WatchTaskRunner): void {
    if (this.running) return;

    if (!existsSync(this.options.path)) {
      throw new Error(`Watch path does not exist: ${this.options.path}`);
    }

    const stat = statSync(this.options.path);
    if (!stat.isDirectory()) {
      throw new Error(`Watch path is not a directory: ${this.options.path}`);
    }

    this.taskRunner = taskRunner;
    this.running = true;
    this.runCount = 0;

    this.watcher = watch(
      this.options.path,
      { recursive: true },
      (_eventType, filename) => {
        if (filename) {
          this.handleChange(filename);
        }
      },
    );

    this.watcher.on("error", () => {
      // Watcher errors (e.g., too many files) — stop gracefully
      this.stop();
    });
  }

  /**
   * Stop watching and clean up all resources.
   */
  stop(): void {
    this.running = false;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }

    this.pendingChanges.clear();
    this.taskRunner = null;
  }

  /**
   * Whether the watcher is currently active.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * How many task runs have completed since start.
   */
  getRunCount(): number {
    return this.runCount;
  }

  // ── Private ────────────────────────────────────────────

  private handleChange(filename: string): void {
    if (!this.running) return;

    // Build relative path for ignore check
    const relPath = relative(this.options.path, join(this.options.path, filename));

    if (shouldIgnore(relPath, this.options.ignorePatterns)) return;

    this.pendingChanges.add(relPath);

    // Reset debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      void this.flushChanges();
    }, this.options.debounceMs);
  }

  private async flushChanges(): Promise<void> {
    if (!this.running || this.taskInProgress || this.pendingChanges.size === 0) return;

    // Snapshot and clear pending changes
    const changedFiles = [...this.pendingChanges];
    this.pendingChanges.clear();

    // Scan changed files for AI comment markers
    const aiComments: AIComment[] = [];
    for (const relPath of changedFiles) {
      const absPath = join(this.options.path, relPath);
      const fileComments = extractAICommentsFromFile(absPath, relPath);
      for (const comment of fileComments) {
        aiComments.push(comment);
      }
    }

    const event: WatchEventWithAI = {
      changedFiles,
      task: this.options.task,
      timestamp: Date.now(),
      aiComments,
    };

    this.taskInProgress = true;
    try {
      await this.taskRunner?.(event);
      this.runCount++;
    } finally {
      this.taskInProgress = false;
    }
  }
}
