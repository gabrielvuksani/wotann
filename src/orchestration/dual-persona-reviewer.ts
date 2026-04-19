/**
 * Dual-Persona Reviewer — critic + defender aggregation.
 *
 * PART OF: long-horizon orchestrator (autonovel-style, Phase H+D).
 *
 * At each phase gate, the artifact is evaluated by two personas running on
 * the SAME cheap model but with different prompts:
 *
 *   - Critic  → "Find everything wrong with this artifact. Be harsh."
 *   - Defender → "Why is this artifact correct and sufficient? Defend it."
 *
 * Each persona returns a verdict (accept/reject) + confidence (0-1). The
 * aggregator decides:
 *
 *   - If critic rejects with HIGH confidence → phase rejected
 *   - If defender accepts with HIGH confidence → phase passes
 *   - If split (disagreement or both low-confidence) → escalate to stronger
 *     model for the next review (the caller implements escalation)
 *
 * This file owns NO LLM calls. The caller supplies an async `PersonaExecutor`
 * that runs one persona against the real provider. Keeping the I/O injected
 * makes the policy 100% testable with mock executors — no network, no
 * flakiness.
 */

// ── Types ──────────────────────────────────────────────

export type PersonaVerdict = "accept" | "reject" | "abstain";

export interface PersonaResponse {
  readonly verdict: PersonaVerdict;
  /** 0-1 confidence in the verdict. Higher = more sure. */
  readonly confidence: number;
  /** Short justification from the persona — shown to user, not parsed. */
  readonly reasoning: string;
  /** Issues the critic found (empty for defender). */
  readonly issues?: readonly string[];
  /** Strengths the defender cited (empty for critic). */
  readonly strengths?: readonly string[];
  /** Tokens consumed for this persona call (for budget tracking). */
  readonly tokensUsed: number;
}

export type ReviewOutcome =
  | "pass" // Defender wins with high confidence, phase exits.
  | "reject" // Critic wins with high confidence, phase iterates.
  | "escalate"; // Split decision — caller bumps to stronger model next time.

export interface DualPersonaVerdict {
  readonly outcome: ReviewOutcome;
  readonly critic: PersonaResponse;
  readonly defender: PersonaResponse;
  readonly reason: string;
  readonly totalTokens: number;
  readonly durationMs: number;
}

/**
 * The caller provides this. Given a persona kind and artifact, it returns the
 * persona's structured response. Typically implemented as:
 *
 *   const exec: PersonaExecutor = async (persona, artifact) => {
 *     const prompt = buildPersonaPrompt(persona, artifact);
 *     const reply  = await runtime.query(prompt, { model: "haiku" });
 *     return parsePersonaReply(reply);
 *   };
 *
 * This indirection keeps the reviewer pure + unit-testable.
 */
export type PersonaKind = "critic" | "defender";

export type PersonaExecutor = (
  persona: PersonaKind,
  artifact: string,
  context: {
    readonly phaseName: string;
    readonly phaseGoal: string;
  },
) => Promise<PersonaResponse>;

export interface DualPersonaConfig {
  /** Confidence threshold for "strong" verdict (default 0.7). */
  readonly strongConfidenceThreshold: number;
  /** Timeout per persona call (default 60s). */
  readonly timeoutMs: number;
}

export const DEFAULT_DUAL_PERSONA_CONFIG: DualPersonaConfig = {
  strongConfidenceThreshold: 0.7,
  timeoutMs: 60_000,
};

// ── Prompt Builders ────────────────────────────────────

/**
 * Build the prompt for a persona. The caller can override these, but the
 * defaults encode the autonovel pattern directly.
 *
 * CRITIC prompt: "Find everything wrong. Be harsh." Output format:
 *   VERDICT: reject|accept|abstain
 *   CONFIDENCE: 0.0-1.0
 *   ISSUES: - item1 / - item2 / ...
 *   REASONING: <1-2 sentences>
 *
 * DEFENDER prompt: "Why is this correct? Defend it." Same output format
 * but with STRENGTHS: instead of ISSUES:.
 */
