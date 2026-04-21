/**
 * EventRegistry — Jean §2.4 port (WOTANN P1-C9, part 3/4).
 *
 * Publishes lifecycle events for every tracked process and keeps a
 * bounded FIFO buffer per pid. This is Jean's equivalent of the
 * WebSocket replay channel — a broker that decouples process I/O from
 * subscribers (UI, telemetry, downstream pipelines).
 *
 * The eviction strategy mirrors LoopDetector's sliding-window pattern
 * in `src/middleware/loop-detection.ts`: when the per-pid buffer
 * exceeds `bufferSize`, the oldest entry slides out. This keeps memory
 * bounded even for long-running processes that produce heavy output.
 *
 * DESIGN NOTES:
 * - Per-instance state only (Quality Bar #7). Two EventRegistry
 *   instances share zero state.
 * - Two listener types:
 *    1. pid-specific — only receives events for a given pid
 *    2. broadcast — receives every event from every pid
 * - Listener exceptions are trapped so one bad subscriber cannot halt
 *   the delivery chain for the others.
 * - `forget(pid)` drops history + all pid-specific listeners for pid,
 *   useful when a process has terminated and its record is reaped.
 */

// ── Types ────────────────────────────────────────────────────────

export type ProcessEventKind = "started" | "stdout" | "stderr" | "exited";

export interface ProcessEvent {
  readonly pid: number;
  readonly kind: ProcessEventKind;
  readonly timestamp: number;
  readonly data?: string;
  readonly exitCode?: number;
  readonly signal?: string;
}

export type EventListener = (event: ProcessEvent) => void;

export interface EventRegistryConfig {
  /** Per-pid ring-buffer size. Defaults to 1000. */
  readonly bufferSize?: number;
}

interface Subscription {
  readonly listener: EventListener;
}

// ── Registry ─────────────────────────────────────────────────────

const DEFAULT_BUFFER_SIZE = 1000;

export class EventRegistry {
  private readonly bufferSize: number;
  // Per-instance state (Quality Bar #7).
  private readonly buffers = new Map<number, ProcessEvent[]>();
  private readonly pidSubs = new Map<number, Set<Subscription>>();
  private readonly broadcastSubs = new Set<Subscription>();

  constructor(config?: EventRegistryConfig) {
    const size = config?.bufferSize ?? DEFAULT_BUFFER_SIZE;
    if (!Number.isInteger(size) || size <= 0) {
      throw new EventRegistryError(`bufferSize must be > 0, got ${size}`);
    }
    this.bufferSize = size;
  }

  /**
   * Record an event. Appends to the per-pid ring buffer (evicting the
   * oldest if full), then delivers to pid-specific and broadcast
   * listeners. Exceptions thrown by listeners are caught and ignored
   * so one faulty subscriber cannot block the rest.
   */
  emit(event: ProcessEvent): void {
    if (!Number.isInteger(event.pid) || event.pid <= 0) {
      throw new EventRegistryError(`Invalid pid: ${event.pid}`);
    }

    let buffer = this.buffers.get(event.pid);
    if (!buffer) {
      buffer = [];
      this.buffers.set(event.pid, buffer);
    }
    buffer.push(event);
    // FIFO eviction when the per-pid buffer overflows.
    while (buffer.length > this.bufferSize) {
      buffer.shift();
    }

    // Pid-specific delivery.
    const subs = this.pidSubs.get(event.pid);
    if (subs) {
      for (const sub of subs) this.safeDeliver(sub.listener, event);
    }
    // Broadcast delivery.
    for (const sub of this.broadcastSubs) this.safeDeliver(sub.listener, event);
  }

  /**
   * Subscribe to events for a single pid. Returns an unsubscribe
   * function; calling it more than once is a no-op.
   */
  subscribe(pid: number, listener: EventListener): () => void {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new EventRegistryError(`Invalid pid: ${pid}`);
    }
    let subs = this.pidSubs.get(pid);
    if (!subs) {
      subs = new Set();
      this.pidSubs.set(pid, subs);
    }
    const sub: Subscription = { listener };
    subs.add(sub);
    return () => {
      const current = this.pidSubs.get(pid);
      if (!current) return;
      current.delete(sub);
      if (current.size === 0) this.pidSubs.delete(pid);
    };
  }

  /**
   * Subscribe to every event from every pid. Returns unsubscribe fn.
   */
  subscribeAll(listener: EventListener): () => void {
    const sub: Subscription = { listener };
    this.broadcastSubs.add(sub);
    return () => {
      this.broadcastSubs.delete(sub);
    };
  }

  /**
   * Return the recorded history for `pid` (chronological, oldest
   * first). Returns an empty array if the pid is unknown.
   */
  history(pid: number): readonly ProcessEvent[] {
    return this.buffers.get(pid) ?? [];
  }

  /**
   * Drop history + pid-specific listeners for `pid`. Broadcast
   * listeners are unaffected.
   */
  forget(pid: number): void {
    this.buffers.delete(pid);
    this.pidSubs.delete(pid);
  }

  /**
   * Drop all history + all subscriptions. Primarily for tests.
   */
  clear(): void {
    this.buffers.clear();
    this.pidSubs.clear();
    this.broadcastSubs.clear();
  }

  // ── Private ────────────────────────────────────────────────────

  private safeDeliver(listener: EventListener, event: ProcessEvent): void {
    try {
      listener(event);
    } catch {
      // Swallow listener errors so one bad subscriber cannot halt
      // delivery to the others. The registry itself has no recovery
      // channel — callers that need error reporting should wrap their
      // own listeners.
    }
  }
}

// ── Error Type ───────────────────────────────────────────────────

export class EventRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventRegistryError";
  }
}
