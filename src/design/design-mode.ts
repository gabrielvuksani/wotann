/**
 * DesignMode — the orchestrator that lets the agent edit a Canvas.
 *
 * Cursor 3's Design Mode (⌘+Shift+D) turns the agent into a design-surface
 * collaborator. WOTANN's port is CLI/headless first: an `open()` call loads
 * a canvas into a per-session `DesignModeSession`, the agent issues
 * structured operations via `apply()`, and undo/redo walk the op log.
 *
 * Fan-out integration (F11)
 * -------------------------
 * When constructed with a `UnifiedDispatchPlane`, every mutation broadcasts
 * a `UnifiedEvent{type:"cursor"}` payload `{canvasId, version, op}` so any
 * surface (desktop, iOS, watch, TUI) can render the live update. The
 * dispatch plane is optional — headless CLI callers pass no plane and get
 * pure in-memory editing. F11's per-surface FIFO ordering and error
 * isolation flow through transparently because we delegate to
 * `broadcastUnifiedEvent()`.
 *
 * Honesty bars
 * ------------
 * - QB #7 per-session state: every `open()` returns a fresh
 *   `DesignModeSession`. Sessions never share op logs.
 * - QB #12 no silent fallbacks: conflicts surface as explicit
 *   `CanvasConflictError` at save-time.
 * - Honest stubs over silent success: if the dispatch plane broadcast
 *   throws (e.g., InvalidEventTypeError), the apply() result is still
 *   returned so the agent can continue, but the broadcast error is
 *   captured on the session for inspection (`session.lastBroadcastError`).
 *
 * Pairs with `canvas-store.ts` for persistence and `canvas-to-code.ts`
 * for the export path.
 */

import { apply as applyOp, invertOperation, type Canvas, type CanvasOperation } from "./canvas.js";
import type { CanvasStore } from "./canvas-store.js";
import type { UnifiedDispatchPlane } from "../channels/unified-dispatch.js";
import type { UnifiedEvent } from "../channels/fan-out.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface DesignModeConfig {
  readonly store: CanvasStore;
  /** Optional — enables cross-surface fan-out. */
  readonly dispatchPlane?: UnifiedDispatchPlane;
  /** Clock override. Default `Date.now`. */
  readonly now?: () => number;
  /**
   * Max ops retained in a session's undo log. Older entries are dropped.
   * Default 100 — enough for a working day of edits, capped so long-running
   * sessions don't leak memory.
   */
  readonly maxHistory?: number;
}

export interface DesignModeSession {
  readonly canvasId: string;
  /** Current in-memory canvas (latest applied op). */
  canvas: Canvas;
  /**
   * Undo stack: entries are (pre-apply canvas, op) — applying the inverse
   * of `op` to `before` rolls back to that state. LIFO.
   */
  undoStack: Array<{ before: Canvas; op: CanvasOperation }>;
  /** Redo stack: entries are ops to re-apply after an undo. LIFO. */
  redoStack: Array<{ before: Canvas; op: CanvasOperation }>;
  /**
   * Error captured from the most recent fan-out broadcast. Null when the
   * broadcast succeeded or no plane is wired. Exposed for observability —
   * we never throw broadcast errors at the agent (QB #12).
   */
  lastBroadcastError: Error | null;
}

const DEFAULT_MAX_HISTORY = 100;

// ── Orchestrator ─────────────────────────────────────────────────────────

export class DesignMode {
  private readonly store: CanvasStore;
  private readonly dispatchPlane?: UnifiedDispatchPlane;
  private readonly now: () => number;
  private readonly maxHistory: number;
  private readonly sessions = new Map<string, DesignModeSession>();

  constructor(config: DesignModeConfig) {
    this.store = config.store;
    if (config.dispatchPlane !== undefined) {
      this.dispatchPlane = config.dispatchPlane;
    }
    this.now = config.now ?? (() => Date.now());
    this.maxHistory = config.maxHistory ?? DEFAULT_MAX_HISTORY;
  }

  /**
   * Load a canvas into an editing session. If the session already exists
   * (same canvasId), return it. Sessions are per-instance — two DesignMode
   * instances do not share state.
   */
  open(canvasId: string): DesignModeSession {
    const existing = this.sessions.get(canvasId);
    if (existing) return existing;
    const canvas = this.store.load(canvasId);
    const session: DesignModeSession = {
      canvasId,
      canvas,
      undoStack: [],
      redoStack: [],
      lastBroadcastError: null,
    };
    this.sessions.set(canvasId, session);
    return session;
  }

  /** Close a session; subsequent `open()` calls reload from disk. */
  close(canvasId: string): boolean {
    return this.sessions.delete(canvasId);
  }

  /** Return an open session, or undefined. */
  getSession(canvasId: string): DesignModeSession | undefined {
    return this.sessions.get(canvasId);
  }

