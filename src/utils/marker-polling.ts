/**
 * marker-polling — Terminus-KIRA-style unique-marker command wrapping +
 * double-confirmation polling for streaming shell output.
 *
 * The "fabricated success" problem on long-running agents:
 *
 *   1. Agent invokes `./run-tests.sh` which prints "running..." then takes 30s.
 *   2. Harness reads the first chunk ("running..."), sees non-empty output,
 *      returns it to the agent as "the command completed".
 *   3. Agent claims the task is done — before the tests actually finished.
 *
 * Terminus-KIRA's fix: append a unique sentinel echo after the command and
 * poll the output stream until the sentinel appears. Only then is the command
 * actually finished from the harness's perspective. A "double-confirm" window
 * of ~100 ms after the marker catches any trailing bytes that the OS might
 * flush slightly after the sentinel print.
 *
 * This module is a pure utility:
 *   - {@link markerWrap} returns `{ cmdWithMarker, marker }`
 *   - {@link stripMarker} removes the marker line(s) from output
 *   - {@link findMarker} locates the marker boundary in a buffer
 *   - {@link pollForMarker} reads chunks from an `AsyncIterable<string>` until
 *      the marker is seen or a timeout fires, then does a short double-confirm
 *      read to collect trailing bytes
 *
 * Integration sites (callers that stream stdout) wrap the user-supplied
 * command with {@link markerWrap}, feed the stream through
 * {@link pollForMarker}, and surface the polled result. The module is backend-
 * agnostic so it works for local spawn(), docker exec, SSH pipelines, PTY
 * attaches — any source that yields text chunks.
 *
 * Honest-failure posture: if the timeout fires before the marker is seen, the
 * result carries `done: false, timedOut: true`. Callers MUST NOT treat
 * `timedOut: true` as success — bar #14 of the WOTANN quality bars applies
 * (commit messages/claims need runtime evidence, not optimistic shortcuts).
 *
 * Phase-2 port, MASTER_PLAN_V8 §5 P1-B3. Expected TerminalBench 2.0 delta:
 * +2–3 pp on tasks where premature stream-read was the failure mode.
 */

import { randomUUID } from "node:crypto";

// ── Public Types ──────────────────────────────────────

/**
 * Options for {@link markerWrap}. `uuid` lets callers inject a deterministic
 * identifier (tests, same-session multiple-run scenarios). When omitted a
 * fresh UUIDv4 is generated per call so two parallel commands never share a
 * marker.
 */
export interface MarkerWrapOptions {
  /** Optional pre-built unique id. When omitted, a UUIDv4 is generated. */
  readonly uuid?: string;
  /** Optional session-scoped salt folded into the marker for cross-session
   *  disambiguation. Not a security boundary — defensive only. */
  readonly sessionId?: string;
}

export interface MarkerWrapResult {
  /** The original command plus the trailing marker echo. */
  readonly cmdWithMarker: string;
  /** The exact marker string that will appear on stdout once the wrapped
   *  command completes. Callers poll the stream for this. */
  readonly marker: string;
  /** Regex-safe form for callers that want to match with boundaries. */
  readonly markerRegex: RegExp;
}

/**
 * Options for {@link pollForMarker}. Keeping both poll-interval and timeout
 * honest: timeouts must fire and must be reported as {@link PollResult.timedOut}
 * = true — never silently coerced into success.
 */
export interface PollOptions {
  /** Total wall-clock budget before giving up. Default 30 s. */
  readonly timeoutMs?: number;
  /** Sleep between reads when the source has no pending data.
   *  Smaller = more CPU, larger = more tail latency. Default 25 ms. */
  readonly pollIntervalMs?: number;
  /** How long to keep draining after the marker is first seen so trailing
   *  bytes are captured. Default 100 ms (Terminus-KIRA value). */
  readonly doubleConfirmMs?: number;
  /** Optional AbortSignal for external cancellation. */
  readonly signal?: AbortSignal;
}

