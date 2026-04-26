/**
 * Session Replay — deterministic replay for debugging and testing.
 *
 * Records every LLM interaction (prompt, response, tools, timing) into a
 * replay log. Can replay the entire session with mocked provider responses
 * to reproduce bugs or test changes.
 *
 * From spec §24: TerminalBench-compatible session recording.
 */

import { mkdirSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface ReplayEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly type: ReplayEventType;
  readonly data: Record<string, unknown>;
}

export type ReplayEventType =
  | "prompt"
  | "response"
  | "tool_call"
  | "tool_result"
  | "mode_change"
  | "provider_switch"
  | "compaction"
  | "error"
  | "checkpoint"
  | "turn";

/**
 * Wave 4G: structured per-turn event record. Emitted once per
 * `runtime.query()` final chunk with full usage + cost + tool-call
 * breakdown so `.wotann/events.jsonl` carries everything a dashboard
 * needs without re-running the session.
 */
export interface TurnEventData {
  readonly sessionId: string;
  readonly turnId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly toolCalls: number;
}

export interface ReplaySession {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly provider: string;
  readonly model: string;
  readonly events: readonly ReplayEvent[];
  readonly metadata: Record<string, string>;
}

export class SessionRecorder {
  private events: ReplayEvent[] = [];
  private readonly sessionId: string;
  private readonly startedAt: number;
  private provider: string;
  private model: string;
  private recording = false;
  /**
   * Wave 4G: append-only JSONL events sink. When set, every recorded
   * event is also flushed to this file so `wotann telemetry tail` can
   * stream live events without loading the whole session JSON.
   */
  private eventsFilePath: string | null = null;

  constructor(provider: string, model: string, sessionId?: string) {
    this.sessionId = sessionId ?? randomUUID();
    this.startedAt = Date.now();
    this.provider = provider;
    this.model = model;
  }

  /**
   * Wave 4G: mirror every recorded event to a JSONL sink so a second
   * process can tail the file in real time. Pass `null` to stop
   * mirroring; pass a new path to redirect. Best-effort — disk errors
   * are swallowed so a broken sink can never crash the runtime.
   */
  setEventsSink(filePath: string | null): void {
    this.eventsFilePath = filePath;
  }

  /** Expose the session identifier so callers can tag related events. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Start recording */
  start(): void {
    this.recording = true;
  }

  /** Stop recording */
  stop(): void {
    this.recording = false;
  }

  /** Check if recording */
  isRecording(): boolean {
    return this.recording;
  }

  /** Record a prompt being sent */
  recordPrompt(prompt: string, systemPrompt?: string): ReplayEvent {
    return this.record("prompt", { prompt, systemPrompt });
  }

  /** Record a response received */
  recordResponse(response: string, tokens: number, costUsd: number): ReplayEvent {
    return this.record("response", { response, tokens, costUsd });
  }

  /** Record a tool call */
  recordToolCall(toolName: string, input: Record<string, unknown>): ReplayEvent {
    return this.record("tool_call", { toolName, input });
  }

  /** Record a tool result */
  recordToolResult(toolName: string, output: string, success: boolean): ReplayEvent {
    return this.record("tool_result", { toolName, output: output.slice(0, 5000), success });
  }

  /** Record a provider switch */
  recordProviderSwitch(from: string, to: string, reason: string): ReplayEvent {
    this.provider = to;
    return this.record("provider_switch", { from, to, reason });
  }

  /** Record a compaction event */
  recordCompaction(tokensBefore: number, tokensAfter: number): ReplayEvent {
    return this.record("compaction", { tokensBefore, tokensAfter });
  }

  /** Record an error */
  recordError(error: string, source: string): ReplayEvent {
    return this.record("error", { error, source });
  }

  /**
   * Wave 4G: record a structured per-turn event. Called once per
   * `runtime.query()` final chunk with the full usage + cost + tool
   * breakdown so `.wotann/events.jsonl` carries everything a dashboard
   * needs without re-running the session. `turnId` is a stable per-turn
   * UUID — when absent a fresh one is minted so callers that don't
   * thread it through still get a unique value.
   */
  recordTurn(turn: Omit<TurnEventData, "sessionId" | "turnId"> & { turnId?: string }): ReplayEvent {
    const data: TurnEventData = {
      sessionId: this.sessionId,
      turnId: turn.turnId ?? randomUUID(),
      provider: turn.provider,
      model: turn.model,
      promptTokens: turn.promptTokens,
      completionTokens: turn.completionTokens,
      ...(turn.cacheReadTokens !== undefined ? { cacheReadTokens: turn.cacheReadTokens } : {}),
      ...(turn.cacheWriteTokens !== undefined ? { cacheWriteTokens: turn.cacheWriteTokens } : {}),
      costUsd: turn.costUsd,
      durationMs: turn.durationMs,
      toolCalls: turn.toolCalls,
    };
    return this.record("turn", data as unknown as Record<string, unknown>);
  }

