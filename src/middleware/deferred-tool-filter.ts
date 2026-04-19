/**
 * DeferredToolFilterMiddleware — hide deferred tool schemas from the
 * model until the agent opts in via tool-search.
 *
 * Ported from deer-flow (bytedance/deer-flow) Lane 2:
 *   packages/harness/deerflow/agents/middlewares/deferred_tool_filter_middleware.py
 *
 * Motivation: WOTANN's 65+ skills use progressive disclosure at the
 * skill layer, but the *tool schemas* bound to the model are sent in
 * full on every turn. That tax is ~2-5K tokens per request on large
 * tool catalogs. This middleware maintains a per-session "active set"
 * of tool names and filters everything NOT in the active set out of the
 * list surfaced to the model. Deferred tools remain invocable — callers
 * are expected to keep the full registry for EXECUTION routing, but
 * only bind the active subset to the model.
 *
 * Activation protocol:
 *   - All tools start "deferred" except those the caller marks as
 *     always-active (core tools like `Bash`, `Read`, `Write`, `Edit`,
 *     `Grep`, `Glob`).
 *   - The agent can call the caller-supplied `tool_search` meta-tool
 *     to enable specific deferred tools. Once enabled, those tools
 *     flow into the bound schema list on subsequent turns.
 *   - Context-derived triggers: when the user message mentions known
 *     domain keywords (e.g. "docker", "kubernetes"), the middleware
 *     can opt-in a set of tools automatically.
 *
 * Immutability: the registry uses immutable sets. `enable()` / `disable()`
 * return a new registry; the old reference stays valid.
 */

import type { Middleware, MiddlewareContext } from "./types.js";

// -- Types ----------------------------------------------------------------

export interface DeferredToolEntry {
  readonly name: string;
  /** Optional keyword triggers that auto-enable this tool when seen in user text. */
  readonly keywords?: readonly string[];
  /** When true, the tool is never filtered out. */
  readonly alwaysActive?: boolean;
}

export interface ToolSchemaLike {
  readonly name: string;
  readonly [key: string]: unknown;
}

export interface FilterResult {
  readonly activeTools: readonly string[];
  readonly filteredCount: number;
  readonly enabledByKeyword: readonly string[];
}

export interface DeferredFilterStats {
  readonly totalFilterCalls: number;
  readonly totalFiltered: number;
  readonly totalKeywordEnables: number;
}

// -- Registry -------------------------------------------------------------

/**
 * Immutable per-middleware registry of deferred tools. Enable / disable
 * return a new registry — the old reference is untouched.
 */
export class DeferredToolRegistry {
  private readonly entries: ReadonlyMap<string, DeferredToolEntry>;
  private readonly enabled: ReadonlySet<string>;

  private constructor(
    entries: ReadonlyMap<string, DeferredToolEntry>,
    enabled: ReadonlySet<string>,
  ) {
    this.entries = entries;
    this.enabled = enabled;
  }

  static fromEntries(entries: readonly DeferredToolEntry[]): DeferredToolRegistry {
    const map = new Map<string, DeferredToolEntry>();
    const enabled = new Set<string>();
    for (const entry of entries) {
      map.set(entry.name, entry);
      if (entry.alwaysActive === true) enabled.add(entry.name);
    }
    return new DeferredToolRegistry(map, enabled);
  }

  getEntries(): readonly DeferredToolEntry[] {
    return [...this.entries.values()];
  }

  isRegistered(name: string): boolean {
    return this.entries.has(name);
  }

  isEnabled(name: string): boolean {
    return this.enabled.has(name);
  }

  isDeferred(name: string): boolean {
    return this.entries.has(name) && !this.enabled.has(name);
  }

  enable(name: string): DeferredToolRegistry {
    if (!this.entries.has(name)) return this;
    if (this.enabled.has(name)) return this;
    const nextEnabled = new Set(this.enabled);
    nextEnabled.add(name);
    return new DeferredToolRegistry(this.entries, nextEnabled);
  }

  disable(name: string): DeferredToolRegistry {
    const entry = this.entries.get(name);
    if (!entry) return this;
    if (entry.alwaysActive === true) return this; // cannot disable always-active
    if (!this.enabled.has(name)) return this;
    const nextEnabled = new Set(this.enabled);
    nextEnabled.delete(name);
    return new DeferredToolRegistry(this.entries, nextEnabled);
  }

