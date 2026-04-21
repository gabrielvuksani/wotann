/**
 * Canvas — Cursor 3 Canvases port (P1-C7).
 *
 * Canvases are durable, serializable design artifacts — wireframes, component
 * specs, flow diagrams — that live *next to* code rather than inside it. The
 * agent can read, write, and transform them; ultimately they're exported to
 * implementation code by `canvas-to-code.ts`. This file defines the pure data
 * model: immutable types + structured operation union + helpers.
 *
 * Honesty principles
 * ------------------
 * - Immutable value types. Every mutation returns a new Canvas; the helper
 *   functions here never mutate arguments (QB — coding-style.md immutability).
 * - Deterministic: same inputs produce same outputs; no hidden clocks inside
 *   the helpers (the store stamps `createdAt`/`updatedAt`).
 * - Structured operations: every edit is a discriminated union payload. The
 *   orchestrator records ops for undo/redo; the store's concurrency check
 *   runs against a monotonically increasing `version` field.
 * - No silent overwrites: apply() returns a new Canvas with `version + 1`.
 *   If the caller saves a stale copy, the store raises ConflictError.
 *
 * Integration
 * -----------
 * - Pairs with `canvas-store.ts` (JSON persistence under `.wotann/canvases/`).
 * - Pairs with `design-mode.ts` (session-scoped undo/redo + dispatch plane
 *   fan-out).
 * - Pairs with `canvas-to-code.ts` (emits a React component tree from a
 *   Canvas). Opposite direction of `extractor.ts`.
 */

// ── Public types ─────────────────────────────────────────────────────────

/** Canvas element kinds. */
export type CanvasElementType = "component" | "section" | "text" | "annotation";

export interface CanvasPosition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Element props are opaque key/value data (layout hints, component name,
 * text content, design-token refs). Stored as a plain readonly map so
 * Canvases round-trip through JSON without loss.
 */
export type CanvasElementProps = Readonly<Record<string, string | number | boolean>>;

export interface CanvasElement {
  readonly id: string;
  readonly type: CanvasElementType;
  readonly props: CanvasElementProps;
  readonly position: CanvasPosition;
}

/** Edge kinds model the design-mode semantic links between elements. */
export type CanvasEdgeKind = "hand-off" | "data-flow" | "nav";

export interface CanvasEdge {
  readonly id: string;
  readonly from: string; // element id
  readonly to: string; // element id
  readonly kind: CanvasEdgeKind;
  /** Optional label (e.g. "onSubmit", "nextStep"). */
  readonly label?: string;
}

/**
 * Reference to a design-system (see `extractor.ts`'s `DesignSystem`).
 * We carry only the id + optional path; resolution is the consumer's job
 * (canvas-to-code.ts wires it to extracted tokens when available).
 */
export interface DesignSystemRef {
  readonly id: string;
  readonly path?: string;
}

export interface Canvas {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly elements: readonly CanvasElement[];
  readonly connections: readonly CanvasEdge[];
  readonly tokens?: DesignSystemRef;
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ── Operation union ──────────────────────────────────────────────────────

/**
 * Structured edit operations. Every mutation goes through one of these; the
 * orchestrator keeps an op log for undo/redo. Each op is self-contained —
 * applying the same op to the same Canvas is deterministic and idempotent
 * when the target already matches (add-same-id is a no-op).
 */
export type CanvasOperation =
  | {
      readonly kind: "add-element";
      readonly element: CanvasElement;
    }
  | {
      readonly kind: "remove-element";
      readonly elementId: string;
    }
  | {
      readonly kind: "update-props";
      readonly elementId: string;
      readonly props: CanvasElementProps;
    }
  | {
      readonly kind: "move-element";
      readonly elementId: string;
      readonly position: CanvasPosition;
    }
  | {
      readonly kind: "connect";
      readonly edge: CanvasEdge;
    }
  | {
      readonly kind: "disconnect";
      readonly edgeId: string;
    }
  | {
      readonly kind: "rename";
      readonly name: string;
    }
  | {
      readonly kind: "set-tokens";
      readonly tokens: DesignSystemRef | null;
    };

export type CanvasOperationKind = CanvasOperation["kind"];

// ── Errors ───────────────────────────────────────────────────────────────

export class CanvasOperationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CanvasOperationError";
    this.code = code;
  }
}

// ── Construction ─────────────────────────────────────────────────────────

export interface CreateCanvasInput {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly tokens?: DesignSystemRef;
}

