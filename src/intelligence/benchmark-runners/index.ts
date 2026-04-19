/**
 * Benchmark-runners barrel — single import surface for the harness + CLI.
 *
 * Consumers should import the runners + types through this barrel rather
 * than reaching into individual modules. Shared primitives (BlockedCorpusError,
 * DryRunReport, TaskScoreEnvelope) are re-exported so callers never need
 * a second import.
 */

export {
  BlockedCorpusError,
  isBlockedCorpusError,
  type DryRunReport,
  type DryRunCheck,
  type TaskScoreEnvelope,
  type TrajectoryWriter,
  makeDryRunReport,
  openTrajectoryWriter,
  trajectoryPathForRun,
  seededShuffle,
} from "./shared.js";

// TerminalBench
export {
  runTerminalBench,
  loadTerminalBenchTasks,
  dryRunTerminalBench,
  TERMINAL_BENCH_PARITY_PASS_AT_1,
  type TerminalBenchTask,
  type TerminalBenchTaskResult,
  type TerminalBenchReport,
  type RunTerminalBenchOptions,
  type RunnerRuntime as TerminalBenchRunnerRuntime,
} from "./terminal-bench.js";

// SWE-bench Verified
export {
  runSweBench,
  loadSweBenchTasks,
  dryRunSweBench,
  SWE_BENCH_PARITY_PASS_AT_1,
  type SweBenchTask,
  type SweBenchTaskResult,
  type SweBenchReport,
  type RunSweBenchOptions,
  type RunnerRuntime as SweBenchRunnerRuntime,
} from "./swe-bench.js";

// τ-bench
export {
  runTauBench,
  loadTauBenchTasks,
  dryRunTauBench,
  type TauBenchTask,
  type TauBenchTaskResult,
  type TauBenchReport,
  type TauBenchDomain,
  type RunTauBenchOptions,
  type RunnerRuntime as TauBenchRunnerRuntime,
} from "./tau-bench.js";

// Aider Polyglot
export {
  runAiderPolyglot,
  loadAiderPolyglotTasks,
  dryRunAiderPolyglot,
  AIDER_POLYGLOT_PARITY_PASS_AT_2,
  AIDER_POLYGLOT_FULL_CORPUS_SIZE,
  type AiderPolyglotTask,
  type AiderPolyglotTaskResult,
  type AiderPolyglotReport,
  type AiderLanguage,
  type RunAiderPolyglotOptions,
  type RunnerRuntime as AiderRunnerRuntime,
} from "./aider-polyglot.js";

// Code-eval (HumanEval+/MBPP+/LiveCodeBench)
export {
  runCodeEval,
  loadCodeEvalTasks,
  dryRunCodeEval,
  type CodeEvalTask,
  type CodeEvalTaskResult,
  type CodeEvalReport,
  type CodeEvalFlavour,
  type ContaminationRisk,
  type RunCodeEvalOptions,
  type RunnerRuntime as CodeEvalRunnerRuntime,
} from "./code-eval.js";
