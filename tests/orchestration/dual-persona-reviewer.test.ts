import { describe, it, expect } from "vitest";
import {
  aggregateVerdicts,
  buildCriticPrompt,
  buildDefenderPrompt,
  parsePersonaReply,
  runDualPersonaReview,
  DEFAULT_DUAL_PERSONA_CONFIG,
  type PersonaExecutor,
  type PersonaResponse,
} from "../../src/orchestration/dual-persona-reviewer.js";

function makeResp(overrides: Partial<PersonaResponse> = {}): PersonaResponse {
  return {
    verdict: "accept",
    confidence: 0.8,
    reasoning: "looks good",
    tokensUsed: 100,
    ...overrides,
  };
}

describe("dual-persona: buildCriticPrompt", () => {
  it("embeds artifact and instructions for the critic role", () => {
    const prompt = buildCriticPrompt("ARTIFACT_BODY", { phaseName: "Draft", phaseGoal: "write chapter" });
    expect(prompt).toMatch(/HARSH CRITIC/);
    expect(prompt).toMatch(/ARTIFACT_BODY/);
    expect(prompt).toMatch(/ISSUES:/);
    expect(prompt).toMatch(/VERDICT:/);
  });

  it("builds the defender prompt with STRENGTHS label", () => {
    const prompt = buildDefenderPrompt("ART", { phaseName: "N", phaseGoal: "G" });
    expect(prompt).toMatch(/DEFENDER/);
    expect(prompt).toMatch(/STRENGTHS:/);
  });
});

describe("dual-persona: parsePersonaReply", () => {
  it("parses a well-formed critic reply", () => {
    const reply = [
      "VERDICT: reject",
      "CONFIDENCE: 0.85",
      "ISSUES:",
      "- Missing section on X",
      "- Vague wording in paragraph 2",
      "REASONING: The artifact fails key requirements.",
    ].join("\n");
    const resp = parsePersonaReply(reply, "critic", 120);
    expect(resp.verdict).toBe("reject");
    expect(resp.confidence).toBeCloseTo(0.85);
    expect(resp.issues).toHaveLength(2);
    expect(resp.issues?.[0]).toBe("Missing section on X");
    expect(resp.reasoning).toMatch(/fails key requirements/);
  });

  it("parses a well-formed defender reply", () => {
    const reply = [
      "VERDICT: accept",
      "CONFIDENCE: 0.9",
      "STRENGTHS:",
      "- Clear structure",
      "- Strong evidence",
      "REASONING: Goals met.",
    ].join("\n");
    const resp = parsePersonaReply(reply, "defender", 80);
    expect(resp.verdict).toBe("accept");
    expect(resp.strengths).toEqual(["Clear structure", "Strong evidence"]);
  });

  it("clamps confidence to [0,1]", () => {
    const reply = "VERDICT: accept\nCONFIDENCE: 1.5\nREASONING: x";
    const resp = parsePersonaReply(reply, "critic", 10);
    expect(resp.confidence).toBe(1);
  });

  it("defaults to abstain on missing verdict", () => {
    const reply = "gibberish with no tags";
    const resp = parsePersonaReply(reply, "critic", 5);
    expect(resp.verdict).toBe("abstain");
    expect(resp.confidence).toBe(0.5);
  });
});

describe("dual-persona: aggregateVerdicts", () => {
  it("pass when both strongly accept", () => {
    const critic = makeResp({ verdict: "accept", confidence: 0.9 });
    const defender = makeResp({ verdict: "accept", confidence: 0.9 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("pass");
  });

  it("reject when both strongly reject", () => {
    const critic = makeResp({ verdict: "reject", confidence: 0.9 });
    const defender = makeResp({ verdict: "reject", confidence: 0.9 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("reject");
  });

  it("reject when critic strong-reject overrides weak defender accept", () => {
    const critic = makeResp({ verdict: "reject", confidence: 0.9 });
    const defender = makeResp({ verdict: "accept", confidence: 0.4 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("reject");
  });

  it("pass when defender strong-accept overrides weak critic reject", () => {
    const critic = makeResp({ verdict: "reject", confidence: 0.3 });
    const defender = makeResp({ verdict: "accept", confidence: 0.9 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("pass");
  });

  it("escalate when split with neither confident", () => {
    const critic = makeResp({ verdict: "reject", confidence: 0.4 });
    const defender = makeResp({ verdict: "accept", confidence: 0.4 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("escalate");
  });

  it("escalate when both abstain", () => {
    const critic = makeResp({ verdict: "abstain", confidence: 0.3 });
    const defender = makeResp({ verdict: "abstain", confidence: 0.3 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("escalate");
  });

  it("pass when critic abstains and defender strongly accepts", () => {
    const critic = makeResp({ verdict: "abstain", confidence: 0.3 });
    const defender = makeResp({ verdict: "accept", confidence: 0.9 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("pass");
  });

  it("reject when defender abstains and critic strongly rejects", () => {
    const critic = makeResp({ verdict: "reject", confidence: 0.9 });
    const defender = makeResp({ verdict: "abstain", confidence: 0.3 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("reject");
  });

  it("inverted split (critic accepts, defender rejects) → escalate", () => {
    const critic = makeResp({ verdict: "accept", confidence: 0.5 });
    const defender = makeResp({ verdict: "reject", confidence: 0.5 });
    const result = aggregateVerdicts(critic, defender);
    expect(result.outcome).toBe("escalate");
  });
});

describe("dual-persona: runDualPersonaReview (end-to-end mock)", () => {
  it("runs both personas in parallel and returns an aggregated verdict", async () => {
    const executor: PersonaExecutor = async (persona) => {
      return makeResp({
        verdict: persona === "critic" ? "reject" : "accept",
        confidence: 0.9,
        reasoning: `${persona} says so`,
      });
    };
    const verdict = await runDualPersonaReview(
      "artifact body",
      { phaseName: "P", phaseGoal: "G" },
      executor,
    );
    // Both sides strongly hold opposite verdicts → honest escalate (caller
    // bumps to stronger model next time). This is the autonovel contract:
    // don't let a tie silently pick a winner.
    expect(verdict.outcome).toBe("escalate");
    expect(verdict.critic.verdict).toBe("reject");
    expect(verdict.defender.verdict).toBe("accept");
    expect(verdict.totalTokens).toBeGreaterThan(0);
  });

  it("propagates executor timeouts as a rejected promise", async () => {
    const executor: PersonaExecutor = () =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve(
              makeResp({
                verdict: "accept",
                confidence: 0.9,
              }),
            ),
          5000,
        );
      });
    await expect(
      runDualPersonaReview(
        "artifact",
        { phaseName: "P", phaseGoal: "G" },
        executor,
        { ...DEFAULT_DUAL_PERSONA_CONFIG, timeoutMs: 50 },
      ),
    ).rejects.toThrow(/timed out/);
  });
});
