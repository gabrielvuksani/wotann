/**
 * `wotann design mode` — Cursor 3 Design Mode CLI surface (P1-C7).
 *
 * Actions:
 *   create <name>           Create a new canvas under ~/.wotann/canvases
 *   list                    List persisted canvases
 *   edit <id> <op-json>     Apply a structured op and save (one-shot)
 *   export <id>             Emit JSX/TSX code for the canvas
 *   delete <id>             Remove a canvas from disk
 *
 * Pure handler — returns structured result lines; the CLI entrypoint
 * decides exit codes. Per-invocation `CanvasStore` (QB #7).
 *
 * `edit` accepts a JSON op payload (mirrors `CanvasOperation`) so this
 * command can be scripted by other tools without needing a REPL. Example:
 *   wotann design mode edit c-abc '{"kind":"rename","name":"New"}'
 */

import { writeFileSync } from "node:fs";
import { resolveWotannHomeSubdir } from "../../utils/wotann-home.js";
import { apply, type CanvasElementProps, type CanvasOperation } from "../../design/canvas.js";
import {
  CanvasStore,
  CanvasConflictError,
  CanvasNotFoundError,
} from "../../design/canvas-store.js";
import { canvasToCode } from "../../design/canvas-to-code.js";

// ── Types ────────────────────────────────────────────────────────────────

export type DesignModeAction = "create" | "list" | "edit" | "export" | "delete";

export interface DesignModeCommandOptions {
  readonly action: DesignModeAction;
  readonly name?: string;
  readonly canvasId?: string;
  /** JSON-encoded CanvasOperation payload for `edit`. */
  readonly opJson?: string;
  /** Output file for `export`. When omitted, code is returned in `output`. */
  readonly output?: string;
  /** Export format for `export`. Default `tsx`. */
  readonly format?: "jsx" | "tsx";
  /** Override canvases root directory. Default `~/.wotann/canvases/`. */
  readonly rootDir?: string;
  /** Test injection. */
  readonly store?: CanvasStore;
}

export interface DesignModeRunResult {
  readonly success: boolean;
  readonly action: DesignModeAction;
  readonly lines: readonly string[];
  readonly output?: string;
  readonly wrotePath?: string;
  readonly error?: string;
}

// ── Entry point ──────────────────────────────────────────────────────────

export async function runDesignModeCommand(
  options: DesignModeCommandOptions,
): Promise<DesignModeRunResult> {
  const store =
    options.store ??
    new CanvasStore({
      rootDir: options.rootDir ?? resolveWotannHomeSubdir("canvases"),
    });
  try {
    switch (options.action) {
      case "create":
        return handleCreate(store, options);
      case "list":
        return handleList(store);
      case "edit":
        return handleEdit(store, options);
      case "export":
        return handleExport(store, options);
      case "delete":
        return handleDelete(store, options);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      action: options.action,
      lines: [`error: ${reason}`],
      error: reason,
    };
  }
}

// ── Action handlers ──────────────────────────────────────────────────────

function handleCreate(store: CanvasStore, opts: DesignModeCommandOptions): DesignModeRunResult {
  if (!opts.name || opts.name.trim() === "") {
    throw new Error("create requires <name>");
  }
  const canvas = store.create(opts.name);
  return {
    success: true,
    action: "create",
    lines: [
      `✓ canvas "${canvas.name}" created`,
      `  id:         ${canvas.id}`,
      `  version:    ${canvas.version}`,
      `  directory:  ${store.directory()}`,
    ],
  };
}

function handleList(store: CanvasStore): DesignModeRunResult {
  const entries = store.list();
  const lines =
    entries.length === 0
      ? ["(no canvases saved)"]
      : [
          `Saved canvases: ${entries.length}`,
          ...entries.map((e) => `  ${e.id.padEnd(36)} v${String(e.version).padEnd(4)} ${e.name}`),
        ];
  return {
    success: true,
    action: "list",
    lines,
  };
}

