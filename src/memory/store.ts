/**
 * SQLite memory store with FTS5 full-text search.
 * 8-layer unified memory system per §14 and MEMORY_ARCHITECTURE.md.
 *
 * LAYERS:
 * 1. Auto-Capture — every tool call, file read, command output
 * 2. Core Blocks — user/feedback/project/reference/cases/patterns/decisions/issues
 * 3. Working Memory — current session state, recent context
 * 4. Knowledge Graph — entity relationships, bi-temporal facts
 * 5. Archival — long-term storage with temporal decay
 * 6. Recall — retrieval with skeptical verification
 * 7. Team Memory — shared across agents/sessions
 * 8. Proactive Context — anticipated context based on patterns
 *
 * FEATURES:
 * - FTS5 full-text search across all layers
 * - Skeptical memory: verify before acting on recalled memories
 * - Consolidation lock: prevent concurrent autoDream sessions
 * - Decision log: track architectural/design decisions with rationale
 * - Temporal decay: older memories get lower relevance scores
 * - Privacy tags: mark sensitive memories for restricted access
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { writeFileAtomicSyncBestEffort } from "../utils/atomic-io.js";
import { deriveIngestTimestamps } from "./dual-timestamp.js";
import type { MemoryRelationship, MemoryRelationshipKind } from "./relationship-types.js";
import { clampContextTokens, cleanContext } from "./contextual-embeddings.js";
import {
  fromStoreFields as palaceFromStoreFields,
  toStoreFields as palaceToStoreFields,
  isUnder as palaceIsUnder,
  type MemPalacePath,
  type MemPalaceQuery,
} from "./mem-palace.js";

export type MemoryLayer =
  | "auto_capture"
  | "core_blocks"
  | "working"
  | "knowledge_graph"
  | "archival"
  | "recall"
  | "team"
  | "proactive";

export type MemoryBlockType =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "cases"
  | "patterns"
  | "decisions"
  | "issues";

export type MemorySourceType =
  | "user_input"
  | "tool_output"
  | "agent_decision"
  | "codebase_observation"
  | "auto_capture"
  | "team_sync"
  | "dream_cycle";

export interface MemoryProvenance {
  readonly sourceType: MemorySourceType;
  readonly sourceFile?: string;
  readonly sourceCommand?: string;
  readonly sessionId?: string;
  readonly verified: boolean;
  readonly verifiedAt?: string;
  readonly verifiedBy?: string;
}

export type VerificationStatus = "verified" | "stale" | "unverified" | "conflicting";

export interface VerificationResult {
  readonly entryId: string;
  readonly previousStatus: VerificationStatus;
  readonly newStatus: VerificationStatus;
  readonly freshnessScore: number;
  readonly confidenceLevel: number;
  readonly reason: string;
}

export interface MemoryEntry {
  readonly id: string;
  readonly layer: MemoryLayer;
  readonly blockType: MemoryBlockType;
  readonly key: string;
  readonly value: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sessionId?: string;
  readonly verified: boolean;
  readonly confidence?: number;
  readonly tags?: string;
  readonly sourceType?: MemorySourceType;
  readonly sourceFile?: string;
  readonly freshnessScore: number;
  readonly confidenceLevel: number;
  readonly lastVerifiedAt?: string;
  readonly verificationStatus: VerificationStatus;
  /** MemPalace-style domain partition (wing). E.g., "memory", "auth", "deploy" */
  readonly domain?: string;
  /** MemPalace-style topic partition (room). E.g., "architecture", "bug-fix", "config" */
  readonly topic?: string;
  /**
   * Dual-timestamp (Phase H) — when this memory was RECORDED (unix ms).
   * Always present after ingest; populated by deriveIngestTimestamps.
   */
  readonly documentDate?: number;
  /**
   * Dual-timestamp (Phase H) — when the event the memory refers to
   * HAPPENED (unix ms). May equal documentDate when no hint was parsed;
   * check eventDateSource to distinguish extracted from fallback.
   */
  readonly eventDate?: number;
  /** Uncertainty in eventDate as ±ms. */
  readonly eventDateUncertaintyMs?: number;
  /**
   * How eventDate was derived. Honest values:
   *   - "extracted: \"yesterday\""        (from content)
   *   - "fallback-to-documentDate"        (no hint parsed)
   *   - "user-supplied"                   (caller overrode)
   *   - ""                                (legacy row, pre-Phase-H)
   */
  readonly eventDateSource?: string;
}

export interface MemorySearchResult {
  readonly entry: MemoryEntry;
  readonly score: number;
  readonly snippet: string;
  readonly matchType?: "fts" | "vector" | "hybrid";
}

export interface VectorSearchResult {
  readonly entryId: string;
  readonly similarity: number;
  readonly entry: MemoryEntry;
}

export interface ContradictionResult {
  readonly existingEntry: MemoryEntry;
  readonly newValue: string;
  readonly conflictType: "direct" | "indirect" | "temporal";
  readonly confidence: number;
}

export interface KnowledgeNode {
  readonly id: string;
  readonly entity: string;
  readonly entityType: string;
  readonly properties: Record<string, string>;
  readonly validFrom: string;
  readonly validTo?: string;
}

export interface TeamMemoryRecord {
  readonly id: string;
  readonly agentId: string;
  readonly key: string;
  readonly value: string;
  readonly shared: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TeamMemorySnapshot {
  readonly exportedAt: string;
  readonly entries: readonly TeamMemoryRecord[];
}

export interface TeamMemorySyncResult {
  readonly inserted: number;
  readonly updated: number;
  readonly skipped: number;
  readonly conflicts: readonly string[];
}

export interface AutoCaptureEntry {
  readonly id: number;
  readonly eventType: string;
  readonly toolName?: string;
  readonly content: string;
  readonly sessionId?: string;
  readonly createdAt: string;
}

/**
 * Result of a call to `MemoryStore.consolidateAutoCaptures`. Surfaces the
 * work done in the last pass so callers (daemon heartbeat, close(), tests)
 * can log/assert without re-querying the DB.
 */
export interface ConsolidationReport {
  /** Auto-capture rows read in this pass. */
  readonly read: number;
  /** Rows that produced at least one observation and were routed to memory_entries. */
  readonly routed: number;
  /** Count by memory_entries block type. Keys: decisions/feedback/project/issues/cases. */
  readonly byBlock: Readonly<Record<string, number>>;
  /** Rows that matched no pattern and produced no observation. */
  readonly classificationFailed: number;
  /** Rows mirrored into the decision_log table. Sub-count of `byBlock.decisions`. */
  readonly decisionLogged: number;
}

export class MemoryStore {
  private readonly db: Database.Database;
  private readonly dbPath: string;
  /**
   * Optional synchronous contextual-retrieval generator. When set, insert()
   * prepends a ~50-token chunk-context to the FTS-indexed value per
   * Anthropic's 2024 contextual retrieval (+30-50% recall on paraphrase).
   * Pure sync — LLM-backed generators should pre-render async context and
   * capture it in the closure. Null = disabled (honest pass-through).
   */
  private contextGenerator: ((key: string, value: string) => string) | null = null;

  /** Install or clear the contextual-embedding generator used by insert(). */
  setContextGenerator(gen: ((key: string, value: string) => string) | null): void {
    this.contextGenerator = gen;
  }

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const dir = join(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        layer TEXT NOT NULL,
        block_type TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        confidence REAL DEFAULT 1.0,
        tags TEXT DEFAULT '',
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        source_type TEXT DEFAULT 'auto_capture',
        source_file TEXT,
        source_command TEXT,
        verified_at TEXT,
        verified_by TEXT,
        freshness_score REAL NOT NULL DEFAULT 1.0,
        confidence_level REAL NOT NULL DEFAULT 0.5,
        last_verified_at TEXT,
        verification_status TEXT NOT NULL DEFAULT 'unverified',
        domain TEXT NOT NULL DEFAULT '',
        topic TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_memory_layer ON memory_entries(layer);
      CREATE INDEX IF NOT EXISTS idx_memory_block ON memory_entries(block_type);
      CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(key);
      CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries(session_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        key, value,
        content='memory_entries',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, key, value) VALUES('delete', old.rowid, old.key, old.value);
        INSERT INTO memory_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, key, value) VALUES('delete', old.rowid, old.key, old.value);
      END;

      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        properties TEXT DEFAULT '{}',
        valid_from TEXT NOT NULL DEFAULT (datetime('now')),
        valid_to TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS knowledge_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
        target_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_kg_entity ON knowledge_nodes(entity);
      CREATE INDEX IF NOT EXISTS idx_kg_edges_src ON knowledge_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_kg_edges_tgt ON knowledge_edges(target_id);

      CREATE TABLE IF NOT EXISTS team_memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        shared INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_team_agent ON team_memory(agent_id);

      CREATE TABLE IF NOT EXISTS working_memory (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id);

      CREATE TABLE IF NOT EXISTS decision_log (
        id TEXT PRIMARY KEY,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL,
        alternatives TEXT,
        constraints TEXT,
        stakeholders TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT
      );

