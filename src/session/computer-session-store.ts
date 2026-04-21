/**
 * Computer Session Store — WOTANN cross-surface session keystone.
 *
 * Per WOTANN Cross-Surface Synergy Design (docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md):
 * Phone creates a task session; desktop claims it; phone watches progress.
 *
 * This is the single source of truth for `computer.session` state. Per Quality Bar #7,
 * per-session data lives here — NOT in module globals. Callers thread this instance
 * through (it is stored once on the KairosRPCHandler).
 *
 * Lifecycle:
 *   pending -> claimed -> running -> (awaiting_approval -> running)* -> done|failed
 *
 * Event fan-out: subscribers receive a history replay followed by a live tail of new
 * events. Event ordering is preserved via a per-session monotonic `seq` counter.
 *
 * Eviction: FIFO cap at `maxSessions` (default 1000). When the cap is exceeded, the
 * oldest terminal (done|failed) session is evicted first; if none, the oldest pending.
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// ── Types ──────────────────────────────────────────────────

export type SessionStatus =
  | "pending"
  | "claimed"
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed";

export type SessionEventType =
  | "created"
  | "claimed"
  | "step"
  | "approval_request"
  | "approval_decision"
  | "cursor"
  | "frame"
  | "file_write"
  | "done"
  | "error";

export interface TaskSpec {
  readonly task: string;
  readonly mode?: "research" | "autopilot" | "focused" | "watch-only";
  readonly maxSteps?: number;
  readonly creationPath?: string;
  readonly modelId?: string;
}

export interface SessionEvent {
  readonly sessionId: string;
  readonly seq: number;
  readonly timestamp: number;
  readonly type: SessionEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface Session {
  readonly id: string;
  readonly creatorDeviceId: string;
  readonly claimedByDeviceId: string | null;
  readonly taskSpec: TaskSpec;
  readonly status: SessionStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly events: readonly SessionEvent[];
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly pendingApprovalId: string | null;
}

export interface PendingApproval {
  readonly id: string;
  readonly sessionId: string;
  readonly summary: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly createdAt: number;
}

export interface StoreConfig {
  readonly maxSessions: number;
}

const DEFAULT_CONFIG: StoreConfig = {
  maxSessions: 1000,
};

// ── Error Types (QB #6 — honest failures) ─────────────────

export class SessionNotFoundError extends Error {
  readonly code = "SESSION_NOT_FOUND";
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionAlreadyClaimedError extends Error {
  readonly code = "SESSION_ALREADY_CLAIMED";
  constructor(sessionId: string, existingDeviceId: string) {
    super(`Session ${sessionId} already claimed by device ${existingDeviceId}`);
    this.name = "SessionAlreadyClaimedError";
  }
}

export class SessionUnauthorizedError extends Error {
  readonly code = "SESSION_UNAUTHORIZED";
  constructor(sessionId: string, deviceId: string, reason: string) {
    super(`Device ${deviceId} unauthorized for session ${sessionId}: ${reason}`);
    this.name = "SessionUnauthorizedError";
  }
}

export class SessionIllegalTransitionError extends Error {
  readonly code = "SESSION_ILLEGAL_TRANSITION";
  constructor(sessionId: string, from: SessionStatus, to: SessionStatus) {
    super(`Illegal transition for session ${sessionId}: ${from} -> ${to}`);
    this.name = "SessionIllegalTransitionError";
  }
}

// ── State transition matrix ────────────────────────────────

const ALLOWED_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  // close() from any non-terminal state is permitted — the runner may detect a
  // finished task at any point in its lifecycle (including "claimed" before the
  // first step emits). Illegal transitions are still guarded for STEP and
  // APPROVE (which have specific precondition requirements).
  pending: ["claimed", "done", "failed"],
  claimed: ["running", "done", "failed"],
  running: ["awaiting_approval", "done", "failed"],
  awaiting_approval: ["running", "done", "failed"],
  done: [],
  failed: [],
};

function isTerminal(status: SessionStatus): boolean {
  return status === "done" || status === "failed";
}

// ── Store ──────────────────────────────────────────────────

/**
 * In-memory + event bus for Computer Sessions.
 *
 * Persistence note: this class stays in-memory; wiring to SQLite is deferred until
 * the session daemon reboot-survive story lands (tracked in the synergy design as a
 * separate item from F1). We preserve the interface so a persistence layer can be
 * added without changing RPC contracts.
 */
