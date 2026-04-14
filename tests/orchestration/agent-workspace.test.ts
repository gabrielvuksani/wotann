import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  AgentWorkspace,
  type WorkspaceMessage,
} from "../../src/orchestration/agent-workspace.js";

const TEST_WORKSPACE = join(
  process.cwd(),
  "tests",
  "orchestration",
  ".test-workspace-agent-workspace",
);

function cleanupWorkspace(): void {
  if (existsSync(TEST_WORKSPACE)) {
    rmSync(TEST_WORKSPACE, { recursive: true });
  }
}

describe("AgentWorkspace", () => {
  beforeEach(() => {
    cleanupWorkspace();
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    return () => cleanupWorkspace();
  });

  function createWorkspace(): AgentWorkspace {
    return new AgentWorkspace(TEST_WORKSPACE);
  }

  // -- write() --------------------------------------------------------------

  describe("write", () => {
    it("writes a message and returns an ID", () => {
      const ws = createWorkspace();
      const id = ws.write({
        fromAgent: "planner",
        toAgent: "worker-1",
        type: "request",
        content: { task: "implement auth" },
      });

      expect(id).toMatch(/^msg_/);
    });

    it("persists the message to disk", () => {
      const ws = createWorkspace();
      const id = ws.write({
        fromAgent: "planner",
        toAgent: "worker-1",
        type: "result",
        content: "completed",
      });

      const msg = ws.readMessage(id);
      expect(msg).not.toBeNull();
      expect(msg?.fromAgent).toBe("planner");
      expect(msg?.toAgent).toBe("worker-1");
      expect(msg?.type).toBe("result");
      expect(msg?.content).toBe("completed");
    });

    it("assigns timestamps automatically", () => {
      const ws = createWorkspace();
      const before = Date.now();
      const id = ws.write({
        fromAgent: "agent-a",
        toAgent: "agent-b",
        type: "status",
        content: "running",
      });
      const after = Date.now();

      const msg = ws.readMessage(id);
      expect(msg?.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg?.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // -- readFor() ------------------------------------------------------------

  describe("readFor", () => {
    it("reads messages addressed to a specific agent", () => {
      const ws = createWorkspace();

      ws.write({ fromAgent: "a", toAgent: "worker-1", type: "request", content: "task 1" });
      ws.write({ fromAgent: "a", toAgent: "worker-2", type: "request", content: "task 2" });
      ws.write({ fromAgent: "a", toAgent: "worker-1", type: "request", content: "task 3" });

      const msgs = ws.readFor("worker-1");
      expect(msgs.length).toBe(2);
      expect(msgs.every((m) => m.toAgent === "worker-1")).toBe(true);
    });

    it("includes broadcast messages", () => {
      const ws = createWorkspace();

      ws.write({ fromAgent: "coordinator", toAgent: "broadcast", type: "status", content: "starting" });
      ws.write({ fromAgent: "coordinator", toAgent: "worker-1", type: "request", content: "task" });

      const msgs = ws.readFor("worker-1");
      expect(msgs.length).toBe(2);
    });

    it("filters by since timestamp", () => {
      const ws = createWorkspace();

      ws.write({ fromAgent: "a", toAgent: "worker-1", type: "request", content: "old" });
      const cutoff = Date.now();
      // Small delay to ensure different timestamps
      ws.write({ fromAgent: "a", toAgent: "worker-1", type: "request", content: "new" });

      const msgs = ws.readFor("worker-1", cutoff);
      // May get 0 or 1 depending on timing, but should not include messages before cutoff
      for (const msg of msgs) {
        expect(msg.timestamp).toBeGreaterThan(cutoff);
      }
    });

    it("returns empty for agents with no messages", () => {
      const ws = createWorkspace();
      ws.write({ fromAgent: "a", toAgent: "worker-1", type: "request", content: "task" });

      const msgs = ws.readFor("worker-99");
      expect(msgs.length).toBe(0);
    });
  });

  // -- readBroadcasts() -----------------------------------------------------

  describe("readBroadcasts", () => {
    it("reads only broadcast messages", () => {
      const ws = createWorkspace();

      ws.write({ fromAgent: "coordinator", toAgent: "broadcast", type: "status", content: "hello" });
      ws.write({ fromAgent: "coordinator", toAgent: "worker-1", type: "request", content: "task" });
      ws.write({ fromAgent: "coordinator", toAgent: "broadcast", type: "status", content: "done" });

      const broadcasts = ws.readBroadcasts();
      expect(broadcasts.length).toBe(2);
      expect(broadcasts.every((m) => m.toAgent === "broadcast")).toBe(true);
    });

    it("filters broadcasts by since timestamp", () => {
      const ws = createWorkspace();

      ws.write({ fromAgent: "a", toAgent: "broadcast", type: "status", content: "old" });
      const cutoff = Date.now();

      const broadcasts = ws.readBroadcasts(cutoff);
      for (const msg of broadcasts) {
        expect(msg.timestamp).toBeGreaterThan(cutoff);
      }
    });
  });

  // -- readMessage() --------------------------------------------------------

  describe("readMessage", () => {
    it("reads a specific message by ID", () => {
      const ws = createWorkspace();
      const id = ws.write({
        fromAgent: "planner",
        toAgent: "worker-1",
        type: "result",
        content: { code: "function foo() {}", lines: 42 },
      });

      const msg = ws.readMessage(id);
      expect(msg?.id).toBe(id);
      expect(msg?.fromAgent).toBe("planner");
      expect(msg?.content).toEqual({ code: "function foo() {}", lines: 42 });
    });

    it("returns null for nonexistent message ID", () => {
      const ws = createWorkspace();
      expect(ws.readMessage("msg_nonexistent")).toBeNull();
    });
  });

  // -- cleanup() ------------------------------------------------------------

  describe("cleanup", () => {
    it("removes messages older than the threshold", () => {
      const ws = createWorkspace();

      ws.write({ fromAgent: "a", toAgent: "b", type: "result", content: "data" });
      ws.write({ fromAgent: "a", toAgent: "c", type: "result", content: "data" });

      // Cleanup with threshold 0 (remove everything)
      const removed = ws.cleanup(0);
      expect(removed).toBe(2);

      const stats = ws.getStats();
      expect(stats.messageCount).toBe(0);
    });

    it("preserves recent messages", () => {
      const ws = createWorkspace();

      ws.write({ fromAgent: "a", toAgent: "b", type: "result", content: "data" });

      // Cleanup with 1 hour threshold -- messages are recent, should survive
      const removed = ws.cleanup(3_600_000);
      expect(removed).toBe(0);
    });

    it("returns 0 when workspace is empty", () => {
      const ws = createWorkspace();
      expect(ws.cleanup()).toBe(0);
    });
  });

  // -- getStats() -----------------------------------------------------------

  describe("getStats", () => {
    it("returns zero stats for empty workspace", () => {
      const ws = createWorkspace();
      const stats = ws.getStats();

      expect(stats.messageCount).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });

    it("counts messages and total size", () => {
      const ws = createWorkspace();

      ws.write({ fromAgent: "a", toAgent: "b", type: "result", content: "hello" });
      ws.write({ fromAgent: "a", toAgent: "c", type: "result", content: "world" });

      const stats = ws.getStats();
      expect(stats.messageCount).toBe(2);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
    });
  });

  // -- getWorkspacePath() ---------------------------------------------------

  describe("getWorkspacePath", () => {
    it("returns the full path to the workspace directory", () => {
      const ws = createWorkspace();
      expect(ws.getWorkspacePath()).toContain(".wotann/agent-workspace");
    });
  });

  // -- complex content types ------------------------------------------------

  describe("complex content types", () => {
    it("handles nested object content", () => {
      const ws = createWorkspace();
      const content = {
        analysis: {
          files: ["src/auth.ts", "src/router.ts"],
          issues: [{ line: 42, severity: "high", message: "SQL injection" }],
        },
        summary: "Found 1 critical issue",
      };

      const id = ws.write({
        fromAgent: "reviewer",
        toAgent: "coordinator",
        type: "result",
        content,
      });

      const msg = ws.readMessage(id);
      expect(msg?.content).toEqual(content);
    });

    it("handles array content", () => {
      const ws = createWorkspace();
      const id = ws.write({
        fromAgent: "agent",
        toAgent: "broadcast",
        type: "result",
        content: [1, 2, 3, "four", { five: true }],
      });

      const msg = ws.readMessage(id);
      expect(msg?.content).toEqual([1, 2, 3, "four", { five: true }]);
    });

    it("handles null content", () => {
      const ws = createWorkspace();
      const id = ws.write({
        fromAgent: "agent",
        toAgent: "broadcast",
        type: "error",
        content: null,
      });

      const msg = ws.readMessage(id);
      expect(msg?.content).toBeNull();
    });

    it("handles string content", () => {
      const ws = createWorkspace();
      const id = ws.write({
        fromAgent: "agent",
        toAgent: "broadcast",
        type: "status",
        content: "Processing step 3 of 5",
      });

      const msg = ws.readMessage(id);
      expect(msg?.content).toBe("Processing step 3 of 5");
    });
  });
});
