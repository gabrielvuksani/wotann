/**
 * Tests for ParallelGrep + grep-subagent (Morph WarpGrep v2 port).
 *
 * Covers:
 *   - dispatch fans out N subagents across root paths
 *   - aggregator dedups + top-K limits output
 *   - LLM-filtered results respect relevance threshold
 *   - Node fallback works when rg execFile is forced to fail
 *   - concurrent dispatches don't cross-contaminate
 *   - empty query / empty roots -> explicit error
 *   - N=1 degenerate case works
 *   - include/exclude globs respected
 *   - honest snippet truncation (no 500-line snippets)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  ParallelGrep,
  runGrepSubagent,
  type CondensedResult,
  type LlmQuery,
} from "../../src/tools/parallel-grep.js";

// ── Fixtures ────────────────────────────────────────────

function mkScratch(): string {
  const dir = join(tmpdir(), `wotann-grep-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mkFile(root: string, relPath: string, content: string): string {
  const full = join(root, relPath);
  const parent = full.substring(0, full.lastIndexOf("/"));
  if (parent && parent !== root) mkdirSync(parent, { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

function mkSharedRootWithUser(root: string): void {
  mkFile(root, "src/auth/login.ts", [
    "export function login(user: string) {",
    "  return fetch('/api/login', { body: JSON.stringify({ user }) });",
    "}",
    "",
    "// TODO: support refresh tokens",
  ].join("\n"));
  mkFile(root, "src/auth/logout.ts", [
    "export function logout() {",
    "  // end user session",
    "  return fetch('/api/logout');",
    "}",
  ].join("\n"));
  mkFile(root, "src/utils/helpers.ts", [
    "export function noop() { /* no-op */ }",
  ].join("\n"));
}

// ── Guards ──────────────────────────────────────────────

describe("ParallelGrep — guards", () => {
  it("rejects empty query", async () => {
    const pg = new ParallelGrep();
    await expect(pg.dispatch("", ["/tmp"])).rejects.toThrow(/empty query/i);
  });

  it("rejects empty root list", async () => {
    const pg = new ParallelGrep();
    await expect(pg.dispatch("user", [])).rejects.toThrow(/no root paths/i);
  });

  it("rejects whitespace-only query", async () => {
    const pg = new ParallelGrep();
    await expect(pg.dispatch("   ", ["/tmp"])).rejects.toThrow(/empty query/i);
  });
});

// ── Single subagent basics ──────────────────────────────

