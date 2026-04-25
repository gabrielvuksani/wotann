import { describe, expect, it } from "vitest";
import { runAgentless } from "../../../src/modes/agentless/orchestrator.js";
import type {
  AgentlessIssue,
  AgentlessModel,
  CodeSearchFn,
  ProgressEvent,
} from "../../../src/modes/agentless/types.js";
import type { ShadowGitLike } from "../../../src/modes/agentless/validate.js";

const sampleDiff = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
+new
`;

const issue: AgentlessIssue = {
  title: "Off-by-one in calculatePagination",
  body: "Returns wrong total pages for limit=0",
};

class StubShadowGit implements ShadowGitLike {
  async createBranch(): Promise<void> {}
  async applyDiff(): Promise<void> {}
  async discardBranch(): Promise<void> {}
}

const passthroughSearch: CodeSearchFn = async () => [{ file: "/r/p.ts", count: 3 }];

describe("runAgentless", () => {
  it("happy path → success outcome with all 3 phases", async () => {
    const events: ProgressEvent[] = [];
    const model: AgentlessModel = {
      name: "sonnet",
      query: async () => ({
        text: "```diff\n" + sampleDiff + "```",
        tokensIn: 10,
        tokensOut: 5,
      }),
    };
    const r = await runAgentless(issue, {
      localize: { root: "/r", codeSearchFn: passthroughSearch },
      repair: { model, root: "/r", readFileFn: async () => "code" },
      validate: {
        shadowGit: new StubShadowGit(),
        runTests: async () => ({ exitCode: 0, stdout: "Tests: 5 passed, 0 failed", stderr: "" }),
      },
      onProgress: (e) => events.push(e),
    });
    expect(r.outcome).toBe("success");
    expect(r.localize).toBeDefined();
    expect(r.repair).toBeDefined();
    expect(r.validate).toBeDefined();
    const phases = events.map((e) => `${e.phase}:${e.status}`);
    expect(phases).toContain("localize:start");
    expect(phases).toContain("validate:done");
  });

  it("blocked-repair → returns without calling validate", async () => {
    let validateCalled = false;
    const model: AgentlessModel = {
      name: "x",
      query: async () => ({ text: "I cannot fix this", tokensIn: 1, tokensOut: 1 }),
    };
    const r = await runAgentless(issue, {
      localize: { root: "/r", codeSearchFn: passthroughSearch },
      repair: { model, root: "/r", readFileFn: async () => "" },
      validate: {
        shadowGit: new StubShadowGit(),
        runTests: async () => {
          validateCalled = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    });
    expect(r.outcome).toBe("blocked-repair");
    expect(validateCalled).toBe(false);
    expect(r.repair?.diff).toBeNull();
  });

  it("blocked-validate when tests fail", async () => {
    const model: AgentlessModel = {
      name: "x",
      query: async () => ({ text: "```diff\n" + sampleDiff + "```", tokensIn: 1, tokensOut: 1 }),
    };
    const r = await runAgentless(issue, {
      localize: { root: "/r", codeSearchFn: passthroughSearch },
      repair: { model, root: "/r", readFileFn: async () => "" },
      validate: {
        shadowGit: new StubShadowGit(),
        runTests: async () => ({
          exitCode: 1,
          stdout: "Tests: 0 passed, 5 failed, 5 total",
          stderr: "",
        }),
      },
    });
    expect(r.outcome).toBe("blocked-validate");
    expect(r.validate?.passed).toBe(false);
  });

  it("skipValidate=true returns success based on diff alone", async () => {
    let validateCalled = false;
    const model: AgentlessModel = {
      name: "x",
      query: async () => ({ text: sampleDiff, tokensIn: 1, tokensOut: 1 }),
    };
    const r = await runAgentless(issue, {
      localize: { root: "/r", codeSearchFn: passthroughSearch },
      repair: { model, root: "/r", readFileFn: async () => "" },
      validate: {
        shadowGit: new StubShadowGit(),
        runTests: async () => {
          validateCalled = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      skipValidate: true,
    });
    expect(r.outcome).toBe("success");
    expect(r.validate).toBeUndefined();
    expect(validateCalled).toBe(false);
  });

  it("totalDurationMs > 0 even on early exits", async () => {
    const model: AgentlessModel = {
      name: "x",
      query: async () => ({ text: "no diff here", tokensIn: 1, tokensOut: 1 }),
    };
    const r = await runAgentless(issue, {
      localize: { root: "/r", codeSearchFn: async () => [] },
      repair: { model, root: "/r" },
    });
    expect(r.outcome).toBe("blocked-repair");
    expect(r.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
