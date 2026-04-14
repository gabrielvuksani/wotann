import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateStatic,
  buildLLMJudgePrompt,
  parseLLMJudgeResponse,
  assignBadge,
  discoverImportableSkills,
} from "../../src/skills/eval.js";

describe("Skill Evaluation Framework", () => {
  describe("Static Analysis", () => {
    it("passes well-formed skill", () => {
      const { score, issues } = evaluateStatic(
        {
          name: "typescript-pro",
          description: "TypeScript development patterns and best practices",
          triggers: ["*.ts", "*.tsx"],
          category: "language",
          contentLength: 500,
        },
        "---\nname: typescript-pro\n---\n\nUse TypeScript strict mode. Always use const over let.",
      );
      expect(score).toBeGreaterThan(0.8);
      expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    });

    it("fails on missing name", () => {
      const { score, issues } = evaluateStatic(
        { name: "", description: "A valid description", contentLength: 100 },
        "---\nname:\n---\nSome content here.",
      );
      expect(score).toBeLessThan(0.8);
      expect(issues.some((i) => i.message.includes("name"))).toBe(true);
    });

    it("warns on no triggers", () => {
      const { issues } = evaluateStatic(
        { name: "test", description: "Test description here.", contentLength: 100 },
        "---\nname: test\n---\nContent.",
      );
      expect(issues.some((i) => i.message.includes("trigger"))).toBe(true);
    });

    it("warns on very long content", () => {
      const { issues } = evaluateStatic(
        { name: "big", description: "A big skill file.", triggers: ["*"], contentLength: 60000 },
        "---\nname: big\n---\n" + "x".repeat(60000),
      );
      expect(issues.some((i) => i.message.includes("long"))).toBe(true);
    });

    it("warns on missing frontmatter", () => {
      const { issues } = evaluateStatic(
        { name: "nofm", description: "No frontmatter skill.", triggers: ["*"], contentLength: 100 },
        "No frontmatter here, just plain content.",
      );
      expect(issues.some((i) => i.message.includes("frontmatter"))).toBe(true);
    });
  });

  describe("LLM Judge", () => {
    it("builds valid judge prompt", () => {
      const prompt = buildLLMJudgePrompt("test-skill", "Some skill content here");
      expect(prompt).toContain("test-skill");
      expect(prompt).toContain("CLARITY");
      expect(prompt).toContain("USEFULNESS");
    });

    it("parses valid JSON response", () => {
      const score = parseLLMJudgeResponse('{"clarity": 8, "usefulness": 7, "completeness": 6, "trigger_accuracy": 9, "overall": 7.5}');
      expect(score).toBe(0.75);
    });

    it("handles overall field directly", () => {
      const score = parseLLMJudgeResponse('{"overall": 9}');
      expect(score).toBe(0.9);
    });

    it("defaults to 0.5 for invalid response", () => {
      const score = parseLLMJudgeResponse("This is not JSON at all");
      expect(score).toBe(0.5);
    });
  });

  describe("Badge Assignment", () => {
    it("assigns platinum for top scores", () => {
      expect(assignBadge(0.9, 0.9, 0.95)).toBe("platinum");
    });

    it("assigns gold for good scores", () => {
      expect(assignBadge(0.8, 0.75, 0.75)).toBe("gold");
    });

    it("assigns silver for decent scores", () => {
      expect(assignBadge(0.7, 0.65, 0.3)).toBe("silver");
    });

    it("assigns bronze for passing static only", () => {
      expect(assignBadge(0.5, 0.3, 0.2)).toBe("bronze");
    });

    it("assigns unrated for low scores", () => {
      expect(assignBadge(0.2, 0.1, 0.1)).toBe("unrated");
    });
  });

  describe("Import Discovery", () => {
    it("discovers both flat markdown skills and agentskills bundles", () => {
      const projectDir = mkdtempSync(join(tmpdir(), "wotann-skill-discovery-"));

      try {
        const flatSkillsDir = join(projectDir, ".wotann", "skills");
        const bundleDir = join(projectDir, ".cursor", "skills", "pdf-processing");

        mkdirSync(flatSkillsDir, { recursive: true });
        mkdirSync(bundleDir, { recursive: true });

        writeFileSync(
          join(flatSkillsDir, "legacy-skill.md"),
          "---\nname: legacy-skill\ndescription: Legacy skill\n---\nContent\n",
        );
        writeFileSync(
          join(bundleDir, "SKILL.md"),
          "---\nname: pdf-processing\ndescription: Process PDFs.\n---\n# PDF Processing\n",
        );

        const discovered = discoverImportableSkills(projectDir);
        const names = discovered.map((skill) => skill.name);
        const paths = discovered.map((skill) => skill.path);

        expect(names).toContain("legacy-skill");
        expect(names).toContain("pdf-processing");
        expect(paths).toContain(join(flatSkillsDir, "legacy-skill.md"));
        expect(paths).toContain(join(bundleDir, "SKILL.md"));
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });
});
