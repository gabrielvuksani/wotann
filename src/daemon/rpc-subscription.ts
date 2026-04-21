/**
 * RpcSubscriptionManager — shared primitive for polling-style JSON-RPC
 * subscriptions (P1-F8, MASTER_PLAN_V8 §5).
 *
 * WHY THIS EXISTS
 * ---------------
 * NDJSON IPC and WebSocket JSON-RPC cannot carry long-lived push streams
 * in WOTANN's current protocol. Every subscribe-style RPC (F1
 * `computer.session.stream`, F3 `liveActivity.subscribe`, F5 creations
 * events, F6 `approvals.subscribe`, F9 `delivery.subscribe`, F12/F13
 * dispatch events, F15 `fleet.watch`) follows the same shape:
 *
 *   1. Caller invokes `*.subscribe` to mint a subscriptionId.
 *   2. Caller polls with the same id to drain buffered events.
 *   3. Caller optionally passes `close: true` to tear the subscription down.
 *
 * Each call site today open-codes:
 *   - buffer-with-hard-cap
 *   - unknown-id -> Error
 *   - lastPolledAt tracking
 *   - subscription map per call site
 *
 * This file extracts those mechanics into a single generic helper so future
 * subscriptions can adopt it directly and existing ones can migrate
 * incrementally (the migration is DELIBERATELY NOT forced in this commit —
 * QB #10 regression-safety > cleanup).
 *
 * QUALITY BARS APPLIED
 * --------------------
 * QB #6 / #7  — honest failures; per-instance state; no module globals
 * QB #10      — sibling-site scan: F1/F3/F5/F6/F9/F12/F13/F15 all mirror
 *                this shape (grep results above), so the primitive fits
 * QB #14      — runtime-verifiable: each subscription helper behavior has
 *                a test rather than living only in a commit message
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * - It does NOT replace EventEmitter / store subscription wiring. Callers
 *   still subscribe to their domain store and forward to `emit()` here.
 * - It does NOT persist subscriptions across daemon restarts (matches all
 *   current subscribers — memory-only by design).
 * - It does NOT migrate existing subscriptions. See the commit message.
 */

import { randomUUID } from "node:crypto";

// ── Errors ──────────────────────────────────────────────────

/**
 * Thrown when a caller polls or closes a subscription id that was never
 * issued (or was already swept as stale). Callers receive this via the
 * standard RPC error channel; the daemon wrapper lifts `.code` into the
 * error envelope so UIs can discriminate without string-matching.
 */
export class ErrorUnknownSubscription extends Error {
  readonly code = "SUBSCRIPTION_UNKNOWN";
  readonly subscriptionId: string;
  constructor(subscriptionId: string) {
    super(`subscription not found: ${subscriptionId}`);
    this.name = "ErrorUnknownSubscription";
    this.subscriptionId = subscriptionId;
  }
}

// ── Types ───────────────────────────────────────────────────

/**
 * Configuration for a new subscription manager. All fields are optional —
 * defaults mirror current call-site behavior (`maxBuffer: 256` matches
 * `fleet.watch` / `approvals.subscribe`; `staleAfterMs: 5min` matches the
 * synergy-design doc's recommended sweep cadence).
 */
export interface RpcSubscriptionOptions {
  /**
   * Prefix placed before the UUID in every generated subscription id.
   * Keeps ids discriminable in logs without leaking internal structure:
   * `fs-<uuid>` (fleet), `aps-<uuid>` (approvals), etc.
   */
  readonly idPrefix: string;
  /**
   * Max events retained in a subscriber's buffer. Excess DROPS THE OLDEST
   * and flags `sentOverflow` on the next poll so clients can recover by
   * re-sync (e.g. re-issuing `*.list`). Defaults to 256.
   */
  readonly maxBuffer?: number;
  /**
   * Time after the last successful poll after which a subscription is
   * considered stale and will be auto-closed by `sweepStale()`. Defaults
   * to 5 minutes. Call sites schedule their own sweep cadence.
   */
  readonly staleAfterMs?: number;
}

/** Return shape from `subscribe()`. */
export interface SubscribeResult<E> {
  readonly subscriptionId: string;
  /**
   * Optional history replay. Seeded by the caller via `subscribe({ seed })`
   * so each call site chooses whether a fresh subscriber starts empty or
   * with domain history (e.g. `fleet.watch` seeds current snapshot).
   */
  readonly snapshot: readonly E[];
}

/** Options for a single poll. */
export interface PollOptions {
  /** Hard cap on events returned in this single poll. Defaults to manager.maxBuffer. */
  readonly maxEvents?: number;
  /** Close the subscription after draining. */
  readonly close?: boolean;
}

/** Return shape from `poll()`. */
export interface PollResult<E> {
  /** Events drained from the subscriber's buffer, oldest-first. */
  readonly events: readonly E[];
  /**
   * Indicates the subscription has been torn down. Clients should stop
   * polling. Returned instead of throwing when a subscription was closed
   * cooperatively (close() or poll({close:true})) — throwing is reserved
   * for "never existed" (ErrorUnknownSubscription).
   */
  readonly closed: boolean;
  /**
   * Set to true when at least one event was dropped from this subscriber's
   * buffer due to overflow since the last poll. Clients should treat this
   * as a re-sync signal. Cleared by the current poll — the NEXT poll sees
   * `false` unless overflow happened again.
   */
  readonly sentOverflow: boolean;
  /**
   * Set when there are still events buffered that were excluded from this
   * response by `maxEvents`. Clients can poll again immediately without
   * waiting for a new emit.
   */
  readonly more: boolean;
}

