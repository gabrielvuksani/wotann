/**
 * Tiered MCP tool loading — task-master pattern (Lane 2 #10).
 *
 * Every MCP tool an agent sees burns context tokens: the name, the
 * description, the JSON-schema for each field, the input/output examples.
 * Loading all 42+ WOTANN tools up-front costs ~8k tokens before the
 * agent has even read the prompt — on a 200k-context model that's
 * 4% of the budget permanently gone.
 *
 * task-master's fix is tiered loading:
 *   - core   (default) — 7 tools that cover the daily workflow
 *   - standard        — 14 tools for "common" ops
 *   - all             — 42+ tools when nothing less will do
 *
 * The tier is chosen by env var `WOTANN_MCP_TIER` so a user can flip
 * the knob without code changes:
 *
 *     WOTANN_MCP_TIER=core       # default
 *     WOTANN_MCP_TIER=standard
 *     WOTANN_MCP_TIER=all
 *
 * This module is the tier → ToolDefinition[] resolver. It does NOT own
 * the tool implementations — callers pass a full registry and this
 * module filters it by tier. Keeps the MCP server (src/mcp/mcp-server.ts)
 * agnostic of tiering; it just sees a pre-filtered list.
 */

import type { McpToolDefinition } from "./mcp-server.js";

// ── Types ──────────────────────────────────────────────

export type McpTier = "core" | "standard" | "all";

export interface TieredTool {
  readonly tool: McpToolDefinition;
  /**
   * Which tier this tool belongs to. Tier inheritance is explicit here:
   *   - "core"     → included in core, standard, and all
   *   - "standard" → included in standard and all
   *   - "all"      → included only in all
   */
  readonly tier: McpTier;
}

export interface LoadToolsOptions {
  /**
   * Tier selection. If omitted, falls back to `WOTANN_MCP_TIER` env
   * var, then to "core".
   */
  readonly tier?: McpTier;
  /**
   * Override the environment (test hook). Production callers should
   * leave this undefined so `process.env` is used.
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Explicit registry. When omitted we use `DEFAULT_TIERED_TOOLS`, the
   * canonical WOTANN tool taxonomy below.
   */
  readonly registry?: readonly TieredTool[];
}

export interface LoadToolsResult {
  readonly tier: McpTier;
  readonly tools: readonly McpToolDefinition[];
  /**
   * Approximate token count of the loaded tools' definitions, useful
   * for surfacing a "core saves ~7k tokens" hint in logs/UIs.
   */
  readonly approxTokens: number;
}

export const WOTANN_MCP_TIER_ENV = "WOTANN_MCP_TIER";

// ── Tier resolution ────────────────────────────────────

/**
 * Resolve the effective tier: explicit option → env var → default "core".
 * Unknown tier values log and fall back to "core" rather than throwing —
 * a mis-typed env var must not break the user's agent.
 */
export function resolveTier(opts: { tier?: McpTier; env?: NodeJS.ProcessEnv } = {}): McpTier {
  const explicit = opts.tier;
  if (explicit && isValidTier(explicit)) return explicit;
  const env = opts.env ?? process.env;
  const envTier = env[WOTANN_MCP_TIER_ENV];
  if (typeof envTier === "string" && isValidTier(envTier as McpTier)) {
    return envTier as McpTier;
  }
  return "core";
}

function isValidTier(tier: string): tier is McpTier {
  return tier === "core" || tier === "standard" || tier === "all";
}

// ── Tier filtering ─────────────────────────────────────

/**
 * Return the McpToolDefinition list for a tier. Callers plug this
 * into WotannMcpServer's ToolHostAdapter so the model only ever sees
 * the filtered surface.
 */
export function loadTools(
  tier: McpTier | undefined = undefined,
  env?: NodeJS.ProcessEnv,
): LoadToolsResult {
  return loadToolsWithOptions({ tier, env });
}

/**
 * Richer variant: accepts a custom registry (dependency injection for
 * tests and downstream packages).
 */
export function loadToolsWithOptions(opts: LoadToolsOptions = {}): LoadToolsResult {
  const tier = resolveTier(opts);
  const registry = opts.registry ?? DEFAULT_TIERED_TOOLS;
  const filtered = filterByTier(registry, tier).map((t) => t.tool);
  return {
    tier,
    tools: filtered,
    approxTokens: estimateTokenCost(filtered),
  };
}

