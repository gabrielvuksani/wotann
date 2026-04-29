/**
 * Per-session FIFO queue for user messages typed while the agent is
 * mid-stream. The TUI input handler pushes; the runtime drains before
 * each model.complete() call so the queued messages prepend the next
 * human turn.
 *
 * Per-instance state (not module-global) per QB#7 — each session/runtime
 * owns its own queue so two concurrent harness instances cannot leak
 * messages across each other. Construct via {@link makeMessageQueue}
 * (or the class directly) and pass the instance through where it is
 * needed (App.tsx ref → runtime config / setter).
 *
 * Inspired by langchain-ai/open-swe
 * agent/middleware/check_message_queue.py:1-100 — that middleware reads
 * a thread-keyed store before each model call and injects queued items
 * as new human messages. Our adaptation keeps the same semantics
 * (FIFO, prepend-as-user, drain-on-read) without needing a graph store
 * because the TUI is single-threaded.
 */

export interface PendingMessage {
  readonly content: string;
  readonly timestamp: number;
}

/**
 * Bounded FIFO queue. Bounding (default 32) is a deliberate guard
 * against runaway producers — a stuck or buggy submit handler that
 * spams enqueue should be capped rather than memory-balloon. When the
 * cap is hit the oldest message is dropped (same shape as
 * channels/gateway.ts:513-515 so the codebase has a single mental model
 * for "ring-buffer queue").
 */
export const DEFAULT_MAX_QUEUE_SIZE = 32;

export class MessageQueue {
  private queue: PendingMessage[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_QUEUE_SIZE) {
    if (!Number.isFinite(maxSize) || maxSize <= 0) {
      throw new RangeError(
        `MessageQueue maxSize must be a positive finite number; got ${String(maxSize)}`,
      );
    }
    this.maxSize = Math.floor(maxSize);
  }

  /**
   * Push a user message onto the back of the queue. Empty/whitespace-only
   * content is ignored (matches the TUI submit handler — empty submit is
   * a no-op there too, so the queue never ends up holding garbage).
   * When the queue is at capacity the oldest entry is dropped.
   */
  enqueue(content: string): void {
    if (typeof content !== "string") return;
    const trimmed = content.trim();
    if (trimmed.length === 0) return;

    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
    }
    this.queue.push({
      content: trimmed,
      timestamp: Date.now(),
    });
  }

  /**
   * Returns all pending messages in FIFO order and clears the queue.
   * Mirrors open-swe's "delete early to prevent duplicate processing"
   * pattern — once drained, the runtime owns the messages and is
   * responsible for prepending them onto the next model turn.
   */
  drain(): readonly PendingMessage[] {
    if (this.queue.length === 0) return [];
    const drained = this.queue;
    this.queue = [];
    return drained;
  }

  /**
   * Number of currently-queued messages. Used by the TUI to render the
   * "📨 N queued" indicator.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Returns a snapshot of pending messages WITHOUT clearing. Useful for
   * the TUI to render previews without taking ownership.
   */
  peek(): readonly PendingMessage[] {
    return [...this.queue];
  }

  /**
   * Hard-reset (e.g. on /clear or session reset). Distinct from
   * {@link drain} which returns the contents — `clear` discards.
   */
  clear(): void {
    this.queue = [];
  }
}

export function makeMessageQueue(maxSize?: number): MessageQueue {
  return new MessageQueue(maxSize);
}
