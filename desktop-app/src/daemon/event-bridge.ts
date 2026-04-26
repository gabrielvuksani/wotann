/**
 * Event Bridge — V9 R-06 + R-07 emitter wiring.
 *
 * The desktop-app has three motif components that LISTEN for window
 * CustomEvents but were shipped without ANY producer in the source
 * tree (per the 2026-04-25 V9 unified gap matrix R-06 / R-07):
 *
 *   - RavensFlightAnimation listens for `wotann:dispatch-fired` — the
 *     daemon's `computer.session.events` topic carries every step /
 *     dispatch lifecycle event. We map session-step events to flights.
 *   - SigilStamp / AppShell listens for `wotann:agent-edit` — the
 *     daemon's `creations.updated` topic fires whenever the agent
 *     writes / creates / deletes a workspace file.
 *   - McpAppOverlay listens for `wotann:mcp-app-mount` — the daemon's
 *     `tool.result` topic carries `_meta.ui.resourceUri` on tool calls
 *     that return MCP UI resources.
 *
 * This bridge subscribes to those three daemon notification streams
 * and re-dispatches them as window CustomEvents so the existing
 * listeners light up. It is the single producer site for all three
 * events in desktop-app/src/.
 *
 * INVOCATION
 * ──────────
 * Mounted once at the App tree root via a `useEffect`:
 *
 *     useEffect(() => {
 *       const bridge = createEventBridge();
 *       return bridge.dispose;
 *     }, []);
 *
 * Tests inject a `listenerFactory` so they can drive synthetic
 * daemon events without standing up Tauri.
 *
 * QUALITY BARS
 * ────────────
 *  - QB #6 honest stubs: when Tauri's `listen()` rejects (e.g. dev
 *    runs in a browser), the bridge logs once and stays inert. It
 *    NEVER silently swallows the error.
 *  - QB #7 per-instance state: each `createEventBridge()` call owns
 *    its own dispose chain. No module-global subscription leaks.
 *  - QB #11 sibling-site safety: this is the SOLE place that
 *    re-dispatches daemon events as window CustomEvents. Any future
 *    surface that needs the same fan-out should consume the window
 *    events, NOT register a parallel listener with Tauri.
 *  - QB #14 claim verification: dispose() is idempotent and returns
 *    a stable boolean for tests to assert against.
 */

// ── Public types ────────────────────────────────────────────

/**
 * Detail payload emitted by `wotann:dispatch-fired`. Mirrors the
 * shape consumed by `App.tsx`'s RavensFlightAnimation subscriber so
 * the dispatched flight has a stable id and (optional) viewport
 * coordinates.
 */
export interface DispatchFiredDetail {
  readonly id?: string;
  readonly from?: { readonly x: number; readonly y: number };
  readonly to?: { readonly x: number; readonly y: number };
}

/**
 * Detail payload emitted by `wotann:agent-edit`. Mirrors the
 * AppShell subscriber's `AgentEditDetail` shape — the file path the
 * agent touched and the kind of change.
 */
export interface AgentEditDetail {
  readonly path: string;
  readonly kind: "modified" | "created" | "deleted";
}

/**
 * Detail payload emitted by `wotann:mcp-app-mount`. Mirrors the
 * McpAppOverlay subscriber's `McpAppMountDetail` shape.
 */
export interface McpAppMountDetail {
  readonly resourceUri: string;
  readonly title?: string;
}

/**
 * Minimal Tauri-`listen`-shaped factory. Production callers leave
 * this undefined so the bridge dynamically imports
 * `@tauri-apps/api/event`. Tests inject their own factory that
 * returns deterministic disposers.
 */
export interface DaemonListenerFactory {
  /**
   * Subscribe to a daemon notification topic. Returns a disposer.
   * The handler receives the raw payload as JSON-decoded data.
   */
  listen<T = unknown>(
    topic: string,
    handler: (event: { readonly payload: T }) => void,
  ): Promise<() => void>;
}

/**
 * Optional emit target — defaults to `globalThis.window` when
 * present (browser / Tauri webview), otherwise to `globalThis`.
 * Tests inject a fresh `EventTarget` so each test exercises the
 * bridge in isolation.
 */
export type EmitTarget = Pick<EventTarget, "dispatchEvent">;