// ── Internal subscription record ────────────────────────────

interface Subscription<E> {
  readonly id: string;
  /** Append-only buffer, drained fully or partially by poll(). */
  buffer: E[];
  /** Whether this subscription has been torn down. */
  closed: boolean;
  /** Monotonic ms timestamp of last poll (or subscribe). */
  lastPolledAt: number;
  /** Whether the buffer dropped oldest events since the last poll. */
  overflowSinceLastPoll: boolean;
}

// ── Manager ─────────────────────────────────────────────────

/**
 * Per-instance subscription registry. Generic over the event type so each
 * call site keeps its own typed interface (QB #6 — typed, not `any`).
 */
export class RpcSubscriptionManager<E> {
  private readonly idPrefix: string;
  private readonly maxBuffer: number;
  private readonly staleAfterMs: number;
  private readonly subscriptions = new Map<string, Subscription<E>>();

  constructor(opts: RpcSubscriptionOptions) {
    if (!opts.idPrefix || opts.idPrefix.length === 0) {
      throw new Error("idPrefix (non-empty string) required");
    }
    this.idPrefix = opts.idPrefix;
    this.maxBuffer = opts.maxBuffer ?? 256;
    this.staleAfterMs = opts.staleAfterMs ?? 5 * 60 * 1000;
    if (this.maxBuffer <= 0) {
      throw new Error("maxBuffer must be positive");
    }
    if (this.staleAfterMs <= 0) {
      throw new Error("staleAfterMs must be positive");
    }
  }

  /**
   * Issue a new subscription id. Optionally accept a history snapshot the
   * call site computed (e.g. fleet.watch seeds with current snapshot,
   * computer.session.stream seeds with history replay).
   */
  subscribe(opts: { readonly seed?: readonly E[] } = {}): SubscribeResult<E> {
    const id = `${this.idPrefix}-${randomUUID()}`;
    const sub: Subscription<E> = {
      id,
      buffer: [],
      closed: false,
      lastPolledAt: Date.now(),
      overflowSinceLastPoll: false,
    };
    this.subscriptions.set(id, sub);
    return {
      subscriptionId: id,
      snapshot: opts.seed ? [...opts.seed] : [],
    };
  }

  /**
   * Append an event to every OPEN subscriber's buffer. Overflows trim the
   * oldest entries and flag the subscriber so the next poll can signal
   * re-sync. Safe to call during a `poll()` — emits taken during poll land
   * in the poll AFTER the current one (splice-based drain is stable).
   */
  emit(event: E): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.closed) continue;
      sub.buffer.push(event);
      if (sub.buffer.length > this.maxBuffer) {
        const dropCount = sub.buffer.length - this.maxBuffer;
        sub.buffer.splice(0, dropCount);
        sub.overflowSinceLastPoll = true;
      }
    }
  }

  /**
   * Drain buffered events for a subscription.
   *
   * - Unknown id -> throws {@link ErrorUnknownSubscription}
   * - Closed sub -> returns `{ closed: true, events: [] }` (cooperative signal)
   * - Open sub   -> returns up-to maxEvents items, oldest-first
   */
  poll(subscriptionId: string, opts: PollOptions = {}): PollResult<E> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      throw new ErrorUnknownSubscription(subscriptionId);
    }
    if (sub.closed) {
      return {
        events: [],
        closed: true,
        sentOverflow: false,
        more: false,
      };
    }
    const cap = opts.maxEvents && opts.maxEvents > 0 ? opts.maxEvents : this.maxBuffer;
    const drained = sub.buffer.splice(0, cap);
    const overflow = sub.overflowSinceLastPoll;
    sub.overflowSinceLastPoll = false;
    sub.lastPolledAt = Date.now();
    const more = sub.buffer.length > 0;
    if (opts.close) {
      sub.closed = true;
    }
    return {
      events: drained,
      closed: sub.closed,
      sentOverflow: overflow,
      more,
    };
  }

  /**
   * Tear down a subscription. Idempotent on unknown id (mirrors typical
   * cleanup semantics — callers that retry close on network hiccups don't
   * need to catch a "never existed" error).
   */
  close(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;
    sub.closed = true;
  }

  /**
   * Close subscriptions whose last poll was more than `staleAfterMs` ago.
   * Call sites schedule this themselves (e.g. on every RPC handler entry
   * or via a setInterval). Not auto-scheduled by this module so it remains
   * test-deterministic (QB #7 — per-instance state, no hidden timers).
   *
   * Returns the number of subscriptions swept.
   */
  sweepStale(): number {
    const now = Date.now();
    let swept = 0;
    for (const sub of this.subscriptions.values()) {
      if (sub.closed) continue;
      if (now - sub.lastPolledAt >= this.staleAfterMs) {
        sub.closed = true;
        swept++;
      }
    }
    return swept;
  }

  /**
   * Active (non-closed) subscription count. Useful for introspection and
   * for call sites that want to surface a "N clients watching" metric.
   */
  activeCount(): number {
    let n = 0;
    for (const sub of this.subscriptions.values()) {
      if (!sub.closed) n++;
    }
    return n;
  }
}
