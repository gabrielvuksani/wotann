/**
 * KAIROS-Exclusive Tools — only available when the daemon is running.
 *
 * These tools extend the daemon's capabilities beyond simple cron jobs:
 *
 * 1. push_notification — Send notifications to registered devices/channels
 * 2. file_delivery — Deliver files across devices via the channel system
 * 3. pr_subscription — Monitor GitHub PRs and notify on state changes
 * 4. repo_monitor — Watch repos for new commits/releases (from source-monitor)
 * 5. health_check — Run periodic health checks on providers and services
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import type { BackgroundTaskStatus } from "../agents/background-agent.js";

// ── Push Notification ────────────────────────────────────────

export interface NotificationOptions {
  readonly title: string;
  readonly body: string;
  readonly urgency?: "low" | "normal" | "critical";
  readonly sound?: boolean;
}

/**
 * Send a desktop notification (macOS and Linux).
 * Falls back to console.log if no notification system is available.
 */
export function pushNotification(options: NotificationOptions): boolean {
  const os = platform();

  try {
    if (os === "darwin") {
      // macOS: osascript
      const script = `display notification "${escapeAppleScript(options.body)}" with title "${escapeAppleScript(options.title)}"${options.sound ? ' sound name "Glass"' : ""}`;
      execFileSync("osascript", ["-e", script], { stdio: "pipe", timeout: 5000 });
      return true;
    }

    if (os === "linux") {
      // Linux: notify-send
      const args = [options.title, options.body];
      if (options.urgency) args.push("--urgency", options.urgency);
      execFileSync("notify-send", args, { stdio: "pipe", timeout: 5000 });
      return true;
    }
  } catch {
    // Fall through to console
  }

  console.log(`[WOTANN] ${options.title}: ${options.body}`);
  return false;
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ── PR Subscription ──────────────────────────────────────────

export interface PRSubscription {
  readonly id: string;
  readonly repo: string;
  readonly prNumber?: number;
  readonly events: readonly PREvent[];
  readonly notifyVia: "desktop" | "channel";
  readonly channelId?: string;
}

export type PREvent =
  | "opened" | "closed" | "merged"
  | "review_requested" | "review_submitted"
  | "checks_passed" | "checks_failed"
  | "comment";

export interface PRState {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  readonly checksStatus: "pending" | "success" | "failure" | "unknown";
  readonly lastUpdated: string;
}

/**
 * Check a GitHub PR's current state using the `gh` CLI.
 */
export function checkPRState(repo: string, prNumber: number): PRState | null {
  try {
    const output = execFileSync("gh", [
      "pr", "view", String(prNumber),
      "--repo", repo,
      "--json", "number,title,state,statusCheckRollup,updatedAt",
    ], { stdio: "pipe", timeout: 15_000, encoding: "utf-8" });

    const data = JSON.parse(output) as {
      number: number;
      title: string;
      state: string;
      statusCheckRollup?: readonly { conclusion?: string }[];
      updatedAt: string;
    };

    let checksStatus: PRState["checksStatus"] = "unknown";
    if (data.statusCheckRollup && data.statusCheckRollup.length > 0) {
      const allPassed = data.statusCheckRollup.every((c) => c.conclusion === "SUCCESS");
      const anyFailed = data.statusCheckRollup.some((c) => c.conclusion === "FAILURE");
      checksStatus = allPassed ? "success" : anyFailed ? "failure" : "pending";
    }

    return {
      number: data.number,
      title: data.title,
      state: data.state === "MERGED" ? "merged" : data.state === "CLOSED" ? "closed" : "open",
      checksStatus,
      lastUpdated: data.updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Compare two PR states and determine which events occurred.
 */
export function detectPREvents(previous: PRState, current: PRState): readonly PREvent[] {
  const events: PREvent[] = [];

  if (previous.state !== "merged" && current.state === "merged") events.push("merged");
  if (previous.state !== "closed" && current.state === "closed") events.push("closed");
  if (previous.checksStatus !== "success" && current.checksStatus === "success") events.push("checks_passed");
  if (previous.checksStatus !== "failure" && current.checksStatus === "failure") events.push("checks_failed");

  return events;
}

// ── Health Check ─────────────────────────────────────────────

export interface HealthCheckResult {
  readonly service: string;
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly message: string;
}

/**
 * Run a health check against a provider endpoint.
 */
export async function healthCheck(
  service: string,
  url: string,
  timeoutMs: number = 5000,
): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    return {
      service,
      healthy: response.ok,
      latencyMs,
      message: response.ok ? "OK" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      service,
      healthy: false,
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Run health checks against all known provider endpoints.
 */
export async function runProviderHealthChecks(): Promise<readonly HealthCheckResult[]> {
  const checks = [
    healthCheck("Ollama", "http://localhost:11434/api/tags"),
    healthCheck("Anthropic API", "https://api.anthropic.com/v1/models"),
    healthCheck("OpenAI API", "https://api.openai.com/v1/models"),
    healthCheck("Gemini API", "https://generativelanguage.googleapis.com/v1beta/models"),
    healthCheck("GitHub Copilot", "https://api.githubcopilot.com"),
  ];

  return Promise.all(checks);
}

// ── Proactive Check ─────────────────────────────────────────

interface CostFileData {
  readonly budgetUsd?: number | null;
  readonly entries?: readonly { readonly cost: number }[];
}

/**
 * Proactive health/status check — runs on every 4th daemon tick (~60s).
 *
 * Checks for:
 * 1. Pending approval notifications older than 5 minutes (stale daemon status)
 * 2. Last CI run failure (if inside a git repo)
 * 3. Cost approaching budget limit (reads cost.json from .wotann/)
 *
 * Sends a desktop notification for each issue found.
 */
export async function proactiveCheck(
  _costOracle?: unknown,
): Promise<void> {
  // 1. Check for stale daemon status (proxy for "pending approval > 5 min")
  const statusPath = join(process.cwd(), ".wotann", "daemon.status.json");
  if (existsSync(statusPath)) {
    try {
      const raw = readFileSync(statusPath, "utf-8");
      const status = JSON.parse(raw) as { pendingApproval?: string; pendingSince?: string };
      if (status.pendingApproval && status.pendingSince) {
        const pendingAge = Date.now() - new Date(status.pendingSince).getTime();
        if (pendingAge > 5 * 60_000) {
          pushNotification({
            title: "WOTANN — Action Required",
            body: `Pending approval for "${status.pendingApproval}" (${Math.round(pendingAge / 60_000)}m waiting)`,
            urgency: "normal",
            sound: true,
          });
        }
      }
    } catch {
      // Status file unreadable — skip
    }
  }

  // 2. Check if last CI run failed (git repo detected via .git/)
  const gitDir = join(process.cwd(), ".git");
  if (existsSync(gitDir)) {
    try {
      const output = execFileSync("gh", [
        "run", "list", "--limit", "1", "--json", "status,conclusion,name",
      ], { stdio: "pipe", timeout: 10_000, encoding: "utf-8" });
      const runs = JSON.parse(output) as readonly { status: string; conclusion: string; name: string }[];
      const lastRun = runs[0];
      if (lastRun && lastRun.conclusion === "failure") {
        pushNotification({
          title: "WOTANN — CI Failed",
          body: `Last CI run "${lastRun.name}" failed. Run \`gh run view\` for details.`,
          urgency: "critical",
          sound: true,
        });
      }
    } catch {
      // gh CLI not available or not in a GitHub repo — skip
    }
  }

  // 3. Check if cost is approaching budget limit
  const costPath = join(process.cwd(), ".wotann", "cost.json");
  if (existsSync(costPath)) {
    try {
      const raw = readFileSync(costPath, "utf-8");
      const data = JSON.parse(raw) as CostFileData;
      const budget = data.budgetUsd;
      if (budget != null && budget > 0 && data.entries) {
        const totalSpent = data.entries.reduce((sum, e) => sum + (e.cost ?? 0), 0);
        const percentUsed = (totalSpent / budget) * 100;
        if (percentUsed >= 90) {
          pushNotification({
            title: "WOTANN — Budget Alert",
            body: `Cost $${totalSpent.toFixed(2)} of $${budget.toFixed(2)} budget (${percentUsed.toFixed(0)}% used)`,
            urgency: percentUsed >= 100 ? "critical" : "normal",
            sound: true,
          });
        }
      }
    } catch {
      // Cost file unreadable — skip
    }
  }
}

// ── Proactive Heartbeat Check ──────────────────────────────

const STALL_THRESHOLD_MS = 10 * 60_000; // 10 minutes

export interface ProactiveHeartbeatOptions {
  readonly activeTasks?: readonly BackgroundTaskStatus[];
}

/**
 * Proactive heartbeat check — runs every 20th daemon tick (~5 min at 15s intervals).
 *
 * Aggregates three checks:
 * 1. CI/CD failure (via `checkPRState` for the current repo's latest PR)
 * 2. Cost approaching budget limit
 * 3. Stalled agent tasks (running for >10 minutes without progress)
 *
 * Each triggered check pushes a desktop notification with an actionable message.
 */
export async function proactiveHeartbeatCheck(
  options: ProactiveHeartbeatOptions = {},
): Promise<void> {
  // 1. Delegate CI and cost checks to the existing proactiveCheck
  await proactiveCheck();

  // 2. Check for stalled agent tasks (running >10 min)
  const tasks = options.activeTasks ?? [];
  const now = Date.now();

  for (const task of tasks) {
    if (task.status !== "running") continue;

    const elapsed = now - task.startedAt;
    if (elapsed > STALL_THRESHOLD_MS) {
      const minutes = Math.round(elapsed / 60_000);
      pushNotification({
        title: "WOTANN — Stalled Task",
        body: `Agent task "${task.description.slice(0, 60)}" has been running for ${minutes}m. Step: ${task.currentStep.slice(0, 80)}`,
        urgency: minutes > 30 ? "critical" : "normal",
        sound: true,
      });
    }
  }
}
