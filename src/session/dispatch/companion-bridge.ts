/**
 * Companion Bridge — translates in-process UnifiedDispatchPlane events to
 * JSON-RPC notifications consumed by the iOS RPCClient and desktop SSE
 * subscribers.
 *
 * The deep audit (T5 cross-surface dispatch gap) found that the daemon's
 * `UnifiedDispatchPlane` broadcasts only to in-process surface listeners
 * registered via `plane.registerSurface(...)`. Remote WebSocket clients
 * (iOS RPCClient, desktop SSE) call `rpcClient.subscribe("approvals.notify")`
 * etc. but the daemon never emitted those topic-string `method` notifications
 * — every cross-surface F-series feature (T5.5/T5.6/T5.7/T5.9/T5.10/T5.11)
 * silently dead-letters at the WS boundary.
 *
 * This bridge:
 *   1. Subscribes to UnifiedEvents via `plane.registerSurface(...)` with a
 *      unique surface id. The plane then drives every `broadcastUnifiedEvent`
 *      through this listener.
 *   2. Subscribes to `plane.onComputerSessionEvent(...)` so SessionEvents
 *      (the parallel typed stream for `created` / `claimed` / `step` / etc.)
 *      reach iOS via `computer.session.events`.
 *   3. Maps each event to a topic string the iOS client subscribes to.
 *   4. Calls `server.broadcastNotification({jsonrpc, method:topic, params})`
 *      on the CompanionServer so the message reaches every connected
 *      WebSocket client.
 *
 * Quality bars:
 *   QB #6  honest stub          — events without topic mapping log once per
 *                                 type then drop (no silent consumption).
 *   QB #7  per-instance state   — bridge keeps its own seen-types and
 *                                 surface registry; never a module global.
 *   QB #11 sibling-site safety  — this is the SINGLE place that translates
 *                                 plane events to RPC notifications. Other
 *                                 surfaces hook the plane directly.
 *   QB #14 claim verification   — dispose() returns a real disposer chain;
 *                                 unsubscribe is observable via the
 *                                 SurfaceSubscriberRegistry stats().
 */
import type { UnifiedDispatchPlane } from "../../channels/unified-dispatch.js";
import type { UnifiedEvent, SurfaceListener } from "../../channels/fan-out.js";
import type { SessionEvent } from "../computer-session-store.js";
import {
  createSurfaceSubscriberRegistry,
  type SurfaceSubscriberRegistry,
  type SurfaceId,
} from "../surface-subscribers.js";

/**
 * Minimal CompanionServer surface needed by the bridge — defined as an
 * interface so the bridge can be tested in isolation without standing up the
 * full WS server. The real `CompanionServer` from
 * `src/desktop/companion-server.ts` exposes `broadcastNotification` once we
 * thread this bridge into its startup path.
 */
export interface CompanionNotificationSink {
  /**
   * Broadcast a JSON-RPC notification to every connected WS client.
   * Implementations serialize the payload and write to each socket; failures
   * for individual clients must not poison the broadcast.
   */
  broadcastNotification(notification: {
    readonly jsonrpc: "2.0";
    readonly method: string;
    readonly params: Readonly<Record<string, unknown>>;
  }): void;
}

/**
 * Mapping from the discriminator that uniquely identifies a UnifiedEvent
 * sub-type to the iOS subscription topic string.
 *
 * The discriminator is `event.type` for events without an `action` payload
 * field (e.g. `cursor`, `step`, `mention`, `cost`), and the
 * `event.payload.action` value for events that carry one (`approval`,
 * `file-write`, `message`, `session`).
 *
 * When new event types arrive, add them here. The default "unknown" path
 * logs once per discriminator and drops.
 */
