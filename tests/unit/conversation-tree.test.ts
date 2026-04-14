import { describe, it, expect } from "vitest";
import { ConversationTree, SessionRecorder, CommandHistory } from "../../src/core/conversation-tree.js";

describe("Conversation Tree", () => {
  it("adds messages linearly", () => {
    const tree = new ConversationTree();
    tree.addMessage({ role: "user", content: "Hello" });
    tree.addMessage({ role: "assistant", content: "Hi there" });

    const history = tree.getHistory();
    expect(history.length).toBe(2);
    expect(history[0]?.message.role).toBe("user");
  });

  it("creates and switches branches", () => {
    const tree = new ConversationTree();
    tree.addMessage({ role: "user", content: "Plan the feature" });

    const branchId = tree.createBranch("approach-a");
    tree.switchBranch(branchId);
    tree.addMessage({ role: "assistant", content: "Approach A" });

    expect(tree.getCurrentBranch()).toBe(branchId);
    expect(tree.getBranches().length).toBe(2); // main + approach-a
  });

  it("compares branches", () => {
    const tree = new ConversationTree();
    tree.addMessage({ role: "user", content: "Shared message" });

    // Branch A gets a unique response
    const branchA = tree.createBranch("a");
    tree.switchBranch(branchA);
    tree.addMessage({ role: "assistant", content: "Response A" });

    // Branch B also gets a unique response (starts from same root)
    const branchB = tree.createBranch("b");
    tree.switchBranch(branchB);
    tree.addMessage({ role: "assistant", content: "Response B" });

    const diff = tree.compareBranches(branchA, branchB);
    // Both branches should have at least their unique response
    expect(diff.onlyA.length + diff.onlyB.length).toBeGreaterThanOrEqual(1);
  });

  it("getMessages returns AgentMessage array", () => {
    const tree = new ConversationTree();
    tree.addMessage({ role: "user", content: "Test" });
    tree.addMessage({ role: "assistant", content: "Reply" });

    const messages = tree.getMessages();
    expect(messages.length).toBe(2);
    expect(messages[0]?.content).toBe("Test");
  });

  it("tracks node count", () => {
    const tree = new ConversationTree();
    expect(tree.getNodeCount()).toBe(0);
    tree.addMessage({ role: "user", content: "Msg" });
    expect(tree.getNodeCount()).toBe(1);
  });
});

describe("SessionRecorder", () => {
  it("records events when recording", () => {
    const recorder = new SessionRecorder();
    recorder.startRecording();
    recorder.recordEvent({ type: "message", timestamp: Date.now(), data: { text: "hello" } });
    recorder.recordEvent({ type: "tool_call", timestamp: Date.now(), data: { tool: "Read" } });

    expect(recorder.getEventCount()).toBe(2);
    expect(recorder.isRecording()).toBe(true);
  });

  it("ignores events when not recording", () => {
    const recorder = new SessionRecorder();
    recorder.recordEvent({ type: "message", timestamp: Date.now(), data: {} });
    expect(recorder.getEventCount()).toBe(0);
  });

  it("returns events on stop", () => {
    const recorder = new SessionRecorder();
    recorder.startRecording();
    recorder.recordEvent({ type: "message", timestamp: Date.now(), data: {} });
    const events = recorder.stopRecording();
    expect(events.length).toBe(1);
    expect(recorder.isRecording()).toBe(false);
  });
});

describe("CommandHistory", () => {
  it("adds and navigates history", () => {
    const history = new CommandHistory();
    history.add("first");
    history.add("second");
    history.add("third");

    expect(history.previous()).toBe("third");
    expect(history.previous()).toBe("second");
    expect(history.next()).toBe("third");
  });

  it("deduplicates consecutive entries", () => {
    const history = new CommandHistory();
    history.add("same");
    history.add("same");
    history.add("same");
    expect(history.size()).toBe(1);
  });

  it("searches history", () => {
    const history = new CommandHistory();
    history.add("git status");
    history.add("npm test");
    history.add("git push");

    const results = history.search("git");
    expect(results.length).toBe(2);
  });

  it("respects max size", () => {
    const history = new CommandHistory(3);
    history.add("a");
    history.add("b");
    history.add("c");
    history.add("d");
    expect(history.size()).toBe(3);
  });
});
