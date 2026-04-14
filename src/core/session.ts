/**
 * Session state management. Tracks provider, model, tokens, cost, and messages.
 * Immutable state updates — each mutation returns a new session.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentMessage, ProviderName, SessionState } from "./types.js";

export function createSession(
  provider: ProviderName,
  model: string,
  options?: { incognito?: boolean },
): SessionState {
  return {
    id: randomUUID(),
    startedAt: new Date(),
    provider,
    model,
    totalTokens: 0,
    totalCost: 0,
    toolCalls: 0,
    messages: [],
    incognito: options?.incognito ?? false,
  };
}

export function addMessage(
  session: SessionState,
  message: AgentMessage,
): SessionState {
  return {
    ...session,
    messages: [...session.messages, message],
    totalTokens: session.totalTokens + (message.tokensUsed ?? 0),
    totalCost: session.totalCost + (message.cost ?? 0),
    toolCalls: session.toolCalls + (message.toolName ? 1 : 0),
  };
}

export function updateModel(
  session: SessionState,
  provider: ProviderName,
  model: string,
): SessionState {
  return { ...session, provider, model };
}

export function formatSessionStats(session: SessionState): string {
  const duration = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  return [
    `Session: ${session.id.slice(0, 8)}`,
    `Duration: ${minutes}m ${seconds}s`,
    `Provider: ${session.provider} (${session.model})`,
    `Tokens: ${session.totalTokens.toLocaleString()}`,
    `Cost: $${session.totalCost.toFixed(4)}`,
    `Tool calls: ${session.toolCalls}`,
    `Messages: ${session.messages.length}`,
  ].join("\n");
}

// ── Session Persistence ────────────────────────────────────

interface SerializedSession {
  readonly id: string;
  readonly startedAt: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly toolCalls: number;
  readonly messages: readonly AgentMessage[];
  readonly savedAt: string;
  readonly cwd: string;
}

/**
 * Save session state to disk for resume.
 */
export function saveSession(
  session: SessionState,
  sessionDir: string,
): string {
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  const serialized: SerializedSession = {
    id: session.id,
    startedAt: session.startedAt.toISOString(),
    provider: session.provider,
    model: session.model,
    totalTokens: session.totalTokens,
    totalCost: session.totalCost,
    toolCalls: session.toolCalls,
    messages: session.messages,
    savedAt: new Date().toISOString(),
    cwd: process.cwd(),
  };

  const filePath = join(sessionDir, `${session.id}.json`);
  writeFileSync(filePath, JSON.stringify(serialized, null, 2));
  return filePath;
}

/**
 * Restore a session from disk.
 */
export function restoreSession(filePath: string): SessionState | null {
  if (!existsSync(filePath)) return null;

  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as SerializedSession;
    return {
      id: data.id,
      startedAt: new Date(data.startedAt),
      provider: data.provider,
      model: data.model,
      totalTokens: data.totalTokens,
      totalCost: data.totalCost,
      toolCalls: data.toolCalls,
      messages: data.messages,
      incognito: false,
    };
  } catch {
    return null;
  }
}

/**
 * Find the most recent session for the current directory.
 */
export function findLatestSession(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;

  const files = readdirSync(sessionDir)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => {
      const filePath = join(sessionDir, f);
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8")) as SerializedSession;
        return { path: filePath, savedAt: new Date(data.savedAt).getTime(), cwd: data.cwd };
      } catch {
        return null;
      }
    })
    .filter((e): e is { path: string; savedAt: number; cwd: string } => e !== null)
    .filter((e) => e.cwd === process.cwd())
    .sort((a, b) => b.savedAt - a.savedAt);

  return files[0]?.path ?? null;
}
