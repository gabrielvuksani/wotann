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

/**
 * Hook "kind" distinguishes how the handler is dispatched. Session-7 port
 * of Claude Code v2.1.85's typed handler model:
 *
 *   - "tool"   : classical tool-interception (default). Runs on every event
 *                this hook is registered for.
 *   - "prompt" : receives the prompt text (payload.content) and may return
 *                a `modifiedContent` that is threaded back into the user
 *                message stream. Only active on UserPromptSubmit /
 *                SessionStart events.
 *   - "agent"  : the handler is an async dispatch target that may spawn
 *                sub-agents or call back into the runtime. The engine
 *                awaits the result like any async handler but the kind
 *                lets downstream listeners (UI / telemetry) render the
 *                extra latency as "consulting sub-agent…" instead of a
 *                generic hook spinner.
 *
 * Default is "tool" so all existing hooks continue to work unchanged.
 */
export type HookKind = "tool" | "prompt" | "agent";

export interface HookHandler {
  readonly name: string;
  readonly event: HookEvent;
  readonly profile: HookProfile;
  /** Lower priority runs first. Default: 100 */
  readonly priority?: number;
  /** Max execution time in ms. Default: 5000 */
  readonly timeoutMs?: number;
  /**
   * Claude Code v2.1.85 `if` predicate. When present and returns false (or
   * a promise resolving to false), the handler is skipped without counting
   * as fired. Lets users scope hooks to specific tools / file paths /
   * session IDs without littering the handler body with early returns.
   *
   * Predicate errors are treated as "condition did not match" — the hook
   * simply doesn't fire, and the error is surfaced as a warning so callers
   * can notice misconfigured predicates without the agent halting.
   */
  readonly if?: (payload: HookPayload) => boolean | Promise<boolean>;
  /** Dispatch kind — see HookKind docstring. Default "tool". */
  readonly kind?: HookKind;
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

/**
 * V9 T14.1 — Defer resolvers.
 *
 * Names of the downstream resolvers a `defer` hook can route to. Each
 * resolver represents a different decision-making surface:
 *
 *   - "council" : multi-model deliberation (Council view in desktop).
 *   - "arena"   : side-by-side model comparison (Arena view).
 *   - "approval": ExecApprovals queue (human-in-the-loop list).
 *   - "human"   : direct prompt to the user — block until they answer.
 *
 * The shape is exhaustive so a hook author can't typo the resolver name
 * without TypeScript catching it. Adding a new resolver is a one-line
 * change here; the dispatch table below picks it up automatically.
 */
export type DeferResolver = "council" | "arena" | "approval" | "human";

export interface HookResult {
  readonly action: "allow" | "block" | "warn" | "modify" | "defer";
  readonly message?: string;
  readonly modifiedContent?: string;
  readonly hookName?: string;
  /**
   * Optional context to prepend to the agent's next user prompt. Used by
   * MemoryRecovery on SessionStart to thread recovered WAL content back
   * into the model's context instead of just logging a recovery message.
   * Populated by hooks; consumed by the runtime.
   */
  readonly contextPrefix?: string;
  /** Aggregated warnings surfaced by sync-path hooks (replaces silent swallowing). */
  readonly warnings?: readonly string[];
  /**
   * V9 T14.1 — Defer fields. Only meaningful when `action === "defer"`.
   *
   * The hook engine recognises `defer` and routes the tool call to the
   * named resolver. The resolver returns a final HookResult ("allow"/
   * "block"/"warn") which the engine then surfaces to the caller.
   *
   * Honest stub semantics: the in-tree resolver dispatcher logs the
   * decision request and returns a default-block result so production
   * code can wire real resolvers (Council, Arena, ExecApprovals, human
   * prompt) without changing the hook contract. Hooks can defer today
   * and pick up real downstream behaviour as those resolvers ship.
   */
  readonly resolver?: DeferResolver;
  readonly deferTimeoutMs?: number;
  readonly reason?: string;
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

/**
 * V9 T14.1 — Defer resolver handler signature.
 *
 * A resolver receives the original hook payload (so it can inspect the
 * tool name / input / file path being intercepted) plus the original
 * `defer` HookResult (so it can read the reason / timeout the hook
 * specified) and returns a final HookResult. Resolvers are async by
 * design — the canonical Council / Arena / approval queue all involve
 * round trips that the synchronous hook chain can't accommodate.
 */
export type DeferResolverHandler = (
  payload: HookPayload,
  deferResult: HookResult,
) => Promise<HookResult> | HookResult;

export class HookEngine {
  private readonly hooks: Map<HookEvent, HookHandler[]> = new Map();
  private activeProfile: HookProfile;
  private readonly stats: Map<string, HookStats> = new Map();
  /**
   * V9 T14.1 — registry of resolvers for `defer` HookResults. Empty by
   * default; real handlers are registered by the runtime via
   * `setDeferResolver(name, handler)`. When empty the engine treats
   * deferrals as honest-stub blocks.
   */
  private readonly deferResolvers: Map<DeferResolver, DeferResolverHandler> = new Map();
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

