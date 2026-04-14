import { describe, it, expect, beforeEach } from "vitest";
import { PluginSandbox } from "../../src/security/plugin-sandbox.js";

describe("PluginSandbox", () => {
  let sandbox: PluginSandbox;

  beforeEach(() => {
    sandbox = new PluginSandbox();
  });

  describe("createSandbox", () => {
    it("creates a sandbox with default permissions", () => {
      const ctx = sandbox.createSandbox("my-plugin");
      expect(ctx.id).toMatch(/^sb_/);
      expect(ctx.pluginId).toBe("my-plugin");
      expect(ctx.status).toBe("ready");
      expect(ctx.permissions.allowFileRead).toBe(false);
      expect(ctx.permissions.allowNetwork).toBe(false);
    });

    it("accepts custom permissions", () => {
      const ctx = sandbox.createSandbox("trusted-plugin", {
        allowFileRead: true,
        allowNetwork: true,
      });
      expect(ctx.permissions.allowFileRead).toBe(true);
      expect(ctx.permissions.allowNetwork).toBe(true);
      expect(ctx.permissions.allowFileWrite).toBe(false); // still default
    });

    it("logs the creation event", () => {
      const ctx = sandbox.createSandbox("my-plugin");
      const logs = sandbox.getExecutionLog(ctx.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.event).toBe("created");
    });
  });

  describe("execute", () => {
    it("executes safe code successfully", () => {
      const ctx = sandbox.createSandbox("safe-plugin");
      const result = sandbox.execute(ctx.id, "const x = 1 + 2;");

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
      expect(result.output).toContain("Code executed");
    });

    it("blocks file read when not permitted", () => {
      const ctx = sandbox.createSandbox("bad-plugin");
      const result = sandbox.execute(ctx.id, "readFileSync('/etc/passwd')");

      expect(result.success).toBe(false);
      expect(result.error).toContain("File read not permitted");
    });

    it("blocks file write when not permitted", () => {
      const ctx = sandbox.createSandbox("bad-plugin");
      const result = sandbox.execute(ctx.id, "writeFileSync('/tmp/evil', 'data')");

      expect(result.success).toBe(false);
      expect(result.error).toContain("File write not permitted");
    });

    it("blocks network access when not permitted", () => {
      const ctx = sandbox.createSandbox("bad-plugin");
      const result = sandbox.execute(ctx.id, "fetch('https://evil.com')");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network access not permitted");
    });

    it("blocks env access when not permitted", () => {
      const ctx = sandbox.createSandbox("bad-plugin");
      const result = sandbox.execute(ctx.id, "const key = process.env.SECRET");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Environment variable access not permitted");
    });

    it("allows file read when permitted", () => {
      const ctx = sandbox.createSandbox("reader-plugin", { allowFileRead: true });
      const result = sandbox.execute(ctx.id, "readFileSync('/data/config.json')");

      expect(result.success).toBe(true);
    });

    it("returns error for nonexistent sandbox", () => {
      const result = sandbox.execute("nonexistent", "code");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Sandbox not found");
    });

    it("logs start and completion events", () => {
      const ctx = sandbox.createSandbox("logged-plugin");
      sandbox.execute(ctx.id, "const x = 1;");

      const logs = sandbox.getExecutionLog(ctx.id);
      const events = logs.map((l) => l.event);
      expect(events).toContain("created");
      expect(events).toContain("started");
      expect(events).toContain("completed");
    });

    it("logs permission denied events", () => {
      const ctx = sandbox.createSandbox("blocked-plugin");
      sandbox.execute(ctx.id, "fetch('http://evil.com')");

      const logs = sandbox.getExecutionLog(ctx.id);
      expect(logs.some((l) => l.event === "permission-denied")).toBe(true);
    });
  });

  describe("shouldSandbox / scanPlugin", () => {
    it("returns false for safe code", () => {
      expect(sandbox.shouldSandbox("const x = 1 + 2;")).toBe(false);
    });

    it("returns true for code with fs imports", () => {
      expect(sandbox.shouldSandbox("const fs = require('fs');")).toBe(true);
    });

    it("returns true for code with network access", () => {
      expect(sandbox.shouldSandbox("const data = fetch('http://api.com');")).toBe(true);
    });

    it("returns true for code with env access", () => {
      expect(sandbox.shouldSandbox("const key = process.env.API_KEY;")).toBe(true);
    });

    it("provides detailed scan results", () => {
      const result = sandbox.scanPlugin([
        "const fs = require('fs');",
        "const key = process.env.SECRET;",
        "fetch('http://evil.com');",
      ].join("\n"));

      expect(result.shouldSandbox).toBe(true);
      expect(result.findings.length).toBeGreaterThanOrEqual(3);
      expect(result.riskLevel).not.toBe("safe");
    });

    it("classifies risk levels correctly", () => {
      const safe = sandbox.scanPlugin("const x = 1;");
      expect(safe.riskLevel).toBe("safe");

      const dangerous = sandbox.scanPlugin([
        "require('child_process');",
        "require('fs');",
        "require('net');",
        "process.env.SECRET;",
        "process.exit(1);",
      ].join("\n"));
      expect(["high", "critical"]).toContain(dangerous.riskLevel);
    });

    it("reports line numbers in findings", () => {
      const result = sandbox.scanPlugin("line 1\nprocess.env.KEY\nline 3");
      const envFinding = result.findings.find((f) => f.description.includes("env"));
      expect(envFinding?.line).toBe(2);
    });
  });

  describe("getSandbox", () => {
    it("retrieves sandbox by ID", () => {
      const ctx = sandbox.createSandbox("test-plugin");
      const retrieved = sandbox.getSandbox(ctx.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.pluginId).toBe("test-plugin");
    });

    it("returns null for unknown ID", () => {
      expect(sandbox.getSandbox("nonexistent")).toBeNull();
    });
  });

  describe("getAllLogs", () => {
    it("returns all logs across sandboxes", () => {
      const ctx1 = sandbox.createSandbox("plugin-1");
      const ctx2 = sandbox.createSandbox("plugin-2");
      sandbox.execute(ctx1.id, "code1");
      sandbox.execute(ctx2.id, "code2");

      const allLogs = sandbox.getAllLogs();
      expect(allLogs.length).toBeGreaterThanOrEqual(6); // 2 created + 2 started + 2 completed
    });
  });
});
