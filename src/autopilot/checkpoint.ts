/**
 * Long-horizon autopilot checkpointing — Phase 4 Sprint B2 item 19.
 *
 * Long-running benchmarks (MLE-bench full run: 12-48 hours; OSWorld:
 * 4-8 hours; SWE-bench Verified with 500+ tasks: 6+ hours) cannot
 * assume the process survives end-to-end. Machine sleeps, laptop lids
 * close, CI runners pre-empt. Without checkpointing, a single crash
 * throws away hours of real-dollar API spend.
 *
 * This module ships a PURE persistence layer:
 *   - AutopilotCheckpoint — immutable snapshot type
 *   - saveCheckpoint(path, cp) — atomic write to disk (tmp + rename)
 *   - loadCheckpoint(path) — load + validate + return
 *   - findResumableCheckpoint(dir, taskId) — locate latest matching
 *   - pruneOldCheckpoints(dir, keep) — GC old ones
 *
 * The autopilot runner calls saveCheckpoint after every iteration and
 * loadCheckpoint at startup. This file has no dependency on the runner
 * itself — it's a plain state-serializer so tests can verify invariants
 * without spinning up a full autopilot loop.
 */

import { readFile, writeFile, rename, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { AutopilotArtifact, VerificationEvidence } from "./types.js";

// ── Types ──────────────────────────────────────────────

/**
 * Checkpoint schema version — bump when the shape changes incompatibly
 * so old checkpoints get rejected rather than mis-loaded.
 */
export const CHECKPOINT_VERSION = 1;

export interface AutopilotCheckpoint {
  readonly version: number;
  /** Stable id for the task being executed — used as resume key. */
  readonly taskId: string;
  /** ISO timestamp when this checkpoint was written. */
  readonly savedAt: string;
  /** Iteration count at time of save (0-based). */
  readonly iteration: number;
  /** autopilotContinues count at time of save. */
  readonly continuesSoFar: number;
  /** Cumulative wall-clock ms spent on this task across all resumes. */
  readonly elapsedMs: number;
  /** Cumulative USD spent across all resumes. */
  readonly usdSpent: number;
  /** Evidence collected so far. */
  readonly evidence: readonly VerificationEvidence[];
  /** Artifacts collected so far. */
  readonly artifacts: readonly AutopilotArtifact[];
  /** Last message the autopilot sent to the model (for resumption prompt). */
  readonly lastPrompt?: string;
  /** Last response from the model. */
  readonly lastResponse?: string;
  /** Hash-of-working-tree — detect if the repo diverged between resumes. */
  readonly workingTreeHash: string;
  /** Any caller-provided metadata (small, JSON-serialisable). */
  readonly metadata?: Record<string, unknown>;
}

export interface CheckpointSaveOptions {
  /** Overwrite existing checkpoint at the path. Default true. */
  readonly overwrite?: boolean;
}

// ── Persistence ────────────────────────────────────────

/**
 * Save a checkpoint atomically: write to tmp, rename into place. This
 * prevents a crash-mid-write from leaving a corrupt JSON file.
 */
export async function saveCheckpoint(
  path: string,
  checkpoint: AutopilotCheckpoint,
  options: CheckpointSaveOptions = {},
): Promise<void> {
  const overwrite = options.overwrite ?? true;
  const abs = resolve(path);
  await mkdir(resolve(abs, ".."), { recursive: true });

  if (!overwrite) {
    try {
      await stat(abs);
      throw new Error(`saveCheckpoint: ${abs} already exists and overwrite=false`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  const tmp = `${abs}.tmp-${Date.now()}`;
  const json = JSON.stringify(checkpoint, null, 2);
  await writeFile(tmp, json, "utf-8");
  await rename(tmp, abs);
}

/**
 * Load a checkpoint from disk. Validates the schema version and rejects
 * mismatches (so callers can discard stale checkpoints gracefully).
 */
export async function loadCheckpoint(path: string): Promise<AutopilotCheckpoint> {
  const raw = await readFile(resolve(path), "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`loadCheckpoint: invalid JSON at ${path}: ${(err as Error).message}`);
  }
  const cp = parsed as AutopilotCheckpoint;
  if (!cp || typeof cp !== "object") {
    throw new Error(`loadCheckpoint: expected object, got ${typeof cp}`);
  }
  if (cp.version !== CHECKPOINT_VERSION) {
    throw new Error(
      `loadCheckpoint: version mismatch — file=${cp.version}, runtime=${CHECKPOINT_VERSION}`,
    );
  }
  if (typeof cp.taskId !== "string" || !cp.taskId) {
    throw new Error("loadCheckpoint: missing taskId");
  }
  if (typeof cp.iteration !== "number" || cp.iteration < 0) {
    throw new Error("loadCheckpoint: invalid iteration");
  }
  return cp;
}

/**
 * Find the most recent checkpoint for a given taskId in a directory.
 * Returns null when no matching file exists.
 *
 * Checkpoint files follow the naming convention:
 *   {taskId}.{timestamp}.checkpoint.json
 */
export async function findResumableCheckpoint(
  dir: string,
  taskId: string,
): Promise<AutopilotCheckpoint | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const prefix = `${taskId}.`;
  const matches = entries.filter(
    (name) => name.startsWith(prefix) && name.endsWith(".checkpoint.json"),
  );
  if (matches.length === 0) return null;
  // Sort by timestamp descending — most recent first
  matches.sort().reverse();
  for (const name of matches) {
    try {
      return await loadCheckpoint(join(dir, name));
    } catch {
      continue; // try next older checkpoint
    }
  }
  return null;
}

/**
 * Delete old checkpoints for the given taskId, keeping the N most recent.
 * Returns the number of files deleted.
 */
export async function pruneOldCheckpoints(
  dir: string,
  taskId: string,
  keep: number = 3,
): Promise<number> {
  if (keep < 0) throw new Error("pruneOldCheckpoints: keep must be >= 0");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  const prefix = `${taskId}.`;
  const matches = entries
    .filter((name) => name.startsWith(prefix) && name.endsWith(".checkpoint.json"))
    .sort()
    .reverse();
  if (matches.length <= keep) return 0;
  const toDelete = matches.slice(keep);
  let deleted = 0;
  for (const name of toDelete) {
    try {
      await unlink(join(dir, name));
      deleted++;
    } catch {
      // ignore — best-effort GC
    }
  }
  return deleted;
}

/**
 * Make a checkpoint filename for a given taskId. Monotonically-increasing
 * timestamp suffix makes chronological sorting trivial.
 */
export function checkpointFilename(taskId: string, at: Date = new Date()): string {
  const ts = at.toISOString().replace(/[^0-9]/g, "");
  return `${taskId}.${ts}.checkpoint.json`;
}

// ── Working-tree fingerprint ──────────────────────────

/**
 * Hash a small set of file paths for divergence detection. If the repo
 * content changed between checkpoint-save and checkpoint-load, the
 * caller should reject the resume (state is stale).
 *
 * Not a cryptographic fingerprint — just a cheap way to spot obvious
 * mismatch. Skips files that don't exist.
 */
export async function hashWorkingTree(
  files: readonly string[],
  workDir: string = process.cwd(),
): Promise<string> {
  const hasher = createHash("sha256");
  // Sort for determinism — same files in different order should hash identical
  const sorted = [...files].sort();
  for (const rel of sorted) {
    try {
      const content = await readFile(resolve(workDir, rel), "utf-8");
      hasher.update(`${rel}\0${content}\0`);
    } catch {
      hasher.update(`${rel}\0MISSING\0`);
    }
  }
  return hasher.digest("hex").slice(0, 16);
}

// ── Resumption semantics ──────────────────────────────

export interface ResumeDecision {
  readonly action: "resume" | "start-fresh" | "discard-stale";
  readonly reason: string;
  readonly checkpoint?: AutopilotCheckpoint;
}

/**
 * Given a found checkpoint + the current working-tree hash, decide
 * whether to resume, start fresh, or discard the checkpoint as stale.
 *
 * Rules:
 *   - No checkpoint → start-fresh
 *   - Version mismatch → discard-stale (already thrown by loadCheckpoint)
 *   - Working-tree hash mismatch → discard-stale (repo changed)
 *   - Checkpoint older than maxAgeMs → discard-stale (expired)
 *   - Otherwise → resume
 */
export function decideResume(
  checkpoint: AutopilotCheckpoint | null,
  currentWorkingTreeHash: string,
  options: { readonly maxAgeMs?: number; readonly now?: () => number } = {},
): ResumeDecision {
  const maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  const now = options.now ?? (() => Date.now());

  if (!checkpoint) {
    return { action: "start-fresh", reason: "no checkpoint found" };
  }

  if (checkpoint.workingTreeHash !== currentWorkingTreeHash) {
    return {
      action: "discard-stale",
      reason: `working-tree hash mismatch (${checkpoint.workingTreeHash} != ${currentWorkingTreeHash})`,
      checkpoint,
    };
  }

  const savedAt = new Date(checkpoint.savedAt).getTime();
  if (Number.isFinite(savedAt) && now() - savedAt > maxAgeMs) {
    return {
      action: "discard-stale",
      reason: `checkpoint is older than ${Math.round(maxAgeMs / 3600_000)}h`,
      checkpoint,
    };
  }

  return {
    action: "resume",
    reason: `resuming from iteration ${checkpoint.iteration} (${checkpoint.evidence.length} evidence, ${checkpoint.artifacts.length} artifacts)`,
    checkpoint,
  };
}
