import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleSystemPrompt, assembleSystemPromptParts } from "../../src/prompt/engine.js";
import { createWorkspace } from "../../src/core/workspace.js";

describe("Prompt Engine", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-prompt-test-"));
    createWorkspace({ targetDir: tempDir });
    // Wave 6.5-XX integrator: workspace trust gate blocks workspace
    // instruction loading by default (closes CVE-2026-33068). Test
    // workspaces opt out via env so the gate doesn't break the test
    // contract. Production users keep the gate.
    process.env["WOTANN_WORKSPACE_TRUST_OFF"] = "1";
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env["WOTANN_WORKSPACE_TRUST_OFF"];
  });

  it("assembles from bootstrap files", () => {
    const prompt = assembleSystemPrompt({ workspaceRoot: tempDir });

    expect(prompt).toContain("SOUL.md");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("Personality");
  });

  it("includes behavioral mode", () => {
    const prompt = assembleSystemPrompt({
      workspaceRoot: tempDir,
      mode: "debug",
    });

    expect(prompt).toContain("DEBUG");
    expect(prompt).toContain("Hypothesis-driven");
  });

  it("uses careful mode for security tasks", () => {
    const prompt = assembleSystemPrompt({
      workspaceRoot: tempDir,
      mode: "careful",
    });

    expect(prompt).toContain("CAREFUL");
    expect(prompt).toContain("verification");
  });

  it("limits subagent context to AGENTS + TOOLS", () => {
    const prompt = assembleSystemPrompt({
      workspaceRoot: tempDir,
      isSubagent: true,
    });

    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("TOOLS.md");
    expect(prompt).not.toContain("SOUL.md");
  });

  it("loads conditional rules by file pattern", () => {
    const rulesDir = join(tempDir, ".wotann", "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(join(rulesDir, "testing.md"), [
      "---",
      'paths: ["**/*.test.ts"]',
      "---",
      "When modifying test files:",
      "- Do not modify production code",
    ].join("\n"));

    const prompt = assembleSystemPrompt({
      workspaceRoot: tempDir,
      activeFiles: ["src/auth.test.ts"],
    });

    expect(prompt).toContain("test files");
  });

  it("loads persona configuration", () => {
    const personaDir = join(tempDir, ".wotann", "personas");
    mkdirSync(personaDir, { recursive: true });

    writeFileSync(join(personaDir, "startup-cto.yaml"), [
      "name: Startup CTO",
      "description: Makes tradeoff decisions like a startup CTO",
      "priorities: [shipping speed, technical debt awareness]",
      "communication: [direct, pragmatic]",
    ].join("\n"));

    const prompt = assembleSystemPrompt({
      workspaceRoot: tempDir,
      persona: "startup-cto",
    });

    expect(prompt).toContain("Startup CTO");
  });

  it("handles missing workspace gracefully", () => {
    const prompt = assembleSystemPrompt({
      workspaceRoot: "/nonexistent/path",
    });

    // Should return empty or minimal prompt
    expect(typeof prompt).toBe("string");
  });

  it("splits cached and dynamic prompt segments", () => {
    const rulesDir = join(tempDir, ".wotann", "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(join(rulesDir, "typescript.md"), [
      "---",
      'paths: ["**/*.ts"]',
      "---",
      "Prefer strict TypeScript patterns.",
    ].join("\n"));

    const prompt = assembleSystemPromptParts({
      workspaceRoot: tempDir,
      mode: "debug",
      activeFiles: ["src/app.ts"],
    });

    expect(prompt.cachedPrefix).toContain("SOUL.md");
    expect(prompt.dynamicSuffix).toContain("DEBUG");
    expect(prompt.dynamicSuffix).toContain("strict TypeScript");
    expect(prompt.fullPrompt).toContain(prompt.cachedPrefix);
    expect(prompt.fullPrompt).toContain(prompt.dynamicSuffix);
  });
});
