/**
 * C27 — .wotann.yml parser / validator / merger tests.
 */

import { describe, it, expect } from "vitest";
import {
  mergeConfigs,
  parseWotannYaml,
  renderWotannYaml,
  type WotannYamlV1,
} from "../../src/core/wotann-yml.js";

describe("parseWotannYaml", () => {
  it("parses a full valid config", () => {
    const yaml = `
version: 1
providers:
  primary: anthropic
  fallback: [openai, gemini]
  models:
    code: claude-opus-4-7
    fast: claude-haiku-4-5
skills:
  enabled: [brainstorming, tdd]
  disabled: [deprecated-skill]
hooks:
  profile: strict
  allow: [SecretScanner]
  deny: [DestructiveGuard]
mcp:
  autoStart: [qmd]
  disabled: [cognee]
team:
  envHints: [ANTHROPIC_API_KEY]
  requiredCLIs: [gh, rg]
`;
    const { config, problems } = parseWotannYaml(yaml);
    expect(problems).toEqual([]);
    expect(config.providers?.primary).toBe("anthropic");
    expect(config.providers?.fallback).toEqual(["openai", "gemini"]);
    expect(config.providers?.models).toEqual({
      code: "claude-opus-4-7",
      fast: "claude-haiku-4-5",
    });
    expect(config.skills?.enabled).toEqual(["brainstorming", "tdd"]);
    expect(config.hooks?.profile).toBe("strict");
    expect(config.mcp?.autoStart).toEqual(["qmd"]);
    expect(config.team?.requiredCLIs).toEqual(["gh", "rg"]);
  });

  it("reports problems on unsupported version", () => {
    const { problems } = parseWotannYaml("version: 99\n");
    expect(problems.some((p) => p.includes("unsupported version"))).toBe(true);
  });

  it("reports problems on wrong field types", () => {
    const yaml = `
version: 1
providers:
  primary: 42
  fallback: "not an array"
skills:
  enabled: 9
hooks:
  profile: aggressive
`;
    const { problems } = parseWotannYaml(yaml);
    expect(problems.some((p) => p.includes("providers.primary"))).toBe(true);
    expect(problems.some((p) => p.includes("providers.fallback"))).toBe(true);
    expect(problems.some((p) => p.includes("skills.enabled"))).toBe(true);
    expect(problems.some((p) => p.includes("hooks.profile"))).toBe(true);
  });

  it("handles an empty document gracefully", () => {
    const { config, problems } = parseWotannYaml("");
    expect(config.version).toBe(1);
    expect(problems.some((p) => p.includes("empty"))).toBe(true);
  });

  it("surfaces a YAML parse error instead of throwing", () => {
    const { problems } = parseWotannYaml("version: 1\n  bad indentation:\nfoo:: bar");
    expect(problems.length).toBeGreaterThan(0);
  });

  it("treats missing optional sections as undefined", () => {
    const { config, problems } = parseWotannYaml("version: 1\nskills:\n  enabled: [s1]\n");
    expect(problems).toEqual([]);
    expect(config.providers).toBeUndefined();
    expect(config.hooks).toBeUndefined();
    expect(config.skills?.enabled).toEqual(["s1"]);
  });
});

describe("renderWotannYaml + round-trip", () => {
  it("round-trips a full config", () => {
    const original: WotannYamlV1 = {
      version: 1,
      providers: {
        primary: "anthropic",
        fallback: ["openai"],
        models: { code: "claude-opus-4-7" },
      },
      skills: { enabled: ["brainstorming"], disabled: [] },
      hooks: { profile: "standard", allow: [], deny: [] },
      mcp: { autoStart: [], disabled: [] },
      team: { envHints: [], requiredCLIs: [] },
    };
    const yaml = renderWotannYaml(original);
    const { config, problems } = parseWotannYaml(yaml);
    expect(problems).toEqual([]);
    expect(config.providers?.primary).toBe("anthropic");
    expect(config.skills?.enabled).toEqual(["brainstorming"]);
    expect(config.hooks?.profile).toBe("standard");
  });

  it("omits undefined sections from the rendered YAML", () => {
    const yaml = renderWotannYaml({ version: 1 });
    expect(yaml).not.toMatch(/providers/);
    expect(yaml).not.toMatch(/hooks/);
    expect(yaml).toMatch(/version: 1/);
  });
});

describe("mergeConfigs", () => {
  const base: WotannYamlV1 = {
    version: 1,
    providers: { primary: "anthropic", fallback: ["openai"], models: { code: "claude-opus-4-7" } },
    skills: { enabled: ["tdd"], disabled: [] },
    hooks: { profile: "standard", allow: ["SecretScanner"], deny: [] },
    mcp: { autoStart: ["qmd"], disabled: [] },
  };
  const override: WotannYamlV1 = {
    version: 1,
    providers: { primary: "openai", fallback: ["cerebras"], models: { fast: "haiku-4-5" } },
    skills: { enabled: ["brainstorming"], disabled: [] },
    hooks: { profile: "strict", allow: [], deny: ["DestructiveGuard"] },
    mcp: { autoStart: [], disabled: ["cognee"] },
  };

  it("override wins for scalars", () => {
    const merged = mergeConfigs(base, override);
    expect(merged.providers?.primary).toBe("openai");
    expect(merged.hooks?.profile).toBe("strict");
  });

  it("arrays union with base-first ordering and dedupe", () => {
    const merged = mergeConfigs(base, override);
    expect(merged.providers?.fallback).toEqual(["openai", "cerebras"]);
    expect(merged.skills?.enabled).toEqual(["tdd", "brainstorming"]);
  });

  it("object fields deep-merge (override keys win on collision)", () => {
    const merged = mergeConfigs(base, override);
    expect(merged.providers?.models).toEqual({
      code: "claude-opus-4-7",
      fast: "haiku-4-5",
    });
  });

  it("returns undefined sections when both sides omit them", () => {
    const merged = mergeConfigs({ version: 1 }, { version: 1 });
    expect(merged.providers).toBeUndefined();
    expect(merged.skills).toBeUndefined();
  });

  it("keeps override-only sections when base is silent", () => {
    const merged = mergeConfigs(
      { version: 1 },
      { version: 1, team: { requiredCLIs: ["gh"] } },
    );
    expect(merged.team?.requiredCLIs).toEqual(["gh"]);
  });
});
