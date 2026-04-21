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
  | "handed_off"
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
  | "handoff_initiated"
  | "handoff_accepted"
  | "handoff_expired"
  | "done"
  | "error";

export type HandoffState = "pending" | "accepted" | "expired";

/**
 * Audit-trail record of a handoff attempt. Kept on the session itself so the
 * full chain of custody survives even after the session terminates. Per the
 * F14 design, transfers are never silently dropped — every attempt (accepted
 * or expired) leaves a trace here for debugging and compliance.
 */
export interface HandoffRecord {
  readonly id: string;
  readonly fromDeviceId: string;
  readonly toDeviceId: string;
  readonly reason: string | null;
  readonly requestedAt: number;
  readonly acceptedAt: number | null;
  readonly expiredAt: number | null;
  readonly expiresAt: number;
  readonly state: HandoffState;
}

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
  /** F14 — id of the in-flight handoff, if any. Null unless status=handed_off. */
  readonly pendingHandoffId: string | null;
  /** F14 — full audit trail of every handoff attempted against this session. */
  readonly handoffs: readonly HandoffRecord[];
  /**
   * F14 — status snapshot captured when a handoff was initiated. On accept,
   * the session returns to this exact status so the runner can pick up where
   * the previous claimant paused. Null outside of the handed_off window.
   */
  readonly handoffResumeStatus: SessionStatus | null;
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

// ── F14 — Cross-session resume errors (QB #6: honest failures) ─

export class ErrorDeviceNotRegistered extends Error {
  readonly code = "HANDOFF_DEVICE_NOT_REGISTERED";
  readonly deviceId: string;
  constructor(deviceId: string) {
    super(`Handoff target device is not registered: ${deviceId}`);
    this.name = "ErrorDeviceNotRegistered";
    this.deviceId = deviceId;
  }
}

