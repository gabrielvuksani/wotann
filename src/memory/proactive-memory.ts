/**
 * Proactive Memory — anticipates necessary context before the user asks.
 *
 * Traditional memory is reactive: you query, it retrieves.
 * Proactive memory watches what the user is doing and pre-loads
 * relevant context before they need it.
 *
 * Triggers:
 * - File opened/modified → load related tests, decisions, known issues
 * - Task started → load similar past episodes, relevant patterns
 * - Error encountered → load known fixes from error history
 * - Mode switched → load mode-specific memory (e.g., review notes in review mode)
 * - Time-based → load recurring reminders, scheduled tasks
 */

export interface ProactiveHint {
  readonly id: string;
  readonly type: "related-file" | "past-episode" | "known-fix" | "pattern" | "reminder" | "decision" | "gotcha";
  readonly content: string;
  readonly relevance: number; // 0-1, higher = more relevant
  readonly source: string;
  readonly trigger: string;
  readonly timestamp: number;
}

export interface ProactiveTrigger {
  readonly type: "file-opened" | "task-started" | "error-encountered" | "mode-switched" | "time-based" | "pattern-detected";
  readonly data: Record<string, string>;
}

export interface ProactiveConfig {
  readonly maxHints: number;
  readonly minRelevance: number;
  readonly enabledTriggers: readonly ProactiveTrigger["type"][];
  readonly suppressAfterShown: number; // Don't repeat for N minutes
}

// ── Known Issue Registry ────────────────────────────────

interface KnownIssue {
  readonly pattern: RegExp;
  readonly fix: string;
  readonly confidence: number;
  readonly source: string;
}

const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    pattern: /Cannot find module.*\.js/,
    fix: "TypeScript ESM issue: check tsconfig.json moduleResolution and file extensions in imports",
    confidence: 0.8,
    source: "common-errors",
  },
  {
    pattern: /ECONNREFUSED.*localhost/,
    fix: "Server not running. Check if the dev server or database is started.",
    confidence: 0.9,
    source: "common-errors",
  },
  {
    pattern: /out of memory|heap limit|ENOMEM/i,
    fix: "Process running out of memory. Increase Node.js heap: NODE_OPTIONS='--max-old-space-size=8192'",
    confidence: 0.85,
    source: "common-errors",
  },
  {
    pattern: /ENOSPC/,
    fix: "Disk full. Check inode usage (df -i) and clean docker images (docker system prune)",
    confidence: 0.9,
    source: "common-errors",
  },
  {
    pattern: /ERR_REQUIRE_ESM/,
    fix: "Trying to require() an ESM-only package. Use dynamic import() or add \"type\": \"module\" to package.json",
    confidence: 0.85,
    source: "common-errors",
  },
];

// ── File Association Map ────────────────────────────────

interface FileAssociation {
  readonly pattern: RegExp;
  readonly relatedPatterns: readonly string[];
  readonly hint: string;
}

const FILE_ASSOCIATIONS: readonly FileAssociation[] = [
  {
    pattern: /\.test\.(ts|tsx|js|jsx)$/,
    relatedPatterns: ["$base.$ext"],
    hint: "Test file — check if the corresponding source file has changed",
  },
  {
    pattern: /\.tsx$/,
    relatedPatterns: ["$name.test.tsx", "$name.module.css", "$name.stories.tsx"],
    hint: "React component — related test, styles, and stories may exist",
  },
  {
    pattern: /routes?\.(ts|js)$/,
    relatedPatterns: ["middleware.*", "controllers/*"],
    hint: "Route file — check middleware and controller implementations",
  },
  {
    pattern: /schema\.(ts|js)$/,
    relatedPatterns: ["migration*", "seed*"],
    hint: "Schema change — check if migration and seeds need updating",
  },
  {
    pattern: /package\.json$/,
    relatedPatterns: ["*.lock", "tsconfig.json"],
    hint: "Package change — run install and check TypeScript config compatibility",
  },
];

// ── Proactive Memory Engine ─────────────────────────────

export class ProactiveMemoryEngine {
  private readonly config: ProactiveConfig;
  private readonly shownHints: Map<string, number> = new Map(); // id → lastShown timestamp
  private readonly hintHistory: ProactiveHint[] = [];
  private readonly customPatterns: Array<{ trigger: RegExp; hint: string; source: string }> = [];

  constructor(config?: Partial<ProactiveConfig>) {
    this.config = {
      maxHints: 3,
      minRelevance: 0.4,
      enabledTriggers: [
        "file-opened",
        "task-started",
        "error-encountered",
        "mode-switched",
        "pattern-detected",
      ],
      suppressAfterShown: 30,
      ...config,
    };
  }

  /**
   * Process a trigger event and return proactive hints.
   */
  processEvent(trigger: ProactiveTrigger): readonly ProactiveHint[] {
    if (!this.config.enabledTriggers.includes(trigger.type)) return [];

    const hints: ProactiveHint[] = [];

    switch (trigger.type) {
      case "file-opened":
        hints.push(...this.onFileOpened(trigger.data["file"] ?? ""));
        break;
      case "error-encountered":
        hints.push(...this.onError(trigger.data["error"] ?? ""));
        break;
      case "task-started":
        hints.push(...this.onTaskStarted(trigger.data["task"] ?? ""));
        break;
      case "mode-switched":
        hints.push(...this.onModeSwitched(trigger.data["mode"] ?? "default"));
        break;
      case "pattern-detected":
        hints.push(...this.onPatternDetected(trigger.data["pattern"] ?? ""));
        break;
    }

    // Filter by relevance and suppress repeats
    const filtered = hints
      .filter((h) => h.relevance >= this.config.minRelevance)
      .filter((h) => !this.isRecentlyShown(h.id))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, this.config.maxHints);

