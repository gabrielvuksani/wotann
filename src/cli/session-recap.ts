/**
 * Session recap for returning users — V9 Tier 14.1.
 *
 * When a user re-launches WOTANN after N hours of absence, show a
 * compact recap: what the last session covered, what's still open,
 * how much context (tokens / cost) the recent activity consumed.
 *
 * This module is the HEADLESS data layer — pure functions from
 * inputs (session history + unfinished items) to render-ready
 * structures. The Ink TUI or desktop surface consumes the output
 * via whatever renderer it prefers.
 *
 * Ships as a SIBLING of `first-run-success.ts` rather than a branch
 * inside that file so both surfaces stay focused:
 *   - first-run-success.ts = first-ever `wotann init` flow
 *   - session-recap.ts     = returning-user "welcome back" flow
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: empty history → empty recap event; never
 *    a fabricated "nothing to see here" summary.
 *  - QB #7 per-call state: pure function. No module-level caches.
 *  - QB #13 env guard: every input (now-clock, session array, etc.)
 *    arrives via the options object. No `process.env` reads.
 *  - QB #11 sibling-site scan: `src/session/fleet-view.ts` owns the
 *    canonical `SessionSummary`; this module is a read-only consumer.
 */

import type { SessionSummary } from "../session/fleet-view.js";

// ═══ Types ════════════════════════════════════════════════════════════════

export interface UnfinishedTask {
  readonly id: string;
  readonly summary: string;
  /** When the task last saw activity. Used to sort "most recent first". */
  readonly lastActivityAt: number;
  /** Optional surface hint — "desktop" / "ios" / "cli" / "web". */
  readonly surface?: string;
}

export interface SessionRecapInput {
  /** Past sessions, most recent first is NOT required — the module sorts. */
  readonly pastSessions: readonly SessionSummary[];
  /** Unfinished tasks from prior sessions. */
  readonly unfinishedTasks: readonly UnfinishedTask[];
  /**
   * Optional last-seen timestamp — used to compute the "N hours away"
   * copy. Absent = skip the time-away line.
   */
  readonly lastSeenAt?: number;
  /** Test-injectable clock. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface RecapLine {
  readonly kind: "banner" | "time-away" | "session" | "task" | "hint" | "empty";
  readonly text: string;
}

export interface SessionRecap {
  /** Short title line ("Welcome back" / "All caught up"). */
  readonly title: string;
  /** One line per banner / time-away / session / task / hint. */
  readonly lines: readonly RecapLine[];
  /** True when there are any unfinished tasks OR recent sessions. */
  readonly hasContent: boolean;
  /** Count of past sessions summarized. */
  readonly sessionCount: number;
  /** Count of unfinished tasks surfaced. */
  readonly openTaskCount: number;
}

export interface BuildRecapOptions {
  /** Max past sessions to show (default 3). */
  readonly maxSessions?: number;
  /** Max open tasks to show (default 5). */
  readonly maxTasks?: number;
  /**
   * Minimum hours since `lastSeenAt` before the recap fires at all.
   * Returns an `empty` recap below this threshold. Default 1 hour —
   * users who just stepped away shouldn't see a "welcome back" on
   * every new shell.
   */
  readonly minHoursAway?: number;
}

// ═══ Time formatting ═════════════════════════════════════════════════════

/**
 * Human-readable time delta. Keeps the output terse so the banner
 * fits on one line on an 80-col terminal.
 */