  /**
   * Round 7: enumerate every registered hook so the daemon RPC layer
   * (`hooks.list`) can show the user what's enforcing what. Returns a
   * flat array sorted by event then priority — same order they would
   * fire if dispatch happened today.
   */
  listAll(): readonly {
    name: string;
    event: HookEvent;
    priority: number;
    profile: HookProfile;
    kind: HookKind;
  }[] {
    const out: {
      name: string;
      event: HookEvent;
      priority: number;
      profile: HookProfile;
      kind: HookKind;
    }[] = [];
    for (const [event, handlers] of this.hooks.entries()) {
      for (const h of handlers) {
        out.push({
          name: h.name,
          event,
          priority: h.priority ?? DEFAULT_PRIORITY,
          profile: h.profile,
          kind: h.kind ?? "tool",
        });
      }
    }
    return out.sort((a, b) => {
      if (a.event !== b.event) return a.event.localeCompare(b.event);
      return a.priority - b.priority;
    });
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
    const activeHandlers = handlers.filter((h) => this.isHookActiveInProfile(h.profile));

    const warnings: string[] = [];
    const originalContent = payload.content;
    let anyModified = false;

    for (const handler of activeHandlers) {
      // C14: Evaluate `if` predicate BEFORE counting a fire. A handler
      // gated out by its predicate is semantically "not this event" rather
      // than "fired and allowed" — keeping stats clean lets dashboards
      // distinguish misconfigured hooks from legitimately-scoped ones.
      if (handler.if) {
        try {
          const conditionResult = await Promise.resolve(handler.if(payload));
          if (!conditionResult) continue;
        } catch (error) {
          warnings.push(
            `Hook ${handler.name} if-predicate error: ${error instanceof Error ? error.message : "unknown"}`,
          );
          continue;
        }
      }

      const start = Date.now();
      const stats = this.stats.get(handler.name);
      if (stats) stats.fires++;

      try {
        const timeout = handler.timeoutMs ?? DEFAULT_TIMEOUT;
        const result = await Promise.race([
          Promise.resolve(handler.handler(payload)),
          new Promise<HookResult>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  action: "warn",
                  message: `Hook ${handler.name} timed out after ${timeout}ms`,
                }),
              timeout,
            ),
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
        if (result.action === "defer") {
          // V9 T14.1 — route to the named resolver. The resolver
          // returns a final HookResult that we treat exactly like the
          // direct return: "block" stops the chain, "warn" accumulates,
          // "allow" proceeds to the next hook. We attribute the result
          // back to the hook that deferred so dashboards and audit logs
          // record who initiated the deferral.
          const resolved = await this.dispatchDeferral(result, handler.name, payload);
          if (resolved.action === "block") {
            if (stats) stats.blocks++;
            return { ...resolved, hookName: handler.name };
          }
          if (resolved.action === "warn") {
            if (stats) stats.warnings++;
            if (resolved.message) warnings.push(resolved.message);
          }
          // "allow" / "modify" / "defer" (re-entrant) just fall through
          // — the engine treats them as benign continues.
          continue;
        }
        if (result.action === "warn") {
          if (stats) stats.warnings++;
          if (result.message) warnings.push(result.message);
        }
        if (result.action === "modify" && typeof result.modifiedContent === "string") {
          // Pass modified content to subsequent hooks, and remember that
          // a rewrite happened so the final result carries the new content
          // back to the caller. C14 prompt hooks rely on this — prior
          // behaviour dropped modifications silently once the loop ended.
          payload = { ...payload, content: result.modifiedContent };
          anyModified = true;
        }
      } catch (error) {
        if (stats) stats.errors++;
        // Hook errors should never crash the agent — log and continue
        warnings.push(
          `Hook ${handler.name} error: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    if (warnings.length > 0) {
      const base =
        anyModified && payload.content !== originalContent
          ? { action: "warn" as const, modifiedContent: payload.content }
          : { action: "warn" as const };
      return { ...base, message: warnings.join("; ") };
    }

    if (anyModified && payload.content !== originalContent) {
      return { action: "modify", modifiedContent: payload.content };
    }

    return { action: "allow" };
  }

  /**
   * Fire hooks synchronously (for performance-critical paths).
   * Only runs sync handlers — skips async ones but records a warning so
   * callers see which hooks were bypassed instead of silent omission.
   *
   * Opus audit (2026-04-15): prior implementation silently swallowed all
   * errors and warnings — hooks could fail completely without any signal.
   * Now errors surface as aggregated warnings, warn results propagate,
   * and `contextPrefix` from any hook is concatenated and returned so
   * runtime can thread recovered content into the next prompt.
   */
  fireSync(payload: HookPayload): HookResult {
    if (this.paused) return { action: "allow" };

    const handlers = this.hooks.get(payload.event) ?? [];
    const activeHandlers = handlers.filter((h) => this.isHookActiveInProfile(h.profile));

    const warnings: string[] = [];
    let contextPrefix: string | undefined;

    for (const handler of activeHandlers) {
      // C14: Sync-path predicate. Async predicates (rare) are treated as
      // "condition unknown" and cause the handler to skip — sync hooks
      // have no way to await a thenable without breaking sync semantics.
      if (handler.if) {
        try {
          const result = handler.if(payload);
          if (result && typeof result === "object" && "then" in result) {
            warnings.push(
              `Hook ${handler.name} if-predicate is async and was skipped on the sync path`,
            );
            continue;
          }
          if (!result) continue;
        } catch (error) {
          warnings.push(
            `Hook ${handler.name} if-predicate error: ${error instanceof Error ? error.message : "unknown"}`,
          );
          continue;
        }
      }

      const stats = this.stats.get(handler.name);
      if (stats) stats.fires++;
      try {
        const result = handler.handler(payload);
        if (result && typeof result === "object" && "then" in result) {
          warnings.push(`Hook ${handler.name} is async and was skipped on the sync path`);
          continue;
        }
        const syncResult = result as HookResult;
        if (syncResult.contextPrefix) {
          contextPrefix = contextPrefix
            ? `${contextPrefix}\n\n${syncResult.contextPrefix}`
            : syncResult.contextPrefix;
        }
        if (syncResult.action === "block") {
          if (stats) stats.blocks++;
          return {
            ...syncResult,
            hookName: handler.name,
            warnings: warnings.length ? warnings : undefined,
            contextPrefix,
          };
        }
        if (syncResult.action === "defer") {
          // V9 T14.1 — sync path can't await a resolver. Surface a
          // warning so the caller sees the deferral and downgrade to
          // "allow" rather than silently failing. Hook authors who need
          // a real defer must register on an async event.
          if (stats) stats.warnings++;
          warnings.push(
            `Hook ${handler.name} requested defer to ${syncResult.resolver ?? "unknown"} on the sync path; treating as allow`,
          );
        }
        if (syncResult.action === "warn") {
          if (stats) stats.warnings++;
          if (syncResult.message) warnings.push(syncResult.message);
        }
      } catch (error) {
        if (stats) stats.errors++;
        warnings.push(
          `Hook ${handler.name} error: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    if (warnings.length > 0) {
      return { action: "warn", message: warnings.join("; "), warnings, contextPrefix };
    }
    if (contextPrefix) {
      return { action: "allow", contextPrefix };
    }
    return { action: "allow" };
  }

  /**
   * V9 T14.1 — Resolver dispatcher.
   *
   * When a hook returns `{ action: "defer", resolver }`, the engine routes
   * the decision to the named resolver and awaits a final HookResult.
   * Real resolvers (Council, Arena, ExecApprovals, human prompt) plug in
   * via `setDeferResolver(name, fn)` — see below. Until they're wired,
   * the dispatch returns a default-block result so the agent doesn't
   * silently continue past a hook that explicitly asked for review.
   *
   * Honest stub: returns block-with-reason instead of pretending to have
   * consulted the resolver. This is the "honest stubs over silent
   * success" rule from session 2 quality bars.
   */
  private async dispatchDeferral(
    deferResult: HookResult,
    hookName: string,
    payload: HookPayload,
  ): Promise<HookResult> {
    const resolver = deferResult.resolver;
    if (!resolver) {
      return {
        action: "block",
        message: `Hook ${hookName} returned defer without a resolver name`,
      };
    }
    const handler = this.deferResolvers.get(resolver);
    if (!handler) {
      // Honest stub — log the deferral and reject by default. Real
      // resolvers register via `setDeferResolver`; until then a deferral
      // is treated as a block so the agent never bypasses an intentional
      // review request.
      const reason = deferResult.reason ?? "no resolver registered";
      return {
        action: "block",
        message: `Hook ${hookName} deferred to "${resolver}" but no resolver is wired (${reason}); rejecting by default`,
        reason: deferResult.reason,
        resolver,
      };
    }
    const timeout = deferResult.deferTimeoutMs ?? 60_000;
    try {
      // Race the resolver against its timeout. If it doesn't respond in
      // time we surface a block so the agent can't proceed past a stalled
      // resolver.
      const resolved = await Promise.race<HookResult>([
        Promise.resolve(handler(payload, deferResult)),
        new Promise<HookResult>((resolve) =>
          setTimeout(
            () =>
              resolve({
                action: "block",
                message: `Resolver "${resolver}" timed out after ${timeout}ms`,
                resolver,
              }),
            timeout,
          ),
        ),
      ]);
      return resolved;
    } catch (error) {
      return {
        action: "block",
        message: `Resolver "${resolver}" threw: ${error instanceof Error ? error.message : "unknown"}`,
        resolver,
      };
    }
  }

  /**
   * Register a real resolver for a `defer` target. Production code wires
   * Council / Arena / ExecApprovals / human-prompt resolvers via this
   * method. Unregistered resolvers fall through to the honest-stub block
   * branch in `dispatchDeferral`.
   */
  setDeferResolver(name: DeferResolver, handler: DeferResolverHandler): void {
    this.deferResolvers.set(name, handler);
  }

  /** Remove a previously registered resolver. */
  clearDeferResolver(name: DeferResolver): void {
    this.deferResolvers.delete(name);
  }

  /** List the currently registered resolver names. */
  getRegisteredDeferResolvers(): readonly DeferResolver[] {
    return Array.from(this.deferResolvers.keys());
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

  /**
   * C14: query by handler kind. Useful for UI surfaces that want to
   * render "agent consultations" differently from "tool interceptions",
   * or for tests that want to assert only prompt-rewriting hooks are
   * registered on UserPromptSubmit.
   */
  getHooksByKind(kind: HookKind): readonly HookHandler[] {
    const all: HookHandler[] = [];
    for (const handlers of this.hooks.values()) {
      for (const h of handlers) {
        if ((h.kind ?? "tool") === kind) all.push(h);
      }
    }
    return all;
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

// ── Typed builders (C14) ────────────────────────────────────
//
// Encodes the "prompt" and "agent" kinds as ergonomic factory functions
// rather than demanding hook authors memorise which fields go with which
// kind. Both builders return a plain HookHandler so registration is
// identical to tool hooks — the only difference is the `kind` field that
// downstream consumers (UI, telemetry) can inspect.

export interface PromptRewriteInput {
  readonly name: string;
  readonly profile: HookProfile;
  readonly event?: "UserPromptSubmit" | "SessionStart";
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly if?: (payload: HookPayload) => boolean | Promise<boolean>;
  /**
   * Receives the current prompt text. Return a string to replace the
   * prompt, or null/undefined to leave it unchanged.
   */
  readonly rewrite: (
    prompt: string,
    payload: HookPayload,
  ) => string | null | undefined | Promise<string | null | undefined>;
}

export function definePromptHook(input: PromptRewriteInput): HookHandler {
  return {
    name: input.name,
    event: input.event ?? "UserPromptSubmit",
    profile: input.profile,
    priority: input.priority,
    timeoutMs: input.timeoutMs,
    if: input.if,
    kind: "prompt",
    async handler(payload: HookPayload): Promise<HookResult> {
      const current = payload.content ?? "";
      const rewritten = await Promise.resolve(input.rewrite(current, payload));
      if (typeof rewritten === "string" && rewritten !== current) {
        return { action: "modify", modifiedContent: rewritten };
      }
      return { action: "allow" };
    },
  };
}

export interface AgentConsultInput {
  readonly name: string;
  readonly event: HookEvent;
  readonly profile: HookProfile;
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly if?: (payload: HookPayload) => boolean | Promise<boolean>;
  /**
   * Dispatch a sub-agent or long-running async consult. Returning a
   * HookResult lets the consult either allow, warn, or block — same
   * semantics as tool hooks but marked `kind: "agent"` so callers can
   * surface the latency as "consulting sub-agent".
   */
  readonly consult: (payload: HookPayload) => Promise<HookResult>;
}

export function defineAgentHook(input: AgentConsultInput): HookHandler {
  return {
    name: input.name,
    event: input.event,
    profile: input.profile,
    priority: input.priority,
    timeoutMs: input.timeoutMs ?? 30_000,
    if: input.if,
    kind: "agent",
    async handler(payload: HookPayload): Promise<HookResult> {
      return input.consult(payload);
    },
  };
}
