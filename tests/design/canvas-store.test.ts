/**
 * CanvasStore tests (P1-C7 persistence).
 *
 * We use a temp directory per test so concurrent vitest workers cannot
 * collide. The store is constructed with deterministic id/clock hooks so
 * assertions don't depend on wall clock behaviour.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CanvasConflictError,
  CanvasNotFoundError,
  CanvasStore,
} from "../../src/design/canvas-store.js";
import { apply } from "../../src/design/canvas.js";

let tmp: string;
let idCounter = 0;
let nowTick = 1000;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wotann-canvas-store-"));
  idCounter = 0;
  nowTick = 1000;
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeStore(): CanvasStore {
  return new CanvasStore({
    rootDir: tmp,
    generateId: () => `c${++idCounter}`,
    now: () => ++nowTick,
  });
}

describe("CanvasStore.create", () => {
  it("persists a new v1 canvas and returns it", () => {
    const store = makeStore();
    const c = store.create("Dashboard");
    expect(c.id).toBe("c1");
    expect(c.version).toBe(1);
    expect(store.exists("c1")).toBe(true);
  });

  it("attaches DesignSystemRef when provided", () => {
    const store = makeStore();
    const c = store.create("D", { id: "sys-a", path: "ds.json" });
    expect(c.tokens).toEqual({ id: "sys-a", path: "ds.json" });
    const reloaded = store.load("c1");
    expect(reloaded.tokens).toEqual({ id: "sys-a", path: "ds.json" });
  });
});

describe("CanvasStore.load", () => {
  it("reloads a canvas from disk with identical content", () => {
    const store = makeStore();
    const created = store.create("D");
    const loaded = store.load(created.id);
    expect(loaded).toEqual(created);
  });

  it("throws CanvasNotFoundError for missing ids", () => {
    const store = makeStore();
    expect(() => store.load("nope")).toThrow(CanvasNotFoundError);
  });
});

describe("CanvasStore.save — optimistic concurrency", () => {
  it("accepts a bumped version when persisted matches version - 1", () => {
    const store = makeStore();
    const created = store.create("D");
    const bumped = apply(
      created,
      {
        kind: "add-element",
        element: {
          id: "e1",
          type: "component",
          props: {},
          position: { x: 0, y: 0, width: 10, height: 10 },
        },
      },
      999,
    );
    const saved = store.save(bumped);
    expect(saved.version).toBe(2);
    expect(store.load(created.id).version).toBe(2);
  });

  it("rejects saves when persisted version has already moved on", () => {
    const store = makeStore();
    const created = store.create("D");
    // Session A bumps and saves
    const afterA = store.save(
      apply(
        created,
        {
          kind: "add-element",
          element: {
            id: "a",
            type: "component",
            props: {},
            position: { x: 0, y: 0, width: 1, height: 1 },
          },
        },
        100,
      ),
    );
    expect(afterA.version).toBe(2);
    // Session B holds the old v1 copy and bumps it naively to v2 — conflict.
    const stale = apply(
      created,
      {
        kind: "add-element",
        element: {
          id: "b",
          type: "component",
          props: {},
          position: { x: 0, y: 0, width: 1, height: 1 },
        },
      },
      200,
    );
    try {
      store.save(stale);
      throw new Error("expected conflict");
    } catch (err) {
      expect(err).toBeInstanceOf(CanvasConflictError);
      const e = err as CanvasConflictError;
      expect(e.persistedVersion).toBe(2);
      expect(e.providedVersion).toBe(2);
      expect(e.canvasId).toBe(created.id);
    }
  });

  it("rejects first-save when version is not 1", () => {
    const store = makeStore();
    // Fabricate a canvas that claims v3 but has never been persisted.
    const rogue = apply(
      apply(
        apply(
          {
            id: "rogue",
            name: "R",
            version: 1,
            elements: [],
            connections: [],
            createdAt: 0,
            updatedAt: 0,
          },
          { kind: "rename", name: "A" },
          1,
        ),
        { kind: "rename", name: "B" },
        2,
      ),
      { kind: "rename", name: "C" },
      3,
    );
    expect(() => store.save(rogue)).toThrow(CanvasConflictError);
  });
});

describe("CanvasStore.list / delete", () => {
  it("lists persisted canvases sorted by updatedAt desc", () => {
    const store = makeStore();
    const first = store.create("A"); // now=1001
    const second = store.create("B"); // now=1002
    const entries = store.list();
    expect(entries.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(entries[0]!.name).toBe("B");
    expect(existsSync(entries[0]!.path)).toBe(true);
  });

  it("list skips malformed json files without failing", () => {
    const store = makeStore();
    store.create("A");
    // Drop a bogus file and ensure the store still returns the healthy one.
    const bogus = join(tmp, "broken.json");
    writeFileSync(bogus, "NOT-JSON", "utf8");
    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("A");
  });

  it("delete returns true when the file existed, false otherwise", () => {
    const store = makeStore();
    store.create("A");
    expect(store.delete("c1")).toBe(true);
    expect(store.delete("c1")).toBe(false);
    expect(store.exists("c1")).toBe(false);
  });

  it("returns empty list when directory doesn't exist", () => {
    const store = new CanvasStore({
      rootDir: join(tmp, "never-created"),
      generateId: () => "c1",
      now: () => 1000,
    });
    expect(store.list()).toEqual([]);
  });
});
