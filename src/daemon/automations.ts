/**
 * Automations — event-driven agents.
 * Each automation = { trigger, agent_config, memory_scope }
 * Triggers: github_pr_opened, slack_mention, cron_schedule, file_changed, cost_threshold
 * Configuration stored in ~/.wotann/automations.json
 *
 * Node.js types declared inline (daemon runtime provides the actual APIs).
 */

// Node.js runtime types come from @types/node — the prior inline shims
// (NodeFS/NodeOS/NodePath/NodeCrypto + `declare function require`) were
// dead fallback declarations kept alongside the real imports below.
// Removed session-5 to close 5 lint warnings.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { resolveWotannHome } from "../utils/wotann-home.js";
import { writeFileAtomic } from "../utils/atomic-io.js";

// ── Trigger Types ──────────────────────────────────────────

interface CronTrigger {
  readonly type: "cron";
  readonly schedule: string; // cron expression: "min hour dom month dow"
}

interface FileChangeTrigger {
  readonly type: "file_changed";
  readonly patterns: readonly string[]; // glob patterns to watch
  readonly debounceMs: number;
}

interface WebhookTrigger {
  readonly type: "webhook";
  readonly event: "github_pr_opened" | "github_push" | "slack_mention" | "generic";
  readonly filter?: Readonly<Record<string, string>>; // optional event filters
}

interface CostThresholdTrigger {
  readonly type: "cost_threshold";
  readonly maxDailyCost: number;
}

type AutomationTrigger = CronTrigger | FileChangeTrigger | WebhookTrigger | CostThresholdTrigger;

// ── Automation Config ──────────────────────────────────────

interface AutomationAgentConfig {
  readonly model: string;
  readonly systemPrompt: string;
  readonly maxTurns: number;
  readonly maxCost: number;
}

interface AutomationConfig {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: AutomationTrigger;
  readonly agentConfig: AutomationAgentConfig;
  readonly memoryScope: "isolated" | "shared";
  readonly createdAt: number;
  readonly lastRunAt: number | null;
  readonly runCount: number;
}

// ── Execution Log Entry ────────────────────────────────────

interface ExecutionLogEntry {
  readonly automationId: string;
  readonly automationName: string;
  readonly triggeredAt: number;
  readonly completedAt: number;
  readonly success: boolean;
  readonly error?: string;
  readonly context: Readonly<Record<string, unknown>>;
}

// ── Cron Parser ────────────────────────────────────────────

/** Parsed representation of a single cron field. */
interface CronField {
  readonly type: "wildcard" | "values";
  readonly values: readonly number[];
}

/** Full parsed cron expression (5-field: min hour dom month dow). */
interface ParsedCron {
  readonly minute: CronField;
  readonly hour: CronField;
  readonly dayOfMonth: CronField;
  readonly month: CronField;
  readonly dayOfWeek: CronField;
}

/**
 * Parse a single cron field into a CronField.
 * Supports: *, specific numbers, comma-separated lists, ranges (1-5),
 * and step values (e.g. * /5 means every 5th unit).
 */
function parseCronField(field: string, min: number, max: number): CronField {
  if (field === "*") {
    return { type: "wildcard", values: [] };
  }

  const values: number[] = [];

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const [, base, stepStr] = stepMatch;
      const step = parseInt(stepStr!, 10);
      let rangeStart = min;
      let rangeEnd = max;

      if (base !== "*") {
        const rangeParts = base!.split("-");
        rangeStart = parseInt(rangeParts[0]!, 10);
        rangeEnd = rangeParts[1] !== undefined ? parseInt(rangeParts[1], 10) : max;
      }

      for (let i = rangeStart; i <= rangeEnd; i += step) {
        values.push(i);
      }
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]!, 10);
      const end = parseInt(rangeMatch[2]!, 10);
      for (let i = start; i <= end; i++) {
        values.push(i);
      }
      continue;
    }

    const num = parseInt(part, 10);
    if (!Number.isNaN(num) && num >= min && num <= max) {
      values.push(num);
    }
  }

  return { type: "values", values: Object.freeze([...values]) };
}

/** Parse a 5-field cron expression. */
function parseCronExpression(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return Object.freeze({
    minute: parseCronField(parts[0]!, 0, 59),
    hour: parseCronField(parts[1]!, 0, 23),
    dayOfMonth: parseCronField(parts[2]!, 1, 31),
    month: parseCronField(parts[3]!, 1, 12),
    dayOfWeek: parseCronField(parts[4]!, 0, 6),
  });
}

