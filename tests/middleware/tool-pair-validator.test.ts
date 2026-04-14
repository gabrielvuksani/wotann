import { describe, it, expect, beforeEach } from "vitest";
import {
  ToolPairValidatorMiddleware,
  createToolPairValidatorMiddleware,
} from "../../src/middleware/tool-pair-validator.js";
import type { AgentMessage } from "../../src/core/types.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";

function makeCtx(history: readonly AgentMessage[]): MiddlewareContext {
  return {
    sessionId: "test-session",
    userMessage: "test",
    recentHistory: history,
    workingDir: "/tmp/test",
  };
}

function toolUseMsg(toolCallId: string, toolName: string): AgentMessage {
  return {
    role: "assistant",
    content: `calling ${toolName}`,
    toolCallId,
    toolName,
  };
}

function toolResultMsg(toolCallId: string, toolName: string): AgentMessage {
  return {
    role: "tool",
    content: "result",
    toolCallId,
    toolName,
  };
}

function userMsg(content: string): AgentMessage {
  return { role: "user", content };
}

function assistantMsg(content: string): AgentMessage {
  return { role: "assistant", content };
}

describe("ToolPairValidatorMiddleware", () => {
  let instance: ToolPairValidatorMiddleware;

  beforeEach(() => {
    instance = new ToolPairValidatorMiddleware();
  });

  describe("validate()", () => {
    it("returns valid for empty history", () => {
      const result = instance.validate([]);

      expect(result.valid).toBe(true);
      expect(result.orphanedToolUses).toHaveLength(0);
    });

    it("returns valid for balanced tool_use/tool_result pairs", () => {
      const history: readonly AgentMessage[] = [
        userMsg("do something"),
        toolUseMsg("call-1", "Bash"),
        toolResultMsg("call-1", "Bash"),
        toolUseMsg("call-2", "Read"),
        toolResultMsg("call-2", "Read"),
      ];

      const result = instance.validate(history);
      expect(result.valid).toBe(true);
      expect(result.orphanedToolUses).toHaveLength(0);
    });

    it("detects orphaned tool_use without matching tool_result", () => {
      const history: readonly AgentMessage[] = [
        userMsg("do something"),
        toolUseMsg("call-1", "Bash"),
        // Missing tool_result for call-1
        toolUseMsg("call-2", "Read"),
        toolResultMsg("call-2", "Read"),
      ];

      const result = instance.validate(history);
      expect(result.valid).toBe(false);
      expect(result.orphanedToolUses).toHaveLength(1);
      expect(result.orphanedToolUses[0]!.toolCallId).toBe("call-1");
      expect(result.orphanedToolUses[0]!.toolName).toBe("Bash");
    });

    it("detects multiple orphaned tool_use blocks", () => {
      const history: readonly AgentMessage[] = [
        toolUseMsg("call-1", "Bash"),
        toolUseMsg("call-2", "Read"),
        toolUseMsg("call-3", "Write"),
        toolResultMsg("call-2", "Read"),
      ];

      const result = instance.validate(history);
      expect(result.valid).toBe(false);
      expect(result.orphanedToolUses).toHaveLength(2);

      const ids = result.orphanedToolUses.map((o) => o.toolCallId);
      expect(ids).toContain("call-1");
      expect(ids).toContain("call-3");
    });

    it("ignores assistant messages without toolCallId", () => {
      const history: readonly AgentMessage[] = [
        userMsg("hello"),
        assistantMsg("hi there"),
        toolUseMsg("call-1", "Bash"),
        toolResultMsg("call-1", "Bash"),
      ];

      const result = instance.validate(history);
      expect(result.valid).toBe(true);
    });

    it("tracks validation count in stats", () => {
      instance.validate([]);
      instance.validate([]);
      instance.validate([]);

      const stats = instance.getStats();
      expect(stats.totalValidations).toBe(3);
    });

    it("tracks orphan count in stats", () => {
      const history: readonly AgentMessage[] = [
        toolUseMsg("call-1", "Bash"),
        toolUseMsg("call-2", "Read"),
      ];

      instance.validate(history);

      const stats = instance.getStats();
      expect(stats.totalOrphansFound).toBe(2);
    });
  });

  describe("buildRepairMessages()", () => {
    it("builds synthetic tool_result for each orphan", () => {
      const orphans = [
        { toolCallId: "call-1", toolName: "Bash", index: 0 },
        { toolCallId: "call-3", toolName: "Write", index: 4 },
      ];

      const repairs = instance.buildRepairMessages(orphans);

      expect(repairs).toHaveLength(2);
      expect(repairs[0]!.role).toBe("tool");
      expect(repairs[0]!.toolCallId).toBe("call-1");
      expect(repairs[0]!.content).toContain("ToolPairValidator");
      expect(repairs[0]!.content).toContain("Bash");
      expect(repairs[1]!.toolCallId).toBe("call-3");
      expect(repairs[1]!.content).toContain("Write");
    });

    it("tracks repair count in stats", () => {
      const orphans = [
        { toolCallId: "call-1", toolName: "Bash", index: 0 },
      ];

      instance.buildRepairMessages(orphans);

      const stats = instance.getStats();
      expect(stats.totalRepairs).toBe(1);
    });

    it("returns empty array for no orphans", () => {
      const repairs = instance.buildRepairMessages([]);
      expect(repairs).toHaveLength(0);
    });
  });

  describe("reset()", () => {
    it("clears all statistics", () => {
      const history: readonly AgentMessage[] = [
        toolUseMsg("call-1", "Bash"),
      ];
      instance.validate(history);
      instance.buildRepairMessages([
        { toolCallId: "call-1", toolName: "Bash", index: 0 },
      ]);

      instance.reset();

      const stats = instance.getStats();
      expect(stats.totalValidations).toBe(0);
      expect(stats.totalRepairs).toBe(0);
      expect(stats.totalOrphansFound).toBe(0);
    });
  });

  describe("pipeline adapter", () => {
    it("passes through valid history unchanged", () => {
      const middleware = createToolPairValidatorMiddleware(instance);
      const history: readonly AgentMessage[] = [
        toolUseMsg("call-1", "Bash"),
        toolResultMsg("call-1", "Bash"),
      ];

      const ctx = makeCtx(history);
      const processed = middleware.before!(ctx) as MiddlewareContext;

      expect(processed.recentHistory).toHaveLength(2);
      expect(processed.cachedResponse).toBeUndefined();
    });

    it("injects synthetic results for orphaned tool_use blocks", () => {
      const middleware = createToolPairValidatorMiddleware(instance);
      const history: readonly AgentMessage[] = [
        toolUseMsg("call-1", "Bash"),
        // Missing tool_result
      ];

      const ctx = makeCtx(history);
      const processed = middleware.before!(ctx) as MiddlewareContext;

      // Original 1 message + 1 synthetic repair
      expect(processed.recentHistory).toHaveLength(2);
      const lastMsg = processed.recentHistory[1]!;
      expect(lastMsg.role).toBe("tool");
      expect(lastMsg.toolCallId).toBe("call-1");
      expect(lastMsg.content).toContain("ToolPairValidator");
    });

    it("appends trace to cachedResponse", () => {
      const middleware = createToolPairValidatorMiddleware(instance);
      const history: readonly AgentMessage[] = [
        toolUseMsg("call-1", "Bash"),
      ];

      const ctx = makeCtx(history);
      const processed = middleware.before!(ctx) as MiddlewareContext;

      expect(processed.cachedResponse).toContain("[ToolPairValidator]");
      expect(processed.cachedResponse).toContain("call-1");
    });

    it("appends to existing cachedResponse", () => {
      const middleware = createToolPairValidatorMiddleware(instance);
      const history: readonly AgentMessage[] = [
        toolUseMsg("call-1", "Bash"),
      ];

      const ctx: MiddlewareContext = {
        ...makeCtx(history),
        cachedResponse: "existing info",
      };
      const processed = middleware.before!(ctx) as MiddlewareContext;

      expect(processed.cachedResponse).toContain("existing info");
      expect(processed.cachedResponse).toContain("[ToolPairValidator]");
    });

    it("has correct name and order", () => {
      const middleware = createToolPairValidatorMiddleware(instance);
      expect(middleware.name).toBe("ToolPairValidator");
      expect(middleware.order).toBe(0);
    });
  });
});
