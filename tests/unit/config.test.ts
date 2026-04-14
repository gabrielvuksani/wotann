import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, getDefaultConfig, loadConfigFromEnv } from "../../src/core/config.js";

describe("Config System", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("OLLAMA_URL", "");
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("AZURE_OPENAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getDefaultConfig", () => {
    it("returns default config with standard hook profile", () => {
      const config = getDefaultConfig();
      expect(config.version).toBe("0.1.0");
      expect(config.hooks.profile).toBe("standard");
      expect(config.memory.enabled).toBe(true);
      expect(config.daemon.enabled).toBe(false);
    });

    it("returns immutable copies", () => {
      const a = getDefaultConfig();
      const b = getDefaultConfig();
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe("loadConfigFromEnv", () => {
    it("detects ANTHROPIC_API_KEY", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-key");
      const env = loadConfigFromEnv();
      expect(env.providers).toBeDefined();
      expect(env.providers?.["anthropic"]).toBeDefined();
    });

    it("detects OPENAI_API_KEY", () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
      const env = loadConfigFromEnv();
      expect(env.providers?.["openai"]).toBeDefined();
    });

    it("detects GH_TOKEN for Copilot", () => {
      vi.stubEnv("GH_TOKEN", "ghp_test123");
      const env = loadConfigFromEnv();
      expect(env.providers?.["copilot"]).toBeDefined();
    });

    it("returns empty when no env vars set", () => {
      const env = loadConfigFromEnv();
      expect(env).toEqual({});
    });
  });

  describe("loadConfig", () => {
    it("returns valid config even with no workspace", () => {
      const config = loadConfig(null);
      expect(config.version).toBeDefined();
      expect(config.hooks).toBeDefined();
      expect(config.hooks.profile).toBe("standard");
    });

    it("merges env config into defaults", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
      const config = loadConfig(null);
      expect(config.providers["anthropic"]).toBeDefined();
    });

    it("applies CLI overrides", () => {
      const config = loadConfig(null, { hookProfile: "strict" });
      expect(config.hooks.profile).toBe("strict");
    });
  });
});
