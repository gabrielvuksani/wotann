/**
 * Memory tool shim adapter — V9 Tier 14.1.
 *
 * Anthropic's Memory tool is a standardized contract (tool type
 * `memory_20250818`, a.k.a. `memory`) that lets an agent persist and
 * retrieve long-term memories via five canonical operations:
 *
 *   - memory.view         — list memories under a namespace path
 *   - memory.create       — create a new memory at a path
 *   - memory.str_replace  — edit a memory via string replacement
 *   - memory.insert       — insert text at a line position
 *   - memory.delete       — remove a memory by path or id
 *
 * This module adapts that contract onto WOTANN's `MemoryStore` so any
 * Claude agent that speaks the Memory tool talks to WOTANN's memory
 * layer automatically — no bespoke integration per client.
 *
 * The shim owns ONLY the tool surface. It does not own the MCP wire
 * (that's `mcp-server.ts`) and does not open the real `MemoryStore`
 * (callers inject a `MemoryStoreLike`). A minimal store interface is
 * defined below so tests and alternate backends can slot in without
 * dragging SQLite.
 *
 * ── Path semantics ────────────────────────────────────────────────────────
 *   - Paths are Unix-style: `/memories/foo/bar`.
 *   - The namespace root defaults to `/memories` and is configurable via
 *     `namespaceRoot`.
 *   - A path maps directly to a `MemoryEntry.key`. No dedicated path
 *     column is needed — the store uses `key` as the address.
 *   - `list("/memories")` returns entries whose keys start with that
 *     prefix.
 *   - Path traversal (`..`, null byte, paths escaping the root) is
 *     rejected honestly before any store call.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────────────
 *  - QB #6 honest failures: every operation returns
 *    `{ isError: true, content: [{ type: "text", text: <reason> }] }`
 *    on failure — never a silent empty result, never a false `ok: true`.
 *  - QB #7 per-call state: the adapter captures its config once at
 *    `createMemoryToolShimAdapter(opts)`; no module-level caches or
 *    singletons. Two adapters in the same process are fully
 *    independent.
 *  - QB #13 env guard: no `process.env` reads. Every input comes
 *    through function arguments.
 *  - QB #11 sibling-site scan: the real MemoryStore (`src/memory/store.ts`)
 *    owns the storage primitives; this shim only composes the tiny
 *    `MemoryStoreLike` surface it needs.
 */

import type { McpToolCallResult, McpToolDefinition, ToolHostAdapter } from "./mcp-server.js";

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * Minimal store surface this shim needs. Intentionally narrower than
 * the real `MemoryStore` class so tests can pass a Map-backed fake and
 * alternate backends (in-memory, Redis, file system) can slot in
 * without implementing the 80+ methods the full store exposes.
 *
 * Semantics:
 *  - `list(prefix)` returns every entry whose `key` starts with `prefix`.
 *    Non-matching or empty results return an empty array (NOT an error).
 *  - `get(id)` returns `null` when the id is unknown.
 *  - `insert` always succeeds or throws — the caller gets a fresh id back.
 *  - `updateValue` returns `false` when the id is unknown.
 *  - `remove` returns `false` when the id is unknown.
 */
export interface MemoryStoreLike {
  readonly list: (prefix: string) => readonly { id: string; key: string; value: string }[];
  readonly get: (id: string) => { id: string; key: string; value: string } | null;
  readonly insert: (entry: { key: string; value: string; sessionId?: string }) => { id: string };
  readonly updateValue: (id: string, newValue: string) => boolean;
  readonly remove: (id: string) => boolean;
}

/**
 * Injection surface for the adapter factory. `store` is required —
 * everything else has a sane default.
 */
export interface MemoryToolShimOptions {
  readonly store: MemoryStoreLike;
  /**
   * Namespace root. Paths that don't start with this are rejected
   * (path-traversal defense). Default: "/memories" — matches
   * Anthropic's Memory tool default contract.
   */
  readonly namespaceRoot?: string;
  /**
   * Optional session id carried on every `insert`. Lets a caller scope
   * memories to a specific WOTANN session so consolidation and export
   * stay coherent.
   */
  readonly sessionId?: string;
}

// ═══ Tool definitions ═════════════════════════════════════════════════════

const MEMORY_VIEW_TOOL: McpToolDefinition = {
  name: "memory.view",
  description:
    'List memories stored under a path. Pass a path like "/memories" or "/memories/projects"; returns every entry whose key starts with that prefix. Non-existent paths return an empty list, not an error.',
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Path to list under. Must start with the namespace root (default "/memories"). Defaults to the root if omitted.',
      },
    },
    required: [],
    additionalProperties: false,
  },
};

