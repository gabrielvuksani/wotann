import { describe, it, expect } from "vitest";
import {
  CapabilityEqualizer,
  type CapabilityName,
} from "../../src/providers/capability-equalizer.js";

describe("CapabilityEqualizer", () => {
  it("returns capability profile for known models", () => {
    const eq = new CapabilityEqualizer();
    const profile = eq.getProfile("anthropic", "claude-opus-4-6");
    expect(profile).not.toBeNull();
    expect(profile!.capabilities.length).toBeGreaterThan(10);
  });

  it("checks individual capabilities", () => {
    const eq = new CapabilityEqualizer();
    expect(eq.hasCapability("anthropic", "claude-opus-4-6", "tool_use")).toBe("native");
    expect(eq.hasCapability("anthropic", "claude-opus-4-6", "thinking")).toBe("native");
    expect(eq.hasCapability("anthropic", "claude-opus-4-6", "json_mode")).toBe("emulated");
    expect(eq.hasCapability("anthropic", "claude-opus-4-6", "logprobs")).toBe("unavailable");
  });

  it("computes gaps when switching providers", () => {
    const eq = new CapabilityEqualizer();
    const gaps = eq.computeGaps("anthropic", "claude-opus-4-6", "ollama", "qwen3-coder-next");

    expect(gaps.length).toBeGreaterThan(0);
    // Ollama doesn't have vision
    const visionGap = gaps.find((g) => g.capability === "vision");
    expect(visionGap).toBeDefined();
    expect(visionGap!.targetStatus).toBe("unavailable");
  });

  it("builds adapter prompt for high-impact gaps", () => {
    const eq = new CapabilityEqualizer();
    const gaps = eq.computeGaps("anthropic", "claude-opus-4-6", "ollama", "qwen3-coder-next");
    const prompt = eq.buildAdapterPrompt(gaps);

    // Should have content since there are real gaps
    if (gaps.some((g) => g.impactLevel === "high")) {
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("Provider Capability Adaptation");
    }
  });

  it("returns empty gaps for same provider swap", () => {
    const eq = new CapabilityEqualizer();
    const gaps = eq.computeGaps("anthropic", "claude-opus-4-6", "anthropic", "claude-opus-4-6");
    expect(gaps.length).toBe(0);
  });

  it("registers custom profiles", () => {
    const eq = new CapabilityEqualizer();
    eq.registerProfile({
      provider: "custom", model: "custom-v1",
      capabilities: [
        { capability: "tool_use", status: "native" },
        { capability: "vision", status: "unavailable" },
      ],
    });

    const profile = eq.getProfile("custom", "custom-v1");
    expect(profile).not.toBeNull();
    expect(profile!.capabilities.length).toBe(2);
  });

  it("returns null for unknown models", () => {
    const eq = new CapabilityEqualizer();
    expect(eq.getProfile("unknown", "unknown-model")).toBeNull();
  });

  it("lists all tracked profiles", () => {
    const eq = new CapabilityEqualizer();
    const profiles = eq.listProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(4); // 4 built-in profiles
  });

  it("correctly identifies GPT-5.4 capabilities", () => {
    const eq = new CapabilityEqualizer();
    expect(eq.hasCapability("openai", "gpt-5.4", "json_mode")).toBe("native");
    expect(eq.hasCapability("openai", "gpt-5.4", "logprobs")).toBe("native");
    expect(eq.hasCapability("openai", "gpt-5.4", "mcp")).toBe("unavailable");
  });
});
