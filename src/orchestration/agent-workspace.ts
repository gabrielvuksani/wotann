/**
 * Filesystem Inter-Agent Communication -- agents write results to shared
 * JSON files instead of return values (which get truncated in long contexts).
 *
 * Inspired by Perplexity's JSON workspace pattern. Each message is a separate
 * JSON file in `{workspaceDir}/.wotann/agent-workspace/{messageId}.json`.
 *
 * This sidesteps context window limits: an agent can write a 50KB result
 * and another agent reads it from disk instead of receiving it inline.
 */

import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  statSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

// -- Types -------------------------------------------------------------------

export type MessageType = "result" | "request" | "status" | "error";

export interface WorkspaceMessage {
  readonly id: string;
  readonly fromAgent: string;
  readonly toAgent: string | "broadcast";
  readonly type: MessageType;
  readonly content: unknown;
  readonly timestamp: number;
}

export interface WorkspaceStats {
  readonly messageCount: number;
  readonly totalSizeBytes: number;
}

// -- Constants ---------------------------------------------------------------

const WORKSPACE_SUBDIR = ".wotann/agent-workspace";
const MESSAGE_EXTENSION = ".json";

// -- Implementation ----------------------------------------------------------

export class AgentWorkspace {
  private readonly workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = join(workspaceDir, WORKSPACE_SUBDIR);
    ensureDir(this.workspaceDir);
  }

  /**
   * Write a message to the workspace.
   * Returns the generated message ID.
   */
  write(
    message: Omit<WorkspaceMessage, "id" | "timestamp">,
  ): string {
    const id = `msg_${randomUUID().slice(0, 12)}`;
    const timestamp = Date.now();

    const fullMessage: WorkspaceMessage = {
      ...message,
      id,
      timestamp,
    };

    const filePath = join(this.workspaceDir, `${id}${MESSAGE_EXTENSION}`);
    writeFileSync(filePath, JSON.stringify(fullMessage, null, 2), "utf-8");

    return id;
  }

  /**
   * Read messages addressed to a specific agent.
   * Optionally filter to messages after a timestamp.
   */
  readFor(agentId: string, since?: number): readonly WorkspaceMessage[] {
    const allMessages = this.readAllMessages();
    return allMessages.filter((msg) => {
      if (msg.toAgent !== agentId && msg.toAgent !== "broadcast") return false;
      if (since !== undefined && msg.timestamp <= since) return false;
      return true;
    });
  }

  /**
   * Read all broadcast messages, optionally since a timestamp.
   */
  readBroadcasts(since?: number): readonly WorkspaceMessage[] {
    const allMessages = this.readAllMessages();
    return allMessages.filter((msg) => {
      if (msg.toAgent !== "broadcast") return false;
      if (since !== undefined && msg.timestamp <= since) return false;
      return true;
    });
  }

  /**
   * Read a single message by ID.
   */
  readMessage(messageId: string): WorkspaceMessage | null {
    const filePath = join(this.workspaceDir, `${messageId}${MESSAGE_EXTENSION}`);
    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as WorkspaceMessage;
    } catch {
      return null;
    }
  }

  /**
   * Clean up messages older than the given threshold (default 1 hour).
   * Returns the number of messages removed.
   */
  cleanup(olderThanMs: number = 3_600_000): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    const files = listMessageFiles(this.workspaceDir);

    for (const fileName of files) {
      const filePath = join(this.workspaceDir, fileName);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const msg = JSON.parse(raw) as WorkspaceMessage;

        if (msg.timestamp <= cutoff) {
          unlinkSync(filePath);
          removed++;
        }
      } catch {
        // If we can't read the file, try to remove it anyway
        try {
          unlinkSync(filePath);
          removed++;
        } catch {
          // Skip
        }
      }
    }

    return removed;
  }

  /**
   * Get workspace statistics.
   */
  getStats(): WorkspaceStats {
    const files = listMessageFiles(this.workspaceDir);
    let totalSizeBytes = 0;

    for (const fileName of files) {
      try {
        const stat = statSync(join(this.workspaceDir, fileName));
        totalSizeBytes += stat.size;
      } catch {
        // Skip
      }
    }

    return {
      messageCount: files.length,
      totalSizeBytes,
    };
  }

  /**
   * Get the filesystem path to the workspace directory.
   */
  getWorkspacePath(): string {
    return this.workspaceDir;
  }

  // -- Private ---------------------------------------------------------------

  private readAllMessages(): readonly WorkspaceMessage[] {
    const files = listMessageFiles(this.workspaceDir);
    const messages: WorkspaceMessage[] = [];

    for (const fileName of files) {
      const filePath = join(this.workspaceDir, fileName);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const msg = JSON.parse(raw) as WorkspaceMessage;
        messages.push(msg);
      } catch {
        // Skip malformed files
      }
    }

    // Sort by timestamp ascending
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }
}

// -- Helpers -----------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function listMessageFiles(dir: string): readonly string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(MESSAGE_EXTENSION));
  } catch {
    return [];
  }
}
