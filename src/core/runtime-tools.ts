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
import {
  buildLspTools,
  AGENT_LSP_TOOL_NAMES,
  type BuiltLspTools,
  type LspToolDeps,
} from "../lsp/agent-tools.js";
import { LanguageServerRegistry } from "../lsp/server-registry.js";
import type { SymbolOperations } from "../lsp/symbol-operations.js";
import {
  buildConnectorToolDefinitions,
  CONNECTOR_TOOL_NAMES,
  isConnectorTool,
  type ConnectorToolName,
} from "../connectors/connector-tools.js";
import {
  buildBrowserToolDefinitions,
  BROWSER_TOOL_NAMES,
  isBrowserTool,
  type BrowserToolName,
} from "../browser/browser-tools.js";

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
  /** Whether connector tools (jira/linear/notion/confluence/drive/slack) should be
   *  registered. Wave-4C: advertises the 34-tool surface to the model; each
   *  individual call still capability-gates on the connector registry at
   *  dispatch time — an unconfigured connector returns a honest
   *  `{ok:false, error:"not_configured", fix:...}` envelope. */
  readonly connectorToolsEnabled?: boolean;
  /** Whether browser tools (goto/click/type/screenshot/read_page) should be
   *  registered. Wave-5 completion: advertises the 5-tool surface backed by
   *  Chrome CDP bridge with Camoufox fallback. Each call capability-gates at
   *  dispatch time — if neither backend is reachable the dispatcher returns a
   *  honest `{ok:false, error:"not_configured"}` envelope. */
  readonly browserToolsEnabled?: boolean;
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
 * Build the terminal_run tool definition (T12.2 — Terminus-KIRA port).
 * Wraps `runTerminal` from `src/cli/tricks/terminal-run.ts` so the agent
 * can shell out via execFile (no shell, no injection surface) and receive
 * a structured `{ok, exitCode, stdout, stderr, durationMs}` envelope.
 *
 * Why surface this when `monitor` already exists? `monitor` is for
 * long-running streaming processes; `terminal_run` is for one-shot
 * commands where the agent wants the full captured stdout/stderr in a
 * single envelope — e.g., `git status`, `npm run typecheck`, `which python3`.
 * The argv form is enforced by the schema so the model can't accidentally
 * shell-interpolate user input.
 */
function buildTerminalRunTool(): ToolDefinition {
  return {
    name: "terminal_run",
    description:
      "Execute a one-shot terminal command via execFile (no shell). Returns " +
      "a structured `{ok, exitCode, stdout, stderr, durationMs}` envelope; never throws. " +
      "Pass argv as an array (first element is the executable, rest are arguments) — " +
      "shell interpolation is structurally impossible. Use for short commands like " +
      "`git status`, `npm run typecheck`, `which python3`. For long-running streaming " +
      "processes (tail logs, watch tests), prefer the `monitor` tool instead.",
    inputSchema: {
      type: "object",
      properties: {
        argv: {
          type: "array",
          items: { type: "string" },
          description:
            "Subprocess argv. First element is the executable, rest are arguments. " +
            "Each element is passed verbatim — never re-parsed by a shell.",
        },
        timeoutMs: {
          type: "number",
          description:
            "Optional wall-clock cap in milliseconds. Reserved for future enhancement; " +
            "currently advisory.",
        },
      },
      required: ["argv"],
    },
  };
}

/**
 * Build the image_read tool definition (T12.2 — Terminus-KIRA port).
 * Wraps `readImage` from `src/cli/tricks/image-read.ts` so the agent can
 * load a PNG/JPEG/GIF/WEBP from disk and receive a base64 + mimeType
 * envelope ready for vision-model consumption. Unlocks visual UI
 * workflows (vim screenshots, matplotlib plots, tmux pane captures).
 */
function buildImageReadTool(): ToolDefinition {
  return {
    name: "image_read",
    description:
      "Read an image file from disk and return base64 + mimeType for vision-model " +
      "consumption. Supports PNG, JPEG, GIF, WEBP. Returns " +
      "`{ok:true, base64, mimeType, byteLength}` on success or `{ok:false, error}` " +
      "on missing file, unsupported extension, or read failure. Use to feed " +
      "screenshots, plots, or terminal captures into the next vision turn.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the image file on disk.",
        },
      },
      required: ["path"],
    },
  };
}