/** Logger surface — defaults to `console.warn`. */
export type BridgeLogger = (msg: string, details: Readonly<Record<string, unknown>>) => void;

export interface CreateEventBridgeOptions {
  readonly listenerFactory?: DaemonListenerFactory;
  readonly emitTarget?: EmitTarget;
  readonly logger?: BridgeLogger;
}

export interface EventBridgeHandle {
  /** Unsubscribes from every daemon listener. Idempotent. */
  readonly dispose: () => void;
  /** Resolves once every daemon listener subscription has settled. */
  readonly ready: Promise<void>;
  /**
   * Per-topic count of forwarded events. Useful for tests / ops to
   * verify the bridge is hot.
   */
  readonly getCounts: () => Readonly<Record<string, number>>;
  /**
   * `true` once `dispose()` has been called. Stable across repeated
   * calls — second `dispose()` returns the same value.
   */
  readonly isDisposed: () => boolean;
}

// ── Topic constants ─────────────────────────────────────────

/**
 * Topics the daemon emits via Tauri events / SSE. Keep these in
 * sync with `src/session/dispatch/companion-bridge.ts`'s topic
 * mapping. Co-locating them here keeps the producer-consumer
 * contract grep-able.
 */
export const DAEMON_TOPIC = {
  /** Maps to companion-bridge `creations.updated`. */
  creationsUpdated: "wotann:creations-updated",
  /** Maps to companion-bridge `computer.session.events`. */
  computerSessionEvents: "wotann:computer-session-events",
  /** Maps to companion-bridge `tool.result`. */
  toolResult: "wotann:tool-result",
} as const;

/** Window event names this bridge produces. */
export const WINDOW_EVENT = {
  agentEdit: "wotann:agent-edit",
  dispatchFired: "wotann:dispatch-fired",
  mcpAppMount: "wotann:mcp-app-mount",
} as const;

// ── Internal helpers ────────────────────────────────────────

/**
 * Default listener factory: dynamically imports
 * `@tauri-apps/api/event` so the bridge stays importable in
 * environments without Tauri (vitest, ssr, dev preview). When the
 * import fails, the factory rejects so the caller can log and stay
 * inert.
 */
const defaultListenerFactory: DaemonListenerFactory = {
  listen: async (topic, handler) => {
    const tauri = await import("@tauri-apps/api/event");
    const dispose = await tauri.listen(topic, handler as (e: { payload: unknown }) => void);
    return dispose;
  },
};

/**
 * Resolve the emit target. Preference order: caller override →
 * `globalThis.window` → `globalThis`. The fallback to `globalThis`
 * keeps the bridge importable inside web workers / SSR environments
 * where `window` is undefined; consumers in those contexts can
 * still observe the events via the same EventTarget.
 */
function resolveEmitTarget(override?: EmitTarget): EmitTarget {
  if (override) return override;
  if (typeof globalThis !== "undefined") {
    const g = globalThis as { window?: EventTarget };
    if (g.window && typeof g.window.dispatchEvent === "function") return g.window;
    return globalThis as unknown as EmitTarget;
  }
  // Last-resort stub — never reached in real environments. Returns
  // a no-op target so callers don't crash with "undefined.dispatchEvent".
  return {
    dispatchEvent: () => true,
  };
}

/**
 * Coerce a raw daemon-side `creations.updated` payload into the
 * window event shape AppShell expects. The daemon's UnifiedEvent
 * `file-write` shape carries `path` + an optional `deleted` flag;
 * we map it onto the SigilKind union.
 *
 * Returns `null` when the payload lacks a usable path.
 */
function mapCreationToAgentEdit(payload: unknown): AgentEditDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    readonly path?: unknown;
    readonly deleted?: unknown;
    readonly kind?: unknown;
    readonly action?: unknown;
  };
  const path = typeof p.path === "string" ? p.path : null;
  if (!path) return null;
  // Honour an explicit `kind` if upstream sets one (forward-compat).
  if (p.kind === "modified" || p.kind === "created" || p.kind === "deleted") {
    return { path, kind: p.kind };
  }
  if (p.deleted === true || p.action === "creation-deleted") {
    return { path, kind: "deleted" };
  }
  if (p.action === "creation-saved") {
    return { path, kind: "created" };
  }
  return { path, kind: "modified" };
}

