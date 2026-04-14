/**
 * Autonomous Mode — a true "fire and forget" execution engine.
 *
 * ARCHITECTURE:
 * - Heartbeat watchdog: detects stale/stuck agent (no output for N seconds)
 * - Error recovery: on failure, captures error context, revises prompt, retries
 * - Provider fallback: on rate limit, automatically switches providers via AgentBridge
 * - DoomLoop detection: catches identical outputs AND repeating pattern sequences
 * - Mode cycling: enters/exits like plan mode or bypass mode (Ctrl+A toggle)
 * - Budget controls: max cycles, max time, max cost — hard cutoffs
 * - Pre/post cycle hooks: integrates with the hook engine for extensibility
 * - Context management: detects context pressure, auto-compacts when needed
 * - Self-verification: runs tests/typecheck/lint after each code-changing cycle
 * - Strategy escalation: progressively changes approach after failures
 * - Screen awareness: can use computer-use to verify visual outcomes
 * - Checkpoint saves: saves progress to disk so work survives crashes
 * - Intelligent first-strategy: analyzes task to pick optimal starting strategy
 * - Multi-model verification: uses a different model to review autonomous work
 * - Enhanced doom-loop: detects error repetition, file edit cycling, circular imports
 * - Shadow git: commits after each passing cycle for safe revert
 *
 * EXIT CONDITIONS (in priority order):
 * 1. All tests + typecheck pass → SUCCESS
 * 2. DoomLoop detected 3x → FAIL (loop)
 * 3. Cost budget exceeded → FAIL (cost)
 * 4. Time budget exceeded → FAIL (time)
 * 5. Max cycles reached → FAIL (cycles)
 * 6. Heartbeat timeout 3x → FAIL (stale)
 * 7. Unrecoverable error → FAIL (error)
 * 8. User cancellation → FAIL (cancelled)
 */

import {
  OracleWorkerPolicy,
  type EscalationReason,
  type OracleConsultation,
  type OracleResponse,
} from "../autopilot/oracle-worker.js";

export interface AutonomousConfig {
  readonly maxCycles: number;
  readonly maxTimeMs: number;
  readonly maxCostUsd: number;
  readonly runTests: boolean;
  readonly runTypecheck: boolean;
  readonly runLint: boolean;
  readonly commitOnSuccess: boolean;
  /** Heartbeat timeout: if no output for this long, consider the agent stale */
  readonly heartbeatTimeoutMs: number;
  /** Max consecutive heartbeat failures before aborting */
  readonly maxHeartbeatFailures: number;
  /** Strategy escalation: after N failures, change approach */
  readonly escalateAfterFailures: number;
  /** Context pressure threshold (0-1): auto-compact when context usage exceeds this */
  readonly contextPressureThreshold: number;
  /** Enable screen-based verification for visual tasks */
  readonly enableScreenVerification: boolean;
  /** Save checkpoints to disk for crash recovery */
  readonly enableCheckpoints: boolean;
  /** Checkpoint directory */
  readonly checkpointDir: string;
  /** Enable intelligent first-strategy selection based on task analysis */
  readonly enableIntelligentStrategy: boolean;
  /** Enable multi-model verification (different model reviews work) */
  readonly enableMultiModelVerification: boolean;
  /** Enable shadow git commits after each passing cycle */
  readonly enableShadowGit: boolean;
  /** Enhanced doom-loop detection with pattern matching */
  readonly enhancedDoomLoopDetection: boolean;
  /** Context pressure critical threshold — auto-force fresh-context above this */
  readonly contextPressureCritical: number;
  /** Enable self-troubleshooting: classify errors and attempt automatic fixes (merged from NeverStop) */
  readonly enableSelfTroubleshoot: boolean;
}

export interface AutonomousCycleResult {
  readonly cycle: number;
  readonly action: string;
  readonly output: string;
  readonly verificationOutput: string;
  readonly testsPass: boolean;
  readonly typecheckPass: boolean;
  readonly lintPass: boolean;
  readonly durationMs: number;
  readonly strategy: string;
  readonly heartbeatOk: boolean;
  readonly contextUsage: number;
  readonly contextIntervention?: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
}

/** Progress event emitted after each execution cycle for background agent streaming. */
export interface AutonomousProgress {
  readonly cycle: number;
  readonly totalCycles: number;
  readonly percentage: number;
  readonly status: "executing" | "verifying" | "recovering" | "complete" | "failed";
  readonly lastAction: string;
  readonly strategy: string;
  readonly costSoFar: number;
  readonly elapsedMs: number;
}

export type ExitReason =
  | "tests-pass"
  | "max-cycles"
  | "max-time"
  | "max-cost"
  | "doom-loop"
  | "stale-agent"
  | "error"
  | "cancelled"
  | "circuit-breaker";

export interface AutonomousResult {
  readonly success: boolean;
  readonly totalCycles: number;
  readonly totalDurationMs: number;
  readonly totalCostUsd: number;
  readonly totalTokens: number;
  readonly exitReason: ExitReason;
  readonly cycles: readonly AutonomousCycleResult[];
  readonly strategy: string;
  readonly filesChanged: readonly string[];
}

