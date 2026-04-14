import { describe, it, expect } from "vitest";
import {
  fileProximity,
  taskTrajectory,
  compileAmbientContext,
} from "../../src/intelligence/ambient-awareness.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("Ambient Awareness", () => {
  function createTestWorkspace(): string {
    const dir = join(tmpdir(), "wotann-test-ambient-" + randomUUID());
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "tests", "unit"), { recursive: true });
    writeFileSync(join(dir, "src", "auth.ts"), "export function login() {}");
    writeFileSync(join(dir, "src", "auth.test.ts"), "test('login')");
    writeFileSync(join(dir, "src", "auth.types.ts"), "export type User = {}");
    writeFileSync(join(dir, "tests", "unit", "auth.test.ts"), "test('unit')");
    return dir;
  }

  describe("fileProximity", () => {
    it("suggests test and type files for source file", () => {
      const dir = createTestWorkspace();
      const signal = fileProximity(join(dir, "src", "auth.ts"), dir);

      expect(signal.type).toBe("file-proximity");
      expect(signal.confidence).toBeGreaterThan(0);
      expect(signal.suggestedFiles.some((f) => f.includes("auth.test.ts"))).toBe(true);
      expect(signal.suggestedFiles.some((f) => f.includes("auth.types.ts"))).toBe(true);
    });

    it("handles non-existent files gracefully", () => {
      const signal = fileProximity("/nonexistent/path/foo.ts", "/nonexistent");
      expect(signal.type).toBe("file-proximity");
      expect(signal.suggestedFiles).toBeDefined();
    });
  });

  describe("taskTrajectory", () => {
    it("suggests registration context after login", () => {
      const signal = taskTrajectory("Implement user login");
      expect(signal.type).toBe("task-trajectory");
      expect(signal.suggestedFiles.some((f) => f.includes("registration"))).toBe(true);
    });

    it("suggests migration context after database-schema", () => {
      const signal = taskTrajectory("Create database-schema for users");
      expect(signal.suggestedFiles.some((f) => f.includes("migration"))).toBe(true);
    });

    it("returns low confidence for unknown tasks", () => {
      const signal = taskTrajectory("Something completely unrelated");
      expect(signal.confidence).toBeLessThan(0.5);
    });
  });

  describe("compileAmbientContext", () => {
    it("compiles multiple signals into ambient context", () => {
      const dir = createTestWorkspace();
      const ctx = compileAmbientContext(
        join(dir, "src", "auth.ts"),
        "Implement login",
        dir,
      );

      expect(ctx.signals.length).toBeGreaterThanOrEqual(2);
      expect(ctx.preloadedFiles.length).toBeGreaterThan(0);
      expect(ctx.generatedAt).toBeGreaterThan(0);
    });

    it("handles undefined inputs", () => {
      const ctx = compileAmbientContext(undefined, undefined, "/tmp");
      expect(ctx.signals).toHaveLength(0);
      expect(ctx.preloadedFiles).toHaveLength(0);
    });
  });
});
