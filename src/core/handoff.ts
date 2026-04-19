/**
 * Handoff — OpenAI agents-python Handoff pattern for multi-agent triage
 * (Lane 5).
 *
 * A handoff is one agent DELEGATING an entire turn to another agent. The
 * triage agent might route a customer question to "billing-agent" or
 * "account-agent"; the conversation pointer migrates to the chosen
 * agent, who sees a filtered, summarised version of the history.
 *
 * Compared to `src/orchestration/task-delegation.ts` (which wraps a
 * parent/child RPC contract with constraints + rollback), a handoff
 * is a full turn transfer — the downstream agent IS the conversation
 * from this point on, and the caller gets back a resumed run context,
 * not a child-task result.
 *
 * This module implements the ported agents-python primitives:
 *   - `Handoff`                — dataclass describing a handoff target
 *   - `HandoffInputData`       — the thing passed to an input_filter
 *   - `HandoffInputFilter`     — filter that rewrites the downstream input
 *   - `nestHandoffHistory`     — default filter that wraps prior history
 *                                in <CONVERSATION HISTORY> markers and
 *                                strips tool-call internals
 *   - `performHandoff()`       — runs the full handoff: resolve → filter →
 *                                build new input for the next agent
 *
 * Semantics mirrored from agents-python/handoffs:
 *   - `input_filter` lets the caller shape what the next agent sees
 *   - `nest_handoff_history` (per-handoff override) summarises prior
 *     history so downstream agents don't re-see tool-call internals
 *   - `input_items`, when set, is used INSTEAD of `new_items` for the
 *     next agent's input while `new_items` remains intact for session
 *     history (dedup-without-losing-provenance)
 */

// ── Types ──────────────────────────────────────────────

export type AgentId = string;

/**
 * A single conversation item. Kept loose on purpose — agents-python
 * uses its own `RunItem` taxonomy; WOTANN accepts any object whose
 * `type` field classifies the item. String messages are allowed for
 * the simpler text-only case.
 */
