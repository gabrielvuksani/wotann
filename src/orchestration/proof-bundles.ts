import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AutonomousResult } from "./autonomous.js";
import type { RuntimeStatus } from "../core/runtime.js";
import type { ContextBudget, ContextCapabilityProfile } from "../context/window-intelligence.js";

export interface AutonomousProofBundleInput {
  readonly workingDir: string;
  readonly task: string;
  readonly result: AutonomousResult;
  readonly runtimeStatus?: RuntimeStatus;
  readonly contextBudget?: ContextBudget;
  readonly contextCapability?: ContextCapabilityProfile;
  readonly providerOverride?: string;
  readonly modelOverride?: string;
  readonly visualVerificationEnabled?: boolean;
  readonly visualExpectation?: string;
}

export interface AutonomousProofBundle {
  readonly generatedAt: string;
  readonly task: string;
  readonly summary: {
    readonly success: boolean;
    readonly exitReason: string;
    readonly totalCycles: number;
    readonly totalDurationMs: number;
    readonly totalCostUsd: number;
    readonly totalTokens: number;
    readonly providerOverride?: string;
    readonly modelOverride?: string;
  };
  readonly runtime?: {
    readonly sessionId: string;
    readonly activeProvider?: string;
    readonly currentMode: string;
    readonly hookCount: number;
    readonly middlewareLayers: number;
    readonly memoryEnabled: boolean;
    readonly traceEntries: number;
    readonly skillCount: number;
  };
  readonly context?: {
    readonly usagePercent: number;
    readonly totalTokens: number;
    readonly documentedMaxTokens?: number;
    readonly activationMode?: string;
    readonly pressureLevel: string;
  };
  readonly verification: {
    readonly visualVerificationEnabled: boolean;
    readonly visualExpectation?: string;
    readonly finalChecks: {
      readonly testsPass: boolean;
      readonly typecheckPass: boolean;
      readonly lintPass: boolean;
    } | null;
  };
  readonly cycles: readonly {
    readonly cycle: number;
    readonly strategy: string;
    readonly durationMs: number;
    readonly costUsd: number;
    readonly tokensUsed: number;
    readonly contextUsage: number;
    readonly contextIntervention?: string;
    readonly testsPass: boolean;
    readonly typecheckPass: boolean;
    readonly lintPass: boolean;
    readonly output: string;
    readonly verificationOutput: string;
  }[];
}

export function writeAutonomousProofBundle(input: AutonomousProofBundleInput): string {
  const proofDir = join(input.workingDir, ".wotann", "proofs");
  mkdirSync(proofDir, { recursive: true });

  const lastCycle = input.result.cycles[input.result.cycles.length - 1] ?? null;
  const bundle: AutonomousProofBundle = {
    generatedAt: new Date().toISOString(),
    task: input.task,
    summary: {
      success: input.result.success,
      exitReason: input.result.exitReason,
      totalCycles: input.result.totalCycles,
      totalDurationMs: input.result.totalDurationMs,
      totalCostUsd: input.result.totalCostUsd,
      totalTokens: input.result.totalTokens,
      providerOverride: input.providerOverride,
      modelOverride: input.modelOverride,
    },
    runtime: input.runtimeStatus ? {
      sessionId: input.runtimeStatus.sessionId,
      activeProvider: input.runtimeStatus.activeProvider ?? undefined,
      currentMode: input.runtimeStatus.currentMode,
      hookCount: input.runtimeStatus.hookCount,
      middlewareLayers: input.runtimeStatus.middlewareLayers,
      memoryEnabled: input.runtimeStatus.memoryEnabled,
      traceEntries: input.runtimeStatus.traceEntries,
      skillCount: input.runtimeStatus.skillCount,
    } : undefined,
    context: input.contextBudget ? {
      usagePercent: input.contextBudget.usagePercent,
      totalTokens: input.contextBudget.totalTokens,
      documentedMaxTokens: input.contextCapability?.documentedMaxTokens,
      activationMode: input.contextCapability?.activationMode,
      pressureLevel: input.contextBudget.pressureLevel,
    } : undefined,
    verification: {
      visualVerificationEnabled: input.visualVerificationEnabled ?? false,
      visualExpectation: input.visualExpectation,
      finalChecks: lastCycle ? {
        testsPass: lastCycle.testsPass,
        typecheckPass: lastCycle.typecheckPass,
        lintPass: lastCycle.lintPass,
      } : null,
    },
    cycles: input.result.cycles.map((cycle) => ({
      cycle: cycle.cycle,
      strategy: cycle.strategy,
      durationMs: cycle.durationMs,
      costUsd: cycle.costUsd,
      tokensUsed: cycle.tokensUsed,
      contextUsage: cycle.contextUsage,
      contextIntervention: cycle.contextIntervention,
      testsPass: cycle.testsPass,
      typecheckPass: cycle.typecheckPass,
      lintPass: cycle.lintPass,
      output: cycle.output,
      verificationOutput: cycle.verificationOutput,
    })),
  };

  const filePath = join(proofDir, `autonomous-${Date.now()}.json`);
  writeFileSync(filePath, JSON.stringify(bundle, null, 2));
  return filePath;
}
