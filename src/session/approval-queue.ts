/**
 * Approval Queue — WOTANN Phase 3 P1-F6 (dedicated approval subscription channel).
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S6 and
 * MASTER_PLAN_V8 §5 P1-F6 (1 day), F1 already shipped `computer.session.approve`
 * as part of the session event stream. F6 adds a *dedicated* approval bus so
 * small surfaces — Apple Watch, phones in background, CarPlay — can react to
 * an approval request without subscribing to every cursor / step / frame
 * event in the full session stream.
 *
 * Contract:
 *   enqueue → queue.pending → broadcast(approval-request)
 *              │
 *              ├── decide(allow|deny) → broadcast(approval-decided)
 *              └── sweepExpired() (after TTL) → state=expired, decision=deny
 *                                             → broadcast(approval-expired)
 *
 * This class is a thin policy/state layer. It does NOT own the downstream
 * session state machine (ComputerSessionStore does). The daemon wires
 * ApprovalQueue ↔ ComputerSessionStore at a higher layer when we land the
 * phone-side UI — today the queue exists as an independent primitive so the
 * wire protocol can be validated against it.
 *
 * Typed payloads (one of four kinds) are used so each surface can render
 * appropriate UI: shell-exec shows a terminal preview, file-write shows a
 * diff, destructive shows the big red warning, custom lets future extensions
 * pass through without touching this file.
 *
 * Design principles (session quality bars referenced inline):
 *
 *   QB #6 (honest failures) — every failure path raises a typed error:
 *     ErrorApprovalNotFound, ErrorAlreadyDecided, ErrorExpired,
 *     ErrorInvalidPayload. No silent swallowing.
 *
 *   QB #7 (per-session state) — this is a class, not a module global. The
 *   daemon owns one instance; tests construct their own.
 *
 *   QB #11 (sibling-site scan) — existing approval paths live on
 *   ComputerSessionStore (pendingApprovals Map) and companion-server.ts's
 *   task.approve handler. Neither overlaps with this queue: the store keeps
 *   session-bound approvals tied to its state machine; this queue is the
 *   cross-surface fan-out + typed-payload primitive that F1 deferred.
 *
 *   QB #12 (deterministic tests) — caller-supplied `now()` clock drives
 *   enqueue timestamps and TTL arithmetic.
 *
 *   QB #14 (claim verification) — the RPC wiring in kairos-rpc.ts is covered
 *   by end-to-end tests in tests/session/approval-queue.test.ts, not just
 *   unit exercise against the queue.
 */

import { randomUUID } from "node:crypto";
import type { UnifiedEvent } from "../channels/fan-out.js";
import { createSqliteKvStore, type SQLiteKvStore } from "../utils/sqlite-kv-store.js";

// ── Typed payloads ────────────────────────────────────────

/**
 * Shell command approval. `command` is what will be executed; `cwd` is the
 * working directory. Watches/phones render a monospace preview.
 */
export interface ShellExecPayload {
  readonly kind: "shell-exec";
  readonly command: string;
  readonly cwd: string;
}

/**
 * File write approval. `preview` is a short sample of the file content
 * (trimmed to 1 KiB on enqueue so the approval itself never bloats the
 * bus). `path` is the absolute destination.
 */
export interface FileWritePayload {
  readonly kind: "file-write";
  readonly path: string;
  readonly preview: string;
}

/**
 * Destructive operation approval (drop table, delete directory, force push).
 * Requires `operation` (what), `target` (against what), and `reason` (why the
 * runner thinks this is necessary) so the approver can make an informed call
 * even with no other context.
 */
export interface DestructivePayload {
  readonly kind: "destructive";
  readonly operation: string;
  readonly target: string;
  readonly reason: string;
}

/**
 * Escape hatch for extensions that don't fit the three shapes above. The
 * `schemaId` lets the rendering surface dispatch to the right view (e.g.
 * "mcp.server.install" / "plugin.install"). `data` is opaque to this queue.
 */
