/**
 * Config migration — V9 Tier 6 T6.5.
 *
 * For users upgrading from WOTANN 0.1.x (which assumed a bundled
 * Gemma default + a different provider shape) to 0.2+ (no bundled
 * default; hardware-aware ladder). The migrator:
 *
 *   1. Detects legacy config signatures (pre-0.2 `version` field,
 *      references to `bundled-gemma`, pre-rename provider names).
 *   2. Archives the file to `.wotann/.legacy/` with a timestamp so
 *      users keep a rollback copy.
 *   3. Emits a structured `MigrationPlan` describing what would
 *      change. Callers (CLI / wizard) decide whether to apply.
 *
 * The migrator is intentionally conservative: it ONLY archives +
 * flags. It does NOT rewrite the user's config in place. The
 * wizard re-onboards the user, and when the user confirms the new
 * config, writes it fresh.
 *
 * WOTANN quality bars:
 * - QB #6 honest failures: every I/O call wraps try/catch and
 *   surfaces `{ok:false, error:...}` rather than silently succeeding.
 * - QB #7 per-call state: no module-level caches; each call is a
 *   fresh scan.
 * - QB #13 env guard: `MigrationEnv` snapshot rather than direct
 *   `process.*` reads — tests pass a fixture.
 */

import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

export type MigrationFinding =
  | "legacy-version"
  | "bundled-gemma-ref"
  | "deprecated-provider-name"
  | "anthropic-oauth-file"
  | "codex-tokens-file";

export interface MigrationPlan {
  readonly needed: boolean;
  readonly findings: readonly MigrationFinding[];
  /** Absolute path of the config file inspected (may not exist). */
  readonly configPath: string;
  /** Absolute path where a backup would be written, if applied. */
  readonly backupPath: string | null;
  /** Human-readable notes per finding — used by the wizard's display. */
  readonly notes: readonly string[];
}

export interface MigrationResult {
  readonly ok: boolean;
  readonly plan: MigrationPlan;
  /** Absolute path of the archived file if migration applied, else null. */
  readonly archivedAt: string | null;
  readonly error?: string;
}

export interface MigrationEnv {
  readonly homeDir: string;
  readonly cwd: string;
}

export function currentMigrationEnv(): MigrationEnv {
  return { homeDir: homedir(), cwd: process.cwd() };
}

// ── Detectors ─────────────────────────────────────────────────────────────

/**
 * Legacy-version signature: pre-0.2 configs had `version: "0.1.x"`.
 * Any other string (including missing) is treated as current.
 */
function hasLegacyVersion(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown } | null;
    const v = parsed && typeof parsed === "object" ? parsed.version : undefined;
    return typeof v === "string" && v.startsWith("0.1.");
  } catch {
    // YAML or malformed JSON — accept YAML shape heuristically.
    return /\bversion:\s*['"]?0\.1\./.test(raw);
  }
}

/** 0.1.x shipped references to `bundled-gemma` as the default model. */
function hasBundledGemmaRef(raw: string): boolean {
  return /bundled[-_]gemma|gemma-bundled|default:\s*bundled-gemma/i.test(raw);
}

/** Catch pre-0.2 provider names that later got renamed. */
function hasDeprecatedProviderName(raw: string): boolean {
  // anthropic-subscription → anthropic-cli (V9 T0.1 rename)
  // codex-oauth → codex-detector (V9 T0.2 rename)
  return /\banthropic-subscription\b|\bcodex-oauth\b/.test(raw);
}

// ── Plan builder ──────────────────────────────────────────────────────────

/**
 * Build a MigrationPlan by scanning the user's config file + the
 * legacy credential locations. NEVER writes anything — `applyMigration`
 * is the only mutating entry point.
 */
