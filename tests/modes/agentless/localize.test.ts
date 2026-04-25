import { describe, expect, it } from "vitest";
import {
  extractKeywords,
  heuristicKeywords,
  localizeIssue,
} from "../../../src/modes/agentless/localize.js";
import type {
  AgentlessIssue,
  AgentlessModel,
  CodeSearchFn,
} from "../../../src/modes/agentless/types.js";

describe("heuristicKeywords", () => {
  it("filters stopwords + dedupes + biases identifiers", () => {
    const text = "Fix bug in calculatePagination when page is null";
    const kws = heuristicKeywords(text, 3);
    expect(kws).toContain("calculatePagination");
    expect(kws.find((k) => k.toLowerCase() === "the")).toBeUndefined();
  });

  it("returns at most max", () => {
    const kws = heuristicKeywords("foo bar baz qux", 2);
    expect(kws.length).toBeLessThanOrEqual(2);
  });

  it("handles empty input", () => {
    expect(heuristicKeywords("", 5)).toEqual([]);
  });
});

describe("extractKeywords", () => {
  it("uses model when provided", async () => {
    const model: AgentlessModel = {
      name: "haiku",
      query: async () => ({ text: "alpha\nbeta\ngamma\n", tokensIn: 1, tokensOut: 1 }),
    };
    const issue: AgentlessIssue = { title: "x", body: "y" };
    const kws = await extractKeywords(issue, model, 5);
    expect(kws).toEqual(["alpha", "beta", "gamma"]);
  });

  it("falls back to heuristics on model error", async () => {
    const model: AgentlessModel = {
      name: "broken",
      query: async () => {
        throw new Error("rate limited");
      },
    };
    const issue: AgentlessIssue = { title: "fix calculatePagination", body: "bug" };
    const kws = await extractKeywords(issue, model, 4);
    expect(kws.length).toBeGreaterThan(0);
    expect(kws).toContain("calculatePagination");
  });

  it("falls back when no model is provided", async () => {
    const kws = await extractKeywords({ title: "fix paginate", body: "" }, undefined, 3);
    expect(kws.length).toBeGreaterThan(0);
  });
});

describe("localizeIssue", () => {
  const issue: AgentlessIssue = {
    title: "Off-by-one in calculatePagination",
    body: "The function returns wrong total pages when limit equals 0",
  };

  it("ranks files by hit count and returns top-K", async () => {
    const search: CodeSearchFn = async (kw) => {
      if (kw === "calculatePagination") {
        return [
          { file: "/r/src/paginate.ts", count: 7 },
          { file: "/r/tests/paginate.test.ts", count: 1 },
        ];
      }
      return [];
    };

    const r = await localizeIssue(issue, {
      root: "/r",
      codeSearchFn: search,
      topK: 3,
    });
    expect(r.candidateFiles.length).toBe(2);
    expect(r.candidateFiles[0]?.file).toBe("/r/src/paginate.ts");
    expect(r.candidateFiles[0]?.score).toBe(1);
    expect(r.candidateFiles[1]?.score).toBeCloseTo(1 / 7);
  });

  it("returns empty candidateFiles when no hits — never throws", async () => {
    const r = await localizeIssue(issue, {
      root: "/r",
      codeSearchFn: async () => [],
    });
    expect(r.candidateFiles).toEqual([]);
    expect(r.keywords.length).toBeGreaterThan(0);
  });

  it("aggregates hits across keywords + collects evidence", async () => {
    const search: CodeSearchFn = async (kw) => {
      if (kw.length > 4) return [{ file: "/r/x.ts", count: 1 }];
      return [];
    };
    const r = await localizeIssue(issue, {
      root: "/r",
      codeSearchFn: search,
    });
    expect(r.candidateFiles.length).toBe(1);
    expect(r.candidateFiles[0]?.evidence.length).toBeGreaterThan(0);
  });

  it("survives codeSearchFn throw", async () => {
    const r = await localizeIssue(issue, {
      root: "/r",
      codeSearchFn: async () => {
        throw new Error("rg crashed");
      },
    });
    expect(r.candidateFiles).toEqual([]);
  });
});
