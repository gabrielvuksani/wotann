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

/**
 * Genesis "previous hash" for the very first entry in a fresh chain.
 * 64 hex chars of zero — distinguishable from any real sha256 digest
 * and matches the convention used by Bitcoin / git (genesis = all-zero
 * parent). Wave 4-V hash-chain.
 */
const GENESIS_PREV_HASH = "0".repeat(64);

export class AuditTrail {
  private readonly db: Database.Database;
  /**
   * Wave 4-V (V9 audit-trail residual) — per-instance cache of the most
   * recent entry's contentHash. Used to chain the next record() call's
   * hash without an extra SELECT on the hot path. QB#7: per-instance,
   * never module-global, so concurrent AuditTrail instances (one per
   * dbPath, e.g. test fixtures) cannot poison each other's chain.
   *
   * Initialized lazily on first record(): we read the latest contentHash
   * from the entries table (so a process restart picks up where the
   * previous one left off). After that, every record() updates this
   * field with its own contentHash so the next append can chain off it
   * without a DB round-trip.
   *
   * `null` = not yet hydrated. `GENESIS_PREV_HASH` after hydration if
   * the table is empty.
   */
  private previousHash: string | null = null;

  constructor(dbPath: string) {
    const dir = join(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    // Wave 6.5-UU TODO (deferred): consider the additional integrity
    // PRAGMAs once the rollout is gated:
    //   PRAGMA synchronous = FULL;        — flush every commit (slower)
    //   PRAGMA secure_delete = ON;        — overwrite freed pages
    //   PRAGMA cell_size_check = ON;      — corruption canary
    // These are NOT enabled here so Wave 4-V stays scoped to the
    // hash-chain change; the verify-chain method below catches tampering
    // even without them.
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
   *
   * Wave 4-V: each entry's `contentHash` is computed as
   *   sha256(entry_data + previousHash)
   * where `previousHash` is the contentHash of the immediately
   * preceding row (in insertion order). The first entry chains off
   * {@link GENESIS_PREV_HASH}. Tampering with row N invalidates row
   * N+1's hash, so {@link verifyChain} can detect any single-row
   * mutation without re-hashing the entire history independently.
   */
  record(entry: Omit<AuditEntry, "contentHash">): void {
    const prev = this.getPreviousHash();
    const contentHash = this.computeHash(entry, prev);

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

    // Cache for the next chain link. The DB write succeeded (better-sqlite3
    // throws on failure), so this is the new tail.
    this.previousHash = contentHash;
  }

  /**
   * Wave 4-V — return the contentHash of the most recent entry, or
   * {@link GENESIS_PREV_HASH} if the table is empty. Cached on the
   * instance so subsequent record() calls don't re-query.
   *
   * QB#7: per-instance state. Multiple AuditTrail instances backed by
   * different dbPaths each maintain their own independent chain.
   */
  private getPreviousHash(): string {
    if (this.previousHash !== null) return this.previousHash;

    // Lazy hydrate from disk so a process restart picks up where the
    // last run left off. Order by rowid (insertion order) DESC — we
    // can't sort by `timestamp` because two entries inserted in the
    // same millisecond would reorder.
    const row = this.db
      .prepare("SELECT content_hash FROM audit_trail ORDER BY rowid DESC LIMIT 1")
      .get() as { content_hash: string } | undefined;

    this.previousHash = row?.content_hash ?? GENESIS_PREV_HASH;
    return this.previousHash;
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
    // Wave 4-V: single-entry verification needs the previous row's
    // contentHash to recompute the chain-linked hash. We look up the
    // immediately-preceding row by rowid (insertion order) — if the
    // target is the first row in the table, the chain links to GENESIS.
    const row = this.db
      .prepare("SELECT *, rowid as _rowid FROM audit_trail WHERE id = ?")
      .get(entryId) as (Record<string, unknown> & { _rowid: number }) | undefined;
    if (!row) return false;
    const entry = this.rowToEntry(row);

    const prevRow = this.db
      .prepare("SELECT content_hash FROM audit_trail WHERE rowid < ? ORDER BY rowid DESC LIMIT 1")
      .get(row._rowid) as { content_hash: string } | undefined;
    const prev = prevRow?.content_hash ?? GENESIS_PREV_HASH;

    const expectedHash = this.computeHash(entry, prev);
    return entry.contentHash === expectedHash;
  }

  /**
   * Wave 4-V — walk the entire entries table in insertion order
   * (rowid ASC) and verify the hash chain. Each entry's contentHash
   * must equal `sha256(entry_data + previousHash)` where previousHash
   * is the prior row's contentHash (or GENESIS for the first row).
   *
   * Returns `{ valid: true }` when the chain is intact, or
   * `{ valid: false, brokenAt: rowid }` pointing to the first row
   * whose stored hash diverges from the recomputed value. Callers
   * (e.g. `wotann audit verify`) can use `brokenAt` to locate
   * tampering.
   *
   * O(N) over the table; safe for retention-pruned audit logs (S1-14
   * default 30-day window keeps the table bounded).
   */
  verifyChain(): { valid: boolean; brokenAt?: number } {
    const rows = this.db
      .prepare("SELECT *, rowid as _rowid FROM audit_trail ORDER BY rowid ASC")
      .all() as Array<Record<string, unknown> & { _rowid: number }>;

    let prev = GENESIS_PREV_HASH;
    for (const row of rows) {
      const entry = this.rowToEntry(row);
      const expected = this.computeHash(entry, prev);
      if (entry.contentHash !== expected) {
        return { valid: false, brokenAt: row._rowid };
      }
      prev = entry.contentHash;
    }
    return { valid: true };
  }

  private computeHash(entry: Omit<AuditEntry, "contentHash">, previousHash: string): string {
    // Wave 4-V chain-link: append the previous entry's hash to the
    // serialized payload before hashing. This makes tampering with any
    // single row detectable via `verifyChain` even if the attacker
    // recomputes the local hash, because every downstream row would
    // also need to be rewritten.
    const data = `${entry.id}:${entry.sessionId}:${entry.timestamp}:${entry.tool}:${entry.success}|${previousHash}`;
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
