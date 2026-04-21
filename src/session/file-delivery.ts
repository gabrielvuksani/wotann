/**
 * File Delivery — WOTANN Phase 3 P1-F9 (push-to-surface delivery pipeline).
 *
 * Per MASTER_PLAN_V8 §5 P1-F9 and docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md,
 * F5 writes bytes to `~/.wotann/creations/<sessionId>/<filename>` and fires a
 * low-level `file-write` UnifiedEvent the moment any save / delete lands. F7
 * serves arbitrary workspace files (with ranges) on pull.
 *
 * F9 is the missing PUSH layer: when an agent declares a creation finalized
 * ("here's the output the user asked for"), the daemon needs to:
 *
 *   1. mint a short-lived opaque download token paired with the creation,
 *   2. fan out a higher-level `delivery-ready` notification so every surface
 *      (iOS lock-screen push, desktop toast, watch haptic, CarPlay voice
 *      prompt) can decide whether to surface it,
 *   3. remember who acknowledged it so we can retire the notification when
 *      every surface has picked it up (or let it age out via TTL).
 *
 * F5's `file-write` event fires on *every* save (an agent scribbling drafts
 * or a WIP buffer). F9 is deliberately distinct — a delivery is only minted
 * when the agent calls `CreationsStore.finalize()`, and its lifecycle covers
 * notify → acknowledge → TTL-expire. Surfaces that subscribed only to the
 * raw write stream would show a notification on every keystroke.
 *
 * Contract:
 *
 *   notify({sessionId, filename, ...}) → record                (delivery-ready)
 *      │
 *      ├── acknowledge(deliveryId, deviceId) → record          (delivery-acknowledged)
 *      │       (multiple surfaces acknowledge independently —
 *      │       each acknowledgement is recorded, the record
 *      │       remains visible until every known surface
 *      │       acknowledges OR the TTL fires)
 *      │
 *      └── sweepExpired() (after TTL) → state=expired          (delivery-expired)
 *
 * Design principles (session quality bars referenced inline):
 *
 *   QB #6 (honest failures) — typed errors for every failure mode:
 *     ErrorDeliveryNotFound  — unknown deliveryId
 *     ErrorDeliveryExpired   — acknowledgement after TTL
 *     ErrorCreationMissing   — notify referenced a file that's not on disk
 *     ErrorInvalidToken      — token schema violation (shape check)
 *     ErrorInvalidPayload    — notify params fail validation
 *
 *   QB #7 (per-session state) — FileDelivery is an instance, not a module
 *   global. The daemon owns one; tests construct their own. No singleton.
 *
 *   QB #10/#11 (sibling-site scan) — grep ruled out `delivery.*pipeline`,
 *   `file.*deliver`, `push.*file`, `file-write.*notify` in src/. The only
 *   adjacent primitive is F5's `file-write` UnifiedEvent + iOS companion
 *   APNs (companion-server.ts "push-notify" capability), and neither offers
 *   a tokenized download + per-surface acknowledge cycle.
 *
 *   QB #12 (deterministic tests) — caller-supplied `now()` clock drives
 *   timestamps + TTL arithmetic. No wall-clock coupling in the queue.
 *
 *   QB #14 (claim verification) — every commit claim is backed by a real-
 *   code-path test in tests/session/file-delivery.test.ts (notify emits
 *   UnifiedEvent, finalize integration triggers notify, acknowledge updates
 *   state + fires event, TTL prunes, etc). The test names map 1:1 to the
 *   commit bullets.
 *
 * Non-goals for F9:
 *   - Transport-specific push plumbing (APNs payload shaping, WebSocket
 *     frames). The companion-server + F11 SurfaceRegistry already own that.
 *   - Actual byte serving — surfaces consume the token by calling
 *     `creations.get(sessionId, filename)` on the kairos RPC (F7 handles
 *     the range-request case for large files).
 *   - Cross-daemon replication. A delivery is a process-local concept; the
 *     daemon reaps records on restart so a crash doesn't leak stale tokens.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { UnifiedEvent } from "../channels/fan-out.js";

// ── Types ──────────────────────────────────────────────────

/**
 * Delivery lifecycle state.
 *
 *   pending       — notified, not yet acknowledged by any surface.
 *   acknowledged  — at least one surface has acknowledged. Remains in this
 *                   state as more surfaces check in; only the first
 *                   transition out of `pending` fires a state-change event.
 *   expired       — TTL elapsed without acknowledgement (or all surfaces
 *                   finished acknowledging after TTL, whichever first).
 *                   Terminal.
 */
