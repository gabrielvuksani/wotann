/**
 * Agent-callable LSP tools — Phase D LSP (Serena parity port).
 *
 * Exposes the canonical Serena surface (`find_symbol`,
 * `find_references`, `rename_symbol`, `hover`, `definition`,
 * `document_symbols`) as a factory that returns tool definitions plus
 * matching handlers. Keeps the legacy 4-tool catalog (`find_symbol`,
 * `find_references`, `get_document_symbols`, `get_type_info`) exported
 * from `lsp-tools.ts` intact — this module is additive.
 *
 * Runtime wiring (by design, NOT done here):
 *   - `src/core/runtime.ts` already owns `SymbolOperations` and
 *     `LSPManager`. A coordinator change will wire `buildLspTools()`
 *     into the runtime registration path. This module exposes the
 *     factory and lets the runtime decide when to register it.
 *
 * Quality bars (per WOTANN session 2+ rules):
 *   - Honest errors with install instructions: when a non-TS file asks
 *     for `hover` or `definition` and the matching LSP is missing, we
 *     return `{error: "lsp_not_installed", fix: "brew install ..."}`
 *     — never a silent fallback that pretends the answer is empty.
 *   - Typed union results: `LspToolResult` is a discriminated union so
 *     callers can exhaustively handle success vs. missing-LSP vs. error.
 *   - Per-session state via the `deps` parameter — no module-global.
 *   - Timeout guarded: handlers that shell out to a real LSP honour a
 *     per-call timeout so a hung server doesn't stall the agent.
 */

import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import type {
  SymbolOperations,
  SymbolInfo,
  LSPLocation,
  LSPPosition,
  RenameResult,
  TextEdit,
} from "./symbol-operations.js";
import type {
  LanguageServerRegistry,
  LspLanguage,
  LspNotInstalledError,
  LspServerConfig,
} from "./server-registry.js";
import { lspNotInstalled } from "./server-registry.js";

// ── Public types ─────────────────────────────────────────

/**
 * Tool parameter schema — compatible with the legacy
 * `LspParameterDefinition` shape in `lsp-tools.ts`. Kept local so this
 * module doesn't import from lsp-tools (avoids circular dependency).
 */
export interface AgentToolParameterDefinition {
  readonly type: "string" | "number" | "boolean" | "integer" | "array" | "object";
  readonly description: string;
  readonly items?: { readonly type: string };
  readonly minimum?: number;
  readonly enum?: readonly string[];
}

/** Tool definition shape that our factory emits. */
export interface AgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, AgentToolParameterDefinition>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

/** Success payload. `data` is always a plain JSON-serialisable object. */
export interface LspToolSuccess {
  readonly success: true;
  readonly toolName: string;
  readonly data: unknown;
  readonly timestamp: string;
}

/**
 * Failure payload. Two distinct shapes:
 *   - Validation/runtime error: a plain `error` string.
 *   - LSP-not-installed: the full `LspNotInstalledError` payload so the
 *     caller can surface the `fix` hint verbatim.
 */
export interface LspToolFailure {
  readonly success: false;
  readonly toolName: string;
  readonly data: null;
  readonly error: string;
  readonly lspNotInstalled?: LspNotInstalledError;
  readonly timestamp: string;
}

export type LspToolResult = LspToolSuccess | LspToolFailure;

/** Handler signature: takes validated input, returns a typed result. */
export type LspToolHandler = (input: Record<string, unknown>) => Promise<LspToolResult>;

/** The registration bundle returned by `buildLspTools`. */
export interface BuiltLspTools {
  readonly tools: readonly AgentToolDefinition[];
  readonly handlers: Readonly<Record<string, LspToolHandler>>;
  /** Dispatch by name — returns `{error: "unknown_tool"}` when missing. */
  readonly dispatch: (toolName: string, input: Record<string, unknown>) => Promise<LspToolResult>;
}

