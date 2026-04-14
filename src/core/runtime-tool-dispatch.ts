/**
 * Runtime Tool Dispatch -- Execution handlers for runtime-injected tools.
 * Extracted from runtime.ts to reduce God Object size.
 *
 * Each handler receives the tool input and its dependencies, executes
 * the tool, and returns a result suitable for yielding back into the
 * streaming response. Errors are caught and returned as error results
 * rather than thrown.
 *
 * runtime.ts can import and delegate to this module in a future refactor.
 */

import type { ProviderName, AgentMessage } from "./types.js";
import type { WebFetchResult } from "../tools/web-fetch.js";

// ── Tool Timing Tracker ─────────────────────────────────────

/**
 * Tracks per-tool start times so `tool_result` messages can be annotated
 * with completion timing. The model uses this signal to reason about
 * slow tools and adapt its strategy (e.g., prefer cached results, skip
 * expensive secondary calls).
 *
 * Keyed by tool_use_id (or tool name when id is unavailable).
 */
export class ToolTimingTracker {
  private readonly starts: Map<string, { readonly toolName: string; readonly startedAt: number }> = new Map();
  /** Completed timings, retained until a tool_result is annotated. */
  private readonly completions: Map<string, { readonly toolName: string; readonly durationMs: number }> = new Map();

  /** Record that a tool call started. */
  markStart(key: string, toolName: string): void {
    this.starts.set(key, { toolName, startedAt: Date.now() });
  }

  /** Record that a tool call completed; stores the duration for later annotation. */
  markEnd(key: string, toolName?: string, explicitDurationMs?: number): number {
    const start = this.starts.get(key);
    const durationMs = explicitDurationMs ?? (start ? Date.now() - start.startedAt : 0);
    const name = toolName ?? start?.toolName ?? "unknown";
    this.completions.set(key, { toolName: name, durationMs });
    this.starts.delete(key);
    return durationMs;
  }

  /** Look up the recorded duration for a tool call key, if any. */
  get(key: string): { readonly toolName: string; readonly durationMs: number } | undefined {
    return this.completions.get(key);
  }

  /** Remove a recorded timing (call after annotation is applied). */
  consume(key: string): void {
    this.completions.delete(key);
  }

  /** Reset all tracked timings. Useful at query boundaries. */
  reset(): void {
    this.starts.clear();
    this.completions.clear();
  }
}

/**
 * Build the tool-timing suffix to append to a tool_result content payload.
 * Matches the format `[tool: <name> completed in <N>ms]` so the model can
 * reason about slow tools and adapt its strategy.
 */
export function formatToolTimingAnnotation(toolName: string, durationMs: number): string {
  const n = Math.max(0, Math.round(durationMs));
  return `\n\n[tool: ${toolName} completed in ${n}ms]`;
}

/**
 * Append a tool-timing annotation to a tool_result message's content.
 * Returns a new message (immutable) with the suffix appended.
 */
export function annotateToolResultMessage(
  msg: AgentMessage,
  durationMs: number,
): AgentMessage {
  const name = msg.toolName ?? "unknown";
  const annotation = formatToolTimingAnnotation(name, durationMs);
  // Avoid double-annotation if already suffixed
  if (msg.content.includes("[tool:") && msg.content.includes("completed in")) {
    return msg;
  }
  return {
    ...msg,
    content: `${msg.content}${annotation}`,
  };
}

// ── Result type ─────────────────────────────────────────────

export interface ToolDispatchResult {
  readonly type: "text";
  readonly content: string;
  readonly provider: ProviderName;
  readonly model: string;
}

// ── Dependency Interfaces ───────────────────────────────────
// Narrow interfaces to avoid pulling in concrete classes.

export interface WebFetchDep {
  fetch(url: string): Promise<WebFetchResult>;
}

export interface PlanStoreDep {
  createPlan(title: string, description: string): { readonly title: string; readonly id: string };
  listPlans(): readonly { readonly planId: string; readonly title: string; readonly completedTasks: number; readonly taskCount: number }[];
  advanceTask(planId: string): { readonly title: string; readonly status: string };
}

// ── Dispatch Context ────────────────────────────────────────

