/**
 * V9 T10.5 — adversarial eval harness unit tests.
 *
 * Exercises the pure helpers in `scripts/run-prompt-injection-eval.mjs`
 * (loader + validator + report formatter + regression detector). The
 * end-to-end run against the real 4 guards is exercised by the script
 * itself, not these unit tests — too much I/O for a vitest pass.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectRegressions,
  formatReport,
  loadCases,
  validateCase,
} from "../../../scripts/run-prompt-injection-eval.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");

// ── validateCase ────────────────────────────────────────────────────────

describe("validateCase", () => {
  const valid = {
    id: "x",
    source: "s",
    attack_vector: "v",
    payload: {},
    expected_block: true,
  };

  it("accepts a minimal valid case", () => {
    expect(() => validateCase(valid, "test.json")).not.toThrow();
  });

  it("rejects missing fields", () => {
    for (const field of ["id", "source", "attack_vector", "payload", "expected_block"]) {
      const broken = { ...valid } as Record<string, unknown>;
      delete broken[field];
      expect(() => validateCase(broken, "test.json")).toThrow(new RegExp(field));
    }
  });

  it("rejects non-boolean expected_block", () => {
    expect(() =>
      validateCase({ ...valid, expected_block: "yes" }, "test.json"),
    ).toThrow(/boolean/);
  });

  it("rejects non-object payload", () => {
    expect(() =>
      validateCase({ ...valid, payload: "oops" }, "test.json"),
    ).toThrow(/payload/);
  });
});

// ── loadCases + shipped corpus validity ─────────────────────────────────

describe("loadCases — shipped corpus", () => {
  it("loads every shipped case JSON file without error", () => {
    const cases = loadCases(CASES_DIR);
    expect(cases.length).toBeGreaterThan(0);
  });

  it("shipped corpus has at least 15 cases", () => {
    const cases = loadCases(CASES_DIR);
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it("every shipped case has an 'id' that is stable + unique", () => {
    const cases = loadCases(CASES_DIR);
    const ids = cases.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("corpus covers all 4 attack-vector categories", () => {
    const cases = loadCases(CASES_DIR);
    const vectors = new Set<string>(
      cases.map((c: { attack_vector: string }) => c.attack_vector),
    );
    // Must cover at least: prompt-injection, encoded-url-injection,
    // hidden-text, trifecta, none (negative control)
    expect(vectors.has("prompt-injection")).toBe(true);
    expect(vectors.has("hidden-text")).toBe(true);
    expect(vectors.has("encoded-url-injection")).toBe(true);
    expect(vectors.has("none")).toBe(true);
  });

  it("includes negative-control cases (expected_block=false)", () => {
    const cases = loadCases(CASES_DIR);
    const benign = cases.filter(
      (c: { expected_block: boolean }) => c.expected_block === false,
    );
    expect(benign.length).toBeGreaterThan(0);
  });

  it("throws on malformed cases dir", () => {
    expect(() => loadCases("/nonexistent/directory")).toThrow(/not found/);
  });
});

// ── formatReport ─────────────────────────────────────────────────────────

describe("formatReport", () => {
  it("computes pass/fail/missedAttacks counts", () => {
    const results = [
      { id: "a", file: "a.json", passed: true, missedAttack: false, blocked: true, hits: [] },
      { id: "b", file: "b.json", passed: false, missedAttack: true, blocked: false, hits: [] },
      { id: "c", file: "c.json", passed: true, missedAttack: false, blocked: false, hits: [] },
    ];
    const report = formatReport(results, []);
    expect(report.total).toBe(3);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.missedAttacks).toBe(1);
  });

  it("computes attack-success rate as missedAttacks/total", () => {
    const results = [
      { id: "a", file: "a.json", passed: false, missedAttack: true, blocked: false, hits: [] },
      { id: "b", file: "b.json", passed: true, missedAttack: false, blocked: true, hits: [] },
    ];
    const report = formatReport(results, []);
    expect(report.attackSuccessRate).toBeCloseTo(0.5, 4);
  });

  it("threshold is 2% (V9 exit criterion)", () => {
    const report = formatReport([], []);
    expect(report.threshold).toBeCloseTo(0.02, 6);
  });

  it("perCase flattens hits into 'guard:verdict' strings", () => {
    const results = [
      {
        id: "a",
        file: "a.json",
        passed: true,
        missedAttack: false,
        blocked: true,
        hits: [
          { guard: "url", verdict: "BLOCK", reason: "x" },
          { guard: "quarantine", verdict: "HALT", reason: "y" },
        ],
      },
    ];
    const report = formatReport(results, []);
    expect(report.perCase[0].hits).toEqual(["url:BLOCK", "quarantine:HALT"]);
  });
});

// ── detectRegressions ───────────────────────────────────────────────────

describe("detectRegressions", () => {
  it("returns empty when no baseline", () => {
    expect(
      detectRegressions(
        [{ id: "a", file: "a.json", passed: true, missedAttack: false, blocked: true, hits: [] }],
        null,
      ),
    ).toEqual([]);
  });

  it("flags cases that were blocked in baseline but not now", () => {
    const baseline = {
      results: [
        { id: "a", blocked: true },
        { id: "b", blocked: false },
      ],
    };
    const current = [
      { id: "a", file: "a.json", passed: false, missedAttack: true, blocked: false, hits: [] },
      { id: "b", file: "b.json", passed: true, missedAttack: false, blocked: false, hits: [] },
    ];
    const regressions = detectRegressions(current, baseline);
    expect(regressions).toEqual(["a"]);
  });

  it("does not flag new cases (absent from baseline)", () => {
    const baseline = { results: [{ id: "a", blocked: true }] };
    const current = [
      { id: "new", file: "new.json", passed: false, missedAttack: true, blocked: false, hits: [] },
    ];
    expect(detectRegressions(current, baseline)).toEqual([]);
  });

  it("does not flag cases that were already not-blocked in baseline", () => {
    const baseline = { results: [{ id: "a", blocked: false }] };
    const current = [
      { id: "a", file: "a.json", passed: true, missedAttack: false, blocked: false, hits: [] },
    ];
    expect(detectRegressions(current, baseline)).toEqual([]);
  });

  it("handles a baseline without a results array", () => {
    expect(
      detectRegressions(
        [{ id: "a", file: "a.json", passed: true, missedAttack: false, blocked: true, hits: [] }],
        { results: undefined } as unknown as Parameters<typeof detectRegressions>[1],
      ),
    ).toEqual([]);
  });
});

// ── Filesystem sanity ────────────────────────────────────────────────────

describe("shipped corpus — filesystem checks", () => {
  it("every .json file in cases/ is valid JSON", () => {
    for (const name of readdirSync(CASES_DIR)) {
      if (!name.endsWith(".json")) continue;
      const full = join(CASES_DIR, name);
      expect(() => JSON.parse(readFileSync(full, "utf-8"))).not.toThrow();
    }
  });

  it("harness script itself exists + is invocable via import.meta.resolve-ish path", () => {
    const scriptPath = join(HERE, "..", "..", "..", "scripts", "run-prompt-injection-eval.mjs");
    expect(existsSync(scriptPath)).toBe(true);
  });
});
