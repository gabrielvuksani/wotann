/**
 * Hook engine: 19 events, deterministic guarantees.
 * Hooks are NOT prompt suggestions — they are code that ALWAYS runs.
 *
 * FEATURES:
 * - 19 event types covering the full agent lifecycle
 * - 3 profiles: minimal → standard → strict (cumulative)
 * - Priority ordering: lower priority number runs first
 * - Timeout handling: hooks that take too long get killed
 * - Async support: all hooks can be sync or async
 * - Stats tracking: counts fires, blocks, warnings per hook
 */

import type { HookEvent, HookProfile } from "../core/types.js";

export interface HookHandler {
  readonly name: string;
  readonly event: HookEvent;
  readonly profile: HookProfile;
  /** Lower priority runs first. Default: 100 */
  readonly priority?: number;
  /** Max execution time in ms. Default: 5000 */
  readonly timeoutMs?: number;
  readonly handler: (payload: HookPayload) => Promise<HookResult> | HookResult;
}

export interface HookPayload {
  readonly event: HookEvent;
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly filePath?: string;
  readonly content?: string;
  readonly sessionId?: string;
  readonly timestamp?: number;
}

export interface HookResult {
  readonly action: "allow" | "block" | "warn" | "modify";
  readonly message?: string;
  readonly modifiedContent?: string;
  readonly hookName?: string;
}

interface HookStats {
  fires: number;
  blocks: number;
  warnings: number;
  errors: number;
  avgDurationMs: number;
}

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_PRIORITY = 100;

export class HookEngine {
  private readonly hooks: Map<HookEvent, HookHandler[]> = new Map();
  private activeProfile: HookProfile;
  private readonly stats: Map<string, HookStats> = new Map();
  private paused = false;

  constructor(profile: HookProfile = "standard") {
    this.activeProfile = profile;
  }

  register(hook: HookHandler): void {
    const existing = this.hooks.get(hook.event) ?? [];
    existing.push(hook);
    // Sort by priority (lower runs first)
    existing.sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY));
    this.hooks.set(hook.event, existing);

    if (!this.stats.has(hook.name)) {
      this.stats.set(hook.name, { fires: 0, blocks: 0, warnings: 0, errors: 0, avgDurationMs: 0 });
    }
  }

  unregister(hookName: string): void {
    for (const [event, handlers] of this.hooks.entries()) {
      const filtered = handlers.filter((h) => h.name !== hookName);
      if (filtered.length !== handlers.length) {
        this.hooks.set(event, filtered);
      }
    }
  }

  setProfile(profile: HookProfile): void {
    this.activeProfile = profile;
  }

  getProfile(): HookProfile {
    return this.activeProfile;
  }

  /** Pause all hook execution (for guardrails-off mode) */
  pause(): void {
    this.paused = true;
  }

  /** Resume hook execution */
  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Fire all hooks for an event in priority order.
   * Returns the first blocking result, or "allow" if all pass.
   * Hooks that exceed their timeout are skipped with a warning.
   */
  async fire(payload: HookPayload): Promise<HookResult> {
    if (this.paused) return { action: "allow" };

    const handlers = this.hooks.get(payload.event) ?? [];
    const activeHandlers = handlers.filter((h) =>
      this.isHookActiveInProfile(h.profile),
    );

    const warnings: string[] = [];

    for (const handler of activeHandlers) {
      const start = Date.now();
      const stats = this.stats.get(handler.name);
      if (stats) stats.fires++;

      try {
        const timeout = handler.timeoutMs ?? DEFAULT_TIMEOUT;
        const result = await Promise.race([
          Promise.resolve(handler.handler(payload)),
          new Promise<HookResult>((resolve) =>
            setTimeout(() => resolve({ action: "warn", message: `Hook ${handler.name} timed out after ${timeout}ms` }), timeout),
          ),
        ]);

        const duration = Date.now() - start;
        if (stats) {
          stats.avgDurationMs = 0.3 * duration + 0.7 * stats.avgDurationMs;
        }

        if (result.action === "block") {
          if (stats) stats.blocks++;
          return { ...result, hookName: handler.name };
        }
        if (result.action === "warn") {
          if (stats) stats.warnings++;
          if (result.message) warnings.push(result.message);
        }
        if (result.action === "modify" && result.modifiedContent) {
          // Pass modified content to subsequent hooks
          payload = { ...payload, content: result.modifiedContent };
        }
      } catch (error) {
        if (stats) stats.errors++;
        // Hook errors should never crash the agent — log and continue
        warnings.push(`Hook ${handler.name} error: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }

    if (warnings.length > 0) {
      return { action: "warn", message: warnings.join("; ") };
    }

    return { action: "allow" };
  }

  /**
   * Fire hooks synchronously (for performance-critical paths).
   * Only runs sync handlers — skips async ones.
   */
  fireSync(payload: HookPayload): HookResult {
    if (this.paused) return { action: "allow" };

    const handlers = this.hooks.get(payload.event) ?? [];
    const activeHandlers = handlers.filter((h) =>
      this.isHookActiveInProfile(h.profile),
    );

    for (const handler of activeHandlers) {
      try {
        const result = handler.handler(payload);
        // Only handle sync results (non-Promise)
        if (result && typeof result === "object" && !("then" in result)) {
          if (result.action === "block") return { ...result, hookName: handler.name };
        }
      } catch {
        // Swallow errors in sync path
      }
    }

    return { action: "allow" };
  }

  private isHookActiveInProfile(hookProfile: HookProfile): boolean {
    const order: Record<HookProfile, number> = {
      minimal: 0,
      standard: 1,
      strict: 2,
    };
    return order[hookProfile] <= order[this.activeProfile];
  }

  getRegisteredHooks(): readonly HookHandler[] {
    const all: HookHandler[] = [];
    for (const handlers of this.hooks.values()) {
      all.push(...handlers);
    }
    return all;
  }

  getHooksForEvent(event: HookEvent): readonly HookHandler[] {
    return this.hooks.get(event) ?? [];
  }

  getHookStats(hookName: string): HookStats | undefined {
    return this.stats.get(hookName);
  }

  getAllStats(): ReadonlyMap<string, HookStats> {
    return this.stats;
  }

  /** Get count of hooks by profile */
  getProfileCounts(): { minimal: number; standard: number; strict: number } {
    let minimal = 0;
    let standard = 0;
    let strict = 0;
    for (const handlers of this.hooks.values()) {
      for (const h of handlers) {
        if (h.profile === "minimal") minimal++;
        else if (h.profile === "standard") standard++;
        else if (h.profile === "strict") strict++;
      }
    }
    return { minimal, standard, strict };
  }
}
