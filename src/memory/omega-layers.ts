/**
 * OMEGA 3-layer memory orchestrator — Phase 2 P1-M2.
 *
 * OMEGA (omegamax.co, Apache-2.0, 95.4% LongMemEval) organizes memory
 * in three canonical layers:
 *
 *   Layer 1 — Raw event log (immutable, append-only)
 *   Layer 2 — Extracted facts (structured entries + KG relations)
 *   Layer 3 — Compressed summaries (periodic L1→L3 distillation)
 *
 * This module is a read/write FACADE. It does not duplicate state;
 * rather it composes the 3-layer abstraction over the existing WOTANN
 * tables:
 *
 *   L1 → `auto_capture` (exists; append-only event log)
 *   L2 → `memory_entries` + `knowledge_nodes` + `knowledge_edges` (exist)
 *   L3 → `memory_summaries` (NEW: created by this module)
 *
 * Regression-lock: we do NOT change the existing `memory_entries.layer`
 * enum (8 values) or the `auto_capture` schema. The OMEGA semantics
 * live in the facade, not the tables.
 *
 * Design principles:
 *
 *   1. The facade is STATELESS. `createOmegaLayers` returns plain
 *      objects over a MemoryStore — the store is the ground truth.
 *      Two facades over the same store see the same data (per-session
 *      isolation is handled by the store's session_id column, not the
 *      facade).
 *
 *   2. Compression is INJECTION-DRIVEN. The LLM call is passed in via
 *      `OmegaLlmQuery` (same shape as other WOTANN modules). Tests
 *      mock the LLM; production wires it to the runtime provider.
 *
 *   3. Lineage is preserved. Every L3 summary references the L1 event
 *      ids it was distilled from (`source_event_ids` JSON column).
 *      This means a caller can always ask "what raw events back this
 *      summary?" and follow the chain back to ground truth.
 *
 *   4. Honest failure. If the LLM throws or returns empty, `compress`
 *      returns null (no stub summary, no fake content). Callers
 *      decide whether to retry, skip, or surface the failure.
 */

import type Database from "better-sqlite3";
import type { MemoryEntry, MemoryLayer, MemoryBlockType, MemoryStore } from "./store.js";

// ── Types ──────────────────────────────────────────────

/**
 * Provider-agnostic LLM call shape. Matches cross-encoder.ts,
 * mythos-scaffold.ts, and other WOTANN injection slots so callers can
 * reuse the same binding.
 */
export type OmegaLlmQuery = (
  prompt: string,
  options?: { readonly maxTokens?: number; readonly temperature?: number },
) => Promise<string>;

/**
 * A Layer 1 raw event. Mirrors auto_capture row shape, plus a surfaced
 * integer id for lineage tracking.
 */
export interface Layer1Event {
  readonly id: number;
  readonly eventType: string;
  readonly toolName?: string;
  readonly content: string;
  readonly sessionId?: string;
  readonly createdAt: string;
}

export interface Layer1AppendArgs {
  readonly eventType: string;
  readonly toolName?: string;
  readonly content: string;
  readonly sessionId?: string;
}

export interface Layer1QueryArgs {
  readonly sessionId?: string;
  readonly since?: string; // ISO-8601 createdAt lower bound
  readonly until?: string; // ISO-8601 createdAt upper bound
  readonly limit?: number;
}

/** Layer 1 API: raw, append-only. */
export interface OmegaLayer1 {
  readonly append: (args: Layer1AppendArgs) => number;
  readonly query: (args: Layer1QueryArgs) => readonly Layer1Event[];
  readonly count: () => number;
}

/**
 * Layer 2 fact — projected from MemoryStore with just the identifiers
 * the OMEGA flow cares about. The full MemoryEntry is available via
 * the underlying store if needed.
 */
export interface Layer2Fact {
  readonly id: string;
  readonly layer: MemoryLayer;
  readonly blockType: MemoryBlockType;
  readonly key: string;
  readonly value: string;
  readonly score?: number;
}

/** Layer 2 API: read-through to memory_entries via FTS5. */
export interface OmegaLayer2 {
  readonly search: (query: string, limit?: number) => readonly Layer2Fact[];
  readonly getById: (id: string) => MemoryEntry | null;
}

/** A compressed summary stored in Layer 3. */
export interface CompressionSummary {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
  readonly sessionId?: string;
  readonly sourceEventIds: readonly number[];
  readonly sourceEventCount: number;
}

export interface Layer3CompressArgs {
  readonly sessionId?: string;
  readonly since?: string;
  readonly until?: string;
  readonly llmQuery: OmegaLlmQuery;
  readonly maxEvents?: number;
}

/** Layer 3 API: compress L1 events via LLM → summary row. */
export interface OmegaLayer3 {
  readonly compress: (args: Layer3CompressArgs) => Promise<CompressionSummary | null>;
  readonly list: (limit?: number) => readonly CompressionSummary[];
  readonly getById: (id: string) => CompressionSummary | null;
  readonly count: () => number;
}

