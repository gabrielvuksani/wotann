import { describe, it, expect, beforeEach } from "vitest";
import {
  NightlyConsolidator,
  type ConsolidationInput,
  type ConsolidationOutput,
} from "../../src/learning/nightly-consolidator.js";

describe("NightlyConsolidator", () => {
  let consolidator: NightlyConsolidator;

  beforeEach(() => {
    consolidator = new NightlyConsolidator();
  });

  // -- extractErrorRules -----------------------------------------------------

  describe("extractErrorRules", () => {
    it("generates rules for patterns seen 3+ times", () => {
      const patterns = [
        { pattern: "ECONNREFUSED on port 5432", count: 5 },
        { pattern: "timeout after 30s", count: 3 },
      ];

      const rules = consolidator.extractErrorRules(patterns);

      expect(rules).toHaveLength(2);
      expect(rules[0]!.rule).toContain("ECONNREFUSED");
      expect(rules[0]!.rule).toContain("5 times");
      expect(rules[1]!.rule).toContain("timeout");
    });

    it("ignores patterns below the 3-occurrence threshold", () => {
      const patterns = [
        { pattern: "rare flaky error", count: 1 },
        { pattern: "occasional glitch", count: 2 },
      ];

      const rules = consolidator.extractErrorRules(patterns);

      expect(rules).toHaveLength(0);
    });

    it("assigns higher confidence for more frequent patterns", () => {
      const patterns = [
        { pattern: "error-a", count: 3 },
        { pattern: "error-b", count: 10 },
      ];

      const rules = consolidator.extractErrorRules(patterns);

      expect(rules[1]!.confidence).toBeGreaterThan(rules[0]!.confidence);
    });

    it("caps confidence below 1.0", () => {
      const patterns = [{ pattern: "very-frequent", count: 1000 }];

      const rules = consolidator.extractErrorRules(patterns);

      expect(rules[0]!.confidence).toBeLessThanOrEqual(1.0);
    });

    it("returns empty array for empty input", () => {
      expect(consolidator.extractErrorRules([])).toHaveLength(0);
    });

    it("includes source field in each rule", () => {
      const patterns = [{ pattern: "db-timeout", count: 5 }];
      const rules = consolidator.extractErrorRules(patterns);

      expect(rules[0]!.source).toBe("error-pattern");
    });
  });

  // -- crystallizeStrategies -------------------------------------------------

  describe("crystallizeStrategies", () => {
    it("promotes strategies with >80% success rate", () => {
      const strategies = [
        { strategy: "decompose-task for large files", successRate: 0.92 },
        { strategy: "add-context for API calls", successRate: 0.85 },
      ];

      const rules = consolidator.crystallizeStrategies(strategies);

      expect(rules).toHaveLength(2);
      expect(rules[0]!.rule).toContain("decompose-task");
      expect(rules[0]!.rule).toContain("92%");
    });

    it("filters out strategies at or below 80% success rate", () => {
      const strategies = [
        { strategy: "good-strategy", successRate: 0.85 },
        { strategy: "mediocre-strategy", successRate: 0.80 },
        { strategy: "bad-strategy", successRate: 0.50 },
      ];

      const rules = consolidator.crystallizeStrategies(strategies);

      expect(rules).toHaveLength(1);
      expect(rules[0]!.rule).toContain("good-strategy");
    });

    it("uses success rate as confidence", () => {
      const strategies = [
        { strategy: "excellent", successRate: 0.95 },
      ];

      const rules = consolidator.crystallizeStrategies(strategies);

      expect(rules[0]!.confidence).toBe(0.95);
    });

    it("returns empty for empty input", () => {
      expect(consolidator.crystallizeStrategies([])).toHaveLength(0);
    });

    it("includes source field", () => {
      const strategies = [{ strategy: "test", successRate: 0.90 }];
      const rules = consolidator.crystallizeStrategies(strategies);

      expect(rules[0]!.source).toBe("strategy-crystallization");
    });
  });

  // -- generateSkillCandidates -----------------------------------------------

  describe("generateSkillCandidates", () => {
    it("generates a skill candidate for each correction", () => {
      const corrections = [
        {
          original: "Use var for variables",
          corrected: "Use const for variables",
          reason: "prefer-const",
        },
        {
          original: "console.log for debugging",
          corrected: "Use proper logger",
          reason: "use-logger",
        },
      ];

      const candidates = consolidator.generateSkillCandidates(corrections);

      expect(candidates).toHaveLength(2);
      expect(candidates[0]!.name).toContain("prefer-const");
      expect(candidates[0]!.description).toContain("correction");
      expect(candidates[0]!.trigger).toContain("var");
    });

    it("generates valid skill body with correction details", () => {
      const corrections = [
        {
          original: "Mutate the array in place",
          corrected: "Return a new array",
          reason: "immutability-rule",
        },
      ];

      const candidates = consolidator.generateSkillCandidates(corrections);

      expect(candidates[0]!.body).toContain("immutability-rule");
      expect(candidates[0]!.body).toContain("Mutate the array");
      expect(candidates[0]!.body).toContain("Return a new array");
    });

    it("truncates long original/corrected text in triggers", () => {
      const corrections = [
        {
          original: "x".repeat(200),
          corrected: "y".repeat(200),
          reason: "long-text-correction",
        },
      ];

      const candidates = consolidator.generateSkillCandidates(corrections);

      expect(candidates[0]!.trigger.length).toBeLessThan(200);
    });

    it("generates slugified skill names", () => {
      const corrections = [
        {
          original: "old",
          corrected: "new",
          reason: "Use TypeScript Strict Mode Always",
        },
      ];

      const candidates = consolidator.generateSkillCandidates(corrections);

      expect(candidates[0]!.name).toMatch(/^auto-correct-[a-z0-9-]+$/);
      expect(candidates[0]!.name).not.toContain(" ");
    });

    it("returns empty for empty input", () => {
      expect(consolidator.generateSkillCandidates([])).toHaveLength(0);
    });
  });

  // -- identifyArchivable ----------------------------------------------------

  describe("identifyArchivable", () => {
    it("archives observations older than 7 days with 0 accesses", () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const observations = [
        { key: "stale-obs", createdAt: eightDaysAgo, accessCount: 0 },
      ];

      const archived = consolidator.identifyArchivable(observations);

      expect(archived).toContain("stale-obs");
    });

    it("keeps observations newer than 7 days", () => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const observations = [
        { key: "fresh-obs", createdAt: twoDaysAgo, accessCount: 0 },
      ];

      const archived = consolidator.identifyArchivable(observations);

      expect(archived).not.toContain("fresh-obs");
    });

    it("keeps old observations that have been accessed", () => {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const observations = [
        { key: "old-but-used", createdAt: thirtyDaysAgo, accessCount: 5 },
      ];

      const archived = consolidator.identifyArchivable(observations);

      expect(archived).not.toContain("old-but-used");
    });

    it("handles mixed observations correctly", () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000;

      const observations = [
        { key: "archive-me", createdAt: eightDaysAgo, accessCount: 0 },
        { key: "keep-me-fresh", createdAt: oneDayAgo, accessCount: 0 },
        { key: "keep-me-used", createdAt: eightDaysAgo, accessCount: 3 },
      ];

      const archived = consolidator.identifyArchivable(observations);

      expect(archived).toEqual(["archive-me"]);
    });

    it("returns empty when all observations are fresh", () => {
      const now = Date.now();
      const observations = [
        { key: "a", createdAt: now, accessCount: 0 },
        { key: "b", createdAt: now - 1000, accessCount: 0 },
      ];

      expect(consolidator.identifyArchivable(observations)).toHaveLength(0);
    });

    it("returns empty for empty input", () => {
      expect(consolidator.identifyArchivable([])).toHaveLength(0);
    });
  });

  // -- consolidate (full pipeline) -------------------------------------------

  describe("consolidate", () => {
    it("runs the full pipeline and returns all artifacts", () => {
      const input: ConsolidationInput = {
        sessionObservations: [
          { key: "obs-1", value: "some value", type: "project" },
        ],
        errorPatterns: [
          { pattern: "ECONNREFUSED", count: 5, lastSeen: Date.now() },
        ],
        successfulStrategies: [
          { strategy: "decompose-task", taskType: "refactoring", successRate: 0.90 },
        ],
        userCorrections: [
          { original: "Use any", corrected: "Use unknown", reason: "no-any-type" },
        ],
      };

      const output = consolidator.consolidate(input);

      expect(output.newRules.length).toBeGreaterThan(0);
      expect(output.updatedPreferences).toHaveLength(1);
      expect(output.skillCandidates).toHaveLength(1);
      expect(output.consolidatedAt).toBeGreaterThan(0);
    });

    it("combines error rules and strategy rules in newRules", () => {
      const input: ConsolidationInput = {
        sessionObservations: [],
        errorPatterns: [
          { pattern: "timeout", count: 4, lastSeen: Date.now() },
        ],
        successfulStrategies: [
          { strategy: "retry-with-backoff", taskType: "api", successRate: 0.88 },
        ],
        userCorrections: [],
      };

      const output = consolidator.consolidate(input);

      // One from error patterns + one from strategies
      expect(output.newRules).toHaveLength(2);
      const sources = output.newRules.map((r) => r.source);
      expect(sources).toContain("error-pattern");
      expect(sources).toContain("strategy-crystallization");
    });

    it("handles empty input gracefully", () => {
      const input: ConsolidationInput = {
        sessionObservations: [],
        errorPatterns: [],
        successfulStrategies: [],
        userCorrections: [],
      };

      const output = consolidator.consolidate(input);

      expect(output.newRules).toHaveLength(0);
      expect(output.updatedPreferences).toHaveLength(0);
      expect(output.skillCandidates).toHaveLength(0);
      expect(output.archivedObservations).toHaveLength(0);
      expect(output.consolidatedAt).toBeGreaterThan(0);
    });

    it("returns immutable output (readonly arrays)", () => {
      const input: ConsolidationInput = {
        sessionObservations: [],
        errorPatterns: [{ pattern: "err", count: 5, lastSeen: Date.now() }],
        successfulStrategies: [],
        userCorrections: [],
      };

      const output: ConsolidationOutput = consolidator.consolidate(input);

      // TypeScript readonly enforcement — at runtime these are regular arrays,
      // but the type system prevents mutation.
      expect(Array.isArray(output.newRules)).toBe(true);
      expect(Array.isArray(output.skillCandidates)).toBe(true);
    });

    it("generates preferences from corrections", () => {
      const input: ConsolidationInput = {
        sessionObservations: [],
        errorPatterns: [],
        successfulStrategies: [],
        userCorrections: [
          { original: "tabs", corrected: "spaces", reason: "use spaces not tabs" },
        ],
      };

      const output = consolidator.consolidate(input);

      expect(output.updatedPreferences).toHaveLength(1);
      expect(output.updatedPreferences[0]!.key).toContain("pref-");
      expect(output.updatedPreferences[0]!.value).toBe("spaces");
      expect(output.updatedPreferences[0]!.reason).toBe("use spaces not tabs");
    });
  });
});