/**
 * Build the tmux_pull tool definition (T12.2 — Terminus-KIRA port).
 * Wraps `tmuxPull` from `src/cli/tricks/tmux-pull.ts` so the agent can
 * inspect a long-running tmux session's recent pane content via
 * `tmux capture-pane -pJ -S -<lines>`. Honest-failure posture: when
 * tmux is missing, no server is running, or the named session doesn't
 * exist, returns `{ok:false, reason:...}` — never silent success.
 */
function buildTmuxPullTool(): ToolDefinition {
  return {
    name: "tmux_pull",
    description:
      "Pull recent pane content from a named tmux session via `tmux capture-pane`. " +
      "Used to inspect long-running background sessions (builds, daemons, REPLs) " +
      "kept alive across turns. Returns `{ok:true, content, lines, session}` on " +
      "success or `{ok:false, reason}` when tmux is missing, no server is running, " +
      "or the session doesn't exist. Defaults to 200 lines from the bottom of the " +
      "scrollback; cap is 100,000.",
    inputSchema: {
      type: "object",
      properties: {
        session: {
          type: "string",
          description: "Target tmux session name (must exist).",
        },
        lines: {
          type: "number",
          description:
            "Number of lines from the bottom of the scrollback to capture. " +
            "Default 200, capped at 100000.",
        },
        pane: {
          type: "string",
          description:
            "Optional pane id (e.g. `0.0`, `myssn:0.1`). When omitted, tmux uses " +
            "the active pane of the session.",
        },
        tmuxBin: {
          type: "string",
          description:
            "Optional override for the tmux binary path. Defaults to `tmux` " +
            "resolved via $PATH in the child process.",
        },
      },
      required: ["session"],
    },
  };
}

/**
 * Build the parallel_search tool definition (T12.3 — WarpGrep wrapper).
 * Fans a list of queries out across the parallel-search primitive
 * (codebase / memory / docs / git / file-content) with hard budgets so
 * the model can ask multi-hypothesis questions without starving the
 * event loop. Returns a ranked SearchHit[] envelope; honest-failure
 * posture (ok:false on bad input, no throws into dispatch).
 */
function buildParallelSearchTool(): ToolDefinition {
  return {
    name: "parallel_search",
    description:
      "Run up to 8 search queries in parallel across codebase, docs, " +
      "memory, git history, and file content. Returns a deduplicated, " +
      "score-ranked SearchHit[] capped at 200 hits / 30KB / 3000ms. " +
      "Use when investigating multi-hypothesis questions (e.g. 'find " +
      "every place X is wired AND every place Y is configured AND every " +
      "test that exercises Z') — much faster than sequential greps. " +
      "Returns `{ok:true, hits, totalHits, truncated, durationMs}` on " +
      "success or `{ok:false, reason, error}` on bad input.",
    inputSchema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description:
            "Non-empty list of search queries. Each query fans out across " +
            "every active source. Empty strings are dropped. Capped at 8 " +
            "queries per call — additional queries are silently truncated.",
        },
        sources: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "codebase",
              "memory",
              "web",
              "academic",
              "documentation",
              "git-history",
              "file-content",
            ],
          },
          description:
            "Optional restriction to a subset of search sources. " + "Default: every source.",
        },
        maxHits: {
          type: "number",
          description: "Optional override of the 200-hit cap. Hard ceiling: 200.",
        },
        maxWallclockMs: {
          type: "number",
          description:
            "Optional override of the 3000ms wall-clock budget. " +
            "Hard ceiling: 3000ms — requests above the ceiling are clamped.",
        },
      },
      required: ["queries"],
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
  "terminal_run",
  "image_read",
  "tmux_pull",
  "parallel_search",
] as const;

export type RuntimeToolName = (typeof RUNTIME_TOOL_NAMES)[number];

/**
 * Check whether a tool name is a runtime-handled tool (includes the
 * 34-tool connector surface registered by `buildConnectorTools`).
 */
