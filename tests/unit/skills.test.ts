import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillRegistry } from "../../src/skills/loader.js";

describe("Skill System", () => {
  describe("built-in skills", () => {
    it("has 18+ built-in skills registered", () => {
      const registry = new SkillRegistry();
      expect(registry.getSkillCount()).toBeGreaterThanOrEqual(18);
    });

    it("provides summaries for progressive disclosure", () => {
      const registry = new SkillRegistry();
      const summaries = registry.getSummaries();

      expect(summaries.length).toBeGreaterThanOrEqual(18);
      for (const s of summaries) {
        expect(s.name).toBeDefined();
        expect(s.description.length).toBeLessThan(200);
      }
    });

    it("has essential skills", () => {
      const registry = new SkillRegistry();
      expect(registry.hasSkill("typescript-pro")).toBe(true);
      expect(registry.hasSkill("react-expert")).toBe(true);
      expect(registry.hasSkill("python-pro")).toBe(true);
      expect(registry.hasSkill("sql-pro")).toBe(true);
      expect(registry.hasSkill("systematic-debugging")).toBe(true);
      expect(registry.hasSkill("tdd-workflow")).toBe(true);
      expect(registry.hasSkill("code-reviewer")).toBe(true);
      expect(registry.hasSkill("conventional-commit")).toBe(true);
      expect(registry.hasSkill("search-first")).toBe(true);
      expect(registry.hasSkill("file-based-planning")).toBe(true);
      expect(registry.hasSkill("security-reviewer")).toBe(true);
      expect(registry.hasSkill("docker-expert")).toBe(true);
      expect(registry.hasSkill("api-design")).toBe(true);
      expect(registry.hasSkill("code-simplifier")).toBe(true);
      expect(registry.hasSkill("web-scraper")).toBe(true);
    });

    it("built-in skills have version numbers", () => {
      const registry = new SkillRegistry();
      const summaries = registry.getSummaries();
      const versioned = summaries.filter((s) => s.version);
      expect(versioned.length).toBeGreaterThan(10);
    });
  });

  describe("auto-detection", () => {
    it("detects TypeScript skill from .ts files", () => {
      const registry = new SkillRegistry();
      const relevant = registry.detectRelevant(["src/index.ts"]);
      const names = relevant.map((s) => s.name);
      expect(names).toContain("typescript-pro");
    });

    it("detects React skill from .tsx files", () => {
      const registry = new SkillRegistry();
      const relevant = registry.detectRelevant(["src/App.tsx"]);
      const names = relevant.map((s) => s.name);
      expect(names).toContain("react-expert");
      expect(names).toContain("typescript-pro");
    });

    it("detects Docker skill from Dockerfile", () => {
      const registry = new SkillRegistry();
      const relevant = registry.detectRelevant(["Dockerfile"]);
      const names = relevant.map((s) => s.name);
      expect(names).toContain("docker-expert");
    });

    it("detects Python skill from .py files", () => {
      const registry = new SkillRegistry();
      const relevant = registry.detectRelevant(["scripts/deploy.py"]);
      const names = relevant.map((s) => s.name);
      expect(names).toContain("python-pro");
    });

    it("returns empty for unmatched files", () => {
      const registry = new SkillRegistry();
      const relevant = registry.detectRelevant(["README.md"]);
      expect(relevant).toHaveLength(0);
    });
  });

  // ── ClawHub-inspired: not_for rejection boundaries ────────

  describe("not_for rejection boundaries (ClawHub pattern)", () => {
    it("typescript-pro does NOT trigger for test files", () => {
      const registry = new SkillRegistry();
      const relevant = registry.detectRelevant(["src/auth.test.ts"]);
      const names = relevant.map((s) => s.name);
      // typescript-pro has notFor: ["**/*.test.ts"]
      expect(names).not.toContain("typescript-pro");
    });

    it("code-simplifier does NOT trigger for test files", () => {
      const registry = new SkillRegistry();
      const relevant = registry.detectRelevant(["src/utils.spec.ts"]);
      const names = relevant.map((s) => s.name);
      expect(names).not.toContain("code-simplifier");
    });

    it("triggers when file does NOT match notFor pattern", () => {
      const registry = new SkillRegistry();
      const relevant = registry.detectRelevant(["src/auth.ts"]);
      const names = relevant.map((s) => s.name);
      // Regular .ts file should trigger typescript-pro
      expect(names).toContain("typescript-pro");
    });
  });

  // ── ClawHub-inspired: always flag ─────────────────────────

  describe("always flag (ClawHub pattern)", () => {
    it("returns always-active skills", () => {
      const registry = new SkillRegistry();
      const alwaysOn = registry.getAlwaysActive();
      const names = alwaysOn.map((s) => s.name);

      expect(names).toContain("tdd-workflow");
      expect(names).toContain("conventional-commit");
      expect(names).toContain("search-first");
      expect(names).toContain("security-reviewer");
    });

    it("always-active skills appear in summaries with flag", () => {
      const registry = new SkillRegistry();
      const summaries = registry.getSummaries();
      const alwaysSummaries = summaries.filter((s) => s.always);
      expect(alwaysSummaries.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ── ClawHub-inspired: pre-flight validation ───────────────

  describe("pre-flight validation (ClawHub pattern)", () => {
    it("passes for skills with no requirements", () => {
      const registry = new SkillRegistry();
      const result = registry.validatePreflight("sql-pro");
      expect(result.ready).toBe(true);
      expect(result.message).toBe("No requirements");
    });

    it("returns not-found for unknown skills", () => {
      const registry = new SkillRegistry();
      const result = registry.validatePreflight("nonexistent");
      expect(result.ready).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("checks binary requirements", () => {
      const registry = new SkillRegistry();
      // golang-pro requires 'go' binary
      const result = registry.validatePreflight("golang-pro");
      // Result depends on whether 'go' is installed
      expect(typeof result.ready).toBe("boolean");
      expect(result.missingBins).toBeDefined();
    });

    it("checks anyBins (at least one must exist)", () => {
      const registry = new SkillRegistry();
      // python-pro requires python3 or python
      const result = registry.validatePreflight("python-pro");
      // On most systems, python3 exists
      expect(typeof result.ready).toBe("boolean");
    });

    it("reports actionable error messages", () => {
      const registry = new SkillRegistry();
      // Register a skill with impossible requirements
      const skillFile = join(tmpdir(), "impossible-skill.md");
      writeFileSync(skillFile, [
        "---",
        "name: impossible-skill",
        "description: Requires a binary that does not exist",
        "requires:",
        "  bins: [nonexistent_binary_xyz_99]",
        "---",
        "Content",
      ].join("\n"));
      registry.registerFromFile(skillFile);

      const result = registry.validatePreflight("impossible-skill");
      expect(result.ready).toBe(false);
      expect(result.missingBins.length).toBeGreaterThan(0);
      expect(result.message).toContain("nonexistent_binary_xyz_99");
    });
  });

  // ── Lazy activation ───────────────────────────────────────

  describe("lazy activation", () => {
    it("loads built-in skill content on demand", () => {
      const registry = new SkillRegistry();
      const skill = registry.loadSkill("typescript-pro");
      expect(skill).not.toBeNull();
      expect(skill!.metadata.name).toBe("typescript-pro");
      expect(skill!.content).toContain("typescript-pro");
    });

    it("returns null for unknown skills", () => {
      const registry = new SkillRegistry();
      expect(registry.loadSkill("nonexistent-skill")).toBeNull();
    });
  });

  // ── Custom skills with ClawHub frontmatter ────────────────

  describe("custom skills", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "wotann-skill-test-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("registers skill from SKILL.md file", () => {
      const skillFile = join(tempDir, "my-skill.md");
      writeFileSync(skillFile, [
        "---",
        "name: my-custom-skill",
        "description: A custom skill for testing",
        "context: fork",
        'paths: ["**/*.custom"]',
        "category: custom",
        "---",
        "# My Custom Skill",
        "Instructions here.",
      ].join("\n"));

      const registry = new SkillRegistry();
      expect(registry.registerFromFile(skillFile)).toBe(true);
      expect(registry.hasSkill("my-custom-skill")).toBe(true);
    });

    it("parses ClawHub-style frontmatter with not_for and always", () => {
      const skillFile = join(tempDir, "clawhub-style.md");
      writeFileSync(skillFile, [
        "---",
        "name: clawhub-style-skill",
        "description: Uses ClawHub patterns",
        "version: 2.1.0",
        "context: fork",
        'paths: ["**/*.ts"]',
        'not_for: ["**/*.test.ts"]',
        "always: true",
        "category: quality",
        "requires:",
        "  bins: [node]",
        '  anyBins: [npx, pnpx]',
        '  env: [NODE_ENV]',
        "---",
        "# ClawHub-style skill",
        "Instructions here.",
      ].join("\n"));

      const registry = new SkillRegistry();
      registry.registerFromFile(skillFile);

      const skill = registry.getSkill("clawhub-style-skill");
      expect(skill).toBeDefined();
      expect(skill!.version).toBe("2.1.0");
      expect(skill!.always).toBe(true);
      expect(skill!.notFor).toContain("**/*.test.ts");
      expect(skill!.requires?.bins).toContain("node");
      expect(skill!.requires?.anyBins).toContain("npx");
    });

    it("scans directory for skills", () => {
      const skillDir = join(tempDir, "skills");
      mkdirSync(skillDir);

      writeFileSync(join(skillDir, "skill-a.md"), "---\nname: skill-a\ndescription: Skill A\n---\nContent A");
      writeFileSync(join(skillDir, "skill-b.md"), "---\nname: skill-b\ndescription: Skill B\n---\nContent B");

      const registry = new SkillRegistry();
      const count = registry.scanDirectory(skillDir);
      expect(count).toBe(2);
      expect(registry.hasSkill("skill-a")).toBe(true);
      expect(registry.hasSkill("skill-b")).toBe(true);
    });

    it("registers agentskills.io directory bundles", () => {
      const bundleDir = join(tempDir, "pdf-processing");
      mkdirSync(bundleDir);
      mkdirSync(join(bundleDir, "scripts"));
      mkdirSync(join(bundleDir, "references"));
      mkdirSync(join(bundleDir, "assets"));

      writeFileSync(join(bundleDir, "SKILL.md"), [
        "---",
        "name: pdf-processing",
        "description: Extracts text from PDFs and fills forms. Use when working with PDF documents.",
        "license: Apache-2.0",
        "compatibility: Requires Python 3.12+ and internet access",
        'allowed-tools: Bash(python3:*) Read',
        "metadata:",
        '  version: "1.2.3"',
        '  author: "example-org"',
        "---",
        "# PDF Processing",
        "See references/REFERENCE.md and run scripts/extract.py when needed.",
      ].join("\n"));
      writeFileSync(join(bundleDir, "scripts", "extract.py"), "print('extract')\n");
      writeFileSync(join(bundleDir, "references", "REFERENCE.md"), "# Reference\n");
      writeFileSync(join(bundleDir, "assets", "template.json"), "{}\n");

      const registry = new SkillRegistry();
      expect(registry.registerFromFile(bundleDir)).toBe(true);

      const skill = registry.getSkill("pdf-processing");
      expect(skill).toBeDefined();
      expect(skill!.format).toBe("agentskills-directory");
      expect(skill!.version).toBe("1.2.3");
      expect(skill!.license).toBe("Apache-2.0");
      expect(skill!.compatibility).toContain("Python 3.12+");
      expect(skill!.allowedTools).toEqual(["Bash(python3:*)", "Read"]);
      expect(skill!.extraMetadata?.author).toBe("example-org");
    });

    it("loads converted agentskills bundles with bundle inventory", () => {
      const bundleDir = join(tempDir, "code-review");
      mkdirSync(bundleDir);
      mkdirSync(join(bundleDir, "scripts"));
      mkdirSync(join(bundleDir, "references"));
      mkdirSync(join(bundleDir, "assets"));

      writeFileSync(join(bundleDir, "SKILL.md"), [
        "---",
        "name: code-review",
        "description: Reviews code and points out bugs.",
        "---",
        "# Code Review",
        "Use scripts/lint.sh and references/CHECKLIST.md.",
      ].join("\n"));
      writeFileSync(join(bundleDir, "scripts", "lint.sh"), "echo lint\n");
      writeFileSync(join(bundleDir, "references", "CHECKLIST.md"), "# Checklist\n");
      writeFileSync(join(bundleDir, "assets", "example.diff"), "diff --git a b\n");

      const registry = new SkillRegistry();
      registry.registerFromFile(bundleDir);

      const skill = registry.loadSkill("code-review");
      expect(skill).not.toBeNull();
      expect(skill!.filePath).toBe(join(bundleDir, "SKILL.md"));
      expect(skill!.content).toContain("WOTANN Bundle Context");
      expect(skill!.content).toContain("scripts/lint.sh");
      expect(skill!.content).toContain("references/CHECKLIST.md");
      expect(skill!.content).toContain("assets/example.diff");
      expect(skill!.content).toContain(`Bundle root: ${bundleDir}`);
    });

    it("preserves bundle semantics when registering a SKILL.md path directly", () => {
      const bundleDir = join(tempDir, "seo-audit");
      mkdirSync(bundleDir);
      mkdirSync(join(bundleDir, "references"));

      const skillFilePath = join(bundleDir, "SKILL.md");
      writeFileSync(skillFilePath, [
        "---",
        "name: seo-audit",
        "description: Audits site SEO and metadata.",
        "---",
        "# SEO Audit",
      ].join("\n"));
      writeFileSync(join(bundleDir, "references", "CHECKS.md"), "# Checks\n");

      const registry = new SkillRegistry();
      expect(registry.registerFromFile(skillFilePath)).toBe(true);

      const skill = registry.loadSkill("seo-audit");
      expect(skill).not.toBeNull();
      expect(skill!.content).toContain("references/CHECKS.md");
      expect(skill!.filePath).toBe(skillFilePath);
    });

    it("scans nested directories for agentskills bundles", () => {
      const skillDir = join(tempDir, "skills");
      const nestedBundleDir = join(skillDir, "marketing", "lead-qualifier");
      mkdirSync(nestedBundleDir, { recursive: true });

      writeFileSync(join(nestedBundleDir, "SKILL.md"), [
        "---",
        "name: lead-qualifier",
        "description: Qualifies inbound leads.",
        "---",
        "# Lead Qualifier",
      ].join("\n"));

      const registry = new SkillRegistry();
      const count = registry.scanDirectory(skillDir);

      expect(count).toBe(1);
      expect(registry.hasSkill("lead-qualifier")).toBe(true);
      expect(registry.loadSkill("lead-qualifier")?.filePath).toBe(join(nestedBundleDir, "SKILL.md"));
    });
  });
});
