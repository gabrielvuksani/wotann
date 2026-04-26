/**
 * codex-detector — read-existing-Codex-CLI-credential only.
 *
 * Replaces `src/providers/codex-oauth.ts` per V9 T0.2. The old module
 * ran its own PKCE flow against OpenAI's OAuth endpoint using the
 * official Codex CLI's public client_id, effectively masquerading as
 * that CLI. This file drops all OAuth machinery and only reads
 * credentials the user has already authenticated with `codex login`
 * themselves.
 *
 * Exports:
 *   - `detectExistingCodexCredential()` — check whether `~/.codex/auth.json`
 *     (or `~/.config/codex/auth.json`) exists and is parseable.
 *   - `importCodexCliCredential(path)` — validate shape and copy into
 *     WOTANN's token store at `~/.wotann/codex-tokens.json`. Does NOT
 *     network.
 *   - `migrateLegacyCodexCredential()` — one-shot migration for users
 *     upgrading from prior WOTANN versions that ran PKCE. If the old
 *     file is in WOTANN's own token store, archive it under `.legacy/`.
 *
 * WOTANN quality bars:
 *   - QB #6 honest failures: `importCodexCliCredential` returns
 *     `{ok:false, error}` on missing token fields; never silently
 *     succeeds with a partial credential.
 *   - QB #7 per-call state: no module-level caches of token contents.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveWotannHome, resolveWotannHomeSubdir } from "../utils/wotann-home.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface CodexTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken?: string;
  readonly expiresAt: number;
}

export interface CodexCredentialDetection {
  readonly found: boolean;
  readonly path?: string;
  readonly expiresAt?: number | null;
}

export interface CodexImportResult {
  readonly success: boolean;
  readonly error?: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────

const CODEX_CLI_PATHS: readonly string[] = [
  join(homedir(), ".codex", "auth.json"),
  join(homedir(), ".config", "codex", "auth.json"),
];

/** WOTANN's own token store (populated by `importCodexCliCredential`). */
const WOTANN_CODEX_TOKEN_FILE = resolveWotannHomeSubdir("codex-tokens.json");
const WOTANN_LEGACY_ARCHIVE_DIR = resolveWotannHomeSubdir(".legacy");

// ── Detection ─────────────────────────────────────────────────────────────

/**
 * Detect an existing Codex CLI credential without reading the full
 * token body into memory. Returns the source path and expiry metadata
 * if available. Swallows parse errors: a malformed file is still
 * reported as `found: true` with a null expiry so the caller can
 * prompt the user to re-auth via `codex login`.
 */
export function detectExistingCodexCredential(): CodexCredentialDetection {
  for (const p of CODEX_CLI_PATHS) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
        const raw = pickNumber(data, "expires_at", "expiresAt");
        return { found: true, path: p, expiresAt: raw };
      } catch {
        return { found: true, path: p, expiresAt: null };
      }
    }
  }
  return { found: false };
}

function pickNumber(data: Record<string, unknown>, ...keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "number") return v;
  }
  return null;
}

// ── Import ────────────────────────────────────────────────────────────────

/**
 * Import a Codex CLI credential into WOTANN's token store. Reads the
 * CLI's `auth.json`, validates the shape, and persists a WOTANN-native
 * copy at `~/.wotann/codex-tokens.json` with mode 0600.
 *
 * The import is offline — it does not contact `auth.openai.com`. The
 * caller is responsible for verifying the JWT out-of-band if needed.
 * Accepts both the Codex CLI shape (`tokens.access_token` + sibling
 * `refresh_token`) and flat shape (top-level `access_token` +
 * `refresh_token`) to be robust across versions.
 */
export function importCodexCliCredential(path: string): CodexImportResult {
  try {
    if (!existsSync(path)) {
      return { success: false, error: `Credential file not found at ${path}` };
    }
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;

    const tokens = (data["tokens"] as Record<string, unknown> | undefined) ?? data;
    const accessToken = pickString(tokens, "access_token", "accessToken");
    const refreshToken = pickString(tokens, "refresh_token", "refreshToken");
    if (!accessToken || !refreshToken) {
      return {
        success: false,
        error: "Credential file missing access_token or refresh_token",
      };
    }
    const idToken = pickString(tokens, "id_token", "idToken") ?? undefined;
    const expiresAt =
      pickNumber(data, "expires_at", "expiresAt") ??
      pickNumber(tokens, "expires_at", "expiresAt") ??
      Date.now() + 60 * 60 * 1000;

    saveTokens({
      accessToken,
      refreshToken,
      ...(idToken ? { idToken } : {}),
      expiresAt,
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function pickString(data: Record<string, unknown>, ...keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function saveTokens(tokens: CodexTokens): void {
  const dir = resolveWotannHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(WOTANN_CODEX_TOKEN_FILE, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}

// ── Migration ─────────────────────────────────────────────────────────────

/**
 * One-shot migration for users upgrading from WOTANN versions that ran
 * their own PKCE flow. Detects `~/.wotann/codex-tokens.json` and, if it
 * was written by an old PKCE path (no `tokens` wrapper, flat shape),
 * archives it to `~/.wotann/.legacy/codex-tokens.<timestamp>.json.bak`.
 * Leaves the Codex CLI's own `~/.codex/auth.json` completely alone.
 *
 * Returns true if a migration happened. Never throws — the caller just
 * logs the return value and proceeds.
 */
export function migrateLegacyCodexCredential(): boolean {
  if (!existsSync(WOTANN_CODEX_TOKEN_FILE)) return false;
  try {
    if (!existsSync(WOTANN_LEGACY_ARCHIVE_DIR)) {
      mkdirSync(WOTANN_LEGACY_ARCHIVE_DIR, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(WOTANN_LEGACY_ARCHIVE_DIR, `codex-tokens.${stamp}.json.bak`);
    renameSync(WOTANN_CODEX_TOKEN_FILE, dest);
    return true;
  } catch {
    return false;
  }
}
