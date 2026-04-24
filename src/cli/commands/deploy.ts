/**
 * `wotann deploy --to=<target>` — V9 Tier 9 CLI command.
 *
 * Given a previously-scaffolded project (or any project with a
 * package.json), emit the deployment manifest files and print the
 * shell commands the user should run. Plan-only by default; `--emit`
 * writes the manifest files into the project tree. This command does
 * NOT call wrangler / vercel / flyctl — shelling out is the user's
 * decision and the CLI shell's responsibility. This keeps the command
 * deterministic and safe for CI (no side effects without --emit).
 *
 * Flags:
 *   --to=<target>       One of: cloudflare-pages | vercel | fly | self-host
 *   --project=<dir>     Project directory (default: cwd)
 *   --project-name=<n>  Override the project slug in manifests
 *   --custom-domain=<d> Include a custom domain in vercel.json / Caddyfile
 *   --emit              Actually write manifest files; default is plan-only
 *   --force             Overwrite existing manifests
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: every branch returns `{ ok: false, error }`;
 *    no silent defaults. `--emit` without `--to` is refused.
 *  - QB #7 per-call state: pure function + opt-in FS writes.
 *  - QB #13 env guard: zero process.env reads.
 *  - QB #14 commit-claim verification: `emitted` is exactly the files
 *    that were written; the CLI asserts stat() on each one.
 *  - QB #15 source-verified: the deploy-adapter plan is preserved
 *    verbatim in the result for downstream audit trails.
 */

import { resolve, dirname, basename } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";

import { adaptDeploy, type DeployTarget, type DeployPlan } from "../../build/deploy-adapter.js";

// ═══ Types ═════════════════════════════════════════════════════════════

export interface DeployCommandOptions {
  /** Deploy target id. Required. */
  readonly to: DeployTarget;
  /** Project directory. Default: cwd. */
  readonly projectDir?: string;
  /** Override for the project name slug in manifests. */
  readonly projectName?: string;
  /** Optional custom domain (routed into vercel.json / Caddyfile). */
  readonly customDomain?: string;
  /** When true, write manifest files. Default: false (plan-only). */
  readonly emit?: boolean;
  /** Overwrite existing manifest files at the target paths. */
  readonly force?: boolean;
}

export type DeployCommandResult =
  | {
      readonly ok: true;
      readonly plan: DeployPlan;
      /** Absolute paths written when --emit is passed; otherwise empty. */
      readonly emitted: readonly string[];
      /** Shell commands the CLI should print for the user to run. */
      readonly commands: readonly string[];
    }
  | { readonly ok: false; readonly error: string };

// ═══ Helpers ═══════════════════════════════════════════════════════════

function deriveProjectName(projectDir: string): string {
  const pkgPath = resolve(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw) as { name?: unknown };
      if (typeof pkg.name === "string" && pkg.name.trim().length > 0) {
        return pkg.name;
      }
    } catch {
      // fall through to directory basename
    }
  }
  const dirName = basename(resolve(projectDir));
  return dirName.length > 0 ? dirName : "app";
}

// ═══ Entry point ═══════════════════════════════════════════════════════

/** Run the deploy command. Plan-only by default; emit=true writes files. */
export async function runDeployCommand(opts: DeployCommandOptions): Promise<DeployCommandResult> {
  if (typeof opts.to !== "string" || opts.to.trim().length === 0) {
    return { ok: false, error: "--to=<target> required" };
  }
  const projectDir = resolve(opts.projectDir ?? process.cwd());
  if (!existsSync(projectDir)) {
    return { ok: false, error: `project directory does not exist: ${projectDir}` };
  }
  const projectName = opts.projectName ?? deriveProjectName(projectDir);

  const result = adaptDeploy({
    pick: opts.to,
    projectName,
    ...(opts.customDomain !== undefined ? { customDomain: opts.customDomain } : {}),
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const emitted: string[] = [];
  if (opts.emit === true) {
    for (const f of result.plan.files) {
      const abs = resolve(projectDir, f.path);
      if (existsSync(abs) && opts.force !== true) {
        return {
          ok: false,
          error: `refusing to overwrite ${abs} (pass --force to override)`,
        };
      }
      const parent = dirname(abs);
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      try {
        writeFileSync(abs, f.contents, "utf-8");
        emitted.push(abs);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `write failed for ${abs}: ${reason}` };
      }
    }
  }

  return {
    ok: true,
    plan: result.plan,
    emitted,
    commands: result.plan.commands,
  };
}

/** Parse the `--to=<target>` flag into a typed DeployTarget. */
export function parseDeployTarget(raw: string): DeployTarget | null {
  if (raw === "cloudflare-pages" || raw === "vercel" || raw === "fly" || raw === "self-host") {
    return raw;
  }
  return null;
}