export interface PollResult {
  /** Everything the stream emitted before the marker, verbatim — stripped of
   *  the marker itself and any trailing bytes collected during the double-
   *  confirm window. Callers see exactly what the command produced. */
  readonly output: string;
  /** True when the marker was observed AND the double-confirm window drained.
   *  False when the timeout fired first — caller must treat the result as
   *  incomplete and MUST NOT claim success. */
  readonly done: boolean;
  /** True if the timeout fired before the marker was seen. Mutually exclusive
   *  with done=true. */
  readonly timedOut: boolean;
  /** Bytes collected during the post-marker double-confirm window. Separate
   *  from output so observability callers can tell how much the marker slid.
   *  Zero-length when no trailing bytes arrived — still populated for
   *  consistent shape. */
  readonly trailing: string;
}

/**
 * Error thrown (at the caller's option) when a poll completes without seeing
 * the marker. Most callers should prefer the result-object form (PollResult)
 * and branch on `timedOut`, but some code paths want a throwable for error
 * propagation.
 */
export class TimedOutWithoutMarker extends Error {
  readonly timedOutWithoutMarker = true as const;
  constructor(
    public readonly marker: string,
    public readonly partialOutput: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `marker-polling timed out after ${String(timeoutMs)}ms without seeing marker "${marker}" (got ${String(partialOutput.length)} bytes)`,
    );
    this.name = "TimedOutWithoutMarker";
  }
}

// ── markerWrap ────────────────────────────────────────

/**
 * Wraps a shell command with a trailing marker echo so callers can detect
 * true completion from a streaming output. The marker is printed on its own
 * line via `printf` with a leading newline (`\n__CMD_DONE_<uuid>__\n`) so
 * partial mid-line output from the wrapped command never gets concatenated
 * with the marker string.
 *
 * Important safety notes:
 *   - We use `; printf '\\n%s\\n' '<marker>'` (NOT `&&`) so the marker is
 *     emitted regardless of the wrapped command's exit status. Otherwise a
 *     failing command's "completion" would never be detected and we'd time
 *     out with partial output — defeating the whole point.
 *   - The marker is single-quoted so shell metacharacters in the UUID (none
 *     in practice, but the sessionId salt is caller-supplied) can't escape.
 *   - Even though `printf` is a POSIX shell built-in, we prefer it over
 *     `echo` because `echo`'s handling of backslashes and `-n` is portable-
 *     ly inconsistent across `sh` implementations. `printf '\\n%s\\n'`
 *     prints exactly one newline before and one after the marker.
 *
 * @param command  User-supplied shell command (may contain any pipes/redirs).
 * @param options  Optional marker customization.
 * @returns `{ cmdWithMarker, marker, markerRegex }`.
 */
export function markerWrap(command: string, options: MarkerWrapOptions = {}): MarkerWrapResult {
  const uuid = options.uuid ?? randomUUID();
  const salt = options.sessionId ? `_${sanitizeSalt(options.sessionId)}` : "";
  const marker = `__CMD_DONE_${uuid}${salt}__`;
  // Refuse to proceed if someone passes a pathological `uuid` that would
  // break the single-quoted printf. We only accept hex/dash/underscore.
  if (!/^[A-Za-z0-9_-]+$/.test(marker)) {
    throw new Error(`marker-polling: marker "${marker}" contains disallowed chars`);
  }
  const cmdWithMarker = `${command}; printf '\\n%s\\n' '${marker}'`;
  const markerRegex = new RegExp(escapeRegex(marker));
  return { cmdWithMarker, marker, markerRegex };
}

/**
 * Restrict session-id salt characters so that even an adversarial sessionId
 * can't escape the single-quoted marker or introduce shell metacharacters.
 * Non-matching chars are dropped (not escaped) because the salt is purely
 * advisory disambiguation — losing a few chars doesn't change correctness.
 */
function sanitizeSalt(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}