    // Record shown hints
    for (const hint of filtered) {
      this.shownHints.set(hint.id, Date.now());
      this.hintHistory.push(hint);
    }

    return filtered;
  }

  /**
   * Register a custom pattern → hint mapping.
   */
  registerPattern(trigger: RegExp, hint: string, source: string = "custom"): void {
    this.customPatterns.push({ trigger, hint, source });
  }

  /**
   * Get the hint history.
   */
  getHistory(): readonly ProactiveHint[] {
    return [...this.hintHistory];
  }

  // ── Trigger Handlers ──────────────────────────────────

  private onFileOpened(filePath: string): ProactiveHint[] {
    const hints: ProactiveHint[] = [];

    for (const assoc of FILE_ASSOCIATIONS) {
      if (assoc.pattern.test(filePath)) {
        hints.push({
          id: `file-assoc-${filePath}-${assoc.hint.slice(0, 20)}`,
          type: "related-file",
          content: assoc.hint,
          relevance: 0.6,
          source: "file-associations",
          trigger: `file-opened: ${filePath}`,
          timestamp: Date.now(),
        });
      }
    }

    return hints;
  }

  private onError(errorText: string): ProactiveHint[] {
    const hints: ProactiveHint[] = [];

    for (const issue of KNOWN_ISSUES) {
      if (issue.pattern.test(errorText)) {
        hints.push({
          id: `known-fix-${issue.source}-${issue.pattern.source.slice(0, 20)}`,
          type: "known-fix",
          content: issue.fix,
          relevance: issue.confidence,
          source: issue.source,
          trigger: `error: ${errorText.slice(0, 100)}`,
          timestamp: Date.now(),
        });
      }
    }

    // Check custom patterns
    for (const custom of this.customPatterns) {
      if (custom.trigger.test(errorText)) {
        hints.push({
          id: `custom-${custom.source}-${custom.hint.slice(0, 20)}`,
          type: "known-fix",
          content: custom.hint,
          relevance: 0.7,
          source: custom.source,
          trigger: `error-pattern: ${errorText.slice(0, 100)}`,
          timestamp: Date.now(),
        });
      }
    }

    return hints;
  }

  private onTaskStarted(taskDescription: string): ProactiveHint[] {
    const hints: ProactiveHint[] = [];
    const lower = taskDescription.toLowerCase();

    // Security-related task hints
    if (/\b(auth|login|session|token|oauth|jwt)\b/.test(lower)) {
      hints.push({
        id: "task-hint-auth-security",
        type: "gotcha",
        content: "Auth tasks: remember to check token expiration, refresh flow, CSRF protection, and secure cookie settings.",
        relevance: 0.7,
        source: "task-hints",
        trigger: `task-started: ${taskDescription.slice(0, 80)}`,
        timestamp: Date.now(),
      });
    }

    // Database migration hints
    if (/\b(migration|schema|database|table)\b/.test(lower)) {
      hints.push({
        id: "task-hint-migration-safety",
        type: "gotcha",
        content: "Migration tasks: always test rollback, avoid destructive operations on populated tables, use transactions.",
        relevance: 0.7,
        source: "task-hints",
        trigger: `task-started: ${taskDescription.slice(0, 80)}`,
        timestamp: Date.now(),
      });
    }

    // Refactoring hints
    if (/\b(refactor|rename|extract|move)\b/.test(lower)) {
      hints.push({
        id: "task-hint-refactor",
        type: "pattern",
        content: "Before refactoring: search for ALL callers/references, update imports, and run the full test suite after.",
        relevance: 0.6,
        source: "task-hints",
        trigger: `task-started: ${taskDescription.slice(0, 80)}`,
        timestamp: Date.now(),
      });
    }

    return hints;
  }

  private onModeSwitched(mode: string): ProactiveHint[] {
    const hints: ProactiveHint[] = [];

    const modeHints: Record<string, { type: ProactiveHint["type"]; content: string }> = {
      autonomous: {
        type: "reminder",
        content: "Autonomous mode: set clear success criteria, budget limits, and check context pressure regularly.",
      },
      "guardrails-off": {
        type: "gotcha",
        content: "Guardrails-off: hook engine paused, no secret scanning. All actions logged. Remember responsible disclosure.",
      },
      review: {
        type: "pattern",
        content: "Review mode: check for security issues, error handling gaps, test coverage, and immutability violations.",
      },
      plan: {
        type: "pattern",
        content: "Plan mode: read-only. Generate architecture docs, identify risks, estimate scope before coding.",
      },
      focus: {
        type: "reminder",
        content: "Focus mode: only the focused file/directory is editable. All other paths are frozen.",
      },
    };

    const hint = modeHints[mode];
    if (hint) {
      hints.push({
        id: `mode-hint-${mode}`,
        ...hint,
        relevance: 0.8,
        source: "mode-hints",
        trigger: `mode-switched: ${mode}`,
        timestamp: Date.now(),
      });
    }

    return hints;
  }

  private onPatternDetected(pattern: string): ProactiveHint[] {
    const hints: ProactiveHint[] = [];

    for (const custom of this.customPatterns) {
      if (custom.trigger.test(pattern)) {
        hints.push({
          id: `pattern-${custom.source}-${custom.hint.slice(0, 20)}`,
          type: "pattern",
          content: custom.hint,
          relevance: 0.65,
          source: custom.source,
          trigger: `pattern: ${pattern.slice(0, 80)}`,
          timestamp: Date.now(),
        });
      }
    }

    return hints;
  }

  private isRecentlyShown(hintId: string): boolean {
    const lastShown = this.shownHints.get(hintId);
    if (!lastShown) return false;
    const ageMinutes = (Date.now() - lastShown) / 60_000;
    return ageMinutes < this.config.suppressAfterShown;
  }
}
