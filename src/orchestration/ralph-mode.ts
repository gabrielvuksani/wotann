/**
 * Ralph Mode: persistent verify-fix loop until all tests pass.
 * From oh-my-claudecode — runs until success or max cycles reached.
 */

import { DoomLoopDetector } from "../hooks/doom-loop-detector.js";

export interface RalphCycleMetric {
  readonly cycle: number;
  readonly success: boolean;
  readonly verifyDurationMs: number;
  readonly fixDurationMs: number;
  readonly errorSignature?: string;
  readonly escalated: boolean;
}

export interface RalphHUDMetrics {
  readonly totalDurationMs: number;
  readonly totalVerifyMs: number;
  readonly totalFixMs: number;
  readonly averageVerifyMs: number;
  readonly averageFixMs: number;
  readonly escalationCount: number;
  readonly doomLoopsDetected: number;
}

export interface RalphResult {
  readonly success: boolean;
  readonly cycles: number;
  readonly lastError?: string;
  readonly fixesApplied: readonly string[];
  readonly cycleMetrics: readonly RalphCycleMetric[];
  readonly escalated: boolean;
  readonly doomLoopDetected: boolean;
  readonly abortedReason?: string;
  readonly hud: RalphHUDMetrics;
}

export interface RalphConfig {
  readonly maxCycles: number;
  readonly command: string;
  readonly description: string;
  readonly maxDurationMs?: number;
  readonly maxBudgetUsd?: number;
  readonly costPerCycleUsd?: number;
  readonly strategyEscalationThreshold?: number;
  readonly doomLoopThreshold?: number;
}

/**
 * Run a verify-fix loop: execute command, if it fails, let agent fix, repeat.
 */
export async function runRalphMode(
  config: RalphConfig,
  verifier: () => Promise<{ success: boolean; output: string }>,
  fixer: (error: string) => Promise<string>,
): Promise<RalphResult> {
  const fixesApplied: string[] = [];
  const cycleMetrics: RalphCycleMetric[] = [];
  const doomLoop = new DoomLoopDetector(config.doomLoopThreshold ?? 3);
  const startedAt = Date.now();
  let totalVerifyMs = 0;
  let totalFixMs = 0;
  let escalationCount = 0;
  let doomLoopsDetected = 0;
  let escalated = false;

  const buildResult = (result: {
    success: boolean;
    cycles: number;
    lastError?: string;
    abortedReason?: string;
    doomLoopDetected?: boolean;
  }): RalphResult => ({
    success: result.success,
    cycles: result.cycles,
    lastError: result.lastError,
    fixesApplied,
    cycleMetrics,
    escalated,
    doomLoopDetected: result.doomLoopDetected ?? doomLoopsDetected > 0,
    abortedReason: result.abortedReason,
    hud: {
      totalDurationMs: Date.now() - startedAt,
      totalVerifyMs,
      totalFixMs,
      averageVerifyMs: cycleMetrics.length === 0 ? 0 : Math.round(totalVerifyMs / cycleMetrics.length),
      averageFixMs: fixesApplied.length === 0 ? 0 : Math.round(totalFixMs / fixesApplied.length),
      escalationCount,
      doomLoopsDetected,
    },
  });

  for (let cycle = 0; cycle < config.maxCycles; cycle++) {
    if (config.maxDurationMs !== undefined && (Date.now() - startedAt) >= config.maxDurationMs) {
      return buildResult({
        success: false,
        cycles: cycle,
        lastError: "Time budget exhausted",
        abortedReason: "time-budget",
      });
    }

    if (config.maxBudgetUsd !== undefined && config.costPerCycleUsd !== undefined) {
      const projectedSpend = cycle * config.costPerCycleUsd;
      if (projectedSpend >= config.maxBudgetUsd) {
        return buildResult({
          success: false,
          cycles: cycle,
          lastError: "Budget exhausted",
          abortedReason: "cost-budget",
        });
      }
    }

    const verifyStart = Date.now();
    const result = await verifier();
    const verifyDurationMs = Date.now() - verifyStart;
    totalVerifyMs += verifyDurationMs;

    if (result.success) {
      cycleMetrics.push({
        cycle: cycle + 1,
        success: true,
        verifyDurationMs,
        fixDurationMs: 0,
        escalated,
      });
      return buildResult({ success: true, cycles: cycle + 1 });
    }

    const errorSignature = normalizeError(result.output);
    const doomResult = doomLoop.record("ralph-verify", { errorSignature });
    if (doomResult.detected) {
      doomLoopsDetected++;
    }

    const shouldEscalate =
      doomResult.detected ||
      cycle + 1 >= (config.strategyEscalationThreshold ?? 3);

    let fixerInput = result.output;
    if (shouldEscalate) {
      escalated = true;
      escalationCount++;
      fixerInput = [
        "[RALPH ESCALATION]",
        `Verifier command: ${config.command}`,
        `Task: ${config.description}`,
        doomResult.detected ? doomLoop.getReminder(doomResult) : "Repeated failures detected. Escalate strategy.",
        "",
        "Latest verifier output:",
        result.output,
      ].join("\n");
    }

    const fixStart = Date.now();
    const fix = await fixer(fixerInput);
    const fixDurationMs = Date.now() - fixStart;
    totalFixMs += fixDurationMs;
    fixesApplied.push(fix);

    cycleMetrics.push({
      cycle: cycle + 1,
      success: false,
      verifyDurationMs,
      fixDurationMs,
      errorSignature,
      escalated: shouldEscalate,
    });

    if (config.doomLoopThreshold !== undefined &&
      doomResult.detected &&
      fixesApplied.length >= config.doomLoopThreshold) {
      return buildResult({
        success: false,
        cycles: cycle + 1,
        lastError: result.output,
        abortedReason: "doom-loop",
        doomLoopDetected: true,
      });
    }
  }

  return buildResult({
    success: false,
    cycles: config.maxCycles,
    lastError: "Max cycles reached",
  });
}

function normalizeError(error: string): string {
  return error
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