describe("runGrepSubagent — single root", () => {
  let root: string;
  beforeEach(() => { root = mkScratch(); mkSharedRootWithUser(root); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("finds matches across the root", async () => {
    const report = await runGrepSubagent("user", root, { caseInsensitive: true });
    expect(report.root).toBe(root);
    expect(["ripgrep", "node-fallback"]).toContain(report.engine);
    expect(report.hits.length).toBeGreaterThan(0);
    expect(report.hits.some((h) => h.path.endsWith("login.ts"))).toBe(true);
  });

  it("rejects empty query on subagent too", async () => {
    await expect(runGrepSubagent("", root)).rejects.toThrow(/empty query/i);
  });

  it("rejects empty root on subagent too", async () => {
    await expect(runGrepSubagent("x", "")).rejects.toThrow(/empty root/i);
  });

  it("truncates snippets honestly (no 500-line blobs)", async () => {
    const bigRoot = mkScratch();
    try {
      // 10 KB one-line file — plenty of text to force truncation.
      const giantLine = "user=alpha " + "x".repeat(5000) + " user=omega";
      mkFile(bigRoot, "huge.ts", giantLine);
      const report = await runGrepSubagent("user", bigRoot, {
        maxSnippetLen: 120,
      });
      expect(report.hits.length).toBeGreaterThan(0);
      const [first] = report.hits;
      expect(first).toBeDefined();
      // 120 chars + truncation marker "…[truncated]" = 120 + 12 = 132
      expect(first!.snippet.length).toBeLessThanOrEqual(132);
      expect(first!.snippet).toContain("truncated");
    } finally {
      try { rmSync(bigRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("caps absolute snippet length at 500 chars regardless of request", async () => {
    const bigRoot = mkScratch();
    try {
      const giantLine = "foo " + "y".repeat(5000);
      mkFile(bigRoot, "a.ts", giantLine);
      const report = await runGrepSubagent("foo", bigRoot, {
        maxSnippetLen: 10_000, // much bigger than hard cap
      });
      const [first] = report.hits;
      expect(first).toBeDefined();
      // 500 hard cap + 12-char marker = 512 max
      expect(first!.snippet.length).toBeLessThanOrEqual(512);
    } finally {
      try { rmSync(bigRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

// ── Fan-out / aggregation ───────────────────────────────

describe("ParallelGrep.dispatch — fan-out", () => {
  let rootA: string;
  let rootB: string;
  let rootC: string;
  beforeEach(() => {
    rootA = mkScratch(); mkSharedRootWithUser(rootA);
    rootB = mkScratch();
    mkFile(rootB, "docs/users.md", "# Users\nAll users land here.\n");
    rootC = mkScratch();
    mkFile(rootC, "bar.ts", "const other = 1; // no match\n");
  });
  afterEach(() => {
    for (const r of [rootA, rootB, rootC]) {
      try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("fans out across multiple roots", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA, rootB, rootC], {
      concurrency: 3,
    });
    expect(report.roots).toHaveLength(3);
    expect(report.perRoot).toHaveLength(3);
    // Hits from rootA + rootB, none from rootC.
    expect(report.hits.some((h) => h.path.startsWith(rootA))).toBe(true);
    expect(report.hits.some((h) => h.path.startsWith(rootB))).toBe(true);
    expect(report.hits.some((h) => h.path.startsWith(rootC))).toBe(false);
  });

  it("N=1 degenerate case works", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA], { concurrency: 1 });
    expect(report.perRoot).toHaveLength(1);
    expect(report.hits.length).toBeGreaterThan(0);
  });

  it("top-K cap limits aggregate output", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA, rootB], { topK: 2 });
    expect(report.returnedHitCount).toBeLessThanOrEqual(2);
    expect(report.hits.length).toBeLessThanOrEqual(2);
  });

  it("deduplicates by path:line when dedupByPath=true", async () => {
    // Give two roots the SAME file content at same relative path. Each
    // subagent will find hits at same lines — but paths differ because
    // the root prefix differs, so dedup key is still unique. To truly
    // test dedup, repeat a root in the list.
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA, rootA], {
      dedupByPath: true,
    });
    // Without dedup, we'd have 2x. With dedup, one per distinct path:line.
    const firstRun = await new ParallelGrep().dispatch("user", [rootA]);
    expect(report.dedupedHitCount).toBe(firstRun.dedupedHitCount);
  });

  it("respects dedupByPath=false", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA, rootA], {
      dedupByPath: false,
    });
    // Should have 2x hits (not deduped). rawHitCount counts before dedup.
    const firstRun = await new ParallelGrep().dispatch("user", [rootA]);
    expect(report.rawHitCount).toBe(firstRun.rawHitCount * 2);
  });

  it("concurrent dispatches don't cross-contaminate", async () => {
    // Each instance is zero-state. Running both at the same time must
    // return independent, complete reports. (QB #7)
    const pgA = new ParallelGrep();
    const pgB = new ParallelGrep();
    const [reportA, reportB] = await Promise.all([
      pgA.dispatch("user", [rootA]),
      pgB.dispatch("user", [rootB]),
    ]);
    // A's hits come only from rootA; B's hits come only from rootB.
    expect(reportA.hits.every((h) => h.path.startsWith(rootA))).toBe(true);
    expect(reportB.hits.every((h) => h.path.startsWith(rootB))).toBe(true);
    // Confirm queries are preserved correctly.
    expect(reportA.query).toBe("user");
    expect(reportB.query).toBe("user");
  });

  it("reports zero hits honestly without crashing", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("definitelynotpresentanywhere_xyz123", [rootC]);
    expect(report.hits).toHaveLength(0);
    expect(report.returnedHitCount).toBe(0);
  });
});

// ── LLM relevance filter ────────────────────────────────

describe("ParallelGrep — LLM relevance filter", () => {
  let root: string;
  beforeEach(() => { root = mkScratch(); mkSharedRootWithUser(root); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("drops hits below the relevance threshold", async () => {
    // LLM that marks EVERY hit as 'low'.
    const allLow: LlmQuery = async (prompt) => {
      // Find numbered indices in the prompt and emit 'low' for each.
      const nums: string[] = [];
      for (let i = 0; i < 20; i++) nums.push(`${i}: low`);
      return nums.join("\n");
    };
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [root], {
      llmQuery: allLow,
      relevanceThreshold: "medium",
    });
    // threshold=medium drops all 'low' -> zero hits.
    expect(report.hits).toHaveLength(0);
  });

  it("keeps only hits at or above threshold", async () => {
    // Alternate high / low.
    const alternating: LlmQuery = async () => {
      const out: string[] = [];
      for (let i = 0; i < 20; i++) {
        out.push(`${i}: ${i % 2 === 0 ? "high" : "low"}`);
      }
      return out.join("\n");
    };
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [root], {
      llmQuery: alternating,
      relevanceThreshold: "high",
    });
    // Every surviving hit is high.
    expect(report.hits.every((h) => h.relevance === "high")).toBe(true);
  });

  it("surfaces a warning when the LLM call throws, keeps original hits", async () => {
    const blowUp: LlmQuery = async () => {
      throw new Error("provider down");
    };
    const subReport = await runGrepSubagent("user", root, {
      llmQuery: blowUp,
      relevanceThreshold: "high",
    });
    expect(subReport.warning ?? "").toContain("llm filter failed");
    // Original hits preserved (honest degradation, not silent zero).
    expect(subReport.hits.length).toBeGreaterThan(0);
  });

  it("sorts high before medium before low in aggregate", async () => {
    const mixer: LlmQuery = async () => {
      // Every 3rd hit is 'high', rest 'medium'.
      const out: string[] = [];
      for (let i = 0; i < 20; i++) {
        out.push(`${i}: ${i % 3 === 0 ? "high" : "medium"}`);
      }
      return out.join("\n");
    };
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [root], {
      llmQuery: mixer,
      relevanceThreshold: "medium",
    });
    // Check that the order is non-increasing by relevance weight.
    const weight = (r: CondensedResult["relevance"]) =>
      r === "high" ? 2 : r === "medium" ? 1 : 0;
    for (let i = 1; i < report.hits.length; i++) {
      const prev = report.hits[i - 1]!;
      const cur = report.hits[i]!;
      expect(weight(prev.relevance)).toBeGreaterThanOrEqual(weight(cur.relevance));
    }
  });
});

// ── include/exclude filtering ───────────────────────────

describe("ParallelGrep — include/exclude globs", () => {
  let root: string;
  beforeEach(() => {
    root = mkScratch();
    mkFile(root, "src/auth.ts", "export const user = 1;\n");
    mkFile(root, "src/auth.js", "module.exports = { user: 2 };\n");
    mkFile(root, "docs/notes.md", "user guide\n");
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("honors an --include glob filter", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [root], { include: ["*.ts"] });
    // Only .ts results should come back.
    expect(report.hits.some((h) => h.path.endsWith(".ts"))).toBe(true);
    expect(report.hits.some((h) => h.path.endsWith(".md"))).toBe(false);
  });

  it("honors an --exclude glob filter", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [root], { exclude: ["*.md"] });
    expect(report.hits.some((h) => h.path.endsWith(".md"))).toBe(false);
  });
});

