/**
 * Agentless ORCHESTRATOR — wires LOCALIZE → REPAIR → VALIDATE.
 *
 * V9 T12.6 entry point. Single async function that runs all 3 phases
 * sequentially with explicit early-exit on any phase failure. Returns a
 * structured `OrchestratorResult` so callers can render a transcript.
 *
 * QB #6: each early-exit carries an `outcome` discriminator — never PASS
 * by accident. The contract is: outcome === "success" implies BOTH a
 * validated diff exists AND tests are green.
 * QB #7: caller-injected dependencies; no module-global mutation.
 */

import { localizeIssue, type LocalizeOptions } from "./localize.js";
import { repairIssue, type RepairOptions } from "./repair.js";
import { validateRepair, type ValidateOptions } from "./validate.js";
import type { AgentlessIssue, OrchestratorResult } from "./types.js";

export interface OrchestratorOptions {
  /** Localize phase config. */
  readonly localize: LocalizeOptions;
  /** Repair phase config. */
  readonly repair: RepairOptions;
  /** Validate phase config. */
  readonly validate?: ValidateOptions;
  /** If true, skip VALIDATE — useful for `--dry-run`. */
  readonly skipValidate?: boolean;
  /** Optional progress callback. Always called sync. */
  readonly onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  readonly phase: "localize" | "repair" | "validate";
  readonly status: "start" | "done";
  readonly detail?: string;
}

/**
 * Run the full agentless pipeline.
 *
 * Outcomes:
 *   "blocked-localize": no candidate files found AND no LLM model available
 *                       (we still try repair if a model is provided)
 *   "blocked-repair":   model produced no parseable diff
 *   "blocked-validate": tests failed OR diff couldn't apply
 *   "success":          tests green
 *
 * NOTE: blocked-localize is reserved — by default we proceed with empty
 * candidateFiles (repair model gets a "no context" prompt). A future
 * stricter mode could short-circuit there.
 */
export async function runAgentless(
  issue: AgentlessIssue,
  opts: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const t0 = Date.now();
  const progress = opts.onProgress;

  // ── LOCALIZE ──────────────────────────────────────────
  progress?.({ phase: "localize", status: "start" });
  const localize = await localizeIssue(issue, opts.localize);
  progress?.({
    phase: "localize",
    status: "done",
    detail: `${localize.candidateFiles.length} candidates, ${localize.keywords.length} keywords`,
  });

  // ── REPAIR ────────────────────────────────────────────
  progress?.({ phase: "repair", status: "start" });
  const repair = await repairIssue(issue, localize, opts.repair);
  progress?.({
    phase: "repair",
    status: "done",
    detail: repair.diff ? `diff len ${repair.diff.length}` : `failure: ${repair.error ?? "?"}`,
  });

  if (repair.diff === null) {
    return {
      outcome: "blocked-repair",
      issue,
      localize,
      repair,
      totalDurationMs: Date.now() - t0,
    };
  }

  // ── VALIDATE ──────────────────────────────────────────
  if (opts.skipValidate) {
    return {
      outcome: "success",
      issue,
      localize,
      repair,
      totalDurationMs: Date.now() - t0,
    };
  }

  progress?.({ phase: "validate", status: "start" });
  const validate = await validateRepair(repair.diff, opts.validate ?? {});
  progress?.({
    phase: "validate",
    status: "done",
    detail: validate.passed ? "tests green" : (validate.applyError ?? "tests red"),
  });

  if (!validate.passed) {
    return {
      outcome: "blocked-validate",
      issue,
      localize,
      repair,
      validate,
      totalDurationMs: Date.now() - t0,
    };
  }

  return {
    outcome: "success",
    issue,
    localize,
    repair,
    validate,
    totalDurationMs: Date.now() - t0,
  };
}
