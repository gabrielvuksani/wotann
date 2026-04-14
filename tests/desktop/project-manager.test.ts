import { describe, it, expect } from "vitest";
import {
  createProject,
  renameProject,
  updateDescription,
  updateCustomInstructions,
  pinProject,
  addConversation,
  removeConversation,
  addKnowledgeFile,
  removeKnowledgeFile,
  toProjectSummary,
  getSortedProjects,
  searchProjects,
  findProject,
  replaceProject,
  removeProject,
} from "../../src/desktop/project-manager.js";
import type { Project } from "../../src/desktop/project-manager.js";

// ── Factory Tests ──────────────────────────────────────

describe("createProject", () => {
  it("should create a project with required fields", () => {
    const project = createProject("My Project", "/path/to/project");
    expect(project.id).toMatch(/^proj_/);
    expect(project.name).toBe("My Project");
    expect(project.path).toBe("/path/to/project");
    expect(project.conversations).toHaveLength(0);
    expect(project.knowledgeFiles).toHaveLength(0);
    expect(project.customInstructions).toBe("");
    expect(project.pinned).toBe(false);
  });

  it("should accept optional description and instructions", () => {
    const project = createProject("Test", "/path", {
      description: "A test project",
      customInstructions: "Use TypeScript strict mode",
    });
    expect(project.description).toBe("A test project");
    expect(project.customInstructions).toBe("Use TypeScript strict mode");
  });

  it("should generate unique IDs", () => {
    const a = createProject("A", "/a");
    const b = createProject("B", "/b");
    expect(a.id).not.toBe(b.id);
  });
});

// ── Immutable Update Tests ─────────────────────────────

describe("immutable operations", () => {
  it("should rename a project", () => {
    const original = createProject("Old Name", "/path");
    const renamed = renameProject(original, "New Name");
    expect(renamed.name).toBe("New Name");
    expect(original.name).toBe("Old Name"); // immutable
  });

  it("should update description", () => {
    const original = createProject("Test", "/path");
    const updated = updateDescription(original, "New description");
    expect(updated.description).toBe("New description");
    expect(original.description).toBe("");
  });

  it("should update custom instructions", () => {
    const original = createProject("Test", "/path");
    const updated = updateCustomInstructions(original, "Be concise");
    expect(updated.customInstructions).toBe("Be concise");
  });

  it("should pin a project", () => {
    const original = createProject("Test", "/path");
    const pinned = pinProject(original, true);
    expect(pinned.pinned).toBe(true);
    expect(original.pinned).toBe(false);
  });
});

// ── Conversation Association Tests ─────────────────────

describe("conversation association", () => {
  it("should add a conversation ID", () => {
    const project = createProject("Test", "/path");
    const updated = addConversation(project, "conv-1");
    expect(updated.conversations).toContain("conv-1");
    expect(project.conversations).toHaveLength(0); // immutable
  });

  it("should not duplicate conversation IDs", () => {
    let project = createProject("Test", "/path");
    project = addConversation(project, "conv-1");
    project = addConversation(project, "conv-1");
    expect(project.conversations).toHaveLength(1);
  });

  it("should remove a conversation ID", () => {
    let project = createProject("Test", "/path");
    project = addConversation(project, "conv-1");
    project = addConversation(project, "conv-2");
    project = removeConversation(project, "conv-1");
    expect(project.conversations).toEqual(["conv-2"]);
  });
});

// ── Knowledge File Tests ───────────────────────────────

describe("knowledge files", () => {
  it("should add a knowledge file", () => {
    const project = createProject("Test", "/path");
    const updated = addKnowledgeFile(project, "/docs/guide.md");
    expect(updated.knowledgeFiles).toContain("/docs/guide.md");
  });

  it("should not duplicate knowledge files", () => {
    let project = createProject("Test", "/path");
    project = addKnowledgeFile(project, "/docs/guide.md");
    project = addKnowledgeFile(project, "/docs/guide.md");
    expect(project.knowledgeFiles).toHaveLength(1);
  });

  it("should remove a knowledge file", () => {
    let project = createProject("Test", "/path");
    project = addKnowledgeFile(project, "/docs/a.md");
    project = addKnowledgeFile(project, "/docs/b.md");
    project = removeKnowledgeFile(project, "/docs/a.md");
    expect(project.knowledgeFiles).toEqual(["/docs/b.md"]);
  });
});