// ── Node fallback ───────────────────────────────────────

describe("ParallelGrep — Node fallback", () => {
  let root: string;
  beforeEach(() => { root = mkScratch(); mkSharedRootWithUser(root); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("uses the Node fallback when ripgrep is unavailable (PATH stripped)", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir";
    try {
      const report = await runGrepSubagent("user", root);
      expect(report.engine).toBe("node-fallback");
      expect(report.hits.length).toBeGreaterThan(0);
      expect(report.hits.some((h) => h.path.endsWith("login.ts"))).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("parallel dispatch flags usedFallback when any subagent falls back", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir";
    try {
      const pg = new ParallelGrep();
      const report = await pg.dispatch("user", [root]);
      expect(report.usedFallback).toBe(true);
      expect(report.hits.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("Node fallback respects fixedString mode", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir";
    const tempRoot = mkScratch();
    try {
      mkFile(tempRoot, "f.ts", "const x = 'a+b*c';\n");
      // Regex would choke on raw '+*'; fixedString takes it literally.
      const report = await runGrepSubagent("a+b*c", tempRoot, {
        fixedString: true,
      });
      expect(report.engine).toBe("node-fallback");
      expect(report.hits.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = originalPath;
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

// ── Options — topK + concurrency + degenerate cases ─────

describe("ParallelGrep — options", () => {
  let rootA: string;
  let rootB: string;
  beforeEach(() => {
    rootA = mkScratch(); mkSharedRootWithUser(rootA);
    rootB = mkScratch(); mkSharedRootWithUser(rootB);
  });
  afterEach(() => {
    for (const r of [rootA, rootB]) {
      try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("concurrency=1 is serial but correct", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA, rootB], {
      concurrency: 1,
    });
    expect(report.perRoot).toHaveLength(2);
    expect(report.hits.length).toBeGreaterThan(0);
  });

  it("concurrency greater than root count is harmless", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA], {
      concurrency: 50,
    });
    expect(report.perRoot).toHaveLength(1);
  });

  it("invalid concurrency is coerced to minimum 1", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA], {
      concurrency: 0,
    });
    expect(report.perRoot).toHaveLength(1);
  });

  it("maxResults per subagent caps returned hits", async () => {
    const pg = new ParallelGrep();
    const report = await pg.dispatch("user", [rootA], { maxResults: 1 });
    // Each subagent keeps only 1 hit.
    for (const r of report.perRoot) {
      expect(r.hits.length).toBeLessThanOrEqual(1);
    }
  });
});