function escapeRegex(input: string): string {
  // UUIDs and our marker format never include special regex chars, but
  // callers may pass sessionId derivatives — be defensive.
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Marker location helpers ──────────────────────────

export interface FindMarkerResult {
  readonly index: number;
  readonly endIndex: number;
  readonly found: boolean;
}

/**
 * Locate the marker within a buffer. Returns the index of the first byte of
 * the marker and the exclusive end (first byte AFTER the marker).
 *
 * Callers use the pair to split `before = buf.slice(0, index)` and
 * `trailing = buf.slice(endIndex)` without rebuilding.
 */
export function findMarker(buffer: string, marker: string): FindMarkerResult {
  const idx = buffer.indexOf(marker);
  if (idx < 0) return { index: -1, endIndex: -1, found: false };
  return { index: idx, endIndex: idx + marker.length, found: true };
}

/**
 * Strip the marker line from `buffer` and return the output the command
 * actually emitted. Also strips the single newline we inserted right before
 * the marker so the output looks exactly like it would without marker-wrap.
 *
 * If the marker is not present, returns the buffer unchanged.
 */
export function stripMarker(buffer: string, marker: string): string {
  const loc = findMarker(buffer, marker);
  if (!loc.found) return buffer;
  // The prefix convention from markerWrap() is `\n<marker>\n`. Trim the
  // newline(s) immediately bordering the marker, but only if present — we
  // never over-trim user content.
  let startCut = loc.index;
  if (startCut > 0 && buffer.charAt(startCut - 1) === "\n") startCut -= 1;
  const before = buffer.slice(0, startCut);
  const after = loc.endIndex < buffer.length ? buffer.slice(loc.endIndex).replace(/^\n/, "") : "";
  return before + after;
}

// ── pollForMarker ─────────────────────────────────────

/**
 * A minimal async chunk source. Any shape matching this can be polled.
 * Implementations yield string chunks; empty string signals "no data yet,
 * caller should wait before asking again".
 */
export interface ChunkSource {
  /**
   * Read whatever is currently buffered. Must return synchronously (sync
   * sources are expected to buffer between calls and drain on read). Async
   * sources should resolve immediately with whatever has arrived — the poll
   * loop handles waiting.
   */
  read(): Promise<string> | string;
  /** Called once when polling gives up (timeout or marker seen).
   *  Use to clean up subscriptions, timers, file handles. */
  close?(): Promise<void> | void;
}

/**
 * Poll the source until the marker appears, then run a double-confirm window
 * collecting trailing bytes. Returns {@link PollResult} — honest timeout is
 * reported as `{ done: false, timedOut: true }`, never silently as success.
 *
 * Implementation notes:
 *   - We use setTimeout-based sleeps rather than a fixed-interval loop so
 *     cancellation via `signal` is immediate.
 *   - We never mutate the input source state; buffering happens in `acc`.
 *   - The double-confirm phase uses the same pollInterval as the main phase
 *     for consistency.
 */
export async function pollForMarker(
  source: ChunkSource,
  marker: string,
  options: PollOptions = {},
): Promise<PollResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const doubleConfirmMs = options.doubleConfirmMs ?? 100;
  const signal = options.signal;

  const start = Date.now();
  let acc = "";
  let markerSeen = false;
  let markerIndex = -1;

  try {
    // Phase 1: read until marker or timeout
    while (!markerSeen) {
      if (signal?.aborted) {
        return buildTimedOut(acc, marker, "aborted");
      }
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        return buildTimedOut(acc, marker, "timeout");
      }
      const chunk = await source.read();
      if (chunk) {
        acc += chunk;
        const loc = findMarker(acc, marker);
        if (loc.found) {
          markerSeen = true;
          markerIndex = loc.index;
          break;
        }
      }
      if (!markerSeen) {
        await sleep(pollIntervalMs, signal);
      }
    }

    // Phase 2: double-confirm — keep draining for doubleConfirmMs to catch
    // trailing bytes. We still respect the outer timeout.
    const dcStart = Date.now();
    while (Date.now() - dcStart < doubleConfirmMs) {
      if (signal?.aborted) break;
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) break;
      const chunk = await source.read();
      if (chunk) acc += chunk;
      await sleep(pollIntervalMs, signal);
    }

    const loc = findMarker(acc, marker);
    const effectiveIndex = loc.found ? loc.index : markerIndex;
    const effectiveEnd = loc.found ? loc.endIndex : markerIndex + marker.length;
    // Trim the newline we inserted immediately before the marker, if any.
    let beforeCut = effectiveIndex;
    if (beforeCut > 0 && acc.charAt(beforeCut - 1) === "\n") beforeCut -= 1;
    const before = acc.slice(0, beforeCut);
    const trailing = effectiveEnd < acc.length ? acc.slice(effectiveEnd).replace(/^\n/, "") : "";
    return {
      output: before,
      done: true,
      timedOut: false,
      trailing,
    };
  } finally {
    if (source.close) {
      try {
        await source.close();
      } catch {
        // Cleanup errors are non-fatal for poll callers — we've already
        // captured whatever they need. Surfacing would mask the real
        // poll result.
      }
    }
  }
}