export type DeliveryState = "pending" | "acknowledged" | "expired";

/**
 * Opaque download token. Pairs 1:1 with a creation (sessionId + filename)
 * for a bounded window. Surfaces treat it as opaque; only the daemon knows
 * the actual filesystem path. Tokens are minted by `notify` (randomBytes-
 * backed, base64url-encoded for URL safety) unless the caller supplies one
 * — useful for tests that need determinism.
 */
export interface DeliveryToken {
  readonly value: string;
  readonly expiresAt: number;
}

/**
 * Acknowledgement record — one per (deliveryId, deviceId) pair. The daemon
 * retains a list on each delivery record so the UI can render "seen by
 * desktop + phone" indicators. Order matches arrival; duplicates are
 * idempotently dropped (see `acknowledge`).
 */
export interface DeliveryAcknowledgement {
  readonly deviceId: string;
  readonly acknowledgedAt: number;
}

/**
 * Canonical delivery record. Immutable from the outside — each mutator
 * (`notify`, `acknowledge`, `sweepExpired`) returns a new record; callers
 * MUST NOT mutate the returned object.
 *
 * `downloadToken` is the token bound to `{sessionId, filename}`. Surfaces
 * pass this back (alongside sessionId + filename) when they pull the
 * actual bytes via `creations.get` — the daemon verifies the token's TTL
 * and refuses if expired (enforced at the RPC boundary, not here).
 */
export interface DeliveryRecord {
  readonly deliveryId: string;
  readonly sessionId: string;
  readonly filename: string;
  /** Optional human-friendly label; defaults to `filename` when absent. */
  readonly displayName: string;
  /** Optional short description the UI can render under the title. */
  readonly description: string | null;
  readonly downloadToken: DeliveryToken;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly state: DeliveryState;
  readonly acknowledgements: readonly DeliveryAcknowledgement[];
}

// ── Errors (QB #6 — typed failures) ────────────────────────

export class ErrorDeliveryNotFound extends Error {
  readonly code = "DELIVERY_NOT_FOUND";
  readonly deliveryId: string;
  constructor(deliveryId: string) {
    super(`Delivery not found: ${deliveryId}`);
    this.name = "ErrorDeliveryNotFound";
    this.deliveryId = deliveryId;
  }
}

export class ErrorDeliveryExpired extends Error {
  readonly code = "DELIVERY_EXPIRED";
  readonly deliveryId: string;
  readonly expiresAt: number;
  constructor(deliveryId: string, expiresAt: number) {
    super(`Delivery ${deliveryId} expired at ${expiresAt}`);
    this.name = "ErrorDeliveryExpired";
    this.deliveryId = deliveryId;
    this.expiresAt = expiresAt;
  }
}

export class ErrorCreationMissing extends Error {
  readonly code = "DELIVERY_CREATION_MISSING";
  readonly sessionId: string;
  readonly filename: string;
  constructor(sessionId: string, filename: string) {
    super(`Creation missing for delivery: ${sessionId}/${filename}`);
    this.name = "ErrorCreationMissing";
    this.sessionId = sessionId;
    this.filename = filename;
  }
}

export class ErrorInvalidToken extends Error {
  readonly code = "DELIVERY_INVALID_TOKEN";
  readonly reason: string;
  constructor(reason: string) {
    super(`Invalid download token: ${reason}`);
    this.name = "ErrorInvalidToken";
    this.reason = reason;
  }
}

export class ErrorInvalidPayload extends Error {
  readonly code = "DELIVERY_INVALID_PAYLOAD";
  readonly reason: string;
  constructor(reason: string) {
    super(`Invalid delivery payload: ${reason}`);
    this.name = "ErrorInvalidPayload";
    this.reason = reason;
  }
}

// ── Events ────────────────────────────────────────────────

export type DeliveryEventType = "notified" | "acknowledged" | "expired";

/**
 * Event emitted on the queue's internal bus. Carries enough to let a
 * subscriber render a full UI cell without re-fetching. One event per
 * lifecycle transition — not one per acknowledgement. (Multiple
 * acknowledgements on the same delivery produce one "acknowledged"
 * event on the first transition and no further internal events.
 * The broadcast hook DOES fire per-acknowledgement so surfaces can
 * render fleet-style "seen by N devices" indicators in realtime.)
 */
