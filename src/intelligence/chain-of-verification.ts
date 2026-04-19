/**
 * Chain-of-Verification (CoVe) — Dhuliawala et al. 2023.
 *
 * CoVe reduces hallucinations by having the model self-verify its
 * answer via a structured 4-step protocol:
 *   1. Baseline answer (draft response)
 *   2. Plan verification questions (self-critique)
 *   3. Answer each verification question INDEPENDENTLY (fresh context)
 *   4. Revise the baseline using verification answers
 *
 * Measured on FEVER / Wiki-Facts: -50% hallucinations with minimal
 * quality regression. Best on long-form factual generation; marginal
 * on code generation.
 *
 * This module orchestrates the protocol. Caller supplies the LLM
 * query function.
 */

// ── Types ──────────────────────────────────────────────

export type LlmQuery = (
  prompt: string,
  options?: { readonly maxTokens?: number; readonly temperature?: number },
) => Promise<string>;

export interface CoVeConfig {
  readonly llmQuery: LlmQuery;
  /** Max verification questions to generate. Default 4. */
  readonly maxVerificationQuestions?: number;
  /** Temperature for verification answers (lower = more factual). Default 0. */
  readonly verificationTemperature?: number;
}

export interface VerificationRound {
  readonly question: string;
  readonly answer: string;
}

export interface CoVeResult {
  readonly baselineAnswer: string;
  readonly verificationQuestions: readonly string[];
  readonly verificationRounds: readonly VerificationRound[];
  readonly finalAnswer: string;
  readonly revisionNeeded: boolean;
}

// ── Core ───────────────────────────────────────────────

export async function chainOfVerification(
  userQuery: string,
  config: CoVeConfig,
): Promise<CoVeResult> {
  const maxQuestions = config.maxVerificationQuestions ?? 4;
  const verifyTemp = config.verificationTemperature ?? 0;

  // 1. Baseline answer
  const baselineAnswer = (await config.llmQuery(userQuery)).trim();

  // 2. Plan verification questions
  const qPrompt = `You just produced an answer to a question. Now LIST up to ${maxQuestions} verification questions that would check the factual claims in your answer. Each question should be specific and independently verifiable. Output one question per line, no numbering.

Question: ${userQuery}

Answer: ${baselineAnswer}

Verification questions:`;
  const qResponse = await config.llmQuery(qPrompt);
  const questions = parseQuestionList(qResponse).slice(0, maxQuestions);

  if (questions.length === 0) {
    return {
      baselineAnswer,
      verificationQuestions: [],
      verificationRounds: [],
      finalAnswer: baselineAnswer,
      revisionNeeded: false,
    };
  }

  // 3. Answer each verification question INDEPENDENTLY (no context leak)
  const verificationRounds: VerificationRound[] = [];
  for (const question of questions) {
    const answer = (
      await config.llmQuery(
        `Answer this fact-check question briefly and accurately:\n${question}`,
        {
          temperature: verifyTemp,
        },
      )
    ).trim();
    verificationRounds.push({ question, answer });
  }

  // 4. Revise baseline using verifications
  const verificationsText = verificationRounds
    .map((r, i) => `Q${i + 1}: ${r.question}\nA${i + 1}: ${r.answer}`)
    .join("\n\n");

  const revisionPrompt = `You drafted an answer to a user question. You then ran verification checks. Given the verification answers, produce a CORRECTED version of your answer that only includes claims supported by the verifications. If the baseline was already correct, output it unchanged.

User question: ${userQuery}

Baseline answer: ${baselineAnswer}

Verification checks:
${verificationsText}

Corrected answer:`;
  const finalAnswer = (await config.llmQuery(revisionPrompt)).trim();

  const revisionNeeded =
    finalAnswer.length > 0 &&
    normalizeForCompare(finalAnswer) !== normalizeForCompare(baselineAnswer);

  return {
    baselineAnswer,
    verificationQuestions: questions,
    verificationRounds,
    finalAnswer: finalAnswer || baselineAnswer,
    revisionNeeded,
  };
}

// ── Helpers ────────────────────────────────────────────

export function parseQuestionList(raw: string): readonly string[] {
  if (!raw) return [];
  // Strip preamble like "Verification questions:"
  const cleaned = raw.replace(/^.*?(verification questions:?|questions:)\s*/is, "");
  const lines = cleaned
    .split("\n")
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((l) => l.length > 0 && l.includes("?"));
  return lines;
}

function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
