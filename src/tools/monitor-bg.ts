/**
 * monitor-bg — event-driven background-script monitor (V9 Tier 14.1).
 *
 * Claude Code v2.1.98 introduced a Monitor tool that streams each stdout
 * line from a long-running child process as a discrete event instead of
 * polling with `sleep`. This module is the WOTANN port as a general-purpose
 * pure-TS AsyncGenerator — no callback API, no module-level state.
 *
 * Companion to src/tools/monitor.ts (the push-to-transcript variant used
 * by the runtime-tool dispatcher). This file is the lower-level primitive:
 * `runMonitored(opts)` returns an async generator that yields one event
 * per newline-delimited line as it arrives, plus `timeout` and `exit`
 * control events. Callers drive it with `for await ... of`.
 *
 * Design contract:
 *   - shell: false, argv form → no command-string injection
 *   - stdio pipes, newline-split per stream, UTF-8 decoded
 *   - timeoutMs: sends killSignal, yields `timeout`, then the `exit`
 *   - maxLines: force-kills the process when exceeded (runaway guard)
 *   - Spawn errors surface via the `exit` event with code=null signal=null
 *     and the error message carried through the preceding stderr-line
 *     event (QB #6: honest failures, never silently swallowed)
 *   - Breaking out of the for-await loop cancels via AbortController,
 *     which triggers a SIGTERM kill on the child (clean dispose)
 *   - env defaults to opts.env MERGED with process.env explicitly — the
 *     caller opts in (QB #13: env guard, no implicit inheritance surprise)
 *   - Pure function: no module-level caches (QB #7)
 */

import { spawn, type ChildProcess } from "node:child_process";

// ── Types ──────────────────────────────────────────────

export interface MonitorOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Max total runtime before killSignal is sent. Default 300_000 (5 min). */
  readonly timeoutMs?: number;
  /** Max lines captured before force-close. Default 10_000. */
  readonly maxLines?: number;
  /** Signal used on timeout and abort. Default "SIGTERM". */
  readonly killSignal?: NodeJS.Signals;
}

export type MonitorEvent =
  | {
      readonly type: "stdout-line";
      readonly line: string;
      readonly timestamp: number;
    }
  | {
      readonly type: "stderr-line";
      readonly line: string;
      readonly timestamp: number;
    }
  | {
      readonly type: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly durationMs: number;
    }
  | {
      readonly type: "timeout";
      readonly afterMs: number;
    };

// ── Defaults ──────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_LINES = 10_000;
const DEFAULT_KILL_SIGNAL: NodeJS.Signals = "SIGTERM";

// ── Implementation ────────────────────────────────────

/**
 * Run a child process and yield an event per stdout/stderr line (plus
 * control events for timeout and exit). The generator terminates cleanly
 * when the child exits, when `timeoutMs` elapses, when `maxLines` is hit,
 * or when the caller breaks out of the for-await loop.
 *
 * Caller pattern:
 * ```ts
 * for await (const ev of runMonitored({ command: "tail", args: ["-f", "log"] })) {
 *   if (ev.type === "stdout-line") console.log(ev.line);
 *   if (ev.type === "exit") break;
 * }
 * ```
 */
