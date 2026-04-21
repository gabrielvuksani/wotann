/**
 * CanvasToCode export tests (P1-C7 part 3).
 *
 * The exporter is deterministic — same input → same output. We snapshot
 * key structural bits (component name, presence of elements, style tags)
 * rather than asserting the entire emitted file, so that whitespace or
 * comment-header changes don't break tests.
 */
import { describe, it, expect } from "vitest";
import { canvasToCode } from "../../src/design/canvas-to-code.js";
import { apply, createCanvas, type Canvas, type CanvasElement } from "../../src/design/canvas.js";
import type { DesignSystem } from "../../src/design/extractor.js";

function makeEl(id: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    type: "component",
    props: { name: `Component-${id}` },
    position: { x: 10, y: 20, width: 100, height: 40 },
    ...overrides,
  };
}

function seedCanvas(): Canvas {
  let c = createCanvas({ id: "c1", name: "My Dashboard", createdAt: 100 });
  c = apply(c, { kind: "add-element", element: makeEl("a") }, 101);
  c = apply(
    c,
    {
      kind: "add-element",
      element: makeEl("b", {
        type: "text",
        props: { text: "Hello world", color: "#0a84ff" },
      }),
    },
    102,
  );
  c = apply(
    c,
    {
      kind: "connect",
      edge: { id: "e1", from: "a", to: "b", kind: "hand-off", label: "next" },
    },
    103,
  );
  return c;
}

describe("canvasToCode — structure", () => {
  it("emits a named React component with canvasId + version header", () => {
    const canvas = seedCanvas();
    const out = canvasToCode(canvas);
    expect(out.componentName).toBe("MyDashboard");
    expect(out.code).toContain("export function MyDashboard");
    expect(out.code).toContain(`data-canvas-id=${JSON.stringify("c1")}`);
    expect(out.code).toContain("data-canvas-version={4}"); // v1 + 3 ops
    expect(out.elementCount).toBe(2);
    expect(out.edgeCount).toBe(1);
  });

  it("empty canvas emits a valid empty component (no null body)", () => {
    const canvas = createCanvas({ id: "c1", name: "Blank", createdAt: 0 });
    const out = canvasToCode(canvas);
    expect(out.code).toContain("Canvas has no elements yet");
    expect(out.elementCount).toBe(0);
  });

  it("deterministic: same input yields identical output", () => {
    const canvas = seedCanvas();
    expect(canvasToCode(canvas).code).toEqual(canvasToCode(canvas).code);
  });

  it("tsx vs jsx: tsx emits a typed props interface, jsx does not", () => {
    const canvas = seedCanvas();
    const tsx = canvasToCode(canvas, { format: "tsx" });
    const jsx = canvasToCode(canvas, { format: "jsx" });
    expect(tsx.code).toContain("export interface MyDashboardProps");
    expect(jsx.code).not.toContain("export interface");
  });

  it("sanitizes component names with non-alphanumeric characters", () => {
    const canvas = createCanvas({
      id: "c1",
      name: "my-dashboard & co.!",
      createdAt: 0,
    });
    expect(canvasToCode(canvas).componentName).toBe("MyDashboardCo");
  });

  it("propagates unknown props as data-* attrs (round-trip friendly)", () => {
    let canvas = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    canvas = apply(
      canvas,
      {
        kind: "add-element",
        element: makeEl("a", { props: { name: "X", customProp: "foo", flag: true } }),
      },
      1,
    );
    const out = canvasToCode(canvas);
    expect(out.code).toContain(`data-custom-prop=${JSON.stringify("foo")}`);
    expect(out.code).toContain(`data-flag=${JSON.stringify("true")}`);
  });

  it("renders text elements with escaped content inside the tag", () => {
    let canvas = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    canvas = apply(
      canvas,
      {
        kind: "add-element",
        element: makeEl("a", {
          type: "text",
          props: { text: "Hello <script>alert(1)</script>" },
        }),
      },
      1,
    );
    const out = canvasToCode(canvas);
    expect(out.code).toContain("Hello &lt;script&gt;alert(1)&lt;/script&gt;");
    // No raw `<script` in the emitted JSX
    expect(out.code).not.toContain("<script>");
  });

  it("exports outgoing edges as data-canvas-edges on the source element", () => {
    const canvas = seedCanvas();
    const out = canvasToCode(canvas);
    expect(out.code).toMatch(/data-canvas-edges="hand-off:b"/);
  });

  it("warns on unknown element types without dropping them", () => {
    let canvas = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    canvas = apply(
      canvas,
      {
        kind: "add-element",
        element: {
          id: "a",
          // Force-cast an unknown type to exercise the defensive branch
          type: "mystery" as CanvasElement["type"],
          props: {},
          position: { x: 0, y: 0, width: 1, height: 1 },
        },
      },
      1,
    );
    const out = canvasToCode(canvas);
    expect(out.warnings.length).toBe(1);
    expect(out.warnings[0]).toContain("mystery");
    expect(out.code).toContain("/* unknown element type: mystery */");
  });
});

describe("canvasToCode — design-system token resolution", () => {
  const tokens: DesignSystem = {
    palettes: [
      {
        name: "palette-1",
        centroid: "#0a84ff",
        colors: [{ value: "#0a84ff", rgb: [10, 132, 255], frequency: 3 }],
      },
    ],
    spacing: [{ raw: "16px", value: 16, unit: "px", frequency: 1 }],
    typography: {
      fontFamilies: [{ value: '"SF Pro", sans-serif', frequency: 2 }],
      fontSizes: [{ raw: "14px", value: 14, unit: "px", frequency: 1 }],
      fontWeights: [{ value: 500, frequency: 1 }],
    },
    inventory: {},
    filesScanned: 1,
    warnings: [],
  };

  it("resolves known color prop to a style entry", () => {
    let canvas = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    canvas = apply(
      canvas,
      {
        kind: "add-element",
        element: makeEl("a", { props: { name: "A", color: "#0A84FF" } }),
      },
      1,
    );
    const out = canvasToCode(canvas, { tokens });
    // Case-insensitive match against palette.
    expect(out.code).toMatch(/color: "#0a84ff"/);
  });

  it("resolves known fontFamily and fontSize", () => {
    let canvas = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    canvas = apply(
      canvas,
      {
        kind: "add-element",
        element: makeEl("a", {
          props: {
            name: "A",
            fontFamily: '"SF Pro", sans-serif',
            fontSize: "14px",
          },
        }),
      },
      1,
    );
    const out = canvasToCode(canvas, { tokens });
    expect(out.code).toContain('fontFamily: "\\"SF Pro\\", sans-serif"');
    expect(out.code).toContain('fontSize: "14px"');
  });

  it("does not invent entries when prop references unknown token (honesty bar)", () => {
    let canvas = createCanvas({ id: "c1", name: "D", createdAt: 0 });
    canvas = apply(
      canvas,
      {
        kind: "add-element",
        element: makeEl("a", { props: { name: "A", color: "#deadbe" } }),
      },
      1,
    );
    const out = canvasToCode(canvas, { tokens });
    // #deadbe isn't in the palette — no style.color entry emitted.
    expect(out.code).not.toContain("color: \"#deadbe\"");
  });
});
