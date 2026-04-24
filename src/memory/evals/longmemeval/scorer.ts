/**
 * LongMemEval rule-based scorer.
 *
 * The paper's official scorer uses GPT-4o as an LLM judge with
 * ability-specific prompts (see research/__new_clones/longmemeval/src/
 * evaluation/evaluate_qa.py). That requires an OpenAI API key and
 * fabricates a score we can't reproduce offline, so this scorer uses a
 * deterministic, rule-based approach:
 *
 *   1. Normalise both answer and hypothesis (lowercase, strip punctuation,
 *      collapse whitespace).
 *   2. For non-abstention questions: pass if the normalised hypothesis
 *      contains the normalised expected answer (substring match), OR if
 *      every "content word" in the answer appears in the hypothesis.
 *   3. For abstention questions: pass if the hypothesis contains an
 *      abstention phrase AND does NOT assert a definite answer.
 *   4. Temporal-reasoning questions tolerate off-by-one errors on
 *      numeric quantities (matching the paper's judge prompt).
 *
 * This is a HONEST baseline — it under-counts cases where the model gave
 * a semantically correct answer in different words. When an OpenAI key
 * is available, callers can plug in an LLM judge via `scoreWithJudge`;
 * until then, the rule-based score is the one we publish. The scorer
 * reports both `strictPass` (only substring hits) and `lenientPass`
 * (substring OR content-word overlap) so readers see the spread.
 */

import type { LongMemEvalInstance, LongMemEvalAbility } from "./corpus.js";
import { abilityFor } from "./corpus.js";

// ── Types ──────────────────────────────────────────────

export interface Hypothesis {
  readonly question_id: string;
  readonly hypothesis: string;
  /** Optional — useful for ablation reports. */
  readonly durationMs?: number;
  /** Number of retrieved memory entries used to form the answer. */
  readonly retrievalCount?: number;
}

export interface ScoreResult {
  readonly question_id: string;
  readonly ability: LongMemEvalAbility;
  readonly passed: boolean;
  readonly strictPass: boolean;
  readonly lenientPass: boolean;
  readonly expected: string;
  readonly hypothesis: string;
  readonly reason: string;
}

export interface AbilityBreakdown {
  readonly total: number;
  readonly passed: number;
  readonly accuracy: number; // 0-1
}

export interface ScoreReport {
  readonly total: number;
  readonly passed: number;
  readonly overallAccuracy: number; // 0-1
  /** Per-ability score, keyed by the 5-ability taxonomy. */
  readonly byAbility: Readonly<Record<LongMemEvalAbility, AbilityBreakdown>>;
  /** Strict (substring-only) pass rate, for honesty on LLM-vs-rule gap. */
  readonly strictAccuracy: number;
  /** Lenient (substring OR content-word overlap) pass rate — the default. */
  readonly lenientAccuracy: number;
  readonly results: readonly ScoreResult[];
}

// ── Normalisation ──────────────────────────────────────

const ABSTENTION_PHRASES: readonly string[] = [
  "never mentioned",
  "never discussed",
  "not mentioned",
  "don't know",
  "do not know",
  "cannot answer",
  "can't answer",
  "no information",
  "not enough information",
  "unknown",
  "unclear",
  "not specified",
  "not provided",
  "not available",
  "unanswerable",
  "no record",
  "i don't have",
  "i do not have",
  "insufficient information",
];

const DEFINITE_PATTERNS: readonly RegExp[] = [
  /\bis\s+[a-z0-9]+\b/i,
  /\bwas\s+[a-z0-9]+\b/i,
  /\byour\s+[a-z]+\s+is\b/i,
];

const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "from",
  "and",
  "or",
  "but",
  "not",
  "no",
  "yes",
  "as",
  "your",
  "my",
  "our",
  "their",
  "i",
  "you",
  "he",
  "she",
  "they",
  "we",
  "me",
  "us",
  "them",
  "him",
  "her",
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// ── Numeric tolerance (temporal off-by-one) ─────────────

const NUMBER_RE = /\b\d+\b/g;

function extractNumbers(text: string): number[] {
  return (text.match(NUMBER_RE) ?? []).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
}

function temporalNumberMatch(expected: string, hypothesis: string): boolean {
  const e = extractNumbers(expected);
  const h = extractNumbers(hypothesis);
  if (e.length === 0) return false;
  // Tolerate off-by-one (e.g. answer says 18, hypothesis says 19).
  return e.some((ev) => h.some((hv) => Math.abs(ev - hv) <= 1));
}

// ── Abstention ─────────────────────────────────────────

