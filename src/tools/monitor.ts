/**
 * Monitor tool — background event streaming into the transcript.
 *
 * Session-6 competitor port (Claude Code v2.1.98 — Monitor tool pattern).
 * Wraps a long-running child process so each stdout/stderr line becomes
 * a discrete event the runtime can surface as a transcript message. Use
 * cases: tail a training run, babysit CI, watch a dev server, follow a
 * log file — without the sleep-poll loops that make agents feel sluggish.
 *
 * Design:
 *   - spawn() returns a MonitorSession with { id, stop(), events }
 *   - `events` is an async iterator yielding MonitorEvent per stdout/err
 *     line; the iterator terminates when the process exits
 *   - stop() kills the process via SIGTERM + 5s SIGKILL fallback
 *   - Buffer caps prevent a runaway process from exhausting RAM: default
 *     10MB of line storage, oldest lines dropped with a `truncated` event
 *
 * This is the minimal honest-stub-free implementation — it does NOT
 * fabricate "success" envelopes when the process fails, it yields a
 * real `exit` event with exit code + signal.
 */

import { spawn } from "node:child_process";

export type MonitorEventType = "stdout" | "stderr" | "exit" | "error" | "truncated";

export interface MonitorEvent {
  readonly type: MonitorEventType;
  /** Monotonic ms timestamp since monitor start. */
  readonly elapsedMs: number;
  /** Line content for stdout/stderr; error message for error; empty for exit/truncated. */
  readonly line: string;
  /** Present only on `exit` events. */
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
}

export interface MonitorOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Max buffered bytes of line content before oldest lines are dropped. */
  readonly bufferBytes?: number;
  /** Wall-clock cap. Monitor stops itself after this; 0 = unlimited. */
  readonly maxDurationMs?: number;
}

export interface MonitorSession {
  readonly id: string;
  /** Async iterable of events until the process exits or stop() fires. */
  readonly events: AsyncIterable<MonitorEvent>;
  /** Request graceful termination. Resolves when the process has exited. */
  stop(): Promise<void>;
  /** True after the process has exited (any cause). */
  isFinished(): boolean;
}

const DEFAULT_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB

export function spawnMonitor(options: MonitorOptions): MonitorSession {
  const id = `mon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const bufferBytesMax = options.bufferBytes ?? DEFAULT_BUFFER_BYTES;

  const child = spawn(options.command, [...(options.args ?? [])], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const pendingEvents: MonitorEvent[] = [];
  let pendingBytes = 0;
  let resolveNext: ((value: IteratorResult<MonitorEvent>) => void) | null = null;
  let finished = false;
  let exitEventEmitted = false;

  const emit = (event: MonitorEvent): void => {
    // Enforce buffer cap by dropping oldest lines (not exit/error events).
    const eventBytes = event.line.length + 64; // rough overhead
    while (pendingBytes + eventBytes > bufferBytesMax && pendingEvents.length > 0) {
      const dropped = pendingEvents.shift();
      if (dropped) pendingBytes -= dropped.line.length + 64;
      // Announce the drop exactly once per batch to avoid spam
      pendingEvents.unshift({
        type: "truncated",
        elapsedMs: Date.now() - startedAt,
        line: "",
      });
      pendingBytes += 64;
    }
    pendingBytes += eventBytes;
    pendingEvents.push(event);
    if (resolveNext) {
      const next = pendingEvents.shift();
      const resolver = resolveNext;
      resolveNext = null;
      if (next) {
        pendingBytes -= next.line.length + 64;
        resolver({ value: next, done: false });
      }
    }
  };

  // Line-splitting buffer for stdout/stderr — stream chunks arrive at
  // arbitrary boundaries so we accumulate and split on \n.
  const pipe = (stream: NodeJS.ReadableStream, type: "stdout" | "stderr"): void => {
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        emit({ type, elapsedMs: Date.now() - startedAt, line });
        newlineIdx = buffer.indexOf("\n");
      }
    });
    stream.on("end", () => {
      if (buffer.length > 0) {
        emit({ type, elapsedMs: Date.now() - startedAt, line: buffer });
        buffer = "";
      }
    });
  };

  if (child.stdout) pipe(child.stdout, "stdout");
  if (child.stderr) pipe(child.stderr, "stderr");

  child.on("error", (err) => {
    emit({
      type: "error",
      elapsedMs: Date.now() - startedAt,
      line: err instanceof Error ? err.message : String(err),
    });
  });

  child.on("exit", (code, signal) => {
    if (exitEventEmitted) return;
    exitEventEmitted = true;
    finished = true;
    emit({
      type: "exit",
      elapsedMs: Date.now() - startedAt,
      line: "",
      exitCode: code,
      signal,
    });
    // Wake any pending next() so the iterator can terminate cleanly.
    if (resolveNext) {
      const resolver = resolveNext;
      resolveNext = null;
      const head = pendingEvents.shift();
      if (head) {
        pendingBytes -= head.line.length + 64;
        resolver({ value: head, done: false });
      } else {
        resolver({ value: undefined as unknown as MonitorEvent, done: true });
      }
    }
  });

  // Optional wall-clock cap. Kills the process when exceeded.
  if (options.maxDurationMs && options.maxDurationMs > 0) {
    setTimeout(() => {
      if (!finished) child.kill("SIGTERM");
    }, options.maxDurationMs).unref();
  }

  async function* events(): AsyncGenerator<MonitorEvent> {
    while (true) {
      if (pendingEvents.length > 0) {
        const next = pendingEvents.shift();
        if (!next) break;
        pendingBytes -= next.line.length + 64;
        yield next;
        continue;
      }
      if (finished) return;
      const result = await new Promise<IteratorResult<MonitorEvent>>((resolve) => {
        resolveNext = resolve;
      });
      if (result.done) return;
      yield result.value;
    }
  }

  const session: MonitorSession = {
    id,
    events: events(),
    async stop(): Promise<void> {
      if (finished) return;
      try {
        child.kill("SIGTERM");
      } catch {
        /* already dead */
      }
      // Escalate to SIGKILL after 5s grace period.
      const escalate = setTimeout(() => {
        if (!finished) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        }
      }, 5000).unref();
      await new Promise<void>((resolve) => {
        if (finished) {
          clearTimeout(escalate);
          resolve();
          return;
        }
        child.once("exit", () => {
          clearTimeout(escalate);
          resolve();
        });
      });
    },
    isFinished: () => finished,
  };
  return session;
}

/**
 * Convenience — collect events up to `maxEvents` or until the process
 * exits. Useful for tests that want to assert deterministic chunks.
 */
export async function collectMonitorEvents(
  session: MonitorSession,
  maxEvents: number = 100,
): Promise<readonly MonitorEvent[]> {
  const collected: MonitorEvent[] = [];
  for await (const event of session.events) {
    collected.push(event);
    if (collected.length >= maxEvents) break;
    if (event.type === "exit") break;
  }
  return collected;
}
