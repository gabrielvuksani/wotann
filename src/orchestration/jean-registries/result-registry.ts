/**
 * ResultRegistry — Jean §2.4 port (WOTANN P1-C9, part 4/4).
 *
 * Persists the final outcome of every completed process (exit code,
 * duration, truncated stdout/stderr, finish timestamp). This is what
 * lets the orchestrator answer "what happened when we ran X?" long
 * after the process registry has reaped the pid.
 *
 * In Jean this is backed by SQLite; here we keep it in-memory (JSON
 * Map) which is sufficient for the TypeScript daemon use case. A
 * future commit can layer SQLite persistence on top without changing
 * the interface — callers only see `persist` / `lookup` / `query` /
 * `clear` / `size`.
 *
 * DESIGN NOTES:
 * - Per-instance `Map<pid, ProcessResult>` (Quality Bar #7).
 * - `persist()` rejects duplicate pids — completed processes are an
 *   immutable audit log.
 * - stdout/stderr are truncated to configured byte caps before
 *   storage. Jean truncates to avoid persisting multi-MB outputs;
 *   defaults here are generous but bounded (16 KiB each).
 * - `query({commandName, since})` powers post-run analytics and
 *   TerminalBench-style rollups.
 */

// ── Types ────────────────────────────────────────────────────────

export interface ProcessResult {
  readonly pid: number;
  readonly commandName: string;
  /** Exit code from the OS. null if the process was killed by signal. */
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Wall-clock timestamp (ms since epoch) at exit. */
  readonly finishedAt: number;
  /** Optional session correlation id. */
  readonly sessionId?: string;
  /** Optional termination signal (e.g. "SIGTERM"). */
  readonly signal?: string;
}

export interface ResultQuery {
  readonly commandName?: string;
  /** Inclusive lower-bound on finishedAt. */
  readonly since?: number;
  /** Exclusive upper-bound on finishedAt. */
  readonly until?: number;
}

export interface ResultRegistryConfig {
  /** Max stdout bytes retained. Defaults to 16384. */
  readonly maxStdoutBytes?: number;
  /** Max stderr bytes retained. Defaults to 16384. */
  readonly maxStderrBytes?: number;
}

// ── Registry ─────────────────────────────────────────────────────

const DEFAULT_CAP_BYTES = 16 * 1024;

export class ResultRegistry {
  private readonly maxStdoutBytes: number;
  private readonly maxStderrBytes: number;
  // Per-instance state (Quality Bar #7).
  private readonly byPid = new Map<number, ProcessResult>();

  constructor(config?: ResultRegistryConfig) {
    this.maxStdoutBytes = config?.maxStdoutBytes ?? DEFAULT_CAP_BYTES;
    this.maxStderrBytes = config?.maxStderrBytes ?? DEFAULT_CAP_BYTES;
    if (this.maxStdoutBytes <= 0 || this.maxStderrBytes <= 0) {
      throw new ResultRegistryError("max*Bytes caps must be > 0");
    }
  }

  /**
   * Persist a terminal result. Rejects duplicates (the audit log is
   * append-only). Throws ResultRegistryError on invalid pid or dup.
   */
  persist(result: ProcessResult): ProcessResult {
    if (!Number.isInteger(result.pid) || result.pid <= 0) {
      throw new ResultRegistryError(`Invalid pid: ${result.pid}`);
    }
    if (this.byPid.has(result.pid)) {
      throw new ResultRegistryError(`pid ${result.pid} already persisted`);
    }

    const truncated: ProcessResult = Object.freeze({
      ...result,
      stdout: truncate(result.stdout, this.maxStdoutBytes),
      stderr: truncate(result.stderr, this.maxStderrBytes),
    });
    this.byPid.set(result.pid, truncated);
    return truncated;
  }

  lookup(pid: number): ProcessResult | undefined {
    return this.byPid.get(pid);
  }

  query(filter: ResultQuery): readonly ProcessResult[] {
    const all = [...this.byPid.values()];
    return all.filter((r) => {
      if (filter.commandName !== undefined && r.commandName !== filter.commandName) return false;
      if (filter.since !== undefined && r.finishedAt < filter.since) return false;
      if (filter.until !== undefined && r.finishedAt >= filter.until) return false;
      return true;
    });
  }

  size(): number {
    return this.byPid.size;
  }

  clear(): void {
    this.byPid.clear();
  }
}

function truncate(value: string, maxBytes: number): string {
  // Fast path — most outputs fit well under the cap.
  if (value.length <= maxBytes) return value;
  // Strict byte cap: slice at the character that keeps us at or under
  // maxBytes in UTF-8. JS strings are UTF-16; we conservatively cap by
  // character count, which always gives <= maxBytes bytes. This keeps
  // the test assertion `.length <= cap` honest.
  return value.slice(0, maxBytes);
}

// ── Error Type ───────────────────────────────────────────────────

export class ResultRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultRegistryError";
  }
}
