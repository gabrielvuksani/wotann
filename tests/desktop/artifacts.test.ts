import { describe, it, expect } from "vitest";
import {
  createArtifact,
  updateArtifactContent,
  pinArtifact,
  renameArtifact,
  detectArtifactType,
  extractArtifacts,
  createHistory,
  addVersion,
  getVersion,
  computeLineDiff,
  generateArtifactId,
} from "../../src/desktop/artifacts.js";
import type { ExtractedArtifact } from "../../src/desktop/artifacts.js";

// ── Factory Tests ──────────────────────────────────────

describe("createArtifact", () => {
  it("should create an artifact from extracted data", () => {
    const extracted: ExtractedArtifact = {
      type: "code",
      title: "MyComponent",
      content: "const x = 1;",
      language: "typescript",
    };

    const artifact = createArtifact(extracted);
    expect(artifact.id).toMatch(/^art_/);
    expect(artifact.type).toBe("code");
    expect(artifact.title).toBe("MyComponent");
    expect(artifact.content).toBe("const x = 1;");
    expect(artifact.language).toBe("typescript");
    expect(artifact.version).toBe(1);
    expect(artifact.pinned).toBe(false);
  });

  it("should generate unique IDs", () => {
    const a = generateArtifactId();
    const b = generateArtifactId();
    expect(a).not.toBe(b);
  });
});

// ── Immutable Operation Tests ──────────────────────────

describe("immutable operations", () => {
  it("updateArtifactContent should increment version", () => {
    const original = createArtifact({ type: "code", title: "test", content: "v1" });
    const updated = updateArtifactContent(original, "v2");

    expect(updated.content).toBe("v2");
    expect(updated.version).toBe(2);
    expect(original.content).toBe("v1"); // immutable
    expect(original.version).toBe(1);
  });

  it("pinArtifact should toggle pinned state", () => {
    const original = createArtifact({ type: "code", title: "test", content: "x" });
    const pinned = pinArtifact(original, true);
    expect(pinned.pinned).toBe(true);
    expect(original.pinned).toBe(false);
  });

  it("renameArtifact should update the title", () => {
    const original = createArtifact({ type: "code", title: "old", content: "x" });
    const renamed = renameArtifact(original, "new title");
    expect(renamed.title).toBe("new title");
    expect(original.title).toBe("old");
  });
});

// ── Type Detection Tests ───────────────────────────────

describe("detectArtifactType", () => {
  it("should detect mermaid", () => {
    expect(detectArtifactType("mermaid")).toBe("mermaid");
  });

  it("should detect svg", () => {
    expect(detectArtifactType("svg")).toBe("svg");
  });

  it("should detect html", () => {
    expect(detectArtifactType("html")).toBe("html");
  });

  it("should detect diff/patch", () => {
    expect(detectArtifactType("diff")).toBe("diff");
    expect(detectArtifactType("patch")).toBe("diff");
  });

  it("should default to code for unknown languages", () => {
    expect(detectArtifactType("typescript")).toBe("code");
    expect(detectArtifactType("python")).toBe("code");
    expect(detectArtifactType("rust")).toBe("code");
  });

  it("should be case-insensitive", () => {
    expect(detectArtifactType("HTML")).toBe("html");
    expect(detectArtifactType("Mermaid")).toBe("mermaid");
  });
});

// ── Extraction Tests ───────────────────────────────────

