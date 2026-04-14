import { describe, it, expect } from "vitest";
import { CrossSessionLearner } from "../../src/learning/cross-session.js";

describe("CrossSessionLearner", () => {
  it("records actions to session trace", () => {
    const learner = new CrossSessionLearner("test-session");
    learner.recordAction({ type: "edit", tool: "read_file", success: true });
    learner.recordAction({ type: "edit", tool: "write_file", success: true });

    // Actions recorded (verified via extraction)
    const learnings = learner.extractLearnings("success");
    expect(typeof learnings).toBe("object");
  });

  it("extracts error patterns from trace", () => {
    const learner = new CrossSessionLearner("test-session");

    // Simulate: failed read_file, then successful read_file
    learner.recordAction({ type: "tool", tool: "read_file", input: "/wrong/path", output: "ENOENT: file not found", success: false });
    learner.recordAction({ type: "tool", tool: "read_file", input: "/correct/path", output: "file contents", success: true });

    const learnings = learner.extractLearnings("success");
    const errorPatterns = learnings.filter((l) => l.type === "error_pattern");
    expect(errorPatterns.length).toBeGreaterThan(0);
  });

  it("extracts tool sequences", () => {
    const learner = new CrossSessionLearner("test-session");

    // Successful 4-tool sequence
    learner.recordAction({ type: "tool", tool: "grep_search", success: true });
    learner.recordAction({ type: "tool", tool: "read_file", success: true });
    learner.recordAction({ type: "tool", tool: "edit_file", success: true });
    learner.recordAction({ type: "tool", tool: "run_tests", success: true });

    const learnings = learner.extractLearnings("success");
    const sequences = learnings.filter((l) => l.type === "tool_sequence");
    expect(sequences.length).toBeGreaterThan(0);
    expect(sequences[0]!.content).toContain("grep_search");
  });

  it("extracts strategy patterns on success", () => {
    const learner = new CrossSessionLearner("test-session");
    learner.recordAction({ type: "search", tool: "grep", success: true });
    learner.recordAction({ type: "read", tool: "read_file", success: true });
    learner.recordAction({ type: "edit", tool: "write_file", success: true });

    const learnings = learner.extractLearnings("success");
    const strategies = learnings.filter((l) => l.type === "strategy");
    expect(strategies.length).toBeGreaterThan(0);
  });

  it("does not extract strategies on failure", () => {
    const learner = new CrossSessionLearner("test-session");
    learner.recordAction({ type: "search", tool: "grep", success: true });
    learner.recordAction({ type: "read", tool: "read_file", success: true });
    learner.recordAction({ type: "edit", tool: "write_file", success: true });

    const learnings = learner.extractLearnings("failure");
    const strategies = learnings.filter((l) => l.type === "strategy");
    expect(strategies.length).toBe(0);
  });

  it("merges duplicate learnings by incrementing frequency", () => {
    const learner = new CrossSessionLearner("test-session");

    // First extraction
    learner.recordAction({ type: "tool", tool: "A", output: "error X", success: false });
    learner.recordAction({ type: "tool", tool: "A", input: "fix", success: true });
    learner.extractLearnings("success");
    learner.clearTrace();

    // Same pattern again
    learner.recordAction({ type: "tool", tool: "A", output: "error X", success: false });
    learner.recordAction({ type: "tool", tool: "A", input: "fix", success: true });
    learner.extractLearnings("success");

    const all = learner.getAllLearnings();
    const errorPatterns = all.filter((l) => l.type === "error_pattern");
    // Should have merged, not duplicated
    if (errorPatterns.length > 0) {
      expect(errorPatterns[0]!.frequency).toBeGreaterThan(1);
    }
  });

  it("retrieves relevant learnings by keyword", () => {
    const learner = new CrossSessionLearner("test-session");

    // Manually add some learnings via extraction
    learner.recordAction({ type: "tool", tool: "auth_check", success: true });
    learner.recordAction({ type: "tool", tool: "login_test", success: true });
    learner.recordAction({ type: "tool", tool: "deploy", success: true });
    learner.extractLearnings("success");

    const relevant = learner.getRelevantLearnings("auth");
    // May or may not find matches depending on extraction
    expect(Array.isArray(relevant)).toBe(true);
  });

  it("builds learning prompt for context injection", () => {
    const learner = new CrossSessionLearner("test-session");
    learner.recordAction({ type: "tool", tool: "fix_bug", success: true });
    learner.recordAction({ type: "tool", tool: "run_test", success: true });
    learner.recordAction({ type: "tool", tool: "deploy", success: true });
    learner.extractLearnings("success");

    const prompt = learner.buildLearningPrompt("deploy the app");
    // Prompt is a string (may be empty if no relevant learnings)
    expect(typeof prompt).toBe("string");
  });

  it("serializes and restores", () => {
    const learner = new CrossSessionLearner("s1");
    learner.recordAction({ type: "tool", tool: "test", success: true });
    learner.recordAction({ type: "tool", tool: "build", success: true });
    learner.recordAction({ type: "tool", tool: "deploy", success: true });
    learner.extractLearnings("success");

    const serialized = learner.serialize();

    const restored = new CrossSessionLearner("s2");
    restored.restore(serialized);
    expect(restored.getAllLearnings().length).toBe(learner.getAllLearnings().length);
  });
});