const MEMORY_CREATE_TOOL: McpToolDefinition = {
  name: "memory.create",
  description:
    "Create a new memory entry at a path with the provided content. Returns the new entry's id. Duplicate paths are allowed — the store addresses by id, not path uniqueness.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Path for the new memory. Must start with the namespace root (default "/memories").',
      },
      content: {
        type: "string",
        description: "The memory's text content.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

const MEMORY_STR_REPLACE_TOOL: McpToolDefinition = {
  name: "memory.str_replace",
  description:
    "Edit a memory by replacing an exact string match. Requires the memory's id. `oldStr` must appear exactly once in the memory's current value — otherwise the edit is rejected so ambiguous substitutions never slip through.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Id of the memory to edit (from memory.view or memory.create).",
      },
      oldStr: {
        type: "string",
        description: "Exact substring to replace. Must appear exactly once.",
      },
      newStr: {
        type: "string",
        description: "Replacement text. Empty string is allowed (acts as a deletion).",
      },
    },
    required: ["id", "oldStr", "newStr"],
    additionalProperties: false,
  },
};

const MEMORY_INSERT_TOOL: McpToolDefinition = {
  name: "memory.insert",
  description:
    "Insert text into a memory at a specific line position (0-indexed). Position 0 inserts before the first line; position N inserts after the last line. The inserted text becomes its own line.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Id of the memory to edit.",
      },
      line: {
        type: "number",
        description: "0-indexed line position to insert at.",
      },
      text: {
        type: "string",
        description: "Text to insert as a new line.",
      },
    },
    required: ["id", "line", "text"],
    additionalProperties: false,
  },
};

const MEMORY_DELETE_TOOL: McpToolDefinition = {
  name: "memory.delete",
  description:
    "Delete a memory by id. Returns { ok: false } with a clear error if the id is unknown — never silently succeeds.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Id of the memory to delete.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

const TOOL_LIST: readonly McpToolDefinition[] = [
  MEMORY_VIEW_TOOL,
  MEMORY_CREATE_TOOL,
  MEMORY_STR_REPLACE_TOOL,
  MEMORY_INSERT_TOOL,
  MEMORY_DELETE_TOOL,
];

// ═══ Helpers ══════════════════════════════════════════════════════════════

const DEFAULT_NAMESPACE_ROOT = "/memories";

function okResult(payload: unknown): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function errResult(reason: string): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: reason }, null, 2) }],
    isError: true,
  };
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`argument "${name}" must be a non-empty string`);
  }
  return value;
}

function assertNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`argument "${name}" must be an integer`);
  }
  return value;
}

/**
 * Normalize and validate a namespace path.
 *
 * Reject:
 *  - paths containing `..` segments (traversal)
 *  - paths containing a null byte (sqlite/c-string smuggling)
 *  - paths not under the configured root
 *
 * Accept:
 *  - exact root (e.g. `/memories`)
 *  - root + trailing slash (e.g. `/memories/`)
 *  - nested paths (e.g. `/memories/projects/foo`)
 *
 * The returned path is canonicalized: trailing slashes stripped, double
 * slashes collapsed. The root itself normalizes to its own exact form.
 */
function validatePath(rawPath: string, root: string): string {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  if (rawPath.includes("\0")) {
    throw new Error("path contains null byte");
  }
  // Reject traversal before any canonicalization so we never accept a
  // path that even mentioned `..` (the real-store backend might expose
  // edge cases otherwise).
  const segments = rawPath.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error("path traversal rejected: .. not allowed");
    }
  }
  // Collapse double slashes and strip trailing slash (but leave the root
  // as exactly the root).
  let canonical = rawPath.replace(/\/+/g, "/");
  if (canonical.length > 1 && canonical.endsWith("/")) {
    canonical = canonical.slice(0, -1);
  }
  // Canonical must start with root (exact match or root + "/").
  if (canonical !== root && !canonical.startsWith(root + "/")) {
    throw new Error(`path must be under namespace root ${root}`);
  }
  return canonical;
}

/**
 * Count the number of times `needle` occurs in `haystack`. Used to
 * enforce the "must appear exactly once" contract on str_replace.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/**
 * Insert `text` as a new line at `line` (0-indexed) within `value`.
 *
 * Semantics:
 *  - line=0 → prepend before the first line
 *  - line=N (where N = line count) → append after the last line
 *  - line between → insert between the existing lines
 *  - line < 0 or line > lineCount → rejected
 *
 * The resulting string keeps `\n` separators consistent with the
 * original: if the input had no trailing newline, neither does the
 * output (unless we inserted past the end).
 */
function insertAtLine(value: string, line: number, text: string): string {
  const lines = value.length === 0 ? [] : value.split("\n");
  if (line < 0 || line > lines.length) {
    throw new Error(`line ${line} out of range (0..${lines.length})`);
  }
  const next = [...lines.slice(0, line), text, ...lines.slice(line)];
  return next.join("\n");
}