/** Autonomous mode state for mode cycling */
export interface AutonomousModeState {
  readonly active: boolean;
  readonly task: string;
  readonly cycleCount: number;
  readonly startedAt: number;
  readonly costSoFar: number;
  readonly lastHeartbeat: number;
  readonly currentStrategy: string;
  readonly contextUsage: number;
  readonly paused: boolean;
}

const DEFAULT_CONFIG: AutonomousConfig = {
  maxCycles: 25,
  maxTimeMs: 60 * 60 * 1000, // 1 hour
  maxCostUsd: 10.0,
  runTests: true,
  runTypecheck: true,
  runLint: false,
  commitOnSuccess: false,
  heartbeatTimeoutMs: 120_000, // 2 minutes
  maxHeartbeatFailures: 3,
  escalateAfterFailures: 3,
  contextPressureThreshold: 0.75,
  enableScreenVerification: false,
  enableCheckpoints: true,
  checkpointDir: ".wotann/autonomous-checkpoints",
  enableIntelligentStrategy: true,
  enableMultiModelVerification: false,
  enableShadowGit: true,
  enhancedDoomLoopDetection: true,
  contextPressureCritical: 0.9,
  enableSelfTroubleshoot: false,
};

/**
 * Strategy escalation: each failure level tries a different approach.
 * Strategies are tried in order — if one fails repeatedly, escalate to next.
 */
const STRATEGIES = [
  "direct", // Try the task directly
  "decompose", // Break into smaller steps
  "research-first", // Search codebase before attempting
  "minimal-change", // Make smallest possible change
  "revert-and-retry", // Revert last change, try different approach
  "fresh-context", // Compact context and retry with clean slate
  "different-model", // Try a different model (via provider fallback)
  "ask-for-help", // Generate a detailed error report for human review
] as const;

export type Strategy = (typeof STRATEGIES)[number];

/** Circuit breaker state (from oh-my-openagent pattern) */
interface CircuitBreakerState {
  readonly consecutiveFailures: number;
  readonly maxConsecutiveFailures: number;
  readonly maxSubagentDepth: number;
  readonly maxDescendants: number;
  readonly currentDepth: number;
  readonly descendantCount: number;
  readonly tripped: boolean;
}

const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerState = {
  consecutiveFailures: 0,
  maxConsecutiveFailures: 3,
  maxSubagentDepth: 3,
  maxDescendants: 10,
  currentDepth: 0,
  descendantCount: 0,
  tripped: false,
};

export class AutonomousExecutor {
  private readonly config: AutonomousConfig;
  private modeState: AutonomousModeState | null = null;
  private cancelled = false;

  // Circuit breaker (from oh-my-openagent pattern)
  private circuitBreakerState: CircuitBreakerState = { ...DEFAULT_CIRCUIT_BREAKER };

  /** Optional progress callback for background agent streaming */
  private readonly onProgress?: (progress: AutonomousProgress) => void;

  constructor(
    config?: Partial<AutonomousConfig>,
    onProgress?: (progress: AutonomousProgress) => void,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onProgress = onProgress;
  }

  /** Enter autonomous mode (for mode cycling — Ctrl+A) */
  enterMode(task: string): AutonomousModeState {
    this.cancelled = false;
    this.resetCircuitBreaker();
    this.modeState = {
      active: true,
      task,
      cycleCount: 0,
      startedAt: Date.now(),
      costSoFar: 0,
      lastHeartbeat: Date.now(),
      currentStrategy: "direct",
      contextUsage: 0,
      paused: false,
    };
    return this.modeState;
  }

  /** Exit autonomous mode */
  exitMode(): AutonomousModeState | null {
    const state = this.modeState;
    this.modeState = null;
    this.cancelled = false;
    return state;
  }

  /** Pause/resume autonomous mode */
  togglePause(): boolean {
    if (!this.modeState) return false;
    this.modeState = { ...this.modeState, paused: !this.modeState.paused };
    return this.modeState.paused;
  }

  /** Cancel the current autonomous execution */
  cancel(): void {
    this.cancelled = true;
  }

  // ── Circuit Breaker ──────────────────────────────────────

  /**
   * Check if the circuit breaker allows continued execution.
   * Returns true if execution can proceed, false if the breaker has tripped.
   */
  private checkCircuitBreaker(): boolean {
    if (this.circuitBreakerState.tripped) return false; // Already tripped

    if (
      this.circuitBreakerState.consecutiveFailures >=
      this.circuitBreakerState.maxConsecutiveFailures
    ) {
      this.circuitBreakerState = { ...this.circuitBreakerState, tripped: true };
      return false;
    }
    if (this.circuitBreakerState.currentDepth >= this.circuitBreakerState.maxSubagentDepth) {
      this.circuitBreakerState = { ...this.circuitBreakerState, tripped: true };
      return false;
    }
    if (this.circuitBreakerState.descendantCount >= this.circuitBreakerState.maxDescendants) {
      this.circuitBreakerState = { ...this.circuitBreakerState, tripped: true };
      return false;
    }
    return true;
  }

  /** Record a failure — increments the consecutive failure counter. */
  private recordCircuitFailure(): void {
    this.circuitBreakerState = {
      ...this.circuitBreakerState,
      consecutiveFailures: this.circuitBreakerState.consecutiveFailures + 1,
    };
  }

  /** Record a success — resets the consecutive failure counter. */
  private recordCircuitSuccess(): void {
    this.circuitBreakerState = {
      ...this.circuitBreakerState,
      consecutiveFailures: 0,
    };
  }