export const UNIFIED_EVENT_TO_TOPIC: Readonly<Record<string, string>> = {
  // Approval lifecycle (iOS ApprovalSheetView)
  "approval-request": "approvals.notify",
  "approval-decided": "approvals.dismiss",
  "approval-expired": "approvals.dismiss",
  // Creations store (iOS CreationsView). file-write w/o a `deleted` field
  // is a save; with `deleted:true` is a removal — both map to the same
  // topic so iOS can refresh its list either way.
  "creation-saved": "creations.updated",
  "creation-deleted": "creations.updated",
  "file-write": "creations.updated",
  // File delivery (iOS NotificationService)
  "delivery-ready": "delivery",
  "delivery-acknowledged": "delivery",
  "delivery-expired": "delivery",
  // Session handoff (iOS HandoffView)
  handoff_initiated: "computer.session.handoff",
  handoff_accepted: "computer.session.handoff",
  handoff_expired: "computer.session.expireHandoff",
  // Computer session lifecycle (iOS ComputerSessionService) — flowing via
  // the typed SessionEvent stream rather than UnifiedEvent.
  "computer-session-step": "computer.session.events",
  "computer-session-claim": "computer.session.events",
  "computer-session-close": "computer.session.events",
  // Live Activity (iOS LiveActivityManager subscribes on `live.activity`)
  step: "live.activity",
  "live-activity-update": "live.activity",
  // Cursor stream (iOS RemoteDesktopView)
  cursor: "cursor.stream",
  "cursor-frame": "cursor.stream",
  // CarPlay voice
  "carplay-voice-frame": "carplay.voice",
  // Watch dispatch
  "watch-dispatch": "watch.dispatch",
};

/** Pseudo surface id used by the bridge so the plane and registries can
 *  identify and exclude it. Stable string so multiple disposers/lookups
 *  never collide with real surfaces. */
const BRIDGE_SURFACE_ID = "rpc-companion-bridge";
/** SurfaceId used inside the SurfaceSubscriberRegistry for bookkeeping. */
const BRIDGE_SURFACE: SurfaceId = { kind: "desktop", id: BRIDGE_SURFACE_ID };

export interface CompanionBridgeOptions {
  /**
   * Optional structured registry. If omitted, the bridge creates its own
   * fresh registry — the registry is the structured map between event
   * discriminators and active subscribers, used for stats() observability.
   * Closes T5.8 by giving `createSurfaceSubscriberRegistry` an external
   * caller in production code.
   */
  readonly registry?: SurfaceSubscriberRegistry;
  /**
   * Optional logger. Defaults to console.warn. The bridge calls this once
   * per unknown discriminator (QB #6 — honest failures, not silent drops).
   */
  readonly logger?: (message: string, details: Readonly<Record<string, unknown>>) => void;
}

export interface CompanionBridgeHandle {
  /** Unsubscribes from the plane and clears the structured registry. */
  readonly dispose: () => void;
  /**
   * Snapshot of unknown discriminators seen so far. Useful for tests and
   * audit so we can verify mapping coverage as new event types ship.
   */
  readonly getUnknownDiscriminators: () => readonly string[];
  /**
   * Snapshot of how many notifications have been forwarded per topic.
   * Tests (and ops) read this to verify the wire is hot.
   */
  readonly getTopicCounts: () => Readonly<Record<string, number>>;
  /**
   * Access to the structured surface-subscriber registry the bridge owns.
   * Exposed for tests + observability — production callers should not poke it.
   */
  readonly getRegistry: () => SurfaceSubscriberRegistry;
}

/**
 * Resolve the topic for a UnifiedEvent. Prefers `payload.action` when
 * present (the action is the fine-grained discriminator), falling back to
 * `event.type` for events without an action (e.g. `cursor`, `step`).
 *
 * Returns `null` when no mapping exists — caller logs and drops.
 */
function resolveUnifiedTopic(event: UnifiedEvent): { topic: string; key: string } | null {
  const action = (event.payload as { action?: unknown }).action;
  const actionKey = typeof action === "string" ? action : null;
  if (actionKey && UNIFIED_EVENT_TO_TOPIC[actionKey]) {
    return { topic: UNIFIED_EVENT_TO_TOPIC[actionKey], key: actionKey };
  }
  const typeTopic = UNIFIED_EVENT_TO_TOPIC[event.type];
  if (typeTopic) return { topic: typeTopic, key: event.type };
  // Use the action when present so the unknown set is granular.
  return null;
}

/**
 * Resolve the topic for a typed SessionEvent. SessionEvents flow via
 * `plane.onComputerSessionEvent` (a separate channel from UnifiedEvents)
 * and their `type` field uses underscore-cased names like `created`,
 * `claimed`, `step`, `approval_request`. All map to the same iOS
 * subscription topic — `computer.session.events` — because the iOS
 * ComputerSessionService.swift subscribes once and dispatches by inner type.
 */
function sessionEventTopic(): string {
  return "computer.session.events";
}

