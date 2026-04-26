/**
 * `wotann build [spec]` — V9 Tier 9 CLI command.
 *
 * End-to-end scaffold emission: given a free-form product spec, pick
 * a scaffold (registry), a DB provider, an auth provider, and a
 * default deploy target; synthesize the file plan; optionally emit
 * the files; and return next-step commands. Optionally run N parallel
 * variants to let the user pick the best (composes C6 worktrees).
 *
 * Flags (threaded through CLI argv by the index.ts entrypoint):
 *   --variants=N         Emit N candidate trees for comparison (default 1)
 *   --design-system=<p>  Path to a handoff bundle to seed tokens
 *   --scaffold=<id>      Force a specific scaffold (bypass selector)
 *   --db=<id>            Force a specific DB provider
 *   --auth=<id>          Force a specific auth provider
 *   --project-name=<n>   Slug for manifests (default: derived from spec)
 *   --out=<dir>          Output directory; required when --emit is passed
 *   --emit               Actually write files; default is plan-only
 *
 * Plan-only is the default. `--emit` is opt-in so users can preview
 * what would land before any disk write. This mirrors QB #6 (honest
 * refusal) — the command cannot silently overwrite.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: every branch returns `{ ok: false, error }`;
 *    no silent defaults. `--emit` without `--out` is a typed error.
 *  - QB #7 per-call state: fresh everything; no module-level caches.
 *  - QB #13 env guard: zero process.env reads; all inputs via opts.
 *  - QB #14 commit-claim verification: the returned `emitted` field is
 *    exactly the set of file paths that were written (or empty when
 *    plan-only). Tests stat each one to confirm the commit claim.
 *  - QB #15 source-verified: scaffold + DB + auth + deploy plans are
 *    captured verbatim in the result for downstream audits.
 */

import { resolve, dirname } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

import {
  selectScaffold,
  planEmission,
  type ScaffoldSelection,
  type EmissionPlan,
  type ScaffoldId,
} from "../../build/scaffold-registry.js";
import {
  provisionDatabase,
  type DbProvider,
  type DbProvisionPlan,
} from "../../build/db-provisioner.js";
import {
  provisionAuth,
  type AuthProvider,
  type AuthProvisionPlan,
} from "../../build/auth-provisioner.js";
import { adaptDeploy, type DeployTarget, type DeployPlan } from "../../build/deploy-adapter.js";
import { loadScaffoldPack, type ScaffoldPackFile } from "../../build/scaffold-pack-materializer.js";

// ═══ Types ═════════════════════════════════════════════════════════════

export interface BuildCommandOptions {
  /** Free-form product spec. Required. */
  readonly spec: string;
  /** Number of variants to compute. 1 = single pick; 2+ = best-of-N. */
  readonly variants?: number;
  /** Path to a Claude-Design handoff bundle to seed tokens (opaque). */
  readonly designSystemPath?: string;
  /** Force scaffold / DB / auth / deploy overrides. */
  readonly scaffoldPick?: ScaffoldId;
  readonly dbPick?: DbProvider;
  readonly authPick?: AuthProvider;
  readonly deployPick?: DeployTarget;
  /** Project name slug (defaults to the first word of the spec). */
  readonly projectName?: string;
  /** Output directory. Required if emit=true. */
  readonly outDir?: string;
  /** When true, materialize files. Default: false (plan only). */
  readonly emit?: boolean;
  /** When true, overwrite existing files at outDir. */
  readonly force?: boolean;
}

export interface BuildPlanVariant {
  readonly variantIndex: number;
  readonly projectName: string;
  readonly scaffold: ScaffoldSelection;
  readonly emission: EmissionPlan;
  readonly db: DbProvisionPlan;
  readonly auth: AuthProvisionPlan;
  readonly deploy: DeployPlan;
  /** Combined file list, relative to the project root. */
  readonly files: readonly { readonly path: string; readonly source: string }[];
}