export interface ConversationItem {
  readonly type: string;
  readonly role?: "user" | "assistant" | "system" | "tool";
  readonly content?: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

export type ConversationInput = string | readonly ConversationItem[];

/**
 * Input passed to a handoff's input_filter. Mirrors
 * agents-python/handoffs HandoffInputData.
 */
export interface HandoffInputData {
  /** The conversation before the current turn started. */
  readonly input_history: ConversationInput;
  /** Items generated BEFORE the agent turn where the handoff fired. */
  readonly pre_handoff_items: readonly ConversationItem[];
  /** Items from the CURRENT turn, including the trigger + its tool output. */
  readonly new_items: readonly ConversationItem[];
  /**
   * When set, these items go to the NEXT agent's input instead of
   * `new_items`. Enables filtering duplicates from the downstream
   * input while preserving `new_items` in session history.
   */
  readonly input_items?: readonly ConversationItem[];
}

export type MaybePromise<T> = T | Promise<T>;

/** A function that reshapes HandoffInputData before the next agent runs. */
export type HandoffInputFilter = (data: HandoffInputData) => MaybePromise<HandoffInputData>;

/** A function that rewrites the nested history summary. */
export type HandoffHistoryMapper = (
  items: readonly ConversationItem[],
) => readonly ConversationItem[];

/**
 * Describes where a handoff can land — the target agent plus optional
 * filters. A Handoff can be constructed ahead of time and reused across
 * turns (like agents-python's @dataclass).
 */
export interface Handoff {
  /** Unique id of the target agent. */
  readonly agentId: AgentId;
  /** Human-readable name of the target agent (tool description, UI label). */
  readonly agentName: string;
  /** The tool the triage agent calls to trigger the handoff. */
  readonly toolName: string;
  readonly toolDescription: string;
  /**
   * Optional filter applied to the input before the next agent sees it.
   * When undefined + `nestHandoffHistory` is true, the default
   * `defaultNestHandoffHistoryFilter` applies.
   */
  readonly inputFilter?: HandoffInputFilter;
  /**
   * Per-handoff override for nesting prior history. Defaults to true
   * so tool-call internals are hidden from the downstream agent.
   */
  readonly nestHandoffHistory?: boolean;
}

export interface HandoffRunContext {
  readonly from: AgentId;
  readonly to: AgentId;
  readonly handoff: Handoff;
  /** Unix ms — when this handoff was executed. */
  readonly performedAt: number;
}

export interface HandoffResult {
  readonly context: HandoffRunContext;
  /**
   * The HandoffInputData actually passed to the next agent, after
   * filtering + history nesting. Returned so callers can log or
   * reconstruct the downstream session.
   */
  readonly downstreamInput: HandoffInputData;
}

// ── Default history markers ────────────────────────────

/** Matches agents-python's default nesting markers. */
export const DEFAULT_CONVERSATION_HISTORY_START = "<CONVERSATION HISTORY>";
export const DEFAULT_CONVERSATION_HISTORY_END = "</CONVERSATION HISTORY>";

let conversationHistoryStart = DEFAULT_CONVERSATION_HISTORY_START;
let conversationHistoryEnd = DEFAULT_CONVERSATION_HISTORY_END;

/**
 * Override the markers that wrap the nested history summary.
 * Matches agents-python `set_conversation_history_wrappers`.
 */
export function setConversationHistoryWrappers(opts: {
  readonly start?: string;
  readonly end?: string;
}): void {
  if (opts.start !== undefined) conversationHistoryStart = opts.start;
  if (opts.end !== undefined) conversationHistoryEnd = opts.end;
}

/** Restore the default <CONVERSATION HISTORY> markers. */
export function resetConversationHistoryWrappers(): void {
  conversationHistoryStart = DEFAULT_CONVERSATION_HISTORY_START;
  conversationHistoryEnd = DEFAULT_CONVERSATION_HISTORY_END;
}

export function getConversationHistoryWrappers(): { start: string; end: string } {
  return { start: conversationHistoryStart, end: conversationHistoryEnd };
}

// ── Item filtering ─────────────────────────────────────

/**
 * Item types that are SUMMARISED into the nested history and should not
 * be forwarded verbatim — prevents duplication and hides the previous
 * agent's tool-call internals from the downstream agent.
 */
export const SUMMARY_ONLY_INPUT_TYPES: ReadonlySet<string> = new Set([
  "function_call",
  "function_call_output",
  "tool_call",
  "tool_call_output",
  "tool_result",
  // Reasoning items can become orphaned after other summarised items are
  // filtered; treat them the same way as function calls.
  "reasoning",
  "thinking",
]);

export function isSummaryOnlyType(item: ConversationItem): boolean {
  return SUMMARY_ONLY_INPUT_TYPES.has(item.type);
}

// ── Default history mapper ─────────────────────────────

/**
 * Default mapper: keep plain messages, drop anything that's
 * summary-only. Matches agents-python's default_handoff_history_mapper.
 */
export const defaultHandoffHistoryMapper: HandoffHistoryMapper = (items) =>
  items.filter((item) => !isSummaryOnlyType(item));

// ── nestHandoffHistory filter ─────────────────────────

/**
 * Summarise the previous transcript for the next agent. The returned
 * HandoffInputData has:
 *   - `input_history` wrapped with <CONVERSATION HISTORY> markers
 *   - `pre_handoff_items` filtered by the history mapper
 *   - `new_items` stripped of SUMMARY_ONLY_INPUT_TYPES so the next agent
 *     does NOT re-see the previous agent's tool-call internals
 *   - `input_items` set to the filtered new_items so the next agent's
 *     input is the filtered view while `new_items` is preserved in
 *     session history
 */
export function nestHandoffHistory(
  data: HandoffInputData,
  options: { readonly historyMapper?: HandoffHistoryMapper } = {},
): HandoffInputData {
  const mapper = options.historyMapper ?? defaultHandoffHistoryMapper;

  // 1. Flatten and summarise input_history.
  const flattenedHistory = flattenInputHistory(data.input_history);
  const mappedHistory = mapper(flattenedHistory);
  const summarisedHistory = wrapHistoryMarkers(mappedHistory);

  // 2. Filter pre_handoff_items the same way.
  const filteredPre = mapper(data.pre_handoff_items);

  // 3. Filter new_items: keep originals for session history, but give
  //    the NEXT agent a stripped view via input_items.
  const filteredNew = data.new_items.filter((item) => !isSummaryOnlyType(item));

  return {
    input_history: summarisedHistory,
    pre_handoff_items: filteredPre,
    new_items: data.new_items, // unchanged — session-history preservation
    input_items: filteredNew,
  };
}

/**
 * Ready-to-use filter wrapping `nestHandoffHistory` with defaults. Use
 * this as a Handoff.inputFilter when you want the agents-python default
 * behaviour out of the box.
 */
export const defaultNestHandoffHistoryFilter: HandoffInputFilter = (data) =>
  nestHandoffHistory(data);

// ── performHandoff ─────────────────────────────────────

/**
 * Run a handoff: apply the input filter (or the default nested-history
 * filter, depending on the Handoff's nestHandoffHistory setting), then
 * hand the resulting HandoffInputData to the caller so they can start
 * the next agent's turn with the right input.
 *
 * The `from` agent id is passed explicitly so logs/spans can see both
 * endpoints without the caller having to thread a parent-context object.
 */
export async function performHandoff(
  from: AgentId,
  to: AgentId,
  handoff: Handoff,
  data: HandoffInputData,
  clock: () => number = () => Date.now(),
): Promise<HandoffResult> {
  if (from === to) {
    throw new Error(`performHandoff: refusing no-op handoff (from === to === ${from})`);
  }
  if (handoff.agentId !== to) {
    throw new Error(
      `performHandoff: Handoff.agentId (${handoff.agentId}) does not match target (${to})`,
    );
  }

  const nest = handoff.nestHandoffHistory ?? true;
  const filter = handoff.inputFilter ?? (nest ? defaultNestHandoffHistoryFilter : identityFilter);
  const filtered = await filter(data);
  // If the caller set nestHandoffHistory=true AND supplied a custom
  // filter, agents-python nests AROUND the custom filter's output so
  // the downstream agent still sees the wrapped summary. Mirror that.
  const finalData = nest && handoff.inputFilter ? nestHandoffHistory(filtered) : filtered;

  return {
    context: {
      from,
      to,
      handoff,
      performedAt: clock(),
    },
    downstreamInput: finalData,
  };
}

// ── Helpers ────────────────────────────────────────────

const identityFilter: HandoffInputFilter = (data) => data;

function flattenInputHistory(history: ConversationInput): readonly ConversationItem[] {
  if (typeof history === "string") {
    if (!history) return [];
    return [{ type: "message", role: "user", content: history }];
  }
  return history;
}

function wrapHistoryMarkers(items: readonly ConversationItem[]): readonly ConversationItem[] {
  const { start, end } = getConversationHistoryWrappers();
  if (items.length === 0) {
    // Keep the shape consistent: emit a single empty summary marker so
    // the downstream agent has a stable section header.
    return [{ type: "message", role: "system", content: `${start}\n\n${end}` }];
  }
  const body = items
    .map((item) => (typeof item.content === "string" ? item.content : JSON.stringify(item)))
    .join("\n\n");
  return [{ type: "message", role: "system", content: `${start}\n${body}\n${end}` }];
}

// ── Convenience constructors ───────────────────────────

/**
 * Convenience constructor for a Handoff. Enforces the invariant that
 * every Handoff has an agentId and a tool_name + tool_description.
 */
export function makeHandoff(params: {
  readonly agentId: AgentId;
  readonly agentName: string;
  readonly toolName?: string;
  readonly toolDescription?: string;
  readonly inputFilter?: HandoffInputFilter;
  readonly nestHandoffHistory?: boolean;
}): Handoff {
  const toolName = params.toolName ?? `handoff_to_${params.agentName}`;
  const toolDescription =
    params.toolDescription ?? `Transfer the conversation to agent "${params.agentName}".`;
  return {
    agentId: params.agentId,
    agentName: params.agentName,
    toolName,
    toolDescription,
    ...(params.inputFilter !== undefined ? { inputFilter: params.inputFilter } : {}),
    ...(params.nestHandoffHistory !== undefined
      ? { nestHandoffHistory: params.nestHandoffHistory }
      : {}),
  };
}
