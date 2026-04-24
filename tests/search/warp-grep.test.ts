/**
 * Tier 12 T12.3 — WarpGrep parallel search tests.
 *
 * Exercises budget enforcement, query-count cap, timeout handling,
 * dedup + ranking, and per-call state isolation. All via the injected
 * `runSingleQuery` runner so tests are deterministic and don't touch
 * the filesystem.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createWarpGrep,
  dispatchParallelSearch,
  DEFAULT_BUDGET,
  MAX_PARALLEL_QUERIES,
  type GrepQuery,
  type SingleQueryRunner,
  type WarpGrepOptions,
} from "../../src/search/warp-grep.js";
import type {
  CondensedResult,
  GrepSubagentReport,
} from "../../src/tools/grep-subagent.js";

// ── Helpers ──────────────────────────────────────────────

function hit(
  path: string,
  line: number,
  snippet: string,
  relevance: CondensedResult["relevance"] = "medium",
): CondensedResult {
  return { path, line, snippet, relevance };
}

function stubReport(hits: CondensedResult[], warning?: string): GrepSubagentReport {
  const base: {
    root: string;
    engine: GrepSubagentReport["engine"];
    rawHits: number;
    filteredHits: number;
    durationMs: number;
    hits: readonly CondensedResult[];
    warning?: string;
  } = {
    root: "/stub",
    engine: "ripgrep",
    rawHits: hits.length,
    filteredHits: hits.length,
    durationMs: 1,
    hits,
  };
  if (warning !== undefined) base.warning = warning;
  return base;
}

function makeRunner(
  responses: ReadonlyMap<string, GrepSubagentReport>,
  fallback?: GrepSubagentReport,
): SingleQueryRunner {
  return async (pattern, root, _options) => {
    const key = `${pattern}::${root}`;
    return responses.get(key) ?? responses.get(pattern) ?? fallback ?? stubReport([]);
  };
}

// ── Basic dispatch ───────────────────────────────────────

describe("dispatchParallelSearch — happy path", () => {
  it("returns hits from a single query", async () => {
    const runner = makeRunner(
      new Map([
        ["foo", stubReport([hit("a.ts", 10, "foo bar", "high")])],
      ]),
    );
    const result = await dispatchParallelSearch([{ pattern: "foo" }], { runSingleQuery: runner });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.file).toBe("a.ts");
    expect(result.hits[0]?.match).toBe("foo bar");
    expect(result.truncated).toBe(false);
  });

  it("runs 4 queries in parallel and merges", async () => {
    const runner: SingleQueryRunner = async (pattern, _root, _options) =>
      stubReport([hit(`${pattern}.ts`, 1, pattern)]);
    const queries: GrepQuery[] = [
      { pattern: "alpha" },
      { pattern: "beta" },
      { pattern: "gamma" },
      { pattern: "delta" },
    ];
    const result = await dispatchParallelSearch(queries, { runSingleQuery: runner });
    expect(result.hits.length).toBe(4);
    expect(result.truncated).toBe(false);
    expect(result.hits.map((h) => h.file).sort()).toEqual([
      "alpha.ts",
      "beta.ts",
      "delta.ts",
      "gamma.ts",
    ]);
  });

  it("returns empty + ok on zero queries", async () => {
    const result = await dispatchParallelSearch([], {
      runSingleQuery: async () => stubReport([]),
    });
    expect(result.hits).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });
});

// ── Budget enforcement ───────────────────────────────────

describe("dispatchParallelSearch — budget", () => {
  it("truncates when query count > MAX_PARALLEL_QUERIES", async () => {
    const runner: SingleQueryRunner = async () => stubReport([]);
    const tooMany: GrepQuery[] = Array.from({ length: MAX_PARALLEL_QUERIES + 1 }, (_, i) => ({
      pattern: `p${i}`,
    }));
    const result = await dispatchParallelSearch(tooMany, { runSingleQuery: runner });
    expect(result.truncated).toBe(true);
    expect(result.reason).toContain("Too many queries");
    expect(result.hits).toHaveLength(0);
  });

  it("caps hits at maxHits budget", async () => {
    const manyHits = Array.from({ length: 100 }, (_, i) => hit(`file${i}.ts`, i, `match${i}`));
    const runner: SingleQueryRunner = async () => stubReport(manyHits);
    const result = await dispatchParallelSearch([{ pattern: "x" }], {
      runSingleQuery: runner,
      budget: { maxHits: 10 },
    });
    expect(result.hits).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(result.reason).toContain("maxHits");
    expect(result.rawHitCount).toBe(100);
  });

  it("caps output bytes at maxOutputBytes", async () => {
    const bigHits = Array.from({ length: 20 }, (_, i) =>
      hit(`f${i}.ts`, i, "x".repeat(500)),
    );
    const runner: SingleQueryRunner = async () => stubReport(bigHits);
    const result = await dispatchParallelSearch([{ pattern: "x" }], {
      runSingleQuery: runner,
      budget: { maxOutputBytes: 1024 },
    });
    expect(result.truncated).toBe(true);
    expect(result.reason).toContain("maxOutputBytes");
    expect(result.hits.length).toBeLessThan(bigHits.length);
  });

  it("enforces timeoutMs when runners stall", async () => {
    const runner: SingleQueryRunner = async () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(stubReport([hit("a.ts", 1, "x")])), 200);
      });
    const result = await dispatchParallelSearch([{ pattern: "x" }], {
      runSingleQuery: runner,
      budget: { timeoutMs: 20 },
    });
    expect(result.truncated).toBe(true);
    expect(result.reason).toContain("timeout");
  });

  it("default budget values are sane", () => {
    expect(DEFAULT_BUDGET.maxHits).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET.maxOutputBytes).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET.timeoutMs).toBeGreaterThan(0);
    expect(MAX_PARALLEL_QUERIES).toBe(8);
  });
});

// ── Dedup + ranking ──────────────────────────────────────

describe("dispatchParallelSearch — dedup + ranking", () => {
  it("deduplicates identical file:line pairs across queries", async () => {
    const shared = hit("shared.ts", 42, "match", "high");
    const runnerA: SingleQueryRunner = async (pattern) => {
      if (pattern === "a") return stubReport([shared, hit("a.ts", 1, "x")]);
      if (pattern === "b") return stubReport([shared, hit("b.ts", 2, "x")]);
      return stubReport([]);
    };
    const result = await dispatchParallelSearch(
      [{ pattern: "a" }, { pattern: "b" }],
      { runSingleQuery: runnerA },
    );
    // 3 unique file:line pairs — shared.ts:42, a.ts:1, b.ts:2
    expect(result.hits).toHaveLength(3);
    expect(result.rawHitCount).toBe(4);
  });

  it("ranks high > medium > low", async () => {
    const mix = [
      hit("low.ts", 1, "low", "low"),
      hit("high.ts", 1, "high", "high"),
      hit("med.ts", 1, "med", "medium"),
    ];
    const runner: SingleQueryRunner = async () => stubReport(mix);
    const result = await dispatchParallelSearch([{ pattern: "x" }], { runSingleQuery: runner });
    expect(result.hits[0]?.file).toBe("high.ts");
    expect(result.hits[1]?.file).toBe("med.ts");
    expect(result.hits[2]?.file).toBe("low.ts");
  });

  it("keeps higher relevance on dedup collision", async () => {
    const runner: SingleQueryRunner = async (pattern) => {
      if (pattern === "a") return stubReport([hit("c.ts", 5, "A", "low")]);
      return stubReport([hit("c.ts", 5, "B", "high")]);
    };
    const result = await dispatchParallelSearch(
      [{ pattern: "a" }, { pattern: "b" }],
      { runSingleQuery: runner },
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.match).toBe("B"); // high won
  });
});

// ── Error isolation ──────────────────────────────────────

describe("dispatchParallelSearch — error isolation", () => {
  it("isolates failures per query", async () => {
    const runner: SingleQueryRunner = async (pattern) => {
      if (pattern === "boom") throw new Error("subagent crash");
      return stubReport([hit("ok.ts", 1, "ok")]);
    };
    const result = await dispatchParallelSearch(
      [{ pattern: "ok" }, { pattern: "boom" }],
      { runSingleQuery: runner },
    );
    // "ok" query still produces a hit; "boom" silently contributes zero.
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits.some((h) => h.file === "ok.ts")).toBe(true);
  });

  it("forwards query options to subagent", async () => {
    const seen: { pattern: string; caseInsensitive?: boolean; fixedString?: boolean }[] = [];
    const runner: SingleQueryRunner = async (pattern, _root, options) => {
      seen.push({
        pattern,
        caseInsensitive: options.caseInsensitive,
        fixedString: options.fixedString,
      });
      return stubReport([]);
    };
    await dispatchParallelSearch(
      [
        { pattern: "a", caseInsensitive: false },
        { pattern: "b", fixedString: true },
      ],
      { runSingleQuery: runner },
    );
    expect(seen[0]?.caseInsensitive).toBe(false);
    expect(seen[1]?.fixedString).toBe(true);
  });

  it("uses query.path as root when provided", async () => {
    const seen: { root: string }[] = [];
    const runner: SingleQueryRunner = async (_p, root, _o) => {
      seen.push({ root });
      return stubReport([]);
    };
    await dispatchParallelSearch(
      [{ pattern: "x", path: "/workspace/sub" }],
      { runSingleQuery: runner, rootDir: "/workspace" },
    );
    expect(seen[0]?.root).toBe("/workspace/sub");
  });
});

// ── Factory + isolation ──────────────────────────────────

describe("createWarpGrep — per-session isolation", () => {
  it("returns independent instances", () => {
    const a = createWarpGrep();
    const b = createWarpGrep();
    expect(a).not.toBe(b);
  });

  it("two dispatches don't share hit counter", async () => {
    const runner = vi.fn<SingleQueryRunner>().mockResolvedValue(
      stubReport([hit("a.ts", 1, "x")]),
    );
    const wg = createWarpGrep();
    const [r1, r2] = await Promise.all([
      wg.dispatch([{ pattern: "x" }], { runSingleQuery: runner }),
      wg.dispatch([{ pattern: "y" }], { runSingleQuery: runner }),
    ]);
    expect(r1.hits.length).toBe(1);
    expect(r2.hits.length).toBe(1);
  });
});

// ── Budget normalization ─────────────────────────────────

describe("budget normalization", () => {
  it("applies minimum safety floors on abnormal budget input", async () => {
    const runner: SingleQueryRunner = async () => stubReport([hit("a.ts", 1, "x")]);
    const opts: WarpGrepOptions = {
      runSingleQuery: runner,
      budget: { maxHits: 0, maxOutputBytes: 0, timeoutMs: 0 },
    };
    const r = await dispatchParallelSearch([{ pattern: "x" }], opts);
    // Floors are applied; the dispatch does not infinite-loop or crash.
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});