/** Check whether a CronField matches a given value. */
function fieldMatches(field: CronField, value: number): boolean {
  if (field.type === "wildcard") return true;
  return field.values.includes(value);
}

/** Check whether a Date matches a parsed cron expression. */
function cronMatchesDate(cron: ParsedCron, date: Date): boolean {
  return (
    fieldMatches(cron.minute, date.getMinutes()) &&
    fieldMatches(cron.hour, date.getHours()) &&
    fieldMatches(cron.dayOfMonth, date.getDate()) &&
    fieldMatches(cron.month, date.getMonth() + 1) &&
    fieldMatches(cron.dayOfWeek, date.getDay())
  );
}

/**
 * Compute the next Date (after `after`) that matches the cron expression.
 * Searches up to 400 days ahead (covers all monthly/yearly patterns).
 * Returns epoch ms or null if no match found.
 */
function nextCronMatch(cron: ParsedCron, after: Date): number | null {
  const candidate = new Date(after.getTime());
  // Advance to the next whole minute
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = after.getTime() + 400 * 24 * 60 * 60 * 1000;

  while (candidate.getTime() < limit) {
    if (cronMatchesDate(cron, candidate)) {
      return candidate.getTime();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);

    // Optimization: skip ahead if hour/day/month don't match
    if (!fieldMatches(cron.month, candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    if (
      !fieldMatches(cron.dayOfMonth, candidate.getDate()) ||
      !fieldMatches(cron.dayOfWeek, candidate.getDay())
    ) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    if (!fieldMatches(cron.hour, candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }
  }

  return null;
}

// ── Glob Matching ──────────────────────────────────────────

/** Minimal glob matcher supporting * and ** wildcards and ? placeholder. */
function globMatches(pattern: string, filePath: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".");

  return new RegExp(`^${regexStr}$`).test(filePath);
}

/** Extract the non-glob base directory from a glob pattern. */
function extractGlobBase(pattern: string): string {
  const segments = pattern.split("/");
  const baseSegments: string[] = [];

  for (const seg of segments) {
    if (/[*?[\]{}]/.test(seg)) break;
    baseSegments.push(seg);
  }

  return baseSegments.join("/");
}

// ── Automation Engine ──────────────────────────────────────

export type AutomationExecuteHandler = (
  payload: Readonly<{
    automationId: string;
    automationName: string;
    model: string;
    systemPrompt: string;
    maxTurns: number;
    maxCost: number;
    memoryScope: string;
    triggerContext: Readonly<Record<string, unknown>>;
    triggeredAt: number;
  }>,
) => Promise<void>;

export class AutomationEngine {
  private automations: readonly AutomationConfig[] = [];
  private readonly cronTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private readonly fileWatchers: Map<string, unknown> = new Map();
  private readonly debouncePending: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly executionLog: ExecutionLogEntry[] = [];
  private readonly parsedCrons: Map<string, ParsedCron> = new Map();
  private readonly configPath: string;
  private readonly configDir: string;
  private running = false;
  private executeHandler: AutomationExecuteHandler | null = null;

  constructor() {
    this.configDir = resolveWotannHome();
    this.configPath = path.join(this.configDir, "automations.json");
  }

  /** Register a handler that will be called when an automation triggers agent execution. */
  onExecute(handler: AutomationExecuteHandler): void {
    this.executeHandler = handler;
  }

  // ── Config Persistence ─────────────────────────────────

  /** Load automations from the config file on disk. Returns the loaded list. */
  loadConfig(): readonly AutomationConfig[] {
    if (!fs.existsSync(this.configPath)) {
      this.automations = Object.freeze([]);
      return this.automations;
    }

    try {
      const raw = fs.readFileSync(this.configPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        this.automations = Object.freeze([]);
        return this.automations;
      }

      this.automations = Object.freeze(
        (parsed as AutomationConfig[]).map((cfg) => Object.freeze({ ...cfg })),
      );
    } catch {
      this.automations = Object.freeze([]);
    }

    return this.automations;
  }

  /** Persist current automations to disk. Creates ~/.wotann/ if needed. */
  saveConfig(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    // Wave 6.5-UU (H-22) — automations config drives the daemon's trigger
    // dispatch. Atomic write so a crash mid-save doesn't truncate the
    // config and disable every automation on next boot.
    writeFileAtomic(this.configPath, JSON.stringify(this.automations, null, 2));
  }

  // ── Lifecycle ──────────────────────────────────────────

  /** Start all enabled automations. Loads config if not already loaded. */
  start(): void {
    if (this.running) return;

    if (this.automations.length === 0) {
      this.loadConfig();
    }

    this.running = true;

    for (const automation of this.automations) {
      if (!automation.enabled) continue;
      this.activateTrigger(automation);
    }
  }

  /** Stop all running automations — clears timers, unwatches files. */
  stop(): void {
    if (!this.running) return;

    for (const [id, timer] of this.cronTimers.entries()) {
      clearInterval(timer);
      this.cronTimers.delete(id);
    }

    for (const [key] of this.fileWatchers.entries()) {
      const filePath = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
      fs.unwatchFile(filePath);
      this.fileWatchers.delete(key);
    }

    for (const [key, timer] of this.debouncePending.entries()) {
      clearTimeout(timer);
      this.debouncePending.delete(key);
    }

    this.parsedCrons.clear();
    this.running = false;
  }

  // ── CRUD ───────────────────────────────────────────────

  /** Create a new automation. Returns the frozen config with generated id. */
  createAutomation(
    config: Omit<AutomationConfig, "id" | "createdAt" | "lastRunAt" | "runCount">,
  ): AutomationConfig {
    const newConfig: AutomationConfig = Object.freeze({
      ...config,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      lastRunAt: null,
      runCount: 0,
    });

    this.automations = Object.freeze([...this.automations, newConfig]);
    this.saveConfig();

    if (this.running && newConfig.enabled) {
      this.activateTrigger(newConfig);
    }

    return newConfig;
  }

  /** Update an existing automation by id. Returns the updated config or null. */
  updateAutomation(id: string, updates: Partial<AutomationConfig>): AutomationConfig | null {
    const index = this.automations.findIndex((a) => a.id === id);
    if (index === -1) return null;

    const existing = this.automations[index]!;

    if (this.running) {
      this.deactivateTrigger(id);
    }

    const updated: AutomationConfig = Object.freeze({
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
    });

    const copy = [...this.automations];
    copy[index] = updated;
    this.automations = Object.freeze(copy);
    this.saveConfig();

    if (this.running && updated.enabled) {
      this.activateTrigger(updated);
    }

    return updated;
  }

  /** Delete an automation by id. Returns true if found and removed. */
  deleteAutomation(id: string): boolean {
    const index = this.automations.findIndex((a) => a.id === id);
    if (index === -1) return false;

    if (this.running) {
      this.deactivateTrigger(id);
    }

    this.automations = Object.freeze(this.automations.filter((a) => a.id !== id));
    this.saveConfig();
    return true;
  }

  /** Get a single automation by id, or null if not found. */
  getAutomation(id: string): AutomationConfig | null {
    return this.automations.find((a) => a.id === id) ?? null;
  }

  /** Return all automations (frozen array). */
  listAutomations(): readonly AutomationConfig[] {
    return this.automations;
  }

  // ── Execution ──────────────────────────────────────────

  /**
   * Execute an automation with the given trigger context.
   * Builds the agent payload, updates run metadata, and logs the result.
   */
  private async executeAutomation(
    automation: AutomationConfig,
    context: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const triggeredAt = Date.now();

    try {
      const executionPayload = Object.freeze({
        automationId: automation.id,
        automationName: automation.name,
        model: automation.agentConfig.model,
        systemPrompt: automation.agentConfig.systemPrompt,
        maxTurns: automation.agentConfig.maxTurns,
        maxCost: automation.agentConfig.maxCost,
        memoryScope: automation.memoryScope,
        triggerContext: context,
        triggeredAt,
      });

      // Dispatch to the registered execute handler (wired by KAIROS daemon)
      if (this.executeHandler) {
        await this.executeHandler(executionPayload);
      }

      const completedAt = Date.now();

      // Immutably update the automation record with new run metadata
      this.updateAutomation(automation.id, {
        lastRunAt: completedAt,
        runCount: automation.runCount + 1,
      });

      this.executionLog.push(
        Object.freeze({
          automationId: automation.id,
          automationName: automation.name,
          triggeredAt,
          completedAt,
          success: true,
          context: { ...context },
        }),
      );
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.executionLog.push(
        Object.freeze({
          automationId: automation.id,
          automationName: automation.name,
          triggeredAt,
          completedAt: Date.now(),
          success: false,
          error: errorMessage,
          context: { ...context },
        }),
      );
    }
  }

  // ── Trigger Activation / Deactivation ──────────────────

  /** Route trigger setup based on type. Webhooks and cost thresholds are passive. */
  private activateTrigger(automation: AutomationConfig): void {
    switch (automation.trigger.type) {
      case "cron":
        this.setupCronTrigger(automation);
        break;
      case "file_changed":
        this.setupFileWatcher(automation);
        break;
      case "webhook":
        // Passive — handled via handleWebhookEvent()
        break;
      case "cost_threshold":
        // Passive — checked via checkCostThreshold()
        break;
    }
  }

  /** Tear down any active trigger resources for an automation. */
  private deactivateTrigger(id: string): void {
    const cronTimer = this.cronTimers.get(id);
    if (cronTimer !== undefined) {
      clearInterval(cronTimer);
      this.cronTimers.delete(id);
    }
    this.parsedCrons.delete(id);

    // File watchers are keyed as "automationId:filePath"
    const keysToRemove: string[] = [];
    for (const key of this.fileWatchers.keys()) {
      if (key.startsWith(`${id}:`)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      const filePath = key.slice(id.length + 1);
      fs.unwatchFile(filePath);
      this.fileWatchers.delete(key);
    }

    const debounceTimer = this.debouncePending.get(id);
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      this.debouncePending.delete(id);
    }
  }

  // ── Cron Triggers ──────────────────────────────────────

  /**
   * Set up a cron-based trigger. Polls every 60 seconds and fires
   * when the current time matches the cron expression.
   */
  private setupCronTrigger(automation: AutomationConfig): void {
    if (automation.trigger.type !== "cron") return;

    const parsed = parseCronExpression(automation.trigger.schedule);
    this.parsedCrons.set(automation.id, parsed);

    // Track the last-fired minute to prevent double-firing
    let lastFiredMinute = -1;

    const timer = setInterval(() => {
      const now = new Date();
      // Encode the current minute as a unique number for dedup
      const currentMinute =
        now.getFullYear() * 100_000_000 +
        (now.getMonth() + 1) * 1_000_000 +
        now.getDate() * 10_000 +
        now.getHours() * 100 +
        now.getMinutes();

      if (currentMinute === lastFiredMinute) return;

      if (cronMatchesDate(parsed, now)) {
        lastFiredMinute = currentMinute;

        const current = this.getAutomation(automation.id);
        if (current !== null && current.enabled) {
          void this.executeAutomation(current, {
            triggerType: "cron",
            schedule: (current.trigger as CronTrigger).schedule,
            firedAt: now.toISOString(),
          });
        }
      }
    }, 60_000);

    this.cronTimers.set(automation.id, timer);
  }

  // ── File Watchers ──────────────────────────────────────

  /**
   * Set up file-change watchers for all patterns in the trigger.
   * Literal paths are watched directly; glob patterns watch the base directory.
   */
  private setupFileWatcher(automation: AutomationConfig): void {
    if (automation.trigger.type !== "file_changed") return;

    const trigger = automation.trigger;

    for (const pattern of trigger.patterns) {
      const isLiteralPath = !/[*?[\]{}]/.test(pattern);

      if (isLiteralPath) {
        this.watchSingleFile(automation.id, pattern, trigger.debounceMs);
      } else {
        const baseDir = extractGlobBase(pattern);
        if (baseDir.length > 0 && fs.existsSync(baseDir)) {
          this.watchSingleFile(automation.id, baseDir, trigger.debounceMs, pattern);
        }
      }
    }
  }

  /**
   * Watch a single file path with debouncing. Fires executeAutomation
   * when the file's mtime changes and the optional glob filter passes.
   */
  private watchSingleFile(
    automationId: string,
    filePath: string,
    debounceMs: number,
    globPattern?: string,
  ): void {
    const key = `${automationId}:${filePath}`;
    if (this.fileWatchers.has(key)) return;

    const watcher = fs.watchFile(
      filePath,
      { interval: Math.max(debounceMs, 1000) },
      (curr, prev) => {
        if (curr.mtimeMs === prev.mtimeMs) return;
        if (globPattern !== undefined && !globMatches(globPattern, filePath)) return;

        const existingTimer = this.debouncePending.get(automationId);
        if (existingTimer !== undefined) {
          clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
          this.debouncePending.delete(automationId);

          const current = this.getAutomation(automationId);
          if (current !== null && current.enabled) {
            void this.executeAutomation(current, {
              triggerType: "file_changed",
              filePath,
              globPattern: globPattern ?? null,
              changedAt: new Date().toISOString(),
            });
          }
        }, debounceMs);

        this.debouncePending.set(automationId, timer);
      },
    );

    this.fileWatchers.set(key, watcher);
  }

  // ── Webhook Events ─────────────────────────────────────

  /**
   * Handle an incoming webhook event. Called by the daemon when a
   * webhook payload arrives. Matches the event against all enabled
   * webhook-triggered automations and executes matches concurrently.
   */
  async handleWebhookEvent(
    event: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const matching = this.automations.filter((a) => {
      if (!a.enabled) return false;
      if (a.trigger.type !== "webhook") return false;
      if (a.trigger.event !== event) return false;

      // All filter key/value pairs must match in the payload
      if (a.trigger.filter !== undefined) {
        for (const [key, expectedValue] of Object.entries(a.trigger.filter)) {
          const actual = payload[key];
          if (String(actual) !== expectedValue) return false;
        }
      }

      return true;
    });

    await Promise.allSettled(
      matching.map((automation) =>
        this.executeAutomation(automation, {
          triggerType: "webhook",
          event,
          payload: { ...payload },
          receivedAt: new Date().toISOString(),
        }),
      ),
    );
  }

  // ── Cost Threshold ─────────────────────────────────────

  /**
   * Check all cost-threshold automations against the current daily spend.
   * Called periodically by the daemon's cost-tracking subsystem.
   */
  async checkCostThreshold(currentDailyCost: number): Promise<void> {
    const matching = this.automations.filter((a) => {
      if (!a.enabled) return false;
      if (a.trigger.type !== "cost_threshold") return false;
      return currentDailyCost >= a.trigger.maxDailyCost;
    });

    await Promise.allSettled(
      matching.map((automation) =>
        this.executeAutomation(automation, {
          triggerType: "cost_threshold",
          currentDailyCost,
          threshold: (automation.trigger as CostThresholdTrigger).maxDailyCost,
          exceededAt: new Date().toISOString(),
        }),
      ),
    );
  }

  // ── Status / UI ────────────────────────────────────────

  /** Return current engine status for the UI dashboard. */
  getStatus(): {
    readonly running: boolean;
    readonly automations: readonly AutomationConfig[];
    readonly nextRuns: Readonly<Record<string, number>>;
    readonly recentExecutions: readonly ExecutionLogEntry[];
  } {
    const nextRuns: Record<string, number> = {};
    const now = new Date();

    for (const automation of this.automations) {
      if (!automation.enabled) continue;
      if (automation.trigger.type !== "cron") continue;

      const cached = this.parsedCrons.get(automation.id);
      if (cached !== undefined) {
        const next = nextCronMatch(cached, now);
        if (next !== null) {
          nextRuns[automation.id] = next;
        }
      } else {
        // Parse on-demand for status queries when engine is stopped
        try {
          const parsed = parseCronExpression(automation.trigger.schedule);
          const next = nextCronMatch(parsed, now);
          if (next !== null) {
            nextRuns[automation.id] = next;
          }
        } catch {
          // Invalid cron expression — skip
        }
      }
    }

    const recentExecutions = Object.freeze(this.executionLog.slice(-50));

    return Object.freeze({
      running: this.running,
      automations: this.automations,
      nextRuns: Object.freeze(nextRuns),
      recentExecutions,
    });
  }
}

// ── Exported Types ─────────────────────────────────────────

export type {
  AutomationConfig,
  AutomationTrigger,
  AutomationAgentConfig,
  CronTrigger,
  FileChangeTrigger,
  WebhookTrigger,
  CostThresholdTrigger,
  ExecutionLogEntry,
  ParsedCron,
  CronField,
};

// ── Exported Utilities (for testing) ───────────────────────

export { parseCronExpression, cronMatchesDate, nextCronMatch, globMatches, extractGlobBase };
