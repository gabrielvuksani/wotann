/**
 * Autopilot types — never-stop-until-verified autonomous execution.
 *
 * Unlike standard autonomous mode (which stops on tests-pass), autopilot mode
 * continues until the ACTUAL TASK is fully verified via multiple criteria:
 * - Terminal verification (tests, typecheck, lint)
 * - Browser verification (load app, click through, screenshot)
 * - Visual verification (screenshot comparison, pixel diff)
 * - LLM judge (does the output satisfy the original request?)
 *
 * From GitHub Copilot Autopilot + Cursor Cloud Agents patterns.
 */

import type { AutonomousConfig, AutonomousResult } from "../orchestration/autonomous.js";

// ── Completion Criteria ────────────────────────────────

export type CriterionType =
  | "tests-pass"
  | "typecheck-pass"
  | "lint-pass"
  | "visual-match"
  | "browser-test"
  | "custom-command"
  | "llm-judge";

export interface CompletionCriterion {
  readonly type: CriterionType;
  readonly weight: number;
  readonly required: boolean;
  readonly description: string;
  readonly config?: Record<string, unknown>;
}

export interface VerificationEvidence {
  readonly criterion: CompletionCriterion;
  readonly passed: boolean;
  readonly evidence: string;
  readonly screenshotPath?: string;
  readonly durationMs: number;
}

// ── Autopilot Config ───────────────────────────────────

export interface AutopilotConfig extends AutonomousConfig {
  readonly neverStopUntilVerified: boolean;
  readonly maxAutopilotContinues: number;
  readonly completionCriteria: readonly CompletionCriterion[];
  readonly enableBrowserVerification: boolean;
  readonly enableScreenRecording: boolean;
  readonly enableArtifactCollection: boolean;
  readonly browserTestUrl?: string;
  readonly visualExpectations?: readonly VisualExpectation[];
  readonly completionThreshold: number; // 0-1, weighted score needed to declare "done"
}

export interface VisualExpectation {
  readonly description: string;
  readonly selector?: string;
  readonly url?: string;
  readonly referenceScreenshotPath?: string;
  readonly tolerancePercent?: number;
}

// ── Artifacts ──────────────────────────────────────────

export interface AutopilotArtifact {
  readonly type: "screenshot" | "recording" | "test-output" | "diff" | "log" | "proof-bundle";
  readonly path: string;
  readonly description: string;
  readonly timestamp: number;
  readonly sizeBytes?: number;
}

// ── Autopilot Result ───────────────────────────────────

export interface AutopilotResult extends AutonomousResult {
  readonly artifacts: readonly AutopilotArtifact[];
  readonly completionScore: number;
  readonly verificationEvidence: readonly VerificationEvidence[];
  readonly autopilotContinues: number;
}