  /** Reset the circuit breaker to its initial state. */
  private resetCircuitBreaker(): void {
    this.circuitBreakerState = {
      ...this.circuitBreakerState,
      tripped: false,
      consecutiveFailures: 0,
      currentDepth: 0,
      descendantCount: 0,
    };
  }

  /** Increment subagent depth (call when spawning a child agent). */
  incrementDepth(): void {
    this.circuitBreakerState = {
      ...this.circuitBreakerState,
      currentDepth: this.circuitBreakerState.currentDepth + 1,
      descendantCount: this.circuitBreakerState.descendantCount + 1,
    };
  }

  /** Decrement subagent depth (call when a child agent completes). */
  decrementDepth(): void {
    this.circuitBreakerState = {
      ...this.circuitBreakerState,
      currentDepth: Math.max(0, this.circuitBreakerState.currentDepth - 1),
    };
  }

  /** Check if the circuit breaker is currently tripped. */
  isCircuitBreakerTripped(): boolean {
    return this.circuitBreakerState.tripped;
  }

  /** Check if autonomous mode is active */
  isActive(): boolean {
    return this.modeState?.active ?? false;
  }

  /** Check if paused */
  isPaused(): boolean {
    return this.modeState?.paused ?? false;
  }

  /** Get current mode state */
  getState(): AutonomousModeState | null {
    return this.modeState;
  }

  /** Record a heartbeat (call this when the agent produces output) */
  heartbeat(): void {
    if (this.modeState) {
      this.modeState = { ...this.modeState, lastHeartbeat: Date.now() };
    }
  }

  /** Check if the agent is stale (no heartbeat for too long) */
  isStale(): boolean {
    if (!this.modeState) return false;
    return Date.now() - this.modeState.lastHeartbeat > this.config.heartbeatTimeoutMs;
  }

  /** Update context usage for pressure monitoring */
  updateContextUsage(usage: number): void {
    if (this.modeState) {
      this.modeState = { ...this.modeState, contextUsage: usage };
    }
  }

