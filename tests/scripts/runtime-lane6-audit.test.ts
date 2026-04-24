/**
 * V9 T14.5 — runtime-lane6-audit.mjs pure-logic tests.
 *
 * The snapshot step hits the filesystem and the compare step is pure;
 * we unit-test `compareSnapshots` + `simpleHash` against hand-built
 * snapshot fixtures. The actual `.mjs` script is smoke-tested by
 * running it directly (happens in CI + was verified manually).
 */

import { describe, expect, it } from "vitest";
import {
  compareSnapshots,
  simpleHash,
} from "../../scripts/runtime-lane6-audit.mjs";

type Snapshot = {
  capturedAt: string;
  memoryEntriesCount: number | null;
  autoCaptureCount: number | null;
  memoryDbSize: number;
  tokenStatsTotal: number;
  tokenStatsSize: number;
  kgNodes: number;
  kgEdges: number;
  kgSize: number;
  userMdHash: number;
  userMdSize: number;
  dreamsLines: number;
  sessionFiles: number;
  sessionEnds: number;
};

type Finding = {
  readonly id: string;
  readonly label: string;
  readonly status: "PASS" | "FAIL" | "WARN" | "SKIP";
  readonly detail: string;
  readonly reason?: string;
};

function baseSnapshot(): Snapshot {
  return {
    capturedAt: "2026-04-23T00:00:00Z",
    memoryEntriesCount: 0,
    autoCaptureCount: 0,
    memoryDbSize: 0,
    tokenStatsTotal: 0,
    tokenStatsSize: 0,
    kgNodes: 0,
    kgEdges: 0,
    kgSize: 0,
    userMdHash: 123,
    userMdSize: 100,
    dreamsLines: 0,
    sessionFiles: 0,
    sessionEnds: 0,
  };
}

function findById(findings: readonly Finding[], id: string): Finding | undefined {
  return findings.find((f) => f.id === id);
}

// ── simpleHash ────────────────────────────────────────────────────────────

describe("simpleHash", () => {
  it("same input → same hash", () => {
    expect(simpleHash("hello")).toBe(simpleHash("hello"));
  });

  it("different input → different hash", () => {
    expect(simpleHash("hello")).not.toBe(simpleHash("world"));
  });

  it("empty string is defined (FNV-1a base)", () => {
    expect(typeof simpleHash("")).toBe("number");
  });
});

// ── compareSnapshots: verdict ─────────────────────────────────────────────

describe("compareSnapshots — verdicts", () => {
  it("all-zero before + all-zero after is FAIL (nothing ran)", () => {
    const result = compareSnapshots(baseSnapshot(), baseSnapshot()) as {
      verdict: string;
      findings: readonly Finding[];
    };
    expect(result.verdict).toBe("FAIL");
  });

  it("growth across all signals yields PASS", () => {
    const before = baseSnapshot();
    const after: Snapshot = {
      ...before,
      memoryEntriesCount: 10,
      autoCaptureCount: 15,
      tokenStatsTotal: 12345,
      tokenStatsSize: 500,
      kgNodes: 3,
      kgEdges: 5,
      kgSize: 800,
      userMdHash: 456, // different — content changed
      userMdSize: 200,
      dreamsLines: 12,
      sessionFiles: 2,
      sessionEnds: 2,
    };
    const result = compareSnapshots(before, after) as {
      verdict: string;
      findings: readonly Finding[];
    };
    expect(result.verdict).toBe("PASS");
  });

  it("zero kg nodes flags check-3 as FAIL", () => {
    const result = compareSnapshots(baseSnapshot(), baseSnapshot()) as {
      verdict: string;
      findings: readonly Finding[];
    };
    const f = findById(result.findings, "check-3");
    expect(f?.status).toBe("FAIL");
  });
});

// ── compareSnapshots: per-check details ───────────────────────────────────

describe("compareSnapshots — per-check", () => {
  it("check-1 SKIP when memoryEntriesCount is null (sqlite3 missing)", () => {
    const before: Snapshot = { ...baseSnapshot(), memoryEntriesCount: null };
    const after: Snapshot = { ...baseSnapshot(), memoryEntriesCount: null };
    const result = compareSnapshots(before, after) as {
      verdict: string;
      findings: readonly Finding[];
    };
    const f = findById(result.findings, "check-1");
    expect(f?.status).toBe("SKIP");
  });

  it("check-2 WARN when tokenStats has size but zero total (input=0 regression)", () => {
    const before = baseSnapshot();
    const after: Snapshot = { ...before, tokenStatsSize: 200 };
    const result = compareSnapshots(before, after) as {
      verdict: string;
      findings: readonly Finding[];
    };
    const f = findById(result.findings, "check-2");
    expect(f?.status).toBe("WARN");
    expect(f?.reason).toContain("Token accounting");
  });

  it("check-5 WARN when USER.md hash is byte-identical (nothing learned)", () => {
    const before = baseSnapshot();
    const after: Snapshot = { ...before };
    const result = compareSnapshots(before, after) as {
      verdict: string;
      findings: readonly Finding[];
    };
    const f = findById(result.findings, "check-5");
    expect(f?.status).toBe("WARN");
  });

  it("check-5 PASS when USER.md hash changes", () => {
    const before = baseSnapshot();
    const after: Snapshot = { ...before, userMdHash: 999 };
    const result = compareSnapshots(before, after) as {
      verdict: string;
      findings: readonly Finding[];
    };
    const f = findById(result.findings, "check-5");
    expect(f?.status).toBe("PASS");
  });

  it("check-6 FAIL when many sessions started but few ended (end ratio < 0.5)", () => {
    const before = baseSnapshot();
    const after: Snapshot = { ...before, sessionFiles: 10, sessionEnds: 1 };
    const result = compareSnapshots(before, after) as {
      verdict: string;
      findings: readonly Finding[];
    };
    const f = findById(result.findings, "check-6");
    expect(f?.status).toBe("FAIL");
    expect(f?.reason).toContain("end/start");
  });

  it("check-6 SKIP when no new sessions ran", () => {
    const before = baseSnapshot();
    const after: Snapshot = { ...before }; // no Δ
    const result = compareSnapshots(before, after) as {
      verdict: string;
      findings: readonly Finding[];
    };
    const f = findById(result.findings, "check-6");
    expect(f?.status).toBe("SKIP");
  });

  it("check-6 PASS when ratio >= 0.5", () => {
    const before = baseSnapshot();
    const after: Snapshot = { ...before, sessionFiles: 4, sessionEnds: 3 };
    const result = compareSnapshots(before, after) as {
      verdict: string;
      findings: readonly Finding[];
    };
    const f = findById(result.findings, "check-6");
    expect(f?.status).toBe("PASS");
  });
});