export interface ToolDispatchContext {
  /** Fallback provider name when chunk.provider is absent. */
  readonly responseProvider: ProviderName;
  /** Fallback model string when chunk.model is absent. */
  readonly responseModel: string;
}

// ── web_fetch ───────────────────────────────────────────────

/**
 * Execute the web_fetch tool.
 * Fetches the given URL via WebFetchTool and returns a truncated preview.
 */
export async function dispatchWebFetch(
  input: Record<string, unknown>,
  webFetch: WebFetchDep,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const url = String(input["url"] ?? "");
  const maxLength =
    typeof input["maxLength"] === "number"
      ? (input["maxLength"] as number)
      : undefined;

  try {
    const result = await webFetch.fetch(url);
    const text = maxLength
      ? result.markdown.slice(0, maxLength)
      : result.markdown;
    return {
      type: "text",
      content: `\n[web_fetch] ${result.title ?? url} (${result.status}): ${text.slice(0, 200)}...\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: "text",
      content: `\n[web_fetch] Error: ${msg}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

// ── plan_create ─────────────────────────────────────────────

/**
 * Execute the plan_create tool.
 * Creates a new plan in the PlanStore with the given title and description.
 */
export function dispatchPlanCreate(
  input: Record<string, unknown>,
  planStore: PlanStoreDep,
  ctx: ToolDispatchContext,
): ToolDispatchResult {
  const title = String(input["title"] ?? "Untitled");
  const description = String(input["description"] ?? "");

  try {
    const plan = planStore.createPlan(title, description);
    return {
      type: "text",
      content: `\n[plan_create] Created plan "${plan.title}" (${plan.id})\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: "text",
      content: `\n[plan_create] Error: ${msg}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

// ── plan_list ───────────────────────────────────────────────

/**
 * Execute the plan_list tool.
 * Lists all active plans with their progress.
 */
export function dispatchPlanList(
  planStore: PlanStoreDep,
  ctx: ToolDispatchContext,
): ToolDispatchResult {
  try {
    const plans = planStore.listPlans();
    const summary =
      plans.length === 0
        ? "No active plans."
        : plans
            .map(
              (p) =>
                `- ${p.title} (${p.planId}): ${p.completedTasks}/${p.taskCount} tasks`,
            )
            .join("\n");
    return {
      type: "text",
      content: `\n[plan_list]\n${summary}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: "text",
      content: `\n[plan_list] Error: ${msg}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

// ── plan_advance ────────────────────────────────────────────

/**
 * Execute the plan_advance tool.
 * Advances a task in the given plan to its next status.
 */
export function dispatchPlanAdvance(
  input: Record<string, unknown>,
  planStore: PlanStoreDep,
  ctx: ToolDispatchContext,
): ToolDispatchResult {
  const planId = String(input["planId"] ?? "");

  try {
    const task = planStore.advanceTask(planId);
    return {
      type: "text",
      content: `\n[plan_advance] Task "${task.title}" -> ${task.status}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: "text",
      content: `\n[plan_advance] Error: ${msg}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

// ── Unified Dispatcher ──────────────────────────────────────

export interface ToolDispatchDeps {
  readonly webFetch: WebFetchDep;
  readonly planStore: PlanStoreDep | null;
}

/**
 * Dispatch a runtime-handled tool by name.
 * Returns null if the tool name is not a runtime tool or if dependencies
 * are unavailable (e.g., plan tools without a PlanStore).
 */
export async function dispatchRuntimeTool(
  toolName: string,
  input: Record<string, unknown>,
  deps: ToolDispatchDeps,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult | null> {
  switch (toolName) {
    case "web_fetch":
      return dispatchWebFetch(input, deps.webFetch, ctx);

    case "plan_create":
      if (!deps.planStore) return null;
      return dispatchPlanCreate(input, deps.planStore, ctx);

    case "plan_list":
      if (!deps.planStore) return null;
      return dispatchPlanList(deps.planStore, ctx);

    case "plan_advance":
      if (!deps.planStore) return null;
      return dispatchPlanAdvance(input, deps.planStore, ctx);

    default:
      return null;
  }
}
