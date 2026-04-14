/**
 * Stream checkpointing and resume support.
 * Persists interrupted streaming queries so the CLI can continue them later.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage, WotannQueryOptions, ProviderName, SessionState } from "./types.js";

export type StreamCheckpointStatus = "running" | "interrupted" | "completed" | "resumed";

interface SerializedSessionState {
  readonly id: string;
  readonly startedAt: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly toolCalls: number;
  readonly messages: readonly AgentMessage[];
}

interface SerializableQueryOptions {
  readonly prompt: string;
  readonly context?: readonly AgentMessage[];
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly provider?: ProviderName;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface StreamCheckpoint {
  readonly id: string;
  readonly status: StreamCheckpointStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly options: SerializableQueryOptions;
  readonly partialContent: string;
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly lastError?: string;
  readonly retries: number;
  readonly ttsrInjections: readonly string[];
  readonly sessionBeforeQuery: SerializedSessionState;
}

export interface ResumeQuery {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly context?: readonly AgentMessage[];
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export class StreamCheckpointStore {
  constructor(private readonly storageDir: string) {}

  start(options: WotannQueryOptions, sessionBeforeQuery: SessionState): StreamCheckpoint {
    const checkpoint: StreamCheckpoint = {
      id: `stream-${Date.now()}`,
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      options: {
        prompt: options.prompt,
        context: options.context ? [...options.context] : undefined,
        systemPrompt: options.systemPrompt,
        model: options.model,
        provider: options.provider,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      },
      partialContent: "",
      retries: 0,
      ttsrInjections: [],
      sessionBeforeQuery: serializeSession(sessionBeforeQuery),
    };
    this.write(checkpoint);
    return checkpoint;
  }

  appendText(id: string, text: string, provider?: ProviderName, model?: string): StreamCheckpoint | null {
    const checkpoint = this.get(id);
    if (!checkpoint) return null;

    const updated: StreamCheckpoint = {
      ...checkpoint,
      partialContent: checkpoint.partialContent + text,
      provider: provider ?? checkpoint.provider,
      model: model ?? checkpoint.model,
      updatedAt: new Date().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  recordRetry(id: string, injections: readonly string[]): StreamCheckpoint | null {
    const checkpoint = this.get(id);
    if (!checkpoint) return null;

    const updated: StreamCheckpoint = {
      ...checkpoint,
      retries: checkpoint.retries + 1,
      partialContent: "",
      ttsrInjections: [...checkpoint.ttsrInjections, ...injections],
      updatedAt: new Date().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  markInterrupted(id: string, lastError?: string): StreamCheckpoint | null {
    return this.updateStatus(id, "interrupted", lastError);
  }

  markCompleted(id: string): StreamCheckpoint | null {
    return this.updateStatus(id, "completed");
  }

  markResumed(id: string): StreamCheckpoint | null {
    return this.updateStatus(id, "resumed");
  }

  get(id: string): StreamCheckpoint | null {
    const filePath = join(this.storageDir, `${id}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as StreamCheckpoint;
    } catch {
      return null;
    }
  }

  getLatestInterrupted(): StreamCheckpoint | null {
    if (!existsSync(this.storageDir)) return null;

    const files = readdirSync(this.storageDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => this.get(file.replace(/\.json$/, "")))
      .filter((entry): entry is StreamCheckpoint => entry !== null)
      .filter((entry) => entry.status === "interrupted")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    return files[0] ?? null;
  }

  private updateStatus(id: string, status: StreamCheckpointStatus, lastError?: string): StreamCheckpoint | null {
    const checkpoint = this.get(id);
    if (!checkpoint) return null;

    const updated: StreamCheckpoint = {
      ...checkpoint,
      status,
      updatedAt: new Date().toISOString(),
      lastError,
    };
    this.write(updated);
    return updated;
  }

  private write(checkpoint: StreamCheckpoint): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    writeFileSync(
      join(this.storageDir, `${checkpoint.id}.json`),
      JSON.stringify(checkpoint, null, 2),
    );
  }
}

export function deserializeSession(session: SerializedSessionState): SessionState {
  return {
    ...session,
    startedAt: new Date(session.startedAt),
    messages: [...session.messages],
    incognito: false,
  };
}

export function buildResumeQuery(checkpoint: StreamCheckpoint): ResumeQuery {
  const resumeInstructions = [
    "Resume an interrupted assistant response.",
    "Continue from the exact next sentence without repeating the partial content verbatim.",
    "Treat the previous partial output as already shown to the user.",
    "",
    "Partial response already delivered:",
    checkpoint.partialContent || "(no partial content persisted)",
  ].join("\n");

  return {
    prompt: checkpoint.options.prompt,
    context: checkpoint.options.context ? [...checkpoint.options.context] : undefined,
    provider: checkpoint.options.provider,
    model: checkpoint.options.model,
    maxTokens: checkpoint.options.maxTokens,
    temperature: checkpoint.options.temperature,
    systemPrompt: [checkpoint.options.systemPrompt, resumeInstructions].filter(Boolean).join("\n\n"),
  };
}

function serializeSession(session: SessionState): SerializedSessionState {
  return {
    id: session.id,
    startedAt: session.startedAt.toISOString(),
    provider: session.provider,
    model: session.model,
    totalTokens: session.totalTokens,
    totalCost: session.totalCost,
    toolCalls: session.toolCalls,
    messages: [...session.messages],
  };
}