export interface DeliveryEvent {
  readonly type: DeliveryEventType;
  readonly deliveryId: string;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly record: DeliveryRecord;
  /** Present on "acknowledged" events — the device that triggered the
   * first transition. Absent for "notified" and "expired". */
  readonly deviceId?: string;
}

export type DeliveryListener = (event: DeliveryEvent) => void;

// ── Config ────────────────────────────────────────────────

export interface FileDeliveryConfig {
  /** Default TTL for deliveries that don't specify one explicitly. */
  readonly defaultTtlMs: number;
  /** Hard cap on TTL — callers asking for longer get clamped. Default 7d. */
  readonly maxTtlMs: number;
  /** After how long records are purged from the queue. Default 7d.
   *  This is the GC window; records past this age are dropped from memory
   *  entirely (distinct from `expired` state which still appears in
   *  history queries). */
  readonly pruneAfterMs: number;
}

const DEFAULT_CONFIG: FileDeliveryConfig = {
  defaultTtlMs: 60 * 60_000, // 1 hour — matches the "short-lived token" promise
  maxTtlMs: 7 * 24 * 60 * 60_000, // 7 days
  pruneAfterMs: 7 * 24 * 60 * 60_000, // 7 days
};

/**
 * Optional broadcast hook. When wired (typically via
 * UnifiedDispatchPlane.broadcastUnifiedEvent per F11), each lifecycle step
 * fans out to every registered surface so surfaces that subscribed to
 * `message` events learn about new deliveries without polling.
 *
 * We reuse the `message` UnifiedEvent type (rather than introducing a new
 * one) because `UnifiedEventType` is a closed union in src/channels/fan-out.ts
 * and adding a type here would require touching that deny-listed file. The
 * payload's `action` field (delivery-ready / delivery-acknowledged /
 * delivery-expired) lets surfaces discriminate.
 */
export type BroadcastFn = (event: UnifiedEvent) => void | Promise<void>;

/**
 * Optional existence check used by `notify` to verify the referenced
 * creation actually lives on disk (QB #6 — honest failures). When absent,
 * notify proceeds without the check — useful for tests that don't want to
 * spin up a real filesystem. The daemon wires this to
 * `CreationsStore.get(...) !== null` when it owns both stores.
 */
export type CreationExistsFn = (params: {
  readonly sessionId: string;
  readonly filename: string;
}) => boolean;

export interface FileDeliveryOptions {
  readonly now?: () => number;
  readonly broadcast?: BroadcastFn;
  readonly creationExists?: CreationExistsFn;
  readonly defaultTtlMs?: number;
  readonly maxTtlMs?: number;
  readonly pruneAfterMs?: number;
  /** Inject a deterministic token minter — tests use this to compare
   * against known values. Default uses randomBytes(24) base64url. */
  readonly mintToken?: () => string;
}

// ── Token helpers ─────────────────────────────────────────

/**
 * Shape-only validator. Useful when the RPC boundary needs to reject
 * obviously-malformed tokens before a lookup. Exported so tests and the
 * RPC surface can share the same rules.
 */
export function isValidTokenShape(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 16 || value.length > 256) return false;
  // base64url alphabet (RFC 4648 §5). Tokens we mint are 32 chars so the
  // lower bound of 16 is generous for alternate mints and the upper of 256
  // guards against someone pasting a wall of text.
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  return true;
}

/**
 * Default minter — 24 random bytes base64url-encoded yields a 32-char
 * opaque token with 192 bits of entropy. Plenty for a 1-hour window.
 */
