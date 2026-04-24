/**
 * V9 Tier 9 — golden.test.ts.
 *
 * The 8 blessed scaffold x deploy combos that MUST produce a coherent
 * emission plan. Per V9 Tier 9: "Top-8 combos must compile+boot+serve."
 * Because cloud deploys cannot run in CI, this file verifies the SHAPE
 * of the emitted plans: the right files are present, the manifests
 * reference the right scaffold, the schemas are non-empty, and the
 * combined build+emit pipeline returns a manifest that any downstream
 * template materializer could unpack without further surgery.
 *
 * The 8 golden combos:
 *
 *   1. Next.js + Cloudflare Pages + local-sqlite + Lucia      (web SaaS default)
 *   2. Next.js + Vercel         + Supabase      + Clerk       (team app)
 *   3. Hono-React-Edge + Cloudflare + Turso     + Lucia       (edge API)
 *   4. Hono-React-Edge + Fly      + Supabase    + WorkOS      (enterprise edge)
 *   5. Astro + Cloudflare Pages  + local-sqlite + Lucia       (content site)
 *   6. Astro + Vercel            + local-sqlite + Auth.js     (blog)
 *   7. Expo  + Fly               + Supabase     + Supabase-Auth (mobile + team)
 *   8. Expo  + Self-host         + local-sqlite + Lucia       (mobile + self-host)
 *
 * Each combo passes through runBuildCommand and must:
 *   - return ok: true
 *   - include the canonical scaffold files
 *   - include drizzle.config.ts, src/db/schema.ts, src/auth/config.ts
 *   - include the correct deploy manifests
 *   - have non-empty nextSteps
 *
 * Plan-only mode. Does NOT actually write to disk or invoke any cloud.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *   - QB #14 (commit-claim verification): this test file is the
 *     single source of truth that says "these 8 combos work"; if any
 *     one regresses, CI fails before the commit lands.
 */

import { describe, expect, it } from "vitest";
import {
  runBuildCommand,
  type BuildCommandOptions,
} from "../../src/cli/commands/build.js";
import type { ScaffoldId } from "../../src/build/scaffold-registry.js";
import type { DbProvider } from "../../src/build/db-provisioner.js";
import type { AuthProvider } from "../../src/build/auth-provisioner.js";
import type { DeployTarget } from "../../src/build/deploy-adapter.js";

interface GoldenCombo {
  readonly label: string;
  readonly scaffoldPick: ScaffoldId;
  readonly deployPick: DeployTarget;
  readonly dbPick: DbProvider;
  readonly authPick: AuthProvider;
  /** Files expected to appear in the combined manifest (substring match). */
  readonly expectedFiles: readonly string[];
}

const GOLDEN_COMBOS: readonly GoldenCombo[] = [
  {
    label: "Next.js + Cloudflare + local-sqlite + Lucia",
    scaffoldPick: "nextjs-app-router",
    deployPick: "cloudflare-pages",
    dbPick: "local-sqlite",
    authPick: "lucia",
    expectedFiles: [
      "package.json",
      "next.config.ts",
      "wrangler.toml",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/auth/config.ts",
    ],
  },
  {
    label: "Next.js + Vercel + Supabase + Clerk",
    scaffoldPick: "nextjs-app-router",
    deployPick: "vercel",
    dbPick: "supabase",
    authPick: "clerk",
    expectedFiles: [
      "package.json",
      "next.config.ts",
      "vercel.json",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/auth/config.ts",
    ],
  },
  {
    label: "Hono-React-Edge + Cloudflare + Turso + Lucia",
    scaffoldPick: "hono-react-edge",
    deployPick: "cloudflare-pages",
    dbPick: "turso",
    authPick: "lucia",
    expectedFiles: [
      "package.json",
      "wrangler.toml",
      "src/server.ts",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/auth/config.ts",
    ],
  },
  {
    label: "Hono-React-Edge + Fly + Supabase + WorkOS",
    scaffoldPick: "hono-react-edge",
    deployPick: "fly",
    dbPick: "supabase",
    authPick: "workos",
    expectedFiles: [
      "package.json",
      "src/server.ts",
      "fly.toml",
      "Dockerfile",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/auth/config.ts",
    ],
  },
  {
    label: "Astro + Cloudflare + local-sqlite + Lucia",
    scaffoldPick: "astro-static",
    deployPick: "cloudflare-pages",
    dbPick: "local-sqlite",
    authPick: "lucia",
    expectedFiles: [
      "package.json",
      "astro.config.mjs",
      "wrangler.toml",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/auth/config.ts",
    ],
  },
  {
    label: "Astro + Vercel + local-sqlite + Auth.js",
    scaffoldPick: "astro-static",
    deployPick: "vercel",
    dbPick: "local-sqlite",
    authPick: "auth-js",
    expectedFiles: [
      "package.json",
      "astro.config.mjs",
      "vercel.json",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/auth/config.ts",
    ],
  },
  {
    label: "Expo + Fly + Supabase + Supabase-Auth",
    scaffoldPick: "expo",
    deployPick: "fly",
    dbPick: "supabase",
    authPick: "supabase-auth",
    expectedFiles: [
      "package.json",
      "app.json",
      "fly.toml",
      "Dockerfile",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/auth/config.ts",
    ],
  },
  {
    label: "Expo + Self-host + local-sqlite + Lucia",
    scaffoldPick: "expo",
    deployPick: "self-host",
    dbPick: "local-sqlite",
    authPick: "lucia",
    expectedFiles: [
      "package.json",
      "app.json",
      "deploy/Caddyfile",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/auth/config.ts",
    ],
  },
];