export type BuildResult =
  | {
      readonly ok: true;
      readonly variants: readonly BuildPlanVariant[];
      /** Paths actually written (absolute). Empty when emit=false. */
      readonly emitted: readonly string[];
      /** Human-readable next-step commands for the CLI to print. */
      readonly nextSteps: readonly string[];
    }
  | { readonly ok: false; readonly error: string };

// ═══ Helpers ═══════════════════════════════════════════════════════════

/** Derive a slug from the spec when no explicit projectName was passed. */
function deriveProjectName(spec: string): string {
  const first = spec.trim().split(/\s+/)[0] ?? "app";
  return (
    first
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "app"
  );
}

/** Build the unified file manifest for a single variant. */
function composeFiles(
  scaffold: ScaffoldSelection,
  emission: EmissionPlan,
  db: DbProvisionPlan,
  auth: AuthProvisionPlan,
  deploy: DeployPlan,
): readonly { readonly path: string; readonly source: string }[] {
  const entries: { readonly path: string; readonly source: string }[] = [];

  // Scaffold files — V9 Wave 6.9 (audit §3.1.14): try the matching
  // skill pack first (skills/pack-<id>.md) so `--emit` writes real,
  // bootable files instead of placeholder stubs. When the pack is
  // missing OR doesn't cover a particular path, we fall back to the
  // honest placeholder so the build never silently drops files
  // (QB #6: graceful degradation, not fake-success).
  if (scaffold.ok) {
    const packResult = loadScaffoldPack(scaffold.scaffold.id);
    const packIndex = packResult.ok ? indexPackFiles(packResult.files) : null;
    for (const f of emission.files) {
      const packed = packIndex?.get(f);
      const source = packed !== undefined ? packed : placeholderFor(f, scaffold.scaffold.id);
      entries.push({ path: f, source });
    }
  }

  // DB files
  entries.push({ path: "drizzle.config.ts", source: db.drizzleConfig });
  entries.push({ path: "src/db/schema.ts", source: db.schema });

  // Auth files
  entries.push({ path: "src/auth/config.ts", source: auth.authConfig });

  // Deploy manifests
  for (const f of deploy.files) {
    entries.push({ path: f.path, source: f.contents });
  }

  return entries;
}

/**
 * Build a path -> contents lookup over the parsed pack files. We use a
 * `Map` rather than a plain object so future pack entries containing
 * `__proto__` or `constructor` paths can't poison the lookup.
 */
function indexPackFiles(files: readonly ScaffoldPackFile[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) {
    m.set(f.path, f.contents);
  }
  return m;
}

/** Minimal placeholder. Real templates land via skill packs. */
function placeholderFor(filePath: string, scaffoldId: ScaffoldId): string {
  if (filePath === "package.json") {
    return (
      JSON.stringify(
        {
          name: "placeholder",
          private: true,
          type: "module",
          scripts: {
            dev: "echo 'run: wotann skills load pack-" + scaffoldId + "'",
            build: "echo 'build not wired yet'",
          },
        },
        null,
        2,
      ) + "\n"
    );
  }
  if (filePath === ".gitignore") {
    return "node_modules\n.wotann\ndist\n.env*\n";
  }
  if (filePath === "README.md") {
    return `# Generated by wotann build\nScaffold: ${scaffoldId}\n\nRun \`wotann skills load pack-${scaffoldId}\` to materialize the full template.\n`;
  }
  // Generic placeholder — clearly marks unfinished files (QB #6).
  return `// Placeholder for ${filePath} (scaffold: ${scaffoldId}).\n// Run \`wotann skills load pack-${scaffoldId}\` to materialize this file.\n`;
}