export class ComputerSessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly emitter = new EventEmitter();
  private readonly config: StoreConfig;

  constructor(config?: Partial<StoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // EventEmitter default maxListeners is 10. Cross-surface means many subscribers.
    this.emitter.setMaxListeners(0);
  }

  // ── Create ─────────────────────────────────────────────

  create(params: { readonly creatorDeviceId: string; readonly taskSpec: TaskSpec }): Session {
    if (!params.creatorDeviceId || params.creatorDeviceId.trim() === "") {
      throw new Error("creatorDeviceId required");
    }
    if (!params.taskSpec?.task || params.taskSpec.task.trim() === "") {
      throw new Error("taskSpec.task required");
    }

    const id = `cs-${randomUUID()}`;
    const now = Date.now();
    const createdEvent: SessionEvent = {
      sessionId: id,
      seq: 0,
      timestamp: now,
      type: "created",
      payload: {
        creatorDeviceId: params.creatorDeviceId,
        taskSpec: params.taskSpec,
      },
    };
    const session: Session = {
      id,
      creatorDeviceId: params.creatorDeviceId,
      claimedByDeviceId: null,
      taskSpec: params.taskSpec,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      events: [createdEvent],
      result: null,
      pendingApprovalId: null,
    };

    this.sessions.set(id, session);
    this.evictIfNeeded();
    this.emitEvent(createdEvent);
    return session;
  }

  // ── Claim ─────────────────────────────────────────────

  claim(sessionId: string, deviceId: string): Session {
    if (!deviceId || deviceId.trim() === "") {
      throw new Error("deviceId required");
    }
    const current = this.requireSession(sessionId);
    if (current.claimedByDeviceId !== null && current.claimedByDeviceId !== deviceId) {
      throw new SessionAlreadyClaimedError(sessionId, current.claimedByDeviceId);
    }
    if (current.status !== "pending" && current.claimedByDeviceId !== deviceId) {
      throw new SessionIllegalTransitionError(sessionId, current.status, "claimed");
    }

    // Idempotent: same device re-claiming is a no-op that returns current state.
    if (current.claimedByDeviceId === deviceId) {
      return current;
    }

    const event = this.appendEvent(current, "claimed", { claimedByDeviceId: deviceId });
    const next = this.transition(current, "claimed", {
      claimedByDeviceId: deviceId,
      events: [...current.events, event],
    });
    this.sessions.set(sessionId, next);
    this.emitEvent(event);
    return next;
  }

  // ── Step (runner emits progress) ─────────────────────

  step(params: {
    readonly sessionId: string;
    readonly deviceId: string;
    readonly step: Readonly<Record<string, unknown>>;
  }): Session {
    const current = this.requireSession(params.sessionId);
    this.requireClaimingDevice(current, params.deviceId);

    // Running implies first step transitions claimed -> running.
    let targetStatus: SessionStatus = current.status;
    if (current.status === "claimed") {
      targetStatus = "running";
    } else if (current.status !== "running" && current.status !== "awaiting_approval") {
      throw new SessionIllegalTransitionError(params.sessionId, current.status, "running");
    }

    const event = this.appendEvent(current, "step", params.step);
    const updates: Partial<Session> = { events: [...current.events, event] };
    const next =
      targetStatus !== current.status
        ? this.transition(current, targetStatus, updates)
        : this.applyUpdates(current, updates);

    this.sessions.set(params.sessionId, next);
    this.emitEvent(event);
    return next;
  }

  // ── Request approval (runner pauses waiting for phone) ─

  requestApproval(params: {
    readonly sessionId: string;
    readonly deviceId: string;
    readonly summary: string;
    readonly riskLevel: "low" | "medium" | "high";
  }): { readonly session: Session; readonly approval: PendingApproval } {
    const current = this.requireSession(params.sessionId);
    this.requireClaimingDevice(current, params.deviceId);
    if (current.status !== "running" && current.status !== "claimed") {
      throw new SessionIllegalTransitionError(
        params.sessionId,
        current.status,
        "awaiting_approval",
      );
    }

    const approvalId = `ap-${randomUUID()}`;
    const approval: PendingApproval = {
      id: approvalId,
      sessionId: params.sessionId,
      summary: params.summary,
      riskLevel: params.riskLevel,
      createdAt: Date.now(),
    };
    this.pendingApprovals.set(approvalId, approval);

    const event = this.appendEvent(current, "approval_request", {
      approvalId,
      summary: params.summary,
      riskLevel: params.riskLevel,
    });
    const next = this.transition(current, "awaiting_approval", {
      events: [...current.events, event],
      pendingApprovalId: approvalId,
    });
    this.sessions.set(params.sessionId, next);
    this.emitEvent(event);
    return { session: next, approval };
  }

  // ── Approve (phone decides) ───────────────────────────

  approve(params: {
    readonly sessionId: string;
    readonly deviceId: string;
    readonly decision: "allow" | "deny";
  }): Session {
    const current = this.requireSession(params.sessionId);
    // Only the CREATOR (phone) can approve; NOT the claiming runner (desktop).
    if (current.creatorDeviceId !== params.deviceId) {
      throw new SessionUnauthorizedError(
        params.sessionId,
        params.deviceId,
        "only the creator device can approve",
      );
    }
    if (current.status !== "awaiting_approval") {
      throw new SessionIllegalTransitionError(
        params.sessionId,
        current.status,
        params.decision === "allow" ? "running" : "failed",
      );
    }

    const approvalId = current.pendingApprovalId;
    const approval = approvalId ? this.pendingApprovals.get(approvalId) : null;
    const event = this.appendEvent(current, "approval_decision", {
      decision: params.decision,
      approvalId,
      summary: approval?.summary,
    });

    if (approvalId) {
      this.pendingApprovals.delete(approvalId);
    }

    const nextStatus: SessionStatus = params.decision === "allow" ? "running" : "failed";
    const next = this.transition(current, nextStatus, {
      events: [...current.events, event],
      pendingApprovalId: null,
      // If denied, treat as terminal with an explicit result.
      result: nextStatus === "failed" ? { reason: "approval_denied", approvalId } : current.result,
    });
    this.sessions.set(params.sessionId, next);
    this.emitEvent(event);
    return next;
  }

  // ── Close (runner signals done) ──────────────────────

  close(params: {
    readonly sessionId: string;
    readonly deviceId: string;
    readonly outcome: "done" | "failed";
    readonly result?: Readonly<Record<string, unknown>>;
    readonly error?: string;
  }): Session {
    const current = this.requireSession(params.sessionId);
    // The claimed device closes. If never claimed, creator may close (pending -> failed only).
    if (current.claimedByDeviceId !== null) {
      this.requireClaimingDevice(current, params.deviceId);
    } else if (current.creatorDeviceId !== params.deviceId) {
      throw new SessionUnauthorizedError(
        params.sessionId,
        params.deviceId,
        "only claimant or creator can close",
      );
    }

    if (isTerminal(current.status)) {
      // Idempotent close — return current state.
      return current;
    }

    const eventType: SessionEventType = params.outcome === "done" ? "done" : "error";
    const event = this.appendEvent(current, eventType, {
      result: params.result,
      error: params.error,
    });
    const next = this.transition(current, params.outcome, {
      events: [...current.events, event],
      result: params.result ?? (params.error ? { error: params.error } : null),
    });
    this.sessions.set(params.sessionId, next);
    this.emitEvent(event);
    return next;
  }

  // ── Read APIs ─────────────────────────────────────────

  get(sessionId: string): Session {
    return this.requireSession(sessionId);
  }

  getOrNull(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  list(filter?: { readonly status?: SessionStatus }): readonly Session[] {
    const values = [...this.sessions.values()];
    const filtered = filter?.status ? values.filter((s) => s.status === filter.status) : values;
    return filtered.sort((a, b) => a.createdAt - b.createdAt);
  }

  size(): number {
    return this.sessions.size;
  }

  getPendingApproval(approvalId: string): PendingApproval | null {
    return this.pendingApprovals.get(approvalId) ?? null;
  }

  // ── Event subscription ────────────────────────────────

  /**
   * Subscribe to events for a session. Replays history (events that have already
   * been emitted up to the point of subscription) then tails live events.
   *
   * Returns a disposer that removes the listener. Callers MUST invoke the disposer
   * or the subscriber remains attached (and holds the session state in the closure).
   *
   * Event ordering is preserved within a session: each event carries a monotonic seq.
   * Across subscribers for the same session, the emit order is identical because
   * EventEmitter runs listeners synchronously in registration order.
   */
  subscribe(sessionId: string, listener: (event: SessionEvent) => void): () => void {
    const current = this.sessions.get(sessionId);
    if (!current) {
      throw new SessionNotFoundError(sessionId);
    }
    // Replay history synchronously.
    for (const event of current.events) {
      listener(event);
    }
    const channel = `session:${sessionId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Subscribe to ALL session events (every session). Used by UnifiedDispatchPlane
   * integration to fan out to cross-surface channels. No history replay — this is
   * live-tail only, starting from the subscription moment.
   */
  subscribeAll(listener: (event: SessionEvent) => void): () => void {
    this.emitter.on("session:*", listener);
    return () => {
      this.emitter.off("session:*", listener);
    };
  }

  // ── Internal helpers ─────────────────────────────────

  private requireSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  private requireClaimingDevice(session: Session, deviceId: string): void {
    if (session.claimedByDeviceId === null) {
      throw new SessionUnauthorizedError(session.id, deviceId, "session not yet claimed");
    }
    if (session.claimedByDeviceId !== deviceId) {
      throw new SessionUnauthorizedError(
        session.id,
        deviceId,
        `expected claimant ${session.claimedByDeviceId}`,
      );
    }
  }

  private appendEvent(
    session: Session,
    type: SessionEventType,
    payload: Readonly<Record<string, unknown>>,
  ): SessionEvent {
    const seq = session.events.length;
    return {
      sessionId: session.id,
      seq,
      timestamp: Date.now(),
      type,
      payload,
    };
  }

  private transition(current: Session, next: SessionStatus, updates: Partial<Session>): Session {
    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.includes(next)) {
      throw new SessionIllegalTransitionError(current.id, current.status, next);
    }
    return this.applyUpdates({ ...current, status: next }, updates);
  }

  private applyUpdates(current: Session, updates: Partial<Session>): Session {
    return {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };
  }

  private emitEvent(event: SessionEvent): void {
    this.emitter.emit(`session:${event.sessionId}`, event);
    this.emitter.emit("session:*", event);
  }

  /**
   * Eviction: when size exceeds maxSessions, remove the oldest terminal session; if
   * none, remove the oldest pending. Never evicts active (claimed/running/awaiting).
   */
  private evictIfNeeded(): void {
    if (this.sessions.size <= this.config.maxSessions) return;

    const all = [...this.sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
    const terminal = all.find((s) => isTerminal(s.status));
    if (terminal) {
      this.sessions.delete(terminal.id);
      return;
    }
    const pending = all.find((s) => s.status === "pending");
    if (pending) {
      this.sessions.delete(pending.id);
      return;
    }
    // All active — evict the very oldest. This is the bounded-queue safety valve.
    if (all[0]) {
      this.sessions.delete(all[0].id);
    }
  }
}
