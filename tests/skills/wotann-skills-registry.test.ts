import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WOTANN_SKILLS,
  WOTANN_SKILL_COUNT,
  findSkillById,
  skillsByCategory,
  matchSkillsByTrigger,
  listCategories,
} from "../../src/skills/wotann-skills-registry.js";

const PROJECT_ROOT = resolve(__dirname, "..", "..");

describe("WOTANN_SKILLS registry", () => {
  it("exports exactly 10 curated skills (Tier 12 batch D)", () => {
    expect(WOTANN_SKILL_COUNT).toBe(10);
    expect(WOTANN_SKILLS).toHaveLength(10);
  });

  it("every skill has the required fields", () => {
    for (const skill of WOTANN_SKILLS) {
      expect(skill.id).toMatch(/^[a-z0-9-]+$/);
      expect(skill.file).toMatch(/^\.wotann\/skills\/.+\.md$/);
      expect(skill.description.length).toBeGreaterThan(20);
      expect(skill.triggers.length).toBeGreaterThanOrEqual(3);
      expect(skill.category).toBeTruthy();
    }
  });

  it("skill ids are unique", () => {
    const ids = WOTANN_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skill file paths are unique", () => {
    const files = WOTANN_SKILLS.map((s) => s.file);
    expect(new Set(files).size).toBe(files.length);
  });

  // The two tests below read from `.wotann/skills/` which is gitignored
  // (it's populated by `wotann init` in user environments, not committed
  // to source). When CI checks out a clean repo, the directory doesn't
  // exist and the tests fail with ENOENT. Skip both when the canonical
  // first skill file is missing — the registry shape is still tested by
  // the "every skill has the required fields" assertion above.
  const FIRST_SKILL_PATH = resolve(PROJECT_ROOT, WOTANN_SKILLS[0]!.file);
  const SKILL_FILES_AVAILABLE = existsSync(FIRST_SKILL_PATH);

  it.skipIf(!SKILL_FILES_AVAILABLE)(
    "every referenced SKILL file exists on disk",
    () => {
      for (const skill of WOTANN_SKILLS) {
        const absolute = resolve(PROJECT_ROOT, skill.file);
        expect(existsSync(absolute), `missing ${skill.file}`).toBe(true);
      }
    },
  );

  it.skipIf(!SKILL_FILES_AVAILABLE)(
    "every SKILL file has a YAML frontmatter with matching name",
    () => {
      for (const skill of WOTANN_SKILLS) {
        const absolute = resolve(PROJECT_ROOT, skill.file);
        const content = readFileSync(absolute, "utf-8");
        expect(content.startsWith("---\n"), `no frontmatter in ${skill.file}`).toBe(true);
        const nameMatch = content.match(/^name:\s*(\S+)/m);
        expect(nameMatch?.[1]).toBe(skill.id);
      }
    },
  );
});

describe("findSkillById", () => {
  it("returns the matching skill", () => {
    const skill = findSkillById("debug-systematic");
    expect(skill?.category).toBe("debugging");
  });

  it("returns null for unknown ids instead of throwing", () => {
    expect(findSkillById("nonexistent-skill")).toBeNull();
    expect(findSkillById("")).toBeNull();
  });
});

describe("skillsByCategory", () => {
  it("returns all skills in the given category", () => {
    const quality = skillsByCategory("quality");
    const ids = quality.map((s) => s.id).sort();
    expect(ids).toEqual(["code-review", "refactor-safe"]);
  });

  it("returns an empty array for an empty category", () => {
    // Cast to satisfy the enum while testing a nonexistent value via
    // the runtime path.
    const result = skillsByCategory("unknown" as never);
    expect(result).toEqual([]);
  });
});

describe("matchSkillsByTrigger", () => {
  it("matches a clear debugging phrase", () => {
    const results = matchSkillsByTrigger("the test failing keeps coming back");
    expect(results[0]?.id).toBe("debug-systematic");
  });

  it("matches a review request", () => {
    const results = matchSkillsByTrigger("please review this pr");
    expect(results.map((r) => r.id)).toContain("code-review");
  });

  it("respects the limit argument", () => {
    const results = matchSkillsByTrigger("review the security audit and optimize", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns an empty array for empty input", () => {
    expect(matchSkillsByTrigger("")).toEqual([]);
    expect(matchSkillsByTrigger("foo bar baz", 0)).toEqual([]);
  });

  it("is case-insensitive", () => {
    const a = matchSkillsByTrigger("DEBUG");
    const b = matchSkillsByTrigger("debug");
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });

  it("returns no matches for unrelated input", () => {
    const results = matchSkillsByTrigger("the quick brown fox");
    expect(results).toEqual([]);
  });
});

describe("listCategories", () => {
  it("returns all distinct categories in sorted order", () => {
    const cats = listCategories();
    expect(cats.length).toBeGreaterThan(0);
    const sorted = [...cats].sort();
    expect(cats).toEqual(sorted);
  });

  it("every category has at least one skill", () => {
    for (const cat of listCategories()) {
      expect(skillsByCategory(cat).length).toBeGreaterThan(0);
    }
  });
});