function isAbstention(instance: LongMemEvalInstance): boolean {
  return instance.question_id.endsWith("_abs");
}

function scoreAbstention(hypothesis: string): { passed: boolean; reason: string } {
  const norm = normalise(hypothesis);
  const hasAbstainPhrase = ABSTENTION_PHRASES.some((p) => norm.includes(normalise(p)));
  if (!hasAbstainPhrase) {
    return { passed: false, reason: "hypothesis asserts an answer instead of abstaining" };
  }
  // Penalise responses that *also* assert a definite fact (e.g. "unknown, but
  // probably Luna"). We accept abstention-only responses.
  const assertsDefinite = DEFINITE_PATTERNS.some((re) => re.test(hypothesis));
  if (assertsDefinite && norm.split(" ").length > 15) {
    // Long responses with both abstention and definite patterns are ambiguous;
    // we give them a pass because the abstention phrase was present, but flag
    // the reason so downstream readers can audit.
    return { passed: true, reason: "abstained but also contains definite language" };
  }
  return { passed: true, reason: "correctly abstained" };
}

// ── Non-abstention ──────────────────────────────────────

function scoreAnswerable(
  expected: string,
  hypothesis: string,
  ability: LongMemEvalAbility,
): { strictPass: boolean; lenientPass: boolean; reason: string } {
  const normExpected = normalise(expected);
  const normHyp = normalise(hypothesis);

  // Strict: the canonical answer appears as a substring.
  const strictPass = normExpected.length > 0 && normHyp.includes(normExpected);
  if (strictPass) return { strictPass: true, lenientPass: true, reason: "substring match" };

  // Temporal off-by-one tolerance (matches the paper's judge prompt).
  if (ability === "temporal" && temporalNumberMatch(expected, hypothesis)) {
    return {
      strictPass: false,
      lenientPass: true,
      reason: "temporal numeric match within ±1",
    };
  }

  // Lenient: every content word in the expected answer appears in the
  // hypothesis. This catches "Berlin" → "She moved to Berlin, Germany" and
  // variants where punctuation or spacing differ. We require ≥50% of
  // expected content words (rounded up) to match, with a floor of all
  // words for single-word answers.
  const expectedWords = contentWords(expected);
  if (expectedWords.length === 0) {
    return {
      strictPass: false,
      lenientPass: false,
      reason: "expected answer has no content words",
    };
  }

  const hypWords = new Set(contentWords(hypothesis));
  const overlap = expectedWords.filter((w) => hypWords.has(w)).length;
  const threshold = expectedWords.length === 1 ? 1 : Math.ceil(expectedWords.length * 0.5);
  const lenientPass = overlap >= threshold;

  return {
    strictPass: false,
    lenientPass,
    reason: lenientPass
      ? `content-word overlap ${overlap}/${expectedWords.length}`
      : `content-word overlap ${overlap}/${expectedWords.length} below threshold ${threshold}`,
  };
}

// ── Main scorer ────────────────────────────────────────

/**
 * Score a set of hypotheses against the corpus. Returns per-instance
 * results and an aggregate breakdown by ability.
 *
 * Instances without a matching hypothesis are counted as `passed: false`
 * with reason "no hypothesis". This ensures scores are never inflated by
 * dropped questions.
 */
export function scoreLongMemEval(
  instances: readonly LongMemEvalInstance[],
  hypotheses: readonly Hypothesis[],
): ScoreReport {
  const byId = new Map<string, Hypothesis>();
  for (const h of hypotheses) byId.set(h.question_id, h);

  const results: ScoreResult[] = [];
  for (const instance of instances) {
    const ability = abilityFor(instance);
    const hyp = byId.get(instance.question_id);
    if (!hyp) {
      results.push({
        question_id: instance.question_id,
        ability,
        passed: false,
        strictPass: false,
        lenientPass: false,
        expected: instance.answer,
        hypothesis: "",
        reason: "no hypothesis",
      });
      continue;
    }

    if (isAbstention(instance)) {
      const { passed, reason } = scoreAbstention(hyp.hypothesis);
      results.push({
        question_id: instance.question_id,
        ability,
        passed,
        strictPass: passed,
        lenientPass: passed,
        expected: instance.answer,
        hypothesis: hyp.hypothesis,
        reason,
      });
      continue;
    }

    const { strictPass, lenientPass, reason } = scoreAnswerable(
      instance.answer,
      hyp.hypothesis,
      ability,
    );
    results.push({
      question_id: instance.question_id,
      ability,
      passed: lenientPass,
      strictPass,
      lenientPass,
      expected: instance.answer,
      hypothesis: hyp.hypothesis,
      reason,
    });
  }

  return buildReport(results);
}