/** Emit files to disk. Returns the list of absolute paths written. */
function emitToDisk(
  variant: BuildPlanVariant,
  outDir: string,
  force: boolean,
): { written: string[]; error: string | null } {
  const written: string[] = [];
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  for (const entry of variant.files) {
    const absPath = resolve(outDir, entry.path);
    if (existsSync(absPath) && !force) {
      return {
        written,
        error: `refusing to overwrite ${absPath} (pass --force to override)`,
      };
    }
    const parent = dirname(absPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    try {
      writeFileSync(absPath, entry.source, "utf-8");
      written.push(absPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { written, error: `write failed for ${absPath}: ${reason}` };
    }
  }
  return { written, error: null };
}

// ═══ Entry point ═══════════════════════════════════════════════════════

/**
 * Run `wotann build` end-to-end. Plan-only by default; `emit=true`
 * materializes files. Pure-return semantics (always an envelope).
 */
export async function runBuildCommand(opts: BuildCommandOptions): Promise<BuildResult> {
  if (typeof opts.spec !== "string" || opts.spec.trim().length === 0) {
    return { ok: false, error: "spec required (free-form product description)" };
  }
  if (opts.emit === true && (opts.outDir === undefined || opts.outDir.trim() === "")) {
    return { ok: false, error: "--emit requires --out=<dir>" };
  }
  const variantsCount = typeof opts.variants === "number" && opts.variants >= 1 ? opts.variants : 1;
  const projectName = opts.projectName ?? deriveProjectName(opts.spec);

  // Compose the plan for each variant. Right now all variants share
  // the same selector output (deterministic); the --variants flag is
  // wired to the C6 best-of-n worktree layer by the index.ts caller.
  // This keeps the command pure and testable in isolation (QB #7).
  const variants: BuildPlanVariant[] = [];
  for (let i = 0; i < variantsCount; i++) {
    const scaffoldOpts: { pick?: ScaffoldId } = {};
    if (opts.scaffoldPick !== undefined) scaffoldOpts.pick = opts.scaffoldPick;
    const scaffold = selectScaffold(opts.spec, scaffoldOpts);
    if (!scaffold.ok) {
      return { ok: false, error: `scaffold selection failed: ${scaffold.error}` };
    }

    const emission = planEmission(scaffold);
    if (!emission) {
      return { ok: false, error: "scaffold selection produced no emission plan" };
    }

    const dbResult = provisionDatabase({
      spec: opts.spec,
      scaffoldRuntime: scaffold.scaffold.runtime,
      ...(opts.dbPick !== undefined ? { pick: opts.dbPick } : {}),
    });
    if (!dbResult.ok) {
      return { ok: false, error: `db provisioner failed: ${dbResult.error}` };
    }

    const authResult = provisionAuth({
      spec: opts.spec,
      ...(opts.authPick !== undefined ? { pick: opts.authPick } : {}),
    });
    if (!authResult.ok) {
      return { ok: false, error: `auth provisioner failed: ${authResult.error}` };
    }

    const deployResult = adaptDeploy({
      scaffoldRuntime: scaffold.scaffold.runtime,
      projectName,
      ...(opts.deployPick !== undefined ? { pick: opts.deployPick } : {}),
    });
    if (!deployResult.ok) {
      return { ok: false, error: `deploy adapter failed: ${deployResult.error}` };
    }

    const files = composeFiles(
      scaffold,
      emission,
      dbResult.plan,
      authResult.plan,
      deployResult.plan,
    );

    variants.push({
      variantIndex: i,
      projectName,
      scaffold,
      emission,
      db: dbResult.plan,
      auth: authResult.plan,
      deploy: deployResult.plan,
      files,
    });
  }

  // Emit the first variant (the user chooses between variants via the
  // C6 best-of-n UI; this command emits the "primary" tree).
  const emitted: string[] = [];
  if (opts.emit === true) {
    const outDir = resolve(opts.outDir as string);
    const first = variants[0];
    if (!first) {
      return { ok: false, error: "no variants computed" };
    }
    const { written, error } = emitToDisk(first, outDir, opts.force === true);
    if (error) {
      return { ok: false, error };
    }
    emitted.push(...written);
  }

  // Collect next steps from the emission plan of variant 0.
  const primary = variants[0];
  const nextSteps: readonly string[] = primary ? [...primary.emission.nextSteps] : [];

  return { ok: true, variants, emitted, nextSteps };
}

/** Normalize the `--variants` flag (CLI entrypoint consumer). */
export function parseVariantsFlag(raw: string | number | undefined): number {
  if (typeof raw === "number") return raw >= 1 ? Math.floor(raw) : 1;
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }
  return 1;
}
