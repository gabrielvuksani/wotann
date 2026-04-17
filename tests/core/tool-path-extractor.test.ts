import { describe, it, expect } from "vitest";
import { extractTrackedFilePath } from "../../src/core/tool-path-extractor.js";

// Session-4 regression guards for the consolidated extractTrackedFilePath
// helper. The prior copies in runtime.ts and runtime-query-pipeline.ts
// silently drifted — both missed `notebook_path`, so PreToolUse hooks
// couldn't see the file path on NotebookEdit tool calls. The centralised
// helper also prevents future drift by being the single source of truth.

describe("extractTrackedFilePath", () => {
  it("returns null for undefined input", () => {
    expect(extractTrackedFilePath(undefined)).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(extractTrackedFilePath({})).toBeNull();
  });

  it("extracts Write/Edit tool's file_path", () => {
    expect(extractTrackedFilePath({ file_path: "/src/foo.ts" })).toBe("/src/foo.ts");
  });

  it("extracts Glob/Grep tool's path", () => {
    expect(extractTrackedFilePath({ path: "/src" })).toBe("/src");
  });

  it("extracts emulated-tool target_file (snake) and targetPath (camel)", () => {
    expect(extractTrackedFilePath({ target_file: "/a.ts" })).toBe("/a.ts");
    expect(extractTrackedFilePath({ targetPath: "/b.ts" })).toBe("/b.ts");
  });

  it("extracts NotebookEdit's notebook_path (session-4 gap)", () => {
    // Prior to session 4 this returned null — ConfigProtection /
    // ReadBeforeEdit / TDDEnforcement silently bypassed notebook edits.
    expect(
      extractTrackedFilePath({ notebook_path: "/analysis.ipynb" }),
    ).toBe("/analysis.ipynb");
  });

  it("prefers file_path over other keys when multiple present", () => {
    expect(
      extractTrackedFilePath({
        file_path: "/primary.ts",
        path: "/secondary.ts",
        notebook_path: "/notebook.ipynb",
      }),
    ).toBe("/primary.ts");
  });

  it("returns null when tool-input has no file-path key (Bash, WebFetch, WebSearch)", () => {
    expect(extractTrackedFilePath({ command: "ls" })).toBeNull();
    expect(extractTrackedFilePath({ url: "https://example.com" })).toBeNull();
    expect(extractTrackedFilePath({ query: "test" })).toBeNull();
  });

  it("returns null when candidate is empty string", () => {
    expect(extractTrackedFilePath({ file_path: "" })).toBeNull();
  });

  it("returns null when candidate is not a string", () => {
    expect(extractTrackedFilePath({ file_path: 42 })).toBeNull();
    expect(extractTrackedFilePath({ file_path: null })).toBeNull();
    expect(extractTrackedFilePath({ file_path: { nested: "x" } })).toBeNull();
  });
});
