/**
 * V9 Tier 9 — db-provisioner tests.
 *
 * Coverage:
 *   - 3 providers are selectable (local-sqlite, turso, supabase).
 *   - Spec signals route correctly per V9 integration matrix.
 *   - Default path: local-sqlite when no signals match; turso for edge runtime.
 *   - Unknown forced pick is refused (QB #6).
 *   - Drizzle config + schema strings contain the expected sigils
 *     (sqlite vs postgresql dialect, table names, RLS hint).
 *   - Env vars + notes are stable per provider.
 *   - Function is pure: same input -> byte-identical strings.
 */

import { describe, expect, it } from "vitest";
import {
  provisionDatabase,
  listDbProviders,
  type DbProvider,
} from "../../src/build/db-provisioner.js";

describe("db-provisioner: structure", () => {
  it("exposes exactly 3 canonical providers", () => {
    expect(listDbProviders()).toEqual(["local-sqlite", "turso", "supabase"]);
  });
});

describe("db-provisioner: V9 routing matrix", () => {
  it("picks Turso when spec mentions it", () => {
    const r = provisionDatabase({ spec: "edge app with Turso libsql replicated sqlite" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("turso");
    expect(r.plan.matched).toBe(true);
    expect(r.plan.drizzleConfig).toContain('dialect: "turso"');
    expect(r.plan.envVars).toContain("TURSO_DATABASE_URL");
  });

  it("picks Supabase when spec mentions Postgres/RLS", () => {
    const r = provisionDatabase({
      spec: "Postgres with row level security for team collab",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("supabase");
    expect(r.plan.drizzleConfig).toContain('dialect: "postgresql"');
    expect(r.plan.schema).toContain("pgTable");
    expect(r.plan.envVars).toContain("SUPABASE_DATABASE_URL");
    expect(r.plan.notes.join("\n")).toMatch(/Row-Level Security/);
  });

  it("defaults to local-sqlite when no signals match and runtime=node", () => {
    const r = provisionDatabase({ spec: "random unrelated words" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("local-sqlite");
    expect(r.plan.matched).toBe(false);
    expect(r.plan.drizzleConfig).toContain('dialect: "sqlite"');
    expect(r.plan.drizzleConfig).toContain(".wotann/db.sqlite");
    expect(r.plan.schema).toContain("sqliteTable");
    expect(r.plan.envVars).toEqual([]);
  });

  it("defaults to turso when runtime=edge and no signals match", () => {
    const r = provisionDatabase({ spec: "random", scaffoldRuntime: "edge" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("turso");
    expect(r.plan.matched).toBe(false);
  });

  it("respects explicit --db=<id> pick", () => {
    const r = provisionDatabase({ spec: "anything", pick: "supabase" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("supabase");
    expect(r.plan.matched).toBe(true);
  });
});

describe("db-provisioner: honest refusals (QB #6)", () => {
  it("refuses unknown provider id", () => {
    const r = provisionDatabase({ spec: "anything", pick: "mysql" as DbProvider });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("unknown provider");
  });
});

describe("db-provisioner: schema integrity", () => {
  it("unified schema has the 4 core tables", () => {
    for (const id of listDbProviders()) {
      const r = provisionDatabase({ spec: "any", pick: id });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const s = r.plan.schema;
      expect(s).toContain('users');
      expect(s).toContain('sessions');
      expect(s).toContain('teams');
      expect(s).toContain('team_members');
    }
  });

  it("is pure (same input -> same output)", () => {
    const a = provisionDatabase({ spec: "edge turso api" });
    const b = provisionDatabase({ spec: "edge turso api" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.plan.schema).toBe(b.plan.schema);
    expect(a.plan.drizzleConfig).toBe(b.plan.drizzleConfig);
  });
});
