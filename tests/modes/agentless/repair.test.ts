import { describe, expect, it } from "vitest";
import {
  buildRepairContext,
  extractUnifiedDiff,
  repairIssue,
} from "../../../src/modes/agentless/repair.js";
import type {
  AgentlessIssue,
  AgentlessModel,
  LocalizeResult,
} from "../../../src/modes/agentless/types.js";

const sampleDiff = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
+new
`;

describe("extractUnifiedDiff", () => {
  it("extracts from fenced ```diff block", () => {
    const text = "Here is your fix:\n\n```diff\n" + sampleDiff + "```\n";
    const out = extractUnifiedDiff(text);
    expect(out).toContain("diff --git");
    expect(out).toContain("+new");
  });

  it("extracts bare diff text without fence", () => {
    const out = extractUnifiedDiff(sampleDiff);
    expect(out).toContain("diff --git");
  });

  it("returns null on empty fenced block", () => {
    const out = extractUnifiedDiff("```diff\n\n```\n");
    expect(out).toBeNull();
  });

  it("returns null when response is non-diff prose", () => {
    const out = extractUnifiedDiff("I don't know how to fix this.");
    expect(out).toBeNull();
  });
});

describe("buildRepairContext", () => {
  it("reads each file and fences it", async () => {
    const r = await buildRepairContext(["/x.ts", "/y.ts"], {
      model: {} as AgentlessModel,
      root: "/",
      readFileFn: async (p) => `content-of-${p}`,
    });
    expect(r).toContain("// /x.ts");
    expect(r).toContain("content-of-/x.ts");
    expect(r).toContain("// /y.ts");
  });

  it("skips files that fail to read", async () => {
    const r = await buildRepairContext(["/good.ts", "/bad.ts"], {
      model: {} as AgentlessModel,
      root: "/",
      readFileFn: async (p) => {
        if (p === "/bad.ts") throw new Error("ENOENT");
        return "ok";
      },
    });
    expect(r).toContain("/good.ts");
    expect(r).not.toContain("/bad.ts");
  });

  it("truncates oversized content", async () => {
    const big = "x".repeat(50_000);
    const r = await buildRepairContext(["/big.ts"], {
      model: {} as AgentlessModel,
      root: "/",
      readFileFn: async () => big,
      maxBytesPerFile: 100,
    });
    expect(r).toContain("(truncated)");
  });
});

describe("repairIssue", () => {
  const issue: AgentlessIssue = { title: "fix x", body: "y" };
  const localize: LocalizeResult = {
    keywords: ["x"],
    candidateFiles: [{ file: "/x.ts", score: 1, hitCount: 5, evidence: ["x"] }],
    searchedRoots: ["/"],
    durationMs: 1,
  };

  it("returns diff when model emits valid response", async () => {
    const model: AgentlessModel = {
      name: "sonnet",
      query: async () => ({
        text: "```diff\n" + sampleDiff + "```",
        tokensIn: 100,
        tokensOut: 50,
      }),
    };
    const r = await repairIssue(issue, localize, {
      model,
      root: "/",
      readFileFn: async () => "file content",
    });
    expect(r.diff).toContain("diff --git");
    expect(r.error).toBeUndefined();
    expect(r.tokensIn).toBe(100);
    expect(r.modelUsed).toBe("sonnet");
  });

  it("returns null + error when model emits no diff", async () => {
    const model: AgentlessModel = {
      name: "sonnet",
      query: async () => ({ text: "I cannot fix this", tokensIn: 1, tokensOut: 1 }),
    };
    const r = await repairIssue(issue, localize, {
      model,
      root: "/",
      readFileFn: async () => "x",
    });
    expect(r.diff).toBeNull();
    expect(r.error).toMatch(/extract/);
  });

  it("returns null + error when model throws", async () => {
    const model: AgentlessModel = {
      name: "sonnet",
      query: async () => {
        throw new Error("API down");
      },
    };
    const r = await repairIssue(issue, localize, {
      model,
      root: "/",
      readFileFn: async () => "x",
    });
    expect(r.diff).toBeNull();
    expect(r.error).toContain("API down");
    expect(r.tokensIn).toBe(0);
  });

  it("provides candidate file context to model", async () => {
    let promptSeen = "";
    const model: AgentlessModel = {
      name: "sonnet",
      query: async (prompt) => {
        promptSeen = prompt;
        return { text: sampleDiff, tokensIn: 1, tokensOut: 1 };
      },
    };
    await repairIssue(issue, localize, {
      model,
      root: "/",
      readFileFn: async () => "function foo() { return 1; }",
    });
    expect(promptSeen).toContain("function foo");
    expect(promptSeen).toContain("/x.ts");
  });
});
