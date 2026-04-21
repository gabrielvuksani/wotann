/**
 * JeanOrchestrator — Jean §2.4 coordinator (WOTANN P1-C9 top-level).
 *
 * Glues the four registries together into one call surface for
 * spawning bounded, audited child processes:
 *
 *   commands   — policy gate: "may this command run, with these args?"
 *   processes  — live tracking: pid → running metadata
 *   events     — lifecycle stream: started/stdout/stderr/exited
 *   results    — audit log: completed runs, exit codes, truncated I/O
 *
 * Spawning uses `execFile` (not `spawn` with `{shell: true}` and not
 * `exec`) so args are passed as an argv array — the kernel never sees
 * a shell, eliminating the entire quote-injection surface. `shell-quote`
 * is imported for optional tokenization use cases but is intentionally
 * NOT used in the spawn path itself; the command's registered binary
 * plus argv-validated args go straight to execFile.
 *
 * DESIGN NOTES:
 * - Per-instance state only (Quality Bar #7): one JeanOrchestrator
 *   owns its own four registries; no module globals.
 * - Honest error types (OrchestratorError) — unknown command, invalid
 *   args, concurrency cap exceeded — each emits a dedicated message
 *   rather than silent success (session-2 Quality Bar #2).
 * - Every spawn produces:
 *     - exactly one "started" event (once the child has a pid)
 *     - zero or more stdout/stderr events
 *     - exactly one "exited" event
 *   regardless of exit code.
 * - Concurrency cap = 0 means unlimited (matches CommandRegistry
 *   semantics).
 */

import { execFile, type ChildProcess } from "node:child_process";
import {
  CommandRegistry,
  CommandRegistryError,
  type CommandPolicy,
} from "./jean-registries/command-registry.js";
import { ProcessRegistry, ProcessRegistryError } from "./jean-registries/process-registry.js";
import { EventRegistry } from "./jean-registries/event-registry.js";
import { ResultRegistry, type ProcessResult } from "./jean-registries/result-registry.js";

// ── Types ────────────────────────────────────────────────────────

export interface SpawnHandle {
  /** OS pid of the child. */
  readonly pid: number;
  /** Resolves (does NOT reject on non-zero exit) once the child exits. */
  readonly done: Promise<ProcessResult>;
}

export interface OrchestratorConfig {
  readonly commands?: CommandRegistry;
  readonly processes?: ProcessRegistry;
  readonly events?: EventRegistry;
  readonly results?: ResultRegistry;
}

// ── Orchestrator ─────────────────────────────────────────────────

export class JeanOrchestrator {
  readonly commands: CommandRegistry;
  readonly processes: ProcessRegistry;
  readonly events: EventRegistry;
  readonly results: ResultRegistry;

  // Counter for synthetic pseudo-pids when ENOENT-style failures
  // leave child.pid undefined. Starts well above normal OS pid range
  // (Linux default max is 32768; macOS tops at 99998) so collisions
  // with a real pid are essentially impossible.
  private nextSyntheticPid = 1_000_000_000;

  constructor(config?: OrchestratorConfig) {
    this.commands = config?.commands ?? new CommandRegistry();
    this.processes = config?.processes ?? new ProcessRegistry();
    this.events = config?.events ?? new EventRegistry();
    this.results = config?.results ?? new ResultRegistry();
  }

  private synthPid(): number {
    return this.nextSyntheticPid++;
  }

  /**
   * Spawn a child process by registered command name. Resolves to a
   * SpawnHandle once the process has a pid. Throws OrchestratorError
   * before touching child_process if:
   *   - command is not registered
   *   - args fail policy validation
   *   - concurrency cap would be exceeded
   *
   * The returned handle.done resolves (never rejects) with the final
   * ProcessResult — including ENOENT-style failures, which are
   * surfaced in stderr + a non-zero exit code.
   */
  spawn(
    commandName: string,
    args: readonly string[],
    opts?: { readonly sessionId?: string },
  ): Promise<SpawnHandle> {
    const policy = this.commands.get(commandName);
    if (!policy) {
      return Promise.reject(new OrchestratorError(`unknown command "${commandName}"`));
    }

    const validation = this.commands.validateArgs(commandName, args);
    if (!validation.valid) {
      return Promise.reject(
        new OrchestratorError(`invalid args for "${commandName}": ${validation.reason ?? "?"}`),
      );
    }

    if (
      policy.concurrencyCap > 0 &&
      this.processes.activeCount(commandName) >= policy.concurrencyCap
    ) {
      return Promise.reject(
        new OrchestratorError(
          `concurrency cap reached for "${commandName}" ` + `(${policy.concurrencyCap})`,
        ),
      );
    }

    return new Promise<SpawnHandle>((resolve, reject) => {
      this.launch(policy, args, opts?.sessionId, resolve, reject);
    });
  }

  // ── Internal launch ─────────────────────────────────────────

