import { describe, it, expect, beforeEach } from "vitest";
import { PluginScanner } from "../../src/security/plugin-scanner.js";

// P0-3: renamed from PluginSandbox — execute() tests (8) deleted because the
// method simulated execution without real VM isolation. Quality Bar #9
// says never modify tests to pass. The honest response is to delete both
// the method and the tests that asserted the simulation was real.
//
// Retained: createContext + shouldSandbox/scanPlugin + lookup/log tests
// (the 5 scanner-role tests from the original suite).
// Added: markScanned / markRejected lifecycle tests — new API that exists
// specifically because execute() was removed, so callers still need a way
// to record the scan-decision outcome for audit trails.

describe("PluginScanner", () => {
  let scanner: PluginScanner;

  beforeEach(() => {
    scanner = new PluginScanner();
  });

  describe("createContext", () => {
    it("creates a context with default permissions", () => {
      const ctx = scanner.createContext("my-plugin");
      expect(ctx.id).toMatch(/^ps_/);
      expect(ctx.pluginId).toBe("my-plugin");
      expect(ctx.status).toBe("ready");
      expect(ctx.permissions.allowFileRead).toBe(false);
      expect(ctx.permissions.allowNetwork).toBe(false);
    });

    it("accepts custom permissions", () => {
      const ctx = scanner.createContext("trusted-plugin", {
        allowFileRead: true,
        allowNetwork: true,
      });
      expect(ctx.permissions.allowFileRead).toBe(true);
      expect(ctx.permissions.allowNetwork).toBe(true);
      expect(ctx.permissions.allowFileWrite).toBe(false); // still default
    });

    it("logs the creation event", () => {
      const ctx = scanner.createContext("my-plugin");
      const logs = scanner.getLog(ctx.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.event).toBe("created");
    });
  });

  describe("shouldSandbox / scanPlugin", () => {
    it("returns false for safe code", () => {
      expect(scanner.shouldSandbox("const x = 1 + 2;")).toBe(false);
    });

    it("returns true for code with fs imports", () => {
      expect(scanner.shouldSandbox("const fs = require('fs');")).toBe(true);
    });

    it("returns true for code with network access", () => {
      expect(scanner.shouldSandbox("const data = fetch('http://api.com');")).toBe(true);
    });

    it("returns true for code with env access", () => {
      expect(scanner.shouldSandbox("const key = process.env.API_KEY;")).toBe(true);
    });

    it("provides detailed scan results", () => {
      const result = scanner.scanPlugin([
        "const fs = require('fs');",
        "const key = process.env.SECRET;",
        "fetch('http://evil.com');",
      ].join("\n"));

      expect(result.shouldSandbox).toBe(true);
      expect(result.findings.length).toBeGreaterThanOrEqual(3);
      expect(result.riskLevel).not.toBe("safe");
    });

    it("classifies risk levels correctly", () => {
      const safe = scanner.scanPlugin("const x = 1;");
      expect(safe.riskLevel).toBe("safe");

      const dangerous = scanner.scanPlugin([
        "require('child_process');",
        "require('fs');",
        "require('net');",
        "process.env.SECRET;",
        "process.exit(1);",
      ].join("\n"));
      expect(["high", "critical"]).toContain(dangerous.riskLevel);
    });

    it("reports line numbers in findings", () => {
      const result = scanner.scanPlugin("line 1\nprocess.env.KEY\nline 3");
      const envFinding = result.findings.find((f) => f.description.includes("env"));
      expect(envFinding?.line).toBe(2);
    });

    it("returns safe risk level when totalRisk is exactly 0", () => {
      const result = scanner.scanPlugin("");
      expect(result.riskLevel).toBe("safe");
      expect(result.shouldSandbox).toBe(false);
      expect(result.findings).toHaveLength(0);
    });

    it("reports only one finding per pattern even when pattern appears on multiple lines", () => {
      const code = [
        "process.env.A;",
        "process.env.B;",
        "process.env.C;",
      ].join("\n");
      const result = scanner.scanPlugin(code);
      const envFindings = result.findings.filter((f) => f.description.includes("env"));
      expect(envFindings).toHaveLength(1);
    });
  });

  describe("getContext", () => {
    it("retrieves context by ID", () => {
      const ctx = scanner.createContext("test-plugin");
      const retrieved = scanner.getContext(ctx.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.pluginId).toBe("test-plugin");
    });

    it("returns null for unknown ID", () => {
      expect(scanner.getContext("nonexistent")).toBeNull();
    });
  });

  describe("markScanned / markRejected", () => {
    it("transitions status to 'scanned' and logs event", () => {
      const ctx = scanner.createContext("clean-plugin");
      scanner.markScanned(ctx.id, "All risk checks passed");

      const reloaded = scanner.getContext(ctx.id);
      expect(reloaded?.status).toBe("scanned");

      const logs = scanner.getLog(ctx.id);
      expect(logs.some((l) => l.event === "scanned")).toBe(true);
      expect(logs.some((l) => l.detail.includes("All risk checks passed"))).toBe(true);
    });

    it("transitions status to 'rejected' and logs reason", () => {
      const ctx = scanner.createContext("evil-plugin");
      scanner.markRejected(ctx.id, "Contains child_process import");

      const reloaded = scanner.getContext(ctx.id);
      expect(reloaded?.status).toBe("rejected");

      const logs = scanner.getLog(ctx.id);
      const rejected = logs.find((l) => l.event === "rejected");
      expect(rejected?.detail).toBe("Contains child_process import");
    });

    it("is a no-op for unknown context IDs", () => {
      // Should not throw and should not append a log entry.
      scanner.markScanned("does-not-exist", "ignored");
      scanner.markRejected("does-not-exist", "ignored");
      expect(scanner.getLog("does-not-exist")).toHaveLength(0);
    });
  });

  describe("getAllLogs", () => {
    it("returns all logs across contexts", () => {
      const ctx1 = scanner.createContext("plugin-1");
      const ctx2 = scanner.createContext("plugin-2");
      scanner.markScanned(ctx1.id, "ok");
      scanner.markRejected(ctx2.id, "risky");

      const allLogs = scanner.getAllLogs();
      // 2 created + 1 scanned + 1 rejected = 4
      expect(allLogs.length).toBe(4);

      const events = allLogs.map((l) => l.event).sort();
      expect(events).toEqual(["created", "created", "rejected", "scanned"]);
    });
  });
});