  /**
   * Run autonomously until the task is complete or budget is exhausted.
   * This is the main entry point for `wotann autonomous <prompt>`.
   *
   * INTELLIGENCE FEATURES:
   * - Pattern-based doom loop detection (not just exact match)
   * - Strategy escalation with 8 different approaches
   * - Context pressure monitoring with auto-compaction
   * - Checkpoint saves for crash recovery
   * - Intelligent error recovery with context injection
   */
  async execute(
    task: string,
    executor: (prompt: string) => Promise<{ output: string; costUsd: number; tokensUsed: number }>,
    verifier: () => Promise<{
      testsPass: boolean;
      typecheckPass: boolean;
      lintPass: boolean;
      output: string;
    }>,
    callbacks?: {
      onCycleStart?: (cycle: number, strategy: string) => void;
      onCycleEnd?: (result: AutonomousCycleResult) => void;
      onStrategyChange?: (from: string, to: string) => void;
      onContextPressure?: (usage: number) => Promise<void>;
      onCheckpoint?: (state: AutonomousModeState) => Promise<void>;
      onShadowGitCommit?: (cycle: number, message: string) => Promise<void>;
      onMultiModelVerify?: (output: string) => Promise<{ approved: boolean; feedback: string }>;
      /** Shell command runner for self-troubleshooting (merged from NeverStop) */
      runCommand?: (
        command: string,
      ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
      /**
       * Oracle consultation hook (D13). Called when the OracleWorkerPolicy
       * decides the worker should escalate to a stronger model for one step
       * of strategic guidance. The caller dispatches the consultation through
       * the runtime with the oracle model and returns the response so the
       * executor can inject it into the next worker prompt.
       */
      onOracleConsult?: (
        consultation: OracleConsultation,
        oracleModel: string,
      ) => Promise<OracleResponse>;
    },
  ): Promise<AutonomousResult> {
    this.enterMode(task);
    const startTime = Date.now();
    const cycles: AutonomousCycleResult[] = [];
    let totalCost = 0;
    let totalTokens = 0;
    let currentPrompt = task;
    let doomLoopCount = 0;
    let heartbeatFailures = 0;
    let consecutiveFailures = 0;
    const recentOutputs: string[] = [];
    const recentErrors: string[] = [];
    let currentStrategy: Strategy = this.config.enableIntelligentStrategy
      ? selectIntelligentFirstStrategy(task)
      : "direct";
    const filesChanged: string[] = [];

    // ── Oracle/Worker policy (D13) ──
    // Default to cheap-model throughput with optional oracle escalation on
    // strategic moments (repeated errors, stuck iterations, critical tasks).
    // `recordIteration` is called after each cycle; `shouldEscalate` runs
    // before each new step. If callers don't supply an `onOracleConsult`
    // hook we silently degrade to worker-only execution.
    const oraclePolicy = new OracleWorkerPolicy();
    let oracleGuidance: string | null = null;

    for (let cycle = 0; cycle < this.config.maxCycles; cycle++) {
      // ── Cancellation check ──
      if (this.cancelled) {
        this.exitMode();
        return this.buildResult(
          false,
          cycles,
          totalCost,
          totalTokens,
          "cancelled",
          currentStrategy,
          filesChanged,
        );
      }

      // ── Circuit breaker check ──
      if (!this.checkCircuitBreaker()) {
        this.exitMode();
        return this.buildResult(
          false,
          cycles,
          totalCost,
          totalTokens,
          "circuit-breaker",
          currentStrategy,
          filesChanged,
        );
      }

      // ── Pause check ──
      while (this.modeState?.paused && !this.cancelled) {
        await new Promise((r) => setTimeout(r, 1000));
      }

      // ── Budget checks ──
      const elapsed = Date.now() - startTime;
      if (elapsed > this.config.maxTimeMs) {
        this.exitMode();
        return this.buildResult(
          false,
          cycles,
          totalCost,
          totalTokens,
          "max-time",
          currentStrategy,
          filesChanged,
        );
      }
      if (totalCost > this.config.maxCostUsd) {
        this.exitMode();
        return this.buildResult(
          false,
          cycles,
          totalCost,
          totalTokens,
          "max-cost",
          currentStrategy,
          filesChanged,
        );
      }

      // ── Context pressure check (EVERY cycle — critical safety measure) ──
      if (this.modeState && this.modeState.contextUsage > this.config.contextPressureThreshold) {
        if (callbacks?.onContextPressure) {
          await callbacks.onContextPressure(this.modeState.contextUsage);
        }
        // Critical threshold: force fresh-context strategy
        if (this.modeState.contextUsage >= this.config.contextPressureCritical) {
          const prevStrategy = currentStrategy;
          currentStrategy = "fresh-context";
          if (prevStrategy !== currentStrategy) {
            callbacks?.onStrategyChange?.(prevStrategy, currentStrategy);
          }
        }
      }

      // ── Strategy escalation ──
      if (consecutiveFailures >= this.config.escalateAfterFailures) {
        const currentIdx = STRATEGIES.indexOf(currentStrategy);
        const nextIdx = Math.min(currentIdx + 1, STRATEGIES.length - 1);
        const newStrategy = STRATEGIES[nextIdx] ?? "direct";
        if (newStrategy !== currentStrategy) {
          callbacks?.onStrategyChange?.(currentStrategy, newStrategy);
          currentStrategy = newStrategy;
        }
        consecutiveFailures = 0;
      }

      // ── Cycle start callback ──
      callbacks?.onCycleStart?.(cycle, currentStrategy);

      // ── Oracle/Worker escalation check (D13) ──
      // Ask the policy whether this step warrants an oracle consultation.
      // When it does and callers supplied a hook, consult the oracle and
      // capture its guidance so the strategy prompt picks it up below.
      const escalationReason: EscalationReason | null = oraclePolicy.shouldEscalate({
        currentTask: currentPrompt,
      });
      if (escalationReason && callbacks?.onOracleConsult) {
        const consultation = oraclePolicy.prepareConsultation(escalationReason, currentPrompt);
        try {
          const response = await callbacks.onOracleConsult(
            consultation,
            oraclePolicy.models().oracle,
          );
          oraclePolicy.markConsulted();
          oracleGuidance = response.guidance;
        } catch {
          // Oracle consultation failed — fall back to worker-only execution.
          oracleGuidance = null;
        }
      }

      // ── Build strategy-aware prompt ──
      const contextIntervention =
        this.modeState && this.modeState.contextUsage > this.config.contextPressureThreshold
          ? buildContextGuardPrompt(currentPrompt, this.modeState.contextUsage)
          : undefined;
      if (
        contextIntervention &&
        this.modeState &&
        this.modeState.contextUsage >= Math.max(0.9, this.config.contextPressureThreshold + 0.1)
      ) {
        const nextStrategy: Strategy = "fresh-context";
        if (currentStrategy !== nextStrategy) {
          callbacks?.onStrategyChange?.(currentStrategy, nextStrategy);
          currentStrategy = nextStrategy;
        }
      }
      const strategyPromptBase = buildStrategyPrompt(
        contextIntervention ?? currentPrompt,
        currentStrategy,
        cycle,
        recentOutputs,
      );
      // Prepend oracle guidance (if any) so the worker treats it as
      // authoritative context for the next step. Consumed once, then cleared.
      const strategyPrompt = oracleGuidance
        ? `[Oracle guidance]\n${oracleGuidance}\n\n${strategyPromptBase}`
        : strategyPromptBase;
      oracleGuidance = null;

      // ── Execute with heartbeat monitoring ──
      this.heartbeat();
      const cycleStart = Date.now();
      let output: string;
      let costUsd: number;
      let tokensUsed: number;

      try {
        const result = await Promise.race([executor(strategyPrompt), this.heartbeatWatchdog()]);

        if (!result || typeof result === "string") {
          // Heartbeat timeout
          heartbeatFailures++;
          if (heartbeatFailures >= this.config.maxHeartbeatFailures) {
            this.exitMode();
            return this.buildResult(
              false,
              cycles,
              totalCost,
              totalTokens,
              "stale-agent",
              currentStrategy,
              filesChanged,
            );
          }
          output = "";
          costUsd = 0;
          tokensUsed = 0;
        } else {
          output = result.output;
          costUsd = result.costUsd;
          tokensUsed = result.tokensUsed;
          heartbeatFailures = 0;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "unknown";
        output = `Error: ${errorMsg}`;
        costUsd = 0;
        tokensUsed = 0;

        // Self-troubleshoot: classify error and attempt automatic fix (merged from NeverStop)
        if (this.config.enableSelfTroubleshoot && callbacks?.runCommand) {
          const diagnosis = selfTroubleshoot(errorMsg);
          if (diagnosis.fixCommand) {
            try {
              const fixResult = await callbacks.runCommand(diagnosis.fixCommand);
              if (fixResult.exitCode === 0) {
                output = `Self-fixed ${diagnosis.errorType}: ${diagnosis.fixCommand}`;
              }
            } catch {
              /* fix attempt failed, continue normally */
            }
          }
        }
      }

      totalCost += costUsd;
      totalTokens += tokensUsed;
      this.heartbeat();

      // ── DoomLoop detection (pattern-based, not just exact match) ──
      recentOutputs.push(output.slice(0, 500));
      if (recentOutputs.length > 10) recentOutputs.shift();

      // Enhanced doom-loop: also track error messages
      if (this.config.enhancedDoomLoopDetection) {
        const verification = await verifier();
        if (!verification.testsPass || !verification.typecheckPass) {
          recentErrors.push(verification.output.slice(0, 300));
          if (recentErrors.length > 6) recentErrors.shift();
        }

        if (detectEnhancedDoomLoop(recentOutputs, recentErrors)) {
          doomLoopCount++;
          if (doomLoopCount >= 3) {
            this.exitMode();
            return this.buildResult(
              false,
              cycles,
              totalCost,
              totalTokens,
              "doom-loop",
              currentStrategy,
              filesChanged,
            );
          }
          const currentIdx = STRATEGIES.indexOf(currentStrategy);
          currentStrategy = STRATEGIES[Math.min(currentIdx + 2, STRATEGIES.length - 1)] ?? "direct";
          // Skip verifier since we already ran it
          const cycleResult: AutonomousCycleResult = {
            cycle,
            action: strategyPrompt.slice(0, 200),
            output: output.slice(0, 500),
            verificationOutput: verification.output.slice(0, 2000),
            testsPass: verification.testsPass,
            typecheckPass: verification.typecheckPass,
            lintPass: verification.lintPass,
            durationMs: Date.now() - cycleStart,
            strategy: currentStrategy,
            heartbeatOk: heartbeatFailures === 0,
            contextUsage: this.modeState?.contextUsage ?? 0,
            contextIntervention,
            tokensUsed,
            costUsd,
          };
          cycles.push(cycleResult);
          callbacks?.onCycleEnd?.(cycleResult);
          consecutiveFailures++;
          this.recordCircuitFailure();
          currentPrompt = buildRecoveryPrompt(
            task,
            verification.output,
            cycle,
            this.config.maxCycles,
            currentStrategy,
            consecutiveFailures,
          );
          continue;
        }
      }

      if (detectDoomLoop(recentOutputs)) {
        doomLoopCount++;
        if (doomLoopCount >= 3) {
          this.exitMode();
          return this.buildResult(
            false,
            cycles,
            totalCost,
            totalTokens,
            "doom-loop",
            currentStrategy,
            filesChanged,
          );
        }
        // On doom loop, force strategy escalation
        const currentIdx = STRATEGIES.indexOf(currentStrategy);
        currentStrategy = STRATEGIES[Math.min(currentIdx + 2, STRATEGIES.length - 1)] ?? "direct";
      } else {
        doomLoopCount = Math.max(0, doomLoopCount - 1);
      }

      // ── Verify ──
      const verification = await verifier();

      // ── Record iteration with oracle policy (D13) ──
      // Track verification state + recent error so shouldEscalate() next
      // cycle has enough trajectory data to make an informed decision.
      const verificationPassed =
        (!this.config.runTests || verification.testsPass) &&
        (!this.config.runTypecheck || verification.typecheckPass);
      const iterationError =
        !verificationPassed && verification.output.length > 0
          ? verification.output.slice(0, 200)
          : output.startsWith("Error:")
            ? output.slice(0, 200)
            : undefined;
      oraclePolicy.recordIteration({
        stateSnapshot: output.slice(0, 160),
        verificationPassed,
        error: iterationError,
      });

      const cycleResult: AutonomousCycleResult = {
        cycle,
        action: strategyPrompt.slice(0, 200),
        output: output.slice(0, 500),
        verificationOutput: verification.output.slice(0, 2000),
        testsPass: verification.testsPass,
        typecheckPass: verification.typecheckPass,
        lintPass: verification.lintPass,
        durationMs: Date.now() - cycleStart,
        strategy: currentStrategy,
        heartbeatOk: heartbeatFailures === 0,
        contextUsage: this.modeState?.contextUsage ?? 0,
        contextIntervention,
        tokensUsed,
        costUsd,
      };
      cycles.push(cycleResult);

      // ── Cycle end callback ──
      callbacks?.onCycleEnd?.(cycleResult);

      // Update mode state
      if (this.modeState) {
        this.modeState = {
          ...this.modeState,
          cycleCount: cycle + 1,
          costSoFar: totalCost,
          currentStrategy,
        };
      }

      // ── Progress streaming for background agent consumers ──
      if (this.onProgress) {
        const allPassing =
          (!this.config.runTests || cycleResult.testsPass) &&
          (!this.config.runTypecheck || cycleResult.typecheckPass) &&
          (!this.config.runLint || cycleResult.lintPass);
        this.onProgress({
          cycle,
          totalCycles: this.config.maxCycles,
          percentage: Math.round(((cycle + 1) / this.config.maxCycles) * 100),
          status: allPassing ? "executing" : "recovering",
          lastAction: cycleResult.action.slice(0, 100),
          strategy: currentStrategy,
          costSoFar: totalCost,
          elapsedMs: Date.now() - startTime,
        });
      }

      // ── Checkpoint save ──
      if (this.config.enableCheckpoints && this.modeState && callbacks?.onCheckpoint) {
        await callbacks.onCheckpoint(this.modeState);
      }

      // ── Success check ──
      const testsOk = !this.config.runTests || verification.testsPass;
      const typecheckOk = !this.config.runTypecheck || verification.typecheckPass;
      const lintOk = !this.config.runLint || verification.lintPass;

      if (testsOk && typecheckOk && lintOk) {
        this.recordCircuitSuccess();

        // Shadow git commit on passing cycle
        if (this.config.enableShadowGit && callbacks?.onShadowGitCommit) {
          await callbacks.onShadowGitCommit(
            cycle,
            `autonomous: cycle ${cycle + 1} passed (${currentStrategy})`,
          );
        }

        // Multi-model verification gate
        if (this.config.enableMultiModelVerification && callbacks?.onMultiModelVerify) {
          const review = await callbacks.onMultiModelVerify(output);
          if (!review.approved) {
            consecutiveFailures++;
            this.recordCircuitFailure();
            currentPrompt = buildRecoveryPrompt(
              task,
              `Multi-model reviewer feedback: ${review.feedback}`,
              cycle,
              this.config.maxCycles,
              currentStrategy,
              consecutiveFailures,
            );
            continue;
          }
        }

        this.exitMode();
        return this.buildResult(
          true,
          cycles,
          totalCost,
          totalTokens,
          "tests-pass",
          currentStrategy,
          filesChanged,
        );
      }

      // ── Build recovery prompt ──
      consecutiveFailures++;
      this.recordCircuitFailure();
      currentPrompt = buildRecoveryPrompt(
        task,
        verification.output,
        cycle,
        this.config.maxCycles,
        currentStrategy,
        consecutiveFailures,
      );
    }

    this.exitMode();
    return this.buildResult(
      false,
      cycles,
      totalCost,
      totalTokens,
      "max-cycles",
      currentStrategy,
      filesChanged,
    );
  }

  private async heartbeatWatchdog(): Promise<string> {
    return new Promise((resolve) => {
      setTimeout(() => resolve("heartbeat-timeout"), this.config.heartbeatTimeoutMs);
    });
  }

  private buildResult(
    success: boolean,
    cycles: readonly AutonomousCycleResult[],
    totalCost: number,
    totalTokens: number,
    exitReason: ExitReason,
    strategy: string,
    filesChanged: readonly string[],
  ): AutonomousResult {
    return {
      success,
      totalCycles: cycles.length,
      totalDurationMs: cycles.reduce((sum, c) => sum + c.durationMs, 0),
      totalCostUsd: totalCost,
      totalTokens,
      exitReason,
      cycles,
      strategy,
      filesChanged,
    };
  }
}

// ── Strategy Prompt Builders ───────────────────────────────

function buildStrategyPrompt(
  base: string,
  strategy: Strategy,
  cycle: number,
  _recentOutputs: readonly string[],
): string {
  const cycleInfo = cycle > 0 ? `\n[Cycle ${cycle + 1}, strategy: ${strategy}]\n` : "";

  switch (strategy) {
    case "decompose":
      return `${cycleInfo}Break this task into smaller steps and tackle them one at a time. Complete one step fully before moving to the next:\n\n${base}`;
    case "research-first":
      return `${cycleInfo}Before making any changes, search the codebase thoroughly to understand the current state. Read ALL related files. Then make targeted changes:\n\n${base}`;
    case "minimal-change":
      return `${cycleInfo}Make the SMALLEST possible change to fix this. Do not refactor, do not change anything else. One surgical edit:\n\n${base}`;
    case "revert-and-retry":
      return `${cycleInfo}The previous approach didn't work. Revert your last change and try a completely different approach. Think about what assumption was wrong:\n\n${base}`;
    case "fresh-context":
      return `${cycleInfo}Starting with a clean perspective. Forget previous attempts. Read the code fresh and identify the root cause:\n\n${base}`;
    case "different-model":
      return `${cycleInfo}Previous model's approach didn't work. Try thinking about this differently — what would a different debugging strategy look like?\n\n${base}`;
    case "ask-for-help":
      return `${cycleInfo}After ${cycle} attempts, this task is proving difficult. Generate a DETAILED error report:\n1. What was tried\n2. What failed and why\n3. What the likely root cause is\n4. Suggested next steps for a human developer\n\n${base}`;
    default:
      return `${cycleInfo}${base}`;
  }
}

function buildRecoveryPrompt(
  originalTask: string,
  verificationOutput: string,
  cycle: number,
  maxCycles: number,
  strategy: string,
  consecutiveFailures: number,
): string {
  const urgency =
    cycle > maxCycles * 0.7
      ? "CRITICAL: Running low on attempts. Focus on the highest-impact fix."
      : consecutiveFailures >= 2
        ? "IMPORTANT: Previous approaches failed. Try a fundamentally different approach."
        : "Fix ALL issues. Run tests and typecheck yourself before responding.";

  return [
    `Cycle ${cycle + 1}/${maxCycles} (strategy: ${strategy}) — previous attempt had issues:`,
    "",
    "```",
    verificationOutput.slice(0, 2000),
    "```",
    "",
    `Original task: ${originalTask}`,
    "",
    urgency,
  ].join("\n");
}

function buildContextGuardPrompt(base: string, usage: number): string {
  const percent = Math.round(usage * 100);
  return [
    `[Context pressure: ${percent}%]`,
    "Tighten the scope for this cycle:",
    "- Prefer the smallest next action that can be verified immediately.",
    "- Avoid rereading large files unless strictly necessary.",
    "- Reuse existing plan, memory, and recent trace instead of re-deriving everything.",
    "- If a broad refactor is needed, split it into a fresh-context subtask first.",
    "",
    base,
  ].join("\n");
}

// ── DoomLoop Detection ─────────────────────────────────────

/**
 * Pattern-based doom loop detection.
 * Checks for:
 * 1. Exact output repetition (A, A, A)
 * 2. Alternating patterns (A, B, A, B)
 * 3. Short cycling patterns (A, B, C, A, B, C)
 * 4. Similarity-based detection (outputs that are >90% similar)
 */
function detectDoomLoop(recentOutputs: readonly string[]): boolean {
  if (recentOutputs.length < 2) return false;

  const last = recentOutputs[recentOutputs.length - 1] ?? "";
  if (last.length === 0) return false;

  // Check exact repetition (last 2 outputs identical)
  const secondLast = recentOutputs[recentOutputs.length - 2] ?? "";
  if (last === secondLast) return true;

  // Check alternating pattern (A, B, A pattern in last 3)
  if (recentOutputs.length >= 3) {
    const thirdLast = recentOutputs[recentOutputs.length - 3] ?? "";
    if (last === thirdLast && last !== secondLast) return true;
  }

  // Check 3-step cycling (A, B, C, A pattern in last 4)
  if (recentOutputs.length >= 4) {
    const fourthLast = recentOutputs[recentOutputs.length - 4] ?? "";
    if (last === fourthLast) return true;
  }

  // Similarity-based detection: if last output is >90% similar to any of the last 3
  for (let i = recentOutputs.length - 2; i >= Math.max(0, recentOutputs.length - 4); i--) {
    const prev = recentOutputs[i] ?? "";
    if (prev.length > 0 && computeSimilarity(last, prev) > 0.9) {
      return true;
    }
  }

  return false;
}

/**
 * Simple character-level Jaccard similarity for doom loop detection.
 * Fast enough for ~500 char strings checked every cycle.
 */
function computeSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Use trigram similarity for better accuracy than char-by-char
  const trigramsA = new Set<string>();
  const trigramsB = new Set<string>();

  for (let i = 0; i <= a.length - 3; i++) trigramsA.add(a.slice(i, i + 3));
  for (let i = 0; i <= b.length - 3; i++) trigramsB.add(b.slice(i, i + 3));

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }

