/**
 * `wotann sop "<task description>"` — V9 T12.7 CLI verb.
 *
 * Runs the MetaGPT-style PRD → Design → Code → QA pipeline and prints
 * a summary. Optionally writes the artifacts to a directory.
 *
 * Flags (consumed via runSopCommand opts; the index.ts entrypoint
 * threads them through):
 *   --idea=<text>        Task description (REQUIRED, also accepted as positional)
 *   --out=<dir>          Output directory; required when --emit is passed
 *   --emit               Materialize artifacts to disk; default is plan-only
 *   --max-retries=<n>    Per-stage retry budget on validation failure (default 1)
 *   --stages=<csv>       Override stages (default prd,design,code,qa)
 *
 * QB #6 — every failure mode emits a typed error; no silent successes.
 * QB #7 — per-call closures, no module globals, fresh state per invocation.
 * QB #13 — zero process.env reads. All inputs threaded via opts.
 */

import { resolve, dirname, join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

import type { PipelineResult, SopArtifact, SopModel, SopStage } from "../../sop/types.js";
import { STAGE_ORDER } from "../../sop/types.js";
import { runPipeline, summarizePipeline } from "../../sop/pipeline.js";

export interface SopCommandOptions {
  /** Free-form task description. REQUIRED. */
  readonly idea: string;
  /** The model to use across stages. Caller injects this — no env reads. */
  readonly model: SopModel;
  /** Output directory. REQUIRED when emit=true. */
  readonly outDir?: string;
  /** When true, write artifacts to disk. Default false (plan-only). */
  readonly emit?: boolean;
  /** Per-stage retry budget on validation failure. Default 1. */
  readonly maxRetries?: number;
  /** Overrideable stage list (default prd,design,code,qa). */
  readonly stages?: readonly SopStage[];
  /** Optional progress callback. */
  readonly onStageComplete?: (artifact: SopArtifact, attempts: number) => void;
  /** Force-overwrite existing artifact files. Default false. */
  readonly force?: boolean;
}

export type SopCommandResult =
  | {
      readonly ok: true;
      readonly result: PipelineResult;
      /** Paths written to disk; empty when emit=false. */
      readonly emitted: readonly string[];
      /** Human-readable summary suitable for stdout. */
      readonly summary: string;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Validate the stages CLI flag. Returns null on invalid input rather
 * than throwing. Strict — must be a non-empty prefix of STAGE_ORDER.
 */
export function parseStagesFlag(raw: string | undefined): readonly SopStage[] | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const validSet = new Set<SopStage>(STAGE_ORDER);
  for (const part of parts) {
    if (!validSet.has(part as SopStage)) return null;
  }
  // Stages must be a prefix of canonical order — pipeline expects monotonic.
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== STAGE_ORDER[i]) return null;
  }
  return parts as readonly SopStage[];
}

/**
 * Sanitize an artifact filename so we never write outside outDir.
 * Defensive — strips any path traversal and whitespace.
 */
function safeFilename(raw: string): string {
  const base = raw
    .replace(/[\s]+/g, "-")
    .replace(/^[./\\]+/g, "")
    .replace(/\.\.+/g, ".");
  // Strip leading slashes again after the dot collapse.
  return base.replace(/^[/\\]+/g, "") || "artifact.txt";
}

function emitArtifacts(
  artifacts: readonly SopArtifact[],
  outDir: string,
  force: boolean,
): { written: string[]; error: string | null } {
  const written: string[] = [];
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  for (const a of artifacts) {
    const filename = safeFilename(a.filename);
    const absPath = resolve(outDir, filename);
    if (existsSync(absPath) && !force) {
      return {
        written,
        error: `refusing to overwrite ${absPath} (pass --force to override)`,
      };
    }
    const parent = dirname(absPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    try {
      writeFileSync(absPath, a.content, "utf-8");
      written.push(absPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { written, error: `write failed for ${absPath}: ${msg}` };
    }
  }
  return { written, error: null };
}

/**
 * Run the SOP pipeline end-to-end. Pure-return semantics (always an
 * envelope). Per-call closures (no module-level mutable state).
 */
export async function runSopCommand(opts: SopCommandOptions): Promise<SopCommandResult> {
  if (typeof opts.idea !== "string" || opts.idea.trim().length === 0) {
    return { ok: false, error: "idea required (free-form task description)" };
  }
  if (opts.emit === true && (opts.outDir === undefined || opts.outDir.trim() === "")) {
    return { ok: false, error: "--emit requires --out=<dir>" };
  }
  if (opts.maxRetries !== undefined && (!Number.isFinite(opts.maxRetries) || opts.maxRetries < 0)) {
    return { ok: false, error: "--max-retries must be a non-negative integer" };
  }

  const result = await runPipeline({
    idea: opts.idea,
    model: opts.model,
    maxRetriesPerStage: opts.maxRetries ?? 1,
    ...(opts.stages !== undefined ? { stages: opts.stages } : {}),
    ...(opts.onStageComplete !== undefined ? { onStageComplete: opts.onStageComplete } : {}),
  });

  let emitted: readonly string[] = [];
  if (opts.emit === true) {
    const outDir = resolve(opts.outDir as string);
    const { written, error } = emitArtifacts(result.artifacts, outDir, opts.force === true);
    if (error) {
      return { ok: false, error };
    }
    emitted = written;
  }

  return {
    ok: true,
    result,
    emitted,
    summary: summarizePipeline(result),
  };
}

/**
 * Format a one-line CLI banner showing where artifacts land. Caller
 * uses this for `wotann sop --emit` printing.
 */
export function formatEmitBanner(emitted: readonly string[]): string {
  if (emitted.length === 0) return "no artifacts written (plan-only)";
  const sample = emitted
    .slice(0, 3)
    .map((p) => `  ${p}`)
    .join("\n");
  if (emitted.length <= 3) return `wrote ${emitted.length} artifact(s):\n${sample}`;
  return `wrote ${emitted.length} artifact(s):\n${sample}\n  ... and ${emitted.length - 3} more`;
}

/**
 * Resolve the default output directory for `wotann sop --emit` when
 * the caller doesn't supply --out. We never default to cwd silently;
 * callers must opt in explicitly.
 */
export function defaultOutDirHint(rootDir: string, projectSlug: string): string {
  const slug = projectSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return join(rootDir, ".wotann", "sop", slug || "anonymous");
}