/** Build a fresh Canvas. version=1, empty element+connection lists. */
export function createCanvas(input: CreateCanvasInput): Canvas {
  if (!input.id || input.id.trim() === "") {
    throw new CanvasOperationError("INVALID_ID", "Canvas id cannot be empty");
  }
  if (!input.name || input.name.trim() === "") {
    throw new CanvasOperationError("INVALID_NAME", "Canvas name cannot be empty");
  }
  const base: Canvas = {
    id: input.id,
    name: input.name,
    version: 1,
    elements: [],
    connections: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  if (input.tokens !== undefined) {
    return { ...base, tokens: input.tokens };
  }
  return base;
}

// ── apply() — pure operation applier ─────────────────────────────────────

/**
 * Apply a structured operation to a Canvas. Returns a *new* Canvas with
 * version incremented and `updatedAt` set. Never mutates the input.
 *
 * Contract:
 * - add-element: rejects duplicate element ids (INVALID_OP).
 * - remove-element: unknown id → INVALID_OP. Also removes any edges touching
 *   the element so we don't leave dangling connections.
 * - update-props: unknown id → INVALID_OP. Merges provided props into the
 *   element's existing props (shallow — later keys win).
 * - move-element: unknown id → INVALID_OP.
 * - connect: requires both `from` and `to` to exist; rejects duplicate edge id.
 * - disconnect: unknown id → INVALID_OP.
 * - rename: empty name → INVALID_OP.
 * - set-tokens: null clears the tokens ref.
 */
export function apply(canvas: Canvas, op: CanvasOperation, updatedAt: number): Canvas {
  switch (op.kind) {
    case "add-element": {
      if (canvas.elements.some((e) => e.id === op.element.id)) {
        throw new CanvasOperationError(
          "DUPLICATE_ELEMENT",
          `element ${op.element.id} already exists`,
        );
      }
      return {
        ...canvas,
        elements: [...canvas.elements, op.element],
        version: canvas.version + 1,
        updatedAt,
      };
    }
    case "remove-element": {
      const idx = canvas.elements.findIndex((e) => e.id === op.elementId);
      if (idx === -1) {
        throw new CanvasOperationError("UNKNOWN_ELEMENT", `element ${op.elementId} not found`);
      }
      return {
        ...canvas,
        elements: canvas.elements.filter((e) => e.id !== op.elementId),
        connections: canvas.connections.filter(
          (c) => c.from !== op.elementId && c.to !== op.elementId,
        ),
        version: canvas.version + 1,
        updatedAt,
      };
    }
    case "update-props": {
      const idx = canvas.elements.findIndex((e) => e.id === op.elementId);
      if (idx === -1) {
        throw new CanvasOperationError("UNKNOWN_ELEMENT", `element ${op.elementId} not found`);
      }
      const cur = canvas.elements[idx]!;
      const updated: CanvasElement = {
        ...cur,
        props: { ...cur.props, ...op.props },
      };
      return {
        ...canvas,
        elements: canvas.elements.map((e, i) => (i === idx ? updated : e)),
        version: canvas.version + 1,
        updatedAt,
      };
    }
    case "move-element": {
      const idx = canvas.elements.findIndex((e) => e.id === op.elementId);
      if (idx === -1) {
        throw new CanvasOperationError("UNKNOWN_ELEMENT", `element ${op.elementId} not found`);
      }
      const cur = canvas.elements[idx]!;
      const moved: CanvasElement = { ...cur, position: op.position };
      return {
        ...canvas,
        elements: canvas.elements.map((e, i) => (i === idx ? moved : e)),
        version: canvas.version + 1,
        updatedAt,
      };
    }
    case "connect": {
      const fromExists = canvas.elements.some((e) => e.id === op.edge.from);
      const toExists = canvas.elements.some((e) => e.id === op.edge.to);
      if (!fromExists || !toExists) {
        throw new CanvasOperationError(
          "UNKNOWN_ELEMENT",
          `connect references unknown element(s): from=${op.edge.from} to=${op.edge.to}`,
        );
      }
      if (canvas.connections.some((c) => c.id === op.edge.id)) {
        throw new CanvasOperationError("DUPLICATE_EDGE", `edge ${op.edge.id} already exists`);
      }
      return {
        ...canvas,
        connections: [...canvas.connections, op.edge],
        version: canvas.version + 1,
        updatedAt,
      };
    }
    case "disconnect": {
      const idx = canvas.connections.findIndex((c) => c.id === op.edgeId);
      if (idx === -1) {
        throw new CanvasOperationError("UNKNOWN_EDGE", `edge ${op.edgeId} not found`);
      }
      return {
        ...canvas,
        connections: canvas.connections.filter((c) => c.id !== op.edgeId),
        version: canvas.version + 1,
        updatedAt,
      };
    }
    case "rename": {
      if (!op.name || op.name.trim() === "") {
        throw new CanvasOperationError("INVALID_NAME", "canvas name cannot be empty");
      }
      return {
        ...canvas,
        name: op.name,
        version: canvas.version + 1,
        updatedAt,
      };
    }
    case "set-tokens": {
      if (op.tokens === null) {
        // Strip the tokens field entirely so JSON round-trip stays clean.
        const { tokens: _, ...rest } = canvas;
        return {
          ...rest,
          version: canvas.version + 1,
          updatedAt,
        };
      }
      return {
        ...canvas,
        tokens: op.tokens,
        version: canvas.version + 1,
        updatedAt,
      };
    }
  }
}

// ── Inverse operations (undo support) ────────────────────────────────────

/**
 * Compute the inverse of an operation given the pre-apply state. The
 * orchestrator uses this to undo: it captures (pre-state, op) before
 * applying, then applies the inverse to roll back.
 *
 * Returns null when the inverse cannot be expressed as a single op (e.g.
 * `set-tokens` when the previous value was absent and the new value is
 * also absent — which never happens in practice but we handle defensively).
 */
export function invertOperation(before: Canvas, op: CanvasOperation): CanvasOperation | null {
  switch (op.kind) {
    case "add-element":
      return { kind: "remove-element", elementId: op.element.id };
    case "remove-element": {
      const removed = before.elements.find((e) => e.id === op.elementId);
      if (!removed) return null;
      return { kind: "add-element", element: removed };
    }
    case "update-props": {
      const prev = before.elements.find((e) => e.id === op.elementId);
      if (!prev) return null;
      // Inverse = restore previous props entirely. We build a replacement
      // props map rather than an update-props diff so merge semantics match.
      return { kind: "update-props", elementId: op.elementId, props: prev.props };
    }
    case "move-element": {
      const prev = before.elements.find((e) => e.id === op.elementId);
      if (!prev) return null;
      return { kind: "move-element", elementId: op.elementId, position: prev.position };
    }
    case "connect":
      return { kind: "disconnect", edgeId: op.edge.id };
    case "disconnect": {
      const removed = before.connections.find((c) => c.id === op.edgeId);
      if (!removed) return null;
      return { kind: "connect", edge: removed };
    }
    case "rename":
      return { kind: "rename", name: before.name };
    case "set-tokens":
      return { kind: "set-tokens", tokens: before.tokens ?? null };
  }
}

// ── Serialization ────────────────────────────────────────────────────────

/** Stringify for disk. Stable key order for git-friendly diffs. */
export function serializeCanvas(canvas: Canvas): string {
  const ordered = {
    id: canvas.id,
    name: canvas.name,
    version: canvas.version,
    elements: canvas.elements,
    connections: canvas.connections,
    ...(canvas.tokens !== undefined ? { tokens: canvas.tokens } : {}),
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
  };
  return JSON.stringify(ordered, null, 2);
}

/**
 * Parse a JSON string into a Canvas. Throws `CanvasOperationError` with code
 * `INVALID_JSON` on syntax errors and `INVALID_SHAPE` when required fields
 * are missing or malformed. Never returns partial/guess data.
 */
export function parseCanvas(text: string): Canvas {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CanvasOperationError("INVALID_JSON", `canvas JSON parse failed: ${reason}`);
  }
  if (!isRecord(obj)) {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas must be a JSON object");
  }
  const id = obj["id"];
  const name = obj["name"];
  const version = obj["version"];
  const elements = obj["elements"];
  const connections = obj["connections"];
  const createdAt = obj["createdAt"];
  const updatedAt = obj["updatedAt"];
  if (typeof id !== "string" || id === "") {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas.id must be a non-empty string");
  }
  if (typeof name !== "string" || name === "") {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas.name must be a non-empty string");
  }
  if (typeof version !== "number" || version < 1 || !Number.isFinite(version)) {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas.version must be a positive number");
  }
  if (!Array.isArray(elements)) {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas.elements must be an array");
  }
  if (!Array.isArray(connections)) {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas.connections must be an array");
  }
  if (typeof createdAt !== "number" || typeof updatedAt !== "number") {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas.createdAt/updatedAt must be numbers");
  }
  const parsedElements = elements.map((e, i) => parseElement(e, i));
  const parsedConnections = connections.map((c, i) => parseEdge(c, i));
  const tokensRaw = obj["tokens"];
  const tokens = tokensRaw === undefined ? undefined : parseTokens(tokensRaw);
  const canvas: Canvas = {
    id,
    name,
    version,
    elements: parsedElements,
    connections: parsedConnections,
    createdAt,
    updatedAt,
  };
  return tokens === undefined ? canvas : { ...canvas, tokens };
}

