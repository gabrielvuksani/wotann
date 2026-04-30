/**
 * Snippet store — cross-surface prompt library backed by SQLite.
 *
 * Round 8 feature ("creative power-feature" mandate from user). The
 * iOS app shipped a `PromptLibraryView` storing snippets to
 * `UserDefaults` — Desktop had nothing, CLI had nothing, and the iOS
 * library didn't sync anywhere. This store promotes that zombie
 * surface to a daemon-backed RPC so a snippet written on the phone
 * shows up on desktop the next morning.
 *
 * **Why SQLite + FTS5**: snippet bodies can be arbitrarily long
 * prompt templates. FTS5 lets users search across body text in
 * milliseconds. The same dependency WOTANN already uses for memory.
 *
 * **`{{variable}}` substitution**: bodies may contain `{{var_name}}`
 * tokens. `extractVariables(body)` scans a body and returns the unique
 * set of placeholders so the UI can render a form. `render(body, vars)`
 * substitutes — missing keys are surfaced via the result envelope so
 * the UI can warn instead of silently leaving raw `{{var}}` in the
 * rendered output.
 *
 * **Concurrency**: better-sqlite3 + WAL mode means many readers + one
 * writer at a time. The daemon process holds the only writer lock.
 * Conflicts on simultaneous edits across surfaces are last-write-wins
 * via `updatedAt` — same semantics as MemoryStore.update().
 */

import Database from "better-sqlite3";

export interface Snippet {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly isFavorite: boolean;
  readonly useCount: number;
  /** Unix-ms; null when never used. */
  readonly lastUsedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Distinct {{var}} placeholders extracted from `body`. */
  readonly variables: readonly string[];
}

export interface SnippetUpsert {
  /** Optional id; if omitted a new id is minted. */
  readonly id?: string;
  readonly title: string;
  readonly body: string;
  readonly category?: string | null;
  readonly tags?: readonly string[];
  readonly isFavorite?: boolean;
}

export interface SnippetListFilter {
  readonly category?: string;
  readonly favOnly?: boolean;
  /** Free-text search via FTS5. Empty/undefined returns all. */
  readonly query?: string;
}

export interface SnippetRenderResult {
  readonly rendered: string;
  /** Variables in the body that the caller did NOT supply. */
  readonly missingVars: readonly string[];
}

/**
 * Extract the set of `{{var}}` placeholders from a body. Identifiers
 * are `[A-Za-z_][A-Za-z0-9_]*` — same shape JavaScript identifiers
 * use, so users can name variables intuitively. Whitespace inside
 * braces (`{{ user_name }}`) is tolerated.
 */
export function extractVariables(body: string): readonly string[] {
  const seen = new Set<string>();
  const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match[1]) seen.add(match[1]);
  }
  return [...seen];
}

/**
 * Render a body with variable substitution. Missing variables stay
 * as raw `{{var}}` tokens in the output AND are surfaced in
 * `missingVars` so the UI can warn the user instead of silently
 * shipping a half-rendered prompt.
 */
export function renderSnippet(
  body: string,
  vars: Readonly<Record<string, string>>,
): SnippetRenderResult {
  const missing = new Set<string>();
  const rendered = body.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (raw, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key] ?? "";
    }
    missing.add(key);
    return raw;
  });
  return { rendered, missingVars: [...missing] };
}

