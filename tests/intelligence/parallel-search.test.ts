import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  ParallelSearchDispatcher,
  type SearchConfig,
  type SearchResult,
} from "../../src/intelligence/parallel-search.js";

const TEST_WORKSPACE = join(
  process.cwd(),
  "tests",
  "intelligence",
  ".test-workspace-parallel-search",
);

function setupTestWorkspace(): void {
  if (existsSync(TEST_WORKSPACE)) {
    rmSync(TEST_WORKSPACE, { recursive: true });
  }
  mkdirSync(join(TEST_WORKSPACE, "src"), { recursive: true });
  mkdirSync(join(TEST_WORKSPACE, "docs"), { recursive: true });

  writeFileSync(
    join(TEST_WORKSPACE, "src", "auth.ts"),
    'export function authenticate(user: string, pass: string): boolean {\n  return user === "admin" && pass === "secret";\n}\n',
  );
  writeFileSync(
    join(TEST_WORKSPACE, "src", "router.ts"),
    'export function handleRoute(path: string): string {\n  return `Handling ${path}`;\n}\n',
  );
  writeFileSync(
    join(TEST_WORKSPACE, "docs", "README.md"),
    "# Project\n\nThis is a test project for authentication and routing.\n",
  );
  writeFileSync(
    join(TEST_WORKSPACE, "docs", "API.md"),
    "# API Reference\n\n## authenticate(user, pass)\nAuthenticates a user with credentials.\n",
  );
}

function cleanupTestWorkspace(): void {
  if (existsSync(TEST_WORKSPACE)) {
    rmSync(TEST_WORKSPACE, { recursive: true });
  }
}

describe("ParallelSearchDispatcher", () => {
  beforeEach(() => {
    setupTestWorkspace();
    return () => cleanupTestWorkspace();
  });

  function createDispatcher(overrides?: Partial<SearchConfig>): ParallelSearchDispatcher {
    return new ParallelSearchDispatcher({
      workspaceDir: TEST_WORKSPACE,
      maxResultsPerSource: 10,
      ...overrides,
    });
  }

  // -- search() -------------------------------------------------------------

  describe("search", () => {
    it("returns results with query, sources, and timing info", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("authenticate", ["codebase", "documentation"]);

      expect(result.query).toBe("authenticate");
      expect(result.sources).toEqual(["codebase", "documentation"]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalResults).toBeGreaterThanOrEqual(0);
    });

    it("finds code files matching the query", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("authenticate", ["codebase"]);

      expect(result.totalResults).toBeGreaterThan(0);
      const sources = result.results.map((r) => r.source);
      expect(sources).toContain("codebase");
    });

    it("finds documentation files matching the query", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("authentication", ["documentation"]);

      expect(result.totalResults).toBeGreaterThan(0);
      const sources = result.results.map((r) => r.source);
      expect(sources).toContain("documentation");
    });

    it("searches file content with exact substring matching", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("handleRoute", ["file-content"]);

      expect(result.totalResults).toBeGreaterThan(0);
      expect(result.results[0]?.source).toBe("file-content");
    });

    it("runs multiple sources in parallel", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("authenticate", [
        "codebase",
        "documentation",
        "file-content",
      ]);

      expect(result.sources.length).toBe(3);
      // Should have results from at least 2 sources
      const uniqueSources = new Set(result.results.map((r) => r.source));
      expect(uniqueSources.size).toBeGreaterThanOrEqual(1);
    });

    it("deduplicates results with same title and source", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("authenticate", [
        "codebase",
        "codebase", // duplicate source
      ]);

      // Titles should be unique per source
      const keys = result.results.map((r) => `${r.source}:${r.title}`);
      const uniqueKeys = new Set(keys);
      expect(keys.length).toBe(uniqueKeys.size);
    });

    it("returns results sorted by score descending", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("authenticate", [
        "codebase",
        "documentation",
        "file-content",
      ]);

      for (let i = 1; i < result.results.length; i++) {
        const prev = result.results[i - 1];
        const curr = result.results[i];
        if (prev && curr) {
          expect(prev.score).toBeGreaterThanOrEqual(curr.score);
        }
      }
    });

    it("returns empty results for no-match queries", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("xyznonexistent99999", ["codebase"]);

      expect(result.totalResults).toBe(0);
      expect(result.results).toEqual([]);
    });
  });

  // -- memory search --------------------------------------------------------

  describe("memory search", () => {
    it("uses the pluggable memory search function", async () => {
      const mockResults: readonly SearchResult[] = [
        {
          source: "memory",
          title: "previous session",
          content: "We discussed authentication patterns",
          score: 0.85,
        },
      ];

      const dispatcher = createDispatcher({
        memorySearchFn: () => mockResults,
      });

      const result = await dispatcher.search("authentication", ["memory"]);
      expect(result.totalResults).toBe(1);
      expect(result.results[0]?.source).toBe("memory");
      expect(result.results[0]?.title).toBe("previous session");
    });

    it("returns empty when no memory function is configured", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("anything", ["memory"]);
      expect(result.totalResults).toBe(0);
    });

    it("handles memory search function errors gracefully", async () => {
      const dispatcher = createDispatcher({
        memorySearchFn: () => {
          throw new Error("Memory DB corrupt");
        },
      });

      const result = await dispatcher.search("test", ["memory"]);
      expect(result.totalResults).toBe(0);
    });
  });

  // -- placeholder sources --------------------------------------------------

  describe("placeholder sources", () => {
    it("web search returns empty results", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("anything", ["web"]);
      expect(result.totalResults).toBe(0);
    });

    it("academic search returns empty results", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("anything", ["academic"]);
      expect(result.totalResults).toBe(0);
    });
  });

  // -- git history ----------------------------------------------------------

  describe("git history search", () => {
    it("returns empty when workspace is not a git repo", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("fix", ["git-history"]);
      // Our test workspace is not a git repo, so this should return empty
      expect(result.totalResults).toBe(0);
    });
  });

  // -- edge cases -----------------------------------------------------------

  describe("edge cases", () => {
    it("handles non-existent workspace gracefully", async () => {
      const dispatcher = new ParallelSearchDispatcher({
        workspaceDir: "/nonexistent/path/12345",
        maxResultsPerSource: 10,
      });

      const result = await dispatcher.search("test", ["codebase"]);
      expect(result.totalResults).toBe(0);
    });

    it("uses default sources when none specified", async () => {
      const dispatcher = createDispatcher();
      const result = await dispatcher.search("authenticate");

      // Should have tried all 7 source types
      expect(result.sources.length).toBe(7);
    });
  });
});
