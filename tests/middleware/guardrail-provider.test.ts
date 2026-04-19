import { describe, it, expect, beforeEach } from "vitest";
import {
  GuardrailProviderMiddleware,
  AllowlistProvider,
  createGuardrailProviderMiddleware,
  type GuardrailDecision,
  type GuardrailProvider,
  type GuardrailRequest,
} from "../../src/middleware/guardrail-provider.js";
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

function toolUseMsg(toolCallId: string, toolName: string): AgentMessage {
  return { role: "assistant", content: `calling ${toolName}`, toolCallId, toolName };
}

describe("AllowlistProvider", () => {
  it("allows a tool present on the allowlist", () => {
    const provider = new AllowlistProvider({ allowedTools: ["Bash", "Read"] });
    const decision = provider.evaluate({
      toolName: "Bash",
      toolInput: {},
      toolCallId: "t1",
      timestamp: "",
    });
    expect(decision.allow).toBe(true);
  });

  it("denies a tool missing from the allowlist", () => {
    const provider = new AllowlistProvider({ allowedTools: ["Bash"] });
    const decision = provider.evaluate({
      toolName: "Write",
      toolInput: {},
      toolCallId: "t1",
      timestamp: "",
    });
    expect(decision.allow).toBe(false);
    expect(decision.reasons[0]!.code).toBe("oap.tool_not_allowed");
  });

  it("denies a tool that appears on the denylist even if allowlisted", () => {
    const provider = new AllowlistProvider({
      allowedTools: ["Bash"],
      deniedTools: ["Bash"],
    });
    const decision = provider.evaluate({
      toolName: "Bash",
      toolInput: {},
      toolCallId: "t1",
      timestamp: "",
    });
    expect(decision.allow).toBe(false);
  });
});

describe("GuardrailProviderMiddleware", () => {
  let instance: GuardrailProviderMiddleware;

  beforeEach(() => {
    instance = new GuardrailProviderMiddleware(new AllowlistProvider({ allowedTools: ["Read"] }));
  });

  it("denies a tool call when provider disallows it", async () => {
    const { decision } = await instance.evaluateToolCall("Bash", {}, "call-1");
    expect(decision.allow).toBe(false);
    expect(instance.getStats().totalDenied).toBe(1);
  });

  it("fails closed by default when the provider throws", async () => {
    const throwingProvider: GuardrailProvider = {
      name: "throwing",
      evaluate(_request: GuardrailRequest): GuardrailDecision {
        throw new Error("boom");
      },
    };
    const closed = new GuardrailProviderMiddleware(throwingProvider);
    const { decision, hadError } = await closed.evaluateToolCall("Bash", {}, "call-1");
    expect(hadError).toBe(true);
    expect(decision.allow).toBe(false);
    expect(decision.reasons[0]!.code).toBe("oap.evaluator_error");
    expect(closed.getStats().totalProviderErrors).toBe(1);
  });

  it("fails open when configured to do so", async () => {
    const throwingProvider: GuardrailProvider = {
      name: "throwing",
      evaluate(_request: GuardrailRequest): GuardrailDecision {
        throw new Error("boom");
      },
    };
    const open = new GuardrailProviderMiddleware(throwingProvider, { failClosed: false });
    const { decision, hadError } = await open.evaluateToolCall("Bash", {}, "call-1");
    expect(hadError).toBe(true);
    expect(decision.allow).toBe(true);
  });

  it("injects a synthetic tool result for denied pending tool uses", async () => {
    const middleware = createGuardrailProviderMiddleware(instance);
    const history: readonly AgentMessage[] = [toolUseMsg("call-1", "Bash")];
    const ctx = makeCtx(history);
    const next = await middleware.before!(ctx);
    expect(next.recentHistory).toHaveLength(2);
    const tool = next.recentHistory[1]!;
    expect(tool.role).toBe("tool");
    expect(tool.toolCallId).toBe("call-1");
    expect(tool.content).toContain("Guardrail denied");
  });

  it("leaves history unchanged when all pending tool uses are allowed", async () => {
    const permissive = new GuardrailProviderMiddleware(new AllowlistProvider({}));
    const middleware = createGuardrailProviderMiddleware(permissive);
    const history: readonly AgentMessage[] = [toolUseMsg("call-1", "Read")];
    const ctx = makeCtx(history);
    const next = await middleware.before!(ctx);
    expect(next.recentHistory).toHaveLength(1);
  });

  it("has correct name and order and resets stats", async () => {
    const middleware = createGuardrailProviderMiddleware(instance);
    expect(middleware.name).toBe("GuardrailProvider");
    expect(middleware.order).toBe(5.5);
    await instance.evaluateToolCall("Bash", {}, "call-1");
    instance.reset();
    const stats = instance.getStats();
    expect(stats.totalEvaluations).toBe(0);
    expect(stats.totalDenied).toBe(0);
    expect(stats.totalProviderErrors).toBe(0);
  });
});