/**
 * Return a flat list of tool names in a tier — useful for the
 * `wotann mcp-tools` CLI command and log lines.
 */
export function listToolNamesForTier(
  tier: McpTier,
  registry: readonly TieredTool[] = DEFAULT_TIERED_TOOLS,
): readonly string[] {
  return filterByTier(registry, tier).map((t) => t.tool.name);
}

/**
 * Pure filter: given a registry and a tier, return the tools that
 * belong to (or "inherit" into) that tier.
 */
export function filterByTier(
  registry: readonly TieredTool[],
  tier: McpTier,
): readonly TieredTool[] {
  const rank: Record<McpTier, number> = { core: 0, standard: 1, all: 2 };
  const target = rank[tier];
  return registry.filter((t) => rank[t.tier] <= target);
}

// ── Default WOTANN tool registry ───────────────────────

/**
 * Canonical WOTANN tool taxonomy. Each entry is { tool, tier }. The
 * tiers follow task-master's model:
 *   - core   (7)  — everyday agent workflow, cheap to load
 *   - standard (7 more, 14 total) — analysis + authoring
 *   - all    (42+) — full WOTANN surface: orchestration, memory,
 *                    skills, computer-use, telemetry, marketplace
 *
 * These are placeholders that mirror the WOTANN feature names. Actual
 * implementations live behind the ToolHostAdapter in src/mcp/mcp-server.ts
 * — this module only declares the SURFACE so the agent sees a small
 * surface by default.
 */