export interface CustomPayload {
  readonly kind: "custom";
  readonly schemaId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * T10.4 — Browser-action approval. Raised by the agentic-browser orchestrator
 * when the trifecta guard asks for human review on a browse step
 * (navigate/click/type/extract) before executing. Surfaces render the URL +
 * `description` and apply risk-level styling; `actionId` is the browse step
 * id so downstream events can cross-reference without rehydrating the plan.
 *
 * `type: "browser.action"` uses dot-notation (as opposed to the kebab-case
 * used for the four earlier variants) to match the T10.4 event convention
 * (`browser.tab.opened`, `browser.action.approved`) emitted by
 * `computer-session-store.ts`. Keeping the vocabulary aligned across queue
 * and event store lets cross-surface UIs key off a single prefix.
 */
export interface BrowserActionPayload {
  readonly kind: "browser-action";
  readonly type: "browser.action";
  readonly actionId: string;
  readonly url: string;
  readonly description: string;
  readonly riskLevel: RiskLevel;
  readonly createdAt: number;
}

export type ApprovalPayload =
  | ShellExecPayload
  | FileWritePayload
  | DestructivePayload
  | CustomPayload
  | BrowserActionPayload;

export type ApprovalState = "pending" | "decided" | "expired";
export type ApprovalDecision = "allow" | "deny";
export type RiskLevel = "low" | "medium" | "high";

/**
 * T10.4 — Constructor for a `BrowserActionPayload`. Fills in the discriminator
 * fields + caller-supplied `createdAt` (or `Date.now()` fallback) so
 * orchestrators don't have to thread the literals manually at every call
 * site. Returns a frozen-shape plain object (readonly is enforced by the
 * TS type, not Object.freeze — consistent with the other three variants).
 */
export function createBrowserActionPayload(args: {
  readonly actionId: string;
  readonly url: string;
  readonly description: string;
  readonly riskLevel: RiskLevel;
  readonly createdAt?: number;
}): BrowserActionPayload {
  return {
    kind: "browser-action",
    type: "browser.action",
    actionId: args.actionId,
    url: args.url,
    description: args.description,
    riskLevel: args.riskLevel,
    createdAt: args.createdAt ?? Date.now(),
  };
}

/**
 * In-memory record of an approval. Immutable from the outside — `decide`
 * and `sweepExpired` return a new record, callers should NOT mutate.
 */
export interface ApprovalRecord {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly payload: ApprovalPayload;
  readonly summary: string;
  readonly riskLevel: RiskLevel;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly state: ApprovalState;
  readonly decision: ApprovalDecision | null;
  readonly deciderDeviceId: string | null;
  readonly decidedAt: number | null;
}

// ── Events ────────────────────────────────────────────────

export type ApprovalEventType = "enqueued" | "decided" | "expired";

/**
 * Event emitted on the queue's internal bus. Carries enough to let a
 * subscriber render a full UI cell without re-fetching.
 */
export interface ApprovalEvent {
  readonly type: ApprovalEventType;
  readonly approvalId: string;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly record: ApprovalRecord;
  readonly decision?: ApprovalDecision;
}

// ── Errors (QB #6) ────────────────────────────────────────

export class ErrorApprovalNotFound extends Error {
  readonly code = "APPROVAL_NOT_FOUND";
  readonly approvalId: string;
  constructor(approvalId: string) {
    super(`Approval not found: ${approvalId}`);
    this.name = "ErrorApprovalNotFound";
    this.approvalId = approvalId;
  }
}

export class ErrorAlreadyDecided extends Error {
  readonly code = "APPROVAL_ALREADY_DECIDED";
  readonly approvalId: string;
  readonly decision: ApprovalDecision;
  constructor(approvalId: string, decision: ApprovalDecision) {
    super(`Approval ${approvalId} already decided: ${decision}`);
    this.name = "ErrorAlreadyDecided";
    this.approvalId = approvalId;
    this.decision = decision;
  }
}

export class ErrorExpired extends Error {
  readonly code = "APPROVAL_EXPIRED";
  readonly approvalId: string;
  readonly expiresAt: number;
  constructor(approvalId: string, expiresAt: number) {
    super(`Approval ${approvalId} expired at ${expiresAt}`);
    this.name = "ErrorExpired";
    this.approvalId = approvalId;
    this.expiresAt = expiresAt;
  }
}

export class ErrorInvalidPayload extends Error {
  readonly code = "APPROVAL_INVALID_PAYLOAD";
  readonly reason: string;
  constructor(reason: string) {
    super(`Invalid approval payload: ${reason}`);
    this.name = "ErrorInvalidPayload";
    this.reason = reason;
  }
}

// ── Config ────────────────────────────────────────────────

export interface ApprovalQueueConfig {
  /** Default TTL for approvals that don't specify one explicitly. Default 5 min. */
  readonly defaultTtlMs: number;
  /** Max characters retained from a file-write preview. Default 1024 (1 KiB). */
  readonly previewMaxChars: number;
}

const DEFAULT_CONFIG: ApprovalQueueConfig = {
  defaultTtlMs: 5 * 60_000,
  previewMaxChars: 1024,
};

/**
 * Optional broadcast hook. When wired (typically via
 * UnifiedDispatchPlane.broadcastUnifiedEvent per F11), each lifecycle step
 * (enqueued, decided, expired) fans out to every registered surface so
 * watches/phones learn about new approvals without polling.
 */
export type BroadcastFn = (event: UnifiedEvent) => void | Promise<void>;

export type ApprovalListener = (event: ApprovalEvent) => void;

export interface ApprovalQueueOptions {
  readonly now?: () => number;
  readonly broadcast?: BroadcastFn;
  readonly defaultTtlMs?: number;
  readonly previewMaxChars?: number;
  /**
   * Wave 6-KK / H-24 — optional SQLite persistence path. When supplied,
   * approval records are mirrored to `<dbPath>` so a daemon restart
   * doesn't blackhole every in-flight approval. Records are rehydrated
   * into the in-memory map on construction. When omitted (the default
   * for tests + lightweight callers), the queue stays purely in-memory
   * and matches pre-Wave-6-KK behavior. QB #6: if better-sqlite3 fails
   * to load at this path, the store warns and falls back to in-memory.
   */
  readonly persistPath?: string;
}

// ── Queue ─────────────────────────────────────────────────

/**
 * Queue of in-flight approval requests. One instance per daemon; per-request
 * state is keyed by `approvalId`. `pending` / `pendingForSession` surface
 * active approvals; `subscribe` delivers live events to RPC pollers.
 */
export class ApprovalQueue {
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly listeners = new Set<ApprovalListener>();
  private readonly config: ApprovalQueueConfig;
  private readonly clock: () => number;
  private broadcast: BroadcastFn | null;
  // Wave 6-KK / H-24 — instance-level SQLite handle (QB #7: per-instance,
  // never module-global). Null when caller didn't supply `persistPath`,
  // OR when the SQLite handle failed to open (helper logs once + falls
  // through to in-memory only per QB #6).
  private readonly persistence: SQLiteKvStore | null;