export function buildCriticPrompt(
  artifact: string,
  context: { readonly phaseName: string; readonly phaseGoal: string },
): string {
  return [
    `You are a HARSH CRITIC evaluating an artifact from phase "${context.phaseName}".`,
    `The phase goal is: ${context.phaseGoal}`,
    "",
    "Your job is to find EVERY flaw — factual errors, missing requirements, vague wording,",
    "weak structure, inconsistent voice, logical gaps, or scope creep. Be specific, not polite.",
    "",
    "Respond in EXACTLY this format:",
    "VERDICT: <reject|accept|abstain>",
    "CONFIDENCE: <0.0-1.0>",
    "ISSUES:",
    "- <issue 1>",
    "- <issue 2>",
    "REASONING: <1-2 sentences summarizing your overall judgment>",
    "",
    "Artifact to evaluate:",
    "---",
    artifact.slice(0, 8000),
    "---",
  ].join("\n");
}

export function buildDefenderPrompt(
  artifact: string,
  context: { readonly phaseName: string; readonly phaseGoal: string },
): string {
  return [
    `You are a DEFENDER advocate for an artifact from phase "${context.phaseName}".`,
    `The phase goal is: ${context.phaseGoal}`,
    "",
    "Your job is to argue why this artifact is CORRECT and SUFFICIENT to exit the phase.",
    "Cite specific evidence, structural strengths, and goal-alignment. Do NOT ignore problems",
    "— but frame them in context (minor vs blocking). Only abstain if the artifact is clearly",
    "unfinished.",
    "",
    "Respond in EXACTLY this format:",
    "VERDICT: <accept|reject|abstain>",
    "CONFIDENCE: <0.0-1.0>",
    "STRENGTHS:",
    "- <strength 1>",
    "- <strength 2>",
    "REASONING: <1-2 sentences summarizing why this artifact passes>",
    "",
    "Artifact to evaluate:",
    "---",
    artifact.slice(0, 8000),
    "---",
  ].join("\n");
}

// ── Persona Response Parser ────────────────────────────

/**
 * Parse a free-form persona reply into structured response. Tolerant parser:
 * if fields are missing we default to abstain/0.5 so the aggregator can still
 * make a decision (vs throwing and blocking the whole phase).
 */
export function parsePersonaReply(
  reply: string,
  kind: PersonaKind,
  tokensUsed: number,
): PersonaResponse {
  const verdictMatch = reply.match(/VERDICT:\s*(accept|reject|abstain)/i);
  const confidenceMatch = reply.match(/CONFIDENCE:\s*([0-9]*\.?[0-9]+)/);
  const reasoningMatch = reply.match(/REASONING:\s*(.+?)(?:\n\n|$)/is);

  const bulletList = (label: string): string[] => {
    const sectionRe = new RegExp(`${label}:([\\s\\S]*?)(?=\\n[A-Z]+:|$)`, "i");
    const section = reply.match(sectionRe);
    if (!section?.[1]) return [];
    return section[1]
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-") || line.startsWith("*"))
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0);
  };

  const rawVerdict = verdictMatch?.[1]?.toLowerCase();
  const verdict: PersonaVerdict =
    rawVerdict === "accept" || rawVerdict === "reject" || rawVerdict === "abstain"
      ? rawVerdict
      : "abstain";

  let confidence = 0.5;
  if (confidenceMatch?.[1]) {
    const parsed = parseFloat(confidenceMatch[1]);
    if (Number.isFinite(parsed)) confidence = Math.min(1, Math.max(0, parsed));
  }

  const reasoning = reasoningMatch?.[1]?.trim() ?? "no reasoning extracted";

  const response: PersonaResponse = {
    verdict,
    confidence,
    reasoning,
    tokensUsed,
    ...(kind === "critic"
      ? { issues: bulletList("ISSUES") }
      : { strengths: bulletList("STRENGTHS") }),
  };
  return response;
}

// ── Aggregator ─────────────────────────────────────────

/**
 * Run the critic + defender in PARALLEL and aggregate their verdicts.
 *
 * Decision matrix (autonovel-style):
 *
 *          Defender
 *          accept             reject            abstain
 * Critic
 * accept   pass (both agree)  escalate (split)  pass (defender abstains)
 * reject   escalate (split)   reject (both     reject (defender gave up)
 *                             agree)
 * abstain  pass (critic       reject (critic   escalate (both unsure)
 *          silent)            silent)
 *
 * Confidence modulates each verdict: a high-confidence reject from the critic
 * outweighs a low-confidence accept from the defender (→ reject). A high-
 * confidence accept from the defender outweighs a low-confidence reject (→
 * pass). Split with neither confident → escalate.
 */
