/**
 * Structured JSON logger for auditability.
 * Append-only JSONL format, queryable by tool/agent/date.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly category: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly sessionId?: string;
}

export class StructuredLogger {
  private readonly logDir: string;
  private readonly sessionId: string;
  private minLevel: LogLevel;

  constructor(logDir: string, sessionId: string, minLevel: LogLevel = "info") {
    this.logDir = logDir;
    this.sessionId = sessionId;
    this.minLevel = minLevel;

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  debug(category: string, message: string, data?: Record<string, unknown>): void {
    this.log("debug", category, message, data);
  }

  info(category: string, message: string, data?: Record<string, unknown>): void {
    this.log("info", category, message, data);
  }

  warn(category: string, message: string, data?: Record<string, unknown>): void {
    this.log("warn", category, message, data);
  }

  error(category: string, message: string, data?: Record<string, unknown>): void {
    this.log("error", category, message, data);
  }

  private log(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
      sessionId: this.sessionId,
    };

    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(this.logDir, `${today}.jsonl`);
    appendFileSync(logFile, JSON.stringify(entry) + "\n");
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: readonly LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  /**
   * Query log entries by date and optional filters.
   */
  query(date: string, filters?: { category?: string; level?: LogLevel }): readonly LogEntry[] {
    const logFile = join(this.logDir, `${date}.jsonl`);
    if (!existsSync(logFile)) return [];

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    let entries = lines
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LogEntry);

    if (filters?.category) {
      entries = entries.filter((e) => e.category === filters.category);
    }
    if (filters?.level) {
      entries = entries.filter((e) => e.level === filters.level);
    }

    return entries;
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }
}