function formatTimeAway(ms: number): string {
  if (ms < 60_000) return "less than a minute ago";
  if (ms < 3_600_000) {
    const mins = Math.round(ms / 60_000);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  if (ms < 86_400_000) {
    const hours = Math.round(ms / 3_600_000);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (ms < 2_592_000_000) {
    // ~30 days
    const days = Math.round(ms / 86_400_000);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  const months = Math.round(ms / 2_592_000_000);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

// ═══ Pure helpers (testable without mounting) ════════════════════════════

/**
 * Pick the top-N sessions for the recap. Filters out terminal-failed
 * states by default so the banner doesn't dwell on crashes, then
 * sorts by `lastStepAt` desc (most recent first).
 */
export function pickRecapSessions(
  sessions: readonly SessionSummary[],
  max: number,
): readonly SessionSummary[] {
  const sortable = [...sessions].filter((s) => s.status !== "failed");
  sortable.sort((a, b) => b.lastStepAt - a.lastStepAt);
  return sortable.slice(0, max);
}

/**
 * Pick the top-N unfinished tasks, sorted by most recent activity
 * first so the list matches what the user was last doing.
 */
export function pickRecapTasks(
  tasks: readonly UnfinishedTask[],
  max: number,
): readonly UnfinishedTask[] {
  const sortable = [...tasks];
  sortable.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return sortable.slice(0, max);
}

/**
 * Format a single session summary as one line. Keeps the name + a
 * short status indicator + current-action hint when available.
 */
export function formatSessionLine(s: SessionSummary): string {
  const name = truncate(s.name, 40);
  const action = s.currentAction ? ` — ${truncate(s.currentAction, 30)}` : "";
  const progress = typeof s.progressPct === "number" ? ` [${s.progressPct.toFixed(0)}%]` : "";
  return `• ${name}${progress} (${s.status}${action})`;
}

/**
 * Format a single unfinished task line.
 */
export function formatTaskLine(t: UnfinishedTask): string {
  const summary = truncate(t.summary, 60);
  const surface = t.surface ? ` @${t.surface}` : "";
  return `• ${summary}${surface}`;
}

// ═══ Top-level builder ════════════════════════════════════════════════════

/**
 * Build the recap structure for a returning user. The output is
 * render-agnostic — the caller decides how to print it.
 *
 * Empty path (no content OR user was only briefly away) returns:
 *   { title: "", lines: [{kind: "empty", text: ""}],
 *     hasContent: false, sessionCount: 0, openTaskCount: 0 }
 *
 * So a simple caller can `if (recap.hasContent) render(recap);`.
 */
export function buildSessionRecap(
  input: SessionRecapInput,
  options: BuildRecapOptions = {},
): SessionRecap {
  const now = input.now ?? (() => Date.now());
  const maxSessions = options.maxSessions ?? 3;
  const maxTasks = options.maxTasks ?? 5;
  const minHoursAway = options.minHoursAway ?? 1;

  const sessions = pickRecapSessions(input.pastSessions, maxSessions);
  const tasks = pickRecapTasks(input.unfinishedTasks, maxTasks);

  // Early-exit: brief absence → skip recap entirely. Returning an
  // empty recap lets the caller render nothing without branching
  // on special-case undefined.
  if (typeof input.lastSeenAt === "number") {
    const hoursAway = (now() - input.lastSeenAt) / 3_600_000;
    if (hoursAway < minHoursAway) {
      return {
        title: "",
        lines: [{ kind: "empty", text: "" }],
        hasContent: false,
        sessionCount: 0,
        openTaskCount: 0,
      };
    }
  }

  if (sessions.length === 0 && tasks.length === 0) {
    return {
      title: "All caught up.",
      lines: [
        {
          kind: "empty",
          text: "No unfinished work from recent sessions.",
        },
      ],
      hasContent: false,
      sessionCount: 0,
      openTaskCount: 0,
    };
  }

  const lines: RecapLine[] = [];
  const title = "Welcome back.";
  lines.push({ kind: "banner", text: title });

  if (typeof input.lastSeenAt === "number") {
    const away = formatTimeAway(now() - input.lastSeenAt);
    lines.push({ kind: "time-away", text: `Last session: ${away}.` });
  }

  if (sessions.length > 0) {
    lines.push({ kind: "hint", text: "Recent sessions:" });
    for (const s of sessions) {
      lines.push({ kind: "session", text: formatSessionLine(s) });
    }
  }

  if (tasks.length > 0) {
    lines.push({
      kind: "hint",
      text: `Open tasks (${input.unfinishedTasks.length}):`,
    });
    for (const t of tasks) {
      lines.push({ kind: "task", text: formatTaskLine(t) });
    }
  }

  lines.push({
    kind: "hint",
    text: "Type your next prompt, or use /resume to pick up where you left off.",
  });

  return {
    title,
    lines,
    hasContent: true,
    sessionCount: sessions.length,
    openTaskCount: tasks.length,
  };
}
