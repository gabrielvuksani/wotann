/**
 * Runtime Tool Registry -- Tool registration for WotannRuntime.
 * Extracted from runtime.ts to reduce God Object size.
 *
 * Provides `buildEffectiveTools()` which assembles the full tool list
 * for a query by combining base tools with runtime-injected tools
 * (computer_use, web_fetch, plan_*).
 *
 * runtime.ts can import and delegate to this module in a future refactor.
 */

import type { ToolDefinition } from "./types.js";

// ── Dependency Interfaces ───────────────────────────────────
// Narrow interfaces so this module doesn't pull in concrete classes.

export interface ToolRegistryDeps {
  /** Whether the computer_use desktop-control tool should be registered. */
  readonly computerUseEnabled: boolean;
  /** Whether plan tools should be registered (true when PlanStore is available). */
  readonly planStoreAvailable: boolean;
  /** Whether LSP symbol tools should be registered (true when LSPManager
   *  is available — usually always true; set false to suppress in minimal
   *  deployments). Session-10 Serena port. */
  readonly lspEnabled?: boolean;
}

// ── Tool Definition Builders ────────────────────────────────

/**
 * Build the computer_use tool definition.
 * Registered unconditionally in the current runtime (gated by provider capability at dispatch time).
 */
function buildComputerUseTool(): ToolDefinition {
  return {
    name: "computer_use",
    description:
      "Control the desktop screen -- take screenshots, click, type, read UI elements. " +
      "Use when you need to interact with GUI applications.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["screenshot", "click", "type", "read_screen"],
          description: "The action to perform",
        },
        x: { type: "number", description: "X coordinate for click" },
        y: { type: "number", description: "Y coordinate for click" },
        text: { type: "string", description: "Text to type" },
      },
      required: ["action"],
    },
  };
}

/**
 * Build the web_fetch tool definition.
 * Always registered -- the runtime handles execution via WebFetchTool.
 */
function buildWebFetchTool(): ToolDefinition {
  return {
    name: "web_fetch",
    description:
      "Fetch a URL and return its text content (HTML stripped). " +
      "Use for documentation, APIs, or web research.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        maxLength: {
          type: "number",
          description: "Max characters to return (default 10000)",
        },
      },
      required: ["url"],
    },
  };
}

/**
 * Build the plan_create tool definition.
 */
function buildPlanCreateTool(): ToolDefinition {
  return {
    name: "plan_create",
    description: "Create a task plan with title and optional description",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Plan title" },
        description: { type: "string", description: "Plan description" },
      },
      required: ["title"],
    },
  };
}

/**
 * Build the plan_list tool definition.
 */
function buildPlanListTool(): ToolDefinition {
  return {
    name: "plan_list",
    description: "List all active plans with their progress",
    inputSchema: { type: "object", properties: {} },
  };
}

/**
 * Build the plan_advance tool definition.
 */
function buildPlanAdvanceTool(): ToolDefinition {
  return {
    name: "plan_advance",
    description: "Mark the next task in a plan as complete",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "The plan ID to advance" },
      },
      required: ["planId"],
    },
  };
}

/**
 * Build the monitor tool definition (Session-6 Claude Code v2.1.98 port).
 * Wraps a long-running child process so every stdout/stderr line becomes
 * a discrete transcript event — avoids the sleep-poll loops that make
 * agents feel sluggish. TerminalBench "no sleep-poll" gap closure.
 *
 * Streaming contract: the runtime emits one text chunk per stdout/stderr
 * line as events arrive, then a final `{exitCode, signal, totalDurationMs}`
 * summary when the process terminates. The `maxDurationMs` cap is honoured
 * by `spawnMonitor()` itself (SIGTERM on timeout); we surface it through
 * the schema so the model can request a tight budget for fast tasks.
 */
function buildMonitorTool(): ToolDefinition {
  return {
    name: "monitor",
    description:
      "Spawn a command and stream its stdout/stderr lines as discrete events. " +
      "Use for long-running processes (tail logs, watch tests, follow a dev server, " +
      "babysit CI) instead of sleeping and polling. Terminates when the process exits " +
      "or when `maxDurationMs` elapses (whichever comes first). Returns one event per " +
      "line plus a final exit summary with exitCode, signal, and totalDurationMs.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Executable to spawn (e.g. `npm`, `tail`, `node`).",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Positional arguments passed to the command.",
        },
        cwd: {
          type: "string",
          description: "Working directory for the child process (defaults to runtime cwd).",
        },
        maxDurationMs: {
          type: "number",
          description:
            "Wall-clock cap in milliseconds. 0 or omitted = unlimited. The runtime " +
            "enforces its own 10-minute ceiling so runaway monitors cannot stall a session.",
        },
      },
      required: ["command"],
    },
  };
}

