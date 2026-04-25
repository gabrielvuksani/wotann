/**
 * SOP Pipeline orchestrator — chain PRD → Design → Code → QA stages.
 *
 * V9 T12.7: ports MetaGPT's role-based pipeline. The orchestrator is
 * pure-logic: callers inject the model + the (optional) custom stage
 * writers. By default it composes the four shipped writers:
 *   prd-writer, design-writer, code-generator, qa
 *
 * The fifth stage (`deploy`) is intentionally a separate skill that
 * lives outside this module — deployment touches disk + network and
 * needs explicit user approval. The pipeline stops after `qa` and
 * returns the artifact list; the caller decides whether to chain a
 * deploy step.
 *
 * Hand-off shape
 * ──────────────
 * Each stage receives `priorArtifacts: readonly SopArtifact[]` and
 * pulls only what it needs. The orchestrator records the artifact
 * even when validation fails, retries up to N times, then either
 * proceeds (if validation eventually passes) or marks the pipeline
 * `blocked` and returns.
 *
 * Quality bars
 *   QB #6  honest failures   — no silent success on stage failure
 *   QB #7  per-call state    — every runPipeline call gets fresh
 *                              retry counters; no module globals
 *   QB #13 env guard         — zero process.env reads
 *   QB #14 claim verify      — `outcome` reflects the actual stage outcome
 */

import type {
  PipelineResult,
  SopArtifact,
  SopModel,
  SopStage,
  StageWriter,
  StageWriterInput,
} from "./types.js";
import { STAGE_ORDER } from "./types.js";
import { prdWriter } from "./stages/prd-writer.js";
import { designWriter } from "./stages/design-writer.js";
import { codeGenerator } from "./stages/code-generator.js";
import { qaWriter, qaVerdictDecision } from "./stages/qa.js";

export interface PipelineOptions {
  /** The product idea (free-form 1-line description). */
  readonly idea: string;
  /** The model used for all stages, or a per-stage override map. */
  readonly model: SopModel | Readonly<Partial<Record<SopStage, SopModel>>>;
  /** Override individual stage writers (test injection). */
  readonly writers?: Readonly<Partial<Record<SopStage, StageWriter>>>;
  /** Max retries per stage on validation failure. Default 1. */
  readonly maxRetriesPerStage?: number;
  /**
   * Stages to run, in order. Default = ["prd", "design", "code", "qa"].
   * The "deploy" stage is excluded by default — see module docstring.
   */
  readonly stages?: readonly SopStage[];
  /** Clock for deterministic tests. Default `() => Date.now()`. */
  readonly now?: () => number;
  /** Optional callback fired after each stage completes (or fails). */
  readonly onStageComplete?: (artifact: SopArtifact, attempts: number) => void;
}

const DEFAULT_STAGES: readonly SopStage[] = ["prd", "design", "code", "qa"];
const DEFAULT_MAX_RETRIES = 1;

/**
 * The default writer registry — one per stage. Keeping this here
 * (not at module-load) makes it easy to override for tests via
 * `options.writers`.
 */
function defaultWriters(): Readonly<Record<SopStage, StageWriter>> {
  return {
    prd: prdWriter,
    design: designWriter,
    code: codeGenerator,
    qa: qaWriter,
    // deploy is intentionally absent — see docstring
    deploy: {
      stage: "deploy",
      writeArtifact: async () => ({
        ok: false,
        error: "deploy stage is not bundled with the default pipeline",
      }),
    },
  };
}

function pickModel(model: PipelineOptions["model"], stage: SopStage): SopModel | null {
  if (typeof (model as SopModel).query === "function") {
    return model as SopModel;
  }
  const map = model as Readonly<Partial<Record<SopStage, SopModel>>>;
  return map[stage] ?? null;
}

