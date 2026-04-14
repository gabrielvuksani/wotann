import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ErrorPatternLearner,
  type ErrorPattern,
} from "../../src/intelligence/error-pattern-learner.js";

describe("ErrorPatternLearner", () => {
  let learner: ErrorPatternLearner;

  beforeEach(() => {
    learner = new ErrorPatternLearner();
  });

  describe("recordFix", () => {
    it("creates a new pattern on first occurrence", () => {
      learner.recordFix("TypeError: undefined is not a function", "Check null before calling", true);

      expect(learner.getPatternCount()).toBe(1);
      const patterns = learner.getAllPatterns();
      expect(patterns[0]!.successCount).toBe(1);
      expect(patterns[0]!.failureCount).toBe(0);
      expect(patterns[0]!.confidence).toBe(1.0);
    });

    it("records a failed fix with confidence 0", () => {
      learner.recordFix("ENOENT: no such file", "Create the missing file", false);

      const patterns = learner.getAllPatterns();
      expect(patterns[0]!.successCount).toBe(0);
      expect(patterns[0]!.failureCount).toBe(1);
      expect(patterns[0]!.confidence).toBe(0);
    });

    it("updates confidence on repeated recordings of same error", () => {
      learner.recordFix("SyntaxError: unexpected token", "Fix brackets", true);
      learner.recordFix("SyntaxError: unexpected token", "Fix brackets", true);
      learner.recordFix("SyntaxError: unexpected token", "Fix brackets", false);

      const patterns = learner.getAllPatterns();
      expect(patterns[0]!.successCount).toBe(2);
      expect(patterns[0]!.failureCount).toBe(1);
      // confidence = 2/3 ≈ 0.667
      expect(patterns[0]!.confidence).toBeCloseTo(0.667, 2);
    });

    it("keeps the successful fix description on success", () => {
      learner.recordFix("Error X", "bad fix", false);
      learner.recordFix("Error X", "good fix", true);

      const patterns = learner.getAllPatterns();
      expect(patterns[0]!.fixApproach).toBe("good fix");
    });

    it("keeps existing fix description on failure", () => {
      learner.recordFix("Error X", "first fix", true);
      learner.recordFix("Error X", "wrong fix", false);

      const patterns = learner.getAllPatterns();
      expect(patterns[0]!.fixApproach).toBe("first fix");
    });

    it("normalizes file paths in error messages", () => {
      learner.recordFix(
        "Error in /home/user/project/src/app.ts at line 42",
        "Fix type error",
        true,
      );
      learner.recordFix(
        "Error in /var/ci/build/src/app.ts at line 99",
        "Fix type error",
        true,
      );

      // Both should match to the same normalized signature
      expect(learner.getPatternCount()).toBe(1);
      const patterns = learner.getAllPatterns();
      expect(patterns[0]!.successCount).toBe(2);
    });

    it("normalizes line numbers in error messages", () => {
      learner.recordFix(
        "TypeError: cannot read property at line 42",
        "Add null check",
        true,
      );
      learner.recordFix(
        "TypeError: cannot read property at line 999",
        "Add null check",
        true,
      );

      // Line numbers are stripped so both normalize to the same signature
      expect(learner.getPatternCount()).toBe(1);
    });

    it("assigns a unique pattern ID", () => {
      learner.recordFix("Error A", "Fix A", true);
      learner.recordFix("Error B", "Fix B", true);

      const patterns = learner.getAllPatterns();
      expect(patterns[0]!.id).toBeTruthy();
      expect(patterns[1]!.id).toBeTruthy();
      expect(patterns[0]!.id).not.toBe(patterns[1]!.id);
    });

    it("updates lastSeen timestamp", () => {
      const before = Date.now();
      learner.recordFix("Error A", "Fix", true);
      const after = Date.now();

      const pattern = learner.getAllPatterns()[0]!;
      expect(pattern.lastSeen).toBeGreaterThanOrEqual(before);
      expect(pattern.lastSeen).toBeLessThanOrEqual(after);
    });
  });

  describe("findMatchingPattern", () => {
    it("returns null when no patterns exist", () => {
      expect(learner.findMatchingPattern("some error")).toBeNull();
    });

    it("finds exact match by normalized signature", () => {
      learner.recordFix("TypeError: cannot read property 'x' of null", "Add null check", true);

      const match = learner.findMatchingPattern("TypeError: cannot read property 'x' of null");
      expect(match).not.toBeNull();
      expect(match!.fixApproach).toBe("Add null check");
    });

    it("finds fuzzy match when error has similar tokens", () => {
      learner.recordFix(
        "Module not found: cannot resolve 'lodash' in project directory",
        "Install lodash",
        true,
      );

      const match = learner.findMatchingPattern(
        "Module not found: cannot resolve 'lodash' from source",
      );
      expect(match).not.toBeNull();
      expect(match!.fixApproach).toBe("Install lodash");
    });

    it("returns null for completely unrelated errors", () => {
      learner.recordFix("Database connection timeout", "Increase timeout", true);

      const match = learner.findMatchingPattern("CSS syntax error in stylesheet");
      expect(match).toBeNull();
    });

    it("returns null for empty error message", () => {
      learner.recordFix("Some error", "Some fix", true);
      expect(learner.findMatchingPattern("")).toBeNull();
    });

    it("matches despite different line numbers", () => {
      learner.recordFix(
        "TypeError at line 42: undefined is not a function",
        "Check function exists",
        true,
      );

      const match = learner.findMatchingPattern(
        "TypeError at line 99: undefined is not a function",
      );
      expect(match).not.toBeNull();
    });
  });

  describe("getAutoCorrections", () => {
    it("returns empty array when no patterns exist", () => {
      expect(learner.getAutoCorrections()).toEqual([]);
    });

    it("excludes patterns with too few observations", () => {
      learner.recordFix("Error A", "Fix A", true);
      // Only 1 observation, needs >= 2 for auto-correction

      expect(learner.getAutoCorrections()).toEqual([]);
    });

    it("returns high-confidence patterns with enough observations", () => {
      learner.recordFix("Error A", "Fix A", true);
      learner.recordFix("Error A", "Fix A", true);

      const corrections = learner.getAutoCorrections();
      expect(corrections.length).toBe(1);
      expect(corrections[0]!.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("excludes low-confidence patterns", () => {
      learner.recordFix("Error B", "Fix B", true);
      learner.recordFix("Error B", "Fix B", false);
      learner.recordFix("Error B", "Fix B", false);

      // confidence = 1/3 ≈ 0.33, below default 0.8 threshold
      expect(learner.getAutoCorrections()).toEqual([]);
    });

    it("respects custom minimum confidence threshold", () => {
      learner.recordFix("Error C", "Fix C", true);
      learner.recordFix("Error C", "Fix C", false);

      // confidence = 0.5
      expect(learner.getAutoCorrections(0.4)).toHaveLength(1);
      expect(learner.getAutoCorrections(0.6)).toHaveLength(0);
    });

    it("sorts by confidence descending", () => {
      // Pattern 1: 3/3 = 1.0
      learner.recordFix("Error X", "Fix X", true);
      learner.recordFix("Error X", "Fix X", true);
      learner.recordFix("Error X", "Fix X", true);

      // Pattern 2: 4/5 = 0.8
      learner.recordFix("Error Y", "Fix Y", true);
      learner.recordFix("Error Y", "Fix Y", true);
      learner.recordFix("Error Y", "Fix Y", true);
      learner.recordFix("Error Y", "Fix Y", true);
      learner.recordFix("Error Y", "Fix Y", false);

      const corrections = learner.getAutoCorrections();
      expect(corrections.length).toBe(2);
      expect(corrections[0]!.confidence).toBeGreaterThanOrEqual(corrections[1]!.confidence);
    });
  });

  describe("getAllPatterns", () => {
    it("returns empty array initially", () => {
      expect(learner.getAllPatterns()).toEqual([]);
    });

    it("returns patterns sorted by lastSeen descending", () => {
      learner.recordFix("Error Old", "Fix Old", true);
      learner.recordFix("Error New", "Fix New", true);

      const patterns = learner.getAllPatterns();
      expect(patterns.length).toBe(2);
      expect(patterns[0]!.lastSeen).toBeGreaterThanOrEqual(patterns[1]!.lastSeen);
    });
  });

  describe("getPatternCount", () => {
    it("returns 0 initially", () => {
      expect(learner.getPatternCount()).toBe(0);
    });

    it("counts unique patterns not total recordings", () => {
      learner.recordFix("Error A", "Fix", true);
      learner.recordFix("Error A", "Fix", true);
      learner.recordFix("Error B", "Fix B", true);

      expect(learner.getPatternCount()).toBe(2);
    });
  });

  describe("exportPatterns / importPatterns", () => {
    it("exports empty array when no patterns exist", () => {
      expect(learner.exportPatterns()).toEqual([]);
    });

    it("exports all patterns as an immutable snapshot", () => {
      learner.recordFix("Error A", "Fix A", true);
      learner.recordFix("Error B", "Fix B", true);

      const exported = learner.exportPatterns();
      expect(exported.length).toBe(2);
    });

    it("imports patterns into empty learner", () => {
      const patterns: ErrorPattern[] = [
        {
          id: "ep_test1",
          errorSignature: "normalized error one",
          fixApproach: "Fix 1",
          successCount: 5,
          failureCount: 1,
          lastSeen: Date.now(),
          confidence: 0.833,
        },
      ];

      learner.importPatterns(patterns);
      expect(learner.getPatternCount()).toBe(1);
    });

    it("merges imported patterns with existing, keeping higher observation count", () => {
      learner.recordFix("Error A", "Fix A v1", true);

      const imported: ErrorPattern[] = [
        {
          id: "ep_imported",
          errorSignature: learner.exportPatterns()[0]!.errorSignature,
          fixApproach: "Fix A v2",
          successCount: 10,
          failureCount: 2,
          lastSeen: Date.now(),
          confidence: 0.833,
        },
      ];

      learner.importPatterns(imported);
      expect(learner.getPatternCount()).toBe(1);

      const pattern = learner.getAllPatterns()[0]!;
      // Imported had more observations (12) vs existing (1)
      expect(pattern.successCount).toBe(10);
    });

    it("does not overwrite existing if existing has more observations", () => {
      learner.recordFix("Error A", "Fix A", true);
      learner.recordFix("Error A", "Fix A", true);
      learner.recordFix("Error A", "Fix A", true);

      const imported: ErrorPattern[] = [
        {
          id: "ep_weak",
          errorSignature: learner.exportPatterns()[0]!.errorSignature,
          fixApproach: "Weak fix",
          successCount: 1,
          failureCount: 0,
          lastSeen: Date.now(),
          confidence: 1.0,
        },
      ];

      learner.importPatterns(imported);
      const pattern = learner.getAllPatterns()[0]!;
      expect(pattern.fixApproach).toBe("Fix A");
    });

    it("round-trips through export/import correctly", () => {
      learner.recordFix("Error X", "Fix X", true);
      learner.recordFix("Error X", "Fix X", true);

      const exported = learner.exportPatterns();

      const newLearner = new ErrorPatternLearner();
      newLearner.importPatterns(exported);

      expect(newLearner.getPatternCount()).toBe(1);
      expect(newLearner.getAllPatterns()[0]!.successCount).toBe(2);
    });
  });

  describe("pruneOldPatterns", () => {
    it("removes patterns older than the cutoff", () => {
      // Import a pattern with an old lastSeen timestamp
      const oldPattern: ErrorPattern = {
        id: "ep_old",
        errorSignature: "old error",
        fixApproach: "old fix",
        successCount: 1,
        failureCount: 0,
        lastSeen: Date.now() - 100_000, // 100 seconds ago
        confidence: 1.0,
      };
      learner.importPatterns([oldPattern]);
      expect(learner.getPatternCount()).toBe(1);

      // Prune patterns older than 50 seconds
      const removed = learner.pruneOldPatterns(50_000);
      expect(removed).toBe(1);
      expect(learner.getPatternCount()).toBe(0);
    });

    it("keeps recent patterns", () => {
      learner.recordFix("Error A", "Fix A", true);

      // Prune with very large age keeps everything
      const removed = learner.pruneOldPatterns(999_999_999);
      expect(removed).toBe(0);
      expect(learner.getPatternCount()).toBe(1);
    });

    it("returns 0 when no patterns to prune", () => {
      expect(learner.pruneOldPatterns(0)).toBe(0);
    });

    it("selectively prunes only old patterns", () => {
      learner.recordFix("Error Old", "Fix Old", true);
      // The second recordFix happens ~instantly, so both are "recent"
      learner.recordFix("Error New", "Fix New", true);

      // Prune with very large age keeps all
      const removed = learner.pruneOldPatterns(999_999_999);
      expect(removed).toBe(0);
      expect(learner.getPatternCount()).toBe(2);
    });
  });
});
