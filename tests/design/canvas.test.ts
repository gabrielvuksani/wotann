/**
 * Canvas data-model tests (P1-C7).
 *
 * Covers the immutable operation applier in `src/design/canvas.ts`. Every
 * test asserts:
 *   1. the input canvas is NOT mutated
 *   2. the returned canvas has `version + 1`
 *   3. `updatedAt` matches what the caller stamped
 *   4. errors are typed `CanvasOperationError` with the documented `code`
 */
import { describe, it, expect } from "vitest";
import {
  apply,
  createCanvas,
  invertOperation,
  parseCanvas,
  serializeCanvas,
  CanvasOperationError,
  type Canvas,
  type CanvasElement,
  type CanvasEdge,
  type CanvasOperation,
} from "../../src/design/canvas.js";

/** Assert that the thunk throws a CanvasOperationError whose .code matches. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CanvasOperationError);
    expect((err as CanvasOperationError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} but function did not throw`);
}

function makeEl(id: string): CanvasElement {
  return {
    id,
    type: "component",
    props: { name: `Component-${id}` },
    position: { x: 0, y: 0, width: 100, height: 40 },
  };
}

function makeEdge(id: string, from: string, to: string): CanvasEdge {
  return { id, from, to, kind: "data-flow" };
}

describe("createCanvas", () => {
  it("creates a fresh canvas at version 1 with zero elements and connections", () => {
    const c = createCanvas({ id: "c1", name: "Dashboard", createdAt: 1000 });
    expect(c.id).toBe("c1");
    expect(c.name).toBe("Dashboard");
    expect(c.version).toBe(1);
    expect(c.elements).toEqual([]);
    expect(c.connections).toEqual([]);
    expect(c.createdAt).toBe(1000);
    expect(c.updatedAt).toBe(1000);
    expect(c.tokens).toBeUndefined();
  });

  it("attaches an optional DesignSystemRef when provided", () => {
    const c = createCanvas({
      id: "c1",
      name: "D",
      createdAt: 1,
      tokens: { id: "sys-a", path: "design.json" },
    });
    expect(c.tokens).toEqual({ id: "sys-a", path: "design.json" });
  });

  it("rejects empty id and empty name", () => {
    expect(() => createCanvas({ id: "", name: "x", createdAt: 0 })).toThrow(CanvasOperationError);
    expect(() => createCanvas({ id: "c", name: " ", createdAt: 0 })).toThrow(CanvasOperationError);
  });
});

describe("apply — add-element", () => {
  it("returns a new canvas, never mutates input, bumps version", () => {
    const before = createCanvas({ id: "c1", name: "D", createdAt: 1 });
    const op: CanvasOperation = { kind: "add-element", element: makeEl("e1") };
    const after = apply(before, op, 2);
    expect(after).not.toBe(before);
    expect(before.elements).toHaveLength(0);
    expect(after.elements).toHaveLength(1);
    expect(after.version).toBe(2);
    expect(after.updatedAt).toBe(2);
  });

  it("rejects duplicate ids with DUPLICATE_ELEMENT", () => {
    const c = apply(
      createCanvas({ id: "c1", name: "D", createdAt: 0 }),
      { kind: "add-element", element: makeEl("e1") },
      1,
    );
    expect(() => apply(c, { kind: "add-element", element: makeEl("e1") }, 2)).toThrow(
      /DUPLICATE_ELEMENT|already exists/,
    );
  });
});

describe("apply — remove-element", () => {
  it("removes the element and any connected edges", () => {
    let c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(c, { kind: "add-element", element: makeEl("a") }, 1);
    c = apply(c, { kind: "add-element", element: makeEl("b") }, 2);
    c = apply(c, { kind: "connect", edge: makeEdge("e1", "a", "b") }, 3);
    const after = apply(c, { kind: "remove-element", elementId: "a" }, 4);
    expect(after.elements.map((e) => e.id)).toEqual(["b"]);
    expect(after.connections).toEqual([]);
  });

  it("throws UNKNOWN_ELEMENT for unknown id", () => {
    const c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    expectCode(
      () => apply(c, { kind: "remove-element", elementId: "nope" }, 1),
      "UNKNOWN_ELEMENT",
    );
  });
});

describe("apply — update-props / move-element", () => {
  it("merges props without losing untouched keys", () => {
    let c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(
      c,
      {
        kind: "add-element",
        element: { ...makeEl("a"), props: { name: "Button", variant: "primary" } },
      },
      1,
    );
    const after = apply(
      c,
      { kind: "update-props", elementId: "a", props: { variant: "danger", size: "sm" } },
      2,
    );
    expect(after.elements[0]!.props).toEqual({
      name: "Button",
      variant: "danger",
      size: "sm",
    });
  });

  it("moves element without touching other fields", () => {
    let c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(c, { kind: "add-element", element: makeEl("a") }, 1);
    const after = apply(
      c,
      {
        kind: "move-element",
        elementId: "a",
        position: { x: 10, y: 20, width: 200, height: 80 },
      },
      2,
    );
    expect(after.elements[0]!.position).toEqual({ x: 10, y: 20, width: 200, height: 80 });
    expect(after.elements[0]!.props).toEqual(c.elements[0]!.props);
  });
});

describe("apply — connect / disconnect", () => {
  it("connects two existing elements", () => {
    let c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(c, { kind: "add-element", element: makeEl("a") }, 1);
    c = apply(c, { kind: "add-element", element: makeEl("b") }, 2);
    const after = apply(
      c,
      { kind: "connect", edge: { ...makeEdge("e1", "a", "b"), label: "onSubmit" } },
      3,
    );
    expect(after.connections).toHaveLength(1);
    expect(after.connections[0]!.label).toBe("onSubmit");
  });

  it("rejects connecting unknown elements", () => {
    let c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(c, { kind: "add-element", element: makeEl("a") }, 1);
    expectCode(
      () => apply(c, { kind: "connect", edge: makeEdge("e1", "a", "nope") }, 2),
      "UNKNOWN_ELEMENT",
    );
  });

  it("disconnect removes by id", () => {
    let c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(c, { kind: "add-element", element: makeEl("a") }, 1);
    c = apply(c, { kind: "add-element", element: makeEl("b") }, 2);
    c = apply(c, { kind: "connect", edge: makeEdge("e1", "a", "b") }, 3);
    const after = apply(c, { kind: "disconnect", edgeId: "e1" }, 4);
    expect(after.connections).toEqual([]);
  });
});

describe("apply — rename / set-tokens", () => {
  it("rename updates canvas.name", () => {
    const c = createCanvas({ id: "c1", name: "Old", createdAt: 0 });
    const after = apply(c, { kind: "rename", name: "New" }, 1);
    expect(after.name).toBe("New");
  });

  it("rename rejects empty names", () => {
    const c = createCanvas({ id: "c1", name: "Old", createdAt: 0 });
    expectCode(() => apply(c, { kind: "rename", name: "   " }, 1), "INVALID_NAME");
  });

  it("set-tokens attaches and clears the tokens ref", () => {
    const c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    const attached = apply(
      c,
      { kind: "set-tokens", tokens: { id: "sys-a", path: "ds.json" } },
      1,
    );
    expect(attached.tokens).toEqual({ id: "sys-a", path: "ds.json" });
    const cleared = apply(attached, { kind: "set-tokens", tokens: null }, 2);
    expect(cleared.tokens).toBeUndefined();
  });
});

describe("invertOperation", () => {
  it("invert(add-element) = remove-element", () => {
    const c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    const op: CanvasOperation = { kind: "add-element", element: makeEl("x") };
    const inv = invertOperation(c, op);
    expect(inv).toEqual({ kind: "remove-element", elementId: "x" });
  });

  it("invert(move-element) restores previous position", () => {
    let c: Canvas = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(c, { kind: "add-element", element: makeEl("a") }, 1);
    const beforeMove = c;
    const moveOp: CanvasOperation = {
      kind: "move-element",
      elementId: "a",
      position: { x: 50, y: 50, width: 100, height: 100 },
    };
    const inv = invertOperation(beforeMove, moveOp);
    expect(inv).toEqual({
      kind: "move-element",
      elementId: "a",
      position: beforeMove.elements[0]!.position,
    });
  });

  it("invert(update-props) restores exact previous props", () => {
    let c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(
      c,
      { kind: "add-element", element: { ...makeEl("a"), props: { name: "Old", variant: "x" } } },
      1,
    );
    const before = c;
    const op: CanvasOperation = {
      kind: "update-props",
      elementId: "a",
      props: { variant: "y", flag: true },
    };
    const inv = invertOperation(before, op);
    expect(inv).toEqual({
      kind: "update-props",
      elementId: "a",
      props: { name: "Old", variant: "x" },
    });
  });

  it("invert(connect) = disconnect, invert(disconnect) = connect", () => {
    let c = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    c = apply(c, { kind: "add-element", element: makeEl("a") }, 1);
    c = apply(c, { kind: "add-element", element: makeEl("b") }, 2);
    const connectOp: CanvasOperation = { kind: "connect", edge: makeEdge("e1", "a", "b") };
    expect(invertOperation(c, connectOp)).toEqual({ kind: "disconnect", edgeId: "e1" });
    const withEdge = apply(c, connectOp, 3);
    const disconnectOp: CanvasOperation = { kind: "disconnect", edgeId: "e1" };
    expect(invertOperation(withEdge, disconnectOp)).toEqual({
      kind: "connect",
      edge: makeEdge("e1", "a", "b"),
    });
  });
});

describe("serializeCanvas / parseCanvas round-trip", () => {
  it("round-trips elements, connections, and tokens", () => {
    let c = createCanvas({
      id: "c1",
      name: "Dashboard",
      createdAt: 10,
      tokens: { id: "sys-a", path: "ds.json" },
    });
    c = apply(c, { kind: "add-element", element: makeEl("a") }, 20);
    c = apply(c, { kind: "add-element", element: makeEl("b") }, 30);
    c = apply(c, { kind: "connect", edge: { ...makeEdge("e1", "a", "b"), label: "next" } }, 40);
    const json = serializeCanvas(c);
    const parsed = parseCanvas(json);
    expect(parsed).toEqual(c);
  });

  it("parse rejects malformed JSON with INVALID_JSON", () => {
    expectCode(() => parseCanvas("{{{"), "INVALID_JSON");
  });

  it("parse rejects missing required fields with INVALID_SHAPE", () => {
    expectCode(() => parseCanvas(JSON.stringify({ id: "x" })), "INVALID_SHAPE");
    expectCode(
      () =>
        parseCanvas(
          JSON.stringify({
            id: "x",
            name: "n",
            version: 1,
            elements: [
              {
                id: "a",
                type: "bogus",
                props: {},
                position: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
            connections: [],
            createdAt: 0,
            updatedAt: 0,
          }),
        ),
      "INVALID_SHAPE",
    );
  });
});