/**
 * Run the full SOP pipeline. Returns a PipelineResult — never throws.
 * Per-call closures (no module-level mutable state).
 */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const idea = options.idea?.trim() ?? "";
  const stages = options.stages ?? DEFAULT_STAGES;
  const maxRetries = options.maxRetriesPerStage ?? DEFAULT_MAX_RETRIES;
  const now = options.now ?? ((): number => Date.now());
  const startedAt = now();

  if (idea.length === 0) {
    return {
      outcome: "blocked",
      artifacts: [],
      totalDurationMs: 0,
      retryCounts: {},
    };
  }

  // Verify stage order matches the canonical sequence prefix.
  for (let i = 0; i < stages.length; i++) {
    if (stages[i] !== STAGE_ORDER[i]) {
      return {
        outcome: "blocked",
        blockedAtStage: stages[i],
        artifacts: [],
        totalDurationMs: now() - startedAt,
        retryCounts: {},
      };
    }
  }

  const writers: Readonly<Record<SopStage, StageWriter>> = {
    ...defaultWriters(),
    ...(options.writers ?? {}),
  };

  // Per-call mutable accumulators (encapsulated; never module-level).
  const artifacts: SopArtifact[] = [];
  const retryCounts: Partial<Record<SopStage, number>> = {};

  for (const stage of stages) {
    const writer = writers[stage];
    const model = pickModel(options.model, stage);
    if (!model) {
      return {
        outcome: "blocked",
        blockedAtStage: stage,
        artifacts: [...artifacts],
        totalDurationMs: now() - startedAt,
        retryCounts: { ...retryCounts },
      };
    }

    let attempts = 0;
    let successful: SopArtifact | null = null;
    let lastError: string | undefined;

    while (attempts <= maxRetries) {
      attempts += 1;
      const input: StageWriterInput = {
        idea,
        priorArtifacts: artifacts,
        model,
      };
      const result = await writer.writeArtifact(input);
      if (!result.ok) {
        lastError = result.error;
        if (attempts > maxRetries) break;
        continue;
      }
      // Validation pass-through — even when it fails we may retry.
      if (result.artifact.validation.valid) {
        successful = result.artifact;
        break;
      }
      lastError = `validation failed: ${result.artifact.validation.errors.join(", ")}`;
      // Retry budget check.
      if (attempts > maxRetries) {
        // Emit the failing artifact so the caller can inspect it.
        if (options.onStageComplete) options.onStageComplete(result.artifact, attempts);
        artifacts.push(result.artifact);
        retryCounts[stage] = attempts - 1;
        return {
          outcome: "blocked",
          blockedAtStage: stage,
          artifacts: [...artifacts],
          totalDurationMs: now() - startedAt,
          retryCounts: { ...retryCounts },
        };
      }
    }

    retryCounts[stage] = Math.max(0, attempts - 1);

    if (!successful) {
      // Hit retry cap on a non-ok writer result (no artifact emitted).
      // Surface the error through retryCounts; callers compare with
      // `outcome: "blocked"` to detect.
      void lastError;
      return {
        outcome: "blocked",
        blockedAtStage: stage,
        artifacts: [...artifacts],
        totalDurationMs: now() - startedAt,
        retryCounts: { ...retryCounts },
      };
    }

    if (options.onStageComplete) options.onStageComplete(successful, attempts);
    artifacts.push(successful);

    // QA verdict gate — if QA reports FAIL we block the pipeline even
    // when the artifact validates structurally.
    if (stage === "qa") {
      const decision = qaVerdictDecision(successful);
      if (decision.kind === "block") {
        return {
          outcome: "blocked",
          blockedAtStage: "qa",
          artifacts: [...artifacts],
          totalDurationMs: now() - startedAt,
          retryCounts: { ...retryCounts },
        };
      }
    }
  }

  return {
    outcome: "success",
    artifacts: [...artifacts],
    totalDurationMs: now() - startedAt,
    retryCounts: { ...retryCounts },
  };
}

/**
 * Helper to summarize pipeline output into a one-paragraph string —
 * useful for CLI printing.
 */
export function summarizePipeline(result: PipelineResult): string {
  const lines: string[] = [];
  lines.push(`outcome: ${result.outcome}`);
  if (result.blockedAtStage) lines.push(`blocked at: ${result.blockedAtStage}`);
  lines.push(`artifacts: ${result.artifacts.length}`);
  for (const a of result.artifacts) {
    const status = a.validation.valid ? "valid" : "INVALID";
    lines.push(`  - ${a.stage}: ${a.filename} (${status})`);
  }
  lines.push(`duration: ${result.totalDurationMs}ms`);
  const retryStages = Object.keys(result.retryCounts);
  if (retryStages.length > 0) {
    const parts = retryStages.map((s) => `${s}=${result.retryCounts[s as SopStage]}`);
    lines.push(`retries: ${parts.join(", ")}`);
  }
  return lines.join("\n");
}
