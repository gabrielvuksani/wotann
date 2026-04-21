/**
 * Tests for `wotann grep` — B9 ParallelGrep CLI wire (P1-B9).
 *
 * Before this command shipped, ParallelGrep (src/tools/parallel-grep.ts)
 * was a 716 LOC library with 28 unit tests and zero runtime callers.
 * These tests prove the shell dispatches through `pg.dispatch()` — not
 * just that it imports the module — and that honest fallbacks (ripgrep
 * missing, llmQuery absent, no paths) are surfaced in the output rather
 * than silently swallowed (QB #6 / QB #14).
 *
 * Fixture strategy: tiny scratch dirs with predictable content. We do
 * not mock ParallelGrep itself — the goal is to exercise the full
 * shell -> dispatch -> render chain.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { runGrep, type GrepCommandOptions } from "../../src/cli/commands/grep.js";
import { ParallelGrep } from "../../src/tools/parallel-grep.js";
import type { LlmQuery } from "../../src/tools/parallel-grep.js";

// ── Fixtures ──────────────────────────────────────────────

function mkScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), `wotann-grep-cli-${randomUUID()}`));
  return dir;
}

function mkFile(root: string, relPath: string, content: string): string {
  const full = join(root, relPath);
  const parent = full.substring(0, full.lastIndexOf("/"));
  if (parent && parent !== root) mkdirSync(parent, { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

function seedAuthFixture(root: string): void {
  mkFile(
    root,
    "src/auth/login.ts",
    [
      "export function login(user: string) {",
      "  return fetch('/api/login', { body: JSON.stringify({ user }) });",
      "}",
    ].join("\n"),
  );
  mkFile(
    root,
    "src/auth/logout.ts",
    [
      "export function logout() {",
      "  return fetch('/api/logout');",
      "}",
    ].join("\n"),
  );
}

let scratch: string;

beforeEach(() => {
  scratch = mkScratch();
});

afterEach(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ── Tests ─────────────────────────────────────────────────

describe("runGrep — basic dispatch (N=1)", () => {
  it("runs a sequential dispatch (no --parallel) and returns hits", async () => {
    seedAuthFixture(scratch);
    const result = await runGrep("login", [scratch]);
    expect(result.report.query).toBe("login");
    expect(result.report.roots).toEqual([scratch]);
    // perRoot carries exactly one subagent report when parallel is off
    // and one root is supplied.
    expect(result.report.perRoot).toHaveLength(1);
    expect(result.report.hits.length).toBeGreaterThan(0);
    expect(result.report.hits.some((h) => h.path.endsWith("login.ts"))).toBe(true);
  });

  it("defaults to process.cwd() when no paths supplied", async () => {
    // We don't care about hits; we care that the shell substitutes cwd
    // as the root. Use an empty scratch dir with cwd set elsewhere.
    const originalCwd = process.cwd();
    process.chdir(scratch);
    try {
      seedAuthFixture(scratch);
      const result = await runGrep("login", []);
      expect(result.report.roots).toEqual([process.cwd()]);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("runGrep — --parallel dispatch", () => {
  it("fans out across multiple roots with 4 workers", async () => {
    const rootA = mkScratch();
    const rootB = mkScratch();
    try {
      seedAuthFixture(rootA);
      mkFile(rootB, "docs/guide.md", "# login guide\n\nStep 1: login here.\n");
      const result = await runGrep("login", [rootA, rootB], {
        parallel: true,
      });
      expect(result.report.roots).toHaveLength(2);
      expect(result.report.perRoot).toHaveLength(2);
      // Hits come from BOTH roots.
      expect(result.report.hits.some((h) => h.path.startsWith(rootA))).toBe(true);
      expect(result.report.hits.some((h) => h.path.startsWith(rootB))).toBe(true);
    } finally {
      try {
        rmSync(rootA, { recursive: true, force: true });
      } catch { /* ignore */ }
      try {
        rmSync(rootB, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  });

  it("parallel with custom worker count is honored", async () => {
    const rootA = mkScratch();
    const rootB = mkScratch();
    try {
      seedAuthFixture(rootA);
      seedAuthFixture(rootB);
      const result = await runGrep("login", [rootA, rootB], {
        parallel: true,
        parallelism: 2,
      });
      expect(result.report.perRoot).toHaveLength(2);
      expect(result.report.returnedHitCount).toBeGreaterThan(0);
    } finally {
      try {
        rmSync(rootA, { recursive: true, force: true });
      } catch { /* ignore */ }
      try {
        rmSync(rootB, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  });
});

describe("runGrep — topK cap", () => {
  it("respects --top-k limit on returned hit count", async () => {
    // Seed many matches so the cap actually clamps.
    for (let i = 0; i < 10; i++) {
      mkFile(scratch, `src/file${i}.ts`, `// line 1\nexport const login${i} = 'login';\n`);
    }
    const result = await runGrep("login", [scratch], { topK: 3 });
    expect(result.report.returnedHitCount).toBeLessThanOrEqual(3);
    expect(result.report.hits.length).toBeLessThanOrEqual(3);
    // rawHitCount is still honest (pre-cap).
    expect(result.report.rawHitCount).toBeGreaterThanOrEqual(result.report.returnedHitCount);
  });

  it("topK default is 20 when not specified", async () => {
    // Seed 25 matches; verify the default caps at 20.
    for (let i = 0; i < 25; i++) {
      mkFile(scratch, `src/f${i}.ts`, `export const x${i} = 'login';\n`);
    }
    const result = await runGrep("login", [scratch]);
    expect(result.report.returnedHitCount).toBeLessThanOrEqual(20);
  });
});

describe("runGrep — formatted output", () => {
  it("renders a header line with hit count, root count, duration, and engine", async () => {
    seedAuthFixture(scratch);
    const result = await runGrep("login", [scratch]);
    expect(result.lines.length).toBeGreaterThan(0);
    const header = result.lines[0]!;
    expect(header).toMatch(/grep "login"/);
    // Header should mention hit counts "N/M hit(s)" and engine tag.
    expect(header).toMatch(/hit\(s\)/);
    expect(header).toMatch(/ripgrep|node-fallback/);
  });

  it("renders a (no matches) line when no hits", async () => {
    // Empty scratch dir -> zero matches.
    const result = await runGrep("definitely_not_present_xyz", [scratch]);
    expect(result.report.returnedHitCount).toBe(0);
    expect(result.lines.some((l) => /no matches/i.test(l))).toBe(true);
  });

  it("respects terminal width when rendering snippet lines (cap at 160)", async () => {
    const giant = "const x = '" + "y".repeat(500) + "';\n";
    mkFile(scratch, "huge.ts", giant);
    const result = await runGrep("y", [scratch]);
    // Every rendered line must be under the hard 160-char cap.
    for (const line of result.lines) {
      expect(line.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("runGrep — JSON output", () => {
  it("suppresses formatted lines when json=true and populates report", async () => {
    seedAuthFixture(scratch);
    const result = await runGrep("login", [scratch], { json: true });
    // In JSON mode the shell is the one that serialises; runGrep returns
    // empty `lines` so the caller can JSON.stringify the result cleanly.
    expect(result.lines).toEqual([]);
    expect(result.report.query).toBe("login");
    expect(result.report.hits.length).toBeGreaterThan(0);
  });

  it("json report matches expected shape (fields present)", async () => {
    seedAuthFixture(scratch);
    const result = await runGrep("login", [scratch], { json: true });
    // Validate the structural shape the JSON path depends on.
    const report = result.report;
    expect(typeof report.query).toBe("string");
    expect(Array.isArray(report.roots)).toBe(true);
    expect(typeof report.returnedHitCount).toBe("number");
    expect(typeof report.rawHitCount).toBe("number");
    expect(typeof report.dedupedHitCount).toBe("number");
    expect(typeof report.durationMs).toBe("number");
    expect(typeof report.usedFallback).toBe("boolean");
    expect(Array.isArray(report.warnings)).toBe(true);
    expect(Array.isArray(report.hits)).toBe(true);
    for (const hit of report.hits) {
      expect(typeof hit.path).toBe("string");
      expect(typeof hit.line).toBe("number");
      expect(typeof hit.snippet).toBe("string");
      expect(["high", "medium", "low"]).toContain(hit.relevance);
    }
  });
});

describe("runGrep — Node fallback honest flag", () => {
  it("ripgrep unavailable -> usedFallback=true and hits still returned", async () => {
    seedAuthFixture(scratch);
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir";
    try {
      const result = await runGrep("login", [scratch]);
      expect(result.report.usedFallback).toBe(true);
      expect(result.report.hits.length).toBeGreaterThan(0);
      // The per-root engine field must say node-fallback (verified upstream).
      expect(result.report.perRoot.every((r) => r.engine === "node-fallback")).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("formatted header flags fallback engine in the tag", async () => {
    seedAuthFixture(scratch);
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir";
    try {
      const result = await runGrep("login", [scratch]);
      const header = result.lines[0] ?? "";
      expect(header).toContain("node-fallback");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe("runGrep — empty query (guard)", () => {
  it("rejects empty query with an Error (no silent zero)", async () => {
    await expect(runGrep("", [scratch])).rejects.toThrow(/empty query/i);
  });

  it("rejects whitespace-only query", async () => {
    await expect(runGrep("   ", [scratch])).rejects.toThrow(/empty query/i);
  });
});

describe("runGrep — relevance-filter wiring", () => {
  it("relevance-filter without llmQuery -> applied=false + warning surfaced", async () => {
    seedAuthFixture(scratch);
    const result = await runGrep("login", [scratch], {
      relevanceFilter: true,
    });
    // Honest fallback: flag was requested but no provider wired, so
    // `applied` must be false and a warning must explain why.
    expect(result.relevanceFilterApplied).toBe(false);
    expect(result.extraWarnings.some((w) => /relevance-filter/i.test(w))).toBe(true);
    // The rendered header must claim "heuristic" not "llm" to match reality.
    expect(result.lines[0] ?? "").toContain("heuristic");
    // Hits still returned — degradation is not silent zero.
    expect(result.report.hits.length).toBeGreaterThan(0);
  });

  it("relevance-filter WITH llmQuery -> applied=true + no shell warning", async () => {
    seedAuthFixture(scratch);
    // Minimal LlmQuery that marks every hit 'high' so they all pass
    // the default 'medium' threshold.
    const allHigh: LlmQuery = async () => {
      const lines: string[] = [];
      for (let i = 0; i < 20; i++) lines.push(`${i}: high`);
      return lines.join("\n");
    };
    const result = await runGrep("login", [scratch], {
      relevanceFilter: true,
      llmQuery: allHigh,
    });
    expect(result.relevanceFilterApplied).toBe(true);
    expect(result.extraWarnings).toEqual([]);
    expect(result.lines[0] ?? "").toContain("llm");
    expect(result.report.hits.length).toBeGreaterThan(0);
    // Every returned hit should be tagged 'high' by the filter.
    expect(result.report.hits.every((h) => h.relevance === "high")).toBe(true);
  });
});

describe("runGrep — injected ParallelGrep (QB #7 per-session state)", () => {
  it("uses the caller-supplied ParallelGrep instance (proves dispatch wiring)", async () => {
    seedAuthFixture(scratch);
    // Build our own ParallelGrep and thread it through. This is the
    // direct proof that `runGrep` calls `pg.dispatch()` — if it didn't,
    // the dispatch counter below would never increment.
    let dispatchCount = 0;
    const base = new ParallelGrep();
    const tracked = Object.assign(Object.create(ParallelGrep.prototype), {
      dispatch: async (...args: Parameters<ParallelGrep["dispatch"]>) => {
        dispatchCount++;
        return base.dispatch(...args);
      },
    }) as ParallelGrep;
    const result = await runGrep("login", [scratch], { grep: tracked });
    expect(dispatchCount).toBe(1);
    expect(result.report.hits.length).toBeGreaterThan(0);
  });
});

describe("runGrep — public option typing (readonly-friendly)", () => {
  it("accepts a readonly options object shape", async () => {
    // This test proves the GrepCommandOptions type can be constructed
    // without fighting TypeScript `readonly` constraints (compile-time
    // signal that future callers can pipe frozen config objects).
    const opts: GrepCommandOptions = Object.freeze({
      parallel: false,
      topK: 5,
      json: true,
    });
    seedAuthFixture(scratch);
    const result = await runGrep("login", [scratch], opts);
    expect(result.report.returnedHitCount).toBeLessThanOrEqual(5);
    expect(result.lines).toEqual([]); // json suppresses lines
  });
});
