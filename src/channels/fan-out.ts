/**
 * Cross-Surface Fan-Out Registry — Phase 3 P1-F11.
 *
 * Per WOTANN Cross-Surface Synergy Design (docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md),
 * an event raised in ONE surface (e.g., Slack @mention arriving on a channel
 * adapter) must fan out to every registered surface (desktop, iOS, watch, TUI,
 * CarPlay). F1 added the session-event bridge; F11 generalises the same pattern
 * for arbitrary UnifiedEvents — Mention, Approval, Message, Surface control, etc.
 *
 * Regression-lock: UnifiedDispatchPlane.broadcast(content) already existed in F1
 * but only iterated ChannelAdapters on outbound messages. The surface registry
 * here is a distinct concept (non-overlapping): surfaces are in-process viewers
 * (phone, watch, TUI) whose listener handles a typed UnifiedEvent — they are NOT
 * channel adapters. Fan-out does not collide with adapter.send().
 *
 * Design principles:
 *   - Per-surface filter: surface can subscribe to specific event types only.
 *   - Honest error propagation (QB #6): listener throws → error UnifiedEvent
 *     emitted; other surfaces still receive the original.
 *   - Per-surface FIFO: concurrent broadcasts maintain ordering guarantees per
 *     surface (a surface sees events in the order broadcast was called).
 *   - Per-coordinator isolation (QB #7): SurfaceRegistry is an instance, not a
 *     module global. Callers thread it through.
 *   - Idempotent re-register: calling registerSurface with an existing id
 *     replaces the listener (no duplicates).
 *   - Graceful unregister-during-broadcast: in-flight deliveries complete;
 *     subsequent broadcasts skip the unregistered surface.
 */

// ── Types ──────────────────────────────────────────────────

/** Canonical surface identifiers the harness ships with. */
export type SurfaceType = "desktop" | "ios" | "watch" | "tui" | "carplay" | "web";

/**
 * Event taxonomy. Discriminated union — each type carries its own payload.
 * When a new event type is added:
 *   1. extend this union
 *   2. add the string literal to VALID_EVENT_TYPES below
 *   3. surfaces with filters auto-opt-out unless they add it to their filter.
 */
export type UnifiedEventType =
  | "mention"
  | "approval"
  | "message"
  | "session"
  | "file-write"
  | "cursor"
  | "step"
  | "cost"
  | "error";

export const VALID_EVENT_TYPES: readonly UnifiedEventType[] = [
  "mention",
  "approval",
  "message",
  "session",
  "file-write",
  "cursor",
  "step",
  "cost",
  "error",
];

export interface UnifiedEvent {
  readonly type: UnifiedEventType;
  readonly timestamp: number;
  /** Surface that originated the event, for excludeSurface routing and audit trails. */
  readonly sourceSurface?: string;
  /** Event-type-specific payload; opaque here, typed by consumers via UnifiedEventType. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SurfaceListener {
  (event: UnifiedEvent): void | Promise<void>;
}

export interface SurfaceRegistration {
  readonly surfaceId: string;
  readonly surfaceType: SurfaceType;
  /**
   * Optional filter. If present, the listener receives only events whose `type`
   * is in this set. If absent (undefined), the listener receives every event.
   */
  readonly filter?: ReadonlySet<UnifiedEventType>;
}

export interface BroadcastOptions {
  /** Surface id to exclude from this broadcast (e.g., don't echo back to the originator). */
  readonly excludeSurface?: string;
}

// ── Error taxonomy ─────────────────────────────────────────

export class InvalidEventTypeError extends Error {
  readonly code = "INVALID_EVENT_TYPE";
  constructor(type: string) {
    super(`Invalid UnifiedEvent type: ${type}. Valid types: ${VALID_EVENT_TYPES.join(", ")}`);
    this.name = "InvalidEventTypeError";
  }
}

export class SurfaceAlreadyRegisteredError extends Error {
  // NOTE: Retained for callers that prefer a hard fault over replace-on-duplicate.
  // The default registerSurface semantics is replace (idempotent), so this class
  // is currently unused internally but exposed as part of the public surface.
  readonly code = "SURFACE_ALREADY_REGISTERED";
  constructor(surfaceId: string) {
    super(`Surface already registered: ${surfaceId}`);
    this.name = "SurfaceAlreadyRegisteredError";
  }
}

// ── Registry ───────────────────────────────────────────────

interface SurfaceRecord {
  readonly registration: SurfaceRegistration;
  readonly listener: SurfaceListener;
  /** Per-surface serialization queue — maintains broadcast ordering guarantees. */
  queue: Promise<void>;
  /** Set false by unregisterSurface. In-flight broadcasts still complete; future ones skip. */
  active: boolean;
}

/**
 * Cross-surface fan-out registry. Immutable from the outside — new registration
 * returns new state; broadcast serializes per-surface but parallelises across
 * surfaces.
 */
export class SurfaceRegistry {
  private readonly surfaces = new Map<string, SurfaceRecord>();
  // Error listeners — separate from surface listeners to avoid recursion.
  private readonly errorListeners = new Set<(ev: UnifiedEvent) => void>();

