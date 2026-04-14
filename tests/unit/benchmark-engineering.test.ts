import { describe, it, expect, beforeEach } from "vitest";
import {
  preCompletionChecklist,
  PerFileEditTracker,
  enforcePlanning,
  correctToolCall,
  generateEnvironmentBootstrap,
  enforceReadBeforeEdit,
  detectTruncation,
} from "../../src/hooks/benchmark-engineering.js";

describe("Benchmark Engineering Hooks", () => {
  describe("Pre-Completion Checklist", () => {
    it("allows clean completion", () => {
      const result = preCompletionChecklist("All done, tests pass.", {
        testsRun: true,
        typecheckRun: true,
        filesChanged: ["src/foo.ts"],
      });
      expect(result.action).toBe("allow");
    });

    it("warns when typecheck not run after changes", () => {
      const result = preCompletionChecklist("Done!", {
        testsRun: true,
        typecheckRun: false,
        filesChanged: ["src/foo.ts"],
      });
      expect(result.action).toBe("warn");
      expect(result.message).toContain("Typecheck not run");
    });

    it("warns when tests not run after changes", () => {
      const result = preCompletionChecklist("Done!", {
        testsRun: false,
        typecheckRun: true,
        filesChanged: ["src/foo.ts"],
      });
      expect(result.action).toBe("warn");
      expect(result.message).toContain("Tests not run");
    });

    it("warns on TODO markers in response", () => {
      const result = preCompletionChecklist("Done! TODO: fix edge case", {
        testsRun: true,
        typecheckRun: true,
        filesChanged: [],
      });
      expect(result.action).toBe("warn");
      expect(result.message).toContain("TODO/FIXME");
    });

    it("warns on stub implementations", () => {
      const result = preCompletionChecklist('throw new Error("Not implemented")', {
        testsRun: true,
        typecheckRun: true,
        filesChanged: [],
      });
      expect(result.action).toBe("warn");
      expect(result.message).toContain("stub");
    });

    it("allows when no files changed and no issues", () => {
      const result = preCompletionChecklist("Analysis complete.", {
        testsRun: false,
        typecheckRun: false,
        filesChanged: [],
      });
      expect(result.action).toBe("allow");
    });
  });

  describe("Per-File Edit Tracker", () => {
    let tracker: PerFileEditTracker;

    beforeEach(() => {
      tracker = new PerFileEditTracker(3, 6);
    });

    it("allows first few edits", () => {
      const result = tracker.recordEdit("src/foo.ts");
      expect(result.action).toBe("allow");
    });

    it("warns after threshold edits", () => {
      tracker.recordEdit("src/foo.ts");
      tracker.recordEdit("src/foo.ts");
      const result = tracker.recordEdit("src/foo.ts");
      expect(result.action).toBe("warn");
      expect(result.message).toContain("3 times");
    });

    it("blocks after block threshold", () => {
      for (let i = 0; i < 5; i++) tracker.recordEdit("src/foo.ts");
      const result = tracker.recordEdit("src/foo.ts");
      expect(result.action).toBe("block");
    });

    it("tracks separate files independently", () => {
      tracker.recordEdit("src/a.ts");
      tracker.recordEdit("src/a.ts");
      tracker.recordEdit("src/a.ts");
      const resultA = tracker.recordEdit("src/a.ts");
      expect(resultA.action).toBe("warn");

      const resultB = tracker.recordEdit("src/b.ts");
      expect(resultB.action).toBe("allow");
    });

    it("returns edit counts", () => {
      tracker.recordEdit("src/a.ts");
      tracker.recordEdit("src/a.ts");
      tracker.recordEdit("src/b.ts");
      expect(tracker.getEditCount("src/a.ts")).toBe(2);
      expect(tracker.getEditCount("src/b.ts")).toBe(1);
      expect(tracker.getEditCount("src/c.ts")).toBe(0);
    });

    it("returns most edited files sorted", () => {
      tracker.recordEdit("src/a.ts");
      tracker.recordEdit("src/b.ts");
      tracker.recordEdit("src/b.ts");
      tracker.recordEdit("src/b.ts");
      const most = tracker.getMostEdited();
      expect(most[0]!.file).toBe("src/b.ts");
      expect(most[0]!.count).toBe(3);
    });

    it("resets counts", () => {
      tracker.recordEdit("src/a.ts");
      tracker.reset();
      expect(tracker.getEditCount("src/a.ts")).toBe(0);
    });

    it("tracks total edits", () => {
      tracker.recordEdit("src/a.ts");
      tracker.recordEdit("src/a.ts");
      tracker.recordEdit("src/b.ts");
      expect(tracker.getTotalEdits()).toBe(3);
    });
  });

  describe("Mandatory Planning Enforcement", () => {
    it("allows simple prompts without planning", () => {
      const result = enforcePlanning("fix the typo", { hasPlan: false, turnNumber: 1 });
      expect(result.action).toBe("allow");
    });

    it("enforces planning for complex multi-file tasks", () => {
      const result = enforcePlanning(
        "Refactor the authentication system across multiple files to use OAuth2 instead of JWT",
        { hasPlan: false, turnNumber: 1 },
      );
      expect(result.action).toBe("inject");
      expect(result.injection).toContain("MANDATORY PLANNING");
    });

    it("allows when plan already exists", () => {
      const result = enforcePlanning(
        "Refactor the authentication system across multiple files",
        { hasPlan: true, turnNumber: 1 },
      );
      expect(result.action).toBe("allow");
    });

    it("allows after first turn", () => {
      const result = enforcePlanning(
        "Refactor the authentication system across multiple files",
        { hasPlan: false, turnNumber: 2 },
      );
      expect(result.action).toBe("allow");
    });
  });

  describe("Tool Call Correction", () => {
    it("renames path to file_path", () => {
      const { corrected, corrections } = correctToolCall("Read", { path: "/src/foo.ts" }, "/project");
      expect(corrected["file_path"]).toBe("/src/foo.ts");
      expect(corrected["path"]).toBeUndefined();
      expect(corrections.length).toBeGreaterThan(0);
    });

    it("renames text to content for Write", () => {
      const { corrected } = correctToolCall("Write", { file_path: "/foo.ts", text: "hello" }, "/project");
      expect(corrected["content"]).toBe("hello");
      expect(corrected["text"]).toBeUndefined();
    });

    it("renames cmd to command for Bash", () => {
      const { corrected } = correctToolCall("Bash", { cmd: "ls" }, "/project");
      expect(corrected["command"]).toBe("ls");
      expect(corrected["cmd"]).toBeUndefined();
    });

    it("converts relative paths to absolute", () => {
      const { corrected } = correctToolCall("Read", { file_path: "src/foo.ts" }, "/project");
      expect(corrected["file_path"]).toBe("/project/src/foo.ts");
    });

    it("leaves absolute paths unchanged", () => {
      const { corrected, corrections } = correctToolCall("Read", { file_path: "/absolute/path.ts" }, "/project");
      expect(corrected["file_path"]).toBe("/absolute/path.ts");
      expect(corrections.length).toBe(0);
    });

    it("renames regex to pattern for Grep", () => {
      const { corrected } = correctToolCall("Grep", { regex: "foo.*bar" }, "/project");
      expect(corrected["pattern"]).toBe("foo.*bar");
    });
  });

  describe("Environment Bootstrap", () => {
    it("generates environment context string", () => {
      const result = generateEnvironmentBootstrap({
        workingDir: "/project",
        nodeVersion: "v20.15.0",
        gitBranch: "main",
        hasTypeScript: true,
        testFramework: "vitest",
      });
      expect(result).toContain("/project");
      expect(result).toContain("v20.15.0");
      expect(result).toContain("main");
      expect(result).toContain("TypeScript");
      expect(result).toContain("vitest");
    });

    it("omits missing fields", () => {
      const result = generateEnvironmentBootstrap({
        workingDir: "/project",
      });
      expect(result).toContain("/project");
      expect(result).not.toContain("Node.js");
    });
  });

  describe("File Read Before Edit", () => {
    it("allows read operations", () => {
      const result = enforceReadBeforeEdit("Read", "/foo.ts", new Set());
      expect(result.action).toBe("allow");
    });

    it("allows write (new file creation)", () => {
      const result = enforceReadBeforeEdit("Write", "/foo.ts", new Set());
      expect(result.action).toBe("allow");
    });

    it("warns when editing unread file", () => {
      const result = enforceReadBeforeEdit("Edit", "/foo.ts", new Set());
      expect(result.action).toBe("warn");
      expect(result.message).toContain("without reading");
    });

    it("allows editing a previously read file", () => {
      const result = enforceReadBeforeEdit("Edit", "/foo.ts", new Set(["/foo.ts"]));
      expect(result.action).toBe("allow");
    });
  });

  describe("Truncation Detection", () => {
    it("detects trailing ellipsis", () => {
      const result = detectTruncation("Grep", "result line 1\nresult line 2...");
      expect(result.action).toBe("warn");
    });

    it("detects [truncated] marker", () => {
      const result = detectTruncation("Read", "file content [truncated]");
      expect(result.action).toBe("warn");
    });

    it("detects showing N of M pattern", () => {
      const result = detectTruncation("Grep", "showing first 10 of 150 results");
      expect(result.action).toBe("warn");
    });

    it("allows clean results", () => {
      const result = detectTruncation("Grep", "line 1\nline 2\nline 3");
      expect(result.action).toBe("allow");
    });
  });
});
