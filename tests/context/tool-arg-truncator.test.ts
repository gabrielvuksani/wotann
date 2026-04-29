import { describe, it, expect } from "vitest";
import {
  truncateToolArgs,
  shouldTriggerStage0,
  DEFAULT_TRUNCATE_ARGS,
  type TruncatableMessage,
} from "../../src/context/tool-arg-truncator.js";
import { applyStage0PressureRelief } from "../../src/context/maximizer.js";
import { applyStage0Truncation } from "../../src/core/runtime-intelligence.js";

interface TestMsg extends TruncatableMessage {
  readonly role: string;
  readonly content: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
}

function msg(role: string, content: string, toolCallId?: string): TestMsg {
  return { role, content, ...(toolCallId !== undefined ? { toolCallId } : {}) };
}

const BIG = "x".repeat(5000);
const SMALL = "y".repeat(50);

describe("truncateToolArgs — keep-window", () => {
  it("returns original messages when total <= MIN_KEEP_COUNT", () => {
    const messages: TestMsg[] = [msg("tool", BIG), msg("tool", BIG)];
    const result = truncateToolArgs(messages);
    expect(result.bytesReclaimed).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  it("keeps the last 10% (>=2) untouched and clips the rest", () => {
    // 20 messages, keepFrac 0.1 → keep last 2.
    const messages: TestMsg[] = Array.from({ length: 20 }, (_, i) =>
      msg("tool", BIG, `call-${i}`),
    );
    const result = truncateToolArgs(messages);
    expect(result.bytesReclaimed).toBeGreaterThan(0);
    // Last 2 untouched.
    expect(result.messages[18]?.content).toBe(BIG);
    expect(result.messages[19]?.content).toBe(BIG);
    // First 18 clipped.
    for (let i = 0; i < 18; i++) {
      expect(result.messages[i]?.content.length).toBeLessThan(BIG.length);
    }
    // IDs preserved.
    expect(result.messages[0]?.toolCallId).toBe("call-0");
    expect(result.messages[19]?.toolCallId).toBe("call-19");
    expect(result.messagesAffected).toBe(18);
  });

  it("preserves message ordering, role, and toolName/toolCallId on clipped entries", () => {
    const messages: TestMsg[] = [
      { role: "tool", content: BIG, toolName: "write_file", toolCallId: "id-1" },
      { role: "tool", content: BIG, toolName: "edit_file", toolCallId: "id-2" },
      { role: "user", content: "what next?" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "go" },
    ];
    const result = truncateToolArgs(messages);
    expect(result.messages[0]?.role).toBe("tool");
    expect(result.messages[0]?.toolName).toBe("write_file");
    expect(result.messages[0]?.toolCallId).toBe("id-1");
    expect(result.messages[1]?.role).toBe("tool");
    expect(result.messages[1]?.toolName).toBe("edit_file");
    expect(result.messages[1]?.toolCallId).toBe("id-2");
    expect(result.messages.length).toBe(messages.length);
  });
});

describe("truncateToolArgs — selective by role", () => {
  it("never truncates user or system messages even when long", () => {
    const messages: TestMsg[] = [
      msg("user", BIG),
      msg("system", BIG),
      msg("tool", BIG),
      msg("tool", BIG),
      msg("user", SMALL),
      msg("user", SMALL),
    ];
    const result = truncateToolArgs(messages);
    expect(result.messages[0]?.content).toBe(BIG); // user stays
    expect(result.messages[1]?.content).toBe(BIG); // system stays
    expect(result.messages[2]?.content.length).toBeLessThan(BIG.length); // tool clipped
    expect(result.messages[3]?.content.length).toBeLessThan(BIG.length); // tool clipped
  });

  it("clips long assistant messages (model-side tool_use payloads)", () => {
    const messages: TestMsg[] = [
      msg("assistant", BIG),
      msg("assistant", BIG),
      msg("user", SMALL),
      msg("user", SMALL),
    ];
    const result = truncateToolArgs(messages);
    expect(result.messages[0]?.content.length).toBeLessThan(BIG.length);
    expect(result.messagesAffected).toBeGreaterThan(0);
  });
});

describe("truncateToolArgs — JSON-aware shape preservation", () => {
  it("collapses long string values inside JSON object payloads", () => {
    const payload = JSON.stringify({ path: "/etc/foo", content: BIG, marker: "ok" });
    const messages: TestMsg[] = [
      msg("tool", payload),
      msg("tool", payload),
      msg("user", SMALL),
      msg("user", SMALL),
    ];
    const result = truncateToolArgs(messages);
    expect(result.messagesAffected).toBeGreaterThan(0);
    const parsed = JSON.parse(result.messages[0]?.content ?? "{}");
    // Path is short — kept. Content is huge — clipped.
    expect(parsed.path).toBe("/etc/foo");
    expect(parsed.content).toBe(DEFAULT_TRUNCATE_ARGS.clipMarker);
    expect(parsed.marker).toBe("ok");
  });

  it("collapses long arrays to a single-element marker array", () => {
    const payload = JSON.stringify(Array.from({ length: 200 }, () => BIG));
    const messages: TestMsg[] = [
      msg("tool", payload),
      msg("tool", payload),
      msg("user", SMALL),
      msg("user", SMALL),
    ];
    const result = truncateToolArgs(messages);
    const parsed = JSON.parse(result.messages[0]?.content ?? "[]");
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("flat-clips non-JSON content (head + marker + tail)", () => {
    const messages: TestMsg[] = [
      msg("tool", BIG),
      msg("tool", BIG),
      msg("user", SMALL),
      msg("user", SMALL),
    ];
    const result = truncateToolArgs(messages);
    const clipped = result.messages[0]?.content ?? "";
    expect(clipped).toContain(DEFAULT_TRUNCATE_ARGS.clipMarker);
    expect(clipped.length).toBeLessThan(BIG.length);
    // Head should still start with x's.
    expect(clipped.startsWith("x")).toBe(true);
  });
});

describe("truncateToolArgs — immutability", () => {
  it("does not mutate the input array or its messages", () => {
    const original: TestMsg[] = [
      msg("tool", BIG),
      msg("tool", BIG),
      msg("user", SMALL),
      msg("user", SMALL),
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    truncateToolArgs(original);
    expect(original).toEqual(snapshot);
  });
});

describe("shouldTriggerStage0 + applyStage0PressureRelief", () => {
  it("does not fire below the trigger threshold", () => {
    expect(shouldTriggerStage0(100, 1000)).toBe(false);
    const result = applyStage0PressureRelief(
      [msg("tool", BIG), msg("tool", BIG), msg("user", SMALL), msg("user", SMALL)],
      100,
      1000,
    );
    expect(result.triggered).toBe(false);
    expect(result.bytesReclaimed).toBe(0);
  });

  it("fires inside the Stage-0 band (>=50% and <85%)", () => {
    expect(shouldTriggerStage0(600, 1000)).toBe(true);
    const result = applyStage0PressureRelief(
      [msg("tool", BIG), msg("tool", BIG), msg("user", SMALL), msg("user", SMALL)],
      600,
      1000,
    );
    expect(result.triggered).toBe(true);
    expect(result.bytesReclaimed).toBeGreaterThan(0);
  });

  it("steps aside above the Stage-1 threshold", () => {
    expect(shouldTriggerStage0(900, 1000)).toBe(false);
    const result = applyStage0PressureRelief(
      [msg("tool", BIG), msg("tool", BIG), msg("user", SMALL), msg("user", SMALL)],
      900,
      1000,
    );
    expect(result.triggered).toBe(false);
  });

  it("returns triggered=false when disabled in config", () => {
    const result = applyStage0PressureRelief(
      [msg("tool", BIG), msg("tool", BIG), msg("user", SMALL), msg("user", SMALL)],
      600,
      1000,
      {
        enabled: false,
        triggerFrac: 0.5,
        keepFrac: 0.1,
        maxArgLen: 2000,
        clipMarker: "<...argument truncated>",
        stage1Frac: 0.85,
      },
    );
    expect(result.triggered).toBe(false);
  });
});

describe("applyStage0Truncation (runtime entry point)", () => {
  it("returns AgentMessage-typed result with telemetry counts", () => {
    const messages = [
      msg("tool", BIG),
      msg("tool", BIG),
      msg("tool", BIG),
      msg("user", SMALL),
      msg("user", SMALL),
    ];
    // Cast through unknown is fine here — TestMsg is structurally compatible
    // with AgentMessage for the fields the truncator inspects.
    const result = applyStage0Truncation(
      messages as unknown as Parameters<typeof applyStage0Truncation>[0],
      550,
      1000,
    );
    expect(result.triggered).toBe(true);
    expect(result.messagesAffected).toBeGreaterThan(0);
    expect(result.bytesReclaimed).toBeGreaterThan(0);
  });

  it("returns originals when not triggered", () => {
    const messages = [msg("tool", BIG), msg("tool", BIG)];
    const result = applyStage0Truncation(
      messages as unknown as Parameters<typeof applyStage0Truncation>[0],
      100,
      1000,
    );
    expect(result.triggered).toBe(false);
    expect(result.messages).toBe(messages); // identity preserved when no work done
  });
});
