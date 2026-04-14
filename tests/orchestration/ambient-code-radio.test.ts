import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AmbientCodeRadio } from "../../src/orchestration/ambient-code-radio.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

describe("AmbientCodeRadio", () => {
  let radio: AmbientCodeRadio;
  let tempDir: string;

  beforeEach(() => {
    radio = new AmbientCodeRadio();
    tempDir = mkdtempSync(join(tmpdir(), "wotann-radio-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const path = join(tempDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
    return path;
  }

  describe("startWatching / stopWatching", () => {
    it("starts and stops watching", () => {
      expect(radio.isWatching()).toBe(false);
      radio.startWatching(tempDir);
      expect(radio.isWatching()).toBe(true);
      expect(radio.getWatchDir()).toBe(tempDir);

      radio.stopWatching();
      expect(radio.isWatching()).toBe(false);
      expect(radio.getWatchDir()).toBeNull();
    });
  });

  describe("processChange", () => {
    it("returns no suggestions when not watching", () => {
      const path = writeFile("test.ts", "console.log('debug');");
      const suggestions = radio.processChange(path, "modify");
      expect(suggestions).toHaveLength(0);
    });

    it("detects console.log in TypeScript files", () => {
      radio.startWatching(tempDir);
      const path = writeFile("app.ts", "console.log('debug');");
      const suggestions = radio.processChange(path, "modify");

      expect(suggestions.length).toBeGreaterThanOrEqual(1);
      const logSuggestion = suggestions.find((s) => s.title.includes("console.log"));
      expect(logSuggestion).toBeDefined();
      expect(logSuggestion!.type).toBe("bug");
    });

    it("detects hardcoded secrets", () => {
      radio.startWatching(tempDir);
      const path = writeFile("config.ts", 'const api_key = "sk-abc123xyz";');
      const suggestions = radio.processChange(path, "modify");

      const secretSuggestion = suggestions.find((s) => s.title.includes("secret"));
      expect(secretSuggestion).toBeDefined();
      expect(secretSuggestion!.priority).toBe("critical");
    });

    it("detects empty catch blocks", () => {
      radio.startWatching(tempDir);
      const path = writeFile("handler.ts", "try { x(); } catch (e) {}");
      const suggestions = radio.processChange(path, "modify");

      const catchSuggestion = suggestions.find((s) => s.title.includes("Empty catch"));
      expect(catchSuggestion).toBeDefined();
    });

    it("detects async forEach", () => {
      radio.startWatching(tempDir);
      const path = writeFile("process.ts", "items.forEach(async (item) => { await save(item); });");
      const suggestions = radio.processChange(path, "modify");

      const asyncSuggestion = suggestions.find((s) => s.title.includes("Async callback"));
      expect(asyncSuggestion).toBeDefined();
      expect(asyncSuggestion!.type).toBe("performance");
    });

    it("skips test files", () => {
      radio.startWatching(tempDir);
      const path = writeFile("app.test.ts", "console.log('this is fine in tests');");
      const suggestions = radio.processChange(path, "modify");
      expect(suggestions).toHaveLength(0);
    });

    it("skips ignored patterns", () => {
      radio.startWatching(tempDir);
      const path = writeFile("node_modules/pkg/index.ts", "console.log('ignored');");
      const suggestions = radio.processChange(path, "modify");
      expect(suggestions).toHaveLength(0);
    });

    it("returns empty for delete events", () => {
      radio.startWatching(tempDir);
      const suggestions = radio.processChange("/fake/file.ts", "delete");
      expect(suggestions).toHaveLength(0);
    });

    it("skips unsupported extensions", () => {
      radio.startWatching(tempDir);
      const path = writeFile("readme.md", "console.log('not code');");
      const suggestions = radio.processChange(path, "modify");
      expect(suggestions).toHaveLength(0);
    });
  });

  describe("getSuggestions", () => {
    it("returns suggestions sorted by priority", () => {
      radio.startWatching(tempDir);
      const path = writeFile("risky.ts", [
        "// TODO: fix later",
        'const token = "hardcoded-secret-value";',
        "console.log('debug');",
      ].join("\n"));
      radio.processChange(path, "modify");

      const suggestions = radio.getSuggestions();
      expect(suggestions.length).toBeGreaterThanOrEqual(2);

      // First suggestion should be highest priority (critical > high > medium > low)
      const priorities = suggestions.map((s) => s.priority);
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      for (let i = 1; i < priorities.length; i++) {
        expect(order[priorities[i]!]).toBeGreaterThanOrEqual(order[priorities[i - 1]!]);
      }
    });
  });

  describe("dismissSuggestion", () => {
    it("removes suggestion from the queue", () => {
      radio.startWatching(tempDir);
      const path = writeFile("log.ts", "console.log('test');");
      radio.processChange(path, "modify");

      const before = radio.getSuggestions();
      expect(before.length).toBeGreaterThan(0);

      radio.dismissSuggestion(before[0]!.id);
      const after = radio.getSuggestions();
      expect(after.length).toBeLessThan(before.length);
    });
  });

  describe("applySuggestion", () => {
    it("applies a suggestion with a fix", () => {
      radio.startWatching(tempDir);
      const path = writeFile("log.ts", "console.log('debug');");
      radio.processChange(path, "modify");

      const suggestions = radio.getSuggestions();
      const withFix = suggestions.find((s) => s.suggestedFix !== null);
      expect(withFix).toBeDefined();

      const result = radio.applySuggestion(withFix!.id);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Applied fix");
    });

    it("fails for unknown suggestion ID", () => {
      const result = radio.applySuggestion("nonexistent");
      expect(result.success).toBe(false);
    });
  });

  describe("clearSuggestions", () => {
    it("removes all suggestions", () => {
      radio.startWatching(tempDir);
      const path = writeFile("log.ts", "console.log('test');");
      radio.processChange(path, "modify");
      expect(radio.getSuggestions().length).toBeGreaterThan(0);

      radio.clearSuggestions();
      expect(radio.getSuggestions()).toHaveLength(0);
    });
  });
});