  constructor(options: ApprovalQueueOptions = {}) {
    this.config = {
      defaultTtlMs: options.defaultTtlMs ?? DEFAULT_CONFIG.defaultTtlMs,
      previewMaxChars: options.previewMaxChars ?? DEFAULT_CONFIG.previewMaxChars,
    };
    this.clock = options.now ?? (() => Date.now());
    this.broadcast = options.broadcast ?? null;
    // H-24 fix: open SQLite kv store + rehydrate. The kv-store helper
    // is honest about failures — when better-sqlite3 fails to load (e.g.
    // a missing native binary on a fresh CI image), `usable` reads false
    // and every kv method becomes a no-op, leaving us in pure-in-memory
    // mode with a one-time console.warn.
    if (options.persistPath) {
      const store = createSqliteKvStore(options.persistPath, "approvals");
      this.persistence = store.usable ? store : null;
      if (this.persistence) {
        for (const { value } of this.persistence.loadAll<ApprovalRecord>()) {
          if (value && typeof value === "object" && typeof value.approvalId === "string") {
            this.records.set(value.approvalId, value);
          }
        }
      }
    } else {
      this.persistence = null;
    }
  }

  /**
   * Attach (or replace / detach with null) the broadcast hook after
   * construction. Needed because the dispatch plane is set by the daemon
   * AFTER the RPC handler creates the queue.
   */
  setBroadcast(fn: BroadcastFn | null): void {
    this.broadcast = fn;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Enqueue an approval request. Returns the created record. Broadcasts an
   * `approval-request` UnifiedEvent if a broadcast hook is wired, and
   * emits an `enqueued` event on the internal subscriber bus.
   *
   * Throws ErrorInvalidPayload if the payload fails its kind-specific
   * schema checks. Throws a plain Error if `sessionId` or `summary` is
   * missing — those are table-stakes and not worth a dedicated class.
   */
  enqueue(params: {
    readonly sessionId: string;
    readonly payload: ApprovalPayload;
    readonly summary: string;
    readonly riskLevel: RiskLevel;
    readonly ttlMs?: number;
  }): ApprovalRecord {
    if (typeof params.sessionId !== "string" || params.sessionId.trim() === "") {
      throw new Error("sessionId (non-empty string) required");
    }
    if (typeof params.summary !== "string") {
      throw new Error("summary (string) required");
    }
    const payload = this.validatePayload(params.payload);
    const now = this.clock();
    const ttl = params.ttlMs ?? this.config.defaultTtlMs;
    const record: ApprovalRecord = {
      approvalId: `ap-${randomUUID()}`,
      sessionId: params.sessionId,
      payload,
      summary: params.summary,
      riskLevel: params.riskLevel,
      createdAt: now,
      expiresAt: now + ttl,
      state: "pending",
      decision: null,
      deciderDeviceId: null,
      decidedAt: null,
    };
    this.records.set(record.approvalId, record);
    this.persistence?.put(record.approvalId, record);
    const event: ApprovalEvent = {
      type: "enqueued",
      approvalId: record.approvalId,
      sessionId: record.sessionId,
      timestamp: now,
      record,
    };
    this.emit(event);
    this.fanOut({
      action: "approval-request",
      approvalId: record.approvalId,
      sessionId: record.sessionId,
      riskLevel: record.riskLevel,
      summary: record.summary,
      payload: record.payload,
      expiresAt: record.expiresAt,
    });
    return record;
  }

  /**
   * Resolve a pending approval. Returns the updated record.
   *
   * Throws:
   *   - ErrorApprovalNotFound if the id is unknown
   *   - ErrorAlreadyDecided if the approval is already decided
   *   - ErrorExpired if the approval's TTL has already elapsed
   *
   * Note: TTL-late decisions are explicitly rejected (rather than
   * silently denying) so clients can distinguish between "I approved in
   * time but got beaten" vs "you can still change your mind". A separate
   * `sweepExpired` pass terminally transitions overdue pending approvals.
   */
  decide(params: {
    readonly approvalId: string;
    readonly decision: ApprovalDecision;
    readonly deciderDeviceId: string;
  }): ApprovalRecord {
    const existing = this.records.get(params.approvalId);
    if (!existing) {
      throw new ErrorApprovalNotFound(params.approvalId);
    }
    if (existing.state === "decided") {
      // existing.decision is guaranteed non-null in "decided" state by
      // enqueue/decide invariants, but the type allows null so narrow
      // defensively — a missing decision falls back to "deny".
      throw new ErrorAlreadyDecided(params.approvalId, existing.decision ?? "deny");
    }
    const now = this.clock();
    if (existing.state === "expired" || now > existing.expiresAt) {
      throw new ErrorExpired(params.approvalId, existing.expiresAt);
    }

    const decided: ApprovalRecord = {
      ...existing,
      state: "decided",
      decision: params.decision,
      deciderDeviceId: params.deciderDeviceId,
      decidedAt: now,
    };
    this.records.set(params.approvalId, decided);
    this.persistence?.put(decided.approvalId, decided);
    const event: ApprovalEvent = {
      type: "decided",
      approvalId: decided.approvalId,
      sessionId: decided.sessionId,
      timestamp: now,
      record: decided,
      decision: params.decision,
    };
    this.emit(event);
    this.fanOut({
      action: "approval-decided",
      approvalId: decided.approvalId,
      sessionId: decided.sessionId,
      decision: params.decision,
      deciderDeviceId: params.deciderDeviceId,
    });
    return decided;
  }

  /**
   * Transition any pending approval whose TTL has elapsed to `expired`
   * state (with decision=deny, so downstream consumers that key off
   * decision see a terminal value). Returns the list of records that
   * were transitioned. Each transition fires an `expired` event on the
   * internal bus and an `approval-expired` broadcast.
   *
   * Callers invoke this on a timer (daemon) or when polling the queue
   * (RPC). Idempotent: already-expired or decided records are skipped.
   */
  sweepExpired(): readonly ApprovalRecord[] {
    const now = this.clock();
    const expired: ApprovalRecord[] = [];
    for (const [id, rec] of this.records) {
      if (rec.state !== "pending") continue;
      if (now <= rec.expiresAt) continue;
      const next: ApprovalRecord = {
        ...rec,
        state: "expired",
        decision: "deny",
        decidedAt: now,
      };
      this.records.set(id, next);
      this.persistence?.put(id, next);
      expired.push(next);
      const event: ApprovalEvent = {
        type: "expired",
        approvalId: next.approvalId,
        sessionId: next.sessionId,
        timestamp: now,
        record: next,
      };
      this.emit(event);
      this.fanOut({
        action: "approval-expired",
        approvalId: next.approvalId,
        sessionId: next.sessionId,
        summary: next.summary,
        payload: next.payload,
      });
    }
    return expired;
  }

  /**
   * List all currently pending approvals across all sessions. Sorted by
   * createdAt (oldest first) so UIs render deterministically. Decided
   * and expired records are excluded — callers who want the full history
   * should use `getRecord` by id.
   */
  pending(): readonly ApprovalRecord[] {
    const out: ApprovalRecord[] = [];
    for (const rec of this.records.values()) {
      if (rec.state === "pending") out.push(rec);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Pending approvals scoped to one session. */
  pendingForSession(sessionId: string): readonly ApprovalRecord[] {
    return this.pending().filter((r) => r.sessionId === sessionId);
  }

  /** Fetch a specific record (any state). */
  getRecord(approvalId: string): ApprovalRecord | null {
    return this.records.get(approvalId) ?? null;
  }

  /** Total records retained (pending + decided + expired). Tests assert on this. */
  size(): number {
    return this.records.size;
  }

  /**
   * Subscribe to lifecycle events. Returns a disposer that removes the
   * listener. No history replay — subscribers see events from the moment
   * of subscription onward. If a listener throws, the error is contained
   * (not propagated to other listeners) — the bus must not poison.
   */
  subscribe(listener: ApprovalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Internal ──────────────────────────────────────────

  /**
   * Narrow + trim the payload in one place. Kind-specific schema checks
   * live here so invalid input never makes it into the bus.
   */
  private validatePayload(payload: ApprovalPayload): ApprovalPayload {
    if (!payload || typeof payload !== "object") {
      throw new ErrorInvalidPayload("payload must be an object");
    }
    switch (payload.kind) {
      case "shell-exec": {
        if (typeof payload.command !== "string" || payload.command.trim() === "") {
          throw new ErrorInvalidPayload("shell-exec requires non-empty command");
        }
        if (typeof payload.cwd !== "string") {
          throw new ErrorInvalidPayload("shell-exec requires cwd string");
        }
        return payload;
      }
      case "file-write": {
        if (typeof payload.path !== "string" || payload.path.trim() === "") {
          throw new ErrorInvalidPayload("file-write requires non-empty path");
        }
        if (typeof payload.preview !== "string") {
          throw new ErrorInvalidPayload("file-write requires preview string");
        }
        // Trim oversize previews to keep the bus light. Watches and
        // push-notification payloads have hard size caps; holding a
        // 10 MiB preview in the approval record serves no one.
        const trimmed = payload.preview.slice(0, this.config.previewMaxChars);
        return { ...payload, preview: trimmed };
      }
      case "destructive": {
        if (typeof payload.operation !== "string" || payload.operation.trim() === "") {
          throw new ErrorInvalidPayload("destructive requires non-empty operation");
        }
        if (typeof payload.target !== "string" || payload.target.trim() === "") {
          throw new ErrorInvalidPayload("destructive requires non-empty target");
        }
        if (typeof payload.reason !== "string" || payload.reason.trim() === "") {
          throw new ErrorInvalidPayload("destructive requires non-empty reason");
        }
        return payload;
      }
      case "custom": {
        if (typeof payload.schemaId !== "string" || payload.schemaId.trim() === "") {
          throw new ErrorInvalidPayload("custom requires non-empty schemaId");
        }
        if (!payload.data || typeof payload.data !== "object") {
          throw new ErrorInvalidPayload("custom requires data object");
        }
        return payload;
      }
      case "browser-action": {
        if (typeof payload.actionId !== "string" || payload.actionId.trim() === "") {
          throw new ErrorInvalidPayload("browser-action requires non-empty actionId");
        }
        if (typeof payload.url !== "string" || payload.url.trim() === "") {
          throw new ErrorInvalidPayload("browser-action requires non-empty url");
        }
        if (typeof payload.description !== "string") {
          throw new ErrorInvalidPayload("browser-action requires description string");
        }
        if (payload.type !== "browser.action") {
          throw new ErrorInvalidPayload("browser-action requires type='browser.action'");
        }
        return payload;
      }
      default: {
        // Exhaustive switch — `never` tells TS we handled all cases.
        const exhaustive: never = payload;
        throw new ErrorInvalidPayload(`unknown payload kind: ${String(exhaustive)}`);
      }
    }
  }

  private emit(event: ApprovalEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors are contained — the bus must not poison on a
        // single bad subscriber. Callers that care about delivery
        // failures should wrap their own try/catch.
      }
    }
  }

  private fanOut(payload: Record<string, unknown>): void {
    if (!this.broadcast) return;
    const event: UnifiedEvent = {
      type: "approval",
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
