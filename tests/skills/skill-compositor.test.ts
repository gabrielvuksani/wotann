import { describe, it, expect } from "vitest";
import {
  findSkillChain,
  executeChain,
  SkillCompositor,
  type SkillDescriptor,
} from "../../src/skills/skill-compositor.js";

function mockSkill(
  name: string,
  inputType: string,
  outputType: string,
  executor: (input: unknown) => unknown | Promise<unknown> = (x) => x,
  cost?: number,
): SkillDescriptor {
  const base: SkillDescriptor = {
    name,
    inputType,
    outputType,
    execute: async (x) => executor(x),
  };
  return cost !== undefined ? { ...base, cost } : base;
}

describe("findSkillChain", () => {
  it("returns empty chain when source === goal", () => {
    const chain = findSkillChain("url", "url", []);
    expect(chain).not.toBeNull();
    expect(chain!.skills).toEqual([]);
  });

  it("finds direct single-skill chain", () => {
    const skills = [mockSkill("fetch", "url", "html")];
    const chain = findSkillChain("url", "html", skills);
    expect(chain?.skills).toHaveLength(1);
    expect(chain?.skills[0]?.name).toBe("fetch");
  });

  it("finds multi-step chain", () => {
    const skills = [
      mockSkill("fetch", "url", "html"),
      mockSkill("convert", "html", "markdown"),
      mockSkill("summarize", "markdown", "summary"),
    ];
    const chain = findSkillChain("url", "summary", skills);
    expect(chain?.skills).toHaveLength(3);
    expect(chain?.skills.map((s) => s.name)).toEqual(["fetch", "convert", "summarize"]);
  });

  it("returns null when no chain exists", () => {
    const skills = [mockSkill("fetch", "url", "html")];
    const chain = findSkillChain("url", "pdf", skills);
    expect(chain).toBeNull();
  });

  it("prefers cheapest edges on tie", () => {
    const skills = [
      mockSkill("cheap", "url", "html", (x) => x, 1),
      mockSkill("expensive", "url", "html", (x) => x, 10),
    ];
    const chain = findSkillChain("url", "html", skills);
    expect(chain?.skills[0]?.name).toBe("cheap");
  });

  it("handles cycles without infinite loop", () => {
    const skills = [
      mockSkill("a-to-b", "a", "b"),
      mockSkill("b-to-a", "b", "a"),
    ];
    const chain = findSkillChain("a", "c", skills);
    expect(chain).toBeNull();
  });
});

describe("executeChain", () => {
  it("runs skills in order, threading outputs", async () => {
    const skills = [
      mockSkill("double", "num", "doubled", (x) => (x as number) * 2),
      mockSkill("add1", "doubled", "final", (x) => (x as number) + 1),
    ];
    const chain = findSkillChain("num", "final", skills);
    expect(chain).not.toBeNull();
    const result = await executeChain(5, chain!);
    expect(result.output).toBe(11); // (5 * 2) + 1
    expect(result.skillsExecuted).toEqual(["double", "add1"]);
  });

  it("exposes intermediate outputs", async () => {
    const skills = [
      mockSkill("a", "x", "y", () => "step1"),
      mockSkill("b", "y", "z", () => "step2"),
    ];
    const chain = findSkillChain("x", "z", skills)!;
    const result = await executeChain("input", chain);
    expect(result.intermediateOutputs).toEqual(["step1", "step2"]);
  });

  it("empty chain returns input unchanged", async () => {
    const chain = { source: "x", goal: "x", skills: [], totalCost: 0 };
    const result = await executeChain("hello", chain);
    expect(result.output).toBe("hello");
    expect(result.skillsExecuted).toEqual([]);
  });
});

describe("SkillCompositor", () => {
  it("register + list", () => {
    const c = new SkillCompositor();
    c.register(mockSkill("s1", "a", "b"));
    expect(c.size()).toBe(1);
    expect(c.list()[0]?.name).toBe("s1");
  });

  it("throws on duplicate register", () => {
    const c = new SkillCompositor();
    c.register(mockSkill("s1", "a", "b"));
    expect(() => c.register(mockSkill("s1", "a", "c"))).toThrow(/already registered/);
  });

  it("unregister removes", () => {
    const c = new SkillCompositor();
    c.register(mockSkill("s1", "a", "b"));
    expect(c.unregister("s1")).toBe(true);
    expect(c.size()).toBe(0);
    expect(c.unregister("s1")).toBe(false);
  });

  it("compose runs the chain", async () => {
    const c = new SkillCompositor();
    c.register(mockSkill("upper", "text", "upper", (x) => (x as string).toUpperCase()));
    const result = await c.compose("hello", "text", "upper");
    expect(result?.output).toBe("HELLO");
  });

  it("compose returns null on no path", async () => {
    const c = new SkillCompositor();
    const result = await c.compose("x", "a", "b");
    expect(result).toBeNull();
  });

  it("findAllChains enumerates alternatives", () => {
    const c = new SkillCompositor();
    c.register(mockSkill("direct", "a", "b"));
    c.register(mockSkill("detour1", "a", "x"));
    c.register(mockSkill("detour2", "x", "b"));
    const chains = c.findAllChains("a", "b", 5);
    expect(chains.length).toBeGreaterThanOrEqual(2);
    expect(chains[0]?.totalCost).toBeLessThanOrEqual(chains[1]!.totalCost);
  });

  it("findAllChains respects maxDepth", () => {
    const c = new SkillCompositor();
    c.register(mockSkill("a-b", "a", "b"));
    c.register(mockSkill("b-c", "b", "c"));
    c.register(mockSkill("c-d", "c", "d"));
    const depth2 = c.findAllChains("a", "d", 2);
    expect(depth2).toEqual([]); // d requires 3 hops
    const depth3 = c.findAllChains("a", "d", 3);
    expect(depth3.length).toBeGreaterThan(0);
  });
});
