import { describe, it, expect, beforeEach } from "vitest";
import {
  makeHandoff,
  performHandoff,
  nestHandoffHistory,
  defaultHandoffHistoryMapper,
  defaultNestHandoffHistoryFilter,
  setConversationHistoryWrappers,
  resetConversationHistoryWrappers,
  getConversationHistoryWrappers,
  isSummaryOnlyType,
  SUMMARY_ONLY_INPUT_TYPES,
  DEFAULT_CONVERSATION_HISTORY_START,
  DEFAULT_CONVERSATION_HISTORY_END,
  type ConversationItem,
  type Handoff,
  type HandoffInputData,
  type HandoffInputFilter,
} from "../../src/core/handoff.js";

// Always reset global wrappers so tests don't bleed.
beforeEach(() => {
  resetConversationHistoryWrappers();
});

// ── Small fixtures ─────────────────────────────────────

function msg(role: "user" | "assistant" | "system", content: string): ConversationItem {
  return { type: "message", role, content };
}

function toolCall(name: string, args: string): ConversationItem {
  return { type: "function_call", name, content: args };
}

function toolOutput(name: string, result: string): ConversationItem {
  return { type: "function_call_output", name, content: result };
}

const agentA_id = "agent-a";
const agentB_id = "agent-b";

// ── makeHandoff ────────────────────────────────────────

describe("makeHandoff", () => {
  it("produces a handoff with default toolName + description", () => {
    const h = makeHandoff({ agentId: agentB_id, agentName: "billing" });
    expect(h.agentId).toBe(agentB_id);
    expect(h.agentName).toBe("billing");
    expect(h.toolName).toBe("handoff_to_billing");
    expect(h.toolDescription).toContain("billing");
  });

  it("honours custom toolName + description", () => {
    const h = makeHandoff({
      agentId: agentB_id,
      agentName: "billing",
      toolName: "to_billing",
      toolDescription: "Send to billing.",
    });
    expect(h.toolName).toBe("to_billing");
    expect(h.toolDescription).toBe("Send to billing.");
  });
});

// ── isSummaryOnlyType ──────────────────────────────────

describe("SUMMARY_ONLY_INPUT_TYPES", () => {
  it("tool calls + outputs + reasoning are summary-only", () => {
    expect(isSummaryOnlyType({ type: "function_call" })).toBe(true);
    expect(isSummaryOnlyType({ type: "function_call_output" })).toBe(true);
    expect(isSummaryOnlyType({ type: "tool_call" })).toBe(true);
    expect(isSummaryOnlyType({ type: "reasoning" })).toBe(true);
    expect(isSummaryOnlyType({ type: "thinking" })).toBe(true);
  });

  it("plain messages are NOT summary-only", () => {
    expect(isSummaryOnlyType({ type: "message" })).toBe(false);
  });

  it("default set matches expectations", () => {
    expect(SUMMARY_ONLY_INPUT_TYPES.has("function_call")).toBe(true);
    expect(SUMMARY_ONLY_INPUT_TYPES.has("message")).toBe(false);
  });
});

// ── defaultHandoffHistoryMapper ───────────────────────

describe("defaultHandoffHistoryMapper", () => {
  it("drops tool calls + outputs", () => {
    const items: readonly ConversationItem[] = [
      msg("user", "hello"),
      toolCall("search", '{"q":"x"}'),
      toolOutput("search", "result"),
      msg("assistant", "hi"),
    ];
    const out = defaultHandoffHistoryMapper(items);
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.type === "message")).toBe(true);
  });
});

// ── Global wrappers ────────────────────────────────────

describe("setConversationHistoryWrappers / reset", () => {
  it("defaults are the agents-python markers", () => {
    const { start, end } = getConversationHistoryWrappers();
    expect(start).toBe(DEFAULT_CONVERSATION_HISTORY_START);
    expect(end).toBe(DEFAULT_CONVERSATION_HISTORY_END);
  });

  it("overriding + resetting works", () => {
    setConversationHistoryWrappers({ start: "<<SUMMARY>>", end: "<</SUMMARY>>" });
    expect(getConversationHistoryWrappers().start).toBe("<<SUMMARY>>");
    resetConversationHistoryWrappers();
    expect(getConversationHistoryWrappers().start).toBe(DEFAULT_CONVERSATION_HISTORY_START);
  });
});

