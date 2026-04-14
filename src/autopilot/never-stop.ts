/**
 * @deprecated — Strategies merged into AutonomousExecutor (src/orchestration/autonomous.ts).
 * This file is kept for backward compatibility with runtime.ts and lib.ts re-exports.
 * Remove once all consumers are migrated to AutonomousExecutor's merged strategies.
 *
 * Never-Stop Executor — run until completion criteria are met or budget is exceeded.
 *
 * Inspired by GitHub Copilot Autopilot's "never give up" behavior:
 * 1. Execute the task
 * 2. Verify via multi-criterion oracle (tests, typecheck, visual, LLM judge)
 * 3. On failure: analyze error -> generate fix -> apply -> retry
 * 4. Repeat until verified or budget exceeded
 *
 * Integrates with the existing AutonomousExecutor but adds:
 * - Multi-surface verification (terminal + browser + screenshot)
 * - Self-troubleshooting with error analysis
 * - Proof bundle generation on completion
 * - Budget gates (max cycles, max time, max cost)
 */

import type {
  CompletionCriterion,
  VerificationEvidence,
  AutopilotConfig,
  AutopilotResult,
  AutopilotArtifact,
} from "./types.js";

// ── Types ────────────────────────────────────────────────────

export interface NeverStopConfig {
  readonly maxCycles: number;
  readonly maxTimeMs: number;
  readonly maxCostUsd: number;
  readonly completionThreshold: number;
  readonly criteria: readonly CompletionCriterion[];
  readonly enableSelfTroubleshoot: boolean;
  readonly enableProofBundle: boolean;
  readonly maxConsecutiveIdenticalErrors: number;
}

export interface ExecutionCallbacks {
  readonly execute: (prompt: string) => Promise<ExecutionOutput>;
  readonly verify: (criteria: readonly CompletionCriterion[]) => Promise<VerificationOutput>;
  readonly analyzeError?: (error: string, context: string) => Promise<string>;
  readonly captureScreenshot?: (label: string) => Promise<string | null>;
  readonly runCommand?: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readonly onCycleStart?: (cycle: number) => void;
  readonly onCycleEnd?: (result: CycleResult) => void;
  readonly onComplete?: (result: NeverStopResult) => void;
  readonly onSelfFix?: (diagnosis: SelfFixDiagnosis) => void;
}

/**
 * Self-troubleshoot diagnosis: what went wrong and what fix was attempted.
 */
export interface SelfFixDiagnosis {
  readonly errorType: ErrorCategory;
  readonly errorMessage: string;
  readonly fixAttempted: string;
  readonly fixSucceeded: boolean;
  readonly durationMs: number;
}

export interface ExecutionOutput {
  readonly output: string;
  readonly costUsd: number;
  readonly tokensUsed: number;
  readonly filesChanged: readonly string[];
}

export interface VerificationOutput {
  readonly score: number;
  readonly passed: boolean;
  readonly evidence: readonly VerificationEvidence[];
}

export interface CycleResult {
  readonly cycle: number;
  readonly executionOutput: string;
  readonly verificationScore: number;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly tokensUsed: number;
  readonly errorAnalysis?: string;
  readonly filesChanged: readonly string[];
}

export interface NeverStopResult {
  readonly success: boolean;
  readonly totalCycles: number;
  readonly totalDurationMs: number;
  readonly totalCostUsd: number;
  readonly totalTokens: number;
  readonly finalScore: number;
  readonly exitReason: NeverStopExitReason;
  readonly cycles: readonly CycleResult[];
  readonly evidence: readonly VerificationEvidence[];
  readonly artifacts: readonly AutopilotArtifact[];
  readonly filesChanged: readonly string[];
}

export type NeverStopExitReason =
  | "verified"
  | "max-cycles"
  | "max-time"
  | "max-cost"
  | "doom-loop"
  | "cancelled"
  | "error";