export function isRuntimeTool(
  name: string,
): name is RuntimeToolName | ConnectorToolName | BrowserToolName {
  return (
    (RUNTIME_TOOL_NAMES as readonly string[]).includes(name) ||
    isConnectorTool(name) ||
    isBrowserTool(name)
  );
}

/**
 * Wave-4C entry point — returns the full connector-tool definition list
 * (34 tools covering BOTH read and write paths for jira / linear / notion /
 * confluence / google-drive / slack: 6+6+6+5+5+6). The runtime appends
 * these to `effectiveTools` so the model can discover the surface; each
 * call capability-gates at dispatch time with an honest `not_configured`
 * envelope when auth is missing.
 */
export function buildConnectorTools(): readonly ToolDefinition[] {
  return buildConnectorToolDefinitions();
}

export { CONNECTOR_TOOL_NAMES, isConnectorTool };
export type { ConnectorToolName };

/**
 * Wave-5 entry point — returns the full browser-tool definition list (5 tools:
 * goto/click/type/screenshot/read_page). Backends are Chrome CDP bridge
 * (preferred) and Camoufox stealth browser (fallback). Registration advertises
 * the surface; dispatch gates on reachability and honest-refuses when neither
 * backend is up.
 */
export function buildBrowserTools(): readonly ToolDefinition[] {
  return buildBrowserToolDefinitions();
}

export { BROWSER_TOOL_NAMES, isBrowserTool };
export type { BrowserToolName };

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

  // T12.2 Terminus-KIRA tricks: terminal_run / image_read / tmux_pull.
  // Always registered — the underlying modules are pure I/O wrappers
  // (`runTerminal` shells via execFile, `readImage` reads a file, `tmuxPull`
  // shells via execFile). Each returns an honest envelope; a missing tmux
  // binary surfaces as `{ok:false, reason:...}` rather than a runtime throw.
  tools.push(buildTerminalRunTool(), buildImageReadTool(), buildTmuxPullTool());

  // T12.3 parallel_search: WarpGrep multi-query wrapper around the
  // ParallelSearchDispatcher primitive. Always registered — the
  // dispatcher reads from disk + git, never writes, and is bounded by a
  // 3000ms wallclock + 200-hit + 30KB output cap inside the agent
  // wrapper, so registering unconditionally is safe.
  tools.push(buildParallelSearchTool());

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

  // Wave-4C connector tools: registered by default. Each call is
  // capability-gated at dispatch time via `dispatchConnectorTool`, so an
  // agent on a machine without any connectors configured sees the tool
  // advertised but calling it returns a honest `not_configured` envelope
  // with a `fix` pointing at the right env var.
  if (deps.connectorToolsEnabled !== false) {
    for (const t of buildConnectorTools()) tools.push(t);
  }

  // Wave-5 browser tools: registered by default. Dispatch picks Chrome CDP
  // when available, else Camoufox when the Python driver boots, else returns
  // honest `not_configured`. Opt-out via browserToolsEnabled:false for
  // minimal deployments (TUI-only, headless CI).
  if (deps.browserToolsEnabled !== false) {
    for (const t of buildBrowserTools()) tools.push(t);
  }

  return tools;
}

/**
 * Serena-parity LSP tool builder — Session-13 wiring for
 * `src/lsp/agent-tools.ts` + `src/lsp/server-registry.ts`. Constructs a
 * `BuiltLspTools` bundle (6 tools: find_symbol, find_references,
 * rename_symbol, hover, definition, document_symbols) with a per-runtime
 * `LanguageServerRegistry`. The runtime wires this into tool dispatch so
 * the model can reach multi-language LSPs with honest
 * `lsp_not_installed` errors instead of silent fallback.
 *
 * Returns null if `ops` is unavailable; callers should guard accordingly.
 */
export function buildLspToolsForAgent(
  ops: SymbolOperations | null,
  registry?: LanguageServerRegistry,
): BuiltLspTools | null {
  if (!ops) return null;
  const deps: LspToolDeps = {
    ops,
    registry: registry ?? new LanguageServerRegistry(),
  };
  return buildLspTools(deps);
}

export { AGENT_LSP_TOOL_NAMES };
