import { describe, it, expect } from "vitest";
import { parseDeepLink, executeDeepLink, generateDeepLink, type DeepLinkContext } from "../../src/core/deep-link.js";

describe("Deep Link Protocol", () => {
  const mockContext: DeepLinkContext = {
    workingDir: "/tmp/test",
  };

  describe("parseDeepLink", () => {
    it("parses skill install link", () => {
      const result = parseDeepLink("wotann://skill/install?name=code-reviewer&url=https://example.com/skill.md");
      expect(result).not.toBeNull();
      expect(result!.action).toBe("skill/install");
      expect(result!.params["name"]).toBe("code-reviewer");
      expect(result!.params["url"]).toBe("https://example.com/skill.md");
    });

    it("parses mode set link", () => {
      const result = parseDeepLink("wotann://mode/set?mode=autonomous&task=fix+tests");
      expect(result).not.toBeNull();
      expect(result!.action).toBe("mode/set");
      expect(result!.params["mode"]).toBe("autonomous");
      expect(result!.params["task"]).toBe("fix tests");
    });

    it("parses theme set link", () => {
      const result = parseDeepLink("wotann://theme/set?name=dracula");
      expect(result).not.toBeNull();
      expect(result!.action).toBe("theme/set");
    });

    it("parses channel pair link", () => {
      const result = parseDeepLink("wotann://channel/pair?code=ABC123&channel=telegram");
      expect(result).not.toBeNull();
      expect(result!.action).toBe("channel/pair");
      expect(result!.params["code"]).toBe("ABC123");
    });

    it("returns null for non-wotann URLs", () => {
      expect(parseDeepLink("https://example.com")).toBeNull();
      expect(parseDeepLink("http://wotann.local/test")).toBeNull();
    });

    it("returns null for invalid actions", () => {
      expect(parseDeepLink("wotann://invalid/action")).toBeNull();
    });
  });

  describe("executeDeepLink", () => {
    it("handles skill install", () => {
      const request = parseDeepLink("wotann://skill/install?name=test&url=https://example.com")!;
      const result = executeDeepLink(request, mockContext);
      expect(result.success).toBe(false); // No installSkill in mock context
      expect(result.action).toBe("skill/install");
    });

    it("handles mode set with context", () => {
      let setModeCalled = "";
      const ctx: DeepLinkContext = {
        workingDir: "/tmp",
        setMode: (mode) => { setModeCalled = mode; },
      };
      const request = parseDeepLink("wotann://mode/set?mode=plan")!;
      const result = executeDeepLink(request, ctx);
      expect(result.success).toBe(true);
      expect(setModeCalled).toBe("plan");
    });

    it("handles theme set with context", () => {
      let themeSet = "";
      const ctx: DeepLinkContext = {
        workingDir: "/tmp",
        setTheme: (theme) => { themeSet = theme; return true; },
      };
      const request = parseDeepLink("wotann://theme/set?name=dracula")!;
      const result = executeDeepLink(request, ctx);
      expect(result.success).toBe(true);
      expect(themeSet).toBe("dracula");
    });

    it("handles channel pair with verifier", () => {
      const ctx: DeepLinkContext = {
        workingDir: "/tmp",
        verifyPairingCode: (code) => code === "VALID",
      };
      const valid = parseDeepLink("wotann://channel/pair?code=VALID")!;
      expect(executeDeepLink(valid, ctx).success).toBe(true);

      const invalid = parseDeepLink("wotann://channel/pair?code=WRONG")!;
      expect(executeDeepLink(invalid, ctx).success).toBe(false);
    });

    it("fails gracefully on missing params", () => {
      const request = parseDeepLink("wotann://skill/install")!;
      const result = executeDeepLink(request, mockContext);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Missing");
    });
  });

  describe("generateDeepLink", () => {
    it("generates valid wotann:// URLs", () => {
      const link = generateDeepLink("mode/set", { mode: "plan" });
      expect(link).toBe("wotann://mode/set?mode=plan");
    });

    it("encodes special characters", () => {
      const link = generateDeepLink("arena/start", { task: "fix all tests" });
      expect(link).toContain("wotann://arena/start");
      const parsed = parseDeepLink(link);
      expect(parsed!.params["task"]).toBe("fix all tests");
    });

    it("round-trips through parse", () => {
      const original = { name: "my-skill", url: "https://example.com/skill.md" };
      const link = generateDeepLink("skill/install", original);
      const parsed = parseDeepLink(link);
      expect(parsed!.params["name"]).toBe(original.name);
      expect(parsed!.params["url"]).toBe(original.url);
    });
  });

  describe("session share", () => {
    it("generates a share link", () => {
      const request = parseDeepLink("wotann://session/share?id=abc123")!;
      const result = executeDeepLink(request, mockContext);
      expect(result.success).toBe(true);
      expect(result.data?.["shareLink"]).toContain("wotann://session/resume");
    });
  });
});
