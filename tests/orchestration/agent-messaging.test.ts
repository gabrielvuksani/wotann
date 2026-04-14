import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentMessageBus,
  type AgentAddress,
  type DeliveryResult,
} from "../../src/orchestration/agent-messaging.js";

describe("AgentMessageBus", () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    bus = new AgentMessageBus();
  });

  // ── Registration ─────────────────────────────────────────

  describe("register", () => {
    it("registers an agent at a valid path", () => {
      const agent = bus.register("/root/planner", "planner");
      expect(agent.path).toBe("/root/planner");
      expect(agent.role).toBe("planner");
      expect(agent.status).toBe("idle");
    });

    it("rejects duplicate paths", () => {
      bus.register("/root/worker-1", "worker");
      expect(() => bus.register("/root/worker-1", "worker")).toThrow(
        "Agent path already registered",
      );
    });

    it("rejects invalid paths", () => {
      expect(() => bus.register("no-slash", "bad")).toThrow("Invalid agent path");
      expect(() => bus.register("", "bad")).toThrow("Invalid agent path");
      expect(() => bus.register("/Root/Upper", "bad")).toThrow("Invalid agent path");
    });

    it("accepts various valid path formats", () => {
      expect(bus.register("/root", "root").path).toBe("/root");
      expect(bus.register("/root/w-1", "w").path).toBe("/root/w-1");
      expect(bus.register("/root/deep/nested/agent", "deep").path).toBe(
        "/root/deep/nested/agent",
      );
    });
  });

  describe("unregister", () => {
    it("removes a registered agent", () => {
      bus.register("/root/temp", "temp");
      expect(bus.unregister("/root/temp")).toBe(true);
      expect(bus.getAgent("/root/temp")).toBeUndefined();
    });

    it("returns false for unknown agent", () => {
      expect(bus.unregister("/root/nonexistent")).toBe(false);
    });
  });

  describe("updateStatus", () => {
    it("transitions agent status", () => {
      bus.register("/root/worker", "worker");
      const updated = bus.updateStatus("/root/worker", "busy");
      expect(updated.status).toBe("busy");
    });

    it("throws for unregistered agent", () => {
      expect(() => bus.updateStatus("/root/ghost", "busy")).toThrow(
        "Agent not registered",
      );
    });
  });

  // ── Messaging ────────────────────────────────────────────

  describe("send", () => {
    it("delivers a message between registered agents", () => {
      bus.register("/root/sender", "sender");
      bus.register("/root/receiver", "receiver");

      const result = bus.send({
        from: "/root/sender",
        to: "/root/receiver",
        type: "task",
        content: "Do the thing",
      });

      expect(result.delivered).toBe(true);
      expect(result.messageId).toBeTruthy();
    });

    it("fails when sender is not registered", () => {
      bus.register("/root/receiver", "receiver");
      const result = bus.send({
        from: "/root/ghost",
        to: "/root/receiver",
        type: "task",
        content: "Hello",
      });

      expect(result.delivered).toBe(false);
      expect(result.reason).toContain("Sender not registered");
    });

    it("fails when recipient is not registered", () => {
      bus.register("/root/sender", "sender");
      const result = bus.send({
        from: "/root/sender",
        to: "/root/ghost",
        type: "task",
        content: "Hello",
      });

      expect(result.delivered).toBe(false);
      expect(result.reason).toContain("Recipient not registered");
    });

    it("allows broadcast to '*'", () => {
      bus.register("/root/sender", "sender");
      const result = bus.send({
        from: "/root/sender",
        to: "*",
        type: "status",
        content: "All clear",
      });

      expect(result.delivered).toBe(true);
    });

    it("includes metadata in messages", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");

      bus.send({
        from: "/root/a",
        to: "/root/b",
        type: "result",
        content: "Done",
        metadata: { duration: 42 },
      });

      const msgs = bus.getMessages("/root/b");
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.metadata).toEqual({ duration: 42 });
    });
  });

  describe("getMessages", () => {
    it("retrieves messages for a specific agent", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");
      bus.register("/root/c", "c");

      bus.send({ from: "/root/a", to: "/root/b", type: "task", content: "For B" });
      bus.send({ from: "/root/a", to: "/root/c", type: "task", content: "For C" });

      expect(bus.getMessages("/root/b")).toHaveLength(1);
      expect(bus.getMessages("/root/c")).toHaveLength(1);
    });

    it("includes broadcast messages", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");

      bus.send({ from: "/root/a", to: "*", type: "status", content: "Broadcast" });

      expect(bus.getMessages("/root/b")).toHaveLength(1);
      expect(bus.getMessages("/root/b")[0]?.content).toBe("Broadcast");
    });

    it("filters by timestamp", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");

      bus.send({ from: "/root/a", to: "/root/b", type: "task", content: "Old" });
      const cutoff = Date.now() + 1;
      bus.send({ from: "/root/a", to: "/root/b", type: "task", content: "New" });

      // The second message might have the same timestamp; this tests the filter path
      const filtered = bus.getMessages("/root/b", cutoff);
      expect(filtered.length).toBeLessThanOrEqual(1);
    });

    it("filters by message type", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");

      bus.send({ from: "/root/a", to: "/root/b", type: "task", content: "Task" });
      bus.send({ from: "/root/a", to: "/root/b", type: "error", content: "Error" });

      const tasks = bus.getMessages("/root/b", undefined, { type: "task" });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.type).toBe("task");
    });
  });

  describe("getSentMessages", () => {
    it("returns messages sent by an agent", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");

      bus.send({ from: "/root/a", to: "/root/b", type: "task", content: "Hello" });
      bus.send({ from: "/root/b", to: "/root/a", type: "result", content: "Done" });

      expect(bus.getSentMessages("/root/a")).toHaveLength(1);
      expect(bus.getSentMessages("/root/b")).toHaveLength(1);
    });
  });

  // ── Context Forking ────────��─────────────────────────────

  describe("forkContext", () => {
    it("forks context from parent to child", () => {
      bus.register("/root/parent", "parent");
      bus.register("/root/child", "child");

      const forked = bus.forkContext("/root/parent", "/root/child", "Some context data");

      expect(forked.parentPath).toBe("/root/parent");
      expect(forked.childPath).toBe("/root/child");
      expect(forked.contextSlice).toBe("Some context data");
      expect(forked.forkedAt).toBeGreaterThan(0);
    });

    it("sends a context message to the child", () => {
      bus.register("/root/parent", "parent");
      bus.register("/root/child", "child");

      bus.forkContext("/root/parent", "/root/child", "Context slice");

      const msgs = bus.getMessages("/root/child");
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.type).toBe("context");
      expect(msgs[0]?.content).toBe("Context slice");
    });

    it("throws when parent is not registered", () => {
      bus.register("/root/child", "child");
      expect(() =>
        bus.forkContext("/root/ghost", "/root/child", "data"),
      ).toThrow("Parent agent not registered");
    });

    it("throws when child is not registered", () => {
      bus.register("/root/parent", "parent");
      expect(() =>
        bus.forkContext("/root/parent", "/root/ghost", "data"),
      ).toThrow("Child agent not registered");
    });

    it("tracks forked contexts", () => {
      bus.register("/root/parent", "parent");
      bus.register("/root/child", "child");

      bus.forkContext("/root/parent", "/root/child", "Ctx");

      expect(bus.getForkedContexts("/root/parent")).toHaveLength(1);
      expect(bus.getForkedContexts("/root/child")).toHaveLength(1);
      expect(bus.getForkedContexts("/root/unrelated")).toHaveLength(0);
    });
  });

  // ── Agent Listing ───────────────��────────────────────────

  describe("listAgents", () => {
    it("lists all registered agents", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");

      const agents = bus.listAgents();
      expect(agents).toHaveLength(2);
    });

    it("filters by status", () => {
      bus.register("/root/idle-agent", "worker");
      bus.register("/root/busy-agent", "worker");
      bus.updateStatus("/root/busy-agent", "busy");

      expect(bus.listAgents("idle")).toHaveLength(1);
      expect(bus.listAgents("busy")).toHaveLength(1);
      expect(bus.listAgents("done")).toHaveLength(0);
    });
  });

  // ── Task Assignment ────────────────���─────────────────────

  describe("assignTask", () => {
    it("assigns a task and sets agent to busy", () => {
      bus.register("/root", "root");
      bus.register("/root/worker", "worker");

      const result = bus.assignTask("/root/worker", "Build feature X", [
        "src/feature.ts",
      ]);

      expect(result.delivered).toBe(true);
      expect(bus.getAgent("/root/worker")?.status).toBe("busy");
    });

    it("includes files in metadata", () => {
      bus.register("/root", "root");
      bus.register("/root/worker", "worker");

      bus.assignTask("/root/worker", "Task", ["a.ts", "b.ts"]);

      const msgs = bus.getMessages("/root/worker");
      expect(msgs).toHaveLength(1);
      expect((msgs[0]?.metadata as Record<string, unknown>)?.["files"]).toEqual([
        "a.ts",
        "b.ts",
      ]);
    });

    it("refuses to assign to a busy agent", () => {
      bus.register("/root/worker", "worker");
      bus.updateStatus("/root/worker", "busy");

      const result = bus.assignTask("/root/worker", "Task", []);
      expect(result.delivered).toBe(false);
      expect(result.reason).toContain("Agent is busy");
    });

    it("fails for unregistered agent", () => {
      const result = bus.assignTask("/root/ghost", "Task", []);
      expect(result.delivered).toBe(false);
      expect(result.reason).toContain("Agent not registered");
    });
  });

  // ── Broadcast ─────────��──────────────────────────────────

  describe("broadcast", () => {
    it("sends to all agents via broadcast address", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");
      bus.register("/root/c", "c");

      const result = bus.broadcast("/root/a", "status", "System update");
      expect(result.delivered).toBe(true);

      expect(bus.getMessages("/root/b")).toHaveLength(1);
      expect(bus.getMessages("/root/c")).toHaveLength(1);
    });
  });

  // ── Monitoring ─────────────��─────────────────────────────

  describe("monitoring", () => {
    it("tracks message count", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");

      bus.send({ from: "/root/a", to: "/root/b", type: "task", content: "1" });
      bus.send({ from: "/root/a", to: "/root/b", type: "task", content: "2" });

      expect(bus.getMessageCount()).toBe(2);
    });

    it("tracks agent count", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");
      expect(bus.getAgentCount()).toBe(2);

      bus.unregister("/root/a");
      expect(bus.getAgentCount()).toBe(1);
    });

    it("clears messages", () => {
      bus.register("/root/a", "a");
      bus.register("/root/b", "b");
      bus.send({ from: "/root/a", to: "/root/b", type: "task", content: "msg" });

      bus.clearMessages();
      expect(bus.getMessageCount()).toBe(0);
      expect(bus.getMessages("/root/b")).toHaveLength(0);
    });
  });
});
