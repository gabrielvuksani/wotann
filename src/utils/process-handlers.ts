/**
 * Process-level fault handlers — V9 Wave 6-RR (SB-9 audit fix).
 *
 * Node ≥15 changed the default unhandled-rejection behavior to "throw,
 * which means PROCESS EXIT 1". A single async path that forgets to
 * `await` and rejects will silently kill the daemon (or the CLI) with no
 * log entry, no graceful shutdown, no PID-file cleanup. This module
 * installs structured handlers for both `uncaughtException` and
 * `unhandledRejection` so failures are observable and recoverable.
 *
 * Per QB#6 (honest stubs / honest reporting): we never swallow the error
 * silently. Per QB#7 (per-process state): handlers are installed exactly
 * once per process (idempotent) and capture the optional log writer at
 * install time rather than reading from module-global mutable state.
 *
 * Behavior:
 * - uncaughtException: log + optional appendLog + re-exit 1 unless
 *   `keepAlive: true`. Default exit-1 matches Node's pre-15 historical
 *   default and matches what an external supervisor (launchd, systemd)
 *   would expect to restart on.
 * - unhandledRejection: log + optional appendLog + KEEP RUNNING. We do
 *   not exit on unhandled rejections because the daemon serves long-
 *   running connections and a single async miss should not tear down
 *   every active session. The signal is the log entry.
 *
 * Both handlers ALWAYS emit a structured JSON line to stderr so log
 * aggregators can parse without regex on free-form prose.
 */

import type { Writable } from "node:stream";

export interface ProcessHandlerOptions {
  /**
   * Optional structured logger. When provided, every fault is also
   * dispatched here in addition to stderr. The daemon passes its
   * appendLog method; the CLI typically passes nothing.
   */
  readonly appendLog?: (entry: { type: "error"; message: string; data?: unknown }) => void;
  /**
   * If true, uncaughtException does NOT exit the process. Default false.
   * Only set true in supervisor-less contexts (e.g. unit-test harness).
   */
  readonly keepAlive?: boolean;
  /**
   * Override stderr destination (testing only).
   */
  readonly stderr?: Writable;
  /**
   * Subsystem tag prepended to log lines. Default: "process".
   */
  readonly tag?: string;
}

// Per-process install state. Flag is set on the process object so a
// shared module loaded from multiple entry points (CLI + daemon) only
// installs once even if both call `installProcessHandlers()`.
const INSTALLED_FLAG = Symbol.for("wotann.processHandlersInstalled");

interface ProcessWithFlag {
  [INSTALLED_FLAG]?: boolean;
}

/**
 * Install global process handlers. Idempotent — calling twice is a no-op.
 * Returns true if handlers were freshly installed, false if already present.
 */
export function installProcessHandlers(opts: ProcessHandlerOptions = {}): boolean {
  const flagged = process as unknown as ProcessWithFlag;
  if (flagged[INSTALLED_FLAG]) return false;
  flagged[INSTALLED_FLAG] = true;

  const tag = opts.tag ?? "process";
  const stderr = opts.stderr ?? process.stderr;
  const appendLog = opts.appendLog;
  const keepAlive = opts.keepAlive === true;

  const writeStructured = (level: "error" | "fatal", kind: string, err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const line = JSON.stringify({
      level,
      tag,
      kind,
      message,
      stack,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    });
    try {
      stderr.write(line + "\n");
    } catch {
      // stderr write can fail if the descriptor is closed (e.g. detached
      // daemon mid-shutdown). Nothing we can do — at least we tried.
    }
    if (appendLog) {
      try {
        appendLog({
          type: "error",
          message: `[${tag}] ${kind}: ${message}`,
          data: { stack, pid: process.pid },
        });
      } catch {
        // Logger itself failed — already wrote to stderr, accept the loss.
      }
    }
  };

  process.on("uncaughtException", (err: Error) => {
    writeStructured("fatal", "uncaughtException", err);
    if (!keepAlive) {
      // Give async writes a beat to flush before exit, but don't hang.
      setTimeout(() => process.exit(1), 50).unref();
    }
  });

  process.on("unhandledRejection", (reason: unknown) => {
    writeStructured("error", "unhandledRejection", reason);
    // Intentional: do NOT exit. The daemon must keep serving other
    // sessions even if one async path rejected without an await.
  });

  return true;
}

/**
 * Test-only escape hatch. Resets the install flag so a fresh install
 * can be exercised. Never call from production code.
 */
export function __resetProcessHandlersForTest(): void {
  const flagged = process as unknown as ProcessWithFlag;
  delete flagged[INSTALLED_FLAG];
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");
}