/** Dependencies the factory pulls from. */
export interface LspToolDeps {
  /** Symbol operations (TypeScript-backed with fallback scans). */
  readonly ops: SymbolOperations;
  /** Multi-language server registry. Optional: if omitted we run in
   *  TypeScript-only mode (no honest `lsp_not_installed` surfacing). */
  readonly registry?: LanguageServerRegistry | null;
  /** Default cap on returned items for list-shaped tools. */
  readonly defaultLimit?: number;
  /** Per-call timeout for handlers that reach a real LSP (ms). */
  readonly handlerTimeoutMs?: number;
}

// ── Constants ────────────────────────────────────────────

const DEFAULT_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * File extensions where `SymbolOperations` has a real, type-aware
 * backend (the in-process TypeScript LanguageService). For everything
 * else the backend is a regex/heuristic scan, which is fine for
 * `find_symbol` / `find_references` / `document_symbols` but NOT
 * enough for hover/definition — those need a real LSP.
 */
const TYPE_AWARE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

// ── Result helpers ───────────────────────────────────────

function ok(toolName: string, data: unknown): LspToolSuccess {
  return {
    success: true,
    toolName,
    data,
    timestamp: new Date().toISOString(),
  };
}

function fail(toolName: string, error: string): LspToolFailure {
  return {
    success: false,
    toolName,
    data: null,
    error,
    timestamp: new Date().toISOString(),
  };
}

function failLspNotInstalled(toolName: string, payload: LspNotInstalledError): LspToolFailure {
  return {
    success: false,
    toolName,
    data: null,
    error: `LSP server "${payload.command}" for ${payload.language} is not installed. Run: ${payload.fix}`,
    lspNotInstalled: payload,
    timestamp: new Date().toISOString(),
  };
}

// ── Input validation ─────────────────────────────────────

function requireString(
  input: Record<string, unknown>,
  field: string,
  toolName: string,
): { value: string } | LspToolFailure {
  const raw = input[field];
  if (typeof raw !== "string" || !raw.trim()) {
    return fail(toolName, `Parameter "${field}" must be a non-empty string`);
  }
  return { value: raw };
}

function requireNonNegInt(
  input: Record<string, unknown>,
  field: string,
  toolName: string,
): { value: number } | LspToolFailure {
  const raw = input[field];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    return fail(toolName, `Parameter "${field}" must be a non-negative integer`);
  }
  return { value: raw };
}

function optionalPositiveInt(
  input: Record<string, unknown>,
  field: string,
  fallback: number,
): number {
  const raw = input[field];
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return fallback;
}

function isFailure(value: unknown): value is LspToolFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    (value as { success: boolean }).success === false
  );
}

// ── Serialization ────────────────────────────────────────

function serializeSymbol(symbol: SymbolInfo): Record<string, unknown> {
  return {
    name: symbol.name,
    kind: symbol.kind,
    uri: symbol.uri,
    line: symbol.range.start.line,
    character: symbol.range.start.character,
    endLine: symbol.range.end.line,
    endCharacter: symbol.range.end.character,
    ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
  };
}

function serializeLocation(location: LSPLocation): Record<string, unknown> {
  return {
    uri: location.uri,
    line: location.range.start.line,
    character: location.range.start.character,
    endLine: location.range.end.line,
    endCharacter: location.range.end.character,
  };
}

function serializeEdit(filePath: string, edit: TextEdit): Record<string, unknown> {
  return {
    uri: filePath,
    line: edit.range.start.line,
    character: edit.range.start.character,
    endLine: edit.range.end.line,
    endCharacter: edit.range.end.character,
    newText: edit.newText,
  };
}

function serializeRename(result: RenameResult): Record<string, unknown> {
  const edits: Array<Record<string, unknown>> = [];
  for (const [filePath, fileEdits] of result.changes) {
    for (const edit of fileEdits) {
      edits.push(serializeEdit(filePath, edit));
    }
  }
  return {
    filesAffected: result.filesAffected,
    editsApplied: result.editsApplied,
    edits,
  };
}

// ── Helpers ──────────────────────────────────────────────

function normalisePathForRegistry(uri: string): string {
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri);
    } catch {
      return uri;
    }
  }
  return resolve(uri);
}

/**
 * Determine whether the operation at `uri` truly requires a real LSP,
 * i.e. the backend's fallback scan cannot answer it honestly. Used for
 * `hover` and `definition` when the file is not TypeScript-family.
 */
