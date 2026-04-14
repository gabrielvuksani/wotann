/**
 * Flow Tracker — Windsurf Cascade-inspired real-time action tracking.
 *
 * Tracks all user/agent actions to infer intent without re-explanation.
 * "I see you just ran tests and they failed — let me look at the error."
 */

// ── Types ────────────────────────────────────────────────

export type ActionType =
  | "file_edit"
  | "file_read"
  | "file_create"
  | "file_delete"
  | "terminal_command"
  | "terminal_output"
  | "git_commit"
  | "git_push"
  | "git_branch"
  | "git_checkout"
  | "test_run"
  | "test_pass"
  | "test_fail"
  | "build_start"
  | "build_success"
  | "build_fail"
  | "navigation"
  | "clipboard_copy"
  | "clipboard_paste"
  | "query_sent"
  | "response_received";

export interface TrackedAction {
  readonly type: ActionType;
  readonly timestamp: number;
  readonly details: Record<string, unknown>;
  readonly file?: string;
  readonly command?: string;
  readonly success?: boolean;
}

export interface FlowInsight {
  readonly type: "intent" | "context" | "suggestion" | "warning";
  readonly message: string;
  readonly confidence: number;
  readonly relatedFiles: readonly string[];
}

export interface FlowState {
  readonly currentTask: string;
  readonly recentFiles: readonly string[];
  readonly isDebugging: boolean;
  readonly isBuilding: boolean;
  readonly isTesting: boolean;
  readonly lastError?: string;
  readonly actionCount: number;
}

// ── Flow Tracker ─────────────────────────────────────────

export class FlowTracker {
  private readonly actions: TrackedAction[] = [];
  private readonly maxHistory = 100;

  /**
   * Record an action.
   */
  track(action: TrackedAction): void {
    this.actions.push(action);
    if (this.actions.length > this.maxHistory) {
      this.actions.splice(0, this.actions.length - this.maxHistory);
    }
  }

  /**
   * Get insights about the current flow.
   */
  getInsights(): readonly FlowInsight[] {
    const insights: FlowInsight[] = [];
    const recent = this.actions.slice(-10);

    // Detect test failure → debugging flow
    const lastTestFail = recent.slice().reverse().find((a: TrackedAction) => a.type === "test_fail");
    if (lastTestFail) {
      insights.push({
        type: "intent",
        message: "You seem to be debugging a test failure",
        confidence: 0.9,
        relatedFiles: recent.filter((a) => a.file).map((a) => a.file!),
      });
    }

    // Detect build failure
    const lastBuildFail = recent.slice().reverse().find((a: TrackedAction) => a.type === "build_fail");
    if (lastBuildFail) {
      insights.push({
        type: "context",
        message: "Build is failing — should I check the errors?",
        confidence: 0.85,
        relatedFiles: [],
      });
    }

    // Detect repeated file edits (same file edited 3+ times)
    const fileCounts = new Map<string, number>();
    for (const action of recent) {
      if (action.type === "file_edit" && action.file) {
        fileCounts.set(action.file, (fileCounts.get(action.file) ?? 0) + 1);
      }
    }
    for (const [file, count] of fileCounts) {
      if (count >= 3) {
        insights.push({
          type: "suggestion",
          message: `You've edited ${file} ${count} times recently. Consider running tests to verify.`,
          confidence: 0.7,
          relatedFiles: [file],
        });
      }
    }

    // Detect clipboard paste after error
    const lastPaste = recent.slice().reverse().find((a: TrackedAction) => a.type === "clipboard_paste");
    const lastError = recent.slice().reverse().find((a: TrackedAction) =>
      a.type === "test_fail" || a.type === "build_fail" || a.type === "terminal_output",
    );
    if (lastPaste && lastError && lastPaste.timestamp > lastError.timestamp) {
      insights.push({
        type: "context",
        message: "You pasted something after an error — is this related to the issue?",
        confidence: 0.6,
        relatedFiles: [],
      });
    }

    return insights;
  }