  /** Save session to disk */
  save(directory: string): string {
    mkdirSync(directory, { recursive: true });
    const filename = `session_${this.sessionId}_${this.startedAt}.json`;
    const filePath = join(directory, filename);

    const session: ReplaySession = {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      provider: this.provider,
      model: this.model,
      events: this.events,
      metadata: {
        duration: String(Date.now() - this.startedAt),
        eventCount: String(this.events.length),
      },
    };

    // Wave 6.5-UU (H-22) — session replay log. Atomic write so a crash
    // mid-save doesn't strand a half-written replay (which would fail
    // to load and lose the entire recorded session).
    writeFileAtomic(filePath, JSON.stringify(session, null, 2));
    return filePath;
  }

  /** Get the session for inspection */
  getSession(): ReplaySession {
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      provider: this.provider,
      model: this.model,
      events: [...this.events],
      metadata: {},
    };
  }

  private record(type: ReplayEventType, data: Record<string, unknown>): ReplayEvent {
    const event: ReplayEvent = {
      id: randomUUID(),
      timestamp: Date.now(),
      type,
      data,
    };
    if (this.recording) {
      this.events.push(event);
    }
    // Wave 4G: mirror to JSONL sink if configured. Write happens even
    // when `recording` is false so in-process "always-on" telemetry
    // remains captured; callers that want a hard pause should clear the
    // sink before disabling recording. Failures are best-effort so a
    // broken disk can't crash the query.
    if (this.eventsFilePath) {
      try {
        mkdirSync(dirname(this.eventsFilePath), { recursive: true });
        appendFileSync(this.eventsFilePath, JSON.stringify(event) + "\n", {
          encoding: "utf-8",
        });
      } catch {
        // best-effort — never let disk errors crash the query
      }
    }
    return event;
  }
}

/**
 * Session Player — replay a recorded session with mocked responses.
 */
export class SessionPlayer {
  private session: ReplaySession | null = null;
  private currentEventIndex = 0;

  /** Load a session from disk */
  load(filePath: string): boolean {
    if (!existsSync(filePath)) return false;
    try {
      const content = readFileSync(filePath, "utf-8");
      this.session = JSON.parse(content) as ReplaySession;
      this.currentEventIndex = 0;
      return true;
    } catch {
      return false;
    }
  }

  /** Load from a session object */
  loadSession(session: ReplaySession): void {
    this.session = session;
    this.currentEventIndex = 0;
  }

  /** Get the next event */
  nextEvent(): ReplayEvent | null {
    if (!this.session || this.currentEventIndex >= this.session.events.length) {
      return null;
    }
    return this.session.events[this.currentEventIndex++] ?? null;
  }

  /** Get events by type */
  getEventsByType(type: ReplayEventType): readonly ReplayEvent[] {
    if (!this.session) return [];
    return this.session.events.filter((e) => e.type === type);
  }

  /** Get the next mocked response (for replaying LLM calls) */
  getNextResponse(): string | null {
    if (!this.session) return null;
    while (this.currentEventIndex < this.session.events.length) {
      const event = this.session.events[this.currentEventIndex++];
      if (event?.type === "response") {
        return event.data["response"] as string;
      }
    }
    return null;
  }

  /** Reset to beginning */
  reset(): void {
    this.currentEventIndex = 0;
  }

  /** Check if replay is complete */
  isComplete(): boolean {
    if (!this.session) return true;
    return this.currentEventIndex >= this.session.events.length;
  }

  /** Get session info */
  getSessionInfo(): {
    sessionId: string;
    eventCount: number;
    provider: string;
    model: string;
  } | null {
    if (!this.session) return null;
    return {
      sessionId: this.session.sessionId,
      eventCount: this.session.events.length,
      provider: this.session.provider,
      model: this.session.model,
    };
  }
}
