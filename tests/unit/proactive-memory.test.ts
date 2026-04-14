import { describe, it, expect, beforeEach } from "vitest";
import { ProactiveMemoryEngine } from "../../src/memory/proactive-memory.js";

describe("Proactive Memory Engine", () => {
  let engine: ProactiveMemoryEngine;

  beforeEach(() => {
    engine = new ProactiveMemoryEngine({
      maxHints: 5,
      minRelevance: 0.3,
      suppressAfterShown: 1, // 1 minute suppress for tests
      enabledTriggers: [
        "file-opened",
        "task-started",
        "error-encountered",
        "mode-switched",
        "pattern-detected",
      ],
    });
  });

  describe("file-opened triggers", () => {
    it("returns related-file hints for test files", () => {
      const hints = engine.processEvent({
        type: "file-opened",
        data: { file: "src/auth.test.ts" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0]?.type).toBe("related-file");
    });

    it("returns hints for React component files", () => {
      const hints = engine.processEvent({
        type: "file-opened",
        data: { file: "src/components/Button.tsx" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0]?.content).toContain("React component");
    });

    it("returns hints for package.json", () => {
      const hints = engine.processEvent({
        type: "file-opened",
        data: { file: "package.json" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0]?.content).toContain("install");
    });
  });

  describe("error-encountered triggers", () => {
    it("finds known fixes for ESM errors", () => {
      const hints = engine.processEvent({
        type: "error-encountered",
        data: { error: "Cannot find module './utils/helpers.js'" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0]?.type).toBe("known-fix");
      expect(hints[0]?.content).toContain("ESM");
    });

    it("finds known fixes for ECONNREFUSED", () => {
      const hints = engine.processEvent({
        type: "error-encountered",
        data: { error: "ECONNREFUSED 127.0.0.1:3000 connect to localhost failed" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0]?.content).toContain("Server not running");
    });

    it("finds known fixes for out of memory", () => {
      const hints = engine.processEvent({
        type: "error-encountered",
        data: { error: "FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0]?.content).toContain("heap");
    });
  });

  describe("task-started triggers", () => {
    it("provides auth-related hints", () => {
      const hints = engine.processEvent({
        type: "task-started",
        data: { task: "Implement OAuth2 login flow with token refresh" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints.some((h) => h.content.includes("token"))).toBe(true);
    });

    it("provides migration hints for database tasks", () => {
      const hints = engine.processEvent({
        type: "task-started",
        data: { task: "Add migration for new users table" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints.some((h) => h.content.includes("rollback"))).toBe(true);
    });

    it("provides refactoring hints", () => {
      const hints = engine.processEvent({
        type: "task-started",
        data: { task: "Refactor the auth module to extract middleware" },
      });
      expect(hints.length).toBeGreaterThan(0);
      expect(hints.some((h) => h.content.includes("callers"))).toBe(true);
    });
  });

  describe("mode-switched triggers", () => {
    it("provides autonomous mode hint", () => {
      const hints = engine.processEvent({
        type: "mode-switched",
        data: { mode: "autonomous" },
      });
      expect(hints.length).toBe(1);
      expect(hints[0]?.content).toContain("success criteria");
    });

    it("provides guardrails-off hint", () => {
      const hints = engine.processEvent({
        type: "mode-switched",
        data: { mode: "guardrails-off" },
      });
      expect(hints.length).toBe(1);
      expect(hints[0]?.content).toContain("hook engine paused");
    });

    it("provides review mode hint", () => {
      const hints = engine.processEvent({
        type: "mode-switched",
        data: { mode: "review" },
      });
      expect(hints.length).toBe(1);
      expect(hints[0]?.content).toContain("security");
    });
  });

  describe("custom patterns", () => {
    it("triggers on registered custom patterns", () => {
      engine.registerPattern(
        /API rate limit/i,
        "Consider implementing request queuing with exponential backoff",
        "custom-api",
      );

      const hints = engine.processEvent({
        type: "error-encountered",
        data: { error: "API rate limit exceeded for user auth endpoint" },
      });

      expect(hints.some((h) => h.content.includes("queuing"))).toBe(true);
    });
  });

  describe("hint suppression", () => {
    it("suppresses recently shown hints", () => {
      // First call — should get hints
      const first = engine.processEvent({
        type: "mode-switched",
        data: { mode: "autonomous" },
      });
      expect(first.length).toBe(1);

      // Immediate second call — should be suppressed
      const second = engine.processEvent({
        type: "mode-switched",
        data: { mode: "autonomous" },
      });
      expect(second.length).toBe(0);
    });
  });

  describe("history tracking", () => {
    it("tracks shown hints", () => {
      engine.processEvent({ type: "mode-switched", data: { mode: "autonomous" } });
      engine.processEvent({ type: "error-encountered", data: { error: "ECONNREFUSED localhost" } });

      const history = engine.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("disabled triggers", () => {
    it("ignores events for disabled trigger types", () => {
      const restricted = new ProactiveMemoryEngine({
        enabledTriggers: ["error-encountered"], // Only errors
      });

      const hints = restricted.processEvent({
        type: "mode-switched",
        data: { mode: "autonomous" },
      });
      expect(hints.length).toBe(0);
    });
  });
});
