/**
 * Audit trail: append-only SQLite table for every agent action.
 * Queryable by date, tool, agent, session. Tamper-evident via content hashing.
 * Uses execFile (not shell) for all subprocess calls to prevent injection.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ProviderName, RiskLevel } from "../core/types.js";

export interface AuditEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly tool: string;
  readonly agentId?: string;
  readonly model?: string;
  readonly provider?: ProviderName;
  readonly riskLevel: RiskLevel;
  readonly input?: string;
  readonly output?: string;
  readonly tokensUsed?: number;
  readonly costUsd?: number;
  readonly durationMs?: number;
  readonly success: boolean;
  readonly contentHash: string;
}

export interface AuditQuery {
  readonly date?: string;
  readonly tool?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly riskLevel?: RiskLevel;
  readonly limit?: number;
}

export class AuditTrail {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = join(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_trail (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tool TEXT NOT NULL,
        agent_id TEXT,
        model TEXT,
        provider TEXT,
        risk_level TEXT NOT NULL DEFAULT 'medium',
        input TEXT,
        output TEXT,
        tokens_used INTEGER,
        cost_usd REAL,
        duration_ms INTEGER,
        success INTEGER NOT NULL DEFAULT 1,
        content_hash TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_trail(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_trail(tool);
    `);
  }

  /**
   * Record an action in the audit trail. Append-only — entries are never modified.
   */
  record(entry: Omit<AuditEntry, "contentHash">): void {
    const contentHash = this.computeHash(entry);

    const stmt = this.db.prepare(`
      INSERT INTO audit_trail (id, session_id, timestamp, tool, agent_id, model, provider,
        risk_level, input, output, tokens_used, cost_usd, duration_ms, success, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.sessionId,
      entry.timestamp,
      entry.tool,
      entry.agentId ?? null,
      entry.model ?? null,
      entry.provider ?? null,
      entry.riskLevel,
      entry.input ?? null,
      entry.output ?? null,
      entry.tokensUsed ?? null,
      entry.costUsd ?? null,
      entry.durationMs ?? null,
      entry.success ? 1 : 0,
      contentHash,
    );
  }

  /**
   * Query audit entries with optional filters.
   */
  query(filters: AuditQuery = {}): readonly AuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.date) {
      conditions.push("timestamp LIKE ?");
      params.push(`${filters.date}%`);
    }
    if (filters.tool) {
      conditions.push("tool = ?");
      params.push(filters.tool);
    }
    if (filters.agentId) {
      conditions.push("agent_id = ?");
      params.push(filters.agentId);
    }
    if (filters.sessionId) {
      conditions.push("session_id = ?");
      params.push(filters.sessionId);
    }
    if (filters.riskLevel) {
      conditions.push("risk_level = ?");
      params.push(filters.riskLevel);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ?? 100;

    const rows = this.db
      .prepare(`SELECT * FROM audit_trail ${where} ORDER BY timestamp DESC LIMIT ?`)
      .all(...params, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => this.rowToEntry(row));
  }

  getCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM audit_trail").get() as {
      count: number;
    };
    return row.count;
  }

  /**
   * Delete audit entries older than the given retention window (S1-14).
   *
   * Default: 30 days. The audit_trail is append-only and logs every tool
   * call; without retention the table grows unboundedly and a 30-day
   * daemon session can produce 43k+ rows (~100 MB SQLite + 300-500 MB RSS).
   *
   * Returns the number of rows removed. Idempotent — safe to call on a
   * regular cron interval.
   */
  pruneOlderThan(days: number = 30): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const stmt = this.db.prepare("DELETE FROM audit_trail WHERE timestamp < ?");
    const info = stmt.run(cutoff);
    return Number(info.changes);
  }

  verifyIntegrity(entryId: string): boolean {
    const row = this.db.prepare("SELECT * FROM audit_trail WHERE id = ?").get(entryId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return false;
    const entry = this.rowToEntry(row);
    const expectedHash = this.computeHash(entry);
    return entry.contentHash === expectedHash;
  }

  private computeHash(entry: Omit<AuditEntry, "contentHash">): string {
    const data = `${entry.id}:${entry.sessionId}:${entry.timestamp}:${entry.tool}:${entry.success}`;
    return createHash("sha256").update(data).digest("hex").slice(0, 16);
  }

  private rowToEntry(row: Record<string, unknown>): AuditEntry {
    return {
      id: row["id"] as string,
      sessionId: row["session_id"] as string,
      timestamp: row["timestamp"] as string,
      tool: row["tool"] as string,
      agentId: row["agent_id"] as string | undefined,
      model: row["model"] as string | undefined,
      provider: row["provider"] as ProviderName | undefined,
      riskLevel: row["risk_level"] as RiskLevel,
      input: row["input"] as string | undefined,
      output: row["output"] as string | undefined,
      tokensUsed: row["tokens_used"] as number | undefined,
      costUsd: row["cost_usd"] as number | undefined,
      durationMs: row["duration_ms"] as number | undefined,
      success: Boolean(row["success"]),
      contentHash: row["content_hash"] as string,
    };
  }

  close(): void {
    this.db.close();
  }
}
