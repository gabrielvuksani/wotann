import { describe, it, expect } from "vitest";
import { MCPRegistry, SkillMarketplace } from "../../src/marketplace/registry.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

describe("Marketplace & MCP Registry (Phase 15)", () => {
  describe("MCPRegistry", () => {
    it("registers and retrieves servers", () => {
      const registry = new MCPRegistry();
      registry.register({
        name: "test-server",
        command: "npx",
        args: ["@test/mcp-server"],
        transport: "stdio",
        enabled: true,
      });

      expect(registry.getServer("test-server")).toBeDefined();
      expect(registry.getServerCount()).toBe(1);
    });

    it("unregisters servers", () => {
      const registry = new MCPRegistry();
      registry.register({
        name: "temp",
        command: "npx",
        args: [],
        transport: "stdio",
        enabled: true,
      });

      registry.unregister("temp");
      expect(registry.getServer("temp")).toBeUndefined();
    });

    it("filters enabled servers", () => {
      const registry = new MCPRegistry();
      registry.register({ name: "a", command: "a", args: [], transport: "stdio", enabled: true });
      registry.register({ name: "b", command: "b", args: [], transport: "stdio", enabled: false });

      const enabled = registry.getEnabledServers();
      expect(enabled).toHaveLength(1);
      expect(enabled[0]!.name).toBe("a");
    });

    it("imports from Claude Code settings (graceful fallback)", () => {
      const registry = new MCPRegistry();
      // This will fail gracefully since settings don't exist in test
      const imported = registry.importFromClaudeCode();
      expect(typeof imported).toBe("number");
    });

    it("imports from other tools (graceful fallback)", () => {
      const registry = new MCPRegistry();
      const imported = registry.importFromTool("cursor");
      expect(typeof imported).toBe("number");
    });

    it("registers QMD as a built-in MCP server when available", () => {
      const registry = new MCPRegistry({
        projectDir: process.cwd(),
        qmdCommand: process.execPath,
      });

      const registered = registry.registerBuiltins();

      // QMD always registers (process.execPath always exists); cognee
      // and omi only register if their binaries happen to be on PATH,
      // so the total is >= 1 rather than exactly 1.
      expect(registered).toBeGreaterThanOrEqual(1);
      expect(registry.getServer("qmd")).toMatchObject({
        command: process.execPath,
        args: ["mcp"],
        transport: "stdio",
        enabled: true,
      });
    });

    // ── C15 + C18 — opt-in MCP builtins for external memory systems ──
    // These tests assert the registration *shape* rather than presence,
    // because they depend on whether the user has `cognee` / `omi` CLIs
    // on PATH. We explicitly override the command via env var so the
    // positive path is testable on any machine.

    it("registers Cognee MCP when COGNEE_CMD points to a real binary (C15)", () => {
      const prior = process.env["COGNEE_CMD"];
      process.env["COGNEE_CMD"] = process.execPath;
      try {
        const registry = new MCPRegistry({ projectDir: process.cwd() });
        const ok = registry.registerCogneeServer();
        expect(ok).toBe(true);
        expect(registry.getServer("cognee")).toMatchObject({
          name: "cognee",
          command: process.execPath,
          args: ["mcp"],
          transport: "stdio",
          enabled: false, // opt-in
          autoStart: false,
        });
      } finally {
        if (prior === undefined) delete process.env["COGNEE_CMD"];
        else process.env["COGNEE_CMD"] = prior;
      }
    });

    it("skips Cognee when the binary is not on PATH", () => {
      const prior = process.env["COGNEE_CMD"];
      process.env["COGNEE_CMD"] = "definitely-not-a-real-binary-7f3a9b2c";
      try {
        const registry = new MCPRegistry({ projectDir: process.cwd() });
        const ok = registry.registerCogneeServer();
        expect(ok).toBe(false);
        expect(registry.getServer("cognee")).toBeUndefined();
      } finally {
        if (prior === undefined) delete process.env["COGNEE_CMD"];
        else process.env["COGNEE_CMD"] = prior;
      }
    });

    it("registers Omi MCP when OMI_CMD points to a real binary (C18)", () => {
      const prior = process.env["OMI_CMD"];
      process.env["OMI_CMD"] = process.execPath;
      try {
        const registry = new MCPRegistry({ projectDir: process.cwd() });
        const ok = registry.registerOmiServer();
        expect(ok).toBe(true);
        expect(registry.getServer("omi")).toMatchObject({
          name: "omi",
          command: process.execPath,
          args: ["mcp"],
          transport: "stdio",
          enabled: false,
          autoStart: false,
        });
      } finally {
        if (prior === undefined) delete process.env["OMI_CMD"];
        else process.env["OMI_CMD"] = prior;
      }
    });

    it("is idempotent — duplicate register calls do not multiply", () => {
      const prior = process.env["COGNEE_CMD"];
      process.env["COGNEE_CMD"] = process.execPath;
      try {
        const registry = new MCPRegistry({ projectDir: process.cwd() });
        expect(registry.registerCogneeServer()).toBe(true);
        expect(registry.registerCogneeServer()).toBe(true);
        expect(registry.getServerCount()).toBe(1);
      } finally {
        if (prior === undefined) delete process.env["COGNEE_CMD"];
        else process.env["COGNEE_CMD"] = prior;
      }
    });
  });

  describe("SkillMarketplace evaluation", () => {
    it("rates well-formed skill as gold/silver", () => {
      const marketplace = new SkillMarketplace();
      const result = marketplace.evaluateStatic([
        "---",
        "name: my-skill",
        "description: A well-formed skill",
        "context: fork",
        "paths: ['**/*.ts']",
        "---",
        "# My Skill",
        "",
        "## Instructions",
        "Follow these steps when working with TypeScript files.",
        "Use strict mode and avoid any types.",
        "Always verify your work with tests.",
      ].join("\n"));

      expect(["gold", "silver"]).toContain(result.grade);
      expect(result.issues).toHaveLength(0);
    });

    it("rates stub skill as bronze/unrated", () => {
      const marketplace = new SkillMarketplace();
      const result = marketplace.evaluateStatic("short stub");

      expect(["bronze", "unrated"]).toContain(result.grade);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("penalizes missing frontmatter", () => {
      const marketplace = new SkillMarketplace();
      const result = marketplace.evaluateStatic("# No frontmatter\nSome content here that is long enough to pass the length check.");

      expect(result.issues).toContain("Missing YAML frontmatter");
    });
  });

  describe("SkillMarketplace local search/install", () => {
    it("searches local skill directories", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wotann-marketplace-"));

      try {
        const bundleDir = join(tempDir, "bundle-skill");
        mkdirSync(bundleDir, { recursive: true });
        writeFileSync(join(bundleDir, "SKILL.md"), [
          "---",
          "name: bundle-skill",
          "description: Local bundle skill",
          "category: coding",
          "---",
          "# Bundle Skill",
        ].join("\n"));

        const flatSkill = join(tempDir, "flat-skill.md");
        writeFileSync(flatSkill, [
          "---",
          "name: flat-skill",
          "description: Flat markdown skill",
          "---",
          "# Flat Skill",
        ].join("\n"));

        const marketplace = new SkillMarketplace({ searchRoots: [tempDir] });
        const results = await marketplace.search("skill");

        expect(results.map((skill) => skill.name)).toContain("bundle-skill");
        expect(results.map((skill) => skill.name)).toContain("flat-skill");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("installs a local skill bundle", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wotann-marketplace-"));
      const installDir = mkdtempSync(join(tmpdir(), "wotann-marketplace-install-"));

      try {
        const bundleDir = join(tempDir, "typescript-pro");
        mkdirSync(bundleDir, { recursive: true });
        writeFileSync(join(bundleDir, "SKILL.md"), "# TypeScript Pro");

        const marketplace = new SkillMarketplace({ searchRoots: [tempDir] });
        const installed = await marketplace.install(bundleDir, installDir);

        expect(installed).toBe(true);
        expect(readdirSync(installDir)).toContain("typescript-pro");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
        rmSync(installDir, { recursive: true, force: true });
      }
    });

    it("installs a skill from a git URL", async () => {
      const repoDir = mkdtempSync(join(tmpdir(), "wotann-marketplace-repo-"));
      const installDir = mkdtempSync(join(tmpdir(), "wotann-marketplace-install-"));

      try {
        writeFileSync(join(repoDir, "SKILL.md"), [
          "---",
          "name: git-skill",
          "description: Skill cloned from git",
          "---",
          "# Git Skill",
        ].join("\n"));

        execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
        execFileSync("git", ["config", "user.name", "WOTANN Test"], { cwd: repoDir, stdio: "ignore" });
        execFileSync("git", ["add", "SKILL.md"], { cwd: repoDir, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir, stdio: "ignore" });

        const marketplace = new SkillMarketplace();
        const installed = await marketplace.install(`file://${repoDir}`, installDir);

        expect(installed).toBe(true);
        expect(readdirSync(installDir).length).toBe(1);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
        rmSync(installDir, { recursive: true, force: true });
      }
    });
  });
});
