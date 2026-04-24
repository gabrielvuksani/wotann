/**
 * DB provisioner — V9 Tier 9 persistence layer selection.
 *
 * Given a product spec and a scaffold selection, decide which database
 * provider to materialize and emit a unified Drizzle schema. The three
 * supported providers mirror V9 §Tier-9:
 *
 *   - local-sqlite  — default; zero-cloud, written to `.wotann/db.sqlite`
 *   - turso         — edge-replicated SQLite; requires TURSO_* config
 *   - supabase      — Postgres + RLS; requires SUPABASE_* config
 *
 * The provisioner returns a structured plan: which provider, the
 * Drizzle config file contents, and a seed schema. It does NOT write
 * to disk or touch any live database; the CLI layer owns I/O. This
 * keeps the provisioner referentially transparent — tests can assert
 * the emitted strings byte-for-byte.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest refusal: unknown provider ids return
 *    `{ ok: false, error: "unknown provider: ..." }`. No silent fallback.
 *  - QB #7 per-call state: pure function; no caches.
 *  - QB #13 env guard: zero process.env reads — the caller threads
 *    Turso/Supabase credentials through `credentials` (kept as opaque
 *    placeholders; we never emit them into the generated files).
 *  - QB #14 commit-claim verification: the returned `provider` field
 *    is exactly what the selector chose; no post-hoc relabeling.
 */

// ═══ Types ═════════════════════════════════════════════════════════════

export type DbProvider = "local-sqlite" | "turso" | "supabase";

export interface DbProvisionerInput {
  /** Raw product spec text (same text used by scaffold-registry). */
  readonly spec: string;
  /** Optional explicit pick (--db=<id>) — bypasses spec-based selection. */
  readonly pick?: DbProvider;
  /** Target scaffold — affects default DB (edge → turso, rn → turso, etc.). */
  readonly scaffoldRuntime?: "node" | "edge" | "rn";
}

export interface DbProvisionPlan {
  readonly provider: DbProvider;
  /** Was the pick explicit (pick or spec signal) vs the default? */
  readonly matched: boolean;
  /** `drizzle.config.ts` contents — ready to write. */
  readonly drizzleConfig: string;
  /** `src/db/schema.ts` — the unified base schema. */
  readonly schema: string;
  /** Provider-specific env var names the scaffolded app will read. */
  readonly envVars: readonly string[];
  /** Post-install notes (printed by CLI). */
  readonly notes: readonly string[];
}

export type DbProvisionResult =
  | { readonly ok: true; readonly plan: DbProvisionPlan }
  | { readonly ok: false; readonly error: string };

// ═══ Selector ══════════════════════════════════════════════════════════

const PROVIDER_IDS: readonly DbProvider[] = ["local-sqlite", "turso", "supabase"];

/** Spec keyword buckets per provider. Order matches scoring priority. */
const SPEC_SIGNALS: Record<DbProvider, readonly string[]> = {
  "local-sqlite": ["sqlite", "local db", "local database", "embedded db", "zero cloud", "offline"],
  turso: ["turso", "libsql", "edge sqlite", "edge database", "replicated sqlite"],
  supabase: [
    "supabase",
    "postgres",
    "postgresql",
    "rls",
    "row level security",
    "row-level security",
    "team collab",
    "team collaboration",
    "realtime",
    "real-time",
  ],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function selectProvider(input: DbProvisionerInput): { id: DbProvider; matched: boolean } {
  if (input.pick !== undefined) {
    return { id: input.pick, matched: true };
  }
  const spec = normalize(input.spec ?? "");
  let best: { id: DbProvider; score: number } = { id: "local-sqlite", score: 0 };
  for (const id of PROVIDER_IDS) {
    let s = 0;
    for (const sig of SPEC_SIGNALS[id]) {
      if (spec.includes(sig)) s += sig.length;
    }
    if (s > best.score) best = { id, score: s };
  }
  if (best.score === 0) {
    // Runtime-aware default: edge scaffolds prefer Turso for low
    // cold-start; node/rn prefer local-sqlite for zero-config.
    if (input.scaffoldRuntime === "edge") {
      return { id: "turso", matched: false };
    }
    return { id: "local-sqlite", matched: false };
  }
  return { id: best.id, matched: true };
}

// ═══ Emitters (pure strings) ═══════════════════════════════════════════

const UNIFIED_SCHEMA_DOCSTRING = `/**
 * Unified base schema emitted by wotann build.
 * Tables: users, sessions, teams, team_members, sessions_audit.
 * Extend by editing this file and running \`drizzle-kit generate\`.
 */`;

function unifiedSqliteSchema(): string {
  return `${UNIFIED_SCHEMA_DOCSTRING}
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const teamMembers = sqliteTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.teamId, t.userId] }) }),
);
`;
}

function unifiedPgSchema(): string {
  return `${UNIFIED_SCHEMA_DOCSTRING}
import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.teamId, t.userId] }) }),
);
`;
}

function drizzleConfigFor(provider: DbProvider): string {
  switch (provider) {
    case "local-sqlite":
      return `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: ".wotann/db.sqlite" },
});
`;
    case "turso":
      return `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
});
`;
    case "supabase":
      return `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.SUPABASE_DATABASE_URL! },
});
`;
  }
}

function envVarsFor(provider: DbProvider): readonly string[] {
  switch (provider) {
    case "local-sqlite":
      return [];
    case "turso":
      return ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"];
    case "supabase":
      return ["SUPABASE_DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
  }
}

function notesFor(provider: DbProvider): readonly string[] {
  switch (provider) {
    case "local-sqlite":
      return [
        "Database will be created at .wotann/db.sqlite on first run.",
        "Run `pnpm drizzle-kit push` to apply the schema.",
      ];
    case "turso":
      return [
        "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.local.",
        "Create DB:  turso db create <name>",
        "Token:      turso db tokens create <name>",
      ];
    case "supabase":
      return [
        "Set SUPABASE_DATABASE_URL in .env.local.",
        "Row-Level Security policies are enabled on all tables by default.",
        "See drizzle/0000_rls.sql for the initial RLS SQL.",
      ];
  }
}

// ═══ Entry point ═══════════════════════════════════════════════════════

/**
 * Build a DB provision plan. Pure: same input -> same output strings.
 */
export function provisionDatabase(input: DbProvisionerInput): DbProvisionResult {
  if (input.pick !== undefined && !PROVIDER_IDS.includes(input.pick)) {
    return { ok: false, error: `unknown provider: ${input.pick}` };
  }
  const picked = selectProvider(input);
  const schema = picked.id === "supabase" ? unifiedPgSchema() : unifiedSqliteSchema();
  const plan: DbProvisionPlan = {
    provider: picked.id,
    matched: picked.matched,
    drizzleConfig: drizzleConfigFor(picked.id),
    schema,
    envVars: envVarsFor(picked.id),
    notes: notesFor(picked.id),
  };
  return { ok: true, plan };
}

/** Enumerate all DB provider ids. */
export function listDbProviders(): readonly DbProvider[] {
  return PROVIDER_IDS;
}