function buildTimedOut(acc: string, _marker: string, _reason: string): PollResult {
  return {
    output: acc,
    done: false,
    timedOut: true,
    trailing: "",
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
      resolve();
    }, ms);
    let abortListener: (() => void) | undefined;
    if (signal) {
      abortListener = () => {
        clearTimeout(t);
        resolve();
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }
  });
}

// ── Integration: spawn() + marker-polling ─────────────

/**
 * Convenience helper: run a command via {@link markerWrap} + spawn() and poll
 * the stdout stream until the marker is seen. Returns `{ output, stderr,
 * exitCode, timedOut }`.
 *
 * This is the integration point for backends that want drop-in marker-backed
 * exec. Existing exec paths (e.g. `terminal-backends.LocalBackend.execute`)
 * can opt in by calling this when the caller passes `{ useMarker: true }`.
 *
 * Kept separate from the existing `LocalBackend.execute` to preserve its
 * public API. Callers choose marker mode explicitly.
 */
export interface SpawnWithMarkerOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly doubleConfirmMs?: number;
  readonly pollIntervalMs?: number;
  readonly shell?: string;
  readonly sessionId?: string;
}

export interface SpawnWithMarkerResult {
  readonly output: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly done: boolean;
  readonly trailing: string;
  readonly marker: string;
}

export async function spawnWithMarker(
  command: string,
  options: SpawnWithMarkerOptions = {},
): Promise<SpawnWithMarkerResult> {
  // Late import to keep the pure-utility layer above free of node:spawn so
  // it can be tree-shaken for environments that don't need the integration.
  const { spawn } = await import("node:child_process");
  const { cmdWithMarker, marker } = markerWrap(command, {
    sessionId: options.sessionId,
  });
  const shell = options.shell ?? "/bin/sh";
  const child = spawn(shell, ["-c", cmdWithMarker], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });

  let stderrBuf = "";
  let stdoutBuf = "";
  let exitCode = 0;
  let exited = false;

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
  });
  child.on("close", (code) => {
    exited = true;
    exitCode = typeof code === "number" ? code : exitCode;
  });
  child.on("error", () => {
    exited = true;
    exitCode = exitCode || 1;
  });

  const source: ChunkSource = {
    read(): string {
      // Snapshot current buffer and consume it — next read returns only
      // bytes that arrived since the last read. This gives pollForMarker
      // a clean incremental view without duplicate bytes in `acc`.
      const out = stdoutBuf;
      stdoutBuf = "";
      return out;
    },
    async close(): Promise<void> {
      if (!exited) {
        child.kill("SIGTERM");
      }
    },
  };

  const polled = await pollForMarker(source, marker, {
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    doubleConfirmMs: options.doubleConfirmMs,
  });

  // Wait briefly for the child to reap (exit code is advisory once the
  // marker was seen — by design marker echo runs after the user command
  // regardless of exit status).
  if (!exited) {
    await Promise.race([new Promise<void>((res) => child.once("close", () => res())), sleep(50)]);
  }

  return {
    output: polled.output,
    stderr: stderrBuf,
    exitCode,
    timedOut: polled.timedOut,
    done: polled.done,
    trailing: polled.trailing,
    marker,
  };
}