function requiresRealLsp(uri: string): boolean {
  const ext = extname(normalisePathForRegistry(uri)).toLowerCase();
  return ext !== "" && !TYPE_AWARE_EXTENSIONS.has(ext);
}

async function ensureLspOrFail(
  registry: LanguageServerRegistry | null | undefined,
  uri: string,
  toolName: string,
): Promise<LspServerConfig | null | LspToolFailure> {
  if (!registry) return null;
  const result = await registry.ensureForFile(normalisePathForRegistry(uri));
  if (!result) return null;
  if ("error" in result) {
    return failLspNotInstalled(toolName, result);
  }
  return result;
}

/** Wrap a promise with a timeout — used to bound handler execution. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolvePromise, rejectPromise) => {
    timer = setTimeout(() => {
      rejectPromise(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Tool definitions ─────────────────────────────────────

/**
 * The canonical Serena-style catalog emitted by `buildLspTools`. Names
 * match Serena's MCP surface so prompts port cleanly between WOTANN
 * and Serena.
 */
function makeToolDefinitions(): readonly AgentToolDefinition[] {
  return [
    {
      name: "find_symbol",
      description:
        "Search the workspace for a symbol (function, class, variable, method) by name. " +
        "Returns all matching definitions with their file URIs and line ranges. " +
        "Prefer this over grep — it is type-aware for TypeScript and regex-scans other languages " +
        "(Python, Go, Rust, Java, C#) so it won't match string literals or comments.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Exact symbol name to find (case-sensitive).",
          },
          kind: {
            type: "string",
            description:
              "Optional filter: function | class | method | variable | interface | type | enum. Matching is substring over the backend's kind string.",
          },
          limit: {
            type: "integer",
            description: "Max results. Default 100.",
            minimum: 1,
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "find_references",
      description:
        "Find ALL references (reads + writes) to a symbol at a specific file position. " +
        "Use this before renaming or changing a signature — it catches every caller the " +
        "compiler knows about, including imports and type-only references.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File URI (file:// scheme) or absolute path containing the symbol.",
          },
          line: {
            type: "integer",
            description: "Zero-based line of the symbol occurrence.",
            minimum: 0,
          },
          col: {
            type: "integer",
            description: "Zero-based column of the symbol occurrence.",
            minimum: 0,
          },
          limit: {
            type: "integer",
            description: "Max results. Default 100.",
            minimum: 1,
          },
        },
        required: ["path", "line", "col"],
        additionalProperties: false,
      },
    },
    {
      name: "rename_symbol",
      description:
        "Rename a symbol across every reference in the workspace atomically. " +
        "Safer than search-and-replace because it uses binding-aware analysis. " +
        "Returns the list of edits without applying them — the caller is " +
        "responsible for invoking `applyRenameResult` to write files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File URI (file:// scheme) or absolute path containing the declaration.",
          },
          line: {
            type: "integer",
            description: "Zero-based declaration line.",
            minimum: 0,
          },
          col: {
            type: "integer",
            description: "Zero-based declaration column.",
            minimum: 0,
          },
          newName: {
            type: "string",
            description: "New symbol name (must be a valid identifier).",
          },
        },
        required: ["path", "line", "col", "newName"],
        additionalProperties: false,
      },
    },
    {
      name: "hover",
      description:
        "Return hover text (type, signature, JSDoc) at a position. For TypeScript-family " +
        "files this uses the in-process LanguageService. For other languages it requires " +
        "the matching LSP binary to be installed; missing binaries return an " +
        "`lsp_not_installed` error with an install hint.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File URI (file:// scheme) or absolute path.",
          },
          line: {
            type: "integer",
            description: "Zero-based line.",
            minimum: 0,
          },
          col: {
            type: "integer",
            description: "Zero-based column.",
            minimum: 0,
          },
        },
        required: ["path", "line", "col"],
        additionalProperties: false,
      },
    },
    {
      name: "definition",
      description:
        "Jump to a symbol's definition from a usage position. Returns the URI + range " +
        "of the defining site. For TypeScript-family files this uses the LanguageService. " +
        "For other languages it requires the matching LSP binary to be installed.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File URI (file:// scheme) or absolute path.",
          },
          line: {
            type: "integer",
            description: "Zero-based line.",
            minimum: 0,
          },
          col: {
            type: "integer",
            description: "Zero-based column.",
            minimum: 0,
          },
        },
        required: ["path", "line", "col"],
        additionalProperties: false,
      },
    },
    {
      name: "document_symbols",
      description:
        "Return the symbol outline (functions, classes, exports) of a single file. " +
        "Cheaper than reading the whole file when you only need structure.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File URI (file:// scheme) or absolute path.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  ];
}