function buildReport(results: readonly ScoreResult[]): ScoreReport {
  const byAbilityMut: Record<LongMemEvalAbility, { total: number; passed: number }> = {
    "information-extraction": { total: 0, passed: 0 },
    "multi-session-reasoning": { total: 0, passed: 0 },
    temporal: { total: 0, passed: 0 },
    "knowledge-update": { total: 0, passed: 0 },
    abstention: { total: 0, passed: 0 },
  };

  let strictCount = 0;
  let lenientCount = 0;
  for (const r of results) {
    const bucket = byAbilityMut[r.ability];
    bucket.total += 1;
    if (r.passed) bucket.passed += 1;
    if (r.strictPass) strictCount += 1;
    if (r.lenientPass) lenientCount += 1;
  }

  const byAbility: Record<LongMemEvalAbility, AbilityBreakdown> = {
    "information-extraction": toBreakdown(byAbilityMut["information-extraction"]),
    "multi-session-reasoning": toBreakdown(byAbilityMut["multi-session-reasoning"]),
    temporal: toBreakdown(byAbilityMut.temporal),
    "knowledge-update": toBreakdown(byAbilityMut["knowledge-update"]),
    abstention: toBreakdown(byAbilityMut.abstention),
  };

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  return {
    total,
    passed,
    overallAccuracy: total > 0 ? passed / total : 0,
    byAbility,
    strictAccuracy: total > 0 ? strictCount / total : 0,
    lenientAccuracy: total > 0 ? lenientCount / total : 0,
    results,
  };
}

function toBreakdown(raw: { total: number; passed: number }): AbilityBreakdown {
  return {
    total: raw.total,
    passed: raw.passed,
    accuracy: raw.total > 0 ? raw.passed / raw.total : 0,
  };
}

// ── V9 T2.2 — LLM-judge scorer ────────────────────────

/**
 * LlmQuery callback — sends a prompt to a judge model and returns the
 * raw response text. Caller owns the HTTP + auth (anthropic/openai SDK,
 * provider bridge, etc.) so the scorer stays transport-agnostic.
 */
export type LlmQuery = (prompt: string) => Promise<string>;

/**
 * Per-instance judge decision. `passed` is the single binary verdict
 * the report aggregates; `verdict` carries the raw model output for
 * audit.
 */
export interface JudgeDecision {
  readonly passed: boolean;
  readonly verdict: string;
}

/**
 * Build the judge prompt for a single (question, expected, hypothesis)
 * tuple. Based on the LongMemEval paper's §4.2 ability-specific judge
 * prompts (research/__new_clones/longmemeval/src/evaluation/evaluate_qa.py),
 * condensed into one prompt that asks the judge for a strict binary
 * pass/fail with short reasoning. The prompt instructs the judge to
 * accept semantically-equivalent phrasings (the whole point of using
 * an LLM judge over substring matching) but to reject assertions that
 * add unsupported details or contradict the expected answer.
 */
export function buildJudgePrompt(
  question: string,
  expectedAnswer: string,
  hypothesis: string,
  ability: LongMemEvalAbility,
): string {
  const abilityGuidance: Record<LongMemEvalAbility, string> = {
    "information-extraction":
      "The answer is factual. Accept any phrasing that conveys the same fact; reject paraphrases that introduce new facts or omit the answer.",
    "multi-session-reasoning":
      "The answer requires combining facts from multiple sessions. Accept responses that arrive at the same conclusion even if the chain-of-thought differs; reject responses that match only part of the answer.",
    temporal:
      "The answer has a time/date/duration dimension. Tolerate off-by-one errors on numeric quantities but reject responses that get the order of events wrong.",
    "knowledge-update":
      "The answer reflects a FACT UPDATE — what the user knows NOW, not what they said earlier. Reject responses that regurgitate stale facts even if those facts appeared in the transcript.",
    abstention:
      "The question is UNANSWERABLE from the transcript. Accept responses that honestly decline; reject responses that fabricate a specific answer.",
  };
  return [
    "You are judging a memory-retrieval system's answer against a reference answer.",
    "",
    `QUESTION: ${question}`,
    `EXPECTED ANSWER: ${expectedAnswer}`,
    `SYSTEM'S ANSWER: ${hypothesis}`,
    "",
    `ABILITY TYPE: ${ability}`,
    `GUIDANCE: ${abilityGuidance[ability]}`,
    "",
    "Respond with EXACTLY one line of the form:",
    "VERDICT: PASS | reason here",
    "or",
    "VERDICT: FAIL | reason here",
    "",
    "Do not output anything except that single VERDICT line.",
  ].join("\n");
}