function defaultMintToken(): string {
  return randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Queue ─────────────────────────────────────────────────

/**
 * Delivery queue. One instance per daemon; per-delivery state is keyed by
 * `deliveryId`. `pending` / `pendingForSession` surface active deliveries;
 * `subscribe` delivers live events to RPC pollers.
 *
 * Concurrency: all methods are synchronous and operate on in-memory state.
 * The `broadcast` hook MAY return a Promise but we never await it — fan-out
 * is best-effort and must not block the queue transition.
 */
export class FileDelivery {
  private readonly records = new Map<string, DeliveryRecord>();
  private readonly listeners = new Set<DeliveryListener>();
  private readonly config: FileDeliveryConfig;
  private readonly clock: () => number;
  private readonly mintToken: () => string;
  private broadcast: BroadcastFn | null;
  private creationExists: CreationExistsFn | null;

  constructor(options: FileDeliveryOptions = {}) {
    this.config = {
      defaultTtlMs: options.defaultTtlMs ?? DEFAULT_CONFIG.defaultTtlMs,
      maxTtlMs: options.maxTtlMs ?? DEFAULT_CONFIG.maxTtlMs,
      pruneAfterMs: options.pruneAfterMs ?? DEFAULT_CONFIG.pruneAfterMs,
    };
    this.clock = options.now ?? (() => Date.now());
    this.mintToken = options.mintToken ?? defaultMintToken;
    this.broadcast = options.broadcast ?? null;
    this.creationExists = options.creationExists ?? null;
  }

  /**
   * Attach (or replace / detach with null) the broadcast hook after
   * construction. Needed because the dispatch plane is set by the daemon
   * AFTER the RPC handler creates the queue.
   */
  setBroadcast(fn: BroadcastFn | null): void {
    this.broadcast = fn;
  }

  /**
   * Attach (or replace / detach) the existence check. Same lifecycle
   * rationale as `setBroadcast` — the daemon wires this once the
   * CreationsStore is constructed.
   */
  setCreationExists(fn: CreationExistsFn | null): void {
    this.creationExists = fn;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Mint a new delivery. Returns the created record. Fires a
   * `delivery-ready` UnifiedEvent via the broadcast hook (if wired) and
   * emits a `notified` event on the internal subscriber bus.
   *
   * Param validation:
   *   sessionId  — non-empty string
   *   filename   — non-empty string
   *   expiresInSec — optional; capped at maxTtlMs / 1000
   *
   * Errors:
   *   ErrorInvalidPayload   — params fail validation
   *   ErrorCreationMissing  — creationExists hook is wired and returned false
   */
  notify(params: {
    readonly sessionId: string;
    readonly filename: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly expiresInSec?: number;
    /** Caller-supplied token override. If absent, a fresh token is minted.
     *  Only useful for tests that need determinism — production callers
     *  should leave this out. */
    readonly downloadToken?: string;
  }): DeliveryRecord {
    if (typeof params.sessionId !== "string" || params.sessionId.trim() === "") {
      throw new ErrorInvalidPayload("sessionId (non-empty string) required");
    }
    if (typeof params.filename !== "string" || params.filename.trim() === "") {
      throw new ErrorInvalidPayload("filename (non-empty string) required");
    }
    if (params.displayName !== undefined && typeof params.displayName !== "string") {
      throw new ErrorInvalidPayload("displayName must be a string when present");
    }
    if (params.description !== undefined && typeof params.description !== "string") {
      throw new ErrorInvalidPayload("description must be a string when present");
    }
    if (params.downloadToken !== undefined && !isValidTokenShape(params.downloadToken)) {
      throw new ErrorInvalidToken("downloadToken fails shape check");
    }

    // Honest existence check (QB #6). If the hook is wired, verify the
    // creation is actually on disk — refusing to notify about a ghost
    // creation prevents broken download links.
    if (
      this.creationExists &&
      !this.creationExists({
        sessionId: params.sessionId,
        filename: params.filename,
      })
    ) {
      throw new ErrorCreationMissing(params.sessionId, params.filename);
    }

    const now = this.clock();
    const rawTtl =
      typeof params.expiresInSec === "number" &&
      Number.isFinite(params.expiresInSec) &&
      params.expiresInSec > 0
        ? params.expiresInSec * 1000
        : this.config.defaultTtlMs;
    // Clamp — callers asking for longer-than-max are quietly shortened to
    // the cap so we don't leak never-expiring tokens. The response still
    // carries the ACTUAL expiresAt so the caller can see the cap applied.
    const ttl = Math.min(rawTtl, this.config.maxTtlMs);

    const tokenValue = params.downloadToken ?? this.mintToken();
    const token: DeliveryToken = {
      value: tokenValue,
      expiresAt: now + ttl,
    };

    const record: DeliveryRecord = {
      deliveryId: `dl-${randomUUID()}`,
      sessionId: params.sessionId,
      filename: params.filename,
      displayName: params.displayName ?? params.filename,
      description: params.description ?? null,
      downloadToken: token,
      createdAt: now,
      expiresAt: now + ttl,
      state: "pending",
      acknowledgements: [],
    };
    this.records.set(record.deliveryId, record);

    const event: DeliveryEvent = {
      type: "notified",
      deliveryId: record.deliveryId,
      sessionId: record.sessionId,
      timestamp: now,
      record,
    };
    this.emit(event);
    this.fanOut({
      action: "delivery-ready",
      deliveryId: record.deliveryId,
      sessionId: record.sessionId,
      filename: record.filename,
      displayName: record.displayName,
      description: record.description,
      downloadToken: record.downloadToken.value,
      expiresAt: record.expiresAt,
    });

    // Opportunistic prune — keeps the records map from growing unboundedly
    // in long-lived daemons that never call sweepExpired.
    this.prune(now);

    return record;
  }

  /**
   * Acknowledge a delivery on behalf of one surface/device. Returns the
   * updated record. Multiple surfaces can acknowledge the same delivery;
   * each acknowledgement is recorded. Duplicate acknowledgements from the
   * same deviceId are idempotent (no-op past the first).
   *
   * Errors:
   *   ErrorDeliveryNotFound  — unknown deliveryId
   *   ErrorDeliveryExpired   — delivery's TTL has elapsed
   *
   * Note: acknowledgement AFTER TTL is explicitly rejected (rather than
   * silently recorded) — that way a mis-synced client doesn't accidentally
   * resurrect a stale delivery. Callers needing "missed it, acknowledge
   * anyway" semantics should mint a fresh notify.
   */
  acknowledge(params: { readonly deliveryId: string; readonly deviceId: string }): DeliveryRecord {
    if (typeof params.deliveryId !== "string" || params.deliveryId.trim() === "") {
      throw new ErrorInvalidPayload("deliveryId (non-empty string) required");
    }
    if (typeof params.deviceId !== "string" || params.deviceId.trim() === "") {
      throw new ErrorInvalidPayload("deviceId (non-empty string) required");
    }

    const existing = this.records.get(params.deliveryId);
    if (!existing) {
      throw new ErrorDeliveryNotFound(params.deliveryId);
    }
    const now = this.clock();
    if (existing.state === "expired" || now > existing.expiresAt) {
      throw new ErrorDeliveryExpired(params.deliveryId, existing.expiresAt);
    }

    // Idempotency: if this device already acknowledged, return the existing
    // record unchanged. No event is emitted. This matches the behavior a
    // UI would expect from "tap to dismiss" being retriggered.
    const already = existing.acknowledgements.some((a) => a.deviceId === params.deviceId);
    if (already) {
      return existing;
    }

    const newAck: DeliveryAcknowledgement = {
      deviceId: params.deviceId,
      acknowledgedAt: now,
    };
    const next: DeliveryRecord = {
      ...existing,
      // Freeze-by-construction: spread + concat produces a fresh tuple;
      // Object.freeze is unnecessary because readonly on the interface
      // is enough for TS and the test suite's assertions don't probe
      // runtime mutability guarantees.
      state: "acknowledged",
      acknowledgements: [...existing.acknowledgements, newAck],
    };
    this.records.set(next.deliveryId, next);

    // Only emit the internal subscriber event on the FIRST transition out
    // of pending. Subsequent per-surface acks still fire the broadcast so
    // UIs can re-render fleet indicators in realtime.
    if (existing.state === "pending") {
      const event: DeliveryEvent = {
        type: "acknowledged",
        deliveryId: next.deliveryId,
        sessionId: next.sessionId,
        timestamp: now,
        record: next,
        deviceId: params.deviceId,
      };
      this.emit(event);
    }

    this.fanOut({
      action: "delivery-acknowledged",
      deliveryId: next.deliveryId,
      sessionId: next.sessionId,
      deviceId: params.deviceId,
      acknowledgementCount: next.acknowledgements.length,
    });

    return next;
  }

  /**
   * Transition any pending/acknowledged delivery whose TTL has elapsed to
   * `expired` state. Returns the list of records that were transitioned.
   * Each transition fires an `expired` event on the internal bus and a
   * `delivery-expired` broadcast.
   *
   * Idempotent: already-expired records are skipped.
   *
   * Callers invoke this on a timer (daemon) or when polling the queue
   * (RPC). Post-transition, records remain queryable via `getRecord` until
   * they are pruned (pruneAfterMs window).
   */
  sweepExpired(): readonly DeliveryRecord[] {
    const now = this.clock();
    const expired: DeliveryRecord[] = [];
    for (const [id, rec] of this.records) {
      if (rec.state === "expired") continue;
      if (now <= rec.expiresAt) continue;
      const next: DeliveryRecord = {
        ...rec,
        state: "expired",
      };
      this.records.set(id, next);
      expired.push(next);
      const event: DeliveryEvent = {
        type: "expired",
        deliveryId: next.deliveryId,
        sessionId: next.sessionId,
        timestamp: now,
        record: next,
      };
      this.emit(event);
      this.fanOut({
        action: "delivery-expired",
        deliveryId: next.deliveryId,
        sessionId: next.sessionId,
        filename: next.filename,
      });
    }
    // Pruning runs AFTER the transition so the sweep sees every expiry
    // first. Deliveries that have been expired longer than pruneAfterMs
    // disappear from memory entirely.
    this.prune(now);
    return expired;
  }

  /**
   * List all currently active (non-expired) deliveries across all sessions.
   * Sorted by createdAt (oldest first) so UIs render deterministically.
   *
   * `acknowledged` deliveries remain in this list until they expire —
   * callers who want pending-only should filter on `record.state`.
   */
  pending(): readonly DeliveryRecord[] {
    const out: DeliveryRecord[] = [];
    for (const rec of this.records.values()) {
      if (rec.state === "expired") continue;
      out.push(rec);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Deliveries scoped to one session (pending + acknowledged, no expired). */
  pendingForSession(sessionId: string): readonly DeliveryRecord[] {
    return this.pending().filter((r) => r.sessionId === sessionId);
  }

  /** Fetch a specific record (any state). Null when unknown. */
  getRecord(deliveryId: string): DeliveryRecord | null {
    return this.records.get(deliveryId) ?? null;
  }

  /** Look up a record by its download token. Returns null if no active
   *  record has this token, or the bound token has expired. Used by the
   *  RPC boundary to validate token → delivery → creation pairing. */
  lookupByToken(token: string): DeliveryRecord | null {
    if (!isValidTokenShape(token)) return null;
    const now = this.clock();
    for (const rec of this.records.values()) {
      if (rec.downloadToken.value !== token) continue;
      if (now > rec.expiresAt) return null;
      if (rec.state === "expired") return null;
      return rec;
    }
    return null;
  }

  /** Total records retained (pending + acknowledged + expired-but-unpruned). */
  size(): number {
    return this.records.size;
  }

  /**
   * Subscribe to lifecycle events. Returns a disposer that removes the
   * listener. No history replay — subscribers see events from the moment
   * of subscription onward. Listener errors are contained (not propagated
   * to other listeners) — the bus must not poison.
   */
  subscribe(listener: DeliveryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Internal ──────────────────────────────────────────

  /** Drop records older than pruneAfterMs. Called opportunistically from
   *  notify/sweepExpired so long-lived daemons don't leak memory. */
  private prune(now: number): void {
    const cutoff = now - this.config.pruneAfterMs;
    for (const [id, rec] of this.records) {
      if (rec.createdAt < cutoff) {
        this.records.delete(id);
      }
    }
  }

  private emit(event: DeliveryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors are contained — the bus must not poison on a
        // single bad subscriber. Callers that care about delivery failures
        // should wrap their own try/catch.
      }
    }
  }

  private fanOut(payload: Record<string, unknown>): void {
    if (!this.broadcast) return;
    // We use the `message` UnifiedEvent type because the closed union in
    // src/channels/fan-out.ts doesn't have a dedicated `delivery` type and
    // that file is on F9's deny-list. Surfaces discriminate on the
    // `action` field (delivery-ready / delivery-acknowledged /
    // delivery-expired) — same pattern F6 uses for approval events.
    const event: UnifiedEvent = {
      type: "message",
      timestamp: this.clock(),
      payload,
    };
    try {
      const result = this.broadcast(event);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          // Broadcast failures must not roll back the queue transition;
          // the internal subscriber bus is the canonical record.
        });
      }
    } catch {
      // Same reasoning — best-effort fan-out.
    }
  }
}

// ── Helpers exported for RPC wiring ───────────────────────

/**
 * Hash a token value into a short, non-reversible fingerprint. Useful for
 * logs / audit trails where we want to show "token X was used" without
 * leaking the actual value. Not used by the queue itself; exported for
 * kairos-rpc.ts audit wiring.
 */
export function fingerprintToken(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