describe("golden: top-8 blessed combos", () => {
  // Verify we are actually asserting on 8 combos — not 7, not 9 —
  // as the V9 exit criteria states.
  it("registers exactly 8 blessed combos", () => {
    expect(GOLDEN_COMBOS).toHaveLength(8);
  });

  for (const combo of GOLDEN_COMBOS) {
    it(`emits a complete manifest: ${combo.label}`, async () => {
      const buildOpts: BuildCommandOptions = {
        spec: "golden fixture spec",
        projectName: "golden-app",
        scaffoldPick: combo.scaffoldPick,
        dbPick: combo.dbPick,
        authPick: combo.authPick,
        deployPick: combo.deployPick,
      };
      const r = await runBuildCommand(buildOpts);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.variants).toHaveLength(1);
      const variant = r.variants[0];
      expect(variant).toBeDefined();
      if (!variant) return;

      // Every file the golden expects must be in the combined manifest.
      const paths = variant.files.map((f) => f.path);
      for (const expected of combo.expectedFiles) {
        expect(paths).toContain(expected);
      }

      // Shape invariants — every combo has these three infra files.
      expect(paths).toContain("drizzle.config.ts");
      expect(paths).toContain("src/db/schema.ts");
      expect(paths).toContain("src/auth/config.ts");

      // Scaffold selection pinned by the forced pick.
      expect(variant.scaffold.ok).toBe(true);
      if (!variant.scaffold.ok) return;
      expect(variant.scaffold.scaffold.id).toBe(combo.scaffoldPick);

      // Infrastructure plans match our forced picks.
      expect(variant.db.provider).toBe(combo.dbPick);
      expect(variant.auth.provider).toBe(combo.authPick);
      expect(variant.deploy.target).toBe(combo.deployPick);

      // Schema is non-empty and has the right dialect.
      expect(variant.db.schema.length).toBeGreaterThan(0);
      if (combo.dbPick === "supabase") {
        expect(variant.db.schema).toContain("pgTable");
      } else {
        expect(variant.db.schema).toContain("sqliteTable");
      }

      // Plan is plan-only by default: no files written to disk.
      expect(r.emitted).toEqual([]);

      // Next steps are non-empty.
      expect(r.nextSteps.length).toBeGreaterThan(0);
    });
  }
});

describe("golden: V9 Tier 9 exit criteria", () => {
  it("Todo + auth + team + billing routes to Next.js", async () => {
    // This is the literal V9 exit-criteria spec. No overrides.
    const r = await runBuildCommand({
      spec: "Todo app with auth, team collab, Stripe billing",
      projectName: "todo",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variants[0]?.scaffold.ok).toBe(true);
    if (!r.variants[0] || !r.variants[0].scaffold.ok) return;
    expect(r.variants[0].scaffold.scaffold.id).toBe("nextjs-app-router");
    expect(r.variants[0].deploy.target).toBe("cloudflare-pages");
    // Supabase is selected on "team collab" signal.
    expect(r.variants[0].db.provider).toBe("supabase");
    // Next steps include a deploy suggestion.
    const allSteps = r.nextSteps.join("\n");
    expect(allSteps).toMatch(/wotann deploy/);
  });
});
