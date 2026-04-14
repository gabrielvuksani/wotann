/**
 * iMessage Channel Adapter — macOS only.
 *
 * Reads messages from ~/Library/Messages/chat.db (SQLite) and sends
 * replies via AppleScript. Requires Full Disk Access permission on macOS.
 *
 * Architecture:
 * - Read: Poll chat.db for new messages since last check (via sqlite3 CLI)
 * - Send: AppleScript `tell application "Messages" to send`
 * - Platform: macOS only (darwin). No-op on Linux/Windows.
 *
 * Security: Uses execFileSync (not execSync) to prevent shell injection.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────

export interface IMessageConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly allowedContacts?: readonly string[];
}

export interface IMessageIncoming {
  readonly id: string;
  readonly sender: string;
  readonly text: string;
  readonly timestamp: number;
  readonly isFromMe: boolean;
  readonly chatId: string;
}

// ── Constants ────────────────────────────────────────────

const CHAT_DB_PATH = join(homedir(), "Library", "Messages", "chat.db");
const DEFAULT_POLL_MS = 10_000;
const IS_MACOS = platform() === "darwin";

// ── Adapter ──────────────────────────────────────────────

export class IMessageAdapter {
  private readonly config: IMessageConfig;
  private lastCheckedRowId = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private messageHandler: ((msg: IMessageIncoming) => void) | null = null;

  constructor(config?: Partial<IMessageConfig>) {
    this.config = {
      enabled: IS_MACOS && existsSync(CHAT_DB_PATH),
      pollIntervalMs: DEFAULT_POLL_MS,
      ...config,
    };
  }

  /** Check if iMessage is available on this platform. */
  isAvailable(): boolean {
    return IS_MACOS && existsSync(CHAT_DB_PATH);
  }

  /** Set the handler for incoming messages. */
  onMessage(handler: (msg: IMessageIncoming) => void): void {
    this.messageHandler = handler;
  }

  /** Start polling for new messages. */
  start(): void {
    if (!this.config.enabled || !this.isAvailable()) return;

    // Get the latest row ID to avoid processing old messages
    try {
      const result = execFileSync(
        "sqlite3",
        [CHAT_DB_PATH, "SELECT MAX(ROWID) FROM message"],
        { encoding: "utf-8", timeout: 5000 },
      ).trim();
      this.lastCheckedRowId = parseInt(result, 10) || 0;
    } catch {
      // Can't access chat.db — Full Disk Access may not be granted
      return;
    }

    this.pollTimer = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Send a message via iMessage using AppleScript (osascript). */
  send(recipient: string, text: string): boolean {
    if (!IS_MACOS) return false;

    // Sanitize: remove characters that could break AppleScript string literals
    const safeRecipient = recipient.replace(/["\\]/g, "");
    const safeText = text.replace(/["\\]/g, "").replace(/\n/g, " ");

    const script = `tell application "Messages" to send "${safeText}" to buddy "${safeRecipient}" of (service 1 whose service type is iMessage)`;

    try {
      execFileSync("osascript", ["-e", script], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  // ── Private ────────────────────────────────────────────

  private poll(): void {
    if (!this.messageHandler) return;

    const query = [
      "SELECT m.ROWID, m.text, m.date, m.is_from_me,",
      "h.id AS sender, c.chat_identifier",
      "FROM message m",
      "LEFT JOIN handle h ON m.handle_id = h.ROWID",
      "LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id",
      "LEFT JOIN chat c ON cmj.chat_id = c.ROWID",
      `WHERE m.ROWID > ${this.lastCheckedRowId}`,
      "AND m.text IS NOT NULL",
      "ORDER BY m.ROWID ASC LIMIT 20",
    ].join(" ");

    try {
      const result = execFileSync(
        "sqlite3",
        ["-separator", "|", CHAT_DB_PATH, query],
        { encoding: "utf-8", timeout: 5000 },
      ).trim();

      if (!result) return;

      for (const line of result.split("\n")) {
        const parts = line.split("|");
        if (parts.length < 6) continue;

        const rowId = parseInt(parts[0] ?? "0", 10);
        const text = parts[1] ?? "";
        const macosTimestamp = parseInt(parts[2] ?? "0", 10);
        const isFromMe = parts[3] === "1";
        const sender = parts[4] ?? "";
        const chatId = parts[5] ?? "";

        // Skip messages from ourselves
        if (isFromMe) {
          this.lastCheckedRowId = Math.max(this.lastCheckedRowId, rowId);
          continue;
        }

        // Filter by allowed contacts if configured
        if (this.config.allowedContacts && !this.config.allowedContacts.includes(sender)) {
          this.lastCheckedRowId = Math.max(this.lastCheckedRowId, rowId);
          continue;
        }

        // macOS Messages uses nanoseconds since 2001-01-01
        const timestamp = macosTimestamp > 0
          ? new Date("2001-01-01T00:00:00Z").getTime() + Math.floor(macosTimestamp / 1_000_000)
          : Date.now();

        this.messageHandler({
          id: `imsg-${rowId}`,
          sender,
          text,
          timestamp,
          isFromMe,
          chatId,
        });

        this.lastCheckedRowId = Math.max(this.lastCheckedRowId, rowId);
      }
    } catch {
      // SQLite query failed — likely permissions issue
    }
  }
}
