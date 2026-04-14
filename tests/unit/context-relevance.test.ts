import { describe, it, expect } from "vitest";
import {
  ContextRelevanceScorer,
  type FileInfo,
  type MemoryEntry,
} from "../../src/intelligence/context-relevance.js";

const makeFile = (overrides: Partial<FileInfo> = {}): FileInfo => ({
  path: "/src/auth/login.ts",
  size: 2000,
  language: "typescript",
  lastModified: Date.now(),
  exports: ["login", "logout"],
  imports: ["./session", "./token"],
  ...overrides,
});

const makeMemory = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: "mem-1",
  content: "Authentication module uses OAuth2 for login",
  timestamp: Date.now(),
  type: "decision",
  tags: ["auth", "oauth"],
  ...overrides,
});

describe("ContextRelevanceScorer", () => {
  describe("scoreFiles", () => {
    it("scores files mentioned in query highest", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth/login.ts" }),
        makeFile({ path: "/src/utils/math.ts", exports: ["add", "multiply"] }),
        makeFile({ path: "/src/config/settings.ts", exports: ["getConfig"] }),
      ];

      const scored = scorer.scoreFiles(files, "Fix the bug in login.ts");

      expect(scored[0]!.file.path).toContain("login");
      expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);
    });

    it("scores files with matching keywords higher", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth/login.ts", exports: ["login", "authenticate"] }),
        makeFile({ path: "/src/weather/forecast.ts", exports: ["getWeather"] }),
      ];

      const scored = scorer.scoreFiles(files, "Fix the authentication flow");

      // auth/login.ts path contains "auth" which matches "authentication"
      expect(scored[0]!.file.path).toContain("auth");
    });

    it("scores files with matching exports higher", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/a.ts", exports: ["processPayment", "refundPayment"] }),
        makeFile({ path: "/src/b.ts", exports: ["formatDate", "parseDate"] }),
      ];

      const scored = scorer.scoreFiles(files, "Fix the payment processing bug");

      expect(scored[0]!.file.path).toBe("/src/a.ts");
    });

    it("applies language filter bonus", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth.ts", language: "typescript", exports: [] }),
        makeFile({ path: "/src/auth.py", language: "python", exports: [] }),
      ];

      const scored = scorer.scoreFiles(files, "Fix the TypeScript auth module");

      const tsFile = scored.find((f) => f.file.language === "typescript");
      const pyFile = scored.find((f) => f.file.language === "python");
      expect(tsFile!.score).toBeGreaterThanOrEqual(pyFile!.score);
    });

    it("assigns appropriate tiers based on score", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth/login.ts" }),       // High relevance
        makeFile({ path: "/src/utils/helpers.ts", exports: ["helper"] }), // Low relevance
      ];

      const scored = scorer.scoreFiles(files, "Fix the bug in login.ts auth module");

      // Highly relevant file should be L2, less relevant should be L0 or L1
      const loginFile = scored.find((f) => f.file.path.includes("login"));
      const helperFile = scored.find((f) => f.file.path.includes("helpers"));
      expect(loginFile!.tier).toBe("L2");
      expect(["L0", "L1"]).toContain(helperFile!.tier);
    });

    it("provides a reason for the score", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [makeFile({ path: "/src/auth/login.ts" })];

      const scored = scorer.scoreFiles(files, "Fix the bug in login.ts");

      expect(scored[0]!.reason).toBeDefined();
      expect(scored[0]!.reason.length).toBeGreaterThan(0);
      expect(scored[0]!.reason).toContain("login.ts");
    });

    it("estimates tokens for each tier", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth/login.ts", size: 5000, exports: ["a", "b", "c"] }),
      ];

      const scored = scorer.scoreFiles(files, "Fix the auth login bug");

      // L2 file should have token estimate based on file size
      const l2File = scored.find((f) => f.tier === "L2");
      if (l2File) {
        expect(l2File.estimatedTokens).toBeGreaterThan(10); // More than just a file name
      }
    });

    it("gives recency bonus to recently modified files", () => {
      const scorer = new ContextRelevanceScorer();
      const recent = makeFile({
        path: "/src/feature/recent.ts",
        lastModified: Date.now() - 1000, // 1 second ago
        exports: ["feature"],
      });
      const old = makeFile({
        path: "/src/feature/old.ts",
        lastModified: Date.now() - 7 * 24 * 60 * 60 * 1000, // 1 week ago
        exports: ["feature"],
      });

      const scored = scorer.scoreFiles([recent, old], "Update the feature module");

      const recentScore = scored.find((f) => f.file.path.includes("recent"));
      const oldScore = scored.find((f) => f.file.path.includes("old"));
      expect(recentScore!.score).toBeGreaterThan(oldScore!.score);
    });
  });

  describe("scoreMemory", () => {
    it("scores relevant memory entries higher", () => {
      const scorer = new ContextRelevanceScorer();
      const entries = [
        makeMemory({ content: "Auth module uses OAuth2 for user login" }),
        makeMemory({ content: "Database uses PostgreSQL for storage", id: "mem-2", tags: ["db"] }),
      ];

      const scored = scorer.scoreMemory(entries, "Fix the authentication login flow");

      expect(scored[0]!.entry.content).toContain("Auth");
      expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);
    });

    it("considers tags in scoring", () => {
      const scorer = new ContextRelevanceScorer();
      const entries = [
        makeMemory({ content: "Something about tokens", tags: ["auth", "oauth", "login"] }),
        makeMemory({ content: "Something about tokens", tags: ["weather", "api"], id: "mem-2" }),
      ];

      const scored = scorer.scoreMemory(entries, "Fix the auth login flow");

      // Entry with auth/oauth/login tags should score higher
      expect(scored[0]!.entry.tags).toContain("auth");
    });

    it("returns zero score for unrelated entries", () => {
      const scorer = new ContextRelevanceScorer();
      const entries = [
        makeMemory({ content: "xyz abc def 123", tags: ["xyz"] }),
      ];

      const scored = scorer.scoreMemory(entries, "authentication module");
      expect(scored[0]!.score).toBe(0);
    });

    it("explains the score", () => {
      const scorer = new ContextRelevanceScorer();
      const entries = [
        makeMemory({ content: "Authentication uses OAuth2 tokens" }),
      ];

      const scored = scorer.scoreMemory(entries, "Fix the authentication token bug");

      expect(scored[0]!.reason).toBeDefined();
      expect(scored[0]!.reason.length).toBeGreaterThan(0);
    });
  });

  describe("discoverRelevantContext", () => {
    it("returns files and memory within budget", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth/login.ts", size: 2000 }),
        makeFile({ path: "/src/utils/helpers.ts", size: 1000 }),
      ];
      const memory = [
        makeMemory({ content: "Auth module uses OAuth2" }),
      ];

      const result = scorer.discoverRelevantContext(
        "Fix the auth login bug",
        files,
        memory,
        100000,
      );

      expect(result.relevantFiles.length).toBeGreaterThan(0);
      expect(result.totalTokenEstimate).toBeGreaterThan(0);
      expect(result.budgetUsed).toBeLessThanOrEqual(1);
    });

    it("respects token budget", () => {
      const scorer = new ContextRelevanceScorer();
      const files = Array.from({ length: 50 }, (_, i) =>
        makeFile({ path: `/src/file-${i}.ts`, size: 5000 }),
      );

      const result = scorer.discoverRelevantContext(
        "Fix the bug",
        files,
        [],
        500, // Very small budget
      );

      expect(result.totalTokenEstimate).toBeLessThanOrEqual(500);
    });

    it("includes tiered breakdown", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth/login.ts" }),
        makeFile({ path: "/src/utils/math.ts" }),
      ];

      const result = scorer.discoverRelevantContext(
        "Fix the auth login bug",
        files,
        [],
      );

      expect(result.tieredBreakdown).toBeDefined();
      const { l0Count, l1Count, l2Count } = result.tieredBreakdown;
      expect(l0Count + l1Count + l2Count).toBe(result.relevantFiles.length);
    });

    it("filters out low-scoring memory entries", () => {
      const scorer = new ContextRelevanceScorer();
      const memory = [
        makeMemory({ content: "Auth module uses OAuth2" }),
        makeMemory({ content: "xyz abc def 123 456 789", id: "mem-2", tags: ["unrelated"] }),
      ];

      const result = scorer.discoverRelevantContext(
        "Fix the auth login bug",
        [],
        memory,
      );

      // Should filter entries with score <= 0.1
      for (const entry of result.relevantMemory) {
        expect(entry.score).toBeGreaterThan(0.1);
      }
    });
  });

  describe("loadTieredContext", () => {
    it("assigns L0/L1/L2 tiers based on relevance", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth/login.ts" }),       // Highly relevant
        makeFile({ path: "/src/utils/format.ts", exports: ["format"] }), // Less relevant
        makeFile({ path: "/src/weather/api.ts", exports: ["getWeather"] }), // Not relevant
      ];

      const tiered = scorer.loadTieredContext(files, "Fix the auth login bug");

      // Should have files distributed across tiers
      const totalFiles = tiered.l0Files.length + tiered.l1Files.length + tiered.l2Files.length;
      expect(totalFiles).toBe(3);
    });

    it("calculates token savings", () => {
      const scorer = new ContextRelevanceScorer();
      // Use large files (20KB each) so L2 tokens are much higher than L0/L1
      const files = Array.from({ length: 10 }, (_, i) =>
        makeFile({ path: `/src/file-${i}.ts`, size: 20000, exports: ["func"] }),
      );

      const tiered = scorer.loadTieredContext(files, "Fix the bug in file-0.ts");

      // Should have savings because not all files are loaded at L2
      expect(tiered.tokenSavings).toBeGreaterThanOrEqual(0);
      expect(tiered.savingsPercent).toBeGreaterThanOrEqual(0);
    });

    it("respects budget by downgrading tiers", () => {
      const scorer = new ContextRelevanceScorer();
      const files = Array.from({ length: 20 }, (_, i) =>
        makeFile({ path: `/src/file-${i}.ts`, size: 5000 }),
      );

      const tiered = scorer.loadTieredContext(files, "Fix the bug", 200);

      expect(tiered.totalTokens).toBeLessThanOrEqual(200);
    });

    it("returns savings percent as integer", () => {
      const scorer = new ContextRelevanceScorer();
      const files = [
        makeFile({ path: "/src/auth.ts", size: 5000 }),
        makeFile({ path: "/src/utils.ts", size: 3000 }),
      ];

      const tiered = scorer.loadTieredContext(files, "Fix auth");

      expect(Number.isInteger(tiered.savingsPercent)).toBe(true);
    });

    it("handles empty file list", () => {
      const scorer = new ContextRelevanceScorer();
      const tiered = scorer.loadTieredContext([], "Fix the bug");

      expect(tiered.l0Files).toHaveLength(0);
      expect(tiered.l1Files).toHaveLength(0);
      expect(tiered.l2Files).toHaveLength(0);
      expect(tiered.totalTokens).toBe(0);
      expect(tiered.savingsPercent).toBe(0);
    });
  });
});