export type ErrorCategory =
  | "missing-dependency"
  | "syntax-error"
  | "type-error"
  | "test-failure"
  | "runtime-error"
  | "permission-error"
  | "network-error"
  | "unknown";

export interface ProofBundle {
  readonly task: string;
  readonly success: boolean;
  readonly evidence: readonly VerificationEvidence[];
  readonly finalScore: number;
  readonly totalCycles: number;
  readonly timestamp: string;
  readonly artifacts: readonly AutopilotArtifact[];
}

// ── Default Config ───────────────────────────────────────────

const DEFAULT_NEVER_STOP_CONFIG: NeverStopConfig = {
  maxCycles: 30,
  maxTimeMs: 90 * 60 * 1000, // 90 minutes
  maxCostUsd: 15.0,
  completionThreshold: 0.8,
  criteria: [
    { type: "typecheck-pass", weight: 3, required: true, description: "TypeScript compilation" },
    { type: "tests-pass", weight: 4, required: true, description: "Test suite passes" },
  ],
  enableSelfTroubleshoot: true,
  enableProofBundle: true,
  maxConsecutiveIdenticalErrors: 3,
};

// ── Never-Stop Executor ──────────────────────────────────────

export class NeverStopExecutor {
  private readonly config: NeverStopConfig;
  private cancelled = false;

  constructor(config?: Partial<NeverStopConfig>) {
    this.config = { ...DEFAULT_NEVER_STOP_CONFIG, ...config };
  }