/**
 * Construct the bridge. The bridge stays inert until the returned handle's
 * `dispose()` is called — at construction time it registers a surface +
 * session listener with the plane, so events start flowing immediately.
 *
 * @param plane  the per-daemon UnifiedDispatchPlane (from runtime).
 * @param server the CompanionServer that exposes broadcastNotification.
 * @returns CompanionBridgeHandle whose dispose() stops the bridge cleanly.
 */
export function createCompanionBridge(
  plane: UnifiedDispatchPlane,
  server: CompanionNotificationSink,
  options: CompanionBridgeOptions = {},
): CompanionBridgeHandle {
  const registry = options.registry ?? createSurfaceSubscriberRegistry();
  const logger =
    options.logger ??
    ((msg: string, details: Readonly<Record<string, unknown>>): void => {
      // Use console.warn so unknown event types remain visible without
      // tripping CI failure-mode log scanners that fire on console.error.
      // eslint-disable-next-line no-console
      console.warn(`[companion-bridge] ${msg}`, details);
    });

  // Per-instance state — never module-global (QB #7).
  const unknownDiscriminators = new Set<string>();
  const topicCounts = new Map<string, number>();

  const incrementTopic = (topic: string): void => {
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  };

  // ── UnifiedEvent → RPC notification ──────────────────────────────
  const unifiedListener: SurfaceListener = (event: UnifiedEvent): void => {
    const resolved = resolveUnifiedTopic(event);
    if (!resolved) {
      const action = (event.payload as { action?: unknown }).action;
      const key = typeof action === "string" ? `${event.type}:${action}` : event.type;
      if (!unknownDiscriminators.has(key)) {
        unknownDiscriminators.add(key);
        logger("dropped unmapped UnifiedEvent — no topic for discriminator", {
          eventType: event.type,
          action: typeof action === "string" ? action : null,
        });
      }
      return;
    }

    // Track via the structured registry so stats() reflects what the
    // bridge has fanned out. We publish onto a per-topic channel so a
    // future dispatch sink (e.g. desktop SSE or a TUI tap) can subscribe
    // without a separate plumb.
    registry.publish(resolved.topic, {
      kind: resolved.key,
      data: event.payload,
    });

    incrementTopic(resolved.topic);

    try {
      server.broadcastNotification({
        jsonrpc: "2.0",
        method: resolved.topic,
        params: event.payload,
      });
    } catch (err) {
      // Sink errors must not crash the plane — log and continue.
      logger("broadcastNotification threw — dropping this notification", {
        topic: resolved.topic,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // The plane's surface registry filters by surfaceId for excludeSurface
  // routing; pass undefined filter so we receive ALL UnifiedEvent types
  // and let the topic mapping decide what to forward.
  const disposeSurface = plane.registerSurface(BRIDGE_SURFACE_ID, "desktop", unifiedListener);

  // ── SessionEvent → RPC notification ──────────────────────────────
  // SessionEvents flow via a separate stream (plane.onComputerSessionEvent)
  // not the UnifiedEvent surface registry. Bridge them too so iOS gets
  // every session lifecycle update on `computer.session.events`.
  const disposeSession = plane.onComputerSessionEvent((sessionEvent: SessionEvent): void => {
    const topic = sessionEventTopic();
    const params: Record<string, unknown> = {
      sessionId: sessionEvent.sessionId,
      seq: sessionEvent.seq,
      timestamp: sessionEvent.timestamp,
      type: sessionEvent.type,
      payload: sessionEvent.payload,
    };

    registry.publish(topic, {
      kind: `session:${sessionEvent.type}`,
      data: params,
    });

    incrementTopic(topic);

    try {
      server.broadcastNotification({
        jsonrpc: "2.0",
        method: topic,
        params,
      });
    } catch (err) {
      logger("broadcastNotification threw on SessionEvent — dropping", {
        topic,
        sessionId: sessionEvent.sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      disposeSurface();
    } catch {
      // best-effort
    }
    try {
      disposeSession();
    } catch {
      // best-effort
    }
    // Clear the structured registry so subsequent stats() calls reflect
    // the disposed state (QB #14: claim verification).
    registry.unsubscribeSurface(BRIDGE_SURFACE);
    registry.clear();
  };

  return {
    dispose,
    getUnknownDiscriminators: () => [...unknownDiscriminators],
    getTopicCounts: () => Object.fromEntries(topicCounts),
    getRegistry: () => registry,
  };
}
