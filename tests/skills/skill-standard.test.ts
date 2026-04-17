import { describe, it, expect } from "vitest";
import {
  parseAgentSkillFile,
  renderAgentSkillFile,
  validateAgentSkill,
} from "../../src/skills/skill-standard.js";

describe("skill-standard — agentskills.io SKILL.md format", () => {
  it("parses a minimal valid file", () => {
    const content = `---
name: example-skill
description: A tiny skill for the test suite
---

Hello world.`;
    const skill = parseAgentSkillFile(content, "example.md");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("example-skill");
    expect(skill!.description).toBe("A tiny skill for the test suite");
    expect(skill!.body).toBe("Hello world.");
  });

  it("returns null when the file lacks frontmatter", () => {
    expect(parseAgentSkillFile("Just body, no fences.", "x.md")).toBeNull();
  });

  it("returns null when frontmatter omits required fields", () => {
    const content = `---
version: 1.0.0
---
Body.`;
    expect(parseAgentSkillFile(content, "x.md")).toBeNull();
  });

  it("parses array-valued fields", () => {
    const content = `---
name: multi
description: Multi-field skill
triggers: [search code, find symbol]
requires: [ripgrep, grep]
---

Body.`;
    const skill = parseAgentSkillFile(content, "x.md");
    expect(skill).not.toBeNull();
    expect(skill!.triggers).toEqual(["search code", "find symbol"]);
    expect(skill!.requires).toEqual(["ripgrep", "grep"]);
  });

  it("parses inline object author", () => {
    const content = `---
name: auth
description: Authored skill
author: {name: Jane, email: jane@example.com}
---

Body.`;
    const skill = parseAgentSkillFile(content, "x.md");
    expect(skill).not.toBeNull();
    expect(skill!.author?.name).toBe("Jane");
    expect(skill!.author?.email).toBe("jane@example.com");
  });

  it("accepts all three tiers", () => {
    for (const tier of ["system", "curated", "experimental"]) {
      const content = `---
name: tier-${tier}
description: testing tier ${tier}
tier: ${tier}
---
Body.`;
      const skill = parseAgentSkillFile(content, "x.md");
      expect(skill?.tier).toBe(tier);
    }
  });

  it("roundtrips through renderAgentSkillFile", () => {
    const original = `---
name: roundtrip
description: Test roundtrip
version: 1.2.3
license: MIT
tier: curated
---

Body content here.`;
    const parsed = parseAgentSkillFile(original, "x.md");
    expect(parsed).not.toBeNull();
    const rendered = renderAgentSkillFile(parsed!);
    const reparsed = parseAgentSkillFile(rendered, "x.md");
    expect(reparsed?.name).toBe(parsed!.name);
    expect(reparsed?.description).toBe(parsed!.description);
    expect(reparsed?.version).toBe(parsed!.version);
    expect(reparsed?.license).toBe(parsed!.license);
    expect(reparsed?.tier).toBe(parsed!.tier);
    expect(reparsed?.body).toBe(parsed!.body);
  });

  it("validateAgentSkill surfaces real problems", () => {
    const bad = {
      name: "",
      description: "x",
      body: "",
      sourcePath: "x.md",
    };
    const problems = validateAgentSkill(bad);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.toLowerCase().includes("name"))).toBe(true);
    expect(problems.some((p) => p.toLowerCase().includes("body"))).toBe(true);
  });
});
