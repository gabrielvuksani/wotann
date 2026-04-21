import { describe, it, expect } from "vitest";
import {
  PreCompletionVerifier,
  PERSPECTIVES,
  parsePerspectiveResponse,
  formatVerificationReport,
  type LlmQuery,
  type VerificationInput,
} from "../../src/intelligence/pre-completion-verifier.js";

// ── Helpers ──────────────────────────────────────────────────

const SAMPLE_INPUT: VerificationInput = {
  task: "Add a /ping endpoint that returns {ok:true}",
  result: "Added route /ping in routes.ts, returns {ok:true}. Added test.",
};

function mkLlmPass(): LlmQuery {
  return async () => `{"verdict":"pass","concerns":[]}`;
}

function mkLlmFailOn(perspective: string): LlmQuery {
  return async (prompt) => {
    const lower = prompt.toLowerCase();
    if (lower.includes(`${perspective.toLowerCase()} perspective`)) {
      return `{"verdict":"fail","concerns":["missing thing"]}`;
    }
    return `{"verdict":"pass","concerns":[]}`;
  };
}

// ── parsePerspectiveResponse ─────────────────────────────────

describe("parsePerspectiveResponse", () => {
  it("parses clean JSON pass verdict", () => {
    const parsed = parsePerspectiveResponse(`{"verdict":"pass","concerns":[]}`);
    expect(parsed.verdict).toBe("pass");
    expect(parsed.concerns).toEqual([]);
  });

  it("parses clean JSON fail with concerns", () => {
    const parsed = parsePerspectiveResponse(
      `{"verdict":"fail","concerns":["null check missing","stale cache"]}`,
    );
    expect(parsed.verdict).toBe("fail");
    expect(parsed.concerns).toEqual(["null check missing", "stale cache"]);
  });

  it("parses JSON wrapped in prose", () => {
    const parsed = parsePerspectiveResponse(
      `Here is my verdict.\n{"verdict":"fail","concerns":["x"]}\nthanks`,
    );
    expect(parsed.verdict).toBe("fail");
    expect(parsed.concerns).toEqual(["x"]);
  });

  it("falls back to regex when JSON is malformed", () => {
    const parsed = parsePerspectiveResponse(`verdict: pass\nconcerns: [ "a", "b" ]`);
    expect(parsed.verdict).toBe("pass");
  });

  it("throws on empty input", () => {
    expect(() => parsePerspectiveResponse("")).toThrow();
  });

  it("throws on unparseable input", () => {
    expect(() => parsePerspectiveResponse("I think maybe yes")).toThrow();
  });
});

// ── PreCompletionVerifier ────────────────────────────────────