export class ErrorNotClaimed extends Error {
  readonly code = "HANDOFF_NOT_CLAIMED";
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Cannot hand off session ${sessionId}: not claimed`);
    this.name = "ErrorNotClaimed";
    this.sessionId = sessionId;
  }
}

export class ErrorHandoffInFlight extends Error {
  readonly code = "HANDOFF_IN_FLIGHT";
  readonly sessionId: string;
  readonly existingHandoffId: string;
  constructor(sessionId: string, existingHandoffId: string) {
    super(`Session ${sessionId} already has an in-flight handoff: ${existingHandoffId}`);
    this.name = "ErrorHandoffInFlight";
    this.sessionId = sessionId;
    this.existingHandoffId = existingHandoffId;
  }
}

export class ErrorHandoffExpired extends Error {
  readonly code = "HANDOFF_EXPIRED";
  readonly handoffId: string;
  constructor(handoffId: string) {
    super(`Handoff ${handoffId} has expired`);
    this.name = "ErrorHandoffExpired";
    this.handoffId = handoffId;
  }
}

export class ErrorHandoffNotFound extends Error {
  readonly code = "HANDOFF_NOT_FOUND";
  readonly handoffId: string;
  constructor(handoffId: string) {
    super(`Handoff not found: ${handoffId}`);
    this.name = "ErrorHandoffNotFound";
    this.handoffId = handoffId;
  }
}

// ── State transition matrix ────────────────────────────────

const ALLOWED_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  // close() from any non-terminal state is permitted — the runner may detect a
  // finished task at any point in its lifecycle (including "claimed" before the
  // first step emits). Illegal transitions are still guarded for STEP and
  // APPROVE (which have specific precondition requirements).
  //
  // F14: any non-terminal claim-bearing status can transition to handed_off
  // while a transfer is in flight. handed_off can resolve back to claimed
  // (accept) or back to the pre-handoff status (expire), or to failed (abort).
  pending: ["claimed", "done", "failed"],
  claimed: ["running", "handed_off", "done", "failed"],
  running: ["awaiting_approval", "handed_off", "done", "failed"],
  awaiting_approval: ["running", "handed_off", "done", "failed"],
  handed_off: ["claimed", "running", "awaiting_approval", "done", "failed"],
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
      pendingHandoffId: null,
      handoffs: [],
      handoffResumeStatus: null,
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

  // ── Handoff (F14 — cross-session resume) ──────────────
  //
  // Three phases. `initiateHandoff` is called by the CURRENT claimant; the
  // session transitions to `handed_off` and a HandoffRecord is pushed onto the
  // audit trail. The target device must then call `acceptHandoff` within the
  // configured TTL; accepting updates claimedByDeviceId atomically with the
  // resume event. If no accept arrives, `expireHandoff` rolls back to the
  // prior status. Per QB #6, every failure mode raises a typed error; per
  // QB #7, per-session state lives here — no module globals.

  /**
   * Begin a handoff: the claimant transfers control to `toDeviceId`. The
   * target device registration is validated by the caller via the
   * `isTargetRegistered` predicate (so this store stays decoupled from the
   * device-registry module). TTL is milliseconds from now.
   *
   * Throws:
   *   - ErrorNotClaimed        if session has no claimant (only claimed,
   *                             running, or awaiting_approval may hand off)
   *   - SessionUnauthorizedError
   *                             if deviceId isn't the current claimant
   *   - ErrorHandoffInFlight   if a previous handoff is still pending
   *   - ErrorDeviceNotRegistered
   *                             if `isTargetRegistered(toDeviceId)` is false
   *   - SessionIllegalTransitionError
   *                             if session is terminal
   */
  initiateHandoff(params: {
    readonly sessionId: string;
    readonly fromDeviceId: string;
    readonly toDeviceId: string;
    readonly reason?: string | null;
    readonly ttlMs: number;
    readonly isTargetRegistered: (deviceId: string) => boolean;
  }): { readonly session: Session; readonly handoff: HandoffRecord } {
    const current = this.requireSession(params.sessionId);

    // Must have an active claimant; the claimant must match fromDeviceId.
    if (current.claimedByDeviceId === null) {
      throw new ErrorNotClaimed(params.sessionId);
    }
    // Do not allow handoff initiation on a session already in the handed_off
    // state — exactly one transfer may be pending at a time.
    if (current.status === "handed_off") {
      throw new ErrorHandoffInFlight(params.sessionId, current.pendingHandoffId ?? "unknown");
    }
    if (isTerminal(current.status)) {
      throw new SessionIllegalTransitionError(params.sessionId, current.status, "handed_off");
    }
    if (current.claimedByDeviceId !== params.fromDeviceId) {
      throw new SessionUnauthorizedError(
        params.sessionId,
        params.fromDeviceId,
        `expected claimant ${current.claimedByDeviceId}`,
      );
    }

    // Target must be a registered device — prevents lost handoffs to ghost
    // ids (typo, stale client, malicious spoof). Caller supplies the
    // predicate so the store stays agnostic to the registry implementation.
    if (!params.isTargetRegistered(params.toDeviceId)) {
      throw new ErrorDeviceNotRegistered(params.toDeviceId);
    }

    const now = Date.now();
    const handoffId = `ho-${randomUUID()}`;
    const handoff: HandoffRecord = {
      id: handoffId,
      fromDeviceId: params.fromDeviceId,
      toDeviceId: params.toDeviceId,
      reason: params.reason ?? null,
      requestedAt: now,
      acceptedAt: null,
      expiredAt: null,
      expiresAt: now + params.ttlMs,
      state: "pending",
    };

    const event = this.appendEvent(current, "handoff_initiated", {
      handoffId,
      fromDeviceId: params.fromDeviceId,
      toDeviceId: params.toDeviceId,
      reason: handoff.reason,
      expiresAt: handoff.expiresAt,
    });

    const next = this.transition(current, "handed_off", {
      events: [...current.events, event],
      pendingHandoffId: handoffId,
      handoffs: [...current.handoffs, handoff],
      handoffResumeStatus: current.status,
    });
    this.sessions.set(params.sessionId, next);
    this.emitEvent(event);
    return { session: next, handoff };
  }

  /**
   * Target accepts a pending handoff. Atomically updates claimedByDeviceId,
   * transitions the session out of handed_off back to the pre-handoff status
   * (or `claimed` if the session was previously awaiting first step), and
   * appends an accept event + updates the audit record.
   *
   * Throws:
   *   - ErrorHandoffNotFound    if handoffId doesn't exist on this session
   *   - ErrorHandoffExpired     if accept arrives after expiresAt
   *   - SessionUnauthorizedError
   *                              if deviceId isn't the handoff target
   *   - SessionIllegalTransitionError
   *                              if session isn't in the handed_off state
   */
  acceptHandoff(params: {
    readonly sessionId: string;
    readonly handoffId: string;
    readonly deviceId: string;
    readonly now?: number;
  }): Session {
    const current = this.requireSession(params.sessionId);
    const now = params.now ?? Date.now();

    // Must be in handed_off state (post-initiate, pre-resolution).
    if (current.status !== "handed_off") {
      throw new SessionIllegalTransitionError(params.sessionId, current.status, "claimed");
    }
    if (current.pendingHandoffId !== params.handoffId) {
      throw new ErrorHandoffNotFound(params.handoffId);
    }

    const record = current.handoffs.find((h) => h.id === params.handoffId);
    if (!record) {
      throw new ErrorHandoffNotFound(params.handoffId);
    }

    // Only the named target may accept. Audit-relevant: record the attempt
    // even when the device is wrong would be nice, but that would let any
    // device force ledger growth via brute forcing ids. Reject without log.
    if (record.toDeviceId !== params.deviceId) {
      throw new SessionUnauthorizedError(
        params.sessionId,
        params.deviceId,
        `expected handoff target ${record.toDeviceId}`,
      );
    }

    // TTL — late accept rolls back and records the expiry.
    if (now > record.expiresAt) {
      // Expire atomically with the reject: caller sees the session reverted
      // to pre-handoff status and the audit trail shows the expiry.
      this.expireHandoff({
        sessionId: params.sessionId,
        handoffId: params.handoffId,
        now,
      });
      throw new ErrorHandoffExpired(params.handoffId);
    }

    const resumeStatus = current.handoffResumeStatus ?? "claimed";
    const acceptedRecord: HandoffRecord = {
      ...record,
      state: "accepted",
      acceptedAt: now,
    };
    const nextHandoffs = current.handoffs.map((h) =>
      h.id === params.handoffId ? acceptedRecord : h,
    );

    const event = this.appendEvent(current, "handoff_accepted", {
      handoffId: params.handoffId,
      fromDeviceId: record.fromDeviceId,
      toDeviceId: params.deviceId,
      resumeStatus,
    });

    const next = this.transition(current, resumeStatus, {
      events: [...current.events, event],
      claimedByDeviceId: params.deviceId,
      pendingHandoffId: null,
      handoffs: nextHandoffs,
      handoffResumeStatus: null,
    });
    this.sessions.set(params.sessionId, next);
    this.emitEvent(event);
    return next;
  }

  /**
   * Mark a pending handoff expired and roll the session back to its
   * pre-handoff status (retaining the ORIGINAL claimant). Used both
   * externally (by a TTL timer) and internally (by acceptHandoff when the
   * accept arrives late). Idempotent: calling on a non-pending handoff
   * throws ErrorHandoffNotFound; calling when the session isn't in
   * handed_off throws SessionIllegalTransitionError. Callers that may race
   * with an accept should be prepared for a stale ErrorHandoffNotFound
   * (the accept won the race).
   */
  expireHandoff(params: {
    readonly sessionId: string;
    readonly handoffId: string;
    readonly now?: number;
  }): Session {
    const current = this.requireSession(params.sessionId);
    const now = params.now ?? Date.now();

    if (current.status !== "handed_off") {
      throw new SessionIllegalTransitionError(
        params.sessionId,
        current.status,
        current.handoffResumeStatus ?? "claimed",
      );
    }
    if (current.pendingHandoffId !== params.handoffId) {
      throw new ErrorHandoffNotFound(params.handoffId);
    }

    const record = current.handoffs.find((h) => h.id === params.handoffId);
    if (!record || record.state !== "pending") {
      throw new ErrorHandoffNotFound(params.handoffId);
    }

    const expiredRecord: HandoffRecord = {
      ...record,
      state: "expired",
      expiredAt: now,
    };
    const nextHandoffs = current.handoffs.map((h) =>
      h.id === params.handoffId ? expiredRecord : h,
    );
    const resumeStatus = current.handoffResumeStatus ?? "claimed";

    const event = this.appendEvent(current, "handoff_expired", {
      handoffId: params.handoffId,
      fromDeviceId: record.fromDeviceId,
      toDeviceId: record.toDeviceId,
      resumeStatus,
    });

    const next = this.transition(current, resumeStatus, {
      events: [...current.events, event],
      pendingHandoffId: null,
      handoffs: nextHandoffs,
      handoffResumeStatus: null,
      // claimedByDeviceId unchanged — original claimant keeps control.
    });
    this.sessions.set(params.sessionId, next);
    this.emitEvent(event);
    return next;
  }

  /** Retrieve a specific handoff record (from audit trail). */
  getHandoff(sessionId: string, handoffId: string): HandoffRecord | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.handoffs.find((h) => h.id === handoffId) ?? null;
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
