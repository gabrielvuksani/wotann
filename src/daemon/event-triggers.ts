/**
 * Event Trigger System — reactive automation for KAIROS daemon.
 *
 * Three trigger sources:
 * 1. Cron: Schedule-based triggers using KAIROS's crontab parser.
 * 2. Filesystem: Watch directories for changes with debounce.
 * 3. GitHub: React to webhook events from the GitHub channel adapter.
 *
 * Actions: spawn an agent from the runtime's agent roster or execute
 * a shell command. Results are stored as sessions in the daemon log.
 *
 * Configuration: .wotann/triggers.yaml
 */

import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { matchesCronSchedule } from "./kairos.js";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────

export type TriggerSource = "cron" | "filesystem" | "github";
export type TriggerAction = "spawn_agent" | "run_command";

export interface TriggerConfig {
  readonly name: string;
  readonly source: TriggerSource;
  readonly event?: string;       // for github: "pull_request.opened"
  readonly schedule?: string;    // for cron: "0 8 * * *"
  readonly watch?: string;       // for filesystem: "src/**/*.ts"
  readonly action: TriggerAction;
  readonly agent?: string;       // agent name from roster
  readonly command?: string;     // shell command
  readonly enabled?: boolean;
}

export interface GithubEvent {
  readonly type: string;       // "pull_request.opened", "push", etc.
  readonly repo: string;
  readonly sender: string;
  readonly payload: Record<string, unknown>;
  readonly receivedAt: number;
}

export interface TriggerResult {
  readonly triggerName: string;
  readonly source: TriggerSource;
  readonly action: TriggerAction;
  readonly success: boolean;
  readonly message: string;
  readonly executedAt: number;
  readonly durationMs: number;
}

export interface TriggerSystemStatus {
  readonly triggerCount: number;
  readonly activeWatchers: number;
  readonly cronTriggers: number;
  readonly fsTriggers: number;
  readonly githubTriggers: number;
  readonly recentResults: readonly TriggerResult[];
}

// Agent spawner callback — injected by KAIROS at wire-up time
export type AgentSpawner = (agentName: string, task: string) => Promise<string>;

// Event listener for trigger results — lets desktop/TUI subscribe
export type TriggerResultListener = (result: TriggerResult) => void;

// ── Constants ────────────────────────────────────────────

const FS_DEBOUNCE_MS = 500;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_RECENT_RESULTS = 50;

// ── YAML Parsing (minimal, no external deps) ─────────────

function parseTriggersYaml(content: string): readonly TriggerConfig[] {
  const triggers: TriggerConfig[] = [];
  let current: Partial<TriggerConfig> | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Start of a new trigger block (list item)
    if (line.startsWith("- name:")) {
      if (current?.name) {
        triggers.push(finalizeTrigger(current));
      }
      current = { name: extractValue(line, "name") };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("source:")) current = { ...current, source: extractValue(line, "source") as TriggerSource };
    else if (line.startsWith("event:")) current = { ...current, event: extractValue(line, "event") };
    else if (line.startsWith("schedule:")) current = { ...current, schedule: extractQuotedValue(line, "schedule") };
    else if (line.startsWith("watch:")) current = { ...current, watch: extractQuotedValue(line, "watch") };
    else if (line.startsWith("action:")) current = { ...current, action: extractValue(line, "action") as TriggerAction };
    else if (line.startsWith("agent:")) current = { ...current, agent: extractValue(line, "agent") };
    else if (line.startsWith("command:")) current = { ...current, command: extractQuotedValue(line, "command") };
    else if (line.startsWith("enabled:")) current = { ...current, enabled: extractValue(line, "enabled") !== "false" };
  }

  if (current?.name) {
    triggers.push(finalizeTrigger(current));
  }

  return triggers;
}

