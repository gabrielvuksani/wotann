import { describe, it, expect } from "vitest";
import { ConversationBranchManager } from "../../src/core/conversation-branching.js";

describe("ConversationBranchManager — rollback (Codex thread/rollback parity)", () => {
  it("drops the N most-recent turns", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "q1");
    mgr.addTurn("assistant", "a1");
    mgr.addTurn("user", "q2");
    mgr.addTurn("assistant", "a2");
    expect(mgr.getActiveBranch().turns).toHaveLength(4);
    const dropped = mgr.rollback(2);
    expect(dropped).toHaveLength(2);
    expect(dropped[0]?.content).toBe("q2");
    expect(dropped[1]?.content).toBe("a2");
    expect(mgr.getActiveBranch().turns).toHaveLength(2);
  });

  it("returns [] on n <= 0", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "q");
    expect(mgr.rollback(0)).toEqual([]);
    expect(mgr.rollback(-5)).toEqual([]);
    expect(mgr.getActiveBranch().turns).toHaveLength(1);
  });

  it("clamps to branch length when n exceeds turn count", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "q");
    const dropped = mgr.rollback(100);
    expect(dropped).toHaveLength(1);
    expect(mgr.getActiveBranch().turns).toHaveLength(0);
  });

  it("returns [] on empty branch", () => {
    const mgr = new ConversationBranchManager();
    expect(mgr.rollback(5)).toEqual([]);
  });

  it("preserves branch identity (id, name, forkPoint) on rollback", () => {
    const mgr = new ConversationBranchManager();
    const before = mgr.getActiveBranch();
    mgr.addTurn("user", "a");
    mgr.addTurn("assistant", "b");
    mgr.rollback(1);
    const after = mgr.getActiveBranch();
    expect(after.id).toBe(before.id);
    expect(after.name).toBe(before.name);
    expect(after.forkPoint).toBe(before.forkPoint);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("rolls back on the ACTIVE branch only (sibling branches unaffected)", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "a");
    mgr.addTurn("assistant", "b");
    const branch = mgr.fork("alt");
    mgr.switchBranch(branch.name);
    mgr.addTurn("user", "c");
    // Rollback on alt
    mgr.rollback(1);
    expect(mgr.getActiveBranch().turns).toHaveLength(2); // a, b inherited
    // main is untouched
    const main = mgr.getBranch("main");
    expect(main?.turns).toHaveLength(2);
  });
});

describe("ConversationBranchManager — rollbackToTurn", () => {
  it("drops everything after the given turn id (exclusive)", () => {
    const mgr = new ConversationBranchManager();
    const t1 = mgr.addTurn("user", "q1");
    mgr.addTurn("assistant", "a1");
    mgr.addTurn("user", "q2");
    const dropped = mgr.rollbackToTurn(t1.id);
    expect(dropped).toHaveLength(2);
    expect(mgr.getActiveBranch().turns).toHaveLength(1);
    expect(mgr.getActiveBranch().turns[0]?.id).toBe(t1.id);
  });

  it("returns null when the turn id is not in the active branch", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "q");
    expect(mgr.rollbackToTurn("turn_9999")).toBeNull();
  });

  it("returns [] (not null) when rolling back to the latest turn (nothing to drop)", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "q");
    const last = mgr.addTurn("assistant", "a");
    const result = mgr.rollbackToTurn(last.id);
    expect(result).toEqual([]);
    expect(mgr.getActiveBranch().turns).toHaveLength(2);
  });
});
