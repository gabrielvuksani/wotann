import { describe, it, expect, beforeEach } from "vitest";
import {
  TerminalMonitor,
  type TerminalEvent,
} from "../../src/daemon/terminal-monitor.js";

describe("TerminalMonitor", () => {
  let monitor: TerminalMonitor;

  beforeEach(() => {
    monitor = new TerminalMonitor();
  });

  // ── record() ───────────────────────────────────────────────

  describe("record", () => {
    it("records a successful command", () => {
      const event = monitor.record("ls", "file1\nfile2", 0);

      expect(event.command).toBe("ls");
      expect(event.output).toBe("file1\nfile2");
      expect(event.exitCode).toBe(0);
      expect(event.hasError).toBe(false);
      expect(event.errorType).toBeUndefined();
      expect(event.suggestedFix).toBeUndefined();
    });

    it("records a timestamp", () => {
      const before = Date.now();
      const event = monitor.record("echo hi", "hi", 0);
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it("detects npm missing script error", () => {
      const event = monitor.record(
        "npm run nonexistent",
        "npm ERR! Missing script: \"nonexistent\"",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("missing-script");
      expect(event.suggestedFix).toBe("Check package.json scripts section");
    });

    it("detects ENOENT error", () => {
      const event = monitor.record(
        "cat missing.txt",
        "Error: ENOENT: no such file or directory",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("file-not-found");
      expect(event.suggestedFix).toBe("File or directory not found: check the path");
    });

    it("detects EACCES / permission denied error", () => {
      const event = monitor.record(
        "rm /etc/hosts",
        "rm: /etc/hosts: Permission denied",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("permission-denied");
      expect(event.suggestedFix).toContain("Permission denied");
    });

    it("detects EACCES error code", () => {
      const event = monitor.record(
        "node server.js",
        "Error: EACCES: permission denied, open '/root/file'",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("permission-denied");
    });

    it("detects Module not found error", () => {
      const event = monitor.record(
        "node app.js",
        "Error: Cannot find module 'express'",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("missing-module");
      expect(event.suggestedFix).toBe("Missing dependency: run npm install");
    });

    it("detects SyntaxError", () => {
      const event = monitor.record(
        "node bad.js",
        "SyntaxError: Unexpected token '}'",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("syntax-error");
      expect(event.suggestedFix).toContain("Syntax error");
    });

    it("detects EADDRINUSE error", () => {
      const event = monitor.record(
        "node server.js",
        "Error: listen EADDRINUSE: address already in use :::3000",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("port-in-use");
      expect(event.suggestedFix).toContain("Port already in use");
    });

    it("detects TypeError", () => {
      const event = monitor.record(
        "node app.js",
        "TypeError: Cannot read properties of undefined (reading 'map')",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("type-error");
      expect(event.suggestedFix).toContain("variable types");
    });

    it("detects ReferenceError", () => {
      const event = monitor.record(
        "node app.js",
        "ReferenceError: foo is not defined",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("reference-error");
      expect(event.suggestedFix).toContain("variable types");
    });

    it("detects git errors", () => {
      const event = monitor.record(
        "git push",
        "fatal: The current branch has no upstream branch.",
        1,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("git-error");
      expect(event.suggestedFix).toContain("Git operation failed");
    });

    it("falls back to exit-code error for unknown patterns", () => {
      const event = monitor.record(
        "some-tool",
        "some unknown error output",
        42,
      );

      expect(event.hasError).toBe(true);
      expect(event.errorType).toBe("unknown-error");
      expect(event.suggestedFix).toBe("Command failed with exit code 42");
    });

    it("treats exit code 0 as success even with noisy output", () => {
      const event = monitor.record(
        "make build",
        "warning: unused variable\nBuild complete.",
        0,
      );

      expect(event.hasError).toBe(false);
    });
  });

  // ── getRecent() ────────────────────────────────────────────

  describe("getRecent", () => {
    it("returns events in reverse chronological order", () => {
      monitor.record("cmd1", "out1", 0);
      monitor.record("cmd2", "out2", 0);
      monitor.record("cmd3", "out3", 0);

      const recent = monitor.getRecent();
      expect(recent).toHaveLength(3);
      expect(recent[0]!.command).toBe("cmd3");
      expect(recent[1]!.command).toBe("cmd2");
      expect(recent[2]!.command).toBe("cmd1");
    });

    it("respects limit parameter", () => {
      monitor.record("cmd1", "", 0);
      monitor.record("cmd2", "", 0);
      monitor.record("cmd3", "", 0);

      const recent = monitor.getRecent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0]!.command).toBe("cmd3");
      expect(recent[1]!.command).toBe("cmd2");
    });

    it("returns empty array when no events recorded", () => {
      expect(monitor.getRecent()).toEqual([]);
    });
  });

  // ── getErrors() ────────────────────────────────────────────

  describe("getErrors", () => {
    it("returns only error events", () => {
      monitor.record("ls", "files", 0);
      monitor.record("bad-cmd", "ENOENT", 1);
      monitor.record("echo hello", "hello", 0);
      monitor.record("fail", "SyntaxError: oops", 1);

      const errors = monitor.getErrors();
      expect(errors).toHaveLength(2);
      expect(errors[0]!.errorType).toBe("syntax-error");
      expect(errors[1]!.errorType).toBe("file-not-found");
    });

    it("respects limit parameter", () => {
      monitor.record("a", "ENOENT", 1);
      monitor.record("b", "SyntaxError", 1);
      monitor.record("c", "TypeError", 1);

      const errors = monitor.getErrors(2);
      expect(errors).toHaveLength(2);
    });

    it("returns empty array when no errors", () => {
      monitor.record("ls", "ok", 0);
      expect(monitor.getErrors()).toEqual([]);
    });
  });

  // ── getLastErrorWithSuggestion() ───────────────────────────

  describe("getLastErrorWithSuggestion", () => {
    it("returns the most recent error with a suggested fix", () => {
      monitor.record("cmd1", "ENOENT", 1);
      monitor.record("cmd2", "ok", 0);
      monitor.record("cmd3", "SyntaxError: fail", 1);

      const last = monitor.getLastErrorWithSuggestion();
      expect(last).not.toBeNull();
      expect(last!.command).toBe("cmd3");
      expect(last!.suggestedFix).toContain("Syntax error");
    });

    it("returns null when no errors exist", () => {
      monitor.record("ls", "ok", 0);
      expect(monitor.getLastErrorWithSuggestion()).toBeNull();
    });

    it("returns null when history is empty", () => {
      expect(monitor.getLastErrorWithSuggestion()).toBeNull();
    });
  });

  // ── clear() ────────────────────────────────────────────────

  describe("clear", () => {
    it("removes all events", () => {
      monitor.record("cmd1", "out", 0);
      monitor.record("cmd2", "err", 1);
      expect(monitor.getRecent()).toHaveLength(2);

      monitor.clear();
      expect(monitor.getRecent()).toEqual([]);
      expect(monitor.getErrors()).toEqual([]);
      expect(monitor.getLastErrorWithSuggestion()).toBeNull();
    });
  });

  // ── History cap ────────────────────────────────────────────

  describe("history cap", () => {
    it("trims oldest events when exceeding max history (default 50)", () => {
      for (let i = 0; i < 60; i++) {
        monitor.record(`cmd-${i}`, "out", 0);
      }

      const recent = monitor.getRecent();
      expect(recent.length).toBeLessThanOrEqual(50);
      // Most recent should be cmd-59
      expect(recent[0]!.command).toBe("cmd-59");
    });

    it("respects custom max history", () => {
      const small = new TerminalMonitor(5);

      for (let i = 0; i < 10; i++) {
        small.record(`cmd-${i}`, "out", 0);
      }

      const recent = small.getRecent();
      expect(recent.length).toBeLessThanOrEqual(5);
      expect(recent[0]!.command).toBe("cmd-9");
    });
  });
});