function handleEdit(store: CanvasStore, opts: DesignModeCommandOptions): DesignModeRunResult {
  if (!opts.canvasId) {
    throw new Error("edit requires <id>");
  }
  if (!opts.opJson) {
    throw new Error("edit requires <op-json>");
  }
  let op: CanvasOperation;
  try {
    op = parseOp(opts.opJson);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid op JSON: ${reason}`);
  }
  let canvas;
  try {
    canvas = store.load(opts.canvasId);
  } catch (err) {
    if (err instanceof CanvasNotFoundError) {
      throw new Error(`canvas ${opts.canvasId} not found`);
    }
    throw err;
  }
  const updated = apply(canvas, op, Date.now());
  try {
    store.save(updated);
  } catch (err) {
    if (err instanceof CanvasConflictError) {
      throw new Error(
        `conflict: persisted=v${err.persistedVersion} provided=v${err.providedVersion} — reload and retry`,
      );
    }
    throw err;
  }
  return {
    success: true,
    action: "edit",
    lines: [
      `✓ canvas "${updated.name}" updated`,
      `  id:       ${updated.id}`,
      `  version:  v${canvas.version} → v${updated.version}`,
      `  op:       ${op.kind}`,
    ],
  };
}

function handleExport(store: CanvasStore, opts: DesignModeCommandOptions): DesignModeRunResult {
  if (!opts.canvasId) {
    throw new Error("export requires <id>");
  }
  const canvas = store.load(opts.canvasId);
  const fmt: "jsx" | "tsx" = opts.format ?? "tsx";
  const result = canvasToCode(canvas, { format: fmt });
  const lines: string[] = [
    `✓ exported canvas "${canvas.name}" → ${result.componentName} (${fmt})`,
    `  elements:  ${result.elementCount}`,
    `  edges:     ${result.edgeCount}`,
  ];
  if (result.warnings.length > 0) {
    lines.push(`  warnings:  ${result.warnings.length}`);
    for (const w of result.warnings) lines.push(`    • ${w}`);
  }
  let wrotePath: string | undefined;
  if (opts.output !== undefined) {
    writeFileSync(opts.output, result.code, "utf8");
    wrotePath = opts.output;
    lines.push(`  wrote:     ${opts.output}`);
  }
  return {
    success: true,
    action: "export",
    lines,
    output: result.code,
    ...(wrotePath !== undefined ? { wrotePath } : {}),
  };
}

function handleDelete(store: CanvasStore, opts: DesignModeCommandOptions): DesignModeRunResult {
  if (!opts.canvasId) {
    throw new Error("delete requires <id>");
  }
  const ok = store.delete(opts.canvasId);
  if (!ok) {
    return {
      success: false,
      action: "delete",
      lines: [`canvas ${opts.canvasId} not found`],
      error: "not-found",
    };
  }
  return {
    success: true,
    action: "delete",
    lines: [`✓ canvas ${opts.canvasId} deleted`],
  };
}

// ── Op parsing (narrowed from raw JSON) ──────────────────────────────────

function parseOp(json: string): CanvasOperation {
  const raw: unknown = JSON.parse(json);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("op must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj["kind"];
  switch (kind) {
    case "add-element": {
      const element = obj["element"];
      if (!isRecord(element)) throw new Error("add-element requires element object");
      return {
        kind: "add-element",
        element: {
          id: String(element["id"] ?? ""),
          type: asElementType(element["type"]),
          props: asProps(element["props"]),
          position: asPosition(element["position"]),
        },
      };
    }
    case "remove-element":
      return { kind: "remove-element", elementId: String(obj["elementId"] ?? "") };
    case "update-props":
      return {
        kind: "update-props",
        elementId: String(obj["elementId"] ?? ""),
        props: asProps(obj["props"]),
      };
    case "move-element":
      return {
        kind: "move-element",
        elementId: String(obj["elementId"] ?? ""),
        position: asPosition(obj["position"]),
      };
    case "connect": {
      const edge = obj["edge"];
      if (!isRecord(edge)) throw new Error("connect requires edge object");
      const base = {
        id: String(edge["id"] ?? ""),
        from: String(edge["from"] ?? ""),
        to: String(edge["to"] ?? ""),
        kind: asEdgeKind(edge["kind"]),
      };
      const label = edge["label"];
      return {
        kind: "connect",
        edge: typeof label === "string" ? { ...base, label } : base,
      };
    }
    case "disconnect":
      return { kind: "disconnect", edgeId: String(obj["edgeId"] ?? "") };
    case "rename":
      return { kind: "rename", name: String(obj["name"] ?? "") };
    case "set-tokens": {
      const tokens = obj["tokens"];
      if (tokens === null) return { kind: "set-tokens", tokens: null };
      if (!isRecord(tokens)) throw new Error("set-tokens requires tokens object or null");
      const tokensPath = tokens["path"];
      return {
        kind: "set-tokens",
        tokens:
          typeof tokensPath === "string"
            ? { id: String(tokens["id"] ?? ""), path: tokensPath }
            : { id: String(tokens["id"] ?? "") },
      };
    }
    default:
      throw new Error(`unknown op kind: ${String(kind)}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asElementType(v: unknown): "component" | "section" | "text" | "annotation" {
  if (v === "component" || v === "section" || v === "text" || v === "annotation") {
    return v;
  }
  throw new Error(`invalid element type: ${String(v)}`);
}

function asEdgeKind(v: unknown): "hand-off" | "data-flow" | "nav" {
  if (v === "hand-off" || v === "data-flow" || v === "nav") return v;
  throw new Error(`invalid edge kind: ${String(v)}`);
}

function asProps(v: unknown): CanvasElementProps {
  if (v === undefined || v === null) return {};
  if (!isRecord(v)) throw new Error("props must be an object");
  const out: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      out[k] = val;
    }
  }
  return out;
}

function asPosition(v: unknown): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (!isRecord(v)) throw new Error("position must be an object");
  const x = Number(v["x"]);
  const y = Number(v["y"]);
  const width = Number(v["width"]);
  const height = Number(v["height"]);
  if ([x, y, width, height].some((n) => Number.isNaN(n))) {
    throw new Error("position fields must be numbers");
  }
  return { x, y, width, height };
}

// ── Parse helper for the CLI entrypoint ──────────────────────────────────

/**
 * Normalize a user-supplied action verb to our typed DesignModeAction or
 * throw a clear error. Kept separate so the CLI entrypoint can bind
 * commander's positional args without reshaping the handler contract.
 */
export function parseDesignModeAction(action: string): DesignModeAction {
  const normalized = action.toLowerCase();
  if (
    normalized !== "create" &&
    normalized !== "list" &&
    normalized !== "edit" &&
    normalized !== "export" &&
    normalized !== "delete"
  ) {
    throw new Error(
      `unknown design mode action "${action}" (expected create | list | edit | export | delete)`,
    );
  }
  return normalized;
}