  // ── Registration ─────────────────────────────────────────

  /**
   * Register (or replace) a surface. If a surface with `surfaceId` already
   * exists, the listener is replaced (not duplicated). Returns a disposer that
   * unregisters the surface when called.
   */
  registerSurface(registration: SurfaceRegistration, listener: SurfaceListener): () => void {
    if (!registration.surfaceId || registration.surfaceId.trim() === "") {
      throw new Error("surfaceId required");
    }
    // Replace-on-duplicate semantics (idempotent). Reset queue so the new
    // listener starts fresh — any pending in-flight deliveries to the OLD
    // listener will still complete because they're captured in the previous
    // record's queue chain, but new events go to the new listener only.
    const record: SurfaceRecord = {
      registration,
      listener,
      queue: Promise.resolve(),
      active: true,
    };
    this.surfaces.set(registration.surfaceId, record);
    return () => {
      this.unregisterSurface(registration.surfaceId);
    };
  }

  unregisterSurface(surfaceId: string): boolean {
    const record = this.surfaces.get(surfaceId);
    if (!record) return false;
    // Flag the record as inactive so in-flight broadcasts that haven't yet
    // reached the deliver call skip the listener. In-flight deliveries that
    // already started continue — they're captured in the queue promise chain.
    record.active = false;
    this.surfaces.delete(surfaceId);
    return true;
  }

  hasSurface(surfaceId: string): boolean {
    return this.surfaces.has(surfaceId);
  }

  getSurfaceIds(): readonly string[] {
    return [...this.surfaces.keys()];
  }

  getSurfaces(): readonly SurfaceRegistration[] {
    return [...this.surfaces.values()].map((r) => r.registration);
  }

  // ── Broadcast ────────────────────────────────────────────

  /**
   * Broadcast an event to every registered surface whose filter matches.
   *
   * - Each surface gets the event appended to its FIFO queue, so two concurrent
   *   broadcasts A and B are both seen by surface X in the order the broadcasts
   *   were initiated (per-surface ordering guarantee).
   * - Across surfaces, deliveries run in parallel; there is no global ordering.
   * - A listener that throws emits an "error" UnifiedEvent via errorListeners;
   *   the original event still reaches the other surfaces.
   *
   * Returns a promise that resolves when every surface's listener has been
   * invoked (or errored). Resolves even if some listeners throw.
   *
   * Throws InvalidEventTypeError synchronously if `event.type` is not a valid
   * UnifiedEventType — this is a caller bug, surfaced loudly.
   */
  async broadcast(event: UnifiedEvent, opts: BroadcastOptions = {}): Promise<void> {
    this.validateEvent(event);

    // Snapshot current surface list to avoid iterator invalidation if a
    // listener re-registers during dispatch. Unregistrations after this
    // snapshot still skip because we check record.active at deliver-time.
    const records = [...this.surfaces.values()];

    const deliveries: Promise<void>[] = [];
    for (const record of records) {
      if (record.registration.surfaceId === opts.excludeSurface) continue;
      if (record.registration.filter && !record.registration.filter.has(event.type)) continue;

      // Queue the delivery onto this surface's FIFO chain. This preserves
      // per-surface ordering under concurrent broadcasts: if broadcast(A) and
      // broadcast(B) race, the same surface sees A before B because both push
      // onto the same queue promise and the append is synchronous here.
      const next = record.queue.then(() => this.deliver(record, event));
      record.queue = next;
      deliveries.push(next);
    }

    // Wait for all deliveries to complete (successful or errored).
    await Promise.all(deliveries);
  }

  /** Subscribe to error events emitted when a surface listener throws. */
  onError(listener: (ev: UnifiedEvent) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  // ── Internal ─────────────────────────────────────────────

  private validateEvent(event: UnifiedEvent): void {
    if (!event || typeof event !== "object") {
      throw new InvalidEventTypeError(String(event));
    }
    if (!(VALID_EVENT_TYPES as readonly string[]).includes(event.type)) {
      throw new InvalidEventTypeError(event.type);
    }
  }

  private async deliver(record: SurfaceRecord, event: UnifiedEvent): Promise<void> {
    // unregisterSurface during broadcast: if the surface was unregistered after
    // we snapshotted but before delivery, skip. In-flight deliveries (those
    // already inside listener()) complete naturally — we don't race them.
    if (!record.active) return;

    try {
      await record.listener(event);
    } catch (err) {
      const errorEvent: UnifiedEvent = {
        type: "error",
        timestamp: Date.now(),
        sourceSurface: record.registration.surfaceId,
        payload: {
          originalType: event.type,
          message: err instanceof Error ? err.message : String(err),
          surfaceId: record.registration.surfaceId,
          surfaceType: record.registration.surfaceType,
        },
      };
      // Notify error listeners; swallow their throws too (error-in-error loop
      // would poison the bus otherwise).
      for (const el of this.errorListeners) {
        try {
          el(errorEvent);
        } catch {
          // no-op — error-on-error is not propagated further
        }
      }
    }
  }
}