/**
 * Coerce a raw daemon-side `computer.session.events` payload into
 * the dispatch-fired shape RavensFlightAnimation expects. Only
 * `step` events fire a flight — the other lifecycle types
 * (created/claimed/done/error/heartbeat) don't have a viewport
 * meaning here.
 *
 * Returns `null` when the payload doesn't represent a step.
 */
function mapSessionEventToDispatch(payload: unknown): DispatchFiredDetail | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    readonly type?: unknown;
    readonly sessionId?: unknown;
    readonly seq?: unknown;
    readonly payload?: { readonly from?: unknown; readonly to?: unknown };
  };
  if (p.type !== "step" && p.type !== "computer-session-step") return null;
  const sessionId = typeof p.sessionId === "string" ? p.sessionId : "session";
  const seq = typeof p.seq === "number" ? p.seq : 0;
  const id = `${sessionId}-${seq}`;
  // Pull through optional viewport coords if the daemon emits them.
  const inner = p.payload ?? {};
  const from =
    inner.from && typeof inner.from === "object"
      ? coerceCoord(inner.from)
      : undefined;
  const to =
    inner.to && typeof inner.to === "object"
      ? coerceCoord(inner.to)
      : undefined;
  return { id, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/**
 * Coerce an unknown into a `{x,y}` coord. Returns undefined when
 * the shape is malformed.
 */
function coerceCoord(v: unknown): { readonly x: number; readonly y: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const c = v as { x?: unknown; y?: unknown };
  if (typeof c.x === "number" && typeof c.y === "number") {
    return { x: c.x, y: c.y };
  }
  return undefined;
}

/**
 * Coerce a raw daemon-side `tool.result` payload into a mount
 * detail when the tool result carries `_meta.ui.resourceUri` — per
 * the MCP UI resource convention. Tools without that metadata are
 * dropped (returns null) so the overlay only opens for genuine UI
 * tool results.
 */
function mapToolResultToMount(payload: unknown): McpAppMountDetail | null {
  if (!payload || typeof payload !== "object") return null;
  // The result envelope shape varies by RPC layer — accept either
  // `{ result: { _meta: ... } }` (JSON-RPC) or a flat
  // `{ _meta: ... }` shape.
  const root = payload as {
    readonly result?: unknown;
    readonly _meta?: unknown;
    readonly title?: unknown;
  };
  const candidate =
    root._meta !== undefined
      ? root
      : root.result && typeof root.result === "object"
        ? (root.result as { readonly _meta?: unknown; readonly title?: unknown })
        : null;
  if (!candidate) return null;
  const meta = (candidate as { readonly _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return null;
  const ui = (meta as { readonly ui?: unknown }).ui;
  if (!ui || typeof ui !== "object") return null;
  const resourceUri = (ui as { readonly resourceUri?: unknown }).resourceUri;
  if (typeof resourceUri !== "string" || resourceUri.length === 0) return null;
  const title = (candidate as { readonly title?: unknown }).title;
  return {
    resourceUri,
    ...(typeof title === "string" ? { title } : {}),
  };
}

// ── Bridge factory ──────────────────────────────────────────

/**
 * Construct an event bridge. The bridge subscribes to three daemon
 * topics on construction and re-dispatches each event as a
 * `CustomEvent` on the resolved emit target.
 *
 * Subscriptions are best-effort: a failure on one topic does NOT
 * cancel the other two. Each failure is logged once via the
 * configured logger.
 */
export function createEventBridge(
  options: CreateEventBridgeOptions = {},
): EventBridgeHandle {
  const factory = options.listenerFactory ?? defaultListenerFactory;
  const target = resolveEmitTarget(options.emitTarget);
  const logger =
    options.logger ??
    ((msg, details) => {
      // eslint-disable-next-line no-console
      console.warn(`[event-bridge] ${msg}`, details);
    });

  // Per-instance state (QB #7).
  const counts = new Map<string, number>();
  const incrementCount = (eventName: string): void => {
    counts.set(eventName, (counts.get(eventName) ?? 0) + 1);
  };

  const disposers: Array<() => void> = [];
  let disposed = false;

  // Wrap dispatch so a malformed listener handler / hostile target
  // can never poison the entire bridge.
  const safeDispatch = (eventName: string, detail: unknown): void => {
    if (disposed) return;
    try {
      const ev = new CustomEvent(eventName, { detail });
      target.dispatchEvent(ev);
      incrementCount(eventName);
    } catch (err) {
      logger("dispatch threw — dropping event", {
        eventName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Each subscription is awaited in parallel; the bridge's `ready`
  // promise resolves once every subscription has either succeeded
  // or rejected (rejections logged, never thrown).
  const subscribe = async (
    topic: string,
    handler: (payload: unknown) => void,
  ): Promise<void> => {
    try {
      const dispose = await factory.listen<unknown>(topic, (event) => {
        try {
          handler(event.payload);
        } catch (err) {
          logger("handler threw — dropping payload", {
            topic,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
      if (disposed) {
        // Race: dispose() was called between subscribe start and
        // resolution. Honour the dispose immediately.
        try {
          dispose();
        } catch {
          // best-effort
        }
        return;
      }
      disposers.push(dispose);
    } catch (err) {
      logger("listen subscription failed — bridge will not forward this topic", {
        topic,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const ready = Promise.all([
    subscribe(DAEMON_TOPIC.creationsUpdated, (payload) => {
      const detail = mapCreationToAgentEdit(payload);
      if (!detail) return;
      safeDispatch(WINDOW_EVENT.agentEdit, detail);
    }),
    subscribe(DAEMON_TOPIC.computerSessionEvents, (payload) => {
      const detail = mapSessionEventToDispatch(payload);
      if (!detail) return;
      safeDispatch(WINDOW_EVENT.dispatchFired, detail);
    }),
    subscribe(DAEMON_TOPIC.toolResult, (payload) => {
      const detail = mapToolResultToMount(payload);
      if (!detail) return;
      safeDispatch(WINDOW_EVENT.mcpAppMount, detail);
    }),
  ]).then(() => undefined);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const fn of disposers) {
      try {
        fn();
      } catch {
        // best-effort
      }
    }
    disposers.length = 0;
  };

  return {
    dispose,
    ready,
    getCounts: () => Object.fromEntries(counts),
    isDisposed: () => disposed,
  };
}

// ── Convenience emitters (used by tests + by callers that want
//    to fire events without typing the CustomEvent boilerplate) ──

/**
 * Fire the `wotann:agent-edit` window event directly. Use this from
 * any surface that knows about an agent edit but isn't going through
 * the daemon RPC layer (e.g. local optimistic updates).
 */
export function emitAgentEdit(detail: AgentEditDetail): boolean {
  if (typeof globalThis === "undefined") return false;
  const g = globalThis as { window?: EventTarget };
  const target = g.window ?? (globalThis as unknown as EventTarget);
  if (typeof target.dispatchEvent !== "function") return false;
  return target.dispatchEvent(new CustomEvent(WINDOW_EVENT.agentEdit, { detail }));
}

/**
 * Fire the `wotann:dispatch-fired` window event directly. Producers
 * that already know the source/destination viewport coords (e.g.
 * the ChatView reducer when sending a message) can use this instead
 * of going through the daemon round-trip.
 */
export function emitDispatchFired(detail: DispatchFiredDetail): boolean {
  if (typeof globalThis === "undefined") return false;
  const g = globalThis as { window?: EventTarget };
  const target = g.window ?? (globalThis as unknown as EventTarget);
  if (typeof target.dispatchEvent !== "function") return false;
  return target.dispatchEvent(new CustomEvent(WINDOW_EVENT.dispatchFired, { detail }));
}

/**
 * Fire the `wotann:mcp-app-mount` window event directly. Used by
 * surfaces that want to open an MCP app overlay without waiting
 * for a daemon-driven tool result.
 */
export function emitMcpAppMount(detail: McpAppMountDetail): boolean {
  if (typeof globalThis === "undefined") return false;
  const g = globalThis as { window?: EventTarget };
  const target = g.window ?? (globalThis as unknown as EventTarget);
  if (typeof target.dispatchEvent !== "function") return false;
  return target.dispatchEvent(new CustomEvent(WINDOW_EVENT.mcpAppMount, { detail }));
}