export const DEFAULT_TIERED_TOOLS: readonly TieredTool[] = [
  // ─── CORE (7) ────────────────────────────────────────
  {
    tier: "core",
    tool: {
      name: "memory_search",
      description: "Search persistent memory for prior decisions and knowledge.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    tier: "core",
    tool: {
      name: "memory_save",
      description: "Save a durable decision, bug fix, or discovery to memory.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          topic_key: { type: "string" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    tier: "core",
    tool: {
      name: "find_symbol",
      description: "Find a function/class/symbol by name across the repo.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, path: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    tier: "core",
    tool: {
      name: "run_workflow",
      description: "Run a saved WOTANN workflow (wave, plan, or graph).",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    tier: "core",
    tool: {
      name: "unified_exec",
      description: "Stateful shell session with cwd + env carried across calls.",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" }, session_id: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    tier: "core",
    tool: {
      name: "read_file",
      description: "Read a file from the virtual-paths workspace.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    tier: "core",
    tool: {
      name: "write_file",
      description: "Write a file to the virtual-paths workspace.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },

  // ─── STANDARD — 7 more, 14 total ─────────────────────
  {
    tier: "standard",
    tool: {
      name: "plan_create",
      description: "Create a multi-step plan with tasks and dependencies.",
      inputSchema: {
        type: "object",
        properties: { goal: { type: "string" } },
        required: ["goal"],
      },
    },
  },
  {
    tier: "standard",
    tool: {
      name: "plan_next",
      description: "Get the next task in an active plan.",
      inputSchema: {
        type: "object",
        properties: { plan_id: { type: "string" } },
        required: ["plan_id"],
      },
    },
  },
  {
    tier: "standard",
    tool: {
      name: "plan_update",
      description: "Update a task's status, notes, or dependencies.",
      inputSchema: {
        type: "object",
        properties: {
          plan_id: { type: "string" },
          task_id: { type: "string" },
          status: { type: "string" },
        },
        required: ["plan_id", "task_id"],
      },
    },
  },
  {
    tier: "standard",
    tool: {
      name: "search_code",
      description: "Regex/semantic code search across the workspace.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, path: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    tier: "standard",
    tool: {
      name: "edit_file",
      description: "Apply a targeted edit to a file — preferred over write_file for changes.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          old: { type: "string" },
          new: { type: "string" },
        },
        required: ["path", "old", "new"],
      },
    },
  },
  {
    tier: "standard",
    tool: {
      name: "skill_run",
      description: "Invoke a named WOTANN skill.",
      inputSchema: {
        type: "object",
        properties: { skill: { type: "string" }, args: { type: "object" } },
        required: ["skill"],
      },
    },
  },
  {
    tier: "standard",
    tool: {
      name: "list_files",
      description: "List files in a directory under the virtual-paths workspace.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },

  // ─── ALL — 28 more, 42 total ─────────────────────────
  tool("all", "lsp_rename", "Rename a symbol across the project via LSP.", {
    symbol: "string",
    new_name: "string",
  }),
  tool("all", "lsp_references", "Find all references of a symbol via LSP.", {
    symbol: "string",
  }),
  tool("all", "lsp_definition", "Jump to a symbol's definition via LSP.", { symbol: "string" }),
  tool("all", "lsp_hover", "Fetch inline documentation for a symbol.", { symbol: "string" }),
  tool("all", "git_status", "Show current git status.", {}),
  tool("all", "git_diff", "Show git diff for the working tree.", { path: "string" }),
  tool("all", "git_commit", "Stage + commit with a message.", { message: "string" }),
  tool("all", "git_log", "Show recent git commits.", { limit: "number" }),
  tool("all", "git_blame", "Show blame annotations for a file.", { path: "string" }),
  tool("all", "orchestrator_delegate", "Delegate a subtask to another agent.", {
    agent: "string",
    task: "string",
  }),
  tool("all", "orchestrator_status", "Inspect the orchestrator's agent graph.", {}),
  tool("all", "computer_use_screenshot", "Capture the user's screen.", {}),
  tool("all", "computer_use_click", "Click at a screen coordinate.", {
    x: "number",
    y: "number",
  }),
  tool("all", "computer_use_type", "Type a string at the cursor.", { text: "string" }),
  tool("all", "browser_navigate", "Navigate the embedded browser.", { url: "string" }),
  tool("all", "browser_click", "Click a selector in the embedded browser.", {
    selector: "string",
  }),
  tool("all", "telemetry_cost", "Report current session cost + token usage.", {}),
  tool("all", "telemetry_audit", "Show recent audit trail entries.", { limit: "number" }),
  tool("all", "marketplace_list", "List skills available on the WOTANN marketplace.", {}),
  tool("all", "marketplace_install", "Install a marketplace skill.", { id: "string" }),
  tool("all", "channel_send", "Send a message via a named channel.", {
    channel: "string",
    body: "string",
  }),
  tool("all", "channel_list", "List configured channel adapters.", {}),
  tool("all", "voice_transcribe", "Transcribe an audio clip to text.", { audio_path: "string" }),
  tool("all", "voice_speak", "Synthesize text to speech.", { text: "string" }),
  tool("all", "learning_replay", "Replay a saved learning episode.", { episode_id: "string" }),
  tool("all", "learning_diary", "Write to today's learning diary.", { note: "string" }),
  tool("all", "identity_set", "Switch active persona/identity.", { name: "string" }),
  tool("all", "desktop_control_focus", "Focus a desktop window by title.", { title: "string" }),
];

// ── Token estimation ───────────────────────────────────

/**
 * Rough token estimate — JSON.stringify length / 4 is the Anthropic
 * rule-of-thumb for English text. MCP tool definitions are mostly
 * English + punctuation so the approximation holds within ~15%.
 */
export function estimateTokenCost(tools: readonly McpToolDefinition[]): number {
  if (tools.length === 0) return 0;
  let total = 0;
  for (const t of tools) {
    total += Math.ceil(JSON.stringify(t).length / 4);
  }
  return total;
}

// ── Internal helpers ───────────────────────────────────

/**
 * Shorthand builder — produces the full TieredTool shape for the "all"
 * tier without the boilerplate of repeating the inputSchema scaffold
 * 28 times. Keeps the registry scannable.
 */
function tool(
  tier: McpTier,
  name: string,
  description: string,
  props: Record<string, "string" | "number" | "object">,
): TieredTool {
  const properties: Record<string, { type: string }> = {};
  for (const [k, v] of Object.entries(props)) {
    properties[k] = { type: v };
  }
  return {
    tier,
    tool: {
      name,
      description,
      inputSchema: {
        type: "object",
        properties,
      },
    },
  };
}
