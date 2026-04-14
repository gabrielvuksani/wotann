/**
 * Session Replay — deterministic replay for debugging and testing.
 *
 * Records every LLM interaction (prompt, response, tools, timing) into a
 * replay log. Can replay the entire session with mocked provider responses
 * to reproduce bugs or test changes.
 *
 * From spec §24: TerminalBench-compatible session recording.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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
  | "checkpoint";

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

  constructor(provider: string, model: string, sessionId?: string) {
    this.sessionId = sessionId ?? randomUUID();
    this.startedAt = Date.now();
    this.provider = provider;
    this.model = model;
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

    writeFileSync(filePath, JSON.stringify(session, null, 2));
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
  getSessionInfo(): { sessionId: string; eventCount: number; provider: string; model: string } | null {
    if (!this.session) return null;
    return {
      sessionId: this.session.sessionId,
      eventCount: this.session.events.length,
      provider: this.session.provider,
      model: this.session.model,
    };
  }
}