// ── Summary Tests ──────────────────────────────────────

describe("toProjectSummary", () => {
  it("should create a summary from a project", () => {
    let project = createProject("Test", "/path", { description: "desc" });
    project = addConversation(project, "c1");
    project = addConversation(project, "c2");
    project = addKnowledgeFile(project, "/f1");

    const summary = toProjectSummary(project);
    expect(summary.name).toBe("Test");
    expect(summary.description).toBe("desc");
    expect(summary.conversationCount).toBe(2);
    expect(summary.knowledgeFileCount).toBe(1);
  });
});

describe("getSortedProjects", () => {
  it("should put pinned projects first", () => {
    const projects: Project[] = [
      { ...createProject("C", "/c"), updatedAt: "2025-01-03T00:00:00.000Z", pinned: false },
      { ...createProject("A", "/a"), updatedAt: "2025-01-01T00:00:00.000Z", pinned: true },
      { ...createProject("B", "/b"), updatedAt: "2025-01-02T00:00:00.000Z", pinned: false },
    ];

    const sorted = getSortedProjects(projects);
    expect(sorted[0]?.pinned).toBe(true);
  });

  it("should sort unpinned by most recent", () => {
    const projects: Project[] = [
      { ...createProject("Old", "/old"), updatedAt: "2025-01-01T00:00:00.000Z", pinned: false },
      { ...createProject("New", "/new"), updatedAt: "2025-01-03T00:00:00.000Z", pinned: false },
    ];

    const sorted = getSortedProjects(projects);
    expect(sorted[0]?.name).toBe("New");
  });
});

// ── Search Tests ───────────────────────────────────────

describe("searchProjects", () => {
  it("should find projects by name", () => {
    const projects = [
      createProject("Wotann API", "/api"),
      createProject("Wotann Desktop", "/desktop"),
      createProject("Other Project", "/other"),
    ];

    const results = searchProjects(projects, "wotann");
    expect(results).toHaveLength(2);
  });

  it("should find projects by description", () => {
    const projects = [
      createProject("API", "/api", { description: "Backend REST API" }),
      createProject("UI", "/ui", { description: "Frontend app" }),
    ];

    const results = searchProjects(projects, "backend");
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("API");
  });

  it("should be case-insensitive", () => {
    const projects = [createProject("TypeScript Project", "/ts")];
    expect(searchProjects(projects, "typescript")).toHaveLength(1);
  });
});

// ── Collection Operations Tests ────────────────────────

describe("collection operations", () => {
  it("should find a project by ID", () => {
    const projects = [createProject("A", "/a"), createProject("B", "/b")];
    const found = findProject(projects, projects[0]!.id);
    expect(found?.name).toBe("A");
  });

  it("should return undefined for non-existent project", () => {
    expect(findProject([], "nope")).toBeUndefined();
  });

  it("should replace a project immutably", () => {
    const a = createProject("A", "/a");
    const b = createProject("B", "/b");
    const projects = [a, b];

    const updatedA = renameProject(a, "A Updated");
    const result = replaceProject(projects, updatedA);

    expect(result[0]?.name).toBe("A Updated");
    expect(result[1]?.name).toBe("B");
    expect(projects[0]?.name).toBe("A"); // original unchanged
  });

  it("should remove a project immutably", () => {
    const a = createProject("A", "/a");
    const b = createProject("B", "/b");
    const projects = [a, b];

    const result = removeProject(projects, a.id);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("B");
    expect(projects).toHaveLength(2); // original unchanged
  });
});
