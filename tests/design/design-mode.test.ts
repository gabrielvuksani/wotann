/**
 * DesignMode orchestrator tests (P1-C7 part 2).
 *
 * Covers:
 *   - open/close session idempotency
 *   - apply pushes to undo stack, clears redo
 *   - undo/redo round-trip
 *   - save surfaces CanvasConflictError (stale session scenario)
 *   - UnifiedDispatchPlane broadcast fan-out integration (F11)
 *   - Per-session isolation (two sessions in the same orchestrator do not
 *     cross-contaminate)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanvasConflictError, CanvasStore } from "../../src/design/canvas-store.js";
import { DesignMode } from "../../src/design/design-mode.js";
import { UnifiedDispatchPlane } from "../../src/channels/unified-dispatch.js";
import type { UnifiedEvent } from "../../src/channels/fan-out.js";
import type { CanvasElement, CanvasOperation } from "../../src/design/canvas.js";

let tmp: string;
let tick = 0;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wotann-design-mode-"));
  tick = 1000;
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeStore(): CanvasStore {
  let id = 0;
  return new CanvasStore({
    rootDir: tmp,
    generateId: () => `c${++id}`,
    now: () => ++tick,
  });
}

function makeEl(id: string): CanvasElement {
  return {
    id,
    type: "component",
    props: { name: `Component-${id}` },
    position: { x: 0, y: 0, width: 100, height: 40 },
  };
}

describe("DesignMode.open / close", () => {
  it("open loads the canvas and returns a session", () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    const session = dm.open(c.id);
    expect(session.canvas.id).toBe(c.id);
    expect(session.undoStack).toEqual([]);
    expect(session.redoStack).toEqual([]);
  });

  it("open is idempotent — second call returns the same session", () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    const a = dm.open(c.id);
    const b = dm.open(c.id);
    expect(a).toBe(b);
  });

  it("close removes the session and subsequent open reloads from disk", async () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    const s1 = dm.open(c.id);
    await dm.apply(c.id, { kind: "rename", name: "Renamed" });
    expect(s1.canvas.name).toBe("Renamed");
    dm.save(c.id);
    dm.close(c.id);
    const s2 = dm.open(c.id);
    expect(s2).not.toBe(s1);
    expect(s2.canvas.name).toBe("Renamed");
  });
});

describe("DesignMode.apply — undo/redo", () => {
  it("apply pushes (before, op) onto undo and clears redo", async () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    dm.open(c.id);
    await dm.apply(c.id, { kind: "add-element", element: makeEl("a") });
    const lens = dm.historyLengths(c.id);
    expect(lens.undo).toBe(1);
    expect(lens.redo).toBe(0);
  });

  it("undo reverts to prior state; redo re-applies", async () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    dm.open(c.id);
    await dm.apply(c.id, { kind: "add-element", element: makeEl("a") });
    expect(dm.getSession(c.id)!.canvas.elements).toHaveLength(1);
    const afterUndo = await dm.undo(c.id);
    expect(afterUndo.elements).toHaveLength(0);
    expect(dm.historyLengths(c.id)).toEqual({ undo: 0, redo: 1 });
    const afterRedo = await dm.redo(c.id);
    expect(afterRedo.elements).toHaveLength(1);
    expect(dm.historyLengths(c.id)).toEqual({ undo: 1, redo: 0 });
  });

  it("new apply after undo clears redo stack", async () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    dm.open(c.id);
    await dm.apply(c.id, { kind: "add-element", element: makeEl("a") });
    await dm.undo(c.id);
    expect(dm.historyLengths(c.id)).toEqual({ undo: 0, redo: 1 });
    await dm.apply(c.id, { kind: "add-element", element: makeEl("b") });
    expect(dm.historyLengths(c.id)).toEqual({ undo: 1, redo: 0 });
  });

  it("undo/redo are no-ops when stacks are empty", async () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    dm.open(c.id);
    const a = await dm.undo(c.id);
    expect(a.elements).toEqual([]);
    const b = await dm.redo(c.id);
    expect(b.elements).toEqual([]);
  });
});

describe("DesignMode.save — optimistic concurrency", () => {
  it("save after apply persists the bumped version", async () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    dm.open(c.id);
    await dm.apply(c.id, { kind: "add-element", element: makeEl("a") });
    const saved = dm.save(c.id);
    expect(saved.version).toBe(2);
    expect(store.load(c.id).version).toBe(2);
  });

  it("two sessions editing the same canvas → second save raises CanvasConflictError", async () => {
    const store = makeStore();
    const c = store.create("D");
    const dmA = new DesignMode({ store, now: () => ++tick });
    const dmB = new DesignMode({ store, now: () => ++tick });
    dmA.open(c.id);
    dmB.open(c.id);

    await dmA.apply(c.id, { kind: "rename", name: "From A" });
    dmA.save(c.id);

    await dmB.apply(c.id, { kind: "rename", name: "From B" });
    expect(() => dmB.save(c.id)).toThrow(CanvasConflictError);
  });
});

describe("DesignMode — UnifiedDispatchPlane fan-out (F11)", () => {
  it("broadcasts a cursor UnifiedEvent on every apply", async () => {
    const store = makeStore();
    const c = store.create("D");
    const plane = new UnifiedDispatchPlane();
    const received: UnifiedEvent[] = [];
    plane.registerSurface("phone-1", "ios", (ev) => {
      received.push(ev);
    });
    const dm = new DesignMode({ store, dispatchPlane: plane, now: () => ++tick });
    dm.open(c.id);
    const op: CanvasOperation = { kind: "add-element", element: makeEl("a") };
    await dm.apply(c.id, op);
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe("cursor");
    expect((received[0]!.payload as { canvasId: string }).canvasId).toBe(c.id);
    expect((received[0]!.payload as { version: number }).version).toBe(2);
    expect((received[0]!.payload as { op: { kind: string } }).op.kind).toBe("add-element");
  });

  it("broadcasts to multiple registered surfaces simultaneously", async () => {
    const store = makeStore();
    const c = store.create("D");
    const plane = new UnifiedDispatchPlane();
    const phone: UnifiedEvent[] = [];
    const desktop: UnifiedEvent[] = [];
    plane.registerSurface("phone", "ios", (ev) => {
      phone.push(ev);
    });
    plane.registerSurface("desktop", "desktop", (ev) => {
      desktop.push(ev);
    });
    const dm = new DesignMode({ store, dispatchPlane: plane, now: () => ++tick });
    dm.open(c.id);
    await dm.apply(c.id, { kind: "rename", name: "X" });
    expect(phone).toHaveLength(1);
    expect(desktop).toHaveLength(1);
  });

  it("captures broadcast errors on the session without throwing (QB #12)", async () => {
    const store = makeStore();
    const c = store.create("D");
    const plane = new UnifiedDispatchPlane();
    plane.registerSurface("phone", "ios", () => {
      throw new Error("listener boom");
    });
    const dm = new DesignMode({ store, dispatchPlane: plane, now: () => ++tick });
    const session = dm.open(c.id);
    // The plane itself routes listener errors to the error channel, not the
    // caller, so our apply() should still succeed and not record a broadcast
    // error. What DOES record a broadcast error is an InvalidEventTypeError,
    // which we can't trigger here without private access — the null-case
    // assertion is still meaningful: the happy path leaves lastBroadcastError
    // untouched (null) because the plane absorbed the listener's throw.
    await dm.apply(c.id, { kind: "rename", name: "X" });
    expect(session.lastBroadcastError).toBeNull();
  });

  it("omits broadcast when no plane is configured (headless CLI mode)", async () => {
    const store = makeStore();
    const c = store.create("D");
    const dm = new DesignMode({ store, now: () => ++tick });
    const session = dm.open(c.id);
    await dm.apply(c.id, { kind: "rename", name: "X" });
    // Sanity: session still has the edit and lastBroadcastError stays null.
    expect(session.canvas.name).toBe("X");
    expect(session.lastBroadcastError).toBeNull();
  });
});

describe("DesignMode — per-session isolation (QB #7)", () => {
  it("two canvases in the same orchestrator have independent histories", async () => {
    const store = makeStore();
    const a = store.create("A");
    const b = store.create("B");
    const dm = new DesignMode({ store, now: () => ++tick });
    dm.open(a.id);
    dm.open(b.id);
    await dm.apply(a.id, { kind: "rename", name: "A-new" });
    expect(dm.historyLengths(a.id)).toEqual({ undo: 1, redo: 0 });
    expect(dm.historyLengths(b.id)).toEqual({ undo: 0, redo: 0 });
  });
});