      CREATE TABLE IF NOT EXISTS auto_capture (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        tool_name TEXT,
        content TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_capture_session ON auto_capture(session_id);

      CREATE TABLE IF NOT EXISTS verbatim_drawers (
        id TEXT PRIMARY KEY,
        entry_id TEXT REFERENCES memory_entries(id) ON DELETE SET NULL,
        raw_content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'conversation',
        session_id TEXT,
        domain TEXT NOT NULL DEFAULT '',
        topic TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_verbatim_entry ON verbatim_drawers(entry_id);
      CREATE INDEX IF NOT EXISTS idx_verbatim_session ON verbatim_drawers(session_id);
      CREATE INDEX IF NOT EXISTS idx_verbatim_domain ON verbatim_drawers(domain, topic);

      CREATE VIRTUAL TABLE IF NOT EXISTS verbatim_fts USING fts5(
        raw_content,
        content='verbatim_drawers',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS verbatim_ai AFTER INSERT ON verbatim_drawers BEGIN
        INSERT INTO verbatim_fts(rowid, raw_content) VALUES (new.rowid, new.raw_content);
      END;
      CREATE TRIGGER IF NOT EXISTS verbatim_au AFTER UPDATE ON verbatim_drawers BEGIN
        INSERT INTO verbatim_fts(verbatim_fts, rowid, raw_content) VALUES('delete', old.rowid, old.raw_content);
        INSERT INTO verbatim_fts(rowid, raw_content) VALUES (new.rowid, new.raw_content);
      END;
      CREATE TRIGGER IF NOT EXISTS verbatim_ad AFTER DELETE ON verbatim_drawers BEGIN
        INSERT INTO verbatim_fts(verbatim_fts, rowid, raw_content) VALUES('delete', old.rowid, old.raw_content);
      END;

      CREATE TABLE IF NOT EXISTS memory_vectors (
        entry_id TEXT PRIMARY KEY REFERENCES memory_entries(id) ON DELETE CASCADE,
        embedding BLOB NOT NULL,
        model TEXT NOT NULL DEFAULT 'local-trigram',
        dimensions INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_model ON memory_vectors(model);

      CREATE TABLE IF NOT EXISTS memory_provenance_log (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        actor TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_provenance_entry ON memory_provenance_log(entry_id);
      CREATE INDEX IF NOT EXISTS idx_memory_source_type ON memory_entries(source_type);
      CREATE INDEX IF NOT EXISTS idx_memory_source_file ON memory_entries(source_file);
    `);

    // ── Domain-Partitioned Search Migration (MemPalace R1) ──
    // Add domain/topic columns for existing databases. +34% retrieval improvement
    // from metadata filtering before FTS5 search (MemPalace: 60.9% → 94.8%).
    this.migrateAddColumn("memory_entries", "domain", "TEXT NOT NULL DEFAULT ''");
    this.migrateAddColumn("memory_entries", "topic", "TEXT NOT NULL DEFAULT ''");
    this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_memory_domain ON memory_entries(domain)`).run();
    this.db.prepare(`CREATE INDEX IF NOT EXISTS idx_memory_topic ON memory_entries(topic)`).run();
    this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_memory_domain_topic ON memory_entries(domain, topic)`,
      )
      .run();

    // ── Auto-Capture Consolidation Tracking (Phase B Bug #1 fix) ──
    // Without this column, every consolidation pass would re-process all
    // auto_capture rows and create duplicate memory_entries. The column
    // records the ISO-timestamp when a row was routed into the structured
    // tables (memory_entries / decision_log / etc.). NULL = not yet
    // consolidated.
    this.migrateAddColumn("auto_capture", "consolidated_at", "TEXT");
    this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_capture_consolidated ON auto_capture(consolidated_at)`,
      )
      .run();

    // ── Temporal Validity Migration (MemPalace R2) ──
    // Add valid_from/valid_to to knowledge_edges for bi-temporal fact queries.
    this.migrateAddColumn(
      "knowledge_edges",
      "valid_from",
      "TEXT NOT NULL DEFAULT (datetime('now'))",
    );
    this.migrateAddColumn("knowledge_edges", "valid_to", "TEXT");
    this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_kg_edges_temporal ON knowledge_edges(valid_from, valid_to)`,
      )
      .run();

    // ── Dual-Timestamp Migration (Phase H Task 1) ──
    // Records both WHEN the memory was written (document_date) and WHEN
    // the referenced event happened (event_date). Enables queries like
    // "what did we say last week about last year's launch?". Legacy rows
    // leave event_date_source='' so readers can distinguish them from
    // honestly-fallback rows.
    this.migrateAddColumn("memory_entries", "document_date", "INTEGER");
    this.migrateAddColumn("memory_entries", "event_date", "INTEGER");
    this.migrateAddColumn("memory_entries", "event_date_uncertainty_ms", "INTEGER");
    this.migrateAddColumn("memory_entries", "event_date_source", "TEXT NOT NULL DEFAULT ''");
    this.db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_memory_event_date ON memory_entries(event_date)`)
      .run();
    this.db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_memory_document_date ON memory_entries(document_date)`,
      )
      .run();

    // ── Typed Relationships Migration (Phase H Task 2) ──
    // Typed edges between memory_entries with a kind in
    // {updates,extends,derives,unknown}. Lets us answer "what is the
    // CURRENT policy?" by walking updates forward from the root.
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS memory_relationships (
          id TEXT PRIMARY KEY,
          from_id TEXT NOT NULL,
          to_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.5,
          rationale TEXT,
          invalidated_at INTEGER,
          created_at INTEGER NOT NULL
        )`,
      )
      .run();
    this.db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_memrel_from ON memory_relationships(from_id)`)
      .run();
    this.db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_memrel_to ON memory_relationships(to_id)`)
      .run();
    this.db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_memrel_kind ON memory_relationships(kind)`)
      .run();
  }

  /** @internal Migration helper — ONLY called with hardcoded literals. */
  private migrateAddColumn(table: string, column: string, definition: string): void {
    // Validate inputs match safe identifier patterns
    const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column)) {
      throw new Error(`Invalid SQL identifier: table="${table}", column="${column}"`);
    }
    // Definition can include type + constraints but must not contain semicolons or comments
    if (/[;]|--/.test(definition)) {
      throw new Error(`Invalid column definition: "${definition}"`);
    }

    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  }

  // ── Layer 1: Auto-Capture ──────────────────────────────────

  captureEvent(eventType: string, content: string, toolName?: string, sessionId?: string): void {
    this.db
      .prepare(
        `
      INSERT INTO auto_capture (event_type, tool_name, content, session_id) VALUES (?, ?, ?, ?)
    `,
      )
      .run(eventType, toolName ?? null, content.slice(0, 2000), sessionId ?? null);
  }

  getRecentCaptures(sessionId: string, limit: number = 20): readonly Record<string, unknown>[] {
    return this.db
      .prepare(
        `
      SELECT * FROM auto_capture WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    `,
      )
      .all(sessionId, limit) as Record<string, unknown>[];
  }

  getAutoCaptureEntries(limit: number = 50, sessionId?: string): readonly AutoCaptureEntry[] {
    const rows = sessionId
      ? this.db
          .prepare(
            `
        SELECT * FROM auto_capture WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
      `,
          )
          .all(sessionId, limit)
      : this.db
          .prepare(
            `
        SELECT * FROM auto_capture ORDER BY created_at DESC LIMIT ?
      `,
          )
          .all(limit);

    return (rows as Record<string, unknown>[]).map((row) => ({
      id: Number(row["id"] ?? 0),
      eventType: row["event_type"] as string,
      toolName: row["tool_name"] as string | undefined,
      content: row["content"] as string,
      sessionId: row["session_id"] as string | undefined,
      createdAt: row["created_at"] as string,
    }));
  }

  /**
   * Return auto_capture entries that have NOT yet been routed into the
   * structured memory_entries / decision_log tables. Phase B Bug #1 fix.
   *
   * Consolidation uses `consolidated_at IS NULL` as the work-queue marker.
   * Once a row has been processed by `consolidateAutoCaptures()`, its
   * `consolidated_at` is stamped with the current ISO-8601 timestamp so
   * it won't be re-read on the next pass.
   */
  getUnconsolidatedAutoCaptures(limit: number = 500): readonly AutoCaptureEntry[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM auto_capture
      WHERE consolidated_at IS NULL
      ORDER BY created_at ASC
      LIMIT ?
    `,
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: Number(row["id"] ?? 0),
      eventType: row["event_type"] as string,
      toolName: row["tool_name"] as string | undefined,
      content: row["content"] as string,
      sessionId: row["session_id"] as string | undefined,
      createdAt: row["created_at"] as string,
    }));
  }

  /**
   * Mark a set of auto_capture rows as consolidated. Called by
   * `consolidateAutoCaptures()` once their observations have been inserted
   * into `memory_entries` / `decision_log`. Idempotent.
   */
  markAutoCapturesConsolidated(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    const stmt = this.db.prepare(
      `UPDATE auto_capture SET consolidated_at = datetime('now')
       WHERE id IN (${placeholders}) AND consolidated_at IS NULL`,
    );
    stmt.run(...ids);
  }

  /**
   * Route unconsolidated auto_capture rows into structured memory tables
   * (memory_entries + decision_log). Phase B Bug #1 fix.
   *
   * Bug: `.wotann/memory.db` showed 1,990 rows in `auto_capture` but 0
   * in `memory_entries`, `knowledge_nodes`, and `decision_log` — every
   * observation was silently dumped into the raw capture table with no
   * structured routing. Session-end extraction ran from
   * `session.messages` (not from the DB), so daemon lifecycle events
   * never produced structured entries.
   *
   * This method reads from the auto_capture table itself, runs each row
   * through the caller-supplied extractor (normally
   * `ObservationExtractor.extractFromCaptures`), maps the observation
   * type to the right MemoryBlockType, and inserts into memory_entries.
   * Decisions are ALSO mirrored into decision_log for the decision
   * ledger.
   *
   * Classification failures (row content matches no pattern) emit a
   * `classification_failed` event via the optional callback — never
   * silently swallowed. Quality bar from feedback_wotann_quality_bars.
   *
   * @returns a report: how many routed per bucket + how many failed classification.
   */
  consolidateAutoCaptures(
    extractFn: (captures: readonly AutoCaptureEntry[]) => readonly {
      readonly type: "decision" | "preference" | "milestone" | "problem" | "discovery";
      readonly assertion: string;
      readonly confidence: number;
      readonly sourceIds: readonly number[];
      readonly domain?: string;
      readonly topic?: string;
    }[],
    options?: {
      readonly batchSize?: number;
      readonly onClassificationFailed?: (entry: AutoCaptureEntry, reason: string) => void;
    },
  ): ConsolidationReport {
    const batchSize = options?.batchSize ?? 500;
    const entries = this.getUnconsolidatedAutoCaptures(batchSize);
    if (entries.length === 0) {
      return {
        read: 0,
        routed: 0,
        byBlock: {},
        classificationFailed: 0,
        decisionLogged: 0,
      };
    }

    let observations: readonly {
      readonly type: "decision" | "preference" | "milestone" | "problem" | "discovery";
      readonly assertion: string;
      readonly confidence: number;
      readonly sourceIds: readonly number[];
      readonly domain?: string;
      readonly topic?: string;
    }[];
    try {
      observations = extractFn(entries);
    } catch (err) {
      // Extractor crash — surface to caller via callback (honest stub, not
      // silent success — feedback_wotann_quality_bars_session2). Mark NONE
      // consolidated so the next pass can retry when the extractor is fixed.
      options?.onClassificationFailed?.(entries[0]!, `extractor_crash:${(err as Error).message}`);
      throw err;
    }

    const covered = new Set<number>();
    const byBlock: Record<string, number> = {};
    let decisionLogged = 0;

    // Phase 1: insert into memory_entries for every extracted observation.
    // Wrapped in a transaction so a later SQL failure rolls back the whole
    // batch — we don't want a half-routed pass where some rows are marked
    // consolidated but their memory_entries never made it.
    const insertTx = this.db.transaction(() => {
      for (const obs of observations) {
        const blockType = this.observationTypeToBlockType(obs.type);
        byBlock[blockType] = (byBlock[blockType] ?? 0) + 1;

        const sessionId = entries.find((e) => obs.sourceIds.includes(e.id))?.sessionId;
        this.insert({
          id: randomUUID(),
          layer: "working",
          blockType,
          key: `${obs.type}:${obs.assertion.slice(0, 80)}`,
          value: obs.assertion,
          sessionId,
          verified: false,
          freshnessScore: 1.0,
          confidenceLevel: obs.confidence,
          verificationStatus: "unverified",
          tags: `consolidated,${obs.type}`,
          domain: obs.domain ?? "",
          topic: obs.topic ?? "",
        });

        // Decisions ALSO flow into the decision_log (bi-temporal ledger).
        if (obs.type === "decision") {
          this.db
            .prepare(
              `INSERT INTO decision_log (id, decision, rationale, alternatives, constraints, stakeholders, session_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              obs.assertion.slice(0, 500),
              `auto-consolidated from ${obs.sourceIds.length} capture(s)`,
              null,
              null,
              null,
              sessionId ?? null,
            );
          decisionLogged++;
        }

        for (const sid of obs.sourceIds) covered.add(sid);
      }
    });
    insertTx();

    // Phase 2: mark all auto_capture rows that fed into an observation as
    // consolidated, AND mark uncovered rows as consolidated-but-unclassified
    // so we don't re-visit them every tick. Emit classification_failed for
    // those so the caller can log/alert.
    const coveredIds = [...covered];
    this.markAutoCapturesConsolidated(coveredIds);

    const unclassified = entries.filter((e) => !covered.has(e.id));
    if (unclassified.length > 0 && options?.onClassificationFailed) {
      for (const entry of unclassified) {
        options.onClassificationFailed(entry, "no_pattern_matched");
      }
    }
    // Mark unclassified as consolidated too — they've had their chance.
    // Without this, the queue grows unbounded and every pass re-examines
    // the same junk. The `onClassificationFailed` callback above gives
    // observability without keeping them in the work queue forever.
    this.markAutoCapturesConsolidated(unclassified.map((e) => e.id));

    return {
      read: entries.length,
      routed: covered.size,
      byBlock,
      classificationFailed: unclassified.length,
      decisionLogged,
    };
  }

  /** Map observation type to the right memory block. Isolated for testability. */
  private observationTypeToBlockType(
    type: "decision" | "preference" | "milestone" | "problem" | "discovery",
  ): MemoryBlockType {
    switch (type) {
      case "decision":
        return "decisions";
      case "preference":
        return "feedback";
      case "milestone":
        return "project";
      case "problem":
        return "issues";
      case "discovery":
        return "cases";
    }
  }

  // ── Verbatim Drawers (MemPalace R6) ────────────────────────
  // Stores raw conversation chunks alongside structured blocks.
  // Search against summaries, return originals — how MemPalace gets 96.6% recall.

  /** Store a raw verbatim chunk, optionally linked to a structured memory entry. */
  storeVerbatim(
    rawContent: string,
    options?: {
      readonly entryId?: string;
      readonly contentType?: string;
      readonly sessionId?: string;
      readonly domain?: string;
      readonly topic?: string;
    },
  ): string {
    const id = randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO verbatim_drawers (id, entry_id, raw_content, content_type, session_id, domain, topic)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        options?.entryId ?? null,
        rawContent,
        options?.contentType ?? "conversation",
        options?.sessionId ?? null,
        options?.domain ?? "",
        options?.topic ?? "",
      );
    return id;
  }

  /** Search verbatim drawers via FTS5. Returns raw content with match scores. */
  searchVerbatim(
    query: string,
    limit: number = 10,
  ): readonly {
    id: string;
    rawContent: string;
    entryId: string | null;
    score: number;
    domain: string;
    topic: string;
  }[] {
    const rows = this.db
      .prepare(
        `
      SELECT vd.*, rank AS score
      FROM verbatim_fts
      JOIN verbatim_drawers vd ON vd.rowid = verbatim_fts.rowid
      WHERE verbatim_fts MATCH ?
      ORDER BY rank LIMIT ?
    `,
      )
      .all(query, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r["id"] as string,
      rawContent: r["raw_content"] as string,
      entryId: (r["entry_id"] as string | null) ?? null,
      score: (r["score"] as number) ?? 0,
      domain: (r["domain"] as string) ?? "",
      topic: (r["topic"] as string) ?? "",
    }));
  }

  /** Get the raw verbatim content linked to a structured memory entry. */
  getVerbatimForEntry(
    entryId: string,
  ): readonly { id: string; rawContent: string; contentType: string }[] {
    const rows = this.db
      .prepare(
        `
      SELECT id, raw_content, content_type FROM verbatim_drawers WHERE entry_id = ? ORDER BY created_at DESC
    `,
      )
      .all(entryId) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r["id"] as string,
      rawContent: r["raw_content"] as string,
      contentType: r["content_type"] as string,
    }));
  }

  /** Count of verbatim entries. */
  getVerbatimCount(): number {
    return (
      this.db.prepare(`SELECT COUNT(*) as count FROM verbatim_drawers`).get() as { count: number }
    ).count;
  }

  // ── Layer 2: Core Blocks CRUD ──────────────────────────────

  insert(entry: Omit<MemoryEntry, "createdAt" | "updatedAt">): void {
    // Phase H Task 1: derive dual-timestamp fields from raw content so
    // temporal queries ("what did we say last week about last year's
    // launch?") can distinguish writing date from event date. Caller
    // may override by passing explicit documentDate / eventDate.
    const derived = deriveIngestTimestamps(`${entry.key} ${entry.value}`);
    const documentDate = entry.documentDate ?? derived.documentDate;
    const eventDate = entry.eventDate ?? derived.eventDate;
    const eventDateUncertaintyMs = entry.eventDateUncertaintyMs ?? derived.eventDateUncertaintyMs;
    const eventDateSource =
      entry.eventDate !== undefined && entry.eventDateSource === undefined
        ? "user-supplied"
        : (entry.eventDateSource ?? derived.eventDateSource);

    // Phase H Wave-3C: contextual-retrieval enrichment. When a generator
    // is installed, prepend a ~50-token chunk-context to the indexed
    // value per Anthropic contextual retrieval. Generator failure falls
    // through to raw value — honest pass-through, never silent garbage.
    let indexedValue = entry.value;
    if (this.contextGenerator) {
      try {
        const raw = this.contextGenerator(entry.key, entry.value);
        const context = clampContextTokens(cleanContext(raw));
        if (context) indexedValue = `${context}\n\n${entry.value}`;
      } catch {
        /* honest fallback: keep raw value */
      }
    }

    this.db
      .prepare(
        `
      INSERT INTO memory_entries (id, layer, block_type, key, value, session_id, verified, confidence, tags, domain, topic, document_date, event_date, event_date_uncertainty_ms, event_date_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        entry.id,
        entry.layer,
        entry.blockType,
        entry.key,
        indexedValue,
        entry.sessionId ?? null,
        entry.verified ? 1 : 0,
        entry.confidence ?? 1.0,
        entry.tags ?? "",
        entry.domain ?? "",
        entry.topic ?? "",
        documentDate,
        eventDate,
        eventDateUncertaintyMs,
        eventDateSource,
      );
  }

  replace(id: string, key: string, value: string): void {
    this.db
      .prepare(
        `
      UPDATE memory_entries SET key = ?, value = ?, updated_at = datetime('now') WHERE id = ?
    `,
      )
      .run(key, value, id);
  }

  archive(id: string): void {
    this.db
      .prepare(
        `
      UPDATE memory_entries SET archived = 1, updated_at = datetime('now') WHERE id = ?
    `,
      )
      .run(id);
  }

  getById(id: string): MemoryEntry | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM memory_entries WHERE id = ? AND archived = 0
    `,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (row) {
      this.db
        .prepare(
          `
        UPDATE memory_entries SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?
      `,
        )
        .run(id);
    }
    return row ? this.rowToEntry(row) : null;
  }

  getByLayer(layer: MemoryLayer): readonly MemoryEntry[] {
    return (
      this.db
        .prepare(
          `
      SELECT * FROM memory_entries WHERE layer = ? AND archived = 0 ORDER BY updated_at DESC
    `,
        )
        .all(layer) as Record<string, unknown>[]
    ).map((r) => this.rowToEntry(r));
  }

  getByBlock(blockType: MemoryBlockType): readonly MemoryEntry[] {
    return (
      this.db
        .prepare(
          `
      SELECT * FROM memory_entries WHERE block_type = ? AND archived = 0 ORDER BY updated_at DESC
    `,
        )
        .all(blockType) as Record<string, unknown>[]
    ).map((r) => this.rowToEntry(r));
  }

  // ── Layer 3: Working Memory ────────────────────────────────

  setWorkingMemory(sessionId: string, key: string, value: string, importance: number = 0.5): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO working_memory (id, session_id, key, value, importance) VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(randomUUID(), sessionId, key, value, importance);
  }

  getWorkingMemory(
    sessionId: string,
  ): readonly { key: string; value: string; importance: number }[] {
    return this.db
      .prepare(
        `
      SELECT key, value, importance FROM working_memory
      WHERE session_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY importance DESC
    `,
      )
      .all(sessionId) as { key: string; value: string; importance: number }[];
  }

  clearWorkingMemory(sessionId: string): void {
    this.db.prepare(`DELETE FROM working_memory WHERE session_id = ?`).run(sessionId);
  }

  // ── Layer 4: Knowledge Graph ───────────────────────────────

  addKnowledgeNode(
    entity: string,
    entityType: string,
    properties?: Record<string, string>,
  ): string {
    const id = randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO knowledge_nodes (id, entity, entity_type, properties) VALUES (?, ?, ?, ?)
    `,
      )
      .run(id, entity, entityType, JSON.stringify(properties ?? {}));
    return id;
  }

  addKnowledgeEdge(
    sourceId: string,
    targetId: string,
    relation: string,
    weight: number = 1.0,
    validFrom?: string,
  ): string {
    const id = randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO knowledge_edges (id, source_id, target_id, relation, weight, valid_from) VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(id, sourceId, targetId, relation, weight, validFrom ?? new Date().toISOString());
    return id;
  }

  /**
   * Invalidate a knowledge edge by setting its valid_to timestamp.
   * The edge remains for historical queries but is excluded from active queries.
   */
  invalidateKnowledgeEdge(edgeId: string, endedAt?: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE knowledge_edges SET valid_to = ? WHERE id = ? AND valid_to IS NULL
    `,
      )
      .run(endedAt ?? new Date().toISOString(), edgeId);
    return result.changes > 0;
  }

  /**
   * Get knowledge edges that were active at a specific point in time.
   * A relationship is active if valid_from <= date AND (valid_to IS NULL OR valid_to > date).
   */
  getActiveEdgesAt(date: string): readonly {
    id: string;
    sourceId: string;
    targetId: string;
    relation: string;
    weight: number;
    validFrom: string;
    validTo: string | null;
  }[] {
    return (
      this.db
        .prepare(
          `
      SELECT id, source_id, target_id, relation, weight, valid_from, valid_to
      FROM knowledge_edges
      WHERE valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
    `,
        )
        .all(date, date) as Record<string, unknown>[]
    ).map((r) => ({
      id: r["id"] as string,
      sourceId: r["source_id"] as string,
      targetId: r["target_id"] as string,
      relation: r["relation"] as string,
      weight: r["weight"] as number,
      validFrom: r["valid_from"] as string,
      validTo: (r["valid_to"] as string | null) ?? null,
    }));
  }

  getRelatedEntities(entity: string, maxDepth: number = 2): readonly KnowledgeNode[] {
    const startNodes = this.db
      .prepare(
        `
      SELECT * FROM knowledge_nodes WHERE entity = ? AND (valid_to IS NULL OR valid_to > datetime('now'))
    `,
      )
      .all(entity) as Record<string, unknown>[];

    if (startNodes.length === 0) return [];

    const visited = new Set<string>();
    const result: KnowledgeNode[] = [];
    let frontier = startNodes.map((n) => n["id"] as string);

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        const node = this.db.prepare(`SELECT * FROM knowledge_nodes WHERE id = ?`).get(nodeId) as
          | Record<string, unknown>
          | undefined;
        if (node) {
          result.push({
            id: node["id"] as string,
            entity: node["entity"] as string,
            entityType: node["entity_type"] as string,
            properties: JSON.parse((node["properties"] as string) || "{}") as Record<
              string,
              string
            >,
            validFrom: node["valid_from"] as string,
            validTo: node["valid_to"] as string | undefined,
          });
        }
        const edges = this.db
          .prepare(
            `
          SELECT target_id AS connected FROM knowledge_edges WHERE source_id = ? AND (valid_to IS NULL OR valid_to > datetime('now'))
          UNION SELECT source_id AS connected FROM knowledge_edges WHERE target_id = ? AND (valid_to IS NULL OR valid_to > datetime('now'))
        `,
          )
          .all(nodeId, nodeId) as { connected: string }[];
        for (const e of edges) {
          if (!visited.has(e.connected)) nextFrontier.push(e.connected);
        }
      }
      frontier = nextFrontier;
    }
    return result;
  }

  getKnowledgeGraphSize(): { nodes: number; edges: number } {
    const nodes = (
      this.db.prepare(`SELECT COUNT(*) as c FROM knowledge_nodes`).get() as { c: number }
    ).c;
    const edges = (
      this.db.prepare(`SELECT COUNT(*) as c FROM knowledge_edges`).get() as { c: number }
    ).c;
    return { nodes, edges };
  }

  // ── Layer 6: Skeptical Recall ──────────────────────────────

  skepticalSearch(
    query: string,
    limit: number = 10,
  ): readonly (MemorySearchResult & { needsVerification: boolean })[] {
    const results = this.search(query, limit);
    return results.map((r) => {
      let ageDays = 0;
      try {
        const updatedTime = new Date(r.entry.updatedAt).getTime();
        if (!isNaN(updatedTime)) {
          ageDays = (Date.now() - updatedTime) / (1000 * 60 * 60 * 24);
        }
      } catch {
        /* default to 0 days age */
      }
      const temporalDecay = Math.max(0.3, 1.0 - ageDays * 0.01);
      const confidence =
        (r.entry.confidence ?? 1.0) * temporalDecay * (r.entry.verified ? 1.0 : 0.7);
      return { ...r, needsVerification: confidence < 0.6 || !r.entry.verified };
    });
  }

  // ── Layer 7: Team Memory ───────────────────────────────────

  setTeamMemory(agentId: string, key: string, value: string): void {
    this.db
      .prepare(
        `
      INSERT INTO team_memory (id, agent_id, key, value) VALUES (?, ?, ?, ?)
    `,
      )
      .run(randomUUID(), agentId, key, value);
  }

  getTeamMemory(agentId?: string): readonly { agent_id: string; key: string; value: string }[] {
    if (agentId) {
      return this.db
        .prepare(
          `
        SELECT agent_id, key, value FROM team_memory WHERE agent_id = ? AND shared = 1 ORDER BY updated_at DESC
      `,
        )
        .all(agentId) as { agent_id: string; key: string; value: string }[];
    }
    return this.db
      .prepare(
        `
      SELECT agent_id, key, value FROM team_memory WHERE shared = 1 ORDER BY updated_at DESC LIMIT 100
    `,
      )
      .all() as { agent_id: string; key: string; value: string }[];
  }

  getTeamMemoryRecords(agentId?: string): readonly TeamMemoryRecord[] {
    const rows = agentId
      ? this.db
          .prepare(
            `
        SELECT id, agent_id, key, value, shared, created_at, updated_at
        FROM team_memory
        WHERE agent_id = ?
        ORDER BY updated_at DESC
      `,
          )
          .all(agentId)
      : this.db
          .prepare(
            `
        SELECT id, agent_id, key, value, shared, created_at, updated_at
        FROM team_memory
        ORDER BY updated_at DESC
      `,
          )
          .all();

    return (rows as Record<string, unknown>[]).map((row) => ({
      id: row["id"] as string,
      agentId: row["agent_id"] as string,
      key: row["key"] as string,
      value: row["value"] as string,
      shared: Boolean(row["shared"]),
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
    }));
  }

  exportTeamMemorySnapshot(agentId?: string): TeamMemorySnapshot {
    return {
      exportedAt: new Date().toISOString(),
      entries: this.getTeamMemoryRecords(agentId),
    };
  }

  importTeamMemorySnapshot(snapshot: TeamMemorySnapshot): TeamMemorySyncResult {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const conflicts: string[] = [];

    for (const entry of snapshot.entries) {
      const existing = this.db
        .prepare(
          `
        SELECT id, value, updated_at
        FROM team_memory
        WHERE agent_id = ? AND key = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
        )
        .get(entry.agentId, entry.key) as
        | {
            id: string;
            value: string;
            updated_at: string;
          }
        | undefined;

      if (!existing) {
        this.db
          .prepare(
            `
          INSERT INTO team_memory (id, agent_id, key, value, shared, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            entry.id,
            entry.agentId,
            entry.key,
            entry.value,
            entry.shared ? 1 : 0,
            entry.createdAt,
            entry.updatedAt,
          );
        inserted++;
        continue;
      }

      const incomingTs = Date.parse(entry.updatedAt);
      const existingTs = Date.parse(existing.updated_at);
      const incomingIsNewer =
        !Number.isNaN(incomingTs) && !Number.isNaN(existingTs)
          ? incomingTs > existingTs
          : entry.updatedAt > existing.updated_at;

      if (existing.value !== entry.value) {
        conflicts.push(`${entry.agentId}:${entry.key}`);
      }

      if (incomingIsNewer) {
        this.db
          .prepare(
            `
          UPDATE team_memory
          SET value = ?, shared = ?, updated_at = ?, created_at = ?
          WHERE id = ?
        `,
          )
          .run(entry.value, entry.shared ? 1 : 0, entry.updatedAt, entry.createdAt, existing.id);
        updated++;
      } else {
        skipped++;
      }
    }

    return {
      inserted,
      updated,
      skipped,
      conflicts: [...new Set(conflicts)],
    };
  }

  syncTeamMemoryFile(
    snapshotPath: string,
    agentId?: string,
  ): TeamMemorySyncResult & { exported: number } {
    let syncResult: TeamMemorySyncResult = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      conflicts: [],
    };

    if (existsSync(snapshotPath)) {
      try {
        const parsed = JSON.parse(readFileSync(snapshotPath, "utf-8")) as TeamMemorySnapshot;
        if (Array.isArray(parsed.entries)) {
          syncResult = this.importTeamMemorySnapshot(parsed);
        }
      } catch {
        syncResult = {
          inserted: 0,
          updated: 0,
          skipped: 0,
          conflicts: ["snapshot:parse-error"],
        };
      }
    }

    const exportedSnapshot = this.exportTeamMemorySnapshot(agentId);
    // SECURITY (B6): atomic write + lock so concurrent daemon processes don't
    // write a half-serialized JSON blob to the snapshot file.
    writeFileAtomicSyncBestEffort(snapshotPath, JSON.stringify(exportedSnapshot, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });

    return {
      ...syncResult,
      exported: exportedSnapshot.entries.length,
    };
  }

  // ── Layer 8: Proactive Context ─────────────────────────────

  getProactiveContext(sessionId: string, currentFile?: string): readonly MemoryEntry[] {
    const suggestions: MemoryEntry[] = [];
    const recent = this.db
      .prepare(
        `
      SELECT * FROM memory_entries WHERE session_id = ? AND archived = 0 ORDER BY last_accessed DESC LIMIT 5
    `,
      )
      .all(sessionId) as Record<string, unknown>[];
    for (const r of recent) suggestions.push(this.rowToEntry(r));

    if (currentFile) {
      const fileRelated = this.search(currentFile.split("/").pop() ?? "", 3);
      for (const r of fileRelated) {
        if (!suggestions.some((s) => s.id === r.entry.id)) suggestions.push(r.entry);
      }
    }
    return suggestions.slice(0, 10);
  }

  // ── FTS5 Search ────────────────────────────────────────────

  search(
    query: string,
    limit: number = 10,
    options?: { readonly domainFilter?: readonly string[] },
  ): readonly MemorySearchResult[] {
    const domainFilter = options?.domainFilter ?? [];
    const hasDomainFilter = domainFilter.length > 0;

    const conditions = ["memory_fts MATCH ?", "me.archived = 0"];
    const params: (string | number)[] = [query];

    if (hasDomainFilter) {
      const placeholders = domainFilter.map(() => "?").join(", ");
      conditions.push(`me.domain IN (${placeholders})`);
      for (const d of domainFilter) params.push(d);
    }
    params.push(limit);

    const sql = `
      SELECT me.*, rank AS score, snippet(memory_fts, 1, '<b>', '</b>', '...', 32) AS snippet
      FROM memory_fts
      JOIN memory_entries me ON me.rowid = memory_fts.rowid
      WHERE ${conditions.join(" AND ")}
      ORDER BY rank LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      entry: this.rowToEntry(r),
      score: (r["score"] as number) ?? 0,
      snippet: (r["snippet"] as string) ?? "",
    }));
  }

  /**
   * Domain-partitioned search (MemPalace R1).
   * Filters by domain/topic BEFORE running FTS5, reducing noise by up to 34%.
   * - domain only: +12% retrieval (MemPalace: 60.9% → 73.1%)
   * - domain + topic: +34% retrieval (MemPalace: 60.9% → 94.8%)
   */
  searchPartitioned(
    query: string,
    options: { readonly domain?: string; readonly topic?: string; readonly limit?: number } = {},
  ): readonly MemorySearchResult[] {
    const { domain, topic, limit = 10 } = options;

    // No partition filters → fall back to standard search
    if (!domain && !topic) return this.search(query, limit);

    // Build dynamic WHERE clause for domain/topic filtering
    const conditions = ["memory_fts MATCH ?", "me.archived = 0"];
    const params: (string | number)[] = [query];

    if (domain) {
      conditions.push("me.domain = ?");
      params.push(domain);
    }
    if (topic) {
      conditions.push("me.topic = ?");
      params.push(topic);
    }
    params.push(limit);

    const sql = `
      SELECT me.*, rank AS score, snippet(memory_fts, 1, '<b>', '</b>', '...', 32) AS snippet
      FROM memory_fts
      JOIN memory_entries me ON me.rowid = memory_fts.rowid
      WHERE ${conditions.join(" AND ")}
      ORDER BY rank LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      entry: this.rowToEntry(r),
      score: (r["score"] as number) ?? 0,
      snippet: (r["snippet"] as string) ?? "",
    }));
  }

  /**
   * Phase 13 Wave-3C — MemPalace-aware search. Gated by MEMORY_PALACE=1
   * env. When enabled, accepts a MemPalacePath/Query and routes through
   * searchPartitioned with domain/topic derived from the palace path
   * (hall → domain, wing[/room] → topic). The palace-style hierarchy
   * then post-filters results so wing=X/room=Y queries only return
   * entries recorded under X/Y, not X alone. When MEMORY_PALACE is
   * unset, falls back to standard search (no regression).
   */
  searchPalace(
    query: string,
    palace: MemPalaceQuery = {},
    limit: number = 10,
  ): readonly MemorySearchResult[] {
    if (process.env["MEMORY_PALACE"] !== "1") {
      return this.search(query, limit);
    }
    const path: MemPalacePath = { hall: palace.hall ?? "" };
    const { domain, topic } = palace.hall
      ? palaceToStoreFields({
          hall: palace.hall,
          ...(palace.wing ? { wing: palace.wing } : {}),
          ...(palace.room ? { room: palace.room } : {}),
        })
      : { domain: "", topic: undefined };
    const hits = this.searchPartitioned(query, {
      limit: limit * 2,
      ...(domain ? { domain } : {}),
      ...(topic ? { topic } : {}),
    });
    if (!palace.hall) return hits.slice(0, limit);
    // Post-filter: require the row's palace-path to fall under the query.
    const filtered = hits.filter((h) => {
      const rowPath = palaceFromStoreFields({
        domain: h.entry.domain ?? "",
        topic: h.entry.topic,
      });
      return palaceIsUnder(rowPath, path);
    });
    return filtered.slice(0, limit);
  }

  /** Get all unique domains in the memory store. */
  getDomains(): readonly string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT domain FROM memory_entries WHERE archived = 0 AND domain != '' ORDER BY domain`,
      )
      .all() as { domain: string }[];
    return rows.map((r) => r.domain);
  }

  /** Get all unique topics within a domain (or all topics if no domain specified). */
  getTopics(domain?: string): readonly string[] {
    const rows = domain
      ? (this.db
          .prepare(
            `SELECT DISTINCT topic FROM memory_entries WHERE archived = 0 AND domain = ? AND topic != '' ORDER BY topic`,
          )
          .all(domain) as { topic: string }[])
      : (this.db
          .prepare(
            `SELECT DISTINCT topic FROM memory_entries WHERE archived = 0 AND topic != '' ORDER BY topic`,
          )
          .all() as { topic: string }[]);
    return rows.map((r) => r.topic);
  }

  // ── Consolidation Lock ─────────────────────────────────────

  acquireConsolidationLock(lockId: string): boolean {
    const lockPath = join(this.dbPath, "..", "consolidation.lock");
    if (existsSync(lockPath)) {
      try {
        const lockData = JSON.parse(readFileSync(lockPath, "utf-8")) as { timestamp: number };
        if (Date.now() - lockData.timestamp > 30 * 60 * 1000) {
          unlinkSync(lockPath);
        } else {
          return false;
        }
      } catch {
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    }
    try {
      writeFileSync(lockPath, JSON.stringify({ lockId, timestamp: Date.now() }), { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }

  releaseConsolidationLock(): void {
    const lockPath = join(this.dbPath, "..", "consolidation.lock");
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }

  // ── Decision Log ───────────────────────────────────────────

  logDecision(decision: {
    id: string;
    decision: string;
    rationale: string;
    alternatives?: string;
    constraints?: string;
    stakeholders?: string;
    sessionId?: string;
  }): void {
    this.db
      .prepare(
        `
      INSERT INTO decision_log (id, decision, rationale, alternatives, constraints, stakeholders, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        decision.id,
        decision.decision,
        decision.rationale,
        decision.alternatives ?? null,
        decision.constraints ?? null,
        decision.stakeholders ?? null,
        decision.sessionId ?? null,
      );
  }

  getDecisions(limit: number = 20): readonly Record<string, unknown>[] {
    return this.db
      .prepare(`SELECT * FROM decision_log ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
  }

  // ── Memory Tools (6 agent-callable tools per spec) ─────────

  memoryReplace(
    block: MemoryBlockType,
    key: string,
    value: string,
    domain?: string,
    topic?: string,
  ): void {
    const existing = this.db
      .prepare(
        `
      SELECT id FROM memory_entries WHERE block_type = ? AND key = ? AND archived = 0
    `,
      )
      .get(block, key) as { id: string } | undefined;
    if (existing) {
      this.replace(existing.id, key, value);
    } else {
      this.insert({
        id: randomUUID(),
        layer: "core_blocks",
        blockType: block,
        key,
        value,
        verified: false,
        freshnessScore: 1.0,
        confidenceLevel: 0.8,
        verificationStatus: "unverified",
        domain: domain ?? "",
        topic: topic ?? "",
      });
    }
  }

  memoryInsert(
    block: MemoryBlockType,
    key: string,
    value: string,
    domain?: string,
    topic?: string,
  ): void {
    this.insert({
      id: randomUUID(),
      layer: "core_blocks",
      blockType: block,
      key,
      value,
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
      domain: domain ?? "",
      topic: topic ?? "",
    });
  }

  memoryRethink(entryId: string, newValue: string): MemoryEntry | null {
    const entry = this.getById(entryId);
    if (!entry) return null;
    this.replace(entryId, entry.key, newValue);
    return { ...entry, value: newValue };
  }

  memorySearch(
    query: string,
    optionsOrLayers?:
      | readonly MemoryLayer[]
      | {
          readonly layers?: readonly MemoryLayer[];
          readonly domain?: string;
          readonly topic?: string;
        },
  ): readonly MemorySearchResult[] {
    // Backward compat: accept both old (layers array) and new (options object) signatures
    if (Array.isArray(optionsOrLayers)) {
      // Old API: memorySearch(query, layers[])
      const results = this.searchPartitioned(query, { limit: 50 });
      return optionsOrLayers.length === 0
        ? results
        : results.filter((r) =>
            (optionsOrLayers as readonly MemoryLayer[]).includes(r.entry.layer),
          );
    }
    // New API: memorySearch(query, { layers?, domain?, topic? })
    const opts = (optionsOrLayers ?? {}) as {
      readonly layers?: readonly MemoryLayer[];
      readonly domain?: string;
      readonly topic?: string;
    };
    const results = this.searchPartitioned(query, {
      domain: opts.domain,
      topic: opts.topic,
      limit: 50,
    });
    if (!opts.layers || opts.layers.length === 0) return results;
    return results.filter((r) => opts.layers!.includes(r.entry.layer));
  }

  memoryArchive(entryId: string): boolean {
    const entry = this.getById(entryId);
    if (!entry) return false;
    this.archive(entryId);
    return true;
  }

  memoryVerify(entryId: string): MemoryEntry | null {
    const entry = this.getById(entryId);
    if (entry) {
      this.db
        .prepare(
          `UPDATE memory_entries SET verified = 1, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(entryId);
      return { ...entry, verified: true };
    }
    return null;
  }

  // ── Stats ──────────────────────────────────────────────────

  getEntryCount(): number {
    return (
      this.db.prepare(`SELECT COUNT(*) as count FROM memory_entries WHERE archived = 0`).get() as {
        count: number;
      }
    ).count;
  }

  getLayerStats(): Record<string, number> {
    const rows = this.db
      .prepare(
        `
      SELECT layer, COUNT(*) as count FROM memory_entries WHERE archived = 0 GROUP BY layer
    `,
      )
      .all() as { layer: string; count: number }[];
    const stats: Record<string, number> = {};
    for (const r of rows) stats[r.layer] = r.count;
    return stats;
  }

  // ── Helpers ────────────────────────────────────────────────

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row["id"] as string,
      layer: row["layer"] as MemoryLayer,
      blockType: row["block_type"] as MemoryBlockType,
      key: row["key"] as string,
      value: row["value"] as string,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
      sessionId: row["session_id"] as string | undefined,
      verified: Boolean(row["verified"]),
      confidence: row["confidence"] as number | undefined,
      tags: row["tags"] as string | undefined,
      sourceType: row["source_type"] as MemorySourceType | undefined,
      sourceFile: row["source_file"] as string | undefined,
      freshnessScore: (row["freshness_score"] as number | undefined) ?? 1.0,
      confidenceLevel: (row["confidence_level"] as number | undefined) ?? 0.5,
      lastVerifiedAt: row["last_verified_at"] as string | undefined,
      verificationStatus:
        (row["verification_status"] as VerificationStatus | undefined) ?? "unverified",
      domain: (row["domain"] as string | undefined) ?? "",
      topic: (row["topic"] as string | undefined) ?? "",
      documentDate: row["document_date"] as number | undefined,
      eventDate: row["event_date"] as number | undefined,
      eventDateUncertaintyMs: row["event_date_uncertainty_ms"] as number | undefined,
      eventDateSource: (row["event_date_source"] as string | undefined) ?? "",
    };
  }

  // ── Vector Embeddings ──────────────────────────────────────

  /**
   * Store a vector embedding for a memory entry.
   * Uses trigram-based local embeddings by default (zero API calls).
   */
  storeEmbedding(entryId: string, embedding: Float32Array, model: string = "local-trigram"): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO memory_vectors (entry_id, embedding, model, dimensions)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(entryId, Buffer.from(embedding.buffer), model, embedding.length);
  }

  /**
   * Generate a local trigram-based embedding (no API needed).
   * Not as good as nomic-embed-text but works offline.
   */
  generateLocalEmbedding(text: string): Float32Array {
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const words = normalized.split(/\s+/).filter(Boolean);
    // Simple bag-of-trigrams → fixed-size vector via hashing
    const DIMS = 256;
    const vec = new Float32Array(DIMS);

    for (const word of words) {
      for (let i = 0; i <= word.length - 3; i++) {
        const trigram = word.slice(i, i + 3);
        let hash = 0;
        for (let j = 0; j < trigram.length; j++) {
          hash = ((hash << 5) - hash + trigram.charCodeAt(j)) | 0;
        }
        const idx = Math.abs(hash) % DIMS;
        vec[idx] = (vec[idx] ?? 0) + 1;
      }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < DIMS; i++) norm += (vec[i] ?? 0) * (vec[i] ?? 0);
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < DIMS; i++) vec[i] = (vec[i] ?? 0) / norm;
    }

    return vec;
  }

  /**
   * Cosine similarity between two embeddings.
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
      normA += (a[i] ?? 0) * (a[i] ?? 0);
      normB += (b[i] ?? 0) * (b[i] ?? 0);
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  /**
   * Vector similarity search across all memory entries with embeddings.
   * Optional domainFilter narrows the candidate set to entries in the specified
   * domains (MemPalace-style partition). Up to +34% retrieval improvement.
   */
  vectorSearch(
    query: string,
    limit: number = 10,
    options?: { readonly domainFilter?: readonly string[] },
  ): readonly VectorSearchResult[] {
    const queryEmbedding = this.generateLocalEmbedding(query);
    const domainFilter = options?.domainFilter ?? [];
    const hasDomainFilter = domainFilter.length > 0;

    const sqlParts = [
      "SELECT mv.entry_id, mv.embedding, mv.dimensions",
      "FROM memory_vectors mv",
      "JOIN memory_entries me ON me.id = mv.entry_id",
      "WHERE me.archived = 0",
    ];
    const params: string[] = [];
    if (hasDomainFilter) {
      const placeholders = domainFilter.map(() => "?").join(", ");
      sqlParts.push(`AND me.domain IN (${placeholders})`);
      for (const d of domainFilter) params.push(d);
    }

    const rows = this.db.prepare(sqlParts.join(" ")).all(...params) as Array<{
      entry_id: string;
      embedding: Buffer;
      dimensions: number;
    }>;

    const scored = rows.map((row) => {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.dimensions,
      );
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return { entryId: row.entry_id, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored
      .slice(0, limit)
      .map((s) => ({
        entryId: s.entryId,
        similarity: s.similarity,
        entry: this.getById(s.entryId)!,
      }))
      .filter((r) => r.entry !== null);
  }

  // ── Reciprocal Rank Fusion Search ──────────────────────────

  /**
   * Hybrid search combining FTS5 (BM25), vector similarity, temporal recency,
   * and access frequency using Reciprocal Rank Fusion.
   * Optional domainFilter narrows every signal to entries in the specified domains.
   */
  hybridSearch(
    query: string,
    limit: number = 10,
    options?: { readonly domainFilter?: readonly string[] },
  ): readonly MemorySearchResult[] {
    const K = 60; // RRF constant
    const domainFilter = options?.domainFilter ?? [];
    const hasDomainFilter = domainFilter.length > 0;

    // Signal 1: FTS5 BM25
    const ftsResults = this.search(query, limit * 2, { domainFilter });
    const ftsRanks = new Map<string, number>();
    ftsResults.forEach((r, i) => ftsRanks.set(r.entry.id, i + 1));

    // Signal 2: Vector similarity
    const vecResults = this.vectorSearch(query, limit * 2, { domainFilter });
    const vecRanks = new Map<string, number>();
    vecResults.forEach((r, i) => vecRanks.set(r.entryId, i + 1));

    // Signal 3: Temporal recency (all non-archived entries sorted by date)
    let recentSql = "SELECT id FROM memory_entries WHERE archived = 0";
    const recentParams: (string | number)[] = [];
    if (hasDomainFilter) {
      const placeholders = domainFilter.map(() => "?").join(", ");
      recentSql += ` AND domain IN (${placeholders})`;
      for (const d of domainFilter) recentParams.push(d);
    }
    recentSql += " ORDER BY updated_at DESC LIMIT ?";
    recentParams.push(limit * 3);
    const recentRows = this.db.prepare(recentSql).all(...recentParams) as { id: string }[];
    const recencyRanks = new Map<string, number>();
    recentRows.forEach((r, i) => recencyRanks.set(r.id, i + 1));

    // Signal 4: Access frequency
    let freqSql = "SELECT id FROM memory_entries WHERE archived = 0";
    const freqParams: (string | number)[] = [];
    if (hasDomainFilter) {
      const placeholders = domainFilter.map(() => "?").join(", ");
      freqSql += ` AND domain IN (${placeholders})`;
      for (const d of domainFilter) freqParams.push(d);
    }
    freqSql += " ORDER BY access_count DESC LIMIT ?";
    freqParams.push(limit * 3);
    const freqRows = this.db.prepare(freqSql).all(...freqParams) as { id: string }[];
    const freqRanks = new Map<string, number>();
    freqRows.forEach((r, i) => freqRanks.set(r.id, i + 1));

    // Merge all candidate IDs
    const allIds = new Set<string>([
      ...ftsRanks.keys(),
      ...vecRanks.keys(),
      ...recencyRanks.keys(),
      ...freqRanks.keys(),
    ]);

    // Compute RRF score
    const scored: { id: string; score: number }[] = [];
    for (const id of allIds) {
      const ftsRank = ftsRanks.get(id) ?? Infinity;
      const vecRank = vecRanks.get(id) ?? Infinity;
      const recRank = recencyRanks.get(id) ?? Infinity;
      const freqRank = freqRanks.get(id) ?? Infinity;

      const score =
        (ftsRank < Infinity ? 1 / (K + ftsRank) : 0) * 0.4 +
        (vecRank < Infinity ? 1 / (K + vecRank) : 0) * 0.3 +
        (recRank < Infinity ? 1 / (K + recRank) : 0) * 0.2 +
        (freqRank < Infinity ? 1 / (K + freqRank) : 0) * 0.1;

      scored.push({ id, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const results: MemorySearchResult[] = [];
    for (const s of scored.slice(0, limit)) {
      const entry = this.getById(s.id);
      if (!entry) continue;
      results.push({
        entry,
        score: s.score,
        snippet: entry.value.slice(0, 200),
        matchType: "hybrid",
      });
    }
    return results;
  }

  // ── Memory Freshness Scoring ───────────────────────────────

  /**
   * Compute the freshness-adjusted confidence for a memory entry.
   * confidence = base_confidence * decay(age) * verification_boost
   */
  computeFreshness(entry: MemoryEntry): number {
    const base = entry.confidence ?? 1.0;

    // Temporal decay: lose 1% per day, minimum 0.2
    let ageDays = 0;
    try {
      const updatedTime = new Date(entry.updatedAt).getTime();
      if (!isNaN(updatedTime)) {
        ageDays = (Date.now() - updatedTime) / (1000 * 60 * 60 * 24);
      }
    } catch {
      /* default to 0 */
    }
    const decay = Math.max(0.2, 1.0 - ageDays * 0.01);

    // Verified memories decay 3x slower
    const verifiedBoost = entry.verified ? 1.0 : 0.7;

    return base * decay * verifiedBoost;
  }

  // ── Contradiction Detection ────────────────────────────────

  /**
   * Check if a new memory contradicts existing entries.
   * Uses keyword overlap + sentiment analysis to detect conflicts.
   */
  detectContradictions(key: string, value: string): readonly ContradictionResult[] {
    const results: ContradictionResult[] = [];
    const existing = this.search(key, 10);

    for (const r of existing) {
      // Skip same-value entries
      if (r.entry.value === value) continue;

      // Check for direct contradiction keywords
      const existingLower = r.entry.value.toLowerCase();
      const newLower = value.toLowerCase();

      // Pattern: "uses X" vs "uses Y" (for same subject)
      const usesPatternExisting = existingLower.match(/uses?\s+(\w+)/);
      const usesPatternNew = newLower.match(/uses?\s+(\w+)/);
      if (usesPatternExisting && usesPatternNew && usesPatternExisting[1] !== usesPatternNew[1]) {
        results.push({
          existingEntry: r.entry,
          newValue: value,
          conflictType: "direct",
          confidence: 0.8,
        });
        continue;
      }

      // Pattern: negation words that flip meaning
      const negations = ["not", "never", "don't", "doesn't", "shouldn't", "disabled", "removed"];
      for (const neg of negations) {
        const existingHasNeg = existingLower.includes(neg);
        const newHasNeg = newLower.includes(neg);
        if (existingHasNeg !== newHasNeg && this.keywordOverlap(existingLower, newLower) > 0.5) {
          results.push({
            existingEntry: r.entry,
            newValue: value,
            conflictType: "indirect",
            confidence: 0.6,
          });
          break;
        }
      }
    }

    return results;
  }

  private keywordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 3));
    const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }
    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  // ── Provenance Logging ─────────────────────────────────────

  logProvenance(
    entryId: string,
    action: string,
    oldValue: string | null,
    newValue: string | null,
    actor?: string,
    reason?: string,
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO memory_provenance_log (id, entry_id, action, old_value, new_value, actor, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(randomUUID(), entryId, action, oldValue, newValue, actor ?? null, reason ?? null);
  }

  getProvenance(entryId: string): readonly Record<string, unknown>[] {
    return this.db
      .prepare(
        `
      SELECT * FROM memory_provenance_log WHERE entry_id = ? ORDER BY created_at DESC
    `,
      )
      .all(entryId) as Record<string, unknown>[];
  }

  // ── Insert with Provenance ─────────────────────────────────

  insertWithProvenance(
    entry: Omit<MemoryEntry, "createdAt" | "updatedAt">,
    sourceType: MemorySourceType,
    sourceFile?: string,
  ): { contradictions: readonly ContradictionResult[] } {
    // Check for contradictions before inserting
    const contradictions = this.detectContradictions(entry.key, entry.value);

    // Phase H Task 1: dual-timestamp derivation on the provenance path.
    const derived = deriveIngestTimestamps(`${entry.key} ${entry.value}`);
    const documentDate = entry.documentDate ?? derived.documentDate;
    const eventDate = entry.eventDate ?? derived.eventDate;
    const eventDateUncertaintyMs = entry.eventDateUncertaintyMs ?? derived.eventDateUncertaintyMs;
    const eventDateSource =
      entry.eventDate !== undefined && entry.eventDateSource === undefined
        ? "user-supplied"
        : (entry.eventDateSource ?? derived.eventDateSource);

    // Insert the entry with source metadata + dual timestamps
    this.db
      .prepare(
        `
      INSERT INTO memory_entries (id, layer, block_type, key, value, session_id, verified, confidence, tags, source_type, source_file, document_date, event_date, event_date_uncertainty_ms, event_date_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        entry.id,
        entry.layer,
        entry.blockType,
        entry.key,
        entry.value,
        entry.sessionId ?? null,
        entry.verified ? 1 : 0,
        entry.confidence ?? 1.0,
        entry.tags ?? "",
        sourceType,
        sourceFile ?? null,
        documentDate,
        eventDate,
        eventDateUncertaintyMs,
        eventDateSource,
      );

    // Generate and store local embedding
    const embedding = this.generateLocalEmbedding(`${entry.key} ${entry.value}`);
    this.storeEmbedding(entry.id, embedding);

    // Log provenance
    this.logProvenance(entry.id, "insert", null, entry.value, undefined, `source: ${sourceType}`);

    return { contradictions };
  }

  // ── Memory Freshness + Provenance Verification ─────────────

  /**
   * Compute a freshness score for a memory entry using exponential decay.
   * Score decays based on time since last update, with verified entries
   * decaying 3x slower than unverified ones.
   *
   * Returns a value between 0 and 1.
   */
  computeFreshnessScore(entry: MemoryEntry): number {
    const HALF_LIFE_DAYS_UNVERIFIED = 30;
    const HALF_LIFE_DAYS_VERIFIED = 90;

    let ageDays = 0;
    try {
      const updatedTime = new Date(entry.updatedAt).getTime();
      if (!isNaN(updatedTime)) {
        ageDays = Math.max(0, (Date.now() - updatedTime) / (1000 * 60 * 60 * 24));
      }
    } catch {
      /* default to 0 */
    }

    const halfLife = entry.verified ? HALF_LIFE_DAYS_VERIFIED : HALF_LIFE_DAYS_UNVERIFIED;
    // Exponential decay: score = e^(-lambda * t), where lambda = ln(2) / half_life
    const lambda = Math.LN2 / halfLife;
    return Math.max(0, Math.min(1, Math.exp(-lambda * ageDays)));
  }

  /**
   * Verify a memory entry against the codebase by checking whether
   * the source file (if any) still exists and the entry's content
   * is still relevant. Updates verification status and freshness.
   */
  verifyMemoryAgainstCodebase(entryId: string, workspaceDir: string): VerificationResult {
    const entry = this.getById(entryId);
    if (!entry) {
      return {
        entryId,
        previousStatus: "unverified",
        newStatus: "unverified",
        freshnessScore: 0,
        confidenceLevel: 0,
        reason: "Entry not found",
      };
    }

    const previousStatus = entry.verificationStatus;
    const freshness = this.computeFreshnessScore(entry);
    let newStatus: VerificationStatus = "unverified";
    let confidence = entry.confidenceLevel;
    let reason = "";

    // Check if source file still exists
    if (entry.sourceFile) {
      const fullPath = entry.sourceFile.startsWith("/")
        ? entry.sourceFile
        : join(workspaceDir, entry.sourceFile);

      if (existsSync(fullPath)) {
        // File exists -- read it to check if content is still relevant
        try {
          const fileContent = readFileSync(fullPath, "utf-8");
          const keyWords = entry.key
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 3);
          const relevantWords = keyWords.filter((w) => fileContent.toLowerCase().includes(w));
          const relevanceRatio = keyWords.length > 0 ? relevantWords.length / keyWords.length : 0.5;

          if (relevanceRatio > 0.5) {
            newStatus = "verified";
            confidence = Math.min(1.0, 0.7 + relevanceRatio * 0.3);
            reason = `Source file exists, ${Math.round(relevanceRatio * 100)}% keyword match`;
          } else {
            newStatus = "stale";
            confidence = Math.max(0.1, relevanceRatio);
            reason = `Source file exists but content diverged (${Math.round(relevanceRatio * 100)}% match)`;
          }
        } catch {
          newStatus = "stale";
          confidence = 0.3;
          reason = "Source file exists but unreadable";
        }
      } else {
        newStatus = "stale";
        confidence = 0.1;
        reason = "Source file no longer exists";
      }
    } else {
      // No source file -- check contradictions
      const contradictions = this.detectContradictions(entry.key, entry.value);
      if (contradictions.length > 0) {
        newStatus = "conflicting";
        confidence = Math.max(0.1, confidence * 0.5);
        reason = `${contradictions.length} conflicting entries found`;
      } else if (freshness > 0.7) {
        newStatus = "verified";
        confidence = Math.min(1.0, confidence + 0.1);
        reason = "No contradictions, still fresh";
      } else {
        newStatus = "stale";
        confidence = freshness;
        reason = `No source file, freshness decayed to ${(freshness * 100).toFixed(0)}%`;
      }
    }

    // Persist the updated verification state
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
      UPDATE memory_entries
      SET freshness_score = ?,
          confidence_level = ?,
          last_verified_at = ?,
          verification_status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `,
      )
      .run(freshness, confidence, now, newStatus, entryId);

    // Log provenance for the verification
    this.logProvenance(
      entryId,
      "verify_against_codebase",
      previousStatus,
      newStatus,
      "system",
      reason,
    );

    return {
      entryId,
      previousStatus,
      newStatus,
      freshnessScore: freshness,
      confidenceLevel: confidence,
      reason,
    };
  }

  /**
   * Batch-refresh freshness scores for all non-archived entries.
   * Returns the number of entries updated.
   */
  refreshAllFreshnessScores(): number {
    const rows = this.db
      .prepare(
        `
      SELECT id, updated_at, verified, confidence FROM memory_entries WHERE archived = 0
    `,
      )
      .all() as Array<Record<string, unknown>>;

    let updated = 0;
    for (const row of rows) {
      const entry = this.rowToEntry(row);
      const freshness = this.computeFreshnessScore(entry);
      const currentFreshness = (row["freshness_score"] as number | undefined) ?? 1.0;

      // Only update if the score has changed meaningfully
      if (Math.abs(freshness - currentFreshness) > 0.01) {
        this.db
          .prepare(
            `
          UPDATE memory_entries SET freshness_score = ? WHERE id = ?
        `,
          )
          .run(freshness, row["id"] as string);
        updated++;
      }
    }

    return updated;
  }

  /**
   * Get entries that need verification (stale or unverified with low freshness).
   */
  getEntriesNeedingVerification(limit: number = 20): readonly MemoryEntry[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM memory_entries
      WHERE archived = 0
        AND (verification_status IN ('stale', 'unverified', 'conflicting')
             OR freshness_score < 0.5)
      ORDER BY freshness_score ASC
      LIMIT ?
    `,
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((r) => this.rowToEntry(r));
  }

  /**
   * Delete auto_capture entries older than the retention window (S1-14).
   *
   * auto_capture logs every tool call's input/output — identical growth
   * profile to the audit trail. Pair a call to this with
   * AuditTrail.pruneOlderThan() on a daemon cron to keep
   * `~/.wotann/memory.db` bounded.
   *
   * Returns the number of rows removed. Idempotent.
   */
  pruneAutoCaptures(days: number = 30): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const info = this.db.prepare("DELETE FROM auto_capture WHERE created_at < ?").run(cutoff);
    return Number(info.changes);
  }

  // ── Typed Relationships (Phase H Task 2) ───────────────────

  /** Persist one typed relationship. Idempotent on id. */
  addRelationship(rel: MemoryRelationship): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memory_relationships
         (id, from_id, to_id, kind, confidence, rationale, invalidated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rel.id,
        rel.fromId,
        rel.toId,
        rel.kind,
        rel.confidence,
        rel.rationale ?? null,
        null,
        rel.createdAt,
      );
  }

  /** Bulk-persist relationships in a single transaction. */
  addRelationships(rels: readonly MemoryRelationship[]): number {
    if (rels.length === 0) return 0;
    const tx = this.db.transaction((items: readonly MemoryRelationship[]) => {
      for (const rel of items) this.addRelationship(rel);
    });
    tx(rels);
    return rels.length;
  }

  /**
   * Mark a relationship as invalidated. Used by
   * knowledge-update-dynamics when a successor supersedes a
   * predecessor — the predecessor's outbound non-updates edges are
   * stamped so readers can distinguish active from historical edges.
   */
  invalidateRelationship(id: string, atMs: number = Date.now()): boolean {
    const info = this.db
      .prepare(
        `UPDATE memory_relationships SET invalidated_at = ? WHERE id = ? AND invalidated_at IS NULL`,
      )
      .run(atMs, id);
    return Number(info.changes) > 0;
  }

  /** Fetch all relationships touching a given memory_entries id. */
  getRelationshipsForEntry(
    entryId: string,
    options?: { readonly kind?: MemoryRelationshipKind; readonly includeInvalidated?: boolean },
  ): readonly MemoryRelationship[] {
    const includeInvalidated = options?.includeInvalidated ?? false;
    const conditions: string[] = ["(from_id = ? OR to_id = ?)"];
    const params: (string | number)[] = [entryId, entryId];
    if (options?.kind) {
      conditions.push("kind = ?");
      params.push(options.kind);
    }
    if (!includeInvalidated) conditions.push("invalidated_at IS NULL");

    const rows = this.db
      .prepare(
        `SELECT id, from_id, to_id, kind, confidence, rationale, created_at
         FROM memory_relationships
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC`,
      )
      .all(...params) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r["id"] as string,
      fromId: r["from_id"] as string,
      toId: r["to_id"] as string,
      kind: r["kind"] as MemoryRelationshipKind,
      confidence: (r["confidence"] as number) ?? 0.5,
      createdAt: (r["created_at"] as number) ?? 0,
      ...(r["rationale"] ? { rationale: r["rationale"] as string } : {}),
    }));
  }

  /** All relationships — used by resolveLatest walkers + tests. */
  getAllRelationships(options?: {
    readonly includeInvalidated?: boolean;
  }): readonly MemoryRelationship[] {
    const includeInvalidated = options?.includeInvalidated ?? false;
    const sql = includeInvalidated
      ? `SELECT id, from_id, to_id, kind, confidence, rationale, created_at FROM memory_relationships ORDER BY created_at DESC`
      : `SELECT id, from_id, to_id, kind, confidence, rationale, created_at FROM memory_relationships WHERE invalidated_at IS NULL ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r["id"] as string,
      fromId: r["from_id"] as string,
      toId: r["to_id"] as string,
      kind: r["kind"] as MemoryRelationshipKind,
      confidence: (r["confidence"] as number) ?? 0.5,
      createdAt: (r["created_at"] as number) ?? 0,
      ...(r["rationale"] ? { rationale: r["rationale"] as string } : {}),
    }));
  }

  close(): void {
    this.db.close();
  }
}
