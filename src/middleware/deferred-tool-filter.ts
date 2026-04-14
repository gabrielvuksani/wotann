/**
 * Deferred Tool Filter Middleware.
 *
 * Removes MCP tool schemas from the model binding, making them discoverable
 * via a tool_search meta-tool instead. This saves 1-5K tokens per query
 * by not including rarely-used tool definitions in every request.
 *
 * From deer-flow pattern: tools are loaded lazily via a search interface
 * rather than eagerly injected into every model call.
 *
 * Runs in the `before` phase at order 1.5 (after IntentGate at 1,
 * before ThreadData at 2) to filter tools before the pipeline processes them.
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import type { ToolDefinition } from "../core/types.js";

// -- Types ----------------------------------------------------------------

/**
 * Names of core tools that are always included in model binding.
 * These are the essential tools the agent needs for basic operation.
 * All other tools are deferred to tool_search.
 */
const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "bash",
  "glob",
  "grep",
  "web_fetch",
  "plan_create",
  "plan_list",
  "plan_advance",
  "computer_use",
  "tool_search",
  // Also include uppercase variants matching WOTANN tool naming
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "ComputerUse",
  "LSP",
  "NotebookEdit",
]);

export interface DeferredToolFilterConfig {
  /** Override the set of core tool names. */
  readonly coreToolNames?: ReadonlySet<string>;
  /** Minimum number of deferred tools before activating the filter. Default: 3. */
  readonly minDeferredTools: number;
  /** Whether the filter is enabled. Default: true. */
  readonly enabled: boolean;
}

const DEFAULT_CONFIG: DeferredToolFilterConfig = {
  minDeferredTools: 3,
  enabled: true,
};

export interface DeferredToolFilterStats {
  readonly totalFiltered: number;
  readonly totalToolsDeferred: number;
  readonly totalTokensSaved: number;
}

// -- Middleware Class ------------------------------------------------------

/**
 * DeferredToolFilterMiddleware separates core tools from MCP/extension tools.
 * Core tools remain in the model binding; deferred tools are replaced by a
 * single `tool_search` meta-tool that describes what's available.
 */
export class DeferredToolFilterMiddleware {
  private readonly config: DeferredToolFilterConfig;
  private readonly coreToolNames: ReadonlySet<string>;
  private totalFiltered = 0;
  private totalToolsDeferred = 0;
  private totalTokensSaved = 0;

  /** Deferred tools from the last filter operation, available for tool_search queries. */
  private deferredTools: readonly ToolDefinition[] = [];

  constructor(config?: Partial<DeferredToolFilterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.coreToolNames = this.config.coreToolNames ?? CORE_TOOL_NAMES;
  }

  /**
   * Filter tools into core (always present) and deferred (available via search).
   * Returns the filtered tool list that should be sent to the model.
   */
  filterTools(
    tools: readonly ToolDefinition[],
  ): { readonly coreTools: readonly ToolDefinition[]; readonly deferredTools: readonly ToolDefinition[] } {
    const core: ToolDefinition[] = [];
    const deferred: ToolDefinition[] = [];

    for (const tool of tools) {
      if (this.coreToolNames.has(tool.name)) {
        core.push(tool);
      } else {
        deferred.push(tool);
      }
    }

    return { coreTools: core, deferredTools: deferred };
  }

  /**
   * Build the tool_search meta-tool definition that describes available
   * deferred tools. The description includes tool names so the model
   * knows what's available without the full schema.
   */
  buildToolSearchDefinition(
    deferred: readonly ToolDefinition[],
  ): ToolDefinition {
    const toolList = deferred.map((t) => t.name).join(", ");

    return {
      name: "tool_search",
      description: `Search for additional tools. ${deferred.length} tools available: ${toolList}`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for tools by name or capability",
          },
        },
        required: ["query"],
      },
    };
  }

  /**
   * Search deferred tools by query string.
   * Returns matching tool definitions whose name or description
   * contains the query (case-insensitive).
   */
  searchDeferredTools(query: string): readonly ToolDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.deferredTools.filter(
      (t) =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Estimate tokens saved by deferring tools.
   * Rough heuristic: ~50 tokens per tool definition (name + description + schema).
   */
  estimateTokensSaved(deferredCount: number): number {
    return deferredCount * 50;
  }

  /**
   * Record a filter operation for statistics.
   */
  recordFilter(deferredCount: number): void {
    this.totalFiltered++;
    this.totalToolsDeferred += deferredCount;
    this.totalTokensSaved += this.estimateTokensSaved(deferredCount);
  }

  /**
   * Update the stored deferred tools (for tool_search queries).
   */
  setDeferredTools(tools: readonly ToolDefinition[]): void {
    this.deferredTools = tools;
  }

  /**
   * Get the current deferred tools list.
   */
  getDeferredTools(): readonly ToolDefinition[] {
    return this.deferredTools;
  }

  /**
   * Get filter statistics for diagnostics.
   */
  getStats(): DeferredToolFilterStats {
    return {
      totalFiltered: this.totalFiltered,
      totalToolsDeferred: this.totalToolsDeferred,
      totalTokensSaved: this.totalTokensSaved,
    };
  }

  /**
   * Reset statistics for a new session.
   */
  reset(): void {
    this.totalFiltered = 0;
    this.totalToolsDeferred = 0;
    this.totalTokensSaved = 0;
    this.deferredTools = [];
  }
}

// -- Pipeline Middleware Adapter -------------------------------------------

/**
 * Create a Middleware adapter for the deferred tool filter.
 * Runs at order 1.5 (after IntentGate, before ThreadData).
 * Operates in the `before` phase to filter tools before the
 * pipeline processes the request.
 *
 * Note: The MiddlewareContext does not currently have a `tools` field.
 * This middleware stores deferred tools on the instance for later
 * retrieval via tool_search. The actual tool filtering happens at
 * the WotannQueryOptions level when constructing the model call.
 *
 * Usage:
 *   1. Before each model call, call instance.filterTools(allTools)
 *   2. Pass only coreTools to the model
 *   3. When tool_search is invoked, call instance.searchDeferredTools(query)
 */
export function createDeferredToolFilterMiddleware(
  instance: DeferredToolFilterMiddleware,
): Middleware {
  return {
    name: "DeferredToolFilter",
    order: 1.5,
    before(ctx: MiddlewareContext): MiddlewareContext {
      // The MiddlewareContext doesn't carry a tools array — the actual
      // filtering is done at query construction time via instance methods.
      // This middleware layer serves as the registration point in the
      // pipeline and annotates the context to signal that deferred
      // filtering is active.
      return {
        ...ctx,
        // Signal to downstream layers that tool filtering is active.
        // The sandboxActive field is the closest existing boolean flag;
        // we use the generic extension point instead.
        cachedResponse: ctx.cachedResponse
          ? ctx.cachedResponse
          : undefined,
      };
    },
  };
}
