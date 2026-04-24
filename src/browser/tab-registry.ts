/**
 * Tab Registry — V9 Tier 10 T10.2.
 *
 * Per-target ownership map for the Agentic Browser. Tracks which browser
 * tabs are driven by the user versus those spawned by agent tasks, and
 * enforces a hard cap on the number of simultaneous agent-owned tabs
 * (default 3, configurable via `maxAgentTabs`).
 *
 * This module is a pure, synchronous, in-memory data structure with zero
 * I/O and zero external dependencies. Per Quality Bar #7, there is NO
 * module-level mutable state: `createTabRegistry()` returns a fresh
 * closure every call. Per Quality Bar #6, mutations return typed
 * `{ok: true|false}` results rather than throwing. Per Quality Bar #13,
 * there are no `process.env` reads — time is injected via `options.now`
 * so tests can use a deterministic clock.
 *
 * Integration: `src/browser/agentic-browser.ts` (T10.1) owns exactly one
 * TabRegistry instance. Every `browser.spawn_tab` RPC registers an agent
 * tab; every `browser.close_tab` unregisters it. The CDP
 * `Target.attachedToTarget` / `Target.detachedFromTarget` stream is
 * mirrored into `register` / `unregister` so the map is the single
 * source of truth for "how many agent tabs does task X have open?".
 *
 * Exit-criteria matrix row (T10.2): registering a 4th agent tab when
 * `maxAgentTabs=3` must be rejected with `max-agent-tabs-exceeded`.
 */

// ── Types ──────────────────────────────────────────────────

/**
 * Who owns a browser tab. The `agent` variant carries the taskId so
 * multiple agent tasks running concurrently can be distinguished and
 * their tabs independently enumerated / cleaned up.
 */
export type TabOwner =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly taskId: string };

/**
 * A tab tracked by the registry. Immutable snapshot: every mutation
 * produces a fresh object (per the codebase's immutability convention).
 * `tabId` is whatever stable identifier the CDP target stream uses
 * (typically a UUID-like string); the registry treats it opaquely.
 */
export interface RegisteredTab {
  readonly tabId: string;
  readonly owner: TabOwner;
  readonly url?: string;
  readonly registeredAt: number;
  readonly lastSeenAt: number;
}

export interface RegisterTabOptions {
  readonly tabId: string;
  readonly owner: TabOwner;
  readonly url?: string;
}

export interface TabRegistryOptions {
  /** Maximum concurrent agent-owned tabs. Default 3 per V9 spec. */
  readonly maxAgentTabs?: number;
  /** Injected clock. Default `Date.now`. Allows deterministic testing. */
  readonly now?: () => number;
}

/**
 * Result of `register`. Structured failure per QB #6 (honest failures).
 * Callers discriminate on `ok` and, on failure, branch on `error` for
 * user-facing messaging.
 */
export type RegisterResult =
  | { readonly ok: true; readonly tab: RegisteredTab }
  | {
      readonly ok: false;
      readonly error: "duplicate-tab-id" | "max-agent-tabs-exceeded";
    };

export interface TabRegistryListFilter {
  readonly owner?: TabOwner["kind"];
  readonly taskId?: string;
}

export interface TabRegistryCounts {
  readonly user: number;
  readonly agent: number;
}

export interface TabRegistry {
  readonly register: (opts: RegisterTabOptions) => RegisterResult;
  readonly unregister: (tabId: string) => boolean;
  readonly get: (tabId: string) => RegisteredTab | null;
  readonly list: (filter?: TabRegistryListFilter) => readonly RegisteredTab[];
  readonly countByOwner: () => TabRegistryCounts;
  readonly touchLastSeen: (tabId: string) => boolean;
  readonly purgeStale: (olderThanMs: number) => number;
}

// ── Defaults ──────────────────────────────────────────────

const DEFAULT_MAX_AGENT_TABS = 3;

// ── Helpers (module-scoped pure functions — safe because they
//    are stateless and only read their arguments) ─────────────

function ownersEqual(a: TabOwner, b: TabOwner): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "user" && b.kind === "user") return true;
  if (a.kind === "agent" && b.kind === "agent") {
    return a.taskId === b.taskId;
  }
  return false;
}

function matchesFilter(tab: RegisteredTab, filter: TabRegistryListFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.owner !== undefined && tab.owner.kind !== filter.owner) {
    return false;
  }
  if (filter.taskId !== undefined) {
    if (tab.owner.kind !== "agent") return false;
    if (tab.owner.taskId !== filter.taskId) return false;
  }
  return true;
}