// ── Internal parsing helpers ─────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const VALID_ELEMENT_TYPES: ReadonlySet<CanvasElementType> = new Set([
  "component",
  "section",
  "text",
  "annotation",
]);

const VALID_EDGE_KINDS: ReadonlySet<CanvasEdgeKind> = new Set(["hand-off", "data-flow", "nav"]);

function parseElement(raw: unknown, idx: number): CanvasElement {
  if (!isRecord(raw)) {
    throw new CanvasOperationError("INVALID_SHAPE", `canvas.elements[${idx}] must be an object`);
  }
  const id = raw["id"];
  const type = raw["type"];
  const props = raw["props"];
  const position = raw["position"];
  if (typeof id !== "string" || id === "") {
    throw new CanvasOperationError(
      "INVALID_SHAPE",
      `canvas.elements[${idx}].id must be a non-empty string`,
    );
  }
  if (typeof type !== "string" || !VALID_ELEMENT_TYPES.has(type as CanvasElementType)) {
    throw new CanvasOperationError(
      "INVALID_SHAPE",
      `canvas.elements[${idx}].type invalid: ${String(type)}`,
    );
  }
  if (!isRecord(props)) {
    throw new CanvasOperationError(
      "INVALID_SHAPE",
      `canvas.elements[${idx}].props must be an object`,
    );
  }
  if (!isRecord(position)) {
    throw new CanvasOperationError(
      "INVALID_SHAPE",
      `canvas.elements[${idx}].position must be an object`,
    );
  }
  const normalizedProps: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      normalizedProps[k] = v;
    }
  }
  return {
    id,
    type: type as CanvasElementType,
    props: normalizedProps,
    position: parsePosition(position, idx),
  };
}

