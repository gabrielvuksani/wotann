import { describe, it, expect } from "vitest";
import {
  buildSecurityResearchPrompt,
  getDefaultGuardrailsConfig,
  getGuardrailsWarning,
  getSafetyOverrides,
  getGeminiSafetySettings,
  CYBER_RISK_INSTRUCTION_OFF,
} from "../../src/security/guardrails-off.js";

describe("Guardrails-Off Mode", () => {
  it("builds provider-specific prompts", () => {
    const config = getDefaultGuardrailsConfig();

    const claudePrompt = buildSecurityResearchPrompt("anthropic", { ...config, enabled: true });
    expect(claudePrompt).toContain("CYBER_RISK_INSTRUCTION");
    expect(claudePrompt).toContain("authorized");

    const gptPrompt = buildSecurityResearchPrompt("openai", { ...config, enabled: true });
    expect(gptPrompt).toContain("security researcher");

    const ollamaPrompt = buildSecurityResearchPrompt("ollama", { ...config, enabled: true });
    expect(ollamaPrompt).toContain("no restrictions");
  });

  it("includes scope and rules of engagement", () => {
    const config = {
      ...getDefaultGuardrailsConfig(),
      enabled: true,
      scope: "192.168.1.0/24 internal network",
      authorization: "Pentest engagement #2024-042",
    };

    const prompt = buildSecurityResearchPrompt("anthropic", config);
    expect(prompt).toContain("192.168.1.0/24");
    expect(prompt).toContain("#2024-042");
  });

  it("default config is disabled", () => {
    const config = getDefaultGuardrailsConfig();
    expect(config.enabled).toBe(false);
    expect(config.rulesOfEngagement.length).toBeGreaterThan(0);
  });

  it("warning text mentions key terms", () => {
    const warning = getGuardrailsWarning();
    expect(warning).toContain("GUARDRAILS-OFF");
    expect(warning).toContain("responsible disclosure");
    expect(warning).toContain("authorized");
  });

  it("CYBER_RISK_INSTRUCTION is empty string when off", () => {
    expect(CYBER_RISK_INSTRUCTION_OFF).toBe("");
  });

  it("safety overrides are all cleared in guardrails-off", () => {
    const overrides = getSafetyOverrides(true);
    expect(overrides.cyberRiskInstruction).toBe("");
    expect(overrides.openaiSafetyInstruction).toBe("");
    expect(overrides.geminiHarmBlockThreshold).toBe("BLOCK_NONE");
    expect(overrides.hookEnginePaused).toBe(true);
    expect(overrides.secretScannerActive).toBe(false);
    expect(overrides.destructiveGuardActive).toBe(false);
  });

  it("safety overrides do NOT inject extra cyber-risk text in default mode", () => {
    // v9: paternalism removal. The harness no longer overlays additional
    // safety prompts on top of the model's RLHF in default mode (user
    // directive: "let the user do whatever they want, so there shouldn't
    // be such a thing as 'safeguards for model misuse'"). The
    // user-protecting guards stay on (hookEnginePaused: false,
    // secretScannerActive: true, destructiveGuardActive: true) — those
    // protect the USER from a confused/compromised agent.
    const overrides = getSafetyOverrides(false);
    expect(overrides.cyberRiskInstruction).toBe("");
    expect(overrides.openaiSafetyInstruction).toBe("");
    expect(overrides.hookEnginePaused).toBe(false);
    expect(overrides.secretScannerActive).toBe(true);
    expect(overrides.destructiveGuardActive).toBe(true);
  });

  it("Gemini safety settings are BLOCK_NONE when off", () => {
    const settings = getGeminiSafetySettings(true);
    expect(settings.length).toBe(4);
    expect(settings.every((s) => s.threshold === "BLOCK_NONE")).toBe(true);
  });

  it("Gemini safety settings stay BLOCK_NONE in default mode (paternalism removal)", () => {
    // v9: harness no longer tightens Google's own moderation behind the
    // user's back. Default = whatever Google enforces.
    const settings = getGeminiSafetySettings(false);
    expect(settings.every((s) => s.threshold === "BLOCK_NONE")).toBe(true);
  });

  it("handles all known providers", () => {
    const config = { ...getDefaultGuardrailsConfig(), enabled: true };
    const providers = ["anthropic", "openai", "codex", "copilot", "ollama", "gemini", "free", "azure", "bedrock", "vertex"] as const;

    for (const provider of providers) {
      const prompt = buildSecurityResearchPrompt(provider, config);
      expect(prompt.length).toBeGreaterThan(50);
      expect(prompt).toContain("Scope:");
    }
  });
});