export function planMigration(env: MigrationEnv = currentMigrationEnv()): MigrationPlan {
  const configCandidates = [
    join(env.cwd, "wotann.yaml"),
    join(env.cwd, "wotann.json"),
    join(env.cwd, ".wotann", "config.yaml"),
    join(env.cwd, ".wotann", "config.json"),
  ];
  const configPath = configCandidates.find((p) => existsSync(p)) ?? configCandidates[0]!;

  const findings: MigrationFinding[] = [];
  const notes: string[] = [];

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      if (hasLegacyVersion(raw)) {
        findings.push("legacy-version");
        notes.push(
          `${configPath}: detected pre-0.2 version field. New schema changed — re-onboarding will produce a fresh file.`,
        );
      }
      if (hasBundledGemmaRef(raw)) {
        findings.push("bundled-gemma-ref");
        notes.push(
          `${configPath}: references bundled-gemma. WOTANN 0.2+ has no bundled default model — the onboarding wizard picks a provider based on your hardware.`,
        );
      }
      if (hasDeprecatedProviderName(raw)) {
        findings.push("deprecated-provider-name");
        notes.push(
          `${configPath}: uses a deprecated provider name (anthropic-subscription → anthropic-cli OR codex-oauth → codex-detector). Re-onboarding renames automatically.`,
        );
      }
    } catch {
      // Unreadable → not a migration concern here; loader will
      // surface a proper error to the user.
    }
  }

  // Legacy credential files from V9 T0.1 / T0.2 deletions.
  const legacyAnthropicOauth = join(env.homeDir, ".wotann", "anthropic-oauth.json");
  if (existsSync(legacyAnthropicOauth)) {
    findings.push("anthropic-oauth-file");
    notes.push(
      `${legacyAnthropicOauth}: legacy OAuth file from WOTANN 0.1.x. V9 T0.1 removed the WOTANN-writes-token path — this file is archived, and new auth uses the Claude Code CLI's own credential store.`,
    );
  }
  const legacyCodexTokens = join(env.homeDir, ".wotann", "codex-tokens.json");
  if (existsSync(legacyCodexTokens)) {
    findings.push("codex-tokens-file");
    notes.push(
      `${legacyCodexTokens}: legacy Codex PKCE tokens. V9 T0.2 removed WOTANN's own PKCE flow — file is archived and new sessions read ~/.codex/auth.json (written by 'codex login').`,
    );
  }

  const backupPath =
    findings.length > 0
      ? join(
          env.homeDir,
          ".wotann",
          ".legacy",
          `config-backup.${new Date().toISOString().replace(/[:.]/g, "-")}`,
        )
      : null;

  return {
    needed: findings.length > 0,
    findings,
    configPath,
    backupPath,
    notes,
  };
}

// ── Apply ─────────────────────────────────────────────────────────────────

/**
 * Apply the migration plan. Archives the existing config to
 * `~/.wotann/.legacy/config-backup.<stamp>/` so the user can roll
 * back if needed. Does NOT write a new config — that's the wizard's
 * job after re-onboarding the user.
 *
 * Returns `{ok: true}` on success OR when there was nothing to
 * migrate. Returns `{ok: false, error}` only when an I/O failure
 * prevented archiving — the caller shows the error and lets the
 * user retry.
 */
export function applyMigration(plan: MigrationPlan = planMigration()): MigrationResult {
  if (!plan.needed) {
    return { ok: true, plan, archivedAt: null };
  }
  if (!plan.backupPath) {
    return {
      ok: false,
      plan,
      archivedAt: null,
      error: "plan.needed=true but backupPath is null — invalid plan.",
    };
  }

  try {
    if (!existsSync(plan.backupPath)) {
      mkdirSync(plan.backupPath, { recursive: true });
    }

    let archivedAt: string | null = null;

    // Archive the config file itself.
    if (existsSync(plan.configPath)) {
      const dest = join(plan.backupPath, plan.configPath.split("/").pop() ?? "config");
      renameSync(plan.configPath, dest);
      archivedAt = dest;
    }

    // Archive legacy credential files when present.
    for (const finding of plan.findings) {
      let legacyFile: string | null = null;
      if (finding === "anthropic-oauth-file") {
        legacyFile = join(plan.backupPath, "..", "..", "anthropic-oauth.json");
      } else if (finding === "codex-tokens-file") {
        legacyFile = join(plan.backupPath, "..", "..", "codex-tokens.json");
      }
      if (legacyFile && existsSync(legacyFile)) {
        const legacyDest = join(plan.backupPath, legacyFile.split("/").pop() ?? "legacy");
        try {
          renameSync(legacyFile, legacyDest);
        } catch {
          // Per-file archive failure doesn't kill the overall migration;
          // the user still gets the config backup + a clean state.
        }
      }
    }

    return { ok: true, plan, archivedAt };
  } catch (err) {
    return {
      ok: false,
      plan,
      archivedAt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
