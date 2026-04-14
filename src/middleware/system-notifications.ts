/**
 * System Notifications Tier -- dynamic guidance injected at the TAIL of context.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Information at the end of the context window gets disproportionate
 *  attention due to recency bias. Placing dynamic guidance AFTER the
 *  last user message exploits this for 3-5% accuracy gains."
 *
 * This middleware injects a "system notification" block after the last
 * user message with:
 * 1. Current plan status (if a plan exists)
 * 2. Files modified this session (so the agent remembers what it changed)
 * 3. Recent errors (so the agent doesn't repeat them)
 * 4. Verification reminders (what still needs to be checked)
 *
 * This is SEPARATE from the system prompt (which gets buried in long
 * conversations and suffers from "lost in the middle" effect).
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// ── Notification Types ─────────────────────────────────────

export interface NotificationEntry {
  readonly category: NotificationCategory;
  readonly message: string;
  readonly priority: "high" | "medium" | "low";
  readonly timestamp: number;
}

export type NotificationCategory =
  | "plan-status"
  | "files-modified"
  | "recent-errors"
  | "verification-reminder"
  | "context-warning"
  | "custom";

// ── Session Tracker ────────────────────────────────────────

/**
 * Tracks session-level state for generating notifications.
 * All state is immutably returned via getters.
 */
export class SystemNotificationTracker {
  private modifiedFiles: Set<string> = new Set();
  private recentErrors: Array<{ readonly message: string; readonly turn: number }> = [];
  private planExists = false;
  private planSteps: readonly string[] = [];
  private completedSteps: Set<number> = new Set();
  private currentTurn = 0;
  private verificationsPending: string[] = [];
  private lastNotificationTurn = 0;

  /** Maximum number of recent errors to track. */
  private static readonly MAX_RECENT_ERRORS = 5;

  /** How often to inject notifications (every N turns). */
  private static readonly INJECTION_INTERVAL = 3;

  // ── State Updates ──────────────────────────────────────

  recordFileModification(filePath: string): void {
    this.modifiedFiles.add(filePath);
  }

  recordError(message: string): void {
    this.recentErrors.push({ message: message.slice(0, 200), turn: this.currentTurn });
    // Keep only the most recent errors
    if (this.recentErrors.length > SystemNotificationTracker.MAX_RECENT_ERRORS) {
      this.recentErrors = this.recentErrors.slice(-SystemNotificationTracker.MAX_RECENT_ERRORS);
    }
  }

  recordPlan(steps: readonly string[]): void {
    this.planExists = true;
    this.planSteps = steps;
    this.completedSteps.clear();
  }

  recordStepCompleted(stepIndex: number): void {
    this.completedSteps.add(stepIndex);
  }

  addVerificationReminder(reminder: string): void {
    if (!this.verificationsPending.includes(reminder)) {
      this.verificationsPending.push(reminder);
    }
  }

  clearVerificationReminder(reminder: string): void {
    this.verificationsPending = this.verificationsPending.filter((r) => r !== reminder);
  }

  advanceTurn(): void {
    this.currentTurn++;
  }

  getCurrentTurn(): number {
    return this.currentTurn;
  }

  // ── Notification Generation ────────────────────────────

  /**
   * Check if notifications should be injected this turn.
   * Injects every N turns to avoid noise, but always injects
   * when there are high-priority items.
   */
  shouldInject(): boolean {
    const hasHighPriority =
      this.recentErrors.length > 0 ||
      this.verificationsPending.length > 0;

    if (hasHighPriority) return true;

    return (this.currentTurn - this.lastNotificationTurn) >= SystemNotificationTracker.INJECTION_INTERVAL;
  }

  /**
   * Build the notification block for injection.
   * Returns null if there's nothing worth injecting.
   */
  buildNotificationBlock(): string | null {
    const entries = this.gatherNotifications();
    if (entries.length === 0) return null;

    this.lastNotificationTurn = this.currentTurn;

    const lines: string[] = [
      "",
      "--- SYSTEM NOTIFICATIONS (read carefully) ---",
    ];

    // Group by category for readability
    const grouped = groupByCategory(entries);

    for (const [category, items] of grouped) {
      lines.push("");
      lines.push(`[${formatCategory(category)}]`);
      for (const item of items) {
        const prefix = item.priority === "high" ? "(!)" : item.priority === "medium" ? "(*)" : "-";
        lines.push(`  ${prefix} ${item.message}`);
      }
    }

    lines.push("");
    lines.push("--- END SYSTEM NOTIFICATIONS ---");

    return lines.join("\n");
  }