export async function* runMonitored(
  opts: MonitorOptions,
): AsyncGenerator<MonitorEvent, void, undefined> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const killSignal = opts.killSignal ?? DEFAULT_KILL_SIGNAL;

  // Explicit env merge — caller opts in (QB #13). We keep process.env as
  // the floor and let opts.env override; callers can pass {} to inherit
  // nothing meaningful beyond process.env, or explicitly undefined values
  // to unset inherited keys (child_process handles undefined as unset).
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };

  // AbortController: breaking out of the for-await loop triggers the
  // generator's `return`, where we listen on the controller and kill the
  // child. This is the clean-dispose contract the spec calls out.
  const abortController = new AbortController();
  const abortSignal = abortController.signal;

  // Queue of events ready to hand out, plus a waiter for the consumer.
  // We buffer because stdout/stderr and process events all fire on the
  // event loop asynchronously — the generator pulls from this queue.
  const queue: MonitorEvent[] = [];
  let waiter: (() => void) | null = null;
  let finished = false;
  let linesEmitted = 0;
  let capReached = false;

  const notify = (): void => {
    const w = waiter;
    if (w) {
      waiter = null;
      w();
    }
  };

  const enqueue = (event: MonitorEvent): void => {
    queue.push(event);
    notify();
  };

  // Spawn. If this throws synchronously (EACCES / ENOENT in some node
  // builds), catch and surface as an exit event so the generator still
  // yields a coherent sequence.
  let child: ChildProcess;
  try {
    child = spawn(opts.command, opts.args ? [...opts.args] : [], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      env: mergedEnv,
    });
  } catch (err) {
    // Surface synchronous spawn errors as a stderr-line + exit pair. Never
    // silently swallow — QB #6 honest failures.
    enqueue({
      type: "stderr-line",
      line: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    });
    enqueue({
      type: "exit",
      code: null,
      signal: null,
      durationMs: Date.now() - startedAt,
    });
    finished = true;
    // Drain and return.
    for (const ev of queue.splice(0, queue.length)) yield ev;
    return;
  }

  // Line-splitting helper — stdout/stderr arrive in arbitrary-boundary
  // chunks so we buffer and split on \n. The trailing partial line at
  // stream 'end' is flushed as its own event.
  const wireStream = (stream: NodeJS.ReadableStream, type: "stdout-line" | "stderr-line"): void => {
    let buf = "";
    stream.setEncoding?.("utf-8");
    stream.on("data", (chunk: string | Buffer) => {
      if (capReached || finished) return;
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        emitLine(type, line);
        if (capReached) return;
        idx = buf.indexOf("\n");
      }
    });
    stream.on("end", () => {
      if (buf.length > 0 && !finished && !capReached) {
        emitLine(type, buf);
        buf = "";
      }
    });
    // Errors on the pipe itself (rare — EPIPE on parent side) surface as
    // stderr lines so the caller sees them.
    stream.on("error", (err: Error) => {
      if (!finished) {
        enqueue({
          type: "stderr-line",
          line: `[monitor-bg pipe error] ${err.message}`,
          timestamp: Date.now(),
        });
      }
    });
  };

  const emitLine = (type: "stdout-line" | "stderr-line", line: string): void => {
    if (capReached) return;
    enqueue({ type, line, timestamp: Date.now() });
    linesEmitted += 1;
    if (linesEmitted >= maxLines) {
      capReached = true;
      // Force-close: runaway producer must not OOM the caller.
      safeKill(child, killSignal);
    }
  };

  if (child.stdout) wireStream(child.stdout, "stdout-line");
  if (child.stderr) wireStream(child.stderr, "stderr-line");

  // Async 'error' from the child (e.g. ENOENT from an invalid binary
  // surfaces here on most platforms). We surface the message as a
  // stderr-line; the subsequent `exit` event carries code=null / signal=null.
  child.on("error", (err: Error) => {
    if (!finished) {
      enqueue({
        type: "stderr-line",
        line: err.message,
        timestamp: Date.now(),
      });
    }
  });

  // Timeout watchdog. We yield a `timeout` event first so the consumer
  // sees it before the subsequent `exit`.
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    if (finished) return;
    timedOut = true;
    enqueue({ type: "timeout", afterMs: Date.now() - startedAt });
    safeKill(child, killSignal);
  }, timeoutMs);
  timeoutHandle.unref?.();

  // Abort wiring — when the consumer breaks out of the for-await loop,
  // we abort; the handler kills the child. Using `once` + `{ signal }`
  // to avoid leaking listeners on success paths.
  const onAbort = (): void => {
    if (!finished) safeKill(child, killSignal);
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });

  // Exit wiring. 'exit' fires once the child has stopped; stdio 'end'
  // events may still fire slightly after. We rely on 'close' which is
  // the last event (stdio fully drained + process exited).
  child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutHandle);
    enqueue({
      type: "exit",
      code,
      signal,
      durationMs: Date.now() - startedAt,
    });
  });

  // ── Consumer loop ─────────────────────────────────
  // Drain the queue as events arrive. When the queue is empty and the
  // process has finished, return. When the caller breaks (generator
  // return), the `finally` fires and cancels via AbortController.
  try {
    while (true) {
      // Yield anything already queued first (no await gap between
      // events that arrived in the same microtask).
      while (queue.length > 0) {
        const ev = queue.shift()!;
        yield ev;
        if (ev.type === "exit") return;
      }
      if (finished) return;
      // Wait for the next event. This is the event-driven "sleep" the
      // spec forbids replacing with polling — we use a promise the
      // enqueue() side resolves, so we wake exactly when data arrives.
      await new Promise<void>((resolve) => {
        waiter = resolve;
        // If finished was set between the queue drain and here, wake up.
        if (finished || queue.length > 0) {
          const w = waiter;
          waiter = null;
          if (w === resolve) resolve();
        }
      });
    }
  } finally {
    // Clean up on early break. Always:
    //   1. Signal abort so the child is killed.
    //   2. Clear the timeout so the node process can exit cleanly.
    //   3. Drop any pending waiter (no dangling callback).
    clearTimeout(timeoutHandle);
    if (!abortSignal.aborted) abortController.abort();
    waiter = null;
    // Suppress unused-var warnings for timedOut in some lint configs —
    // this variable documents state for debugging even if not returned.
    void timedOut;
  }
}

// ── Helpers ────────────────────────────────────────────

/**
 * Kill a child process, swallowing "already exited" errors. spawn() can
 * report false for kill() if the PID is already reaped, which is fine —
 * the exit handler fires either way.
 */
function safeKill(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (!child.killed && child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  } catch {
    // Already dead; the 'close' handler will fire.
  }
}