export interface OmegaLayers {
  readonly layer1: OmegaLayer1;
  readonly layer2: OmegaLayer2;
  readonly layer3: OmegaLayer3;
}

export interface OmegaLayersConfig {
  readonly store: MemoryStore;
  /** Override the layer-3 summaries table name. Default `memory_summaries`. */
  readonly summariesTable?: string;
}

// ── Facade factory ─────────────────────────────────────

export function createOmegaLayers(config: OmegaLayersConfig): OmegaLayers {
  const summariesTable = config.summariesTable ?? "memory_summaries";
  // Identifier safety
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(summariesTable)) {
    throw new Error(`omega-layers: invalid summariesTable "${summariesTable}" (alnum + _ only)`);
  }

  // Access the store's internal db via bracket key — MemoryStore
  // doesn't expose db() publicly, but we need it for L3 DDL + queries.
  // Using `(store as any)` with a narrow typed cast keeps the surface
  // small.
  interface StoreWithDb {
    readonly db: Database.Database;
  }
  const db = (config.store as unknown as StoreWithDb).db;
  if (!db || typeof db.prepare !== "function") {
    throw new Error("omega-layers: MemoryStore missing expected db handle");
  }

  // Ensure the L3 summaries table exists. Idempotent.
  ensureSummariesTable(db, summariesTable);

  // Prepared statements for L3 — reused across calls.
  const stmts = prepareSummaryStmts(db, summariesTable);

  return {
    layer1: createLayer1(db, config.store),
    layer2: createLayer2(config.store),
    layer3: createLayer3(db, stmts),
  };
}

// ── Layer 1 ────────────────────────────────────────────

function createLayer1(db: Database.Database, store: MemoryStore): OmegaLayer1 {
  const insertStmt = db.prepare(
    `INSERT INTO auto_capture (event_type, tool_name, content, session_id)
     VALUES (?, ?, ?, ?)`,
  );
  const countStmt = db.prepare(`SELECT COUNT(*) AS c FROM auto_capture`);

  return {
    append: (args: Layer1AppendArgs): number => {
      // Reuse store.captureEvent semantics (content is truncated to 2000)
      // to stay consistent with the rest of the codebase. But we insert
      // directly here so we can capture the lastInsertRowid for lineage.
      const info = insertStmt.run(
        args.eventType,
        args.toolName ?? null,
        args.content.slice(0, 2000),
        args.sessionId ?? null,
      );
      return Number(info.lastInsertRowid);
    },

    query: (args: Layer1QueryArgs): readonly Layer1Event[] => {
      const conds: string[] = [];
      const params: (string | number)[] = [];
      if (args.sessionId !== undefined) {
        conds.push("session_id = ?");
        params.push(args.sessionId);
      }
      if (args.since !== undefined) {
        conds.push("created_at >= ?");
        params.push(args.since);
      }
      if (args.until !== undefined) {
        conds.push("created_at <= ?");
        params.push(args.until);
      }
      const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
      const limit = Math.max(1, Math.floor(args.limit ?? 500));
      params.push(limit);

      const sql = `SELECT id, event_type, tool_name, content, session_id, created_at
                   FROM auto_capture ${where}
                   ORDER BY id ASC
                   LIMIT ?`;
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: Number(r["id"] ?? 0),
        eventType: String(r["event_type"] ?? ""),
        ...(r["tool_name"] != null ? { toolName: String(r["tool_name"]) } : {}),
        content: String(r["content"] ?? ""),
        ...(r["session_id"] != null ? { sessionId: String(r["session_id"]) } : {}),
        createdAt: String(r["created_at"] ?? ""),
      }));
    },

    count: (): number => {
      // store.getAutoCaptureEntries is lossy (caps); use direct count.
      void store; // silence unused
      const row = countStmt.get() as { c: number };
      return row.c;
    },
  };
}

// ── Layer 2 ────────────────────────────────────────────

function createLayer2(store: MemoryStore): OmegaLayer2 {
  return {
    search: (query: string, limit: number = 20): readonly Layer2Fact[] => {
      // Reuse store.search which hits memory_fts. Projection to
      // Layer2Fact keeps the OMEGA surface narrow.
      const results = store.search(query, limit);
      return results.map((r) => ({
        id: r.entry.id,
        layer: r.entry.layer,
        blockType: r.entry.blockType,
        key: r.entry.key,
        value: r.entry.value,
        score: r.score,
      }));
    },
    getById: (id: string): MemoryEntry | null => {
      return store.getById(id);
    },
  };
}

// ── Layer 3 ────────────────────────────────────────────

interface SummaryStmts {
  readonly insert: Database.Statement;
  readonly list: Database.Statement;
  readonly getById: Database.Statement;
  readonly count: Database.Statement;
}