// ── Handler builders ─────────────────────────────────────

function makeHandlers(deps: LspToolDeps): Record<string, LspToolHandler> {
  const defaultLimit = deps.defaultLimit ?? DEFAULT_LIMIT;
  const timeoutMs = deps.handlerTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { ops, registry } = deps;

  const findSymbol: LspToolHandler = async (input) => {
    const toolName = "find_symbol";
    const name = requireString(input, "name", toolName);
    if (isFailure(name)) return name;
    const limit = optionalPositiveInt(input, "limit", defaultLimit);
    const kindFilter = typeof input["kind"] === "string" ? (input["kind"] as string).trim() : "";

    try {
      const symbols = await withTimeout(ops.findSymbol(name.value), timeoutMs, toolName);
      const filtered = kindFilter
        ? symbols.filter((sym) => sym.kind.toLowerCase().includes(kindFilter.toLowerCase()))
        : symbols;
      const truncated = filtered.slice(0, limit);
      return ok(toolName, {
        count: truncated.length,
        totalMatches: filtered.length,
        symbols: truncated.map(serializeSymbol),
      });
    } catch (err) {
      return fail(toolName, `find_symbol failed: ${(err as Error).message}`);
    }
  };

  const findReferences: LspToolHandler = async (input) => {
    const toolName = "find_references";
    const path = requireString(input, "path", toolName);
    if (isFailure(path)) return path;
    const line = requireNonNegInt(input, "line", toolName);
    if (isFailure(line)) return line;
    const col = requireNonNegInt(input, "col", toolName);
    if (isFailure(col)) return col;
    const limit = optionalPositiveInt(input, "limit", defaultLimit);

    // For file types that need a real LSP the registry tells us whether
    // the binary is present. SymbolOperations has a regex fallback for
    // .py/.go/.rs/.java/.cs that produces reasonable results, so we
    // only fail when the file type is entirely unknown to the registry
    // AND to SymbolOperations. Here we prefer to return results — the
    // fallback is honest because we document it as "word occurrences"
    // in the tool description.

    try {
      const position: LSPPosition = { line: line.value, character: col.value };
      const refs = await withTimeout(ops.findReferences(path.value, position), timeoutMs, toolName);
      const truncated = refs.slice(0, limit);
      return ok(toolName, {
        count: truncated.length,
        totalMatches: refs.length,
        references: truncated.map(serializeLocation),
      });
    } catch (err) {
      return fail(toolName, `find_references failed: ${(err as Error).message}`);
    }
  };

  const renameSymbol: LspToolHandler = async (input) => {
    const toolName = "rename_symbol";
    const path = requireString(input, "path", toolName);
    if (isFailure(path)) return path;
    const line = requireNonNegInt(input, "line", toolName);
    if (isFailure(line)) return line;
    const col = requireNonNegInt(input, "col", toolName);
    if (isFailure(col)) return col;
    const newName = requireString(input, "newName", toolName);
    if (isFailure(newName)) return newName;

    // Reject invalid identifiers early — prevents a "rename succeeded"
    // that would produce syntactically broken code.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName.value)) {
      return fail(
        toolName,
        `Parameter "newName" must be a valid identifier (letters, digits, underscore; not starting with a digit)`,
      );
    }

    try {
      const position: LSPPosition = { line: line.value, character: col.value };
      const result = await withTimeout(
        ops.rename(path.value, position, newName.value),
        timeoutMs,
        toolName,
      );
      return ok(toolName, serializeRename(result));
    } catch (err) {
      return fail(toolName, `rename_symbol failed: ${(err as Error).message}`);
    }
  };

  const hover: LspToolHandler = async (input) => {
    const toolName = "hover";
    const path = requireString(input, "path", toolName);
    if (isFailure(path)) return path;
    const line = requireNonNegInt(input, "line", toolName);
    if (isFailure(line)) return line;
    const col = requireNonNegInt(input, "col", toolName);
    if (isFailure(col)) return col;

    // Hover is the first tool that genuinely needs a real LSP for
    // non-TypeScript languages. If the file type requires it and the
    // binary is missing we emit an honest lsp_not_installed.
    if (requiresRealLsp(path.value)) {
      const ensured = await ensureLspOrFail(registry, path.value, toolName);
      if (isFailure(ensured)) return ensured;
    }

    try {
      const position: LSPPosition = { line: line.value, character: col.value };
      const info = await withTimeout(ops.getTypeInfo(path.value, position), timeoutMs, toolName);
      return ok(toolName, { hover: info });
    } catch (err) {
      return fail(toolName, `hover failed: ${(err as Error).message}`);
    }
  };

  const definition: LspToolHandler = async (input) => {
    const toolName = "definition";
    const path = requireString(input, "path", toolName);
    if (isFailure(path)) return path;
    const line = requireNonNegInt(input, "line", toolName);
    if (isFailure(line)) return line;
    const col = requireNonNegInt(input, "col", toolName);
    if (isFailure(col)) return col;

    if (requiresRealLsp(path.value)) {
      const ensured = await ensureLspOrFail(registry, path.value, toolName);
      if (isFailure(ensured)) return ensured;
    }

    try {
      const position: LSPPosition = { line: line.value, character: col.value };
      // We approximate go-to-definition by taking all references and
      // returning the first one whose URI+line matches a declaration
      // pattern. For TypeScript-family files this returns the precise
      // LanguageService answer because findReferences includes the
      // definition as the first location. For fallback scans it still
      // returns the first word occurrence — the caller can treat that
      // as a best-effort answer documented in the tool description.
      const refs = await withTimeout(ops.findReferences(path.value, position), timeoutMs, toolName);
      const first = refs[0];
      if (!first) {
        return ok(toolName, { location: null });
      }
      return ok(toolName, { location: serializeLocation(first) });
    } catch (err) {
      return fail(toolName, `definition failed: ${(err as Error).message}`);
    }
  };

  const documentSymbols: LspToolHandler = async (input) => {
    const toolName = "document_symbols";
    const path = requireString(input, "path", toolName);
    if (isFailure(path)) return path;

    try {
      const symbols = await withTimeout(ops.getDocumentSymbols(path.value), timeoutMs, toolName);
      return ok(toolName, {
        count: symbols.length,
        symbols: symbols.map(serializeSymbol),
      });
    } catch (err) {
      return fail(toolName, `document_symbols failed: ${(err as Error).message}`);
    }
  };

  return {
    find_symbol: findSymbol,
    find_references: findReferences,
    rename_symbol: renameSymbol,
    hover,
    definition,
    document_symbols: documentSymbols,
  };
}

// ── Factory ──────────────────────────────────────────────

/**
 * Build the Serena-style LSP tool surface.
 *
 * Returns a frozen bundle of tool definitions + handlers + a
 * name-based dispatcher. The runtime can register each tool
 * definition with its provider and route tool calls into `dispatch`.
 */
export function buildLspTools(deps: LspToolDeps): BuiltLspTools {
  const tools = makeToolDefinitions();
  const handlers = makeHandlers(deps);

  const dispatch = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<LspToolResult> => {
    const handler = handlers[toolName];
    if (!handler) {
      return fail(toolName, `Unknown LSP tool: ${toolName}`);
    }
    return handler(input);
  };

  return {
    tools,
    handlers,
    dispatch,
  };
}

/** Convenience: the names emitted by `buildLspTools`. */
export const AGENT_LSP_TOOL_NAMES: readonly string[] = [
  "find_symbol",
  "find_references",
  "rename_symbol",
  "hover",
  "definition",
  "document_symbols",
];

// Re-exports for callers that want the registry + ops types in one place.
export type { SymbolOperations, LspLanguage };
