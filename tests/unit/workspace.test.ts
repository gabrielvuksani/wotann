import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkspace, workspaceExists } from "../../src/core/workspace.js";

describe("Workspace", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("createWorkspace", () => {
    it("creates .wotann/ directory with all 8 bootstrap files", () => {
      const result = createWorkspace({ targetDir: tempDir });

      expect(result.created).toBe(true);
      expect(result.alreadyExists).toBe(false);
      expect(existsSync(join(tempDir, ".wotann"))).toBe(true);

      // All 8 bootstrap files + config.yaml
      expect(result.filesCreated).toContain("SOUL.md");
      expect(result.filesCreated).toContain("IDENTITY.md");
      expect(result.filesCreated).toContain("USER.md");
      expect(result.filesCreated).toContain("AGENTS.md");
      expect(result.filesCreated).toContain("TOOLS.md");
      expect(result.filesCreated).toContain("HEARTBEAT.md");
      expect(result.filesCreated).toContain("BOOTSTRAP.md");
      expect(result.filesCreated).toContain("MEMORY.md");
      expect(result.filesCreated).toContain("config.yaml");
    });

    it("creates subdirectories", () => {
      createWorkspace({ targetDir: tempDir });

      expect(existsSync(join(tempDir, ".wotann", "rules"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "skills"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "hooks"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "agents"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "personas"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "memory"))).toBe(true);
    });

    it("returns alreadyExists when .wotann/ exists", () => {
      createWorkspace({ targetDir: tempDir });
      const second = createWorkspace({ targetDir: tempDir });

      expect(second.created).toBe(false);
      expect(second.alreadyExists).toBe(true);
    });

    it("creates minimal workspace with --minimal", () => {
      const result = createWorkspace({ targetDir: tempDir, minimal: true });

      expect(result.filesCreated).toContain("AGENTS.md");
      expect(result.filesCreated).toContain("TOOLS.md");
      expect(result.filesCreated).toContain("MEMORY.md");
      expect(result.filesCreated).not.toContain("SOUL.md");
      expect(result.filesCreated).not.toContain("HEARTBEAT.md");
    });

    it("configures Ollama-first with --free mode", () => {
      createWorkspace({ targetDir: tempDir, freeMode: true });

      const configContent = readFileSync(
        join(tempDir, ".wotann", "config.yaml"),
        "utf-8",
      );
      expect(configContent).toContain("ollama");
      expect(configContent).toContain("q8_0");
    });

    it("writes valid SOUL.md content", () => {
      createWorkspace({ targetDir: tempDir });

      const soul = readFileSync(join(tempDir, ".wotann", "SOUL.md"), "utf-8");
      expect(soul).toContain("Personality");
      expect(soul).toContain("Communication");
      expect(soul).toContain("Boundaries");
    });

    it("writes BOOTSTRAP.md with first-run instructions", () => {
      createWorkspace({ targetDir: tempDir });

      const bootstrap = readFileSync(join(tempDir, ".wotann", "BOOTSTRAP.md"), "utf-8");
      expect(bootstrap).toContain("Initialization Sequence");
      expect(bootstrap).toContain("Mode Awareness");
      expect(bootstrap).toContain("First Action");
    });
  });

  describe("workspaceExists", () => {
    it("returns false when no .wotann/ directory", () => {
      expect(workspaceExists(tempDir)).toBe(false);
    });

    it("returns true after workspace creation", () => {
      createWorkspace({ targetDir: tempDir });
      expect(workspaceExists(tempDir)).toBe(true);
    });
  });
});