  /** All currently open sessions. */
  getOpenSessions(): readonly DesignModeSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Apply a structured op to the session's current canvas. Returns the new
   * canvas. Pushes (before, op) onto the undo stack and clears the redo
   * stack (standard editor semantics). Broadcasts a `cursor` UnifiedEvent
   * when a dispatch plane is wired.
   *
   * Does NOT persist — call `save()` explicitly when ready.
   */
  async apply(canvasId: string, op: CanvasOperation): Promise<Canvas> {
    const session = this.sessions.get(canvasId);
    if (!session) {
      throw new Error(`no session open for canvas ${canvasId}`);
    }
    const before = session.canvas;
    const next = applyOp(before, op, this.now());
    session.canvas = next;
    session.undoStack.push({ before, op });
    if (session.undoStack.length > this.maxHistory) {
      session.undoStack.shift();
    }
    session.redoStack.length = 0;
    await this.broadcast(session, "cursor", {
      canvasId,
      version: next.version,
      op: serializeOp(op),
    });
    return next;
  }

  /**
   * Undo the last applied op. No-op and returns the current canvas if the
   * undo stack is empty. The undone entry moves to the redo stack.
   */
  async undo(canvasId: string): Promise<Canvas> {
    const session = this.sessions.get(canvasId);
    if (!session) {
      throw new Error(`no session open for canvas ${canvasId}`);
    }
    const last = session.undoStack.pop();
    if (!last) return session.canvas;
    const inverse = invertOperation(last.before, last.op);
    if (inverse === null) {
      // Cannot invert — put it back on the stack and surface a loud error,
      // better than silently ignoring a failed undo.
      session.undoStack.push(last);
      throw new Error(`cannot invert op kind=${last.op.kind}`);
    }
    const reverted = applyOp(session.canvas, inverse, this.now());
    session.canvas = reverted;
    session.redoStack.push(last);
    await this.broadcast(session, "cursor", {
      canvasId,
      version: reverted.version,
      op: serializeOp(inverse),
      undo: true,
    });
    return reverted;
  }

  /**
   * Redo the most-recently undone op. No-op and returns the current canvas
   * if the redo stack is empty.
   */
  async redo(canvasId: string): Promise<Canvas> {
    const session = this.sessions.get(canvasId);
    if (!session) {
      throw new Error(`no session open for canvas ${canvasId}`);
    }
    const last = session.redoStack.pop();
    if (!last) return session.canvas;
    const re = applyOp(session.canvas, last.op, this.now());
    session.canvas = re;
    session.undoStack.push({ before: session.canvas, op: last.op });
    // Keep stack bounded.
    if (session.undoStack.length > this.maxHistory) {
      session.undoStack.shift();
    }
    await this.broadcast(session, "cursor", {
      canvasId,
      version: re.version,
      op: serializeOp(last.op),
      redo: true,
    });
    return re;
  }

  /**
   * Persist the session's current canvas via the store. The store performs
   * optimistic-concurrency — if another session already saved a newer
   * version, this throws `CanvasConflictError`. We do not catch; the
   * caller decides whether to reload + merge.
   */
  save(canvasId: string): Canvas {
    const session = this.sessions.get(canvasId);
    if (!session) {
      throw new Error(`no session open for canvas ${canvasId}`);
    }
    const saved = this.store.save(session.canvas);
    session.canvas = saved;
    return saved;
  }

  /**
   * Full history length (undo + redo). Exposed for inspection/tests.
   */
  historyLengths(canvasId: string): { readonly undo: number; readonly redo: number } {
    const session = this.sessions.get(canvasId);
    if (!session) return { undo: 0, redo: 0 };
    return { undo: session.undoStack.length, redo: session.redoStack.length };
  }

  // ── Private ────────────────────────────────────────────────────────────

  private async broadcast(
    session: DesignModeSession,
    type: "cursor",
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (!this.dispatchPlane) return;
    const event: UnifiedEvent = {
      type,
      timestamp: this.now(),
      payload,
    };
    try {
      await this.dispatchPlane.broadcastUnifiedEvent(event);
      session.lastBroadcastError = null;
    } catch (err) {
      session.lastBroadcastError = err instanceof Error ? err : new Error(String(err));
      // Do not rethrow — the agent's edit succeeded; the bus error is a
      // separate concern captured on the session for observability.
    }
  }
}

// ── Serialization helper for broadcast payloads ─────────────────────────

function serializeOp(op: CanvasOperation): Readonly<Record<string, unknown>> {
  // Return a shallow-cloned plain object — downstream surfaces may JSON
  // serialize the payload, and we want to avoid exposing readonly-proxy
  // arrays in the wire format.
  switch (op.kind) {
    case "add-element":
      return { kind: op.kind, element: { ...op.element } };
    case "remove-element":
      return { kind: op.kind, elementId: op.elementId };
    case "update-props":
      return { kind: op.kind, elementId: op.elementId, props: { ...op.props } };
    case "move-element":
      return { kind: op.kind, elementId: op.elementId, position: { ...op.position } };
    case "connect":
      return { kind: op.kind, edge: { ...op.edge } };
    case "disconnect":
      return { kind: op.kind, edgeId: op.edgeId };
    case "rename":
      return { kind: op.kind, name: op.name };
    case "set-tokens":
      return { kind: op.kind, tokens: op.tokens === null ? null : { ...op.tokens } };
  }
}
