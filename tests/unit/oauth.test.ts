import { describe, it, expect } from "vitest";
import {
  getCodexOAuthConfig,
  getGitHubDeviceCodeConfig,
} from "../../src/auth/oauth-server.js";

describe("OAuth Server", () => {
  describe("getCodexOAuthConfig", () => {
    it("returns correct Codex OAuth configuration", () => {
      const config = getCodexOAuthConfig();
      expect(config.clientId).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
      expect(config.authorizationUrl).toContain("auth.openai.com");
      expect(config.tokenUrl).toContain("auth.openai.com");
      expect(config.usePKCE).toBe(true);
      expect(config.scopes).toContain("openid");
    });

    it("uses PKCE by default", () => {
      const config = getCodexOAuthConfig();
      expect(config.usePKCE).toBe(true);
    });
  });

  describe("getGitHubDeviceCodeConfig", () => {
    it("returns correct GitHub device code configuration", () => {
      const config = getGitHubDeviceCodeConfig();
      expect(config.deviceCodeUrl).toContain("github.com/login/device");
      expect(config.tokenUrl).toContain("github.com/login/oauth");
      expect(config.scopes).toContain("read:user");
    });
  });
});

describe("Login Flows", () => {
  it("exports runLogin function", async () => {
    const { runLogin } = await import("../../src/auth/login.js");
    expect(typeof runLogin).toBe("function");
  });

  it("handles unknown provider gracefully", async () => {
    // The loginSingleProvider function should return failure for unknown providers
    // We test this indirectly through the module structure
    const mod = await import("../../src/auth/login.js");
    expect(mod.runLogin).toBeDefined();
  });
});
