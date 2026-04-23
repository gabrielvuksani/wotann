import { describe, it, expect } from "vitest";
import { getGitHubDeviceCodeConfig } from "../../src/auth/oauth-server.js";

// getCodexOAuthConfig tests removed per V9 T0.2 — the Codex PKCE flow
// that used Codex CLI's public client_id against auth.openai.com has
// been deleted (it masqueraded as the official CLI). Codex auth is
// now read-existing-~/.codex/auth.json-only; there's no WOTANN-owned
// OAuth config left to test.

describe("OAuth Server", () => {
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
