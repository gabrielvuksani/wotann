import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentHierarchyManager,
  type AgentNode,
} from "../../src/orchestration/agent-hierarchy.js";

describe("AgentHierarchyManager", () => {
  let manager: AgentHierarchyManager;

  beforeEach(() => {
    manager = new AgentHierarchyManager(2);
  });

  // -- registerAgent() ------------------------------------------------------

  describe("registerAgent", () => {
    it("registers a root agent at depth 0", () => {
      const node = manager.registerAgent("root", null, "coordinate sub-agents");

      expect(node.id).toBe("root");
      expect(node.parentId).toBeNull();
      expect(node.depth).toBe(0);
      expect(node.taskDescription).toBe("coordinate sub-agents");
      expect(node.status).toBe("pending");
      expect(node.childIds).toEqual([]);
    });

    it("registers a child agent at depth 1", () => {
      manager.registerAgent("root", null, "parent");
      const child = manager.registerAgent("worker-1", "root", "process data");

      expect(child.id).toBe("worker-1");
      expect(child.parentId).toBe("root");
      expect(child.depth).toBe(1);
    });

    it("updates parent's childIds when registering a child", () => {
      manager.registerAgent("root", null, "parent");
      manager.registerAgent("worker-1", "root", "task A");
      manager.registerAgent("worker-2", "root", "task B");

      const root = manager.getAgent("root");
      expect(root?.childIds).toEqual(["worker-1", "worker-2"]);
    });

    it("throws when registering at depth >= maxDepth", () => {
      manager.registerAgent("root", null, "parent");
      manager.registerAgent("child", "root", "child task");

      expect(() => {
        manager.registerAgent("grandchild", "child", "grandchild task");
      }).toThrow(/max depth/i);
    });

    it("throws when registering a duplicate ID", () => {
      manager.registerAgent("agent-1", null, "task");

      expect(() => {
        manager.registerAgent("agent-1", null, "duplicate");
      }).toThrow(/already registered/i);
    });

    it("throws when parent does not exist", () => {
      expect(() => {
        manager.registerAgent("orphan", "nonexistent", "orphan task");
      }).toThrow(/not found/i);
    });

    it("allows deeper hierarchies with higher maxDepth", () => {
      const deepManager = new AgentHierarchyManager(4);

      deepManager.registerAgent("L0", null, "root");
      deepManager.registerAgent("L1", "L0", "level 1");
      deepManager.registerAgent("L2", "L1", "level 2");
      const L3 = deepManager.registerAgent("L3", "L2", "level 3");

      expect(L3.depth).toBe(3);
    });

    it("rejects maxDepth < 1", () => {
      expect(() => new AgentHierarchyManager(0)).toThrow(/must be >= 1/);
    });
  });

  // -- canSpawnChild() ------------------------------------------------------

  describe("canSpawnChild", () => {
    it("returns true for root agents in a 2-level hierarchy", () => {
      manager.registerAgent("root", null, "parent");
      expect(manager.canSpawnChild("root")).toBe(true);
    });

    it("returns false for depth-1 agents in a 2-level hierarchy", () => {
      manager.registerAgent("root", null, "parent");
      manager.registerAgent("child", "root", "child task");
      expect(manager.canSpawnChild("child")).toBe(false);
    });

    it("returns false for nonexistent agents", () => {
      expect(manager.canSpawnChild("ghost")).toBe(false);
    });
  });

  // -- getTree() ------------------------------------------------------------

  describe("getTree", () => {
    it("returns all registered agents", () => {
      manager.registerAgent("root", null, "parent");
      manager.registerAgent("worker-1", "root", "task A");
      manager.registerAgent("worker-2", "root", "task B");

      const tree = manager.getTree();
      expect(tree.length).toBe(3);

      const ids = tree.map((n) => n.id);
      expect(ids).toContain("root");
      expect(ids).toContain("worker-1");
      expect(ids).toContain("worker-2");
    });

    it("returns empty array when no agents registered", () => {
      expect(manager.getTree()).toEqual([]);
    });
  });

  // -- getAtDepth() ---------------------------------------------------------

  describe("getAtDepth", () => {
    it("returns only agents at the specified depth", () => {
      manager.registerAgent("root", null, "parent");
      manager.registerAgent("w1", "root", "task A");
      manager.registerAgent("w2", "root", "task B");

      const depth0 = manager.getAtDepth(0);
      expect(depth0.length).toBe(1);
      expect(depth0[0]?.id).toBe("root");

      const depth1 = manager.getAtDepth(1);
      expect(depth1.length).toBe(2);
    });

    it("returns empty for unused depths", () => {
      manager.registerAgent("root", null, "parent");
      expect(manager.getAtDepth(5)).toEqual([]);
    });
  });

  // -- updateStatus() -------------------------------------------------------

  describe("updateStatus", () => {
    it("updates agent status to running", () => {
      manager.registerAgent("agent", null, "task");
      manager.updateStatus("agent", "running");

      const node = manager.getAgent("agent");
      expect(node?.status).toBe("running");
    });

    it("updates agent status to completed", () => {
      manager.registerAgent("agent", null, "task");
      manager.updateStatus("agent", "completed");

      const node = manager.getAgent("agent");
      expect(node?.status).toBe("completed");
    });

    it("updates agent status to failed", () => {
      manager.registerAgent("agent", null, "task");
      manager.updateStatus("agent", "failed");

      const node = manager.getAgent("agent");
      expect(node?.status).toBe("failed");
    });

    it("throws when updating a nonexistent agent", () => {
      expect(() => manager.updateStatus("ghost", "running")).toThrow(/not found/i);
    });
  });

  // -- getActiveCount() -----------------------------------------------------

  describe("getActiveCount", () => {
    it("counts pending and running agents", () => {
      manager.registerAgent("a1", null, "task");
      manager.registerAgent("a2", null, "task");
      manager.registerAgent("a3", null, "task");

      manager.updateStatus("a1", "running");
      manager.updateStatus("a3", "completed");

      // a1 = running, a2 = pending, a3 = completed
      expect(manager.getActiveCount()).toBe(2);
    });

    it("returns 0 when all agents are done", () => {
      manager.registerAgent("a1", null, "task");
      manager.updateStatus("a1", "completed");
      expect(manager.getActiveCount()).toBe(0);
    });
  });

  // -- getChildren() --------------------------------------------------------

  describe("getChildren", () => {
    it("returns children of a parent agent", () => {
      manager.registerAgent("root", null, "parent");
      manager.registerAgent("c1", "root", "child 1");
      manager.registerAgent("c2", "root", "child 2");

      const children = manager.getChildren("root");
      expect(children.length).toBe(2);
      expect(children.map((c) => c.id)).toEqual(["c1", "c2"]);
    });

    it("returns empty for agents with no children", () => {
      manager.registerAgent("root", null, "parent");
      manager.registerAgent("child", "root", "child");

      expect(manager.getChildren("child")).toEqual([]);
    });

    it("returns empty for nonexistent agents", () => {
      expect(manager.getChildren("ghost")).toEqual([]);
    });
  });

  // -- getSummary() ---------------------------------------------------------

  describe("getSummary", () => {
    it("returns accurate summary statistics", () => {
      manager.registerAgent("root", null, "parent");
      manager.registerAgent("w1", "root", "task 1");
      manager.registerAgent("w2", "root", "task 2");

      manager.updateStatus("root", "running");
      manager.updateStatus("w1", "completed");
      manager.updateStatus("w2", "failed");

      const summary = manager.getSummary();
      expect(summary.totalAgents).toBe(3);
      expect(summary.activeAgents).toBe(1);
      expect(summary.completedAgents).toBe(1);
      expect(summary.failedAgents).toBe(1);
      expect(summary.maxDepthReached).toBe(1);
      expect(summary.maxDepthAllowed).toBe(2);
    });

    it("returns zero summary when empty", () => {
      const summary = manager.getSummary();
      expect(summary.totalAgents).toBe(0);
      expect(summary.activeAgents).toBe(0);
      expect(summary.maxDepthReached).toBe(0);
    });
  });

  // -- getMaxDepth() --------------------------------------------------------

  describe("getMaxDepth", () => {
    it("returns the configured max depth", () => {
      expect(manager.getMaxDepth()).toBe(2);

      const deep = new AgentHierarchyManager(5);
      expect(deep.getMaxDepth()).toBe(5);
    });
  });
});