function extractValue(line: string, key: string): string {
  const colonIndex = line.indexOf(`${key}:`);
  if (colonIndex < 0) return "";
  return line.slice(colonIndex + key.length + 1).trim().replace(/^["']|["']$/g, "");
}

function extractQuotedValue(line: string, key: string): string {
  const colonIndex = line.indexOf(`${key}:`);
  if (colonIndex < 0) return "";
  return line.slice(colonIndex + key.length + 1).trim().replace(/^["']|["']$/g, "");
}

function finalizeTrigger(partial: Partial<TriggerConfig>): TriggerConfig {
  return {
    name: partial.name ?? "unnamed",
    source: partial.source ?? "cron",
    event: partial.event,
    schedule: partial.schedule,
    watch: partial.watch,
    action: partial.action ?? "run_command",
    agent: partial.agent,
    command: partial.command,
    enabled: partial.enabled ?? true,
  };
}

// ── Event Trigger System ─────────────────────────────────

export class EventTriggerSystem {
  private triggers: readonly TriggerConfig[] = [];
  private readonly watchers: Map<string, FSWatcher> = new Map();
  private readonly debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly recentResults: TriggerResult[] = [];
  private agentSpawner: AgentSpawner | null = null;
  private resultListener: TriggerResultListener | null = null;

  // Last cron execution per trigger name — prevents double-fire within same minute
  private readonly lastCronRun: Map<string, number> = new Map();

  /**
   * Set the agent spawner callback (injected by KAIROS with runtime access).
   */
  setAgentSpawner(spawner: AgentSpawner): void {
    this.agentSpawner = spawner;
  }

  /**
   * Subscribe to trigger results (for desktop notifications, TUI, etc).
   */
  onResult(listener: TriggerResultListener): void {
    this.resultListener = listener;
  }

  /**
   * Load trigger configurations from a YAML file.
   */
  async loadConfig(configPath: string): Promise<number> {
    if (!existsSync(configPath)) {
      this.triggers = [];
      return 0;
    }

    try {
      const content = readFileSync(configPath, "utf-8");
      this.triggers = parseTriggersYaml(content);
      return this.triggers.length;
    } catch {
      this.triggers = [];
      return 0;
    }
  }

  /**
   * Get all loaded triggers.
   */
  getTriggers(): readonly TriggerConfig[] {
    return this.triggers;
  }

  /**
   * Check and execute cron-based triggers for the current time.
   * Called from KAIROS tick loop.
   */
  checkCronTriggers(now: Date): void {
    const cronTriggers = this.triggers.filter(
      (t) => t.source === "cron" && t.schedule && t.enabled !== false,
    );

    for (const trigger of cronTriggers) {
      if (!trigger.schedule) continue;

      // Prevent double-fire within the same minute
      const minuteKey = Math.floor(now.getTime() / 60_000);
      const lastRun = this.lastCronRun.get(trigger.name);
      if (lastRun !== undefined && lastRun === minuteKey) continue;

      if (matchesCronSchedule(trigger.schedule, now)) {
        this.lastCronRun.set(trigger.name, minuteKey);
        void this.executeTrigger(trigger, `Cron schedule matched: ${trigger.schedule}`);
      }
    }
  }

  /**
   * Register filesystem watchers for all fs-based triggers.
   * Uses 500ms debounce to avoid rapid-fire on saves.
   */
  registerFilesystemTriggers(workspaceDir: string): number {
    // Close existing watchers first
    this.closeFilesystemWatchers();

    const fsTriggers = this.triggers.filter(
      (t) => t.source === "filesystem" && t.watch && t.enabled !== false,
    );

    for (const trigger of fsTriggers) {
      if (!trigger.watch) continue;

      const watchPath = trigger.watch.startsWith("/")
        ? trigger.watch
        : join(workspaceDir, trigger.watch);

      // Resolve the directory to watch (use parent dir for glob patterns)
      const dirToWatch = watchPath.includes("*")
        ? watchPath.split("*")[0]?.replace(/[/\\]+$/, "") ?? workspaceDir
        : watchPath;

      if (!existsSync(dirToWatch)) continue;

      try {
        const watcher = watch(dirToWatch, { recursive: true }, (_eventType, filename) => {
          if (!filename) return;

          // Match against the watch pattern (simple glob matching)
          if (trigger.watch && !matchesGlob(filename, trigger.watch)) return;

          // Debounce: clear existing timer, set new one
          const existingTimer = this.debounceTimers.get(trigger.name);
          if (existingTimer) clearTimeout(existingTimer);

          const timer = setTimeout(() => {
            this.debounceTimers.delete(trigger.name);
            void this.executeTrigger(trigger, `File changed: ${filename}`);
          }, FS_DEBOUNCE_MS);

          this.debounceTimers.set(trigger.name, timer);
        });

        this.watchers.set(trigger.name, watcher);
      } catch {
        // Directory may not be watchable — skip silently
      }
    }

    return this.watchers.size;
  }

  /**
   * Handle an incoming GitHub webhook event.
   * Matches against github-type triggers by event name.
   */
  handleGithubEvent(event: GithubEvent): void {
    const githubTriggers = this.triggers.filter(
      (t) => t.source === "github" && t.enabled !== false,
    );

    for (const trigger of githubTriggers) {
      if (!trigger.event) continue;

      // Match event type: "push", "pull_request.opened", etc.
      if (event.type === trigger.event || event.type.startsWith(`${trigger.event}.`)) {
        void this.executeTrigger(
          trigger,
          `GitHub event: ${event.type} from ${event.sender} on ${event.repo}`,
        );
      }
    }
  }

  /**
   * Get system status.
   */
  getStatus(): TriggerSystemStatus {
    return {
      triggerCount: this.triggers.length,
      activeWatchers: this.watchers.size,
      cronTriggers: this.triggers.filter((t) => t.source === "cron").length,
      fsTriggers: this.triggers.filter((t) => t.source === "filesystem").length,
      githubTriggers: this.triggers.filter((t) => t.source === "github").length,
      recentResults: [...this.recentResults],
    };
  }

  /**
   * Clean up watchers and timers.
   */
  shutdown(): void {
    this.closeFilesystemWatchers();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  // ── Private ────────────────────────────────────────────

  private async executeTrigger(trigger: TriggerConfig, reason: string): Promise<void> {
    const startTime = Date.now();

    try {
      let message: string;

      if (trigger.action === "spawn_agent" && trigger.agent) {
        message = await this.spawnAgent(trigger.agent, reason);
      } else if (trigger.action === "run_command" && trigger.command) {
        message = await this.runCommand(trigger.command);
      } else {
        message = `Trigger ${trigger.name}: no valid action configured`;
      }

      this.recordResult({
        triggerName: trigger.name,
        source: trigger.source,
        action: trigger.action,
        success: true,
        message,
        executedAt: startTime,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      this.recordResult({
        triggerName: trigger.name,
        source: trigger.source,
        action: trigger.action,
        success: false,
        message: err instanceof Error ? err.message : String(err),
        executedAt: startTime,
        durationMs: Date.now() - startTime,
      });
    }
  }

  private async spawnAgent(agentName: string, task: string): Promise<string> {
    if (!this.agentSpawner) {
      return `Agent spawn skipped: no spawner configured (would spawn "${agentName}")`;
    }
    return this.agentSpawner(agentName, task);
  }

  private async runCommand(command: string): Promise<string> {
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    if (!cmd) return "Empty command";

    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: COMMAND_TIMEOUT_MS,
      cwd: process.cwd(),
    });

    return stderr ? `stdout: ${stdout.slice(0, 500)}\nstderr: ${stderr.slice(0, 500)}` : stdout.slice(0, 1000);
  }

  private recordResult(result: TriggerResult): void {
    this.recentResults.push(result);
    while (this.recentResults.length > MAX_RECENT_RESULTS) {
      this.recentResults.shift();
    }
    if (this.resultListener) {
      this.resultListener(result);
    }
  }

  private closeFilesystemWatchers(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

// ── Glob Matching (simple) ───────────────────────────────

function matchesGlob(filename: string, pattern: string): boolean {
  // Strip leading directory components from pattern for matching
  const patternParts = pattern.split("/").filter(Boolean);
  const filenameParts = filename.split("/").filter(Boolean);

  // Check file extension match: "**/*.ts" matches any .ts file
  const lastPattern = patternParts[patternParts.length - 1];
  if (lastPattern?.startsWith("*.")) {
    const ext = lastPattern.slice(1);
    return filename.endsWith(ext);
  }

  // Direct name match
  const lastFilename = filenameParts[filenameParts.length - 1] ?? "";
  if (lastPattern === lastFilename) return true;

  // Contains the watched directory
  if (patternParts.some((part) => !part.includes("*") && filename.includes(part))) {
    return true;
  }

  return false;
}