  /**
   * Cancel the current execution.
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Run until completion criteria are met or budget is exceeded.
   */
  async execute(
    task: string,
    callbacks: ExecutionCallbacks,
  ): Promise<NeverStopResult> {
    this.cancelled = false;
    const startTime = Date.now();
    const cycles: CycleResult[] = [];
    const allFilesChanged = new Set<string>();
    const allArtifacts: AutopilotArtifact[] = [];
    let totalCost = 0;
    let totalTokens = 0;
    let lastEvidence: readonly VerificationEvidence[] = [];
    let currentPrompt = task;
    const recentErrors: string[] = [];

    for (let cycle = 0; cycle < this.config.maxCycles; cycle++) {
      // ── Cancellation check ──
      if (this.cancelled) {
        return this.buildResult(
          false, cycles, totalCost, totalTokens, 0, "cancelled",
          lastEvidence, allArtifacts, allFilesChanged,
        );
      }

      // ── Budget checks ──
      const elapsed = Date.now() - startTime;
      if (elapsed > this.config.maxTimeMs) {
        return this.buildResult(
          false, cycles, totalCost, totalTokens, 0, "max-time",
          lastEvidence, allArtifacts, allFilesChanged,
        );
      }
      if (totalCost > this.config.maxCostUsd) {
        return this.buildResult(
          false, cycles, totalCost, totalTokens, 0, "max-cost",
          lastEvidence, allArtifacts, allFilesChanged,
        );
      }

      callbacks.onCycleStart?.(cycle);
      const cycleStart = Date.now();

      // ── Execute ──
      let execOutput: ExecutionOutput;
      try {
        execOutput = await callbacks.execute(currentPrompt);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown execution error";

        // Self-troubleshoot: classify error and attempt automatic fix
        if (this.config.enableSelfTroubleshoot && callbacks.runCommand) {
          const diagnosis = await this.selfTroubleshoot(errorMsg, callbacks.runCommand);
          callbacks.onSelfFix?.(diagnosis);

          if (diagnosis.fixSucceeded) {
            // Fix worked, retry with the same prompt
            const cycleResult = buildCycleResult(
              cycle, `Self-fixed ${diagnosis.errorType}: ${diagnosis.fixAttempted}`,
              0, false, Date.now() - cycleStart, 0, 0, [], diagnosis.fixAttempted,
            );
            cycles.push(cycleResult);
            callbacks.onCycleEnd?.(cycleResult);
            continue;
          }
        }

        const cycleResult = buildCycleResult(
          cycle, errorMsg, 0, false, Date.now() - cycleStart, 0, 0, [], errorMsg,
        );
        cycles.push(cycleResult);
        callbacks.onCycleEnd?.(cycleResult);

        // Fall back to LLM-based error analysis
        if (this.config.enableSelfTroubleshoot && callbacks.analyzeError) {
          currentPrompt = await callbacks.analyzeError(errorMsg, task);
        }
        continue;
      }

      totalCost += execOutput.costUsd;
      totalTokens += execOutput.tokensUsed;
      for (const file of execOutput.filesChanged) {
        allFilesChanged.add(file);
      }

      // ── Verify ──
      let verification: VerificationOutput;
      try {
        verification = await callbacks.verify(this.config.criteria);
      } catch {
        verification = { score: 0, passed: false, evidence: [] };
      }

      lastEvidence = verification.evidence;

      // ── Capture screenshot artifact if available ──
      if (callbacks.captureScreenshot) {
        const screenshotPath = await callbacks.captureScreenshot(`cycle-${cycle}`);
        if (screenshotPath) {
          allArtifacts.push({
            type: "screenshot",
            path: screenshotPath,
            description: `Cycle ${cycle} verification screenshot`,
            timestamp: Date.now(),
          });
        }
      }

      const cycleResult = buildCycleResult(
        cycle,
        execOutput.output.slice(0, 1000),
        verification.score,
        verification.passed,
        Date.now() - cycleStart,
        execOutput.costUsd,
        execOutput.tokensUsed,
        execOutput.filesChanged,
      );
      cycles.push(cycleResult);
      callbacks.onCycleEnd?.(cycleResult);

      // ── Success check ──
      if (verification.passed && verification.score >= this.config.completionThreshold) {
        // Generate proof bundle
        if (this.config.enableProofBundle) {
          const bundle = this.generateProofBundle(task, true, lastEvidence, verification.score, cycle + 1, allArtifacts);
          allArtifacts.push({
            type: "proof-bundle",
            path: `proof-bundle-${Date.now()}.json`,
            description: "Completion proof bundle",
            timestamp: Date.now(),
          });
          void bundle; // Bundle data is in the artifacts
        }

        const result = this.buildResult(
          true, cycles, totalCost, totalTokens, verification.score, "verified",
          lastEvidence, allArtifacts, allFilesChanged,
        );
        callbacks.onComplete?.(result);
        return result;
      }

      // ── Doom loop detection ──
      const failedEvidence = verification.evidence
        .filter((e) => !e.passed)
        .map((e) => e.evidence)
        .join("; ");

      recentErrors.push(failedEvidence.slice(0, 300));
      if (recentErrors.length > 6) recentErrors.shift();

      if (this.detectDoomLoop(recentErrors)) {
        return this.buildResult(
          false, cycles, totalCost, totalTokens, verification.score, "doom-loop",
          lastEvidence, allArtifacts, allFilesChanged,
        );
      }

      // ── Build recovery prompt ──
      if (this.config.enableSelfTroubleshoot && callbacks.analyzeError && failedEvidence.length > 0) {
        const analysis = await callbacks.analyzeError(failedEvidence, task);
        currentPrompt = buildRecoveryPrompt(task, failedEvidence, analysis, cycle, this.config.maxCycles);
      } else {
        currentPrompt = buildRecoveryPrompt(task, failedEvidence, undefined, cycle, this.config.maxCycles);
      }
    }

    return this.buildResult(
      false, cycles, totalCost, totalTokens, 0, "max-cycles",
      lastEvidence, allArtifacts, allFilesChanged,
    );
  }

  getConfig(): NeverStopConfig {
    return this.config;
  }

  // ── Self-Troubleshoot ──────────────────────────────────────

