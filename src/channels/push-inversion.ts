/**
 * V9 T14.1 — Channels push-inversion (MCP → session).
 *
 * Claude Code v2.1.80 introduced a model where MCP servers (and other
 * out-of-band triggers) can initiate messages INTO an active session
 * instead of only responding to explicit tool calls. This inverts the
 * default request→response direction: the external world pushes, the
 * session receives.
 *
 * This module ships the routing + throttle + dedupe substrate only.
 * Wiring push-inversion into channel adapters (Slack/Telegram/etc.) or
 * into the TUI/Desktop surfaces is a separate integration task — the
 * registry deliberately knows nothing about UI, transports, or session
 * plumbing. Each caller supplies a `sink` function that owns delivery.
 *
 * Design (QB-compliant):
 *   - Per-caller registry factory — `createPushInversionRegistry()`
 *     returns a fresh instance, no module-level singletons (QB #7).
 *   - Honest failures — `push()` resolves with `{ok, deliveredCount,
 *     error?}` and never throws on normal routing conditions (QB #6).
 *   - No env reads — all config is passed in explicitly (QB #13).
 *   - Immutable value types; the registry encapsulates its own mutable
 *     state inside a closure.
 */

// ── Public types ────────────────────────────────────────────

export type PushSource = "mcp" | "webhook" | "cron" | "manual";

export type PushKind = "notification" | "prompt-inject" | "event";

export interface PushMessage {
  readonly source: PushSource;
  readonly kind: PushKind;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
  readonly correlationId?: string;
}

export type PushSink = (msg: PushMessage) => Promise<void>;

export interface RegisterOptions {
  readonly sink: PushSink;
  /** Max deliveries per 60s sliding window. Defaults to 30. */
  readonly maxPerMinute?: number;
  /** When true, pushes with duplicate correlationId inside 30s collapse. */
  readonly dedupe?: boolean;
}

export type DeregisterFn = () => void;

export type PushErrorReason =
  | "not-registered"
  | "rate-limited"
  | "dedupe"
  | "sink-error"
  | "empty-content";

export interface PushResult {
  readonly ok: boolean;
  readonly deliveredCount: number;
  readonly error?: string;
  readonly reason?: PushErrorReason;
}

export interface PushInversionRegistry {
  register(sessionId: string, opts: RegisterOptions): DeregisterFn;
  push(sessionId: string, message: PushMessage): Promise<PushResult>;
  has(sessionId: string): boolean;
  list(): readonly string[];
}

// ── Implementation ──────────────────────────────────────────

interface RegistrationState {
  readonly sink: PushSink;
  readonly maxPerMinute: number;
  readonly dedupe: boolean;
  /** Sliding window of recent push timestamps (ms). */
  readonly recentTimestamps: number[];
  /** correlationId → timestamp (ms) for dedupe window. */
  readonly recentCorrelations: Map<string, number>;
  /** Tail of the serialized per-session push promise chain. */
  pushQueue: Promise<void>;
}

const RATE_WINDOW_MS = 60_000;
const DEDUPE_WINDOW_MS = 30_000;
const DEFAULT_MAX_PER_MINUTE = 30;

/**
 * Create a new push-inversion registry. Each call returns a fresh,
 * isolated registry — safe to use in tests and across multiple daemon
 * instances without cross-talk.
 */
export function createPushInversionRegistry(): PushInversionRegistry {
  const registrations = new Map<string, RegistrationState>();

  function trimRecentTimestamps(state: RegistrationState, now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    // In-place trim of leading expired entries (timestamps are push-ordered).
    while (state.recentTimestamps.length > 0) {
      const head = state.recentTimestamps[0];
      if (head === undefined || head >= cutoff) break;
      state.recentTimestamps.shift();
    }
  }

  function trimRecentCorrelations(state: RegistrationState, now: number): void {
    const cutoff = now - DEDUPE_WINDOW_MS;
    for (const [id, ts] of state.recentCorrelations) {
      if (ts < cutoff) state.recentCorrelations.delete(id);
    }
  }

  function register(sessionId: string, opts: RegisterOptions): DeregisterFn {
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      throw new Error("push-inversion: sessionId must be a non-empty string");
    }
    if (typeof opts.sink !== "function") {
      throw new Error("push-inversion: sink must be a function");
    }
    const maxPerMinute =
      opts.maxPerMinute !== undefined && opts.maxPerMinute > 0
        ? Math.floor(opts.maxPerMinute)
        : DEFAULT_MAX_PER_MINUTE;

    const state: RegistrationState = {
      sink: opts.sink,
      maxPerMinute,
      dedupe: opts.dedupe === true,
      recentTimestamps: [],
      recentCorrelations: new Map(),
      pushQueue: Promise.resolve(),
    };
    registrations.set(sessionId, state);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      // Only clear if this exact registration is still current — a later
      // re-registration with the same sessionId must not be clobbered.
      if (registrations.get(sessionId) === state) {
        registrations.delete(sessionId);
      }
    };
  }

  async function push(sessionId: string, message: PushMessage): Promise<PushResult> {
    const state = registrations.get(sessionId);
    if (state === undefined) {
      return {
        ok: false,
        deliveredCount: 0,
        error: "session not registered",
        reason: "not-registered",
      };
    }

    // Cheap synchronous validation — no routing decisions here.
    if (typeof message.content !== "string" || message.content.length === 0) {
      return {
        ok: false,
        deliveredCount: 0,
        error: "message content is empty",
        reason: "empty-content",
      };
    }

    // Serialize concurrent pushes to the same session via a per-session
    // promise chain. The chain link below resolves to the eventual
    // PushResult; the queue itself only tracks sequencing (void chain).
    const resultPromise = state.pushQueue.then(() => runPush(state, message));

    // Keep the queue "void" — swallow resolution/rejection so the next
    // link doesn't see an unrelated rejection. The actual result is
    // returned to the caller through `resultPromise`.
    state.pushQueue = resultPromise.then(
      () => undefined,
      () => undefined,
    );

    return resultPromise;
  }

  async function runPush(state: RegistrationState, message: PushMessage): Promise<PushResult> {
    const now = Date.now();

    // Dedupe check — must come before rate check, otherwise a
    // duplicate would eat one of the rate-limit slots.
    if (state.dedupe && message.correlationId !== undefined) {
      trimRecentCorrelations(state, now);
      if (state.recentCorrelations.has(message.correlationId)) {
        return {
          ok: false,
          deliveredCount: 0,
          error: "duplicate correlationId within 30s",
          reason: "dedupe",
        };
      }
    }

    // Rate-limit check (sliding 60s window).
    trimRecentTimestamps(state, now);
    if (state.recentTimestamps.length >= state.maxPerMinute) {
      return {
        ok: false,
        deliveredCount: 0,
        error: `rate limit exceeded (${state.maxPerMinute}/min)`,
        reason: "rate-limited",
      };
    }

    // Reserve a slot and the correlation entry BEFORE invoking the
    // sink. If the sink throws we still count it against the rate
    // budget — otherwise a repeatedly-failing sink becomes a free
    // bypass for the throttle.
    state.recentTimestamps.push(now);
    if (state.dedupe && message.correlationId !== undefined) {
      state.recentCorrelations.set(message.correlationId, now);
    }

    try {
      await state.sink(message);
      return { ok: true, deliveredCount: 1 };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        deliveredCount: 0,
        error: errorMessage,
        reason: "sink-error",
      };
    }
  }

  function has(sessionId: string): boolean {
    return registrations.has(sessionId);
  }

  function list(): readonly string[] {
    return [...registrations.keys()];
  }

  return { register, push, has, list };
}
