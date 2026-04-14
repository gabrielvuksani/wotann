import { describe, it, expect } from "vitest";
import {
  shouldRunStep0,
  shouldSwarm,
  shouldChunkFile,
  getChunkRange,
  detectTruncation,
  generateRenameSearchPatterns,
  SENIOR_DEV_PROMPT,
} from "../../src/intelligence/overrides.js";

describe("Harness Intelligence Overrides", () => {
  describe("Override 2: Step 0 Deletion", () => {
    it("skips for small files", () => {
      const result = shouldRunStep0(200, true);
      expect(result.shouldClean).toBe(false);
    });

    it("skips for non-refactors", () => {
      const result = shouldRunStep0(500, false);
      expect(result.shouldClean).toBe(false);
    });

    it("triggers for large file refactors", () => {
      const result = shouldRunStep0(500, true);
      expect(result.shouldClean).toBe(true);
      expect(result.suggestion).toContain("500 lines");
    });
  });

  describe("Override 3: Senior Dev Quality Bar", () => {
    it("has quality prompt", () => {
      expect(SENIOR_DEV_PROMPT).toContain("senior developer");
      expect(SENIOR_DEV_PROMPT).toContain("code review");
    });
  });

  describe("Override 4: Mandatory Sub-Agent Swarming", () => {
    it("does not swarm for 5 or fewer files", () => {
      expect(shouldSwarm(3).shouldSwarm).toBe(false);
      expect(shouldSwarm(5).shouldSwarm).toBe(false);
    });

    it("swarms for more than 5 files", () => {
      const result = shouldSwarm(12);
      expect(result.shouldSwarm).toBe(true);
      expect(result.batchCount).toBeGreaterThan(1);
      expect(result.batchSize).toBeGreaterThanOrEqual(5);
      expect(result.batchSize).toBeLessThanOrEqual(8);
    });

    it("limits batch size to 8", () => {
      const result = shouldSwarm(50);
      expect(result.batchSize).toBeLessThanOrEqual(8);
    });
  });

  describe("Override 5: File Read Chunking", () => {
    it("does not chunk small files", () => {
      const result = shouldChunkFile(100);
      expect(result.shouldChunk).toBe(false);
    });

    it("chunks large files into 500-line segments", () => {
      const result = shouldChunkFile(2400);
      expect(result.shouldChunk).toBe(true);
      expect(result.chunkCount).toBe(5);
      expect(result.chunkSize).toBe(500);
    });

    it("calculates correct chunk ranges", () => {
      const range = getChunkRange(0, 500, 2400);
      expect(range.start).toBe(0);
      expect(range.end).toBe(500);

      const lastRange = getChunkRange(4, 500, 2400);
      expect(lastRange.start).toBe(2000);
      expect(lastRange.end).toBe(2400);
    });
  });

  describe("Override 6: Truncation Detection", () => {
    it("detects suspiciously small file results", () => {
      const result = detectTruncation("Read", "short", "file");
      expect(result.isTruncated).toBe(true);
    });

    it("does not flag normal results", () => {
      const result = detectTruncation("Read", "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11", "file");
      expect(result.isTruncated).toBe(false);
    });
  });

  describe("Override 7: AST-Level Search Patterns", () => {
    it("generates 6 search patterns for a symbol", () => {
      const patterns = generateRenameSearchPatterns("authenticate");
      expect(patterns).toHaveLength(6);
    });

    it("matches direct calls", () => {
      const patterns = generateRenameSearchPatterns("foo");
      const directCall = patterns.find((p) => p.name === "direct_calls");
      expect(directCall?.pattern.test("foo(")).toBe(true);
    });

    it("matches type references", () => {
      const patterns = generateRenameSearchPatterns("UserType");
      const typeRef = patterns.find((p) => p.name === "type_references");
      expect(typeRef?.pattern.test(": UserType")).toBe(true);
    });

    it("matches test references", () => {
      const patterns = generateRenameSearchPatterns("auth");
      const testRef = patterns.find((p) => p.name === "test_references");
      expect(testRef?.pattern.test('describe("auth')).toBe(true);
    });
  });
});