  /**
   * Get the current flow state.
   */
  getState(): FlowState {
    const recent = this.actions.slice(-20);
    const recentFiles = [...new Set(recent.filter((a) => a.file).map((a) => a.file!))].slice(-5);

    return {
      currentTask: this.inferCurrentTask(recent),
      recentFiles,
      isDebugging: recent.some((a) => a.type === "test_fail" || a.type === "build_fail"),
      isBuilding: recent.some((a) => a.type === "build_start" && !recent.some((b) => b.type === "build_success" && b.timestamp > a.timestamp)),
      isTesting: recent.some((a) => a.type === "test_run" && !recent.some((b) => (b.type === "test_pass" || b.type === "test_fail") && b.timestamp > a.timestamp)),
      lastError: recent.slice().reverse().find((a: TrackedAction) => a.type === "test_fail" || a.type === "build_fail")?.command,
      actionCount: this.actions.length,
    };
  }

  /**
   * Get context for system prompt injection.
   */
  getPromptContext(): string {
    const state = this.getState();
    const parts: string[] = [];

    if (state.recentFiles.length > 0) {
      parts.push(`Recently active files: ${state.recentFiles.join(", ")}`);
    }
    if (state.isDebugging) {
      parts.push("User is currently debugging");
    }
    if (state.lastError) {
      parts.push(`Last error: ${state.lastError}`);
    }
    if (state.currentTask) {
      parts.push(`Current task: ${state.currentTask}`);
    }

    return parts.join(". ");
  }

  /**
   * Reset the tracker.
   */
  reset(): void {
    this.actions.length = 0;
  }

  /**
   * Get all tracked actions (readonly).
   */
  getActions(): readonly TrackedAction[] {
    return [...this.actions];
  }

  /**
   * Detect rapid error-fix cycles (sign of struggling).
   * Returns true if 3+ error/fix pairs in the last 10 actions.
   */
  detectStruggle(): boolean {
    const recent = this.actions.slice(-10);
    let errorFixPairs = 0;
    for (let i = 0; i < recent.length - 1; i++) {
      const current = recent[i]!;
      const next = recent[i + 1]!;
      const isError = current.type === "test_fail" || current.type === "build_fail";
      const isFix = next.type === "file_edit";
      if (isError && isFix) errorFixPairs++;
    }
    return errorFixPairs >= 3;
  }

  /**
   * Detect git workflow signals (commit frequency, branch switches).
   */
  getGitSignals(): { readonly commits: number; readonly branchSwitches: number } {
    let commits = 0;
    let branchSwitches = 0;
    for (const action of this.actions) {
      if (action.type === "git_commit") commits++;
      if (action.type === "git_checkout" || action.type === "git_branch") branchSwitches++;
    }
    return { commits, branchSwitches };
  }

  /**
   * Get files with the most edit activity (hotspots).
   */
  getHotspots(limit: number = 5): readonly { file: string; edits: number }[] {
    const counts = new Map<string, number>();
    for (const action of this.actions) {
      if (action.type === "file_edit" && action.file) {
        counts.set(action.file, (counts.get(action.file) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([file, edits]) => ({ file, edits }))
      .sort((a, b) => b.edits - a.edits)
      .slice(0, limit);
  }

  /**
   * Calculate session velocity: actions per minute.
   */
  getVelocity(): number {
    if (this.actions.length < 2) return 0;
    const first = this.actions[0]!;
    const last = this.actions[this.actions.length - 1]!;
    const durationMinutes = (last.timestamp - first.timestamp) / 60_000;
    if (durationMinutes <= 0) return 0;
    return this.actions.length / durationMinutes;
  }

  // ── Private ────────────────────────────────────────────

  private inferCurrentTask(recent: readonly TrackedAction[]): string {
    // Look at the most recent query for task context
    const lastQuery = recent.slice().reverse().find((a: TrackedAction) => a.type === "query_sent");
    if (lastQuery?.command) return lastQuery.command.slice(0, 100);

    // Infer from actions
    if (recent.some((a) => a.type === "test_fail")) return "Debugging test failure";
    if (recent.some((a) => a.type === "build_fail")) return "Fixing build error";
    if (recent.some((a) => a.type === "file_create")) return "Creating new files";
    if (recent.some((a) => a.type === "file_edit")) return "Editing code";

    return "";
  }
}