  /**
   * Gather all active notifications sorted by priority.
   */
  private gatherNotifications(): readonly NotificationEntry[] {
    const entries: NotificationEntry[] = [];
    const now = Date.now();

    // Plan status
    if (this.planExists && this.planSteps.length > 0) {
      const total = this.planSteps.length;
      const completed = this.completedSteps.size;
      const remaining = total - completed;

      if (remaining > 0) {
        const nextStep = this.planSteps.findIndex((_, i) => !this.completedSteps.has(i));
        const nextStepText = nextStep >= 0 ? this.planSteps[nextStep] : "unknown";
        entries.push({
          category: "plan-status",
          message: `Plan progress: ${completed}/${total} steps done. Next: ${nextStepText}`,
          priority: "medium",
          timestamp: now,
        });
      } else {
        entries.push({
          category: "plan-status",
          message: `Plan complete: all ${total} steps done. Verify results before claiming done.`,
          priority: "low",
          timestamp: now,
        });
      }
    }

    // Files modified
    if (this.modifiedFiles.size > 0) {
      const fileList = [...this.modifiedFiles];
      const display = fileList.length <= 5
        ? fileList.join(", ")
        : `${fileList.slice(0, 5).join(", ")} (+${fileList.length - 5} more)`;
      entries.push({
        category: "files-modified",
        message: `Files modified this session: ${display}`,
        priority: "low",
        timestamp: now,
      });
    }

    // Recent errors (high priority -- agent should not repeat them)
    for (const error of this.recentErrors) {
      // Only show errors from last 5 turns
      if (this.currentTurn - error.turn <= 5) {
        entries.push({
          category: "recent-errors",
          message: `Error (turn ${error.turn}): ${error.message}`,
          priority: "high",
          timestamp: now,
        });
      }
    }

    // Verification reminders
    for (const reminder of this.verificationsPending) {
      entries.push({
        category: "verification-reminder",
        message: reminder,
        priority: "high",
        timestamp: now,
      });
    }

    // Context warning: many files modified without verification
    if (this.modifiedFiles.size >= 3 && this.verificationsPending.length === 0) {
      entries.push({
        category: "context-warning",
        message: `${this.modifiedFiles.size} files modified. Run typecheck and tests before claiming done.`,
        priority: "medium",
        timestamp: now,
      });
    }

    // Sort: high priority first, then medium, then low
    return entries.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
  }

  /**
   * Reset all tracked state (for new task within same session).
   */
  reset(): void {
    this.modifiedFiles.clear();
    this.recentErrors = [];
    this.planExists = false;
    this.planSteps = [];
    this.completedSteps.clear();
    this.currentTurn = 0;
    this.verificationsPending = [];
    this.lastNotificationTurn = 0;
  }

  /**
   * Get snapshot of current state (for diagnostics).
   */
  getSnapshot(): SystemNotificationSnapshot {
    return {
      modifiedFileCount: this.modifiedFiles.size,
      recentErrorCount: this.recentErrors.length,
      planExists: this.planExists,
      planProgress: this.planExists
        ? `${this.completedSteps.size}/${this.planSteps.length}`
        : "none",
      pendingVerifications: this.verificationsPending.length,
      currentTurn: this.currentTurn,
    };
  }
}

export interface SystemNotificationSnapshot {
  readonly modifiedFileCount: number;
  readonly recentErrorCount: number;
  readonly planExists: boolean;
  readonly planProgress: string;
  readonly pendingVerifications: number;
  readonly currentTurn: number;
}

// ── Helpers ────────────────────────────────────────────────

function priorityOrder(priority: "high" | "medium" | "low"): number {
  switch (priority) {
    case "high": return 0;
    case "medium": return 1;
    case "low": return 2;
  }
}

function formatCategory(category: NotificationCategory): string {
  switch (category) {
    case "plan-status": return "Plan Status";
    case "files-modified": return "Files Modified";
    case "recent-errors": return "Recent Errors";
    case "verification-reminder": return "Verification Required";
    case "context-warning": return "Warning";
    case "custom": return "Notice";
  }
}

function groupByCategory(
  entries: readonly NotificationEntry[],
): ReadonlyMap<NotificationCategory, readonly NotificationEntry[]> {
  const grouped = new Map<NotificationCategory, NotificationEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.category) ?? [];
    grouped.set(entry.category, [...existing, entry]);
  }
  return grouped;
}

// ── Pipeline Middleware Adapter ─────────────────────────────

/**
 * Create a Middleware adapter that integrates SystemNotificationTracker
 * into the middleware pipeline.
 *
 * - `before`: advances turn counter and tracks context
 * - `after`: tracks file modifications, errors, and injects notifications
 */
export function createSystemNotificationsMiddleware(
  tracker: SystemNotificationTracker,
): Middleware {
  return {
    name: "SystemNotifications",
    order: 18, // After PreCompletionChecklist (17)
    before(ctx: MiddlewareContext): MiddlewareContext {
      tracker.advanceTurn();

      // If notifications should be injected, build and append to user message
      if (tracker.shouldInject()) {
        const block = tracker.buildNotificationBlock();
        if (block) {
          return {
            ...ctx,
            userMessage: `${ctx.userMessage}${block}`,
          };
        }
      }

      return ctx;
    },
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      // Track file modifications
      if ((result.toolName === "Write" || result.toolName === "Edit") && result.filePath) {
        tracker.recordFileModification(result.filePath);
      }

      // Track errors
      if (!result.success && result.content) {
        tracker.recordError(result.content.slice(0, 200));
      }

      return result;
    },
  };
}