export async function runDualPersonaReview(
  artifact: string,
  context: { readonly phaseName: string; readonly phaseGoal: string },
  executor: PersonaExecutor,
  config: DualPersonaConfig = DEFAULT_DUAL_PERSONA_CONFIG,
): Promise<DualPersonaVerdict> {
  const startedAt = Date.now();

  // Run both in parallel — these are independent calls.
  const [criticRes, defenderRes] = await Promise.all([
    withTimeout(executor("critic", artifact, context), config.timeoutMs, "critic"),
    withTimeout(executor("defender", artifact, context), config.timeoutMs, "defender"),
  ]);

  const outcome = aggregateVerdicts(criticRes, defenderRes, config);

  return {
    outcome: outcome.outcome,
    critic: criticRes,
    defender: defenderRes,
    reason: outcome.reason,
    totalTokens: criticRes.tokensUsed + defenderRes.tokensUsed,
    durationMs: Date.now() - startedAt,
  };
}

interface AggregateResult {
  readonly outcome: ReviewOutcome;
  readonly reason: string;
}

/**
 * Pure verdict aggregation — exported for unit testing without any I/O.
 */
export function aggregateVerdicts(
  critic: PersonaResponse,
  defender: PersonaResponse,
  config: DualPersonaConfig = DEFAULT_DUAL_PERSONA_CONFIG,
): AggregateResult {
  const threshold = config.strongConfidenceThreshold;

  const criticStrongReject = critic.verdict === "reject" && critic.confidence >= threshold;
  const criticStrongAccept = critic.verdict === "accept" && critic.confidence >= threshold;
  const defenderStrongAccept = defender.verdict === "accept" && defender.confidence >= threshold;
  const defenderStrongReject = defender.verdict === "reject" && defender.confidence >= threshold;

  // Both agree with high confidence → their verdict wins.
  if (criticStrongReject && defenderStrongReject) {
    return { outcome: "reject", reason: "both personas strongly reject" };
  }
  if (criticStrongAccept && defenderStrongAccept) {
    return { outcome: "pass", reason: "both personas strongly accept" };
  }

  // Strong critic reject with weak defender → reject.
  if (criticStrongReject && !defenderStrongAccept) {
    return {
      outcome: "reject",
      reason: `critic reject (conf ${critic.confidence.toFixed(2)}) outweighs defender (conf ${defender.confidence.toFixed(2)})`,
    };
  }

  // Strong defender accept with weak critic → pass.
  if (defenderStrongAccept && !criticStrongReject) {
    return {
      outcome: "pass",
      reason: `defender accept (conf ${defender.confidence.toFixed(2)}) outweighs critic (conf ${critic.confidence.toFixed(2)})`,
    };
  }

  // Both abstain or both low confidence → escalate.
  if (critic.verdict === "abstain" && defender.verdict === "abstain") {
    return { outcome: "escalate", reason: "both personas abstained — need stronger model" };
  }

  // Direct disagreement neither side strong → escalate.
  if (critic.verdict === "reject" && defender.verdict === "accept") {
    return { outcome: "escalate", reason: "split verdict with neither side confident" };
  }
  if (critic.verdict === "accept" && defender.verdict === "reject") {
    return { outcome: "escalate", reason: "inverted split — critic accepts, defender rejects" };
  }

  // One side abstained — take the other at face value but tag as escalate
  // if that side was low confidence.
  if (critic.verdict === "abstain" && defender.verdict === "accept") {
    return defender.confidence >= threshold
      ? { outcome: "pass", reason: "defender accepts, critic abstains" }
      : { outcome: "escalate", reason: "defender weak accept, critic abstains" };
  }
  if (defender.verdict === "abstain" && critic.verdict === "reject") {
    return critic.confidence >= threshold
      ? { outcome: "reject", reason: "critic rejects, defender abstains" }
      : { outcome: "escalate", reason: "critic weak reject, defender abstains" };
  }
  if (critic.verdict === "abstain" && defender.verdict === "reject") {
    return { outcome: "reject", reason: "defender itself rejects, critic abstains" };
  }
  if (defender.verdict === "abstain" && critic.verdict === "accept") {
    return { outcome: "pass", reason: "critic accepts, defender abstains" };
  }

  // Unhandled combination — default to escalate (honest: we don't know).
  return {
    outcome: "escalate",
    reason: `unhandled verdict combination (critic=${critic.verdict}, defender=${defender.verdict})`,
  };
}

// ── Helpers ────────────────────────────────────────────

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`dual-persona ${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}