// ── Factory ───────────────────────────────────────────────

/**
 * Construct an isolated tab registry. Each call returns a fresh
 * closure — no two registries share state, so callers can safely
 * spin up per-session registries without cross-contamination.
 *
 * Per QB #7 (per-call state): this function is the ONLY surface the
 * module exports for mutation. There are no module-level maps or
 * counters.
 */
export function createTabRegistry(options?: TabRegistryOptions): TabRegistry {
  const maxAgentTabs = options?.maxAgentTabs ?? DEFAULT_MAX_AGENT_TABS;
  const now = options?.now ?? Date.now;

  // Per-registry mutable state. Enclosed in this closure; invisible to
  // other modules and to other registry instances.
  const tabs = new Map<string, RegisteredTab>();

  /**
   * Count how many currently-registered tabs belong to agent tasks.
   * O(n) over the map; registries typically hold <10 tabs so this is
   * cheap. If cardinality grows we can add a dedicated counter, but
   * the single source of truth staying the map avoids the usual
   * "counter drifted out of sync" bug class.
   */
  function countAgent(): number {
    let c = 0;
    for (const tab of tabs.values()) {
      if (tab.owner.kind === "agent") c += 1;
    }
    return c;
  }

  function register(opts: RegisterTabOptions): RegisterResult {
    if (tabs.has(opts.tabId)) {
      return { ok: false, error: "duplicate-tab-id" };
    }
    if (opts.owner.kind === "agent" && countAgent() >= maxAgentTabs) {
      return { ok: false, error: "max-agent-tabs-exceeded" };
    }
    const ts = now();
    const tab: RegisteredTab =
      opts.url !== undefined
        ? {
            tabId: opts.tabId,
            owner: opts.owner,
            url: opts.url,
            registeredAt: ts,
            lastSeenAt: ts,
          }
        : {
            tabId: opts.tabId,
            owner: opts.owner,
            registeredAt: ts,
            lastSeenAt: ts,
          };
    tabs.set(opts.tabId, tab);
    return { ok: true, tab };
  }

  function unregister(tabId: string): boolean {
    return tabs.delete(tabId);
  }

  function get(tabId: string): RegisteredTab | null {
    return tabs.get(tabId) ?? null;
  }

  function list(filter?: TabRegistryListFilter): readonly RegisteredTab[] {
    const result: RegisteredTab[] = [];
    for (const tab of tabs.values()) {
      if (matchesFilter(tab, filter)) result.push(tab);
    }
    // Sort by registeredAt ascending for deterministic ordering. Ties
    // broken by tabId so two tabs registered at the same tick (rare with
    // a real clock, routine with a deterministic test clock) still
    // produce a stable order.
    result.sort((a, b) => {
      if (a.registeredAt !== b.registeredAt) {
        return a.registeredAt - b.registeredAt;
      }
      return a.tabId < b.tabId ? -1 : a.tabId > b.tabId ? 1 : 0;
    });
    return result;
  }

  function countByOwner(): TabRegistryCounts {
    let user = 0;
    let agent = 0;
    for (const tab of tabs.values()) {
      if (tab.owner.kind === "user") user += 1;
      else agent += 1;
    }
    return { user, agent };
  }

  function touchLastSeen(tabId: string): boolean {
    const existing = tabs.get(tabId);
    if (!existing) return false;
    const updated: RegisteredTab = { ...existing, lastSeenAt: now() };
    tabs.set(tabId, updated);
    return true;
  }

  function purgeStale(olderThanMs: number): number {
    if (olderThanMs < 0) return 0;
    const threshold = now() - olderThanMs;
    let removed = 0;
    // Collect first, mutate second — iterating and deleting a Map in
    // a single pass is technically safe in V8 but makes the intent
    // murky. The two-pass form is unambiguous.
    const toDelete: string[] = [];
    for (const tab of tabs.values()) {
      if (tab.lastSeenAt < threshold) toDelete.push(tab.tabId);
    }
    for (const id of toDelete) {
      if (tabs.delete(id)) removed += 1;
    }
    return removed;
  }

  // Return a closure-bound interface. All state lives above in `tabs`;
  // callers receive only the public API. `ownersEqual` is exported as
  // a named internal helper below for completeness — it is not part of
  // the public surface.
  return {
    register,
    unregister,
    get,
    list,
    countByOwner,
    touchLastSeen,
    purgeStale,
  };
}

// Exposed for callers (like agentic-browser.ts) that need to compare
// TabOwner values without importing the full registry module twice.
// Kept pure — mutates nothing, reads only its arguments.
export { ownersEqual };