  private launch(
    policy: CommandPolicy,
    args: readonly string[],
    sessionId: string | undefined,
    onResolve: (h: SpawnHandle) => void,
    onReject: (e: Error) => void,
  ): void {
    const startedAt = Date.now();
    let child: ChildProcess;
    try {
      // execFile is the secure path: argv is passed as an array; the
      // kernel never sees a shell, so there is no quoting surface.
      child = execFile(
        policy.binary,
        [...args],
        {
          timeout: policy.timeoutMs,
          // Cap captured buffers to policy-level sanity; the actual
          // ResultRegistry will re-truncate to its own caps.
          maxBuffer: 10 * 1024 * 1024,
        },
        // We attach our own listeners below; this callback just
        // prevents the node default from re-throwing on non-zero exit.
        () => {
          /* handled via 'close'/'error' listeners */
        },
      );
    } catch (err) {
      onReject(
        new OrchestratorError(
          `spawn failed for "${policy.name}": ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    // On ENOENT / EACCES and similar immediate fork failures the
    // kernel never allocates a pid (child.pid === undefined). We
    // still want callers to see an honest, registry-backed result
    // rather than a silent reject (Session-2 QB #2). Synthesize a
    // positive pseudo-pid (outside the normal OS range) so all four
    // registries accept it, and let the 'error' event fire the
    // normal lifecycle tail.
    const pid = typeof child.pid === "number" && child.pid > 0 ? child.pid : this.synthPid();

    // Register in the process registry. Duplicate pid in the unlikely
    // race (reused pid from a prior reaped process) → bubble up as a
    // real error rather than silently swallow.
    try {
      this.processes.add({
        pid,
        commandName: policy.name,
        startedAt,
        status: "starting",
        sessionId,
      });
    } catch (err) {
      if (err instanceof ProcessRegistryError) {
        onReject(err);
        return;
      }
      throw err;
    }

    this.events.emit({ pid, kind: "started", timestamp: startedAt });
    // Moving to "running" once we have confirmed the child is tracked.
    try {
      this.processes.update(pid, { status: "running" });
    } catch {
      // If the update fails (only possible if pid was removed in a race),
      // the state is already cleaned up — continue to wire listeners so
      // the exit handler still fires and the result is persisted.
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      stdout += text;
      this.events.emit({
        pid,
        kind: "stdout",
        timestamp: Date.now(),
        data: text,
      });
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      stderr += text;
      this.events.emit({
        pid,
        kind: "stderr",
        timestamp: Date.now(),
        data: text,
      });
    });

    const done = new Promise<ProcessResult>((resolveDone) => {
      const finalize = (
        exitCode: number | null,
        signal: NodeJS.Signals | null,
        errorMessage: string | undefined,
      ): void => {
        const finishedAt = Date.now();
        const finalStatus = errorMessage ? "failed" : signal ? "killed" : "exited";

        // Update process registry to its terminal state.
        try {
          this.processes.update(pid, {
            status: finalStatus,
            exitCode: exitCode ?? undefined,
          });
        } catch {
          // Process record may have been reaped already — not fatal.
        }

        // Build result — if spawn itself failed (ENOENT, EACCES) we
        // fold the error message into stderr and pick a conservative
        // non-zero exit code.
        const effectiveStderr = errorMessage
          ? stderr + (stderr.length > 0 ? "\n" : "") + errorMessage
          : stderr;
        const effectiveExit = errorMessage && exitCode === null ? -1 : exitCode;

        const result: ProcessResult = Object.freeze({
          pid,
          commandName: policy.name,
          exitCode: effectiveExit,
          durationMs: finishedAt - startedAt,
          stdout,
          stderr: effectiveStderr,
          finishedAt,
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(signal !== null ? { signal: String(signal) } : {}),
        });

        const persisted = this.persistResult(result);
        this.events.emit({
          pid,
          kind: "exited",
          timestamp: finishedAt,
          exitCode: persisted.exitCode ?? undefined,
          ...(signal !== null ? { signal: String(signal) } : {}),
        });
        resolveDone(persisted);
      };

      // 'close' fires after stdio streams have closed — most reliable
      // finalization signal. We fall through to 'error' only when
      // 'close' has not yet fired (e.g. ENOENT case: error fires
      // before any close).
      let settled = false;
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        finalize(code, signal, undefined);
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        finalize(null, null, err.message);
      });
    });

    onResolve({ pid, done });
  }

  private persistResult(result: ProcessResult): ProcessResult {
    try {
      return this.results.persist(result);
    } catch {
      // Result already persisted (duplicate pid from a racey retry
      // path). Return the existing record if we can find it, else the
      // original so callers still see an answer.
      const existing = this.results.lookup(result.pid);
      return existing ?? result;
    }
  }
}

// ── Error Type ───────────────────────────────────────────────────

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

// Re-export for downstream callers that want a single import site.
export { CommandRegistryError };