describe("PreCompletionVerifier", () => {
  it("rejects construction without llmQuery", () => {
    // @ts-expect-error exercising runtime guard
    expect(() => new PreCompletionVerifier({})).toThrow();
  });

  it("invokes all 4 perspectives in parallel", async () => {
    const seen: string[] = [];
    const llmQuery: LlmQuery = async (prompt) => {
      for (const p of PERSPECTIVES) {
        if (prompt.toLowerCase().includes(`${p} perspective`)) {
          seen.push(p);
          break;
        }
      }
      return `{"verdict":"pass","concerns":[]}`;
    };
    const verifier = new PreCompletionVerifier({ llmQuery });
    const report = await verifier.verify(SAMPLE_INPUT);

    expect(report.perspectives).toHaveLength(4);
    expect(new Set(seen)).toEqual(new Set(PERSPECTIVES));
    expect(report.status).toBe("pass");
    expect(report.implementer.status).toBe("pass");
    expect(report.reviewer.status).toBe("pass");
    expect(report.tester.status).toBe("pass");
    expect(report.user.status).toBe("pass");
  });

  it("produces overall fail when ANY perspective fails", async () => {
    const verifier = new PreCompletionVerifier({ llmQuery: mkLlmFailOn("reviewer") });
    const report = await verifier.verify(SAMPLE_INPUT);

    expect(report.status).toBe("fail");
    expect(report.reviewer.status).toBe("fail");
    expect(report.reviewer.concerns).toContain("missing thing");
    // Other perspectives still pass
    expect(report.implementer.status).toBe("pass");
    expect(report.tester.status).toBe("pass");
    expect(report.user.status).toBe("pass");
    // Aggregate concerns attributes the source
    expect(report.allConcerns).toContain("reviewer: missing thing");
  });

  it("captures LLM errors per-perspective without crashing others", async () => {
    const llmQuery: LlmQuery = async (prompt) => {
      if (prompt.toLowerCase().includes("tester perspective")) {
        throw new Error("provider rate limit");
      }
      return `{"verdict":"pass","concerns":[]}`;
    };
    const verifier = new PreCompletionVerifier({ llmQuery });
    const report = await verifier.verify(SAMPLE_INPUT);

    expect(report.tester.status).toBe("error");
    expect(report.tester.error).toContain("rate limit");
    // Others still ran
    expect(report.implementer.status).toBe("pass");
    expect(report.reviewer.status).toBe("pass");
    expect(report.user.status).toBe("pass");
    // Overall: no fail, no all-error — should be pass
    expect(report.status).toBe("pass");
  });

  it("overall status is 'error' when all 4 perspectives error", async () => {
    const llmQuery: LlmQuery = async () => {
      throw new Error("network down");
    };
    const verifier = new PreCompletionVerifier({ llmQuery });
    const report = await verifier.verify(SAMPLE_INPUT);

    expect(report.status).toBe("error");
    for (const p of report.perspectives) {
      expect(p.status).toBe("error");
      expect(p.error).toContain("network down");
    }
  });

  it("bypass mode skips all LLM calls and returns a pass", async () => {
    let callCount = 0;
    const llmQuery: LlmQuery = async () => {
      callCount += 1;
      return `{"verdict":"fail","concerns":["x"]}`; // would fail if called
    };
    const verifier = new PreCompletionVerifier({
      llmQuery,
      skipPreCompletionVerify: true,
    });
    const report = await verifier.verify(SAMPLE_INPUT);

    expect(callCount).toBe(0);
    expect(report.bypassed).toBe(true);
    expect(report.status).toBe("pass");
    expect(verifier.isBypassed()).toBe(true);
  });

  it("maintains per-instance isolation (no module-global accumulation)", async () => {
    const llmQuery = mkLlmPass();
    const a = new PreCompletionVerifier({ llmQuery });
    const b = new PreCompletionVerifier({ llmQuery });

    await a.verify(SAMPLE_INPUT);
    await a.verify(SAMPLE_INPUT);
    await b.verify(SAMPLE_INPUT);

    expect(a.getRunCount()).toBe(2);
    expect(b.getRunCount()).toBe(1);
  });

  it("concurrent verifications do not cross-contaminate", async () => {
    // Each LlmQuery response includes a unique tag per verifier instance.
    const mkTaggedQuery = (tag: string): LlmQuery => {
      return async () => `{"verdict":"pass","concerns":["tag:${tag}"]}`;
    };
    const vA = new PreCompletionVerifier({ llmQuery: mkTaggedQuery("A") });
    const vB = new PreCompletionVerifier({ llmQuery: mkTaggedQuery("B") });

    const [rA, rB] = await Promise.all([
      vA.verify(SAMPLE_INPUT),
      vB.verify(SAMPLE_INPUT),
    ]);

    for (const p of rA.perspectives) {
      expect(p.concerns).toEqual(["tag:A"]);
    }
    for (const p of rB.perspectives) {
      expect(p.concerns).toEqual(["tag:B"]);
    }
  });

  it("preserves structured concerns per perspective in the report", async () => {
    const llmQuery: LlmQuery = async (prompt) => {
      if (prompt.toLowerCase().includes("implementer perspective")) {
        return `{"verdict":"fail","concerns":["requirement A not addressed"]}`;
      }
      if (prompt.toLowerCase().includes("reviewer perspective")) {
        return `{"verdict":"fail","concerns":["null pointer risk"]}`;
      }
      return `{"verdict":"pass","concerns":[]}`;
    };
    const verifier = new PreCompletionVerifier({ llmQuery });
    const report = await verifier.verify(SAMPLE_INPUT);

    expect(report.status).toBe("fail");
    expect(report.implementer.concerns).toEqual(["requirement A not addressed"]);
    expect(report.reviewer.concerns).toEqual(["null pointer risk"]);
    expect(report.tester.concerns).toEqual([]);
    expect(report.user.concerns).toEqual([]);
    expect(report.allConcerns).toEqual(
      expect.arrayContaining([
        "implementer: requirement A not addressed",
        "reviewer: null pointer risk",
      ]),
    );
  });

  it("malformed provider response produces honest error, not silent pass", async () => {
    const llmQuery: LlmQuery = async () => "I cannot decide";
    const verifier = new PreCompletionVerifier({ llmQuery });
    const report = await verifier.verify(SAMPLE_INPUT);

    expect(report.status).toBe("error");
    for (const p of report.perspectives) {
      expect(p.status).toBe("error");
      expect(p.error).toContain("parse failure");
    }
  });

  it("includes optional context in perspective prompts when provided", async () => {
    const prompts: string[] = [];
    const llmQuery: LlmQuery = async (prompt) => {
      prompts.push(prompt);
      return `{"verdict":"pass","concerns":[]}`;
    };
    const verifier = new PreCompletionVerifier({ llmQuery });
    await verifier.verify({
      ...SAMPLE_INPUT,
      context: "modified files: routes.ts, routes.test.ts",
    });

    expect(prompts).toHaveLength(4);
    for (const p of prompts) {
      expect(p).toContain("ADDITIONAL CONTEXT:");
      expect(p).toContain("routes.ts, routes.test.ts");
    }
  });
});

// ── formatVerificationReport ─────────────────────────────────

describe("formatVerificationReport", () => {
  it("formats bypass report", async () => {
    const verifier = new PreCompletionVerifier({
      llmQuery: mkLlmPass(),
      skipPreCompletionVerify: true,
    });
    const report = await verifier.verify(SAMPLE_INPUT);
    expect(formatVerificationReport(report)).toContain("BYPASSED");
  });

  it("formats pass report", async () => {
    const verifier = new PreCompletionVerifier({ llmQuery: mkLlmPass() });
    const report = await verifier.verify(SAMPLE_INPUT);
    const out = formatVerificationReport(report);
    expect(out).toContain("PASS");
    expect(out).toContain("all 4 perspectives agree");
  });

  it("formats fail report listing each persona's concerns", async () => {
    const verifier = new PreCompletionVerifier({
      llmQuery: mkLlmFailOn("implementer"),
    });
    const report = await verifier.verify(SAMPLE_INPUT);
    const out = formatVerificationReport(report);
    expect(out).toContain("BLOCKED");
    expect(out).toContain("[FAIL] implementer");
    expect(out).toContain("missing thing");
    expect(out).toContain("[PASS] reviewer");
  });
});
