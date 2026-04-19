import { describe, it, expect, beforeEach } from "vitest";
import {
  handleThreadFork,
  handleThreadRollback,
  handleThreadList,
  handleThreadSwitch,
  dispatchThreadMethod,
} from "../../src/acp/thread-handlers.js";
import { ConversationBranchManager } from "../../src/core/conversation-branching.js";

describe("ACP thread handlers", () => {
  let manager: ConversationBranchManager;
  const deps = {
    getManager: (sid: string) => (sid === "s1" ? manager : null),
  };

  beforeEach(() => {
    manager = new ConversationBranchManager();
    manager.addTurn("user", "q1");
    manager.addTurn("assistant", "a1");
    manager.addTurn("user", "q2");
  });

  describe("thread/fork", () => {
    it("forks a branch from current head", () => {
      const result = handleThreadFork(
        { sessionId: "s1", name: "experiment" },
        deps,
      );
      expect(result.name).toBe("experiment");
      expect(result.inheritedTurnCount).toBe(3);
    });

    it("throws when session has no manager", () => {
      expect(() =>
        handleThreadFork({ sessionId: "unknown", name: "x" }, deps),
      ).toThrow(/no branch manager/);
    });

    it("forks from a specific turn id", () => {
      const firstTurn = manager.getActiveBranch().turns[0]!;
      const result = handleThreadFork(
        { sessionId: "s1", name: "from-first", fromTurnId: firstTurn.id },
        deps,
      );
      expect(result.inheritedTurnCount).toBe(1);
    });
  });

  describe("thread/rollback", () => {
    it("rolls back N turns", () => {
      const result = handleThreadRollback({ sessionId: "s1", n: 2 }, deps);
      expect(result.droppedTurnCount).toBe(2);
      expect(manager.getActiveBranch().turns).toHaveLength(1);
    });

    it("rolls back to a specific turn", () => {
      const firstTurn = manager.getActiveBranch().turns[0]!;
      const result = handleThreadRollback(
        { sessionId: "s1", toTurnId: firstTurn.id },
        deps,
      );
      expect(result.droppedTurnCount).toBe(2);
      expect(manager.getActiveBranch().turns).toHaveLength(1);
    });

    it("throws when both n and toTurnId provided", () => {
      expect(() =>
        handleThreadRollback({ sessionId: "s1", n: 1, toTurnId: "x" }, deps),
      ).toThrow(/exactly one/);
    });

    it("throws when neither provided", () => {
      expect(() => handleThreadRollback({ sessionId: "s1" }, deps)).toThrow(
        /must provide/,
      );
    });

    it("throws when toTurnId not found", () => {
      expect(() =>
        handleThreadRollback({ sessionId: "s1", toTurnId: "nonexistent" }, deps),
      ).toThrow(/not found/);
    });
  });

  describe("thread/list", () => {
    it("returns all branches with active flag", () => {
      const result = handleThreadList({ sessionId: "s1" }, deps);
      expect(result.branches.length).toBeGreaterThanOrEqual(1);
      const active = result.branches.find((b) => b.isActive);
      expect(active?.name).toBe("main");
    });

    it("reports turnCount accurately", () => {
      const result = handleThreadList({ sessionId: "s1" }, deps);
      const main = result.branches.find((b) => b.name === "main");
      expect(main?.turnCount).toBe(3);
    });
  });

  describe("thread/switch", () => {
    it("switches to a branch by name", () => {
      manager.fork("alt");
      const result = handleThreadSwitch({ sessionId: "s1", nameOrId: "alt" }, deps);
      expect(result.switched).toBe(true);
      expect(manager.getActiveBranch().name).toBe("alt");
    });

    it("returns switched: false for unknown branch", () => {
      const result = handleThreadSwitch({ sessionId: "s1", nameOrId: "nope" }, deps);
      expect(result.switched).toBe(false);
    });
  });

  describe("dispatchThreadMethod", () => {
    it("routes thread/fork", () => {
      const result = dispatchThreadMethod(
        "thread/fork",
        { sessionId: "s1", name: "x" },
        deps,
      );
      expect(result).toBeTruthy();
    });

    it("returns null for non-thread methods", () => {
      expect(dispatchThreadMethod("session/prompt", {}, deps)).toBeNull();
    });

    it("routes all four thread methods", () => {
      expect(dispatchThreadMethod("thread/fork", { sessionId: "s1", name: "x" }, deps)).toBeTruthy();
      expect(dispatchThreadMethod("thread/rollback", { sessionId: "s1", n: 1 }, deps)).toBeTruthy();
      expect(dispatchThreadMethod("thread/list", { sessionId: "s1" }, deps)).toBeTruthy();
    });
  });
});