// ── nestHandoffHistory ─────────────────────────────────

describe("nestHandoffHistory", () => {
  const base: HandoffInputData = {
    input_history: [msg("user", "first question"), msg("assistant", "first answer")],
    pre_handoff_items: [msg("assistant", "let me route you"), toolCall("handoff", "{}")],
    new_items: [
      msg("user", "actually my billing question is X"),
      toolCall("lookup", "{}"),
      toolOutput("lookup", "found"),
      msg("assistant", "routing to billing"),
    ],
  };

  it("wraps input_history in <CONVERSATION HISTORY> markers", () => {
    const out = nestHandoffHistory(base);
    expect(Array.isArray(out.input_history)).toBe(true);
    const arr = out.input_history as readonly ConversationItem[];
    expect(arr).toHaveLength(1);
    const body = arr[0]?.content;
    expect(body).toContain(DEFAULT_CONVERSATION_HISTORY_START);
    expect(body).toContain(DEFAULT_CONVERSATION_HISTORY_END);
    expect(body).toContain("first question");
    expect(body).toContain("first answer");
  });

  it("strips tool-call internals from pre_handoff_items", () => {
    const out = nestHandoffHistory(base);
    expect(out.pre_handoff_items.every((i) => !isSummaryOnlyType(i))).toBe(true);
  });

  it("preserves new_items for session history", () => {
    const out = nestHandoffHistory(base);
    // new_items is the SESSION record — must retain tool-call internals.
    expect(out.new_items).toHaveLength(base.new_items.length);
    expect(out.new_items.some((i) => i.type === "function_call")).toBe(true);
  });

  it("input_items — the downstream agent view — is filtered", () => {
    const out = nestHandoffHistory(base);
    expect(out.input_items).toBeDefined();
    expect(out.input_items!.every((i) => !isSummaryOnlyType(i))).toBe(true);
    // The plain messages make it through.
    const contents = out.input_items!.map((i) => i.content);
    expect(contents).toContain("actually my billing question is X");
    expect(contents).toContain("routing to billing");
  });

  it("string input_history is flattened to a user message before wrapping", () => {
    const withString = { ...base, input_history: "earlier message" };
    const out = nestHandoffHistory(withString);
    const arr = out.input_history as readonly ConversationItem[];
    expect(arr[0]?.content).toContain("earlier message");
  });

  it("empty input_history yields an empty wrapped marker", () => {
    const empty = { ...base, input_history: [] };
    const out = nestHandoffHistory(empty);
    const arr = out.input_history as readonly ConversationItem[];
    expect(arr).toHaveLength(1);
    expect(arr[0]?.content).toContain(DEFAULT_CONVERSATION_HISTORY_START);
  });

  it("uses a custom historyMapper when provided", () => {
    const mapper = (items: readonly ConversationItem[]) =>
      items.filter((i) => i.role !== "assistant");
    const out = nestHandoffHistory(base, { historyMapper: mapper });
    const body = (out.input_history as readonly ConversationItem[])[0]?.content;
    expect(body).toContain("first question");
    expect(body).not.toContain("first answer");
  });
});

// ── performHandoff ─────────────────────────────────────

