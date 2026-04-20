/**
 * Peer-Tool Auth Sidecar — three-way OAuth refresh-token coexistence.
 *
 * Lets WOTANN share OAuth refresh tokens with peer CLI tools (Claude Code,
 * Codex CLI, Gemini CLI) via their on-disk credential files. Without this,
 * three tools racing to refresh the same single-use refresh_token produce
 * "refresh_token_reused" errors and lock each other out.
 *
 * Pattern ported from hermes-agent credential_pool.py:
 *   - `_sync_anthropic_entry_from_credentials_file()` (L423-L458)
 *   - `_sync_codex_entry_from_cli()`                   (L460-L491)
 *   - `_sync_device_code_entry_to_auth_store()`        (L493-L600)
 *
 * Security invariants:
 *   - Token values NEVER leave this module in events, logs, or errors.
 *   - The sidecar emits structured `SidecarEvent` entries with opaque
 *     handles (keyId/path) only. Callers can drain for telemetry.
 *   - File reads that fail (missing, unparsable, permission-denied) are
 *     treated as "peer has nothing to share" — returned as `false`, not
 *     thrown. This is defensive because the peer file is not ours.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderName } from "../core/types.js";
import type { CredentialPool } from "./credential-pool.js";

// ── Peer credential file shape (common normalized form) ────────────
/**
 * Normalized cross-tool credential representation. Each peer adapter
 * below maps from its tool-specific on-disk schema to this common form.
 */
export interface PeerCredentialFile {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
}

export interface SidecarEvent {
  readonly at: number;
  readonly provider: ProviderName;
  readonly keyId: string;
  readonly kind:
    | "sync_from_peer_ok"
    | "sync_from_peer_miss"
    | "sync_from_peer_invalid"
    | "write_to_peer_ok"
    | "write_to_peer_error";
  readonly path?: string; // The peer file path (NOT the token).
}

export interface PeerToolAuthOptions {
  /** Path to Claude Code's credentials file. Defaults to ~/.claude/credentials.json. */
  readonly anthropicCredentialsPath?: string;
  /** Path to Codex CLI's auth file. Defaults to ~/.codex/auth.json. */
  readonly codexAuthPath?: string;
  /** Max events retained for drainEvents() (bounded memory). */
  readonly maxEventBuffer?: number;
}

const DEFAULT_CLAUDE_CREDENTIALS = join(homedir(), ".claude", "credentials.json");
const DEFAULT_CODEX_AUTH = join(homedir(), ".codex", "auth.json");
const DEFAULT_MAX_EVENT_BUFFER = 128;

// ── Per-tool on-disk adapters (map tool schema -> normalized) ───────

interface ClaudeCodeFileShape {
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
}

interface CodexAuthFileShape {
  readonly tokens?: {
    readonly access_token?: string;
    readonly refresh_token?: string;
    readonly id_token?: string;
    readonly expires_at?: number;
  };
}

function readClaudeCodeFile(path: string): PeerCredentialFile | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as ClaudeCodeFileShape;
    if (typeof parsed.accessToken !== "string") return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function readCodexAuthFile(path: string): PeerCredentialFile | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as CodexAuthFileShape;
    const tokens = parsed.tokens;
    if (!tokens || typeof tokens.access_token !== "string") return null;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_at,
    };
  } catch {
    return null;
  }
}

function writeClaudeCodeFile(path: string, cred: PeerCredentialFile): void {
  const payload: ClaudeCodeFileShape = {
    accessToken: cred.accessToken,
    refreshToken: cred.refreshToken,
    expiresAt: cred.expiresAt,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function writeCodexAuthFile(path: string, cred: PeerCredentialFile): void {
  // Preserve any existing fields (id_token, account info) — only replace tokens.
  let existing: Record<string, unknown> = {};
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf-8");
      existing = JSON.parse(raw) as Record<string, unknown>;
    }
  } catch {
    existing = {};
  }
  const existingTokens = (existing.tokens as Record<string, unknown> | undefined) ?? {};
  const updated = {
    ...existing,
    tokens: {
      ...existingTokens,
      access_token: cred.accessToken,
      refresh_token: cred.refreshToken,
      expires_at: cred.expiresAt,
    },
  };
  writeFileSync(path, JSON.stringify(updated, null, 2), { mode: 0o600 });
}

// ── Sidecar ─────────────────────────────────────────────────────────

export class PeerToolAuthSidecar {
  private readonly pool: CredentialPool;
  private readonly anthropicPath: string;
  private readonly codexPath: string;
  private readonly events: SidecarEvent[] = [];
  private readonly maxEventBuffer: number;