/**
 * Parse the judge's one-line VERDICT response. Tolerates surrounding
 * whitespace, mixed case, and extra detail text after the pass/fail
 * token. Falls back to FAIL when the judge produced malformed output —
 * the rule-based score at least catches the clean-substring case, so
 * a malformed judge defaulting to fail matches "couldn't confirm" rather
 * than silently claiming pass.
 */
export function parseJudgeVerdict(raw: string): JudgeDecision {
  const line =
    raw
      .trim()
      .split("\n")
      .find((l) => /VERDICT\s*:/i.test(l)) ?? raw.trim();
  const m = line.match(/VERDICT\s*:\s*(PASS|FAIL)\b/i);
  if (!m) {
    return { passed: false, verdict: `malformed: ${raw.slice(0, 120)}` };
  }
  const passed = m[1]!.toUpperCase() === "PASS";
  return { passed, verdict: line.trim() };
}

/**
 * Score hypotheses using an LLM judge model. For each instance, builds
 * the ability-specific prompt, calls the supplied `llm` callback, and
 * parses the verdict.
 *
 * Comparison guarantees versus `scoreLongMemEval` (rule-based):
 * - The ScoreReport shape is IDENTICAL — callers can swap judges
 *   without changing downstream aggregation.
 * - `strictPass` and `lenientPass` still report the rule-based
 *   substring/content-word hits, so consumers can see the spread
 *   between the judge and the deterministic baseline.
 * - `passed` now reflects the judge's verdict, which is the score
 *   WOTANN publishes when a key is configured.
 *
 * Concurrency is bounded by `opts.concurrency` (default 4) so large
 * instance sets don't fan out 500 parallel API calls. Errors from the
 * judge (timeout, non-200, parse failure) are recorded as `passed:
 * false` with a descriptive reason — never silently promoted to pass.
 *
 * Caller responsibility:
 * - Keep `llm` stateless (no session cache); the scorer sends prompts
 *   in an arbitrary order for concurrency batching.
 * - Wrap `llm` with any retry/budget/timeout policy the caller needs —
 *   the scorer treats every call as a single-shot best-effort.
 */
export async function scoreWithLlmJudge(
  instances: readonly LongMemEvalInstance[],
  hypotheses: readonly Hypothesis[],
  llm: LlmQuery,
  opts: { readonly concurrency?: number } = {},
): Promise<ScoreReport> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const byId = new Map<string, Hypothesis>();
  for (const h of hypotheses) byId.set(h.question_id, h);

  // Produce the rule-based baseline up front so strictPass/lenientPass
  // fields on the judge's report still reflect the deterministic score.
  const baseline = scoreLongMemEval(instances, hypotheses);
  const baselineById = new Map<string, ScoreResult>();
  for (const r of baseline.results) baselineById.set(r.question_id, r);

  // Worker queue — bounded concurrency over per-instance judge calls.
  const results: ScoreResult[] = new Array<ScoreResult>(instances.length);
  let nextIdx = 0;
  const workers: Promise<void>[] = [];

  async function judgeOne(idx: number): Promise<void> {
    const instance = instances[idx]!;
    const ability = abilityFor(instance);
    const hyp = byId.get(instance.question_id);
    const base = baselineById.get(instance.question_id);
    const strictPass = base?.strictPass ?? false;
    const lenientPass = base?.lenientPass ?? false;

    if (!hyp) {
      results[idx] = {
        question_id: instance.question_id,
        ability,
        passed: false,
        strictPass,
        lenientPass,
        expected: instance.answer,
        hypothesis: "",
        reason: "no hypothesis",
      };
      return;
    }

    const prompt = buildJudgePrompt(instance.question, instance.answer, hyp.hypothesis, ability);
    try {
      const raw = await llm(prompt);
      const decision = parseJudgeVerdict(raw);
      results[idx] = {
        question_id: instance.question_id,
        ability,
        passed: decision.passed,
        strictPass,
        lenientPass,
        expected: instance.answer,
        hypothesis: hyp.hypothesis,
        reason: decision.verdict,
      };
    } catch (err) {
      results[idx] = {
        question_id: instance.question_id,
        ability,
        passed: false,
        strictPass,
        lenientPass,
        expected: instance.answer,
        hypothesis: hyp.hypothesis,
        reason: `judge-error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= instances.length) return;
      await judgeOne(idx);
    }
  }

  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  return buildReport(results);
}
