/**
 * PeerToolAuthSidecar tests — refresh lifecycle + three-way sync guarantees.
 *
 * The sidecar lets WOTANN share OAuth refresh tokens with peer CLI tools
 * (Claude Code, Codex CLI) via their on-disk credential files. When a peer
 * tool refreshes, we detect the new pair, adopt it into the CredentialPool,
 * and propagate our own refreshes back to the peer file so neither side
 * hits "refresh_token_reused" errors.
 *
 * References Hermes `_sync_anthropic_entry_from_credentials_file()` (L423),
 * `_sync_codex_entry_from_cli()` (L460), `_sync_device_code_entry_to_auth_store()`
 * (L493) in agent/credential_pool.py.
 *
 * Tests use a temp dir (no real home dir writes).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PeerToolAuthSidecar,
  type PeerCredentialFile,
} from "../../src/providers/peer-tool-auth.js";
import { CredentialPool } from "../../src/providers/credential-pool.js";
import { AccountPool } from "../../src/providers/account-pool.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wotann-peer-auth-"));
}

describe("PeerToolAuthSidecar — refresh lifecycle", () => {
  let tmp: string;
  let claudePath: string;
  let codexPath: string;

  beforeEach(() => {
    tmp = makeTempDir();
    claudePath = join(tmp, "claude-credentials.json");
    codexPath = join(tmp, "codex-auth.json");
  });

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("adopts a refreshed token from peer credential file when stale", () => {
    // Peer file contains the fresh token pair; our pool entry is stale.
    const peerPayload: PeerCredentialFile = {
      accessToken: "sk-ant-FRESH-access",
      refreshToken: "r-ant-FRESH-refresh",
      expiresAt: Date.now() + 3_600_000,
    };
    writeFileSync(claudePath, JSON.stringify(peerPayload));

    const pool = new CredentialPool(new AccountPool());
    pool.getPool().addAccount({
      id: "ant-oauth",
      provider: "anthropic",
      token: "sk-ant-STALE-access",
      type: "oauth",
      priority: 1,
      label: "peer:claude-code",
    });

    const sidecar = new PeerToolAuthSidecar(pool, {
      anthropicCredentialsPath: claudePath,
      codexAuthPath: codexPath,
    });

    const synced = sidecar.syncFromPeer("anthropic", "ant-oauth");
    expect(synced).toBe(true);

    // Pool entry should now carry the fresh token.
    const current = pool.getPool().getAccounts("anthropic").find((a) => a.id === "ant-oauth");
    expect(current).toBeDefined();
    expect(current!.token).toBe("sk-ant-FRESH-access");
  });

  it("does NOT overwrite when peer file is missing (no-op)", () => {
    const pool = new CredentialPool(new AccountPool());
    pool.getPool().addAccount({
      id: "ant-oauth",
      provider: "anthropic",
      token: "sk-ant-current",
      type: "oauth",
      priority: 1,
      label: "peer:claude-code",
    });
    const sidecar = new PeerToolAuthSidecar(pool, {
      anthropicCredentialsPath: claudePath, // not written
      codexAuthPath: codexPath,
    });

    const result = sidecar.syncFromPeer("anthropic", "ant-oauth");
    expect(result).toBe(false);

    const current = pool.getPool().getAccounts("anthropic").find((a) => a.id === "ant-oauth");
    expect(current!.token).toBe("sk-ant-current"); // unchanged
  });

  it("writes a refreshed pool token back to the peer file (three-way sync)", () => {
    const pool = new CredentialPool(new AccountPool());
    pool.getPool().addAccount({
      id: "codex-oauth",
      provider: "codex",
      token: "dummy",
      type: "oauth",
      priority: 1,
      label: "peer:codex-cli",
    });
    // Seed the peer codex file with old-ish content so we can detect the write.
    const codexBefore = {
      tokens: {
        access_token: "old-access",
        refresh_token: "old-refresh",
        id_token: "old-id",
      },
    };
    writeFileSync(codexPath, JSON.stringify(codexBefore));

    const sidecar = new PeerToolAuthSidecar(pool, {
      anthropicCredentialsPath: claudePath,
      codexAuthPath: codexPath,
    });

    sidecar.writeRefreshedToPeer("codex", {
      accessToken: "NEW-access",
      refreshToken: "NEW-refresh",
      expiresAt: Date.now() + 3_600_000,
    });

    const raw = readFileSync(codexPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.tokens.access_token).toBe("NEW-access");
    expect(parsed.tokens.refresh_token).toBe("NEW-refresh");
  });

  it("handles malformed peer file gracefully (returns false, no throw)", () => {
    writeFileSync(claudePath, "{ not-valid-json");
    const pool = new CredentialPool(new AccountPool());
    pool.getPool().addAccount({
      id: "ant-oauth",
      provider: "anthropic",
      token: "existing",
      type: "oauth",
      priority: 1,
      label: "peer:claude-code",
    });
    const sidecar = new PeerToolAuthSidecar(pool, {
      anthropicCredentialsPath: claudePath,
      codexAuthPath: codexPath,
    });

    let caught: unknown = null;
    let result = true as boolean | undefined;
    try {
      result = sidecar.syncFromPeer("anthropic", "ant-oauth");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeNull();
    expect(result).toBe(false);
  });

  it("never logs or includes token material in sync results (security)", () => {
    const secret = "sk-ant-DO-NOT-LEAK-12345";
    const peerPayload: PeerCredentialFile = {
      accessToken: secret,
      refreshToken: "r-secret",
      expiresAt: Date.now() + 3_600_000,
    };
    writeFileSync(claudePath, JSON.stringify(peerPayload));

    const pool = new CredentialPool(new AccountPool());
    pool.getPool().addAccount({
      id: "ant-oauth",
      provider: "anthropic",
      token: "sk-ant-OLD",
      type: "oauth",
      priority: 1,
      label: "peer:claude-code",
    });
    const sidecar = new PeerToolAuthSidecar(pool, {
      anthropicCredentialsPath: claudePath,
      codexAuthPath: codexPath,
    });

    const events = sidecar.drainEvents(); // should be clean before we sync
    expect(events).toHaveLength(0);

    sidecar.syncFromPeer("anthropic", "ant-oauth");

    const afterEvents = sidecar.drainEvents();
    // Event logs MUST NOT contain the secret token.
    const joined = JSON.stringify(afterEvents);
    expect(joined).not.toContain(secret);
    expect(joined).not.toContain("r-secret");
    // But events SHOULD exist and carry opaque handles.
    expect(afterEvents.length).toBeGreaterThan(0);
  });
});
