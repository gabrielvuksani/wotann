import { describe, it, expect, beforeEach } from "vitest";
import {
  DanglingToolCallMiddleware,
  createDanglingToolCallMiddleware,
} from "../../src/middleware/dangling-tool-call.js";
import type { AgentMessage } from "../../src/core/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";

function makeCtx(history: readonly AgentMessage[]): MiddlewareContext {
  return {
    sessionId: "session-1",
    userMessage: "test",
    recentHistory: history,
    workingDir: "/tmp/test",
  };
}

function userMsg(content: string): AgentMessage {
  return { role: "user", content };
}

function toolUseMsg(toolCallId: string, toolName: string): AgentMessage {
  return { role: "assistant", content: `calling ${toolName}`, toolCallId, toolName };
}

function toolResultMsg(toolCallId: string, toolName: string): AgentMessage {
  return { role: "tool", content: "ok", toolCallId, toolName };
}

describe("DanglingToolCallMiddleware", () => {
  let instance: DanglingToolCallMiddleware;

  beforeEach(() => {
    instance = new DanglingToolCallMiddleware();
  });

  it("returns original history when no patching is needed", () => {
    const history: readonly AgentMessage[] = [
      userMsg("hi"),
      toolUseMsg("call-1", "Bash"),
      toolResultMsg("call-1", "Bash"),
    ];
    const { history: out, patches } = instance.patch(history);
    expect(out).toBe(history);
    expect(patches).toHaveLength(0);
  });

  it("inserts a placeholder immediately after the dangling assistant message", () => {
    const history: readonly AgentMessage[] = [
      userMsg("please help"),
      toolUseMsg("call-1", "Bash"), // dangling — no tool result follows
      userMsg("never mind"),
    ];
    const { history: out, patches } = instance.patch(history);
    expect(out).toHaveLength(4);
    expect(out[2]!.role).toBe("tool");
    expect(out[2]!.toolCallId).toBe("call-1");
    expect(out[2]!.toolName).toBe("Bash");
    expect(out[2]!.content).toContain("interrupted");
    expect(out[3]!).toEqual(history[2]!);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.afterIndex).toBe(1);
  });

  it("handles multiple dangling tool calls across separate assistant turns", () => {
    const history: readonly AgentMessage[] = [
      toolUseMsg("call-1", "Bash"),
      toolUseMsg("call-2", "Read"),
      toolResultMsg("call-2", "Read"),
      toolUseMsg("call-3", "Write"),
    ];
    const { history: out, patches } = instance.patch(history);
    expect(patches).toHaveLength(2);
    const patchedIds = patches.map((p) => p.toolCallId);
    expect(patchedIds).toContain("call-1");
    expect(patchedIds).toContain("call-3");
    expect(out.length).toBe(history.length + 2);
  });

  it("pipeline adapter appends trace to cachedResponse", () => {
    const middleware = createDanglingToolCallMiddleware(instance);
    const history: readonly AgentMessage[] = [toolUseMsg("call-1", "Bash")];
    const ctx = makeCtx(history);
    const next = middleware.before!(ctx) as MiddlewareContext;
    expect(next.cachedResponse).toContain("[DanglingToolCall]");
    expect(next.cachedResponse).toContain("call-1");
  });

  it("pipeline adapter has correct name and order", () => {
    const middleware = createDanglingToolCallMiddleware(instance);
    expect(middleware.name).toBe("DanglingToolCall");
    expect(middleware.order).toBe(4.5);
  });

  it("tracks stats across scans and patches", () => {
    instance.patch([toolUseMsg("a", "Bash")]);
    instance.patch([toolUseMsg("b", "Read"), toolResultMsg("b", "Read")]);
    instance.patch([toolUseMsg("c", "Write")]);
    const stats = instance.getStats();
    expect(stats.totalScans).toBe(3);
    expect(stats.totalPatches).toBe(2);
    instance.reset();
    expect(instance.getStats().totalScans).toBe(0);
  });
});
