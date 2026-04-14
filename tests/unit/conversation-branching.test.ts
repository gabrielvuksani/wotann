import { describe, it, expect } from "vitest";
import { ConversationBranchManager } from "../../src/core/conversation-branching.js";

describe("ConversationBranchManager", () => {
  it("starts with a main branch", () => {
    const mgr = new ConversationBranchManager();
    const active = mgr.getActiveBranch();
    expect(active.name).toBe("main");
    expect(active.turns.length).toBe(0);
  });

  it("adds turns to the active branch", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "Hello");
    mgr.addTurn("assistant", "Hi there!");

    const branch = mgr.getActiveBranch();
    expect(branch.turns.length).toBe(2);
    expect(branch.turns[0]!.role).toBe("user");
    expect(branch.turns[1]!.role).toBe("assistant");
    expect(branch.turns[1]!.parentId).toBe(branch.turns[0]!.id);
  });

  it("forks a new branch", () => {
    const mgr = new ConversationBranchManager();
    const t1 = mgr.addTurn("user", "What's the best approach?");
    mgr.addTurn("assistant", "Use approach A");

    const fork = mgr.fork("alt-approach", t1.id);
    expect(fork.name).toBe("alt-approach");
    expect(fork.turns.length).toBe(1); // Inherits up to fork point

    expect(mgr.listBranches().length).toBe(2);
  });

  it("switches between branches", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "Hello");
    const fork = mgr.fork("explore");

    expect(mgr.switchBranch("explore")).toBe(true);
    expect(mgr.getActiveBranch().id).toBe(fork.id);

    expect(mgr.switchBranch("main")).toBe(true);
    expect(mgr.getActiveBranch().name).toBe("main");
  });

  it("compares branches", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "Shared question");
    mgr.addTurn("assistant", "Shared answer");

    const fork = mgr.fork("diverge");
    mgr.switchBranch("diverge");
    mgr.addTurn("user", "Different follow-up");

    mgr.switchBranch("main");
    mgr.addTurn("user", "Original follow-up");

    const comparison = mgr.compare("main", fork.id);
    expect(comparison).not.toBeNull();
    expect(comparison!.commonTurns).toBe(2);
    expect(comparison!.divergentTurnsA).toBe(1);
    expect(comparison!.divergentTurnsB).toBe(1);
  });

  it("merges a branch", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "Q");
    mgr.addTurn("assistant", "A");

    const fork = mgr.fork("feature");
    mgr.switchBranch("feature");
    mgr.addTurn("user", "Feature request");
    mgr.addTurn("assistant", "Done!");

    mgr.switchBranch("main");
    const merged = mgr.merge(fork.id);
    expect(merged).toBe(true);

    // Main should now have original 2 + 2 merged = 4 turns
    expect(mgr.getActiveBranch().turns.length).toBe(4);
  });

  it("serializes and deserializes", () => {
    const mgr = new ConversationBranchManager();
    mgr.addTurn("user", "Hello");
    mgr.fork("alt");
    mgr.switchBranch("alt");
    mgr.addTurn("user", "In alt branch");

    const json = mgr.serialize();
    const restored = ConversationBranchManager.deserialize(json);

    expect(restored.listBranches().length).toBe(2);
  });

  it("cannot delete main or active branch", () => {
    const mgr = new ConversationBranchManager();
    expect(mgr.deleteBranch("main")).toBe(false);
    expect(mgr.deleteBranch(mgr.getActiveBranch().id)).toBe(false);
  });

  it("deletes non-active branches", () => {
    const mgr = new ConversationBranchManager();
    mgr.fork("temp");
    expect(mgr.listBranches().length).toBe(2);

    expect(mgr.deleteBranch("temp")).toBe(true);
    expect(mgr.listBranches().length).toBe(1);
  });
});
