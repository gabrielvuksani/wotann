/**
 * Dual-terminal steering -- control autonomous mode from a second terminal.
 * Inspired by GSD's live state editing.
 *
 * A file-watcher server that the autonomous runner checks at phase
 * boundaries. A second terminal can write steering commands that are
 * picked up without stopping the agent.
 *
 * Commands are stored as individual JSON files in the steering directory,
 * named with timestamps for ordering. Processed commands are moved to
 * a "processed" subdirectory.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────

export type SteeringCommandType =
  | "reprioritize"
  | "add-constraint"
  | "change-model"
  | "pause"
  | "resume"
  | "abort"
  | "add-context";

export interface SteeringCommand {
  readonly id: string;
  readonly type: SteeringCommandType;
  readonly data: string;
  readonly timestamp: number;
}

export interface SteeringServerOptions {
  readonly pollIntervalMs?: number;
}

// ── Constants ──────────────────────────────────────────

const COMMANDS_SUBDIR = "pending";
const PROCESSED_SUBDIR = "processed";
const FILE_EXTENSION = ".json";
const DEFAULT_POLL_INTERVAL_MS = 500;

// ── Steering Server ────────────────────────────────────

export class SteeringServer {
  private readonly steeringDir: string;
  private readonly pendingDir: string;
  private readonly processedDir: string;
  private watcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(steeringDir: string) {
    this.steeringDir = steeringDir;
    this.pendingDir = join(steeringDir, COMMANDS_SUBDIR);
    this.processedDir = join(steeringDir, PROCESSED_SUBDIR);
    this.ensureDirectories();
  }

  /**
   * Write a steering command (called from the second terminal).
   * Creates a timestamped JSON file in the pending directory.
   */
  writeCommand(command: Omit<SteeringCommand, "id">): SteeringCommand {
    this.ensureDirectories();

    const fullCommand: SteeringCommand = {
      id: `${command.timestamp}-${randomUUID().slice(0, 8)}`,
      type: command.type,
      data: command.data,
      timestamp: command.timestamp,
    };

    const fileName = `${fullCommand.id}${FILE_EXTENSION}`;
    const filePath = join(this.pendingDir, fileName);

    writeFileSync(filePath, JSON.stringify(fullCommand, null, 2));
    return fullCommand;
  }

  /**
   * Check for pending commands (called by autonomous runner at phase boundaries).
   * Returns all pending commands sorted by timestamp (oldest first).
   */
  checkCommands(): readonly SteeringCommand[] {
    if (!existsSync(this.pendingDir)) return [];

    const files = readdirSync(this.pendingDir)
      .filter((f) => f.endsWith(FILE_EXTENSION))
      .sort(); // Lexicographic sort works because filenames start with timestamp

    const commands: SteeringCommand[] = [];

    for (const file of files) {
      const parsed = this.readCommandFile(join(this.pendingDir, file));
      if (parsed) {
        commands.push(parsed);
      }
    }

    return commands;
  }

  /**
   * Move processed commands out of the pending directory.
   * Call after the runner has acted on the commands.
   */
  clearProcessed(commandIds?: readonly string[]): number {
    if (!existsSync(this.pendingDir)) return 0;
    this.ensureDirectories();

    const files = readdirSync(this.pendingDir).filter((f) => f.endsWith(FILE_EXTENSION));
    let cleared = 0;

    for (const file of files) {
      const filePath = join(this.pendingDir, file);
      const command = this.readCommandFile(filePath);

      if (!command) continue;

      // If specific IDs provided, only clear those
      if (commandIds && !commandIds.includes(command.id)) continue;

      const destPath = join(this.processedDir, file);
      renameSync(filePath, destPath);
      cleared++;
    }

    return cleared;
  }

  /**
   * Start watching for new commands via filesystem watcher.
   * Calls the callback whenever a new command file appears.
   */
  startWatching(
    onCommand: (cmd: SteeringCommand) => void,
    options?: SteeringServerOptions,
  ): void {
    if (this.watcher || this.pollTimer) {
      this.stopWatching();
    }

    this.ensureDirectories();

    // Use fs.watch for immediate notification
    try {
      this.watcher = watch(this.pendingDir, (eventType, filename) => {
        if (eventType === "rename" && filename?.endsWith(FILE_EXTENSION)) {
          const filePath = join(this.pendingDir, filename);
          if (existsSync(filePath)) {
            const command = this.readCommandFile(filePath);
            if (command) {
              onCommand(command);
            }
          }
        }
      });
    } catch {
      // fs.watch not available -- fall back to polling
    }

    // Also poll as a safety net (fs.watch can miss events)
    const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const knownFiles = new Set<string>();

    // Seed known files
    if (existsSync(this.pendingDir)) {
      for (const f of readdirSync(this.pendingDir)) {
        knownFiles.add(f);
      }
    }

    this.pollTimer = setInterval(() => {
      if (!existsSync(this.pendingDir)) return;

      const currentFiles = readdirSync(this.pendingDir).filter((f) =>
        f.endsWith(FILE_EXTENSION),
      );

      for (const file of currentFiles) {
        if (!knownFiles.has(file)) {
          knownFiles.add(file);
          const command = this.readCommandFile(join(this.pendingDir, file));
          if (command) {
            onCommand(command);
          }
        }
      }
    }, pollInterval);
  }

  /**
   * Stop the filesystem watcher and polling timer.
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Check if the watcher is currently active.
   */
  isWatching(): boolean {
    return this.watcher !== null || this.pollTimer !== null;
  }

  /**
   * Get the path to the pending commands directory.
   * Useful for the second terminal to know where to write.
   */
  getPendingDir(): string {
    return this.pendingDir;
  }

  // ── Private Helpers ──────────────────────────────────

  private ensureDirectories(): void {
    if (!existsSync(this.pendingDir)) {
      mkdirSync(this.pendingDir, { recursive: true });
    }
    if (!existsSync(this.processedDir)) {
      mkdirSync(this.processedDir, { recursive: true });
    }
  }

  private readCommandFile(filePath: string): SteeringCommand | null {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (
        typeof parsed["id"] !== "string" ||
        typeof parsed["type"] !== "string" ||
        typeof parsed["data"] !== "string" ||
        typeof parsed["timestamp"] !== "number"
      ) {
        return null;
      }

      return {
        id: parsed["id"],
        type: parsed["type"] as SteeringCommandType,
        data: parsed["data"],
        timestamp: parsed["timestamp"],
      };
    } catch {
      return null;
    }
  }
}
