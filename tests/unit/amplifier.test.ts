import { describe, it, expect } from "vitest";
import { IntelligenceAmplifier } from "../../src/intelligence/amplifier.js";

describe("Intelligence Amplifier", () => {
  describe("amplify", () => {
    it("passes trivial prompts through unchanged", () => {
      const amp = new IntelligenceAmplifier();
      const result = amp.amplify("Hello");
      expect(result.amplified).toBe("Hello");
      expect(result.taskComplexity).toBe("trivial");
      expect(result.reasoningBudget.planningRequired).toBe(false);
    });

    it("adds planning preamble for complex tasks", () => {
      const amp = new IntelligenceAmplifier();
      const result = amp.amplify(
        "Refactor the authentication system across multiple files to use the new OAuth provider",
      );
      expect(result.taskComplexity).toBe("complex");
      expect(result.reasoningBudget.planningRequired).toBe(true);
      expect(result.amplified).toContain("BEFORE writing any code");
    });

    it("adds file read instructions for moderate+ tasks", () => {
      const amp = new IntelligenceAmplifier();
      const result = amp.amplify(
        "Fix the bug in the authentication module where users can't log in after token refresh. The error is happening across multiple files in the auth provider system and needs careful investigation.",
      );
      expect(["moderate", "complex"]).toContain(result.taskComplexity);
      expect(result.amplified).toContain("READ it first");
    });

    it("injects recent errors into context for moderate+ tasks", () => {
      const amp = new IntelligenceAmplifier();
      // Use a longer prompt that classifies as moderate+ to trigger error injection
      const result = amp.amplify(
        "Fix the bug in the authentication module where users can't log in after token refresh fails. The error occurs across multiple files in the auth system.",
        { recentErrors: ["TypeError: Cannot read property 'token' of undefined"] },
      );
      expect(result.amplified).toContain("Recent errors");
      expect(result.amplified).toContain("TypeError");
    });

    it("scales reasoning budget with complexity", () => {
      const amp = new IntelligenceAmplifier();

      const trivial = amp.amplify("hi");
      const complex = amp.amplify(
        "Refactor the entire middleware pipeline across multiple files",
      );

      expect(trivial.reasoningBudget.thinkingTokens).toBe(0);
      expect(complex.reasoningBudget.thinkingTokens).toBeGreaterThan(0);
    });

    it("respects reasoning budget multiplier", () => {
      const amp1 = new IntelligenceAmplifier({ reasoningBudgetMultiplier: 1.0 });
      const amp2 = new IntelligenceAmplifier({ reasoningBudgetMultiplier: 2.0 });

      const r1 = amp1.amplify("Fix the complex authentication bug with multiple error scenarios");
      const r2 = amp2.amplify("Fix the complex authentication bug with multiple error scenarios");

      expect(r2.reasoningBudget.thinkingTokens).toBeGreaterThan(
        r1.reasoningBudget.thinkingTokens,
      );
    });

    it("can disable individual features", () => {
      const amp = new IntelligenceAmplifier({
        mandatoryPlanning: false,
        semanticDiscovery: false,
        forcedVerification: false,
      });

      const result = amp.amplify(
        "Refactor the entire authentication system across multiple files",
      );
      // Should still classify complexity but not inject preamble sections
      expect(result.taskComplexity).toBe("complex");
    });
  });

  describe("verifyCompletion", () => {
    it("catches TODO markers", () => {
      const amp = new IntelligenceAmplifier();
      const issues = amp.verifyCompletion("Here's the fix:\n// TODO: handle edge case");
      expect(issues.some((i) => i.type === "incomplete")).toBe(true);
    });

    it("catches stub implementations", () => {
      const amp = new IntelligenceAmplifier();
      const issues = amp.verifyCompletion('throw new Error("Not implemented")');
      expect(issues.some((i) => i.type === "stub")).toBe(true);
    });

    it("warns on too-short responses", () => {
      const amp = new IntelligenceAmplifier();
      const issues = amp.verifyCompletion("Done.", { originalTask: "Build the auth system" });
      expect(issues.some((i) => i.type === "too-short")).toBe(true);
    });

    it("catches any type in strict mode", () => {
      const amp = new IntelligenceAmplifier();
      const issues = amp.verifyCompletion(
        "const x: any = getValue()",
        { strictTypes: true },
      );
      expect(issues.some((i) => i.type === "type-safety")).toBe(true);
    });

    it("returns no issues for clean response", () => {
      const amp = new IntelligenceAmplifier();
      const issues = amp.verifyCompletion(
        "Here's the complete implementation with proper error handling and type safety.",
      );
      expect(issues).toHaveLength(0);
    });

    it("respects disabled checklist", () => {
      const amp = new IntelligenceAmplifier({ preCompletionChecklist: false });
      const issues = amp.verifyCompletion("// TODO: fix this");
      expect(issues).toHaveLength(0);
    });
  });

  describe("correctToolCall", () => {
    it("corrects path -> file_path", () => {
      const amp = new IntelligenceAmplifier();
      const corrected = amp.correctToolCall("Read", { path: "/foo/bar.ts" });
      expect(corrected["file_path"]).toBe("/foo/bar.ts");
      expect(corrected["path"]).toBeUndefined();
    });

    it("corrects text -> content for Write tool", () => {
      const amp = new IntelligenceAmplifier();
      const corrected = amp.correctToolCall("Write", {
        file_path: "/foo.ts",
        text: "hello",
      });
      expect(corrected["content"]).toBe("hello");
      expect(corrected["text"]).toBeUndefined();
    });

    it("corrects cmd -> command for Bash tool", () => {
      const amp = new IntelligenceAmplifier();
      const corrected = amp.correctToolCall("Bash", { cmd: "ls -la" });
      expect(corrected["command"]).toBe("ls -la");
      expect(corrected["cmd"]).toBeUndefined();
    });

    it("does not modify correct tool calls", () => {
      const amp = new IntelligenceAmplifier();
      const original = { file_path: "/foo.ts", content: "hello" };
      const corrected = amp.correctToolCall("Write", original);
      expect(corrected["file_path"]).toBe("/foo.ts");
      expect(corrected["content"]).toBe("hello");
    });

    it("respects disabled correction", () => {
      const amp = new IntelligenceAmplifier({ toolCallCorrection: false });
      const corrected = amp.correctToolCall("Read", { path: "/foo.ts" });
      // Should return args unchanged
      expect(corrected["path"]).toBe("/foo.ts");
      expect(corrected["file_path"]).toBeUndefined();
    });
  });
});
