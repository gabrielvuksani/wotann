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
import type { MonitorEvent, MonitorOptions, MonitorSession } from "../tools/monitor.js";
import type { ToolTimingLogger } from "../tools/tool-timing.js";
import { withTiming } from "../tools/tool-timing.js";
import type { ConnectorRegistry } from "../connectors/connector-registry.js";
import {
  dispatchConnectorTool,
  isConnectorTool,
  type ConnectorToolName,
  type ConnectorToolResult,
} from "../connectors/connector-tools.js";
import { runTerminal } from "../cli/tricks/terminal-run.js";
import { readImage } from "../cli/tricks/image-read.js";
import { tmuxPull } from "../cli/tricks/tmux-pull.js";
import {
  dispatchParallelSearch,
  type ParallelSearchAgentBudget,
} from "../intelligence/parallel-search-agent.js";
import type { SearchType } from "../intelligence/parallel-search.js";

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
  private readonly starts: Map<string, { readonly toolName: string; readonly startedAt: number }> =
    new Map();
  /** Completed timings, retained until a tool_result is annotated. */
  private readonly completions: Map<
    string,
    { readonly toolName: string; readonly durationMs: number }
  > = new Map();

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
export function annotateToolResultMessage(msg: AgentMessage, durationMs: number): AgentMessage {
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

/**
 * Minimal surface the monitor dispatcher needs. Kept as a function-typed
 * dep (not a class) so tests can inject a fake session factory without
 * spawning real processes. The runtime wires this to `spawnMonitor` from
 * `src/tools/monitor.ts`.
 */
export interface MonitorDep {
  spawn(options: MonitorOptions): MonitorSession;
}

/** Hard ceiling on monitor wall-clock to protect runaway sessions. */
export const MONITOR_MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes
/** Soft cap on per-event lines collected into a single result envelope. */
export const MONITOR_MAX_EVENTS_PER_RESULT = 500;

export interface PlanStoreDep {
  createPlan(title: string, description: string): { readonly title: string; readonly id: string };
  listPlans(): readonly {
    readonly planId: string;
    readonly title: string;
    readonly completedTasks: number;
    readonly taskCount: number;
  }[];
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
    typeof input["maxLength"] === "number" ? (input["maxLength"] as number) : undefined;

  try {
    const result = await webFetch.fetch(url);
    const text = maxLength ? result.markdown.slice(0, maxLength) : result.markdown;
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

// ── monitor ─────────────────────────────────────────────────

/**
 * Parse and validate the monitor tool input from the LLM. Returns a
 * ready-to-use `MonitorOptions` or a string error describing the
 * validation failure. The `null`-vs-string contract matches the
 * `null over silent success` quality bar — we never fabricate defaults
 * when `command` is missing.
 */
function parseMonitorInput(
  input: Record<string, unknown>,
): { readonly options: MonitorOptions } | { readonly error: string } {
  const command = input["command"];
  if (typeof command !== "string" || command.trim().length === 0) {
    return { error: "missing or empty `command` argument" };
  }
  const rawArgs = input["args"];
  let args: readonly string[] | undefined;
  if (rawArgs !== undefined) {
    if (!Array.isArray(rawArgs)) return { error: "`args` must be an array of strings" };
    if (!rawArgs.every((a): a is string => typeof a === "string")) {
      return { error: "`args` must be an array of strings" };
    }
    args = rawArgs;
  }
  const cwd = typeof input["cwd"] === "string" ? (input["cwd"] as string) : undefined;
  let maxDurationMs: number | undefined;
  if (typeof input["maxDurationMs"] === "number") {
    const requested = input["maxDurationMs"] as number;
    if (!Number.isFinite(requested) || requested < 0) {
      return { error: "`maxDurationMs` must be a non-negative finite number" };
    }
    // Clamp to the runtime ceiling; 0 means "unlimited" up to the ceiling.
    maxDurationMs =
      requested === 0 ? MONITOR_MAX_DURATION_MS : Math.min(requested, MONITOR_MAX_DURATION_MS);
  } else {
    maxDurationMs = MONITOR_MAX_DURATION_MS;
  }
  const options: MonitorOptions = {
    command,
    ...(args !== undefined ? { args } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    maxDurationMs,
  };
  return { options };
}

/**
 * Format a monitor event into a human-readable line for transcript
 * inclusion. Exported for reuse by the streaming variant and tests.
 */
export function formatMonitorEvent(event: MonitorEvent): string {
  switch (event.type) {
    case "stdout":
      return `  [out ${event.elapsedMs}ms] ${event.line}`;
    case "stderr":
      return `  [err ${event.elapsedMs}ms] ${event.line}`;
    case "error":
      return `  [error ${event.elapsedMs}ms] ${event.line}`;
    case "truncated":
      return `  [truncated — buffer cap reached, older lines dropped]`;
    case "exit":
      return `  [exit ${event.elapsedMs}ms] code=${event.exitCode ?? "null"} signal=${event.signal ?? "null"}`;
  }
}

/**
 * Stream monitor events as individual ToolDispatchResult chunks. The
 * runtime can `yield` each chunk into its own stream loop so the agent
 * sees lines as they arrive — no sleep-poll. Terminates after the
 * `exit` event or when `MONITOR_MAX_EVENTS_PER_RESULT` events have been
 * emitted (hard cap to keep a runaway process from flooding the
 * transcript). The final summary line includes totalDurationMs.
 */
export async function* dispatchMonitorStream(
  input: Record<string, unknown>,
  monitor: MonitorDep,
  ctx: ToolDispatchContext,
): AsyncGenerator<ToolDispatchResult> {
  const parsed = parseMonitorInput(input);
  if ("error" in parsed) {
    yield {
      type: "text",
      content: `\n[monitor] Error: ${parsed.error}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
    return;
  }

  let session: MonitorSession;
  try {
    session = monitor.spawn(parsed.options);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    yield {
      type: "text",
      content: `\n[monitor] Spawn failed: ${msg}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
    return;
  }

  // Header line — announces which session is streaming so a downstream
  // reader can attribute lines back to the right process.
  yield {
    type: "text",
    content: `\n[monitor ${session.id}] streaming ${parsed.options.command}${(parsed.options.args ?? []).length > 0 ? " " + (parsed.options.args ?? []).join(" ") : ""}\n`,
    provider: ctx.responseProvider,
    model: ctx.responseModel,
  };

  let emitted = 0;
  let totalDurationMs = 0;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  try {
    for await (const event of session.events) {
      emitted += 1;
      totalDurationMs = event.elapsedMs;
      if (event.type === "exit") {
        exitCode = event.exitCode ?? null;
        exitSignal = event.signal ?? null;
      }
      yield {
        type: "text",
        content: `${formatMonitorEvent(event)}\n`,
        provider: ctx.responseProvider,
        model: ctx.responseModel,
      };
      if (emitted >= MONITOR_MAX_EVENTS_PER_RESULT) {
        // Too many events — stop the process and announce the truncation.
        await session.stop();
        yield {
          type: "text",
          content: `\n[monitor ${session.id}] hit per-result cap (${MONITOR_MAX_EVENTS_PER_RESULT}); process terminated\n`,
          provider: ctx.responseProvider,
          model: ctx.responseModel,
        };
        break;
      }
      if (event.type === "exit") break;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    yield {
      type: "text",
      content: `\n[monitor ${session.id}] Stream error: ${msg}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }

  // Final summary — the agent gets a single line it can grep for.
  yield {
    type: "text",
    content: `\n[monitor ${session.id}] exit: exitCode=${exitCode ?? "null"} signal=${exitSignal ?? "null"} totalDurationMs=${totalDurationMs}\n`,
    provider: ctx.responseProvider,
    model: ctx.responseModel,
  };
}

/**
 * Collect monitor events into a single ToolDispatchResult. Used by the
 * unified `dispatchRuntimeTool` entry point which returns a single
 * result; the streaming variant above is exposed for the runtime's main
 * stream loop when true per-event yields are desired.
 */
export async function dispatchMonitor(
  input: Record<string, unknown>,
  monitor: MonitorDep,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const parts: string[] = [];
  for await (const chunk of dispatchMonitorStream(input, monitor, ctx)) {
    parts.push(chunk.content);
  }
  return {
    type: "text",
    content: parts.join(""),
    provider: ctx.responseProvider,
    model: ctx.responseModel,
  };
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
            .map((p) => `- ${p.title} (${p.planId}): ${p.completedTasks}/${p.taskCount} tasks`)
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

// ── T12.2 Terminus-KIRA dispatchers ─────────────────────────

/**
 * Execute the terminal_run tool.
 * Validates argv, invokes runTerminal (execFile, no shell), and serialises
 * the structured envelope as JSON for the transcript. Honest-stub posture:
 * a missing or malformed argv returns ok:false with a reason — never throws.
 */
export async function dispatchTerminalRun(
  input: Record<string, unknown>,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const rawArgv = input["argv"];
  if (!Array.isArray(rawArgv) || rawArgv.length === 0) {
    return {
      type: "text",
      content: `\n[terminal_run] ${JSON.stringify({
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: "terminal_run: argv must be a non-empty array of strings",
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
  if (!rawArgv.every((a): a is string => typeof a === "string")) {
    return {
      type: "text",
      content: `\n[terminal_run] ${JSON.stringify({
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: "terminal_run: every argv element must be a string",
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
  const timeoutMs =
    typeof input["timeoutMs"] === "number" ? (input["timeoutMs"] as number) : undefined;
  try {
    const result = await runTerminal({
      argv: rawArgv,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    return {
      type: "text",
      content: `\n[terminal_run] ${JSON.stringify(result)}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err) {
    // runTerminal is documented as never-throws but we keep an honest
    // outer guard so an upstream misbehaviour is still surfaced cleanly.
    const reason = err instanceof Error ? err.message : String(err);
    return {
      type: "text",
      content: `\n[terminal_run] ${JSON.stringify({
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: `terminal_run: unexpected throw — ${reason}`,
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

/**
 * Execute the image_read tool.
 * Validates the path, invokes readImage, and serialises the envelope.
 * Honest-stub: missing path / unsupported extension / read failure all
 * return ok:false with a human-readable error.
 */
export async function dispatchImageRead(
  input: Record<string, unknown>,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const path = typeof input["path"] === "string" ? (input["path"] as string) : "";
  if (!path) {
    return {
      type: "text",
      content: `\n[image_read] ${JSON.stringify({
        ok: false,
        error: "image_read: missing required `path` argument",
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
  try {
    const result = await readImage(path);
    return {
      type: "text",
      content: `\n[image_read] ${JSON.stringify(result)}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      type: "text",
      content: `\n[image_read] ${JSON.stringify({
        ok: false,
        error: `image_read: unexpected throw — ${reason}`,
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

/**
 * Execute the tmux_pull tool.
 * Validates the session, invokes tmuxPull, and serialises the envelope.
 * Honest-stub: missing session / no tmux server / unknown session all
 * return ok:false with a categorised reason string.
 */
export async function dispatchTmuxPull(
  input: Record<string, unknown>,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const session = typeof input["session"] === "string" ? (input["session"] as string) : "";
  if (!session) {
    return {
      type: "text",
      content: `\n[tmux_pull] ${JSON.stringify({
        ok: false,
        reason: "tmux_pull: missing required `session` argument",
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
  const lines = typeof input["lines"] === "number" ? (input["lines"] as number) : undefined;
  const pane = typeof input["pane"] === "string" ? (input["pane"] as string) : undefined;
  const tmuxBin = typeof input["tmuxBin"] === "string" ? (input["tmuxBin"] as string) : undefined;
  try {
    const result = await tmuxPull({
      session,
      ...(lines !== undefined ? { lines } : {}),
      ...(pane !== undefined ? { pane } : {}),
      ...(tmuxBin !== undefined ? { tmuxBin } : {}),
    });
    return {
      type: "text",
      content: `\n[tmux_pull] ${JSON.stringify(result)}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      type: "text",
      content: `\n[tmux_pull] ${JSON.stringify({
        ok: false,
        reason: `tmux_pull: unexpected throw — ${reason}`,
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

// ── T12.3 parallel_search dispatcher ────────────────────────

/**
 * Execute the parallel_search tool. Validates the input, hands the
 * normalised queries + budget down to `dispatchParallelSearch`, and
 * serialises the resulting envelope as JSON for transcript inclusion.
 *
 * Honest-stub posture: missing workspaceDir / non-array queries / a
 * primitive throw all surface as `{ok:false, reason, error}` — never
 * throw out of dispatch.
 */
async function dispatchParallelSearchTool(
  input: Record<string, unknown>,
  workspaceDir: string | undefined,
  memoryFn:
    | ((
        query: string,
      ) => readonly { source: SearchType; title: string; content: string; score: number }[])
    | undefined,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    return {
      type: "text",
      content: `\n[parallel_search] ${JSON.stringify({
        ok: false,
        reason: "invalid-input",
        error:
          "parallel_search: runtime did not provide a workspaceDir — tool is unavailable in this dispatch context",
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }

  const rawQueries = input["queries"];
  if (!Array.isArray(rawQueries)) {
    return {
      type: "text",
      content: `\n[parallel_search] ${JSON.stringify({
        ok: false,
        reason: "invalid-input",
        error: "parallel_search: `queries` must be an array of strings",
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }

  const budget: ParallelSearchAgentBudget = {};
  const rawSources = input["sources"];
  if (Array.isArray(rawSources) && rawSources.every((s): s is string => typeof s === "string")) {
    (budget as { sources?: readonly SearchType[] }).sources = rawSources as readonly SearchType[];
  }
  if (typeof input["maxHits"] === "number") {
    (budget as { maxHits?: number }).maxHits = input["maxHits"] as number;
  }
  if (typeof input["maxWallclockMs"] === "number") {
    (budget as { maxWallclockMs?: number }).maxWallclockMs = input["maxWallclockMs"] as number;
  }

  try {
    const result = await dispatchParallelSearch(rawQueries, budget, {
      workspaceDir,
      ...(memoryFn ? { memorySearchFn: memoryFn } : {}),
    });
    return {
      type: "text",
      content: `\n[parallel_search] ${JSON.stringify(result)}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      type: "text",
      content: `\n[parallel_search] ${JSON.stringify({
        ok: false,
        reason: "primitive-threw",
        error: `parallel_search: unexpected throw — ${reason}`,
      })}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

// ── Unified Dispatcher ──────────────────────────────────────

/**
 * Minimal LSPManager surface this dispatcher needs — kept narrow so
 * runtime-tool-dispatch doesn't have to import the concrete class.
 * The real LSPManager lives in `src/lsp/symbol-operations.ts`.
 */
export interface LSPManagerDep {
  findSymbol(name: string): Promise<
    readonly {
      readonly uri: string;
      readonly range: unknown;
      readonly name: string;
      readonly kind: string;
    }[]
  >;
  findReferences(
    uri: string,
    position: { readonly line: number; readonly character: number },
  ): Promise<readonly { readonly uri: string; readonly range: unknown }[]>;
  rename(
    uri: string,
    position: { readonly line: number; readonly character: number },
    newName: string,
  ): Promise<{ readonly filesAffected: number; readonly editsApplied: number }>;
}

export interface ToolDispatchDeps {
  readonly webFetch: WebFetchDep;
  readonly planStore: PlanStoreDep | null;
  readonly lsp?: LSPManagerDep | null;
  readonly monitor?: MonitorDep | null;
  /**
   * Session-13 Serena-parity LSP agent tools (6 tools including hover,
   * definition, document_symbols). When present, dispatch prefers this
   * over the narrower LSPManagerDep for the 6 matching tool names —
   * agents get honest `lsp_not_installed` errors for multi-language
   * files instead of silent fallback. Lives alongside `lsp` (not a
   * replacement) so legacy callers that only provide `lsp` keep working.
   */
  readonly lspAgentTools?: {
    readonly dispatch: (
      toolName: string,
      input: Record<string, unknown>,
    ) => Promise<{ success: boolean; toolName: string; data: unknown; error?: string }>;
  } | null;
  /**
   * Wave 4G: optional timing logger. When present, every dispatched tool
   * is wrapped in `withTiming` so the elapsed ms is appended to
   * `.wotann/tool-timing.jsonl`. Absence is graceful — dispatch works
   * identically without a logger, just without persistent telemetry.
   */
  readonly timingLogger?: ToolTimingLogger | null;
  /**
   * Wave 4G: optional session identifier used to tag timing entries so
   * post-session analysis can filter by session. Passed through verbatim.
   */
  readonly sessionId?: string;
  /**
   * Wave 4C: connector registry used to route jira/linear/notion/confluence/
   * google-drive/slack tool calls. When absent or a connector is not
   * registered, dispatch returns a honest `{ok:false, error:"not_configured",
   * fix:...}` envelope rather than failing silently — this is the capability
   * gate that keeps the 34-tool connector surface honest.
   */
  readonly connectorRegistry?: ConnectorRegistry | null;
  /**
   * T12.3: workspace directory used by the `parallel_search` tool to
   * scope codebase / git-history / file-content searches. Optional —
   * when absent, parallel_search returns `{ok:false, reason:"invalid-input"}`
   * rather than guessing a default. Caller threads this through from
   * the runtime's resolved cwd so the agent never hits a stale path.
   */
  readonly workspaceDir?: string;
  /**
   * T12.3: optional memory search backend wired for the `parallel_search`
   * tool. When absent, the memory source returns no hits; behaviour is
   * isomorphic to providing an empty function. Threaded via DI so the
   * runtime can plug in its real memory store without this module
   * importing the concrete class.
   */
  readonly parallelSearchMemoryFn?: (
    query: string,
  ) => readonly { source: SearchType; title: string; content: string; score: number }[];
}

/**
 * Dispatch a runtime-handled tool by name.
 * Returns null if the tool name is not a runtime tool or if dependencies
 * are unavailable (e.g., plan tools without a PlanStore).
 *
 * Wave 4G: every handler is wrapped in `withTiming` before invocation so
 * when a `timingLogger` is present each dispatch appends an entry to
 * `.wotann/tool-timing.jsonl`. This is transparent to callers — the
 * return shape is unchanged.
 */
export async function dispatchRuntimeTool(
  toolName: string,
  input: Record<string, unknown>,
  deps: ToolDispatchDeps,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult | null> {
  // Build the underlying handler once, then conditionally time it. A
  // nullable handler lets us preserve the "return null when deps are
  // missing" contract without duplicating the switch.
  const makeHandler = (): (() => Promise<ToolDispatchResult>) | null => {
    switch (toolName) {
      case "web_fetch":
        return () => dispatchWebFetch(input, deps.webFetch, ctx);

      case "plan_create":
        if (!deps.planStore) return null;
        return () => Promise.resolve(dispatchPlanCreate(input, deps.planStore!, ctx));

      case "plan_list":
        if (!deps.planStore) return null;
        return () => Promise.resolve(dispatchPlanList(deps.planStore!, ctx));

      case "plan_advance":
        if (!deps.planStore) return null;
        return () => Promise.resolve(dispatchPlanAdvance(input, deps.planStore!, ctx));

      case "find_symbol":
        if (!deps.lsp) return null;
        return () => dispatchFindSymbol(input, deps.lsp!, ctx);

      case "find_references":
        if (!deps.lsp) return null;
        return () => dispatchFindReferences(input, deps.lsp!, ctx);

      case "rename_symbol":
        if (!deps.lsp) return null;
        return () => dispatchRenameSymbol(input, deps.lsp!, ctx);

      case "monitor":
        if (!deps.monitor) return null;
        return () => dispatchMonitor(input, deps.monitor!, ctx);

      case "terminal_run":
        return () => dispatchTerminalRun(input, ctx);

      case "image_read":
        return () => dispatchImageRead(input, ctx);

      case "tmux_pull":
        return () => dispatchTmuxPull(input, ctx);

      case "parallel_search":
        return () =>
          dispatchParallelSearchTool(input, deps.workspaceDir, deps.parallelSearchMemoryFn, ctx);

      default:
        // Wave-4C: if the tool name matches one of the 34 connector tools,
        // route it through `dispatchConnectorTool`. The registry may be
        // null (no connector configured on this machine) — we still
        // dispatch so the handler can return the honest `not_configured`
        // envelope with a `fix` pointing at the right env var.
        if (isConnectorTool(toolName)) {
          return () =>
            dispatchConnectorToolAsResult(toolName, input, deps.connectorRegistry ?? null, ctx);
        }
        // Aux tools (PDF extract, post_callback, task.spawn, monitor_bg).
        // Resurrected from src/tools/aux-tools.ts; these are agent-callable
        // when buildAuxToolDefinitions() exposes them in the schema (wired
        // from runtime.ts:2810). dispatchAuxTool returns a normalized envelope
        // we wrap into ToolDispatchResult.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const auxModule =
          require("../tools/aux-tools.js") as typeof import("../tools/aux-tools.js");
        if (auxModule.isAuxTool(toolName)) {
          return async () => {
            const auxResult = await auxModule.dispatchAuxTool(toolName, input, {
              // task.spawn requires a TaskTool dep — we don't currently
              // surface one through ToolDispatchDeps, so spawn returns an
              // honest `not_configured` error. The other 4 aux tools
              // (PDF, post_callback, monitor_bg) work without it.
              taskTool: null,
            });
            const content = auxResult.ok
              ? JSON.stringify(auxResult.data)
              : `Error: ${auxResult.error}${auxResult.detail ? ` — ${auxResult.detail}` : ""}`;
            return {
              type: "text" as const,
              content,
              provider: ctx.responseProvider,
              model: ctx.responseModel,
            };
          };
        }
        return null;
    }
  };

  const handler = makeHandler();
  if (!handler) return null;

  const timed = withTiming(handler, toolName, deps.timingLogger ?? undefined, deps.sessionId);
  return timed();
}

// ── Serena-style LSP symbol tool dispatchers ────────────────

async function dispatchFindSymbol(
  input: Record<string, unknown>,
  lsp: LSPManagerDep,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const name = typeof input["name"] === "string" ? (input["name"] as string) : "";
  if (!name) {
    return {
      type: "text",
      content: `\n[find_symbol] Error: missing \`name\` argument\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
  try {
    const hits = await lsp.findSymbol(name);
    const summary =
      hits.length === 0
        ? `No matches for "${name}"`
        : hits
            .slice(0, 20)
            .map((h) => `  ${h.kind} ${h.name} — ${h.uri}`)
            .join("\n");
    return {
      type: "text",
      content: `\n[find_symbol] ${hits.length} match(es) for "${name}":\n${summary}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err) {
    return {
      type: "text",
      content: `\n[find_symbol] Error: ${err instanceof Error ? err.message : String(err)}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

async function dispatchFindReferences(
  input: Record<string, unknown>,
  lsp: LSPManagerDep,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const uri = typeof input["uri"] === "string" ? (input["uri"] as string) : "";
  const line = typeof input["line"] === "number" ? (input["line"] as number) : -1;
  const character = typeof input["character"] === "number" ? (input["character"] as number) : -1;
  if (!uri || line < 0 || character < 0) {
    return {
      type: "text",
      content: `\n[find_references] Error: requires uri + line + character\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
  try {
    const refs = await lsp.findReferences(uri, { line, character });
    const summary = refs
      .slice(0, 20)
      .map((r) => `  ${r.uri}`)
      .join("\n");
    return {
      type: "text",
      content: `\n[find_references] ${refs.length} reference(s):\n${summary}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err) {
    return {
      type: "text",
      content: `\n[find_references] Error: ${err instanceof Error ? err.message : String(err)}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

async function dispatchRenameSymbol(
  input: Record<string, unknown>,
  lsp: LSPManagerDep,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  const uri = typeof input["uri"] === "string" ? (input["uri"] as string) : "";
  const line = typeof input["line"] === "number" ? (input["line"] as number) : -1;
  const character = typeof input["character"] === "number" ? (input["character"] as number) : -1;
  const newName = typeof input["newName"] === "string" ? (input["newName"] as string) : "";
  if (!uri || line < 0 || character < 0 || !newName) {
    return {
      type: "text",
      content: `\n[rename_symbol] Error: requires uri + line + character + newName\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
  try {
    const result = await lsp.rename(uri, { line, character }, newName);
    return {
      type: "text",
      content: `\n[rename_symbol] Renamed: ${result.editsApplied} edit(s) across ${result.filesAffected} file(s)\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  } catch (err) {
    return {
      type: "text",
      content: `\n[rename_symbol] Error: ${err instanceof Error ? err.message : String(err)}\n`,
      provider: ctx.responseProvider,
      model: ctx.responseModel,
    };
  }
}

// ── Wave-4C: connector tool dispatch adapter ────────────────

/**
 * Bridge `dispatchConnectorTool`'s structured `ConnectorToolResult` into
 * the transcript-friendly `ToolDispatchResult` shape. Honest errors are
 * serialised as JSON so the model can reason about the failure code
 * (e.g. `not_configured` / `fix`) without losing structure. Success
 * envelopes are serialised the same way.
 */
export async function dispatchConnectorToolAsResult(
  toolName: ConnectorToolName,
  input: Record<string, unknown>,
  registry: ConnectorRegistry | null,
  ctx: ToolDispatchContext,
): Promise<ToolDispatchResult> {
  let envelope: ConnectorToolResult<unknown>;
  try {
    envelope = await dispatchConnectorTool(toolName, input, registry);
  } catch (err) {
    // Connector dispatcher never throws under its contract; if a provider
    // escapes that contract we surface the error honestly (no silent
    // `ok:true` fallback).
    envelope = {
      ok: false,
      error: "upstream_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    type: "text",
    content: `\n[${toolName}] ${JSON.stringify(envelope)}\n`,
    provider: ctx.responseProvider,
    model: ctx.responseModel,
  };
}