  /**
   * Walk user text for keyword triggers. Returns the set of tools to
   * enable (names present in the registry that have a matching keyword).
   */
  matchKeywords(userText: string): readonly string[] {
    if (userText.length === 0) return [];
    const lowered = userText.toLowerCase();
    const matched: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry.alwaysActive === true) continue;
      if (!entry.keywords || entry.keywords.length === 0) continue;
      for (const kw of entry.keywords) {
        if (kw.length > 0 && lowered.includes(kw.toLowerCase())) {
          matched.push(entry.name);
          break;
        }
      }
    }
    return matched;
  }

  /**
   * Apply the enabled / deferred filter to a list of tool schemas.
   * Tools not registered at all are passed through (the registry is
   * authoritative only for tools it knows about).
   */
  filter(tools: readonly ToolSchemaLike[]): readonly ToolSchemaLike[] {
    return tools.filter((t) => {
      if (!this.entries.has(t.name)) return true;
      return this.enabled.has(t.name);
    });
  }
}

// -- Middleware class -----------------------------------------------------

export interface DeferredFilterOptions {
  readonly initialEntries?: readonly DeferredToolEntry[];
  /**
   * When true, automatic keyword matching on the user message enables
   * matched tools. Default: true.
   */
  readonly autoEnableOnKeywords?: boolean;
}

/**
 * DeferredToolFilterMiddleware holds a DeferredToolRegistry and applies
 * it to tool lists. Per-session state — the registry — lives on the
 * instance. Reassigning the registry through `setRegistry()` replaces
 * it atomically (immutable swap).
 */
export class DeferredToolFilterMiddleware {
  private registry: DeferredToolRegistry;
  private readonly autoEnable: boolean;

  private totalFilterCalls = 0;
  private totalFiltered = 0;
  private totalKeywordEnables = 0;

  constructor(options: DeferredFilterOptions = {}) {
    this.registry = DeferredToolRegistry.fromEntries(options.initialEntries ?? []);
    this.autoEnable = options.autoEnableOnKeywords ?? true;
  }

  getRegistry(): DeferredToolRegistry {
    return this.registry;
  }

  setRegistry(next: DeferredToolRegistry): void {
    this.registry = next;
  }

  enable(name: string): void {
    this.registry = this.registry.enable(name);
  }

  disable(name: string): void {
    this.registry = this.registry.disable(name);
  }

  /**
   * Scan the user message for keyword triggers, enable matched tools,
   * and return the list of newly-enabled tool names (for tracing).
   */
  applyKeywordTriggers(userText: string): readonly string[] {
    if (!this.autoEnable) return [];
    const matched = this.registry.matchKeywords(userText);
    if (matched.length === 0) return [];
    let next = this.registry;
    const actuallyEnabled: string[] = [];
    for (const name of matched) {
      if (!next.isEnabled(name)) {
        next = next.enable(name);
        actuallyEnabled.push(name);
      }
    }
    if (actuallyEnabled.length > 0) {
      this.registry = next;
      this.totalKeywordEnables += actuallyEnabled.length;
    }
    return actuallyEnabled;
  }

  /**
   * Filter a list of tool schemas using the current registry. Returns
   * the filter result for diagnostics.
   */
  filterTools(tools: readonly ToolSchemaLike[]): FilterResult {
    this.totalFilterCalls++;
    const filtered = this.registry.filter(tools);
    const dropped = tools.length - filtered.length;
    this.totalFiltered += dropped;
    return {
      activeTools: filtered.map((t) => t.name),
      filteredCount: dropped,
      enabledByKeyword: [],
    };
  }

  getStats(): DeferredFilterStats {
    return {
      totalFilterCalls: this.totalFilterCalls,
      totalFiltered: this.totalFiltered,
      totalKeywordEnables: this.totalKeywordEnables,
    };
  }

  reset(): void {
    this.totalFilterCalls = 0;
    this.totalFiltered = 0;
    this.totalKeywordEnables = 0;
  }
}

// -- Context extension ----------------------------------------------------

declare module "./types.js" {
  interface MiddlewareContext {
    /** Names of tools surfaced to the model on this turn. */
    boundToolNames?: readonly string[];
    /** Tool names newly enabled by keyword triggers on this turn. */
    deferredToolsEnabledOnTurn?: readonly string[];
  }
}

// -- Pipeline adapter -----------------------------------------------------

export function createDeferredToolFilterMiddleware(
  instance: DeferredToolFilterMiddleware,
): Middleware {
  return {
    name: "DeferredToolFilter",
    order: 14.5,
    before(ctx: MiddlewareContext): MiddlewareContext {
      const enabledByKeyword = instance.applyKeywordTriggers(ctx.userMessage);

      const registry = instance.getRegistry();
      const activeToolNames: string[] = [];
      for (const entry of registry.getEntries()) {
        if (registry.isEnabled(entry.name)) activeToolNames.push(entry.name);
      }

      return {
        ...ctx,
        boundToolNames: activeToolNames,
        deferredToolsEnabledOnTurn: enabledByKeyword,
      };
    },
  };
}