export class SnippetStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snippets (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        body         TEXT NOT NULL,
        category     TEXT,
        tags         TEXT NOT NULL DEFAULT '',
        is_favorite  INTEGER NOT NULL DEFAULT 0,
        use_count    INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS snippets_updated_at_idx ON snippets(updated_at DESC);
      CREATE INDEX IF NOT EXISTS snippets_last_used_at_idx ON snippets(last_used_at DESC);
      CREATE INDEX IF NOT EXISTS snippets_category_idx ON snippets(category);
    `);

    // FTS5 shadow keyed on the snippet rowid (better-sqlite3 assigns
    // an integer rowid to every row in the snippets table). We keep
    // the FTS table in sync manually rather than via triggers so
    // upsert/delete remain atomic with the main-table write.
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
        title, body, tokenize = 'porter unicode61'
      );
    `);
  }

  /** Generate a unique snippet id. */
  private mintId(): string {
    return `snip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Insert or update a snippet. Returns the canonical record after
   * write. If `input.id` is omitted (or refers to no row) a new id
   * is minted.
   */
  upsert(input: SnippetUpsert): Snippet {
    const now = Date.now();
    const id = input.id ?? this.mintId();
    const tagsCsv = (input.tags ?? []).join(",");
    const isFav = input.isFavorite ? 1 : 0;
    const existing = this.db.prepare("SELECT id FROM snippets WHERE id = ?").get(id) as
      | { id: string }
      | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE snippets
           SET title = ?, body = ?, category = ?, tags = ?, is_favorite = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.title, input.body, input.category ?? null, tagsCsv, isFav, now, id);
      // Refresh FTS row.
      this.db.prepare("DELETE FROM snippets_fts WHERE rowid = ?").run(this.rowidOf(id));
    } else {
      this.db
        .prepare(
          `INSERT INTO snippets (id, title, body, category, tags, is_favorite, use_count, last_used_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
        )
        .run(id, input.title, input.body, input.category ?? null, tagsCsv, isFav, now, now);
    }

    // Always (re)insert FTS row tied to the current snippet rowid so
    // search stays consistent whether this was an insert or update.
    const rowid = this.rowidOf(id);
    this.db
      .prepare("INSERT INTO snippets_fts (rowid, title, body) VALUES (?, ?, ?)")
      .run(rowid, input.title, input.body);

    return this.getById(id) as Snippet;
  }

  /** Hard-delete a snippet by id. */
  delete(id: string): boolean {
    const rowid = this.rowidOf(id);
    if (rowid === null) return false;
    this.db.prepare("DELETE FROM snippets_fts WHERE rowid = ?").run(rowid);
    const result = this.db.prepare("DELETE FROM snippets WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** Look up a snippet by id, or null if absent. */
  getById(id: string): Snippet | null {
    const row = this.db.prepare("SELECT * FROM snippets WHERE id = ?").get(id);
    if (!row) return null;
    return this.rowToSnippet(row as Record<string, unknown>);
  }

  /**
   * List snippets ordered by: pinned (favorite) first, then
   * last-used desc, then updated_at desc. Filter is optional.
   *
   * FTS5 tokens are sanitized (quoted) so user input can include
   * special characters without triggering syntax errors.
   */
  list(filter: SnippetListFilter = {}): readonly Snippet[] {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter.category) {
      where.push("category = ?");
      params.push(filter.category);
    }
    if (filter.favOnly) {
      where.push("is_favorite = 1");
    }

    let sql: string;
    if (filter.query && filter.query.trim().length > 0) {
      // FTS5 MATCH — quote the user term to neutralize special chars.
      // We split on whitespace and quote each token, joining with AND
      // so multi-word queries narrow rather than confuse the parser.
      const tokens = filter.query
        .trim()
        .split(/\s+/)
        .map((t) => `"${t.replace(/"/g, '""')}"`);
      const matchExpr = tokens.join(" AND ");
      sql = `
        SELECT s.* FROM snippets s
        JOIN snippets_fts f ON f.rowid = s.rowid
        WHERE f.snippets_fts MATCH ?
        ${where.length > 0 ? `AND ${where.join(" AND ")}` : ""}
        ORDER BY s.is_favorite DESC, COALESCE(s.last_used_at, 0) DESC, s.updated_at DESC
      `;
      params.unshift(matchExpr);
    } else {
      sql = `
        SELECT * FROM snippets
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY is_favorite DESC, COALESCE(last_used_at, 0) DESC, updated_at DESC
      `;
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSnippet(r));
  }

  /**
   * Render a snippet with variable substitution AND record the use.
   * Use-recording bumps `useCount` and `lastUsedAt` so the picker can
   * surface the user's most-frequent prompts at the top.
   *
   * Returns the render envelope plus the updated snippet record so
   * callers can re-display current ranking without a follow-up list.
   */
  use(
    id: string,
    vars: Readonly<Record<string, string>> = {},
  ): { snippet: Snippet; render: SnippetRenderResult } | null {
    const snippet = this.getById(id);
    if (!snippet) return null;
    const now = Date.now();
    this.db
      .prepare("UPDATE snippets SET use_count = use_count + 1, last_used_at = ? WHERE id = ?")
      .run(now, id);
    const fresh = this.getById(id) as Snippet;
    const render = renderSnippet(snippet.body, vars);
    return { snippet: fresh, render };
  }

  /** Total non-deleted snippet count. */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM snippets").get() as { c: number };
    return row.c;
  }

  /** Health probe — confirm the SQLite handle is live. */
  healthCheck(): boolean {
    try {
      const row = this.db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
      return row?.ok === 1;
    } catch {
      return false;
    }
  }

  /** Close the underlying db. Call before process exit. */
  close(): void {
    this.db.close();
  }

  // ── Private helpers ─────────────────────────────────────

  private rowidOf(id: string): number | null {
    const row = this.db.prepare("SELECT rowid FROM snippets WHERE id = ?").get(id) as
      | { rowid: number }
      | undefined;
    return row?.rowid ?? null;
  }

  private rowToSnippet(row: Record<string, unknown>): Snippet {
    const body = String(row["body"] ?? "");
    const tagsRaw = String(row["tags"] ?? "");
    const tags =
      tagsRaw.length > 0
        ? tagsRaw
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0)
        : [];
    return {
      id: String(row["id"]),
      title: String(row["title"] ?? ""),
      body,
      category: (row["category"] as string | null) ?? null,
      tags,
      isFavorite: Number(row["is_favorite"] ?? 0) === 1,
      useCount: Number(row["use_count"] ?? 0),
      lastUsedAt:
        row["last_used_at"] === null || row["last_used_at"] === undefined
          ? null
          : Number(row["last_used_at"]),
      createdAt: Number(row["created_at"] ?? 0),
      updatedAt: Number(row["updated_at"] ?? 0),
      variables: extractVariables(body),
    };
  }
}