// ═══ Adapter factory ══════════════════════════════════════════════════════

/**
 * Build a `ToolHostAdapter` the `mcp-server.ts` wire can consume.
 * Typical mount:
 *
 *   runMcpServer({
 *     info: { name: "wotann-memory-shim", version: "0.1.0" },
 *     adapter: createMemoryToolShimAdapter({
 *       store: wotannMemoryStoreAsMemoryStoreLike(memoryStore),
 *       sessionId: session.id,
 *     }),
 *   });
 *
 * The caller owns the MCP transport; this module only shapes the tool
 * surface.
 */
export function createMemoryToolShimAdapter(options: MemoryToolShimOptions): ToolHostAdapter {
  if (options == null || typeof options !== "object") {
    throw new Error("createMemoryToolShimAdapter: options is required");
  }
  if (options.store == null || typeof options.store !== "object") {
    throw new Error("createMemoryToolShimAdapter: store is required");
  }
  const root = options.namespaceRoot ?? DEFAULT_NAMESPACE_ROOT;
  if (typeof root !== "string" || root.length === 0 || !root.startsWith("/")) {
    throw new Error("createMemoryToolShimAdapter: namespaceRoot must start with '/' if provided");
  }
  const store = options.store;
  const sessionId = options.sessionId;

  async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    try {
      if (name === "memory.view") {
        const rawPath = typeof args["path"] === "string" ? (args["path"] as string) : root;
        const path = validatePath(rawPath, root);
        const entries = store.list(path);
        return okResult({
          ok: true,
          path,
          count: entries.length,
          entries: entries.map((e) => ({
            id: e.id,
            path: e.key,
            content: e.value,
          })),
        });
      }

      if (name === "memory.create") {
        const rawPath = assertString(args["path"], "path");
        const content = typeof args["content"] === "string" ? (args["content"] as string) : "";
        const path = validatePath(rawPath, root);
        // Bare root is a directory, not an entry. Require at least one
        // sub-segment so `memory.create "/memories" ...` doesn't create
        // an anonymous entry at the root.
        if (path === root) {
          return errResult(`path must include a sub-path under ${root} (got bare root)`);
        }
        const insertArg: { key: string; value: string; sessionId?: string } = {
          key: path,
          value: content,
        };
        if (typeof sessionId === "string" && sessionId.length > 0) {
          insertArg.sessionId = sessionId;
        }
        const { id } = store.insert(insertArg);
        return okResult({ ok: true, id, path });
      }

      if (name === "memory.str_replace") {
        const id = assertString(args["id"], "id");
        const oldStr = assertString(args["oldStr"], "oldStr");
        const newStr = typeof args["newStr"] === "string" ? (args["newStr"] as string) : "";
        const existing = store.get(id);
        if (existing == null) {
          return errResult(`no memory with id ${id}`);
        }
        const occurrences = countOccurrences(existing.value, oldStr);
        if (occurrences === 0) {
          return errResult("oldStr not found in memory");
        }
        if (occurrences > 1) {
          return errResult(`oldStr appears ${occurrences} times (must be exactly once)`);
        }
        const nextValue = existing.value.replace(oldStr, newStr);
        const updated = store.updateValue(id, nextValue);
        if (!updated) {
          return errResult(`store refused update for id ${id}`);
        }
        return okResult({
          ok: true,
          id,
          bytesBefore: existing.value.length,
          bytesAfter: nextValue.length,
        });
      }

      if (name === "memory.insert") {
        const id = assertString(args["id"], "id");
        const line = assertNumber(args["line"], "line");
        const text = typeof args["text"] === "string" ? (args["text"] as string) : "";
        const existing = store.get(id);
        if (existing == null) {
          return errResult(`no memory with id ${id}`);
        }
        const nextValue = insertAtLine(existing.value, line, text);
        const updated = store.updateValue(id, nextValue);
        if (!updated) {
          return errResult(`store refused update for id ${id}`);
        }
        return okResult({
          ok: true,
          id,
          insertedAtLine: line,
          bytesAfter: nextValue.length,
        });
      }

      if (name === "memory.delete") {
        const id = assertString(args["id"], "id");
        const removed = store.remove(id);
        if (!removed) {
          return errResult(`no memory with id ${id}`);
        }
        return okResult({ ok: true, id });
      }

      return errResult(`unknown tool: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errResult(`tool ${name} failed: ${msg}`);
    }
  }

  return {
    listTools: () => TOOL_LIST,
    callTool,
  };
}

/**
 * Re-export the tool list so callers (tests, other servers) can
 * enumerate the memory tool surface without instantiating an adapter.
 */
export function listMemoryToolShimTools(): readonly McpToolDefinition[] {
  return TOOL_LIST;
}