describe("extractArtifacts", () => {
  it("should extract code blocks", () => {
    const content = "Some text\n```typescript\nconst x = 1;\n```\nMore text";
    const artifacts = extractArtifacts(content);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.type).toBe("code");
    expect(artifacts[0]?.content).toBe("const x = 1;");
    expect(artifacts[0]?.language).toBe("typescript");
  });

  it("should extract multiple code blocks", () => {
    const content = [
      "```python",
      "print('hello')",
      "```",
      "",
      "```javascript",
      "console.log('world');",
      "```",
    ].join("\n");

    const artifacts = extractArtifacts(content);
    expect(artifacts).toHaveLength(2);
  });

  it("should extract mermaid diagrams as mermaid type", () => {
    const content = "```mermaid\ngraph TD;\nA-->B;\n```";
    const artifacts = extractArtifacts(content);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.type).toBe("mermaid");
  });

  it("should extract HTML blocks", () => {
    const content = "```html\n<div>Hello</div>\n```";
    const artifacts = extractArtifacts(content);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.type).toBe("html");
  });

  it("should skip empty code blocks", () => {
    const content = "```typescript\n\n```";
    const artifacts = extractArtifacts(content);
    expect(artifacts).toHaveLength(0);
  });

  it("should extract markdown tables", () => {
    const content = [
      "| Name | Value |",
      "| --- | --- |",
      "| A | 1 |",
      "| B | 2 |",
    ].join("\n");

    const artifacts = extractArtifacts(content);
    expect(artifacts.some((a) => a.type === "table")).toBe(true);
  });

  it("should generate titles from function names", () => {
    const content = "```typescript\nfunction calculateTotal(items: Item[]) {\n  return 0;\n}\n```";
    const artifacts = extractArtifacts(content);

    expect(artifacts[0]?.title).toBe("calculateTotal");
  });

  it("should generate titles from filename comments", () => {
    const content = "```typescript\n// utils.ts\nexport const foo = 1;\n```";
    const artifacts = extractArtifacts(content);

    expect(artifacts[0]?.title).toBe("utils.ts");
  });
});

// ── Version History Tests ──────────────────────────────

describe("version history", () => {
  it("should create history from an artifact", () => {
    const artifact = createArtifact({ type: "code", title: "test", content: "v1" });
    const history = createHistory(artifact);

    expect(history.artifactId).toBe(artifact.id);
    expect(history.versions).toHaveLength(1);
    expect(history.versions[0]?.version).toBe(1);
    expect(history.versions[0]?.content).toBe("v1");
  });

  it("should add versions immutably", () => {
    const artifact = createArtifact({ type: "code", title: "test", content: "v1" });
    const history = createHistory(artifact);
    const updated = addVersion(history, "v2");

    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[1]?.version).toBe(2);
    expect(updated.versions[1]?.content).toBe("v2");
    expect(history.versions).toHaveLength(1); // immutable
  });

  it("should retrieve a specific version", () => {
    const artifact = createArtifact({ type: "code", title: "test", content: "v1" });
    let history = createHistory(artifact);
    history = addVersion(history, "v2");
    history = addVersion(history, "v3");

    expect(getVersion(history, 1)?.content).toBe("v1");
    expect(getVersion(history, 2)?.content).toBe("v2");
    expect(getVersion(history, 3)?.content).toBe("v3");
    expect(getVersion(history, 4)).toBeUndefined();
  });
});

// ── Diff Tests ─────────────────────────────────────────

describe("computeLineDiff", () => {
  it("should detect unchanged lines", () => {
    const diff = computeLineDiff("line1\nline2", "line1\nline2");
    expect(diff.every((d) => d.type === "unchanged")).toBe(true);
  });

  it("should detect added lines", () => {
    const diff = computeLineDiff("line1", "line1\nline2");
    expect(diff.some((d) => d.type === "added")).toBe(true);
  });

  it("should detect removed lines", () => {
    const diff = computeLineDiff("line1\nline2", "line1");
    expect(diff.some((d) => d.type === "removed")).toBe(true);
  });

  it("should detect changed lines", () => {
    const diff = computeLineDiff("old content", "new content");
    expect(diff.some((d) => d.type === "removed" && d.content === "old content")).toBe(true);
    expect(diff.some((d) => d.type === "added" && d.content === "new content")).toBe(true);
  });

  it("should handle empty strings", () => {
    const diff = computeLineDiff("", "");
    expect(diff).toHaveLength(1);
    expect(diff[0]?.type).toBe("unchanged");
  });
});
