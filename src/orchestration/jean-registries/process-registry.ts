/**
 * ProcessRegistry — Jean §2.4 port (WOTANN P1-C9, part 2/4).
 *
 * Tracks every process JeanOrchestrator has launched that has not yet
 * reached a terminal state. Maps pid → metadata (command name, start
 * time, status, optional session id, optional exit code).
 *
 * Mirrors `PROCESS_REGISTRY` from
 * https://github.com/coollabsio/jean/blob/main/src-tauri/src/chat/registry.rs.
 *
 * DESIGN NOTES:
 * - Per-instance `Map<pid, ProcessRecord>`. No module-global (Quality
 *   Bar #7); two orchestrators cannot clobber each other's tracking.
 * - Records are frozen on write. `update()` creates a new frozen copy
 *   (global immutability rule — global CLAUDE.md coding-style).
 * - `activeCount(commandName)` powers the concurrency-cap check inside
 *   the orchestrator — it counts anything NOT in a terminal state.
 * - Honest errors (ProcessRegistryError) for duplicate pids, invalid
 *   pids, and updates on unknown pids. No silent success.
 */

// ── Types ────────────────────────────────────────────────────────

export type ProcessStatus = "starting" | "running" | "exited" | "failed" | "killed";

const TERMINAL_STATUSES: ReadonlySet<ProcessStatus> = new Set(["exited", "failed", "killed"]);

export interface ProcessMeta {
  /** OS process id. Must be > 0. */
  readonly pid: number;
  /** Command registry key used to spawn this process. */
  readonly commandName: string;
  /** Wall-clock timestamp (ms since epoch) at spawn. */
  readonly startedAt: number;
  /** Lifecycle state — starts as "starting", transitions via update(). */
  readonly status: ProcessStatus;
  /** Optional session correlation id (maps to Jean session_id). */
  readonly sessionId?: string;
  /** Exit code once terminal (undefined until process exits). */
  readonly exitCode?: number;
}

export interface ProcessQuery {
  readonly status?: ProcessStatus;
  readonly commandName?: string;
}

// ── Registry ─────────────────────────────────────────────────────

export class ProcessRegistry {
  // Per-instance state (Quality Bar #7).
  private readonly byPid = new Map<number, ProcessMeta>();

  /**
   * Start tracking a process. Returns a frozen snapshot.
   * Throws ProcessRegistryError on invalid pid or duplicate.
   */
  add(meta: ProcessMeta): ProcessMeta {
    if (!Number.isInteger(meta.pid) || meta.pid <= 0) {
      throw new ProcessRegistryError(`Invalid pid: ${meta.pid}`);
    }
    if (!meta.commandName || meta.commandName.trim().length === 0) {
      throw new ProcessRegistryError(`pid ${meta.pid} has empty commandName`);
    }
    if (this.byPid.has(meta.pid)) {
      throw new ProcessRegistryError(`pid ${meta.pid} already tracked`);
    }

    const frozen = Object.freeze({ ...meta });
    this.byPid.set(meta.pid, frozen);
    return frozen;
  }

  /**
   * Immutable partial update. Returns the new frozen record.
   * Throws ProcessRegistryError if pid is unknown.
   */
  update(pid: number, patch: Partial<Omit<ProcessMeta, "pid">>): ProcessMeta {
    const existing = this.byPid.get(pid);
    if (!existing) {
      throw new ProcessRegistryError(`pid ${pid} not tracked`);
    }
    const next: ProcessMeta = Object.freeze({ ...existing, ...patch });
    this.byPid.set(pid, next);
    return next;
  }

  /**
   * Stop tracking a pid. Returns true if it was present.
   */
  remove(pid: number): boolean {
    return this.byPid.delete(pid);
  }

  has(pid: number): boolean {
    return this.byPid.has(pid);
  }

  get(pid: number): ProcessMeta | undefined {
    return this.byPid.get(pid);
  }

  /**
   * Filter tracked processes. An empty query returns everything.
   */
  query(filter: ProcessQuery): readonly ProcessMeta[] {
    const all = [...this.byPid.values()];
    return all.filter((p) => {
      if (filter.status !== undefined && p.status !== filter.status) return false;
      if (filter.commandName !== undefined && p.commandName !== filter.commandName) return false;
      return true;
    });
  }

  /**
   * Count processes for `commandName` that are NOT in a terminal state.
   * Used by the orchestrator's concurrency-cap check.
   */
  activeCount(commandName: string): number {
    let n = 0;
    for (const p of this.byPid.values()) {
      if (p.commandName !== commandName) continue;
      if (!TERMINAL_STATUSES.has(p.status)) n += 1;
    }
    return n;
  }
}

// ── Error Type ───────────────────────────────────────────────────

export class ProcessRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessRegistryError";
  }
}