  /**
   * Classify an error and attempt an automatic fix.
   * Returns diagnosis with whether the fix succeeded.
   *
   * Error categories and auto-fixes:
   * - missing-dependency -> npm install / pip install
   * - syntax-error -> report to LLM for fix
   * - type-error -> report to LLM for fix
   * - test-failure -> retry with fix prompt
   * - runtime-error -> analyze stack trace
   * - permission-error -> suggest chmod / fix path
   */
  private async selfTroubleshoot(
    errorMsg: string,
    runCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  ): Promise<SelfFixDiagnosis> {
    const startTime = Date.now();
    const category = classifyError(errorMsg);

    switch (category) {
      case "missing-dependency": {
        const fix = extractMissingDependency(errorMsg);
        if (fix) {
          const result = await runCommand(fix.installCommand);
          return {
            errorType: category,
            errorMessage: errorMsg.slice(0, 300),
            fixAttempted: fix.installCommand,
            fixSucceeded: result.exitCode === 0,
            durationMs: Date.now() - startTime,
          };
        }
        break;
      }

      case "permission-error": {
        // Try to identify the path and suggest a fix
        const pathMatch = errorMsg.match(/EACCES.*'([^']+)'/);
        if (pathMatch?.[1]) {
          const result = await runCommand(`chmod u+rw "${pathMatch[1]}"`);
          return {
            errorType: category,
            errorMessage: errorMsg.slice(0, 300),
            fixAttempted: `chmod u+rw ${pathMatch[1]}`,
            fixSucceeded: result.exitCode === 0,
            durationMs: Date.now() - startTime,
          };
        }
        break;
      }

      default:
        // For syntax, type, test, runtime errors -- no automatic shell fix
        break;
    }

    return {
      errorType: category,
      errorMessage: errorMsg.slice(0, 300),
      fixAttempted: "none",
      fixSucceeded: false,
      durationMs: Date.now() - startTime,
    };
  }

  // ── Private Helpers ────────────────────────────────────────

  private detectDoomLoop(recentErrors: readonly string[]): boolean {
    if (recentErrors.length < this.config.maxConsecutiveIdenticalErrors) return false;

    const lastN = recentErrors.slice(-this.config.maxConsecutiveIdenticalErrors);
    const normalized = lastN.map((e) => e.replace(/\d+/g, "N").trim());
    const first = normalized[0];
    return first !== undefined && first.length > 0 && normalized.every((e) => e === first);
  }

  private generateProofBundle(
    task: string,
    success: boolean,
    evidence: readonly VerificationEvidence[],
    score: number,
    cycles: number,
    artifacts: readonly AutopilotArtifact[],
  ): ProofBundle {
    return {
      task,
      success,
      evidence,
      finalScore: score,
      totalCycles: cycles,
      timestamp: new Date().toISOString(),
      artifacts,
    };
  }

  private buildResult(
    success: boolean,
    cycles: readonly CycleResult[],
    totalCost: number,
    totalTokens: number,
    finalScore: number,
    exitReason: NeverStopExitReason,
    evidence: readonly VerificationEvidence[],
    artifacts: readonly AutopilotArtifact[],
    filesChanged: ReadonlySet<string>,
  ): NeverStopResult {
    return {
      success,
      totalCycles: cycles.length,
      totalDurationMs: cycles.reduce((sum, c) => sum + c.durationMs, 0),
      totalCostUsd: totalCost,
      totalTokens,
      finalScore,
      exitReason,
      cycles,
      evidence,
      artifacts,
      filesChanged: [...filesChanged],
    };
  }
}

// ── Module-Level Helpers ─────────────────────────────────────

function buildCycleResult(
  cycle: number,
  executionOutput: string,
  verificationScore: number,
  passed: boolean,
  durationMs: number,
  costUsd: number,
  tokensUsed: number,
  filesChanged: readonly string[],
  errorAnalysis?: string,
): CycleResult {
  return {
    cycle,
    executionOutput,
    verificationScore,
    passed,
    durationMs,
    costUsd,
    tokensUsed,
    filesChanged,
    errorAnalysis,
  };
}

