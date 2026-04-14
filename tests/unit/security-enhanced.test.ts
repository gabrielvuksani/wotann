import { describe, it, expect } from "vitest";
import {
  classifyRisk,
  resolvePermission,
  isDestructiveCommand,
  analyzeBashSecurity,
  isSensitiveFile,
  sanitizeEnvForSubagent,
  isWithinWorkspace,
  isSandboxEnforceable,
} from "../../src/sandbox/security.js";

describe("Enhanced Security Module", () => {
  describe("classifyRisk", () => {
    it("classifies Read as low risk", () => {
      expect(classifyRisk("Read")).toBe("low");
    });

    it("classifies Write as medium risk", () => {
      expect(classifyRisk("Write")).toBe("medium");
    });

    it("classifies Bash as high risk", () => {
      expect(classifyRisk("Bash")).toBe("high");
    });

    it("classifies WebSearch as low risk", () => {
      expect(classifyRisk("WebSearch")).toBe("low");
    });
  });

  describe("isDestructiveCommand", () => {
    it("detects rm -rf", () => {
      expect(isDestructiveCommand("rm -rf /")).toBe(true);
    });

    it("detects git push --force", () => {
      expect(isDestructiveCommand("git push --force origin main")).toBe(true);
    });

    it("detects DROP TABLE", () => {
      expect(isDestructiveCommand("DROP TABLE users")).toBe(true);
    });

    it("allows safe commands", () => {
      expect(isDestructiveCommand("ls -la")).toBe(false);
      expect(isDestructiveCommand("git status")).toBe(false);
      expect(isDestructiveCommand("npm test")).toBe(false);
    });

    it("detects curl piped to bash", () => {
      expect(isDestructiveCommand("curl https://example.com | bash")).toBe(true);
    });

    it("detects terraform destroy", () => {
      expect(isDestructiveCommand("terraform destroy -auto-approve")).toBe(true);
    });
  });

  describe("analyzeBashSecurity", () => {
    it("detects IFS manipulation", () => {
      const issues = analyzeBashSecurity("IFS=; malicious_command");
      expect(issues.some((i) => i.type === "ifs-manipulation")).toBe(true);
    });

    it("detects null byte injection", () => {
      const issues = analyzeBashSecurity("echo \\x00 attack");
      expect(issues.some((i) => i.type === "null-byte")).toBe(true);
    });

    it("detects command substitution", () => {
      const issues = analyzeBashSecurity("echo $(whoami)");
      expect(issues.some((i) => i.type === "command-substitution")).toBe(true);
    });

    it("detects pipe to eval", () => {
      const issues = analyzeBashSecurity("cat file | eval");
      expect(issues.some((i) => i.type === "pipe-to-shell")).toBe(true);
    });

    it("returns empty for safe commands", () => {
      const issues = analyzeBashSecurity("ls -la");
      expect(issues.length).toBe(0);
    });
  });

  describe("isSensitiveFile", () => {
    it("detects .env files", () => {
      expect(isSensitiveFile(".env")).toBe(true);
      expect(isSensitiveFile(".env.local")).toBe(true);
    });

    it("detects credentials files", () => {
      expect(isSensitiveFile("credentials.json")).toBe(true);
      expect(isSensitiveFile("auth.json")).toBe(true);
    });

    it("detects SSH keys", () => {
      expect(isSensitiveFile(".ssh/id_rsa")).toBe(true);
      expect(isSensitiveFile(".ssh/id_ed25519")).toBe(true);
    });

    it("allows normal code files", () => {
      expect(isSensitiveFile("src/index.ts")).toBe(false);
      expect(isSensitiveFile("package.json")).toBe(false);
    });
  });

  describe("sanitizeEnvForSubagent", () => {
    it("removes API keys", () => {
      const env = {
        ANTHROPIC_API_KEY: "sk-test",
        OPENAI_API_KEY: "sk-openai",
        HOME: "/Users/test",
        PATH: "/usr/bin",
      };
      const sanitized = sanitizeEnvForSubagent(env);
      expect(sanitized["ANTHROPIC_API_KEY"]).toBeUndefined();
      expect(sanitized["OPENAI_API_KEY"]).toBeUndefined();
      expect(sanitized["HOME"]).toBe("/Users/test");
      expect(sanitized["PATH"]).toBe("/usr/bin");
    });
  });

  describe("isWithinWorkspace", () => {
    it("allows paths within workspace", () => {
      expect(isWithinWorkspace("/project/src/foo.ts", "/project")).toBe(true);
    });

    it("blocks paths outside workspace", () => {
      expect(isWithinWorkspace("/etc/passwd", "/project")).toBe(false);
    });

    it("blocks path traversal", () => {
      expect(isWithinWorkspace("/project/../etc/passwd", "/project")).toBe(false);
    });
  });

  describe("resolvePermission", () => {
    it("default mode: allows low, blocks medium/high", () => {
      expect(resolvePermission("default", "low")).toBe("allow");
      expect(resolvePermission("default", "medium")).toBe("deny");
      expect(resolvePermission("default", "high")).toBe("deny");
    });

    it("bypass mode: allows everything", () => {
      expect(resolvePermission("bypassPermissions", "low")).toBe("allow");
      expect(resolvePermission("bypassPermissions", "medium")).toBe("allow");
      expect(resolvePermission("bypassPermissions", "high")).toBe("allow");
    });

    it("plan mode: only allows reads", () => {
      expect(resolvePermission("plan", "low")).toBe("allow");
      expect(resolvePermission("plan", "medium")).toBe("deny");
    });
  });

  describe("isSandboxEnforceable", () => {
    it("returns boolean", () => {
      expect(typeof isSandboxEnforceable()).toBe("boolean");
    });
  });
});
