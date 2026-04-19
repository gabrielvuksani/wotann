/**
 * Shared benchmark-runner primitives — corpus status, trajectory JSONL,
 * dry-run envelope, blocked-corpus error type.
 *
 * Every real-benchmark runner (terminal-bench, swe-bench, tau-bench,
 * aider-polyglot, code-eval) needs to do the same three things honestly:
 *   1. Declare BLOCKED-NEEDS-CORPUS when the official corpus is absent
 *      and no smoke-fallback is acceptable — with the exact fetch
 *      command so a caller can satisfy it.
 *   2. Support a --dry-run path that validates setup without executing
 *      tasks (so CI can exercise the runner shape without paying for
 *      LLM + Docker spin-up).
 *   3. Emit a per-task JSONL trajectory to ~/.wotann/bench-runs/<runId>.jsonl
 *      so runs are reproducible and auditable.
 *
 * This module centralises those three responsibilities. No LLM calls,
 * no Docker — pure fs + string.
 */

import { mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ── Blocked-corpus signal ─────────────────────────────

/**
 * Thrown by a runner's task loader when the official corpus is absent
 * and no smoke-fallback is acceptable for the caller's request (e.g.
 * full benchmark run, not a smoke test). The message includes the
 * exact shell command to fetch the corpus so the caller can satisfy
 * the dependency without additional investigation.
 */
export class BlockedCorpusError extends Error {
  readonly benchmark: string;
  readonly fetchCommand: string;
  readonly corpusPath: string;

  constructor(args: { benchmark: string; fetchCommand: string; corpusPath: string }) {
    const body = [
      `BLOCKED-NEEDS-CORPUS-DOWNLOAD`,
      ``,
      `Benchmark:  ${args.benchmark}`,
      `Expected:   ${args.corpusPath}`,
      ``,
      `Fetch with:`,
      `  ${args.fetchCommand}`,
    ].join("\n");
    super(body);
    this.name = "BlockedCorpusError";
    this.benchmark = args.benchmark;
    this.fetchCommand = args.fetchCommand;
    this.corpusPath = args.corpusPath;
  }
}

/** Type guard a caller can use to handle this specifically. */
export function isBlockedCorpusError(err: unknown): err is BlockedCorpusError {
  return err instanceof Error && err.name === "BlockedCorpusError";
}

// ── Dry-run envelope ──────────────────────────────────

export interface DryRunReport {
  readonly benchmark: string;
  /** True iff every precondition for a real run is met. */
  readonly ready: boolean;
  /** Per-check results for operator triage. */
  readonly checks: readonly DryRunCheck[];
  /** Count of tasks the runner would execute if the corpus is present. */
  readonly corpusSize: number;
  /** Optional fetch command when corpus missing. */
  readonly blockedReason?: string;
}

export interface DryRunCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export function makeDryRunReport(args: {
  benchmark: string;
  checks: readonly DryRunCheck[];
  corpusSize: number;
  blockedReason?: string;
}): DryRunReport {
  const ready = args.checks.every((c) => c.ok) && args.corpusSize > 0 && !args.blockedReason;
  const base: DryRunReport = {
    benchmark: args.benchmark,
    ready,
    checks: args.checks,
    corpusSize: args.corpusSize,
  };
  return args.blockedReason !== undefined ? { ...base, blockedReason: args.blockedReason } : base;
}

// ── Trajectory JSONL sink ─────────────────────────────

/**
 * Well-known location all runners emit to. Layered:
 *   ~/.wotann/bench-runs/<runId>.jsonl
 * Each line is a JSON object; no per-object comma delimiter so the file
 * is `tail -f`-friendly.
 */
export function trajectoryPathForRun(runId: string): string {
  return join(homedir(), ".wotann", "bench-runs", `${runId}.jsonl`);
}

/**
 * Open a trajectory sink. Returns a writer closure that appends one JSON
 * object per call. The directory is created on first use.
 *
 * Failure to open is non-fatal — the caller logs but the benchmark still
 * runs so a missing disk quota doesn't hide real results. Writer is
 * synchronous to keep the per-task append ordered.
 */
export interface TrajectoryWriter {
  readonly path: string;
  write(entry: unknown): void;
}

export function openTrajectoryWriter(runId: string): TrajectoryWriter {
  const path = trajectoryPathForRun(runId);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // non-fatal — writer will no-op on first append
    }
  }
  return {
    path,
    write: (entry: unknown): void => {
      try {
        appendFileSync(path, `${JSON.stringify(entry)}\n`);
      } catch {
        // non-fatal — best-effort audit trail
      }
    },
  };
}

// ── Score envelope (common shape runners emit per task) ─────

/**
 * Common envelope emitted per task. Runners may add flavour-specific
 * fields via the `meta` bag without changing this contract.
 */
export interface TaskScoreEnvelope {
  readonly task_id: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly cost: number;
  readonly score: number;
  readonly trajectory: readonly string[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

// ── Seeded shuffle ───────────────────────────────────

/**
 * Mulberry32 seeded shuffle. Extracted here so the five runners can
 * share one implementation instead of diverging.
 */
export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  let state = seed | 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
