/**
 * SOP (Standard Operating Procedure) — type definitions.
 *
 * V9 T12.7: ports MetaGPT's role-based pipeline. The original paper has
 * 4 roles (PM → Architect → Engineer → QA); this implementation uses
 * 5 stages (PRD → Design → Code → QA → Deploy) to give an explicit
 * deploy-readiness gate before claiming success.
 *
 * Each stage emits a typed `SopArtifact` and validates it before the next
 * stage starts. Stages can retry up to N times on validation failure.
 */

/**
 * Stages map 1:1 to roles in the pipeline. Order is fixed (mirror the
 * MetaGPT contract: PM owns PRD, Architect owns design, etc.).
 */
export type SopStage = "prd" | "design" | "code" | "qa" | "deploy";

export const STAGE_ORDER: readonly SopStage[] = ["prd", "design", "code", "qa", "deploy"] as const;

/**
 * Content type of a stage artifact. Used to choose a parser/validator
 * downstream — e.g. design.json must be JSON-parseable, code.* artifacts
 * must compile-check pass.
 */
export type SopContentType = "markdown" | "typescript" | "json" | "sql" | "yaml" | "shell";

/**
 * A single artifact produced by a stage. `content` is the raw text;
 * `validation` is set by the writer immediately after generation.
 *
 * QB #14: validation is a discriminated union — callers cannot ignore
 * the `valid: false` branch and silently treat as success.
 */
export interface SopArtifact {
  readonly stage: SopStage;
  readonly filename: string;
  readonly contentType: SopContentType;
  readonly content: string;
  readonly validation:
    | { readonly valid: true }
    | { readonly valid: false; readonly errors: readonly string[] };
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly createdAt: number;
}

/**
 * Pluggable model contract for the pipeline. Same shape as agentless —
 * narrow on purpose so each stage can pick its own model (e.g. cheap
 * Haiku for QA, Opus for design).
 */
export interface SopModel {
  readonly name: string;
  query(
    prompt: string,
    opts?: { readonly maxTokens?: number },
  ): Promise<{
    readonly text: string;
    readonly tokensIn: number;
    readonly tokensOut: number;
  }>;
}

/**
 * Stage-writer contract — each stage exposes a function with this signature.
 * Returns a single artifact OR an error result. Never throws.
 *
 * `priorArtifacts` is the immutable list of all upstream artifacts in
 * order. Stage writers pull what they need (e.g. design pulls PRD).
 */
export interface StageWriter {
  readonly stage: SopStage;
  readonly writeArtifact: (input: StageWriterInput) => Promise<StageWriterResult>;
}

export interface StageWriterInput {
  readonly idea: string;
  readonly priorArtifacts: readonly SopArtifact[];
  readonly model: SopModel;
}

export type StageWriterResult =
  | { readonly ok: true; readonly artifact: SopArtifact }
  | { readonly ok: false; readonly error: string };

/**
 * Pipeline outcome — emitted by the orchestrator.
 */
export interface PipelineResult {
  readonly outcome: "success" | "blocked";
  readonly blockedAtStage?: SopStage;
  readonly artifacts: readonly SopArtifact[];
  readonly totalDurationMs: number;
  readonly retryCounts: Readonly<Partial<Record<SopStage, number>>>;
}
