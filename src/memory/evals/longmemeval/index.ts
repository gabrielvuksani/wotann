/**
 * LongMemEval runner — barrel export.
 *
 * LongMemEval (Wu et al. ICLR 2025) benchmarks chat assistants on long-term
 * interactive memory. 500 questions across 5 abilities:
 *   1. Information extraction  (single-session questions)
 *   2. Multi-session reasoning (cross-session synthesis)
 *   3. Temporal reasoning      (time-aware queries)
 *   4. Knowledge updates       (facts that change over time)
 *   5. Abstention              (questions with no answer in the history)
 *
 * Published reference scores at the time of writing:
 *   - Naive long-context baseline: ~60% overall
 *   - Zep (agentic memory):        ~71% overall
 *   - GPT-4o w/ LongMemEval_Oracle: ~89% (oracle retrieval upper bound)
 *
 * WOTANN's memory stack scores against this benchmark give us an honest
 * public baseline. The runner ships two paths:
 *   - `memory-stack` (default): FTS5 retrieval only, no LLM. Rule-based
 *     scorer. Cheap, deterministic, gives a floor.
 *   - `runtime`: retrieval + runtime.query. Captures full-stack score
 *     once an LLM is wired in.
 *
 * See runner.ts for the flow, scorer.ts for the scoring rules (with LLM
 * judge replacement plug-in), and corpus.ts for the dataset loader with
 * `--skip-download` smoke fallback.
 */

export {
  loadLongMemEvalCorpus,
  abilityFor,
  LONGMEMEVAL_SMOKE_CORPUS,
  type LongMemEvalInstance,
  type LongMemEvalQuestionType,
  type LongMemEvalAbility,
  type LongMemEvalTurn,
  type LongMemEvalVariant,
  type LoadCorpusOptions,
} from "./corpus.js";

export {
  runLongMemEval,
  type RunnerRuntime,
  type RetrievalMode,
  type RunLongMemEvalOptions,
  type RunReport,
} from "./runner.js";

export {
  scoreLongMemEval,
  type Hypothesis,
  type ScoreResult,
  type AbilityBreakdown,
  type ScoreReport,
} from "./scorer.js";