  constructor(pool: CredentialPool, options: PeerToolAuthOptions = {}) {
    this.pool = pool;
    this.anthropicPath = options.anthropicCredentialsPath ?? DEFAULT_CLAUDE_CREDENTIALS;
    this.codexPath = options.codexAuthPath ?? DEFAULT_CODEX_AUTH;
    this.maxEventBuffer = options.maxEventBuffer ?? DEFAULT_MAX_EVENT_BUFFER;
  }

  /**
   * Read the peer tool's credential file and, when it holds a DIFFERENT
   * (freshly refreshed) token pair, adopt it into the pool for `keyId`.
   *
   * Returns:
   *   true  — a sync happened (pool entry was replaced with peer's fresh pair)
   *   false — peer file missing / unparsable / already in sync
   *
   * SECURITY: Never throws for read-side failures; a missing/invalid peer
   * file is "they don't have anything to share" — we return false and log
   * an opaque event with the path only (no token).
   */
  syncFromPeer(provider: ProviderName, keyId: string): boolean {
    const peerFile = this.readPeerFor(provider);
    if (!peerFile) {
      this.recordEvent({
        at: Date.now(),
        provider,
        keyId,
        kind: "sync_from_peer_miss",
        path: this.pathFor(provider),
      });
      return false;
    }

    const accountPool = this.pool.getPool();
    const current = accountPool.getAccounts(provider).find((a) => a.id === keyId);
    if (!current) {
      this.recordEvent({
        at: Date.now(),
        provider,
        keyId,
        kind: "sync_from_peer_invalid",
        path: this.pathFor(provider),
      });
      return false;
    }

    if (current.token === peerFile.accessToken) {
      // Already in sync — nothing to do.
      this.recordEvent({
        at: Date.now(),
        provider,
        keyId,
        kind: "sync_from_peer_miss",
        path: this.pathFor(provider),
      });
      return false;
    }

    // Replace the account's token (AccountCredential is immutable — re-add).
    accountPool.removeAccount(keyId);
    accountPool.addAccount({
      id: keyId,
      provider,
      token: peerFile.accessToken,
      type: current.type,
      priority: current.priority,
      label: current.label,
    });

    this.recordEvent({
      at: Date.now(),
      provider,
      keyId,
      kind: "sync_from_peer_ok",
      path: this.pathFor(provider),
    });
    return true;
  }

  /**
   * Write our freshly refreshed token back to the peer tool's credential
   * file so subsequent peer-tool requests see a valid token (avoids the
   * "refresh_token_reused" cascade).
   *
   * Best-effort: permission errors are logged as events but do not throw,
   * because the peer file is not ours and a write-failure should not abort
   * the primary refresh path.
   */
  writeRefreshedToPeer(provider: ProviderName, cred: PeerCredentialFile): void {
    const path = this.pathFor(provider);
    try {
      if (provider === "anthropic") {
        writeClaudeCodeFile(path, cred);
      } else if (provider === "codex") {
        writeCodexAuthFile(path, cred);
      } else {
        // Unknown peer target — skip; callers shouldn't invoke this for
        // non-peer providers (OpenAI, Gemini via API key, etc).
        return;
      }
      this.recordEvent({
        at: Date.now(),
        provider,
        keyId: "peer-write",
        kind: "write_to_peer_ok",
        path,
      });
    } catch {
      this.recordEvent({
        at: Date.now(),
        provider,
        keyId: "peer-write",
        kind: "write_to_peer_error",
        path,
      });
    }
  }

  /**
   * Drain and reset the event buffer. Events carry ONLY opaque handles —
   * no tokens, no refresh_tokens, no secret material.
   */
  drainEvents(): readonly SidecarEvent[] {
    const copy = [...this.events];
    this.events.length = 0;
    return copy;
  }

  // ── Private helpers ─────────────────────────────────────────────

  private readPeerFor(provider: ProviderName): PeerCredentialFile | null {
    if (provider === "anthropic") return readClaudeCodeFile(this.anthropicPath);
    if (provider === "codex") return readCodexAuthFile(this.codexPath);
    return null;
  }

  private pathFor(provider: ProviderName): string {
    if (provider === "anthropic") return this.anthropicPath;
    if (provider === "codex") return this.codexPath;
    return "";
  }

  private recordEvent(event: SidecarEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEventBuffer) {
      // Drop oldest to cap memory.
      this.events.splice(0, this.events.length - this.maxEventBuffer);
    }
  }
}
