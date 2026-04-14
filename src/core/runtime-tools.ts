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

  // plan tools: only when PlanStore is available
  if (deps.planStoreAvailable) {
    tools.push(buildPlanCreateTool(), buildPlanListTool(), buildPlanAdvanceTool());
  }

  return tools;
}
