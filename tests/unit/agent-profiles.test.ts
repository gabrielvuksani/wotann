/**
 * C10 — Agent Profiles tests.
 */

import { describe, it, expect } from "vitest";
import {
  AGENT_PROFILES,
  allProfiles,
  applyProfile,
  cycleProfile,
  getProfile,
  parseProfileName,
  profilePermitsTool,
  renderProfileList,
  renderProfileSwitch,
  setProfile,
} from "../../src/core/agent-profiles.js";

describe("AGENT_PROFILES invariants", () => {
  it("has exactly 3 profiles", () => {
    expect(Object.keys(AGENT_PROFILES)).toEqual(["write", "ask", "minimal"]);
  });

  it("write profile allows all tools with strict hooks", () => {
    const p = AGENT_PROFILES.write;
    expect(p.allowedTools).toBe("all");
    expect(p.hookProfile).toBe("strict");
    expect(p.memoryDepth).toBe("full");
  });

  it("ask profile is read-only (includes Read, Grep, Glob, Web*)", () => {
    const p = AGENT_PROFILES.ask;
    expect(p.allowedTools).toContain("Read");
    expect(p.allowedTools).toContain("Grep");
    expect(p.allowedTools).toContain("Glob");
    expect(p.allowedTools).toContain("WebFetch");
    expect(p.allowedTools).not.toContain("Write");
    expect(p.allowedTools).not.toContain("Edit");
    expect(p.allowedTools).not.toContain("Bash");
  });

  it("minimal profile disallows every tool", () => {
    const p = AGENT_PROFILES.minimal;
    expect(Array.isArray(p.allowedTools) ? p.allowedTools.length : -1).toBe(0);
  });
});

describe("cycleProfile", () => {
  it("cycles write → ask → minimal → write", () => {
    expect(cycleProfile("write")).toBe("ask");
    expect(cycleProfile("ask")).toBe("minimal");
    expect(cycleProfile("minimal")).toBe("write");
  });
});

describe("profilePermitsTool", () => {
  it("write allows anything", () => {
    expect(profilePermitsTool(AGENT_PROFILES.write, "Write")).toBe(true);
    expect(profilePermitsTool(AGENT_PROFILES.write, "Bash")).toBe(true);
    expect(profilePermitsTool(AGENT_PROFILES.write, "Anything")).toBe(true);
  });

  it("ask allows Read/Grep/Web*, denies Write/Edit/Bash", () => {
    expect(profilePermitsTool(AGENT_PROFILES.ask, "Read")).toBe(true);
    expect(profilePermitsTool(AGENT_PROFILES.ask, "Grep")).toBe(true);
    expect(profilePermitsTool(AGENT_PROFILES.ask, "Write")).toBe(false);
    expect(profilePermitsTool(AGENT_PROFILES.ask, "Bash")).toBe(false);
  });

  it("minimal denies every tool", () => {
    expect(profilePermitsTool(AGENT_PROFILES.minimal, "Read")).toBe(false);
    expect(profilePermitsTool(AGENT_PROFILES.minimal, "Write")).toBe(false);
  });
});

describe("applyProfile overlay", () => {
  it("toolFilter returns true for permitted tools", () => {
    const overlay = applyProfile(AGENT_PROFILES.ask);
    expect(overlay.toolFilter("Read")).toBe(true);
    expect(overlay.toolFilter("Bash")).toBe(false);
  });

  it("hookProfile + memoryDepth + maxTurnTokens mirror the profile", () => {
    const overlay = applyProfile(AGENT_PROFILES.minimal);
    expect(overlay.hookProfile).toBe("minimal");
    expect(overlay.memoryDepth).toBe("none");
    expect(overlay.maxTurnTokens).toBe(8_000);
  });

  it("write overlay reports no token cap", () => {
    const overlay = applyProfile(AGENT_PROFILES.write);
    expect(overlay.maxTurnTokens).toBeUndefined();
  });
});

describe("getProfile + allProfiles", () => {
  it("getProfile returns by name", () => {
    expect(getProfile("ask").name).toBe("ask");
  });
  it("allProfiles returns all three in cycle order", () => {
    expect(allProfiles().map((p) => p.name)).toEqual(["write", "ask", "minimal"]);
  });
});

describe("renderers", () => {
  it("renderProfileSwitch summarises tool count", () => {
    expect(renderProfileSwitch(AGENT_PROFILES.write)).toMatch(/Write.*all tools/);
    expect(renderProfileSwitch(AGENT_PROFILES.ask)).toMatch(/Ask.*7 tools/);
    expect(renderProfileSwitch(AGENT_PROFILES.minimal)).toMatch(/Minimal.*no tools/);
  });

  it("renderProfileList lists all three with Shift+Tab hint", () => {
    const out = renderProfileList();
    expect(out).toMatch(/Shift\+Tab/);
    expect(out).toMatch(/Write/);
    expect(out).toMatch(/Ask/);
    expect(out).toMatch(/Minimal/);
  });
});

describe("setProfile + parseProfileName", () => {
  it("setProfile returns profile for valid names", () => {
    expect(setProfile("write").name).toBe("write");
    expect(setProfile("ask").name).toBe("ask");
    expect(setProfile("minimal").name).toBe("minimal");
  });

  it("setProfile throws on unknown profile", () => {
    expect(() => setProfile("invalid")).toThrow(/Unknown agent profile/);
    expect(() => setProfile("")).toThrow();
  });

  it("parseProfileName returns name for valid inputs", () => {
    expect(parseProfileName("write")).toBe("write");
    expect(parseProfileName("ask")).toBe("ask");
    expect(parseProfileName("minimal")).toBe("minimal");
  });

  it("parseProfileName returns null for unknown inputs", () => {
    expect(parseProfileName("invalid")).toBeNull();
    expect(parseProfileName(42)).toBeNull();
    expect(parseProfileName(undefined)).toBeNull();
    expect(parseProfileName(null)).toBeNull();
  });
});
