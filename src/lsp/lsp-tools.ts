/**
 * LSP agent-tool surface — Phase 4 Sprint B2 item 21.
 *
 * SymbolOperations (src/lsp/symbol-operations.ts) ships REAL symbol
 * indexing — findSymbol, findReferences, rename, getTypeInfo,
 * getDocumentSymbols — backed by the TypeScript language service with
 * a workspace-scan fallback for other languages. But the agent loop
 * never calls it: the harness only uses Read/Grep/Edit as primary
 * navigation tools, leaving repo-wide symbol understanding unused.
 *
 * This module wires SymbolOperations as an agent tool surface so any
 * provider's tool-calling loop can invoke `find_symbol` / `find_references`
 * the same way it invokes memory_search. Goose parity: Goose ships the
 * same tools via its built-in developer extension, and they deliver
 * +2-4% on SWE-bench Verified by letting the agent skip grep-matching
 * for symbol-level refactors.
 *
 * Tool shapes match the ToolDefinition pattern used by memory-tools.ts:
 *   - name (snake_case, matches prompt conventions)
 *   - description (for model's tool catalog)
 *   - parameters (JSON-Schema-like)
 *   - required list
 *
 * The dispatcher (`dispatchLspTool`) handles input validation, error
 * messages, and returns ToolCallResult so callers don't need to know
 * which method raised what.
 */

import type {
  SymbolOperations,
  SymbolInfo,
  LSPLocation,
  LSPPosition,
} from "./symbol-operations.js";

// ── Types ──────────────────────────────────────────────

export interface ToolCallResult {
  readonly success: boolean;
  readonly toolName: string;
  readonly data: unknown;
  readonly error?: string;
  readonly timestamp: string;
}

export interface LspToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, LspParameterDefinition>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

export interface LspParameterDefinition {
  readonly type: "string" | "number" | "boolean" | "integer" | "array" | "object";
  readonly description: string;
  readonly items?: { readonly type: string };
  readonly minimum?: number;
}

export interface FindSymbolInput {
  readonly name: string;
  readonly limit?: number;
}

export interface FindReferencesInput {
  readonly uri: string;
  readonly line: number;
  readonly character: number;
  readonly limit?: number;
}

export interface GetDocumentSymbolsInput {
  readonly uri: string;
}

export interface GetTypeInfoInput {
  readonly uri: string;
  readonly line: number;
  readonly character: number;
}

// ── Tool definitions ──────────────────────────────────

/**
 * Agent-facing tool catalog. Names use the Goose convention
 * (`find_symbol`, `find_references`) so tool-calling prompts ported
 * between WOTANN and Goose stay compatible.
 */
export const LSP_TOOLS: readonly LspToolDefinition[] = [
  {
    name: "find_symbol",
    description:
      "Search the workspace for a symbol (function, class, variable, method) by name. Returns all matching definitions with their file URIs and line ranges. Use this BEFORE running grep — it's type-aware and won't match string literals.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Exact symbol name to find (case-sensitive).",
        },
        limit: {
          type: "integer",
          description: "Max results. Default 20.",
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
      "Find ALL references (reads + writes) to a symbol at a specific file position. Use this before renaming or changing a signature — it catches every caller the compiler knows about, including imports and type-only references.",
    parameters: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "File URI (file:// scheme) or absolute path containing the symbol.",
        },
        line: {
          type: "integer",
          description: "Zero-based line of the symbol occurrence.",
          minimum: 0,
        },
        character: {
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
      required: ["uri", "line", "character"],
      additionalProperties: false,
    },
  },
  {
    name: "get_document_symbols",
    description:
      "Return the symbol outline (functions, classes, exports) of a single file. Cheaper than reading the whole file when you only need structure.",
    parameters: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "File URI (file:// scheme) or absolute path.",
        },
      },
      required: ["uri"],
      additionalProperties: false,
    },
  },
  {
    name: "get_type_info",
    description:
      "Return the TypeScript hover text (type, signature, JSDoc) at a position. Only works for .ts/.tsx/.js/.jsx files.",
    parameters: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "File URI (file:// scheme) or absolute path.",
        },
        line: {
          type: "integer",
          description: "Zero-based line.",
          minimum: 0,
        },
        character: {
          type: "integer",
          description: "Zero-based column.",
          minimum: 0,
        },
      },
      required: ["uri", "line", "character"],
      additionalProperties: false,
    },
  },
];

// ── Dispatcher ────────────────────────────────────────

function ok(toolName: string, data: unknown): ToolCallResult {
  return { success: true, toolName, data, timestamp: new Date().toISOString() };
}

function fail(toolName: string, error: string): ToolCallResult {
  return { success: false, toolName, data: null, error, timestamp: new Date().toISOString() };
}

function validateString(value: unknown, field: string, toolName: string): ToolCallResult | null {
  if (typeof value !== "string" || !value.trim()) {
    return fail(toolName, `Parameter "${field}" must be a non-empty string`);
  }
  return null;
}