  const union = trigramsA.size + trigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Intelligent First-Strategy Selection ─────────────────

/**
 * Analyzes the task description to pick the optimal starting strategy
 * instead of always starting with "direct".
 */
function selectIntelligentFirstStrategy(task: string): Strategy {
  const lower = task.toLowerCase();

  // Multi-file tasks → decompose
  if (/multiple files|across.*files|many.*changes|refactor|migration/i.test(lower)) {
    return "decompose";
  }

  // Unfamiliar territory → research-first
  if (/unfamiliar|new.*codebase|understand.*first|explore|investigate/i.test(lower)) {
    return "research-first";
  }

  // Prior failures mentioned → revert-and-retry
  if (/tried.*before|failed.*previously|didn't work|still broken|keeps failing/i.test(lower)) {
    return "revert-and-retry";
  }

  // Simple single-file fix → direct
  if (/fix.*typo|rename|update.*version|simple.*change|one.*file/i.test(lower)) {
    return "direct";
  }

  // Debugging tasks → research-first (read before fixing)
  if (/debug|diagnose|root.*cause|why.*fail|error.*trace/i.test(lower)) {
    return "research-first";
  }

  // Complex architectural → decompose
  if (/architect|design|pattern|framework|system/i.test(lower)) {
    return "decompose";
  }

  // Default: direct for simple tasks
  return "direct";
}

// ── Enhanced Doom-Loop Detection ─────────────────────────

/**
 * Enhanced doom-loop detection that goes beyond output matching.
 * Detects:
 * 1. Same error message 3x with different "fix" attempts
 * 2. File edit cycling (edit → revert → same edit)
 * 3. >5 identical consecutive error patterns
 */
function detectEnhancedDoomLoop(
  recentOutputs: readonly string[],
  recentErrors: readonly string[],
): boolean {
  // Pattern 1: Same error appearing 3+ times
  if (recentErrors.length >= 3) {
    const errorCounts = new Map<string, number>();
    for (const err of recentErrors) {
      // Normalize error by removing dynamic parts (line numbers, timestamps)
      const normalized = err.replace(/\d+/g, "N").replace(/at\s+\S+/g, "at LOCATION");
      errorCounts.set(normalized, (errorCounts.get(normalized) ?? 0) + 1);
    }
    for (const count of errorCounts.values()) {
      if (count >= 3) return true;
    }
  }

  // Pattern 2: Output cycling with high similarity across non-adjacent outputs
  if (recentOutputs.length >= 4) {
    let similarPairs = 0;
    for (let i = 0; i < recentOutputs.length - 2; i++) {
      for (let j = i + 2; j < recentOutputs.length; j++) {
        const a = recentOutputs[i] ?? "";
        const b = recentOutputs[j] ?? "";
        if (a.length > 50 && b.length > 50 && computeSimilarity(a, b) > 0.85) {
          similarPairs++;
        }
      }
    }
    if (similarPairs >= 3) return true;
  }

  return false;
}

// ── Self-Troubleshoot (merged from NeverStopExecutor) ────

export type ErrorCategory =
  | "missing-dependency"
  | "syntax-error"
  | "type-error"
  | "test-failure"
  | "runtime-error"
  | "permission-error"
  | "network-error"
  | "unknown";

interface SelfTroubleshootDiagnosis {
  readonly errorType: ErrorCategory;
  readonly fixCommand: string | null;
}

function classifyError(errorMsg: string): ErrorCategory {
  const lower = errorMsg.toLowerCase();

  if (
    /cannot find module|module not found|no such module/i.test(lower) ||
    /modulenotfounderror|importerror/i.test(lower) ||
    /error\[e0432\]|unresolved import/i.test(lower) ||
    /package.*not found|could not resolve/i.test(lower)
  )
    return "missing-dependency";

  if (
    /syntaxerror|unexpected token|parsing error/i.test(lower) ||
    /unterminated|unexpected end of/i.test(lower)
  )
    return "syntax-error";

  if (
    /typeerror|type.*is not assignable|error ts\d+/i.test(lower) ||
    /property.*does not exist on type/i.test(lower)
  )
    return "type-error";

  if (
    /test.*fail|assertion.*error|expect.*received/i.test(lower) ||
    /tests?\s+failed|failing\s+tests?/i.test(lower)
  )
    return "test-failure";

  if (/eacces|permission denied|eperm/i.test(lower) || /operation not permitted/i.test(lower))
    return "permission-error";

  if (
    /econnrefused|enotfound|etimedout|enetunreach/i.test(lower) ||
    /network error|fetch failed/i.test(lower)
  )
    return "network-error";

  if (
    /referenceerror|rangeerror|stackoverflowerror/i.test(lower) ||
    /segfault|segmentation fault|core dumped/i.test(lower)
  )
    return "runtime-error";

  return "unknown";
}

function selfTroubleshoot(errorMsg: string): SelfTroubleshootDiagnosis {
  const errorType = classifyError(errorMsg);

  switch (errorType) {
    case "missing-dependency": {
      // Node.js: Cannot find module 'xxx'
      const nodeMatch = errorMsg.match(/Cannot find module '([^']+)'/);
      if (nodeMatch?.[1]) {
        const pkg = nodeMatch[1].startsWith("@") ? nodeMatch[1] : nodeMatch[1].split("/")[0]!;
        return { errorType, fixCommand: `npm install ${pkg}` };
      }
      // Python: ModuleNotFoundError: No module named 'xxx'
      const pyMatch = errorMsg.match(/No module named '([^']+)'/);
      if (pyMatch?.[1]) {
        const pkg = pyMatch[1].split(".")[0]!;
        return { errorType, fixCommand: `pip install ${pkg}` };
      }
      // Rust: unresolved import `xxx`
      const rustMatch = errorMsg.match(/unresolved import `([^`]+)`/);
      if (rustMatch?.[1]) {
        const crate = rustMatch[1].split("::")[0]!;
        return { errorType, fixCommand: `cargo add ${crate}` };
      }
      return { errorType, fixCommand: null };
    }

    case "permission-error": {
      const pathMatch = errorMsg.match(/EACCES.*'([^']+)'/);
      if (pathMatch?.[1]) {
        return { errorType, fixCommand: `chmod u+rw "${pathMatch[1]}"` };
      }
      return { errorType, fixCommand: null };
    }

    default:
      return { errorType, fixCommand: null };
  }
}

// ── Checkpoint Serialization ─────────────────────────────

export interface AutonomousCheckpoint {
  readonly sessionId: string;
  readonly task: string;
  readonly cycleCount: number;
  readonly currentStrategy: Strategy;
  readonly costSoFar: number;
  readonly tokensSoFar: number;
  readonly filesChanged: readonly string[];
  readonly lastVerificationOutput: string;
  readonly savedAt: string;
}

export function serializeCheckpoint(
  state: AutonomousModeState,
  filesChanged: readonly string[],
  lastVerification: string,
): AutonomousCheckpoint {
  return {
    sessionId: `autonomous-${state.startedAt}`,
    task: state.task,
    cycleCount: state.cycleCount,
    currentStrategy: state.currentStrategy as Strategy,
    costSoFar: state.costSoFar,
    tokensSoFar: 0,
    filesChanged,
    lastVerificationOutput: lastVerification.slice(0, 5000),
    savedAt: new Date().toISOString(),
  };
}