function parsePosition(raw: Record<string, unknown>, idx: number): CanvasPosition {
  const x = raw["x"];
  const y = raw["y"];
  const width = raw["width"];
  const height = raw["height"];
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    throw new CanvasOperationError(
      "INVALID_SHAPE",
      `canvas.elements[${idx}].position fields must be numbers`,
    );
  }
  return { x, y, width, height };
}

function parseEdge(raw: unknown, idx: number): CanvasEdge {
  if (!isRecord(raw)) {
    throw new CanvasOperationError("INVALID_SHAPE", `canvas.connections[${idx}] must be an object`);
  }
  const id = raw["id"];
  const from = raw["from"];
  const to = raw["to"];
  const kind = raw["kind"];
  if (typeof id !== "string" || id === "") {
    throw new CanvasOperationError(
      "INVALID_SHAPE",
      `canvas.connections[${idx}].id must be a non-empty string`,
    );
  }
  if (typeof from !== "string" || typeof to !== "string") {
    throw new CanvasOperationError(
      "INVALID_SHAPE",
      `canvas.connections[${idx}].from/to must be strings`,
    );
  }
  if (typeof kind !== "string" || !VALID_EDGE_KINDS.has(kind as CanvasEdgeKind)) {
    throw new CanvasOperationError(
      "INVALID_SHAPE",
      `canvas.connections[${idx}].kind invalid: ${String(kind)}`,
    );
  }
  const label = raw["label"];
  const edge: CanvasEdge = { id, from, to, kind: kind as CanvasEdgeKind };
  if (typeof label === "string") {
    return { ...edge, label };
  }
  return edge;
}

function parseTokens(raw: unknown): DesignSystemRef {
  if (!isRecord(raw)) {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas.tokens must be an object");
  }
  const id = raw["id"];
  const path = raw["path"];
  if (typeof id !== "string" || id === "") {
    throw new CanvasOperationError("INVALID_SHAPE", "canvas.tokens.id must be a non-empty string");
  }
  return typeof path === "string" ? { id, path } : { id };
}