function ensureSummariesTable(db: Database.Database, table: string): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS ${table} (
       id TEXT PRIMARY KEY,
       content TEXT NOT NULL,
       session_id TEXT,
       source_event_ids TEXT NOT NULL DEFAULT '[]',
       source_event_count INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_session ON ${table}(session_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_created ON ${table}(created_at DESC)`).run();
}

function prepareSummaryStmts(db: Database.Database, table: string): SummaryStmts {
  return {
    insert: db.prepare(
      `INSERT INTO ${table} (id, content, session_id, source_event_ids, source_event_count)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    list: db.prepare(
      `SELECT id, content, session_id, source_event_ids, source_event_count, created_at
       FROM ${table} ORDER BY created_at DESC LIMIT ?`,
    ),
    getById: db.prepare(
      `SELECT id, content, session_id, source_event_ids, source_event_count, created_at
       FROM ${table} WHERE id = ?`,
    ),
    count: db.prepare(`SELECT COUNT(*) AS c FROM ${table}`),
  };
}

function rowToSummary(row: Record<string, unknown>): CompressionSummary {
  let ids: number[] = [];
  try {
    const parsed = JSON.parse(String(row["source_event_ids"] ?? "[]"));
    if (Array.isArray(parsed)) {
      ids = parsed.filter((n): n is number => typeof n === "number");
    }
  } catch {
    ids = [];
  }
  return {
    id: String(row["id"]),
    content: String(row["content"] ?? ""),
    ...(row["session_id"] != null ? { sessionId: String(row["session_id"]) } : {}),
    sourceEventIds: ids,
    sourceEventCount: Number(row["source_event_count"] ?? ids.length),
    createdAt: String(row["created_at"] ?? ""),
  };
}

function createLayer3(db: Database.Database, stmts: SummaryStmts): OmegaLayer3 {
  return {
    compress: async (args: Layer3CompressArgs): Promise<CompressionSummary | null> => {
      // 1. Gather L1 events in scope.
      const conds: string[] = [];
      const params: (string | number)[] = [];
      if (args.sessionId !== undefined) {
        conds.push("session_id = ?");
        params.push(args.sessionId);
      }
      if (args.since !== undefined) {
        conds.push("created_at >= ?");
        params.push(args.since);
      }
      if (args.until !== undefined) {
        conds.push("created_at <= ?");
        params.push(args.until);
      }
      const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
      const maxEvents = Math.max(1, Math.floor(args.maxEvents ?? 100));
      params.push(maxEvents);
      const sql = `SELECT id, event_type, tool_name, content, created_at
                   FROM auto_capture ${where}
                   ORDER BY id ASC
                   LIMIT ?`;
      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

      if (rows.length === 0) return null;

      // 2. Build compression prompt (deterministic, LLM-friendly).
      const eventIds: number[] = rows.map((r) => Number(r["id"] ?? 0));
      const prompt = buildCompressionPrompt(rows);

      // 3. Invoke LLM. Honest failure: null on throw or empty.
      let summaryText: string;
      try {
        summaryText = await args.llmQuery(prompt, { maxTokens: 400, temperature: 0.2 });
      } catch {
        return null;
      }
      if (!summaryText || summaryText.trim().length === 0) return null;

      // 4. Persist with lineage.
      const id = `summary-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const sessionId = args.sessionId ?? null;
      stmts.insert.run(
        id,
        summaryText.trim(),
        sessionId,
        JSON.stringify(eventIds),
        eventIds.length,
      );
      const saved = stmts.getById.get(id) as Record<string, unknown> | undefined;
      if (!saved) return null;
      return rowToSummary(saved);
    },

    list: (limit: number = 50): readonly CompressionSummary[] => {
      const rows = stmts.list.all(Math.max(1, Math.floor(limit))) as Record<string, unknown>[];
      return rows.map(rowToSummary);
    },

    getById: (id: string): CompressionSummary | null => {
      const row = stmts.getById.get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowToSummary(row);
    },

    count: (): number => {
      const row = stmts.count.get() as { c: number };
      return row.c;
    },
  };
}

// ── Helpers ────────────────────────────────────────────

function buildCompressionPrompt(rows: Record<string, unknown>[]): string {
  const header =
    "Compress the following raw agent events into a single concise summary. " +
    "Preserve: decisions made, tools used, outcomes, errors. Reject: tool " +
    "argument noise, repetitive details. Return ONLY the summary text.\n\n" +
    "Events:\n";
  const body = rows
    .map((r, i) => {
      const tool = r["tool_name"] ? `[${String(r["tool_name"])}] ` : "";
      const content = String(r["content"] ?? "").slice(0, 500);
      return `${i + 1}. ${tool}${content}`;
    })
    .join("\n");
  return header + body + "\n\nSummary:";
}