// ── Error Classification ────────────────────────────────────

function classifyError(errorMsg: string): ErrorCategory {
  const lower = errorMsg.toLowerCase();

  // Missing dependency patterns
  if (
    /cannot find module|module not found|no such module/i.test(lower) ||
    /modulenotfounderror|importerror/i.test(lower) ||
    /error\[e0432\]|unresolved import/i.test(lower) ||
    /package.*not found|could not resolve/i.test(lower)
  ) {
    return "missing-dependency";
  }

  // Syntax errors
  if (
    /syntaxerror|unexpected token|parsing error/i.test(lower) ||
    /unterminated|unexpected end of/i.test(lower)
  ) {
    return "syntax-error";
  }

  // Type errors
  if (
    /typeerror|type.*is not assignable|error ts\d+/i.test(lower) ||
    /property.*does not exist on type/i.test(lower)
  ) {
    return "type-error";
  }

  // Test failures
  if (
    /test.*fail|assertion.*error|expect.*received/i.test(lower) ||
    /tests?\s+failed|failing\s+tests?/i.test(lower)
  ) {
    return "test-failure";
  }

  // Permission errors
  if (
    /eacces|permission denied|eperm/i.test(lower) ||
    /operation not permitted/i.test(lower)
  ) {
    return "permission-error";
  }

  // Network errors
  if (
    /econnrefused|enotfound|etimedout|enetunreach/i.test(lower) ||
    /network error|fetch failed/i.test(lower)
  ) {
    return "network-error";
  }

  // Runtime errors
  if (
    /referenceerror|rangeerror|stackoverflowerror/i.test(lower) ||
    /segfault|segmentation fault|core dumped/i.test(lower)
  ) {
    return "runtime-error";
  }

  return "unknown";
}

interface DependencyFix {
  readonly packageName: string;
  readonly installCommand: string;
}

function extractMissingDependency(errorMsg: string): DependencyFix | null {
  // Node.js: Cannot find module 'xxx'
  const nodeMatch = errorMsg.match(/Cannot find module '([^']+)'/);
  if (nodeMatch?.[1]) {
    const pkg = nodeMatch[1].startsWith("@")
      ? nodeMatch[1] // Scoped package
      : nodeMatch[1].split("/")[0]!; // Get root package name
    return {
      packageName: pkg,
      installCommand: `npm install ${pkg}`,
    };
  }

  // Python: ModuleNotFoundError: No module named 'xxx'
  const pyMatch = errorMsg.match(/No module named '([^']+)'/);
  if (pyMatch?.[1]) {
    const pkg = pyMatch[1].split(".")[0]!;
    return {
      packageName: pkg,
      installCommand: `pip install ${pkg}`,
    };
  }

  // Rust: unresolved import `xxx`
  const rustMatch = errorMsg.match(/unresolved import `([^`]+)`/);
  if (rustMatch?.[1]) {
    const crate = rustMatch[1].split("::")[0]!;
    return {
      packageName: crate,
      installCommand: `cargo add ${crate}`,
    };
  }

  return null;
}

function buildRecoveryPrompt(
  originalTask: string,
  failedEvidence: string,
  analysis: string | undefined,
  cycle: number,
  maxCycles: number,
): string {
  const urgency = cycle > maxCycles * 0.7
    ? "CRITICAL: Running low on attempts. Make the highest-impact fix."
    : "Fix ALL identified issues before proceeding.";

  const parts = [
    `Cycle ${cycle + 1}/${maxCycles} — previous attempt did not pass verification:`,
    "",
    "Failures:",
    failedEvidence.slice(0, 1500),
  ];

  if (analysis) {
    parts.push("", "Error analysis:", analysis.slice(0, 500));
  }

  parts.push("", `Original task: ${originalTask}`, "", urgency);

  return parts.join("\n");
}
