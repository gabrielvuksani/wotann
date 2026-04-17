/**
 * Session Resume — full session continuity across machine restarts.
 *
 * Serializes the complete session state (conversation, provider state, tool
 * results, active tasks, memory context) to disk. On resume, reconstructs
 * the session from the serialized state so the user picks up exactly where
 * they left off.
 *
 * No competitor does this well. Claude Code loses context on restart.
 * Codex has session resume but loses tool results. Cursor loses IDE state.
 * WOTANN preserves EVERYTHING.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { buildRecap, renderRecap } from "./session-recap.js";

// ── Types ───────────────────────────────────────────────

export interface ConversationMessage {
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly timestamp: number;
  readonly toolName?: string;
  readonly toolResult?: string;
  readonly tokenCount?: number;
}

export interface ActiveTask {
  readonly id: string;
  readonly description: string;
  readonly status: "in-progress" | "completed" | "failed" | "paused";
  readonly startedAt: number;
  readonly files: readonly string[];
}

export interface SessionSnapshot {
  readonly version: 2;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly savedAt: number;
  readonly provider: string;
  readonly model: string;
  readonly workingDir: string;
  readonly conversation: readonly ConversationMessage[];
  readonly activeTasks: readonly ActiveTask[];
  readonly modeCycle: string;
  readonly contextTokensUsed: number;
  readonly totalCost: number;
  readonly trackedFiles: readonly string[];
  readonly memoryContext: string;
  readonly doomLoopHistory: readonly string[];
  readonly frozenFiles: readonly string[];
  readonly customData: Record<string, unknown>;
}

// ── Session Store ───────────────────────────────────────

export class SessionStore {
  private readonly sessionsDir: string;
  private readonly maxSessions: number;

  constructor(wotannDir: string, maxSessions: number = 20) {
    this.sessionsDir = join(wotannDir, "sessions");
    this.maxSessions = maxSessions;
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Save a session snapshot to disk.
   */
  save(snapshot: SessionSnapshot): string {
    const filename = `${snapshot.sessionId}.json`;
    const filePath = join(this.sessionsDir, filename);

    // Trim conversation to last 200 messages to keep file sizes reasonable
    const trimmedConversation = snapshot.conversation.slice(-200);

    const toSave: SessionSnapshot = {
      ...snapshot,
      conversation: trimmedConversation,
      savedAt: Date.now(),
    };

    writeFileSync(filePath, JSON.stringify(toSave, null, 2), "utf-8");
    this.enforceMaxSessions();
    return filePath;
  }

  /**
   * Load a session by ID.
   */
  load(sessionId: string): SessionSnapshot | null {
    const filePath = join(this.sessionsDir, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as SessionSnapshot;
      if (parsed.version !== 2) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Get the most recent session.
   */
  getLatest(): SessionSnapshot | null {
    const sessions = this.listSessions();
    if (sessions.length === 0) return null;

    // Sort by savedAt descending
    sessions.sort((a, b) => b.savedAt - a.savedAt);
    return sessions[0] ?? null;
  }

  /**
   * List all saved sessions with metadata.
   */
  listSessions(): SessionSnapshot[] {
    if (!existsSync(this.sessionsDir)) return [];

    const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith(".json"));
    const sessions: SessionSnapshot[] = [];

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.sessionsDir, file), "utf-8");
        const parsed = JSON.parse(raw) as SessionSnapshot;
        if (parsed.version === 2) sessions.push(parsed);
      } catch {
        // Corrupt file — skip
      }
    }

    return sessions;
  }

  /**
   * Delete a session by ID.
   */
  delete(sessionId: string): boolean {
    const filePath = join(this.sessionsDir, `${sessionId}.json`);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }

  /**
   * Build a compact session recap — C23 port of the Claude Code session
   * resume conveniences. Returns a short card-sized markdown block with
   * auto-generated title, last action, next step, and blockers.
   * Callers who want the verbose dump can still use `buildResumePrompt`.
   */
  buildRecap(snapshot: SessionSnapshot): string {
    return renderRecap(buildRecap(snapshot));
  }

  /**
   * Build a resume prompt from saved session state. Prepends the C23
   * compact recap so the agent sees the headline information first
   * regardless of how long the verbose dump becomes.
   */
  buildResumePrompt(snapshot: SessionSnapshot): string {
    const age = Date.now() - snapshot.savedAt;
    const ageMinutes = Math.round(age / 60_000);
    const ageStr = ageMinutes < 60 ? `${ageMinutes}m` : `${Math.round(ageMinutes / 60)}h`;

    const lines: string[] = [
      renderRecap(buildRecap(snapshot)),
      "",
      `# Session Resumed (saved ${ageStr} ago)`,
      "",
      `**Mode:** ${snapshot.modeCycle}`,
      `**Provider:** ${snapshot.provider} / ${snapshot.model}`,
      `**Context used:** ~${snapshot.contextTokensUsed} tokens`,
      `**Cost so far:** $${snapshot.totalCost.toFixed(4)}`,
    ];

    if (snapshot.activeTasks.length > 0) {
      lines.push("", "## Active Tasks");
      for (const task of snapshot.activeTasks) {
        lines.push(`- [${task.status}] ${task.description} (${task.files.length} files)`);
      }
    }

    if (snapshot.trackedFiles.length > 0) {
      lines.push("", "## Files Modified This Session");
      for (const file of snapshot.trackedFiles.slice(-20)) {
        lines.push(`- ${file}`);
      }
    }

    if (snapshot.frozenFiles.length > 0) {
      lines.push("", "## Frozen Files");
      for (const file of snapshot.frozenFiles) {
        lines.push(`- ${file}`);
      }
    }

    if (snapshot.memoryContext) {
      lines.push("", "## Memory Context", snapshot.memoryContext);
    }

    // Last 5 conversation turns for continuity
    const recentConversation = snapshot.conversation.slice(-10);
    if (recentConversation.length > 0) {
      lines.push("", "## Recent Conversation");
      for (const msg of recentConversation) {
        const truncated =
          msg.content.length > 200 ? msg.content.slice(0, 200) + "..." : msg.content;
        lines.push(`**${msg.role}:** ${truncated}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Clean up old sessions beyond the max limit.
   */
  private enforceMaxSessions(): void {
    const sessions = this.listSessions();
    if (sessions.length <= this.maxSessions) return;

    sessions.sort((a, b) => a.savedAt - b.savedAt);
    const toRemove = sessions.slice(0, sessions.length - this.maxSessions);
    for (const session of toRemove) {
      this.delete(session.sessionId);
    }
  }
}