/**
 * Build the find_symbol tool definition (Serena port).
 * Exposes workspace-wide symbol search as a first-class agent tool so
 * the model can target by name rather than reading whole files.
 */
function buildFindSymbolTool(): ToolDefinition {
  return {
    name: "find_symbol",
    description:
      "Find a symbol (function/class/method/variable) by name in the workspace. " +
      "Returns matching definitions with file path and range. Vastly cheaper " +
      "than reading files to locate symbols. Use before read_file for precision.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Symbol name (exact match preferred)" },
      },
      required: ["name"],
    },
  };
}

/**
 * Build the find_references tool definition (Serena port).
 * Lists every caller / user of a symbol across the workspace.
 */
function buildFindReferencesTool(): ToolDefinition {
  return {
    name: "find_references",
    description:
      "Find every location in the workspace that references the symbol at the " +
      "given file/position. Returns an array of (uri, range) tuples. Use before " +
      "modifying a function signature to understand its blast radius.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "File URI containing the symbol" },
        line: { type: "number", description: "0-indexed line number" },
        character: { type: "number", description: "0-indexed column" },
      },
      required: ["uri", "line", "character"],
    },
  };
}

/**
 * Build the rename_symbol tool definition (Serena port).
 * Applies a rename refactor across every reference atomically.
 */
function buildRenameSymbolTool(): ToolDefinition {
  return {
    name: "rename_symbol",
    description:
      "Rename a symbol across every reference in the workspace atomically. " +
      "Safer than search-and-replace because it uses TypeScript's LanguageService " +
      "to find bindings (not text matches). Returns the number of edits applied.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "File URI containing the symbol declaration" },
        line: { type: "number", description: "0-indexed declaration line" },
        character: { type: "number", description: "0-indexed declaration column" },
        newName: { type: "string", description: "New symbol name (must be a valid identifier)" },
      },
      required: ["uri", "line", "character", "newName"],
    },
  };
}

// ── Public API ──────────────────────────────────────────────

/**
 * All runtime-injected tool names. Used by dispatch to identify
 * tools that the runtime handles directly (vs. provider-handled).
 */
export const RUNTIME_TOOL_NAMES = [
  "computer_use",
  "web_fetch",
  "plan_create",
  "plan_list",
  "plan_advance",
  "find_symbol",
  "find_references",
  "rename_symbol",
  "monitor",
] as const;

export type RuntimeToolName = (typeof RUNTIME_TOOL_NAMES)[number];

/**
 * Check whether a tool name is a runtime-handled tool.
 */
export function isRuntimeTool(name: string): name is RuntimeToolName {
  return (RUNTIME_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Build the effective tool list for a query.
 *
 * Combines caller-provided base tools with runtime-injected tools
 * (computer_use, web_fetch, plan_*). The returned array is a new
 * array -- baseTools is not mutated.
 */
export function buildEffectiveTools(
  baseTools: readonly ToolDefinition[],
  deps: ToolRegistryDeps,
): readonly ToolDefinition[] {
  const tools: ToolDefinition[] = [...baseTools];

  // computer_use: always registered (gated by provider at dispatch)
  if (deps.computerUseEnabled) {
    tools.push(buildComputerUseTool());
  }

  // web_fetch: always registered
  tools.push(buildWebFetchTool());

  // monitor: always registered. The spawn() syscall is gated by the
  // sandbox permission layer at dispatch time — registration here only
  // advertises the tool to the model.
  tools.push(buildMonitorTool());

  // plan tools: only when PlanStore is available
  if (deps.planStoreAvailable) {
    tools.push(buildPlanCreateTool(), buildPlanListTool(), buildPlanAdvanceTool());
  }

  // Serena-style symbol tools: registered by default unless explicitly
  // suppressed. The LSPManager lives on the runtime and lazy-inits a
  // TypeScript LanguageService on first use, so registering these tools
  // unconditionally is cheap when the model doesn't call them.
  if (deps.lspEnabled !== false) {
    tools.push(buildFindSymbolTool(), buildFindReferencesTool(), buildRenameSymbolTool());
  }

  return tools;
}