describe("performHandoff", () => {
  const handoff = makeHandoff({ agentId: agentB_id, agentName: "billing" });

  const data: HandoffInputData = {
    input_history: [msg("user", "hello")],
    pre_handoff_items: [],
    new_items: [
      msg("user", "I have a billing question"),
      toolCall("search", "{}"),
      toolOutput("search", "partial"),
      msg("assistant", "handing off"),
    ],
  };

  it("task spec — B receives filtered context without A's tool-call internals", async () => {
    // "agent A calls handoff to agent B; B receives filtered context
    //  without A's tool-call internals."
    const result = await performHandoff(agentA_id, agentB_id, handoff, data);
    const downstream = result.downstreamInput.input_items ?? result.downstreamInput.new_items;
    expect(downstream.some((i) => isSummaryOnlyType(i))).toBe(false);
    // The plain user + assistant messages DO make it through.
    const contents = downstream.map((i) => i.content);
    expect(contents).toContain("I have a billing question");
    expect(contents).toContain("handing off");
  });

  it("returns a HandoffRunContext with from + to + timestamp", async () => {
    const result = await performHandoff(agentA_id, agentB_id, handoff, data, () => 1234);
    expect(result.context.from).toBe(agentA_id);
    expect(result.context.to).toBe(agentB_id);
    expect(result.context.performedAt).toBe(1234);
    expect(result.context.handoff).toBe(handoff);
  });

  it("rejects no-op handoff where from === to", async () => {
    await expect(performHandoff(agentA_id, agentA_id, handoff, data)).rejects.toThrow(/no-op/);
  });

  it("rejects handoff whose agentId does not match target", async () => {
    const mismatched = makeHandoff({ agentId: "agent-c", agentName: "other" });
    await expect(performHandoff(agentA_id, agentB_id, mismatched, data)).rejects.toThrow(
      /does not match target/,
    );
  });

  it("nestHandoffHistory=false disables default filter", async () => {
    const bare = makeHandoff({
      agentId: agentB_id,
      agentName: "billing",
      nestHandoffHistory: false,
    });
    const result = await performHandoff(agentA_id, agentB_id, bare, data);
    // Without nesting the downstream input keeps tool-call internals in
    // new_items, and no input_items override is set.
    expect(result.downstreamInput.input_items).toBeUndefined();
    expect(
      result.downstreamInput.new_items.some((i) => i.type === "function_call"),
    ).toBe(true);
  });

  it("custom inputFilter receives the raw HandoffInputData", async () => {
    let captured: HandoffInputData | null = null;
    const filter: HandoffInputFilter = (d) => {
      captured = d;
      return d;
    };
    const custom = makeHandoff({
      agentId: agentB_id,
      agentName: "billing",
      inputFilter: filter,
      nestHandoffHistory: false,
    });
    await performHandoff(agentA_id, agentB_id, custom, data);
    expect(captured).not.toBeNull();
    expect(captured!.new_items.length).toBe(data.new_items.length);
  });

  it("custom filter + nestHandoffHistory=true nests around the filter", async () => {
    const filter: HandoffInputFilter = (d) => ({
      ...d,
      new_items: [...d.new_items, msg("system", "injected by filter")],
    });
    const custom: Handoff = makeHandoff({
      agentId: agentB_id,
      agentName: "billing",
      inputFilter: filter,
      nestHandoffHistory: true,
    });
    const result = await performHandoff(agentA_id, agentB_id, custom, data);
    // The filter's injection persists into new_items (session record)
    // and the nested-history wrapping still happens on top.
    expect(
      result.downstreamInput.new_items.some((i) => i.content === "injected by filter"),
    ).toBe(true);
    const arr = result.downstreamInput.input_history as readonly ConversationItem[];
    expect(arr[0]?.content).toContain(DEFAULT_CONVERSATION_HISTORY_START);
  });

  it("async inputFilter is awaited", async () => {
    const filter: HandoffInputFilter = async (d) => {
      await Promise.resolve();
      return { ...d, pre_handoff_items: [msg("system", "async-filtered")] };
    };
    const custom = makeHandoff({
      agentId: agentB_id,
      agentName: "billing",
      inputFilter: filter,
      nestHandoffHistory: false,
    });
    const result = await performHandoff(agentA_id, agentB_id, custom, data);
    expect(result.downstreamInput.pre_handoff_items).toHaveLength(1);
    expect(result.downstreamInput.pre_handoff_items[0]?.content).toBe("async-filtered");
  });
});

// ── defaultNestHandoffHistoryFilter — explicit export ─

describe("defaultNestHandoffHistoryFilter", () => {
  it("is equivalent to calling nestHandoffHistory directly", async () => {
    const data: HandoffInputData = {
      input_history: [msg("user", "hi")],
      pre_handoff_items: [],
      new_items: [toolCall("x", "{}"), msg("assistant", "ok")],
    };
    const viaFilter = await defaultNestHandoffHistoryFilter(data);
    const viaDirect = nestHandoffHistory(data);
    expect(JSON.stringify(viaFilter)).toBe(JSON.stringify(viaDirect));
  });
});