function validateNonNegativeInteger(
  value: unknown,
  field: string,
  toolName: string,
): ToolCallResult | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return fail(toolName, `Parameter "${field}" must be a non-negative integer`);
  }
  return null;
}

export async function dispatchLspTool(
  toolName: string,
  input: Record<string, unknown>,
  ops: SymbolOperations,
): Promise<ToolCallResult> {
  switch (toolName) {
    case "find_symbol": {
      const nameError = validateString(input["name"], "name", toolName);
      if (nameError) return nameError;
      const rawLimit = input["limit"];
      const limit =
        typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 20;
      try {
        const symbols = await ops.findSymbol(input["name"] as string);
        const truncated = symbols.slice(0, limit);
        return ok(toolName, {
          count: truncated.length,
          totalMatches: symbols.length,
          symbols: truncated.map(toPublicSymbol),
        });
      } catch (err) {
        return fail(toolName, `findSymbol failed: ${(err as Error).message}`);
      }
    }

    case "find_references": {
      const uriError = validateString(input["uri"], "uri", toolName);
      if (uriError) return uriError;
      const lineError = validateNonNegativeInteger(input["line"], "line", toolName);
      if (lineError) return lineError;
      const colError = validateNonNegativeInteger(input["character"], "character", toolName);
      if (colError) return colError;
      const rawLimit = input["limit"];
      const limit =
        typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 100;

      try {
        const pos: LSPPosition = {
          line: input["line"] as number,
          character: input["character"] as number,
        };
        const refs = await ops.findReferences(input["uri"] as string, pos);
        const truncated = refs.slice(0, limit);
        return ok(toolName, {
          count: truncated.length,
          totalMatches: refs.length,
          references: truncated.map(toPublicLocation),
        });
      } catch (err) {
        return fail(toolName, `findReferences failed: ${(err as Error).message}`);
      }
    }

    case "get_document_symbols": {
      const uriError = validateString(input["uri"], "uri", toolName);
      if (uriError) return uriError;
      try {
        const symbols = await ops.getDocumentSymbols(input["uri"] as string);
        return ok(toolName, { count: symbols.length, symbols: symbols.map(toPublicSymbol) });
      } catch (err) {
        return fail(toolName, `getDocumentSymbols failed: ${(err as Error).message}`);
      }
    }

    case "get_type_info": {
      const uriError = validateString(input["uri"], "uri", toolName);
      if (uriError) return uriError;
      const lineError = validateNonNegativeInteger(input["line"], "line", toolName);
      if (lineError) return lineError;
      const colError = validateNonNegativeInteger(input["character"], "character", toolName);
      if (colError) return colError;
      try {
        const pos: LSPPosition = {
          line: input["line"] as number,
          character: input["character"] as number,
        };
        const info = await ops.getTypeInfo(input["uri"] as string, pos);
        return ok(toolName, { typeInfo: info });
      } catch (err) {
        return fail(toolName, `getTypeInfo failed: ${(err as Error).message}`);
      }
    }

    default:
      return fail(toolName, `Unknown LSP tool: ${toolName}`);
  }
}

// ── Serialization helpers ─────────────────────────────

function toPublicSymbol(symbol: SymbolInfo): Record<string, unknown> {
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

function toPublicLocation(location: LSPLocation): Record<string, unknown> {
  return {
    uri: location.uri,
    line: location.range.start.line,
    character: location.range.start.character,
    endLine: location.range.end.line,
    endCharacter: location.range.end.character,
  };
}

// ── Convenience: tool-name list ───────────────────────

export const LSP_TOOL_NAMES: readonly string[] = LSP_TOOLS.map((t) => t.name);

// ── Serena-parity re-exports (Phase D LSP) ────────────
//
// The canonical 6-tool agent surface (`find_symbol`, `find_references`,
// `rename_symbol`, `hover`, `definition`, `document_symbols`) is built
// in `agent-tools.ts`. Re-export the factory + types here so existing
// consumers that import from `lsp-tools` keep working, and so anyone
// wiring the runtime tool registry has a single entry point.
export { buildLspTools, AGENT_LSP_TOOL_NAMES } from "./agent-tools.js";
export type {
  AgentToolDefinition,
  AgentToolParameterDefinition,
  BuiltLspTools,
  LspToolDeps,
  LspToolHandler,
  LspToolResult,
  LspToolSuccess,
  LspToolFailure,
} from "./agent-tools.js";

// Registry exports — the 10-server catalog + detection + lifecycle.
export { LanguageServerRegistry, LSP_SERVER_CATALOG, lspNotInstalled } from "./server-registry.js";
export type {
  LspLanguage,
  LspServerConfig,
  LspNotInstalledError,
  LanguageServerRegistryOptions,
  WhichChecker,
} from "./server-registry.js";
