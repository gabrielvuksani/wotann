/**
 * Unified provider service — single source of truth for provider state.
 *
 * Handles credential detection, model discovery, login flows, and state
 * synchronisation across the daemon, desktop UI, and iOS companion. Replaces
 * the ad-hoc per-call probes that used to live inside the RPC handler.
 *
 * Architecture:
 *   - A static registry of PROVIDER_SPECS defines every supported provider
 *   - CredentialStore unifies env vars + ~/.wotann/providers.env + OAuth files
 *   - Per-provider `detect` and `listModels` functions encapsulate discovery
 *   - ProviderService caches discovery results with TTL and emits change events
 *   - Login dispatch picks the right flow (apiKey/oauth/subscription/cli) per provider
 *
 * This is the only module that should read provider env vars. Every other
 * consumer (adapters, router, UI) goes through the service.
 */

import { readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { withRetries, defaultRetryPolicy, type RetryPolicy } from "./retry-strategies.js";
import { CircuitBreaker, withBreaker } from "./circuit-breaker.js";
import { secureStoreSet, secureStoreGet, secureStoreDelete } from "../auth/secure-store.js";

// ── Types ──────────────────────────────────────────────────────

export type AuthMethod = "apiKey" | "oauth" | "subscription" | "cli" | "local";
export type ProviderTier = "frontier" | "fast" | "local" | "specialised" | "free";

export interface ProviderModel {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  /** USD per million input tokens. 0 = free (local or included). */
  readonly costPerMTokInput: number;
  /** USD per million output tokens. */
  readonly costPerMTokOutput: number;
  readonly supportsVision?: boolean;
  readonly supportsTools?: boolean;
  readonly supportsThinking?: boolean;
}

export interface ProviderCredential {
  readonly method: AuthMethod;
  /** Human-readable label for the active credential (e.g. "ChatGPT Plus", "API Key"). */
  readonly label: string;
  /** Opaque token material — never returned to UI in full. */
  readonly token?: string;
  /**
   * Where the credential was sourced from, for debugging.
   *
   * - "env"           — process.env (shell export, launchd, etc.)
   * - "providers.env" — ~/.wotann/providers.env file
   * - "oauth-file"    — third-party auth file (e.g. ~/.codex/auth.json)
   * - "cli"           — vendor CLI binary on PATH (no token visible)
   * - "stored-file"   — Wave 6-QQ file fallback at ~/.wotann/credentials.json
   * - "keychain"      — Wave 6-QQ OS keyring (macOS Keychain, libsecret,
   *                     or Credential Vault) when keytar succeeds
   */
  readonly source: "env" | "providers.env" | "oauth-file" | "cli" | "stored-file" | "keychain";
  /** Unix seconds when the credential expires, if applicable. */
  readonly expiresAt?: number;
}

export interface ProviderState {
  readonly id: string;
  readonly name: string;
  readonly tier: ProviderTier;
  readonly configured: boolean;
  readonly credential: ProviderCredential | null;
  readonly models: readonly ProviderModel[];
  readonly defaultModel: string | null;
  /** Unix ms when model list was last refreshed. */
  readonly lastRefreshedAt: number;
  /** Last discovery error message, if discovery failed. */
  readonly lastError?: string;
}

export interface ProviderSpec {
  readonly id: string;
  readonly name: string;
  readonly tier: ProviderTier;
  /** Env var names accepted for this provider, in priority order. */
  readonly envKeys: readonly string[];
  /** Auth methods supported by this provider, in priority order. */
  readonly supportedMethods: readonly AuthMethod[];
  /** Public docs URL (for UI "How to get a key" link). */
  readonly docsUrl?: string;
  /** OAuth-specific config if supportedMethods includes oauth. */
  readonly oauth?: {
    readonly authorizeUrl: string;
    readonly tokenUrl: string;
    readonly clientId: string;
    readonly scopes: readonly string[];
  };
  /** Built-in fallback model list, used when API discovery fails. */
  readonly fallbackModels: readonly ProviderModel[];
  /**
   * Detect whether this provider has usable credentials.
   * Returns null if not configured.
   */
  detectCredential(ctx: DetectContext): Promise<ProviderCredential | null>;
  /**
   * Fetch the live model list. Should return fallbackModels on API failure.
   */
  listModels(credential: ProviderCredential | null): Promise<readonly ProviderModel[]>;
}

export interface DetectContext {
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly storedCredentials: Readonly<Record<string, SavedCredential>>;
}

export interface SavedCredential {
  readonly method: AuthMethod;
  readonly token: string;
  readonly expiresAt?: number;
  readonly label?: string;
  readonly savedAt: number;
  /**
   * Wave 6-QQ — physical backend that produced the credential at load
   * time. Populated by `CredentialStore.load()` after consulting the
   * secure-store. NOT persisted (the OS keychain is the source of truth
   * on subsequent loads). Detect callsites use this to set the
   * `ProviderCredential.source` tag honestly ("keychain" vs "stored-file")
   * rather than the hardcoded "stored-file" Wave 3-P shipped.
   */
  readonly _storedAt?: "keychain" | "file";
}

// ── V9 Wave 6-MM — shared auth-expired error message ──────────

/**
 * Single source of truth for the user-facing "key expired mid-stream"
 * message. Adapters call this so the wording (and the `wotann login
 * <provider>` hint) stays identical across Anthropic, OpenAI-compat,
 * Gemini, Codex, Copilot, and any future stream provider.
 *
 * QB#6: clear, actionable error — never a cryptic "stream closed".
 */
export function authExpiredMessage(provider: string): string {
  return `Authentication expired. Re-authenticate with \`wotann login ${provider}\`.`;
}

// ── Credential Store ───────────────────────────────────────────

/**
 * Unified credential store.
 *
 * Wave 3-P (pre-6-QQ): wrote a flat `~/.wotann/credentials.json` file with
 * mode 0600 and labelled every cred `source: "stored-file"`.
 *
 * Wave 6-QQ: routes through `secureStoreSet/Get/Delete`, which prefer the
 * OS keyring (macOS Keychain / Linux libsecret / Windows Credential Vault)
 * via the optional `keytar` native dep, and fall back to the same
 * `~/.wotann/credentials.json` file when keytar is unavailable. The detect
 * callsites consult `_storedAt` on the returned `SavedCredential` to label
 * the `ProviderCredential.source` honestly ("keychain" vs "stored-file").
 *
 * Only the JSON envelope of a `SavedCredential` (method/token/label/
 * expiresAt/savedAt) goes into the keyring — one keyring entry per provider.
 *
 * Env vars still win over stored creds at the detect layer (callers honour
 * user intent when they explicitly export a key in their shell).
 *
 * Migration safety: a pre-Wave-6-QQ install wrote raw `SavedCredential`
 * objects (not JSON strings) into the file. `decodeLegacyEntry` accepts
 * both shapes so the upgrade is transparent.
 */
export class CredentialStore {
  private readonly path: string;
  private cache: Record<string, SavedCredential> | null = null;
  /**
   * Provider IDs known to live in the secure-store. Populated from the
   * legacy file scan AND every save(); drives the `load()` keychain
   * round-trip. Per-process state, never persisted (QB#7).
   */
  private knownAccounts: Set<string> = new Set();

  constructor(path?: string) {
    this.path = path ?? resolveWotannHomeSubdir("credentials.json");
  }

  /**
   * Load all known credentials. Asks `secureStoreGet` for every previously
   * seen account; falls back to whatever the legacy credentials.json file
   * holds so a fresh process bootstrapping after a Wave 3-P install still
   * finds its tokens.
   */
  async load(): Promise<Record<string, SavedCredential>> {
    if (this.cache) return this.cache;

    const merged: Record<string, SavedCredential> = {};

    // 1. Legacy file scan — surfaces any cred saved by a pre-Wave-6-QQ
    //    install. New writes also flow through the file backend when
    //    keytar is unavailable, so this is the always-correct floor.
    if (existsSync(this.path)) {
      try {
        const raw = readFileSync(this.path, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const [providerId, value] of Object.entries(parsed)) {
          const decoded = decodeLegacyEntry(value);
          if (decoded) {
            merged[providerId] = { ...decoded, _storedAt: "file" };
            this.knownAccounts.add(providerId);
          }
        }
      } catch {
        /* malformed legacy file — fall through to keychain probe */
      }
    }

    // 2. Keychain re-probe — for every known account, ask the secure
    //    store. If keytar has a value it WINS over the legacy file
    //    entry (new saves write keychain-first when available; the file
    //    copy may be stale).
    for (const account of this.knownAccounts) {
      try {
        const got = await secureStoreGet(account);
        if (got.password !== null && got.source === "keychain") {
          const envelope = decodeEnvelope(got.password);
          if (envelope) {
            merged[account] = { ...envelope, _storedAt: "keychain" };
          }
        }
      } catch {
        /* keychain miss — keep the file copy already in `merged` */
      }
    }

    this.cache = merged;
    return merged;
  }

  /**
   * Persist a credential. Routes through `secureStoreSet` which decides
   * keychain vs file at runtime. Updates the in-memory cache with the
   * physical backend that won so detect callsites read the truth.
   */
  async save(providerId: string, credential: SavedCredential): Promise<void> {
    const envelope = encodeEnvelope(credential);
    const result = await secureStoreSet(providerId, envelope);
    if (result.error) {
      // QB#6 honest fallback: log the keytar failure but continue — the
      // file backend already absorbed the write. Without this the user
      // would never know their install is missing libsecret.
      console.warn(
        `[providers] keychain unavailable for ${providerId}, fell back to file: ${result.error}`,
      );
    }
    const current = await this.load();
    this.cache = {
      ...current,
      [providerId]: { ...credential, _storedAt: result.stored },
    };
    this.knownAccounts.add(providerId);
  }

  /**
   * Remove a credential from BOTH backends. `secureStoreDelete` handles
   * the dual delete; we just refresh the in-memory cache.
   */
  async delete(providerId: string): Promise<void> {
    await secureStoreDelete(providerId);
    const current = await this.load();
    const { [providerId]: _removed, ...rest } = current;
    this.cache = rest;
    this.knownAccounts.delete(providerId);
  }

  async get(providerId: string): Promise<SavedCredential | undefined> {
    return (await this.load())[providerId];
  }

  /**
   * Synchronous cache peek for hot-path callers that need the last-known
   * credential without awaiting (e.g. `getAlternateCredential` runs inside
   * a sync re-auth callback). Returns undefined when the cache is unwarmed
   * — caller must have already triggered an async `load()` once.
   */
  peekCache(providerId: string): SavedCredential | undefined {
    return this.cache?.[providerId];
  }

  async all(): Promise<Readonly<Record<string, SavedCredential>>> {
    return this.load();
  }

  /** Drop the in-memory cache so the next `load()` re-probes the backends. */
  invalidate(): void {
    this.cache = null;
  }
}

/**
 * Wrap a `SavedCredential` for storage in a single keyring entry.
 * Strips the transient `_storedAt` marker (which describes WHERE the
 * credential lives, not WHAT it is). Round-trips cleanly through
 * `getPassword(service, account)` / `setPassword(service, account, value)`.
 */
function encodeEnvelope(cred: SavedCredential): string {
  const { _storedAt: _ignored, ...rest } = cred;
  void _ignored; // explicit no-op so TS strict-unused doesn't complain
  return JSON.stringify(rest);
}

/** Inverse of `encodeEnvelope`. */
function decodeEnvelope(raw: string): SavedCredential | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validateSavedCredential(parsed);
  } catch {
    return null;
  }
}

/**
 * Decode a legacy `~/.wotann/credentials.json` entry. Pre-Wave-6-QQ that
 * file held `Record<providerId, SavedCredential>` (object value); the
 * Wave-6-QQ file fallback writes JSON-string envelopes via
 * `secureStoreSet`. Accept both for migration safety.
 */
function decodeLegacyEntry(value: unknown): SavedCredential | null {
  if (typeof value === "string") return decodeEnvelope(value);
  return validateSavedCredential(value);
}

function validateSavedCredential(value: unknown): SavedCredential | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj["method"] !== "string") return null;
  if (typeof obj["token"] !== "string") return null;
  if (typeof obj["savedAt"] !== "number") return null;
  return {
    method: obj["method"] as AuthMethod,
    token: obj["token"],
    savedAt: obj["savedAt"],
    ...(typeof obj["expiresAt"] === "number" ? { expiresAt: obj["expiresAt"] } : {}),
    ...(typeof obj["label"] === "string" ? { label: obj["label"] } : {}),
  };
}

// ── providers.env loader ───────────────────────────────────────

/**
 * Load ~/.wotann/providers.env key=value lines into the returned record.
 * Does NOT mutate process.env — callers can merge if they want.
 */
export function loadProvidersEnvFile(path?: string): Record<string, string> {
  const resolved = path ?? resolveWotannHomeSubdir("providers.env");
  if (!existsSync(resolved)) return {};
  try {
    const raw = readFileSync(resolved, "utf-8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1]!;
      let value = match[2] ?? "";
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Write a single key to ~/.wotann/providers.env, preserving other lines
 * and comments. Atomic — writes to temp + rename.
 */
export function writeProvidersEnvKey(key: string, value: string, path?: string): void {
  const resolved = path ?? resolveWotannHomeSubdir("providers.env");
  const dir = join(resolved, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let existing = "";
  if (existsSync(resolved)) {
    try {
      existing = readFileSync(resolved, "utf-8");
    } catch {
      existing = "";
    }
  }
  const lines = existing.split(/\r?\n/);
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`);
  let replaced = false;
  const newLines = lines.map((line) => {
    if (keyPattern.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) newLines.push(`${key}=${value}`);
  // Strip trailing empties
  while (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
  // Wave 6.5-UU (H-22) — refresh tokens are Tier-1: a half-written
  // providers.env loses credentials. writeFileAtomic uses tmp + fsync +
  // rename so a crash mid-write leaves the previous file intact.
  writeFileAtomic(resolved, newLines.join("\n") + "\n", { mode: 0o600 });
  try {
    chmodSync(resolved, 0o600);
  } catch {
    /* best effort — chmod again post-rename in case mode arg was lost */
  }
}

/**
 * Delete a key from ~/.wotann/providers.env.
 */
export function deleteProvidersEnvKey(key: string, path?: string): void {
  const resolved = path ?? resolveWotannHomeSubdir("providers.env");
  if (!existsSync(resolved)) return;
  const existing = readFileSync(resolved, "utf-8");
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`);
  const lines = existing.split(/\r?\n/).filter((line) => !keyPattern.test(line));
  // Wave 6.5-UU (H-22) — credential file integrity. writeFileAtomic
  // ensures partial writes can't strand the file in a half-deleted state.
  writeFileAtomic(resolved, lines.join("\n"), { mode: 0o600 });
  try {
    chmodSync(resolved, 0o600);
  } catch {
    /* best effort */
  }
}

// ── Helpers ────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 5000,
): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}

function pickEnv(
  keys: readonly string[],
  env: Readonly<NodeJS.ProcessEnv>,
): { key: string; value: string } | null {
  for (const key of keys) {
    const v = env[key];
    if (v && v.trim().length > 0) return { key, value: v };
  }
  return null;
}

// ── Built-in Provider Specs ────────────────────────────────────

// Wave DH-1: scoped per-provider model id consts. Each provider in this
// file's PROVIDER_SPECS table owns its own namespace; pinning the canonical
// ids here keeps future model bumps to a 1-line change. Other provider
// modules (anthropic-adapter, claude-cli-backend, copilot-adapter, discovery)
// declare their own copies of the relevant Anthropic ids — there's no
// cross-module sharing because each module owns its slice of the namespace
// (QB#7 — no module-globals across provider boundaries).
const ANTHROPIC_OPUS = "claude-opus-4-7";
const ANTHROPIC_SONNET = "claude-sonnet-4-7";
const ANTHROPIC_HAIKU = "claude-haiku-4-5-20251001";

const ANTHROPIC_FALLBACK: readonly ProviderModel[] = [
  {
    id: ANTHROPIC_OPUS,
    name: "Claude Opus 4.7",
    contextWindow: 200_000,
    costPerMTokInput: 15,
    costPerMTokOutput: 75,
    supportsVision: true,
    supportsTools: true,
    supportsThinking: true,
  },
  {
    id: ANTHROPIC_SONNET,
    name: "Claude Sonnet 4.7",
    contextWindow: 200_000,
    costPerMTokInput: 3,
    costPerMTokOutput: 15,
    supportsVision: true,
    supportsTools: true,
    supportsThinking: true,
  },
  {
    id: ANTHROPIC_HAIKU,
    name: "Claude Haiku 4.5",
    contextWindow: 200_000,
    costPerMTokInput: 0.25,
    costPerMTokOutput: 1.25,
    supportsVision: true,
    supportsTools: true,
  },
];

const anthropicSpec: ProviderSpec = {
  id: "anthropic",
  name: "Anthropic",
  tier: "frontier",
  envKeys: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
  supportedMethods: ["apiKey", "oauth", "subscription", "cli"],
  docsUrl: "https://console.anthropic.com/settings/keys",
  fallbackModels: ANTHROPIC_FALLBACK,
  async detectCredential(ctx) {
    // 1. API key from env (highest priority)
    const env = pickEnv(["ANTHROPIC_API_KEY"], ctx.env);
    if (env) return { method: "apiKey", label: "API Key", token: env.value, source: "env" };
    // 2. Claude Code OAuth token
    const oauth = pickEnv(["CLAUDE_CODE_OAUTH_TOKEN"], ctx.env);
    if (oauth)
      return { method: "oauth", label: "Claude Code OAuth", token: oauth.value, source: "env" };
    // 3. Saved credential (via Sign in with Claude Max)
    const saved = ctx.storedCredentials["anthropic"];
    if (saved)
      return {
        method: saved.method,
        label: saved.label ?? "Claude Max",
        token: saved.token,
        source: saved._storedAt === "keychain" ? "keychain" : "stored-file",
        expiresAt: saved.expiresAt,
      };
    // Legacy oauth-file path removed per V9 T0.1 (WOTANN no longer writes
    // its own copy of the Claude subscription token). Detection falls
    // through to Claude CLI presence.
    // 4. Claude CLI detection (last resort — no token, just presence)
    try {
      execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 2000 });
      return { method: "cli", label: "Claude CLI", source: "cli" };
    } catch {
      /* claude CLI not installed */
    }
    return null;
  },
  async listModels(credential) {
    if (credential?.method === "apiKey" && credential.token) {
      const res = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": credential.token, "anthropic-version": "2023-06-01" },
      });
      if (res?.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
        const models = (data.data ?? []).map((m) => ({
          id: m.id,
          name: m.display_name ?? m.id,
          contextWindow: 200_000,
          costPerMTokInput: 3,
          costPerMTokOutput: 15,
          supportsVision: true,
          supportsTools: true,
          supportsThinking: m.id.includes("opus") || m.id.includes("sonnet"),
        }));
        if (models.length > 0) return models;
      }
    }
    return ANTHROPIC_FALLBACK;
  },
};

const openaiSpec: ProviderSpec = {
  id: "openai",
  name: "OpenAI",
  tier: "frontier",
  envKeys: ["OPENAI_API_KEY"],
  supportedMethods: ["apiKey"],
  docsUrl: "https://platform.openai.com/api-keys",
  fallbackModels: [
    {
      id: "gpt-5",
      name: "GPT-5",
      contextWindow: 400_000,
      costPerMTokInput: 5,
      costPerMTokOutput: 15,
      supportsVision: true,
      supportsTools: true,
      supportsThinking: true,
    },
    {
      id: "o4-mini",
      name: "o4-mini",
      contextWindow: 128_000,
      costPerMTokInput: 3,
      costPerMTokOutput: 12,
      supportsThinking: true,
      supportsTools: true,
    },
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      contextWindow: 1_000_000,
      costPerMTokInput: 2,
      costPerMTokOutput: 8,
      supportsVision: true,
      supportsTools: true,
    },
  ],
  async detectCredential(ctx) {
    const env = pickEnv(this.envKeys, ctx.env);
    if (env) return { method: "apiKey", label: "API Key", token: env.value, source: "env" };
    const saved = ctx.storedCredentials["openai"];
    if (saved)
      return {
        method: saved.method,
        label: saved.label ?? "API Key",
        token: saved.token,
        source: saved._storedAt === "keychain" ? "keychain" : "stored-file",
      };
    return null;
  },
  async listModels(credential) {
    if (credential?.token) {
      const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${credential.token}` },
      });
      if (res?.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        const chatModels = (data.data ?? []).filter(
          (m) =>
            m.id.includes("gpt") ||
            m.id.startsWith("o3") ||
            m.id.startsWith("o4") ||
            m.id.startsWith("o5"),
        );
        const models = chatModels.map((m) => ({
          id: m.id,
          name: m.id,
          contextWindow: m.id.includes("gpt-4.1") ? 1_000_000 : 128_000,
          costPerMTokInput: 2,
          costPerMTokOutput: 8,
          supportsVision: true,
          supportsTools: true,
          supportsThinking: m.id.startsWith("o") || m.id.includes("thinking"),
        }));
        if (models.length > 0) return models;
      }
    }
    return this.fallbackModels;
  },
};

const codexSpec: ProviderSpec = {
  id: "codex",
  name: "ChatGPT (Codex)",
  tier: "frontier",
  envKeys: ["CODEX_API_KEY"],
  supportedMethods: ["subscription", "apiKey", "oauth"],
  docsUrl: "https://chatgpt.com/codex",
  fallbackModels: [
    {
      id: "gpt-5-codex",
      name: "GPT-5 Codex",
      contextWindow: 200_000,
      costPerMTokInput: 0,
      costPerMTokOutput: 0,
      supportsTools: true,
    },
    {
      id: "gpt-5.4",
      name: "GPT-5.4",
      contextWindow: 1_000_000,
      costPerMTokInput: 0,
      costPerMTokOutput: 0,
      supportsTools: true,
      supportsThinking: true,
    },
    {
      id: "o4-mini",
      name: "o4-mini",
      contextWindow: 200_000,
      costPerMTokInput: 0,
      costPerMTokOutput: 0,
      supportsThinking: true,
    },
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      contextWindow: 1_000_000,
      costPerMTokInput: 0,
      costPerMTokOutput: 0,
      supportsTools: true,
    },
  ],
  async detectCredential(ctx) {
    const env = pickEnv(["CODEX_API_KEY"], ctx.env);
    if (env) return { method: "apiKey", label: "API Key", token: env.value, source: "env" };
    const authPath = join(homedir(), ".codex", "auth.json");
    if (existsSync(authPath)) {
      try {
        const data = JSON.parse(readFileSync(authPath, "utf-8")) as {
          tokens?: { id_token?: string; access_token?: string };
        };
        const token = data.tokens?.id_token ?? data.tokens?.access_token;
        if (token)
          return { method: "subscription", label: "ChatGPT Plus/Pro", token, source: "oauth-file" };
      } catch {
        /* malformed auth.json */
      }
    }
    return null;
  },
  async listModels(credential) {
    if (credential?.method === "subscription" && credential.token) {
      // Decode the plan type from the JWT payload (no signature verify here — that's
      // done elsewhere before the credential is accepted into the store)
      try {
        const parts = credential.token.split(".");
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8")) as {
            "https://api.openai.com/auth"?: { chatgpt_plan_type?: string };
          };
          const plan = payload["https://api.openai.com/auth"]?.chatgpt_plan_type ?? "free";
          const freeModels = codexSpec.fallbackModels.filter(
            (m) => m.id.includes("mini") || m.id.includes("nano"),
          );
          if (plan === "free")
            return freeModels.length > 0 ? freeModels : codexSpec.fallbackModels.slice(0, 2);
        }
      } catch {
        /* payload decode failed */
      }
    }
    return codexSpec.fallbackModels;
  },
};

const geminiSpec: ProviderSpec = {
  id: "gemini",
  name: "Google Gemini",
  tier: "frontier",
  envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  supportedMethods: ["apiKey"],
  docsUrl: "https://aistudio.google.com/apikey",
  fallbackModels: [
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      contextWindow: 2_000_000,
      costPerMTokInput: 1.25,
      costPerMTokOutput: 5,
      supportsVision: true,
      supportsTools: true,
      supportsThinking: true,
    },
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      contextWindow: 1_000_000,
      costPerMTokInput: 0.3,
      costPerMTokOutput: 1.2,
      supportsVision: true,
      supportsTools: true,
    },
  ],
  async detectCredential(ctx) {
    const env = pickEnv(this.envKeys, ctx.env);
    if (env) return { method: "apiKey", label: "API Key", token: env.value, source: "env" };
    const saved = ctx.storedCredentials["gemini"];
    if (saved)
      return {
        method: "apiKey",
        label: "API Key",
        token: saved.token,
        source: saved._storedAt === "keychain" ? "keychain" : "stored-file",
      };
    return null;
  },
  async listModels(credential) {
    if (credential?.token) {
      const res = await fetchWithTimeout(
        "https://generativelanguage.googleapis.com/v1beta/models",
        { headers: { "x-goog-api-key": credential.token } },
      );
      if (res?.ok) {
        const data = (await res.json()) as {
          models?: Array<{ name: string; displayName?: string; inputTokenLimit?: number }>;
        };
        const models = (data.models ?? [])
          .filter((m) => m.name.includes("gemini"))
          .map((m) => ({
            id: m.name.replace("models/", ""),
            name: m.displayName ?? m.name,
            contextWindow: m.inputTokenLimit ?? 1_000_000,
            costPerMTokInput: 0.5,
            costPerMTokOutput: 1.5,
            supportsVision: true,
            supportsTools: true,
          }));
        if (models.length > 0) return models;
      }
    }
    return this.fallbackModels;
  },
};

const ollamaSpec: ProviderSpec = {
  id: "ollama",
  name: "Ollama (Local)",
  tier: "local",
  envKeys: ["OLLAMA_HOST", "OLLAMA_URL"],
  supportedMethods: ["local"],
  fallbackModels: [],
  async detectCredential(ctx) {
    const host = ctx.env["OLLAMA_HOST"] ?? ctx.env["OLLAMA_URL"] ?? "http://localhost:11434";
    const res = await fetchWithTimeout(`${host}/api/tags`, {}, 2000);
    if (res?.ok) return { method: "local", label: "Local daemon", source: "env" };
    return null;
  },
  async listModels(_credential) {
    const host =
      process.env["OLLAMA_HOST"] ?? process.env["OLLAMA_URL"] ?? "http://localhost:11434";
    const res = await fetchWithTimeout(`${host}/api/tags`, {}, 3000);
    if (!res?.ok) return [];
    try {
      const data = (await res.json()) as {
        models?: Array<{ name: string; details?: { parameter_size?: string } }>;
      };
      return (data.models ?? []).map((m) => ({
        id: m.name,
        name: m.name.replace(":latest", ""),
        contextWindow: 128_000,
        costPerMTokInput: 0,
        costPerMTokOutput: 0,
        supportsTools: true,
      }));
    } catch {
      return [];
    }
  },
};

const groqSpec: ProviderSpec = {
  id: "groq",
  name: "Groq",
  tier: "fast",
  envKeys: ["GROQ_API_KEY"],
  supportedMethods: ["apiKey"],
  docsUrl: "https://console.groq.com/keys",
  fallbackModels: [
    {
      id: "llama-3.3-70b-versatile",
      name: "Llama 3.3 70B",
      contextWindow: 128_000,
      costPerMTokInput: 0.59,
      costPerMTokOutput: 0.79,
      supportsTools: true,
    },
  ],
  async detectCredential(ctx) {
    const env = pickEnv(this.envKeys, ctx.env);
    if (env) return { method: "apiKey", label: "API Key", token: env.value, source: "env" };
    const saved = ctx.storedCredentials["groq"];
    if (saved)
      return {
        method: "apiKey",
        label: "API Key",
        token: saved.token,
        source: saved._storedAt === "keychain" ? "keychain" : "stored-file",
      };
    return null;
  },
  async listModels(credential) {
    if (credential?.token) {
      const res = await fetchWithTimeout("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${credential.token}` },
      });
      if (res?.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        return (data.data ?? []).map((m) => ({
          id: m.id,
          name: m.id,
          contextWindow: 128_000,
          costPerMTokInput: 0.5,
          costPerMTokOutput: 0.5,
          supportsTools: true,
        }));
      }
    }
    return this.fallbackModels;
  },
};

// Generic OpenAI-compatible provider factory used by Mistral / DeepSeek / xAI / Perplexity /
// Together / Fireworks / SambaNova / OpenRouter / Cerebras / HuggingFace.
function openAICompatSpec(args: {
  id: string;
  name: string;
  tier: ProviderTier;
  envKeys: readonly string[];
  baseUrl: string;
  fallback: readonly ProviderModel[];
  docsUrl?: string;
}): ProviderSpec {
  const docsUrlEntry: Pick<ProviderSpec, "docsUrl"> = args.docsUrl ? { docsUrl: args.docsUrl } : {};
  return {
    id: args.id,
    name: args.name,
    tier: args.tier,
    envKeys: args.envKeys,
    supportedMethods: ["apiKey"],
    ...docsUrlEntry,
    fallbackModels: args.fallback,
    async detectCredential(ctx) {
      const env = pickEnv(args.envKeys, ctx.env);
      if (env) return { method: "apiKey", label: "API Key", token: env.value, source: "env" };
      const saved = ctx.storedCredentials[args.id];
      if (saved)
        return {
          method: "apiKey",
          label: "API Key",
          token: saved.token,
          source: saved._storedAt === "keychain" ? "keychain" : "stored-file",
        };
      return null;
    },
    async listModels(credential) {
      if (credential?.token) {
        const res = await fetchWithTimeout(`${args.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${credential.token}` },
        });
        if (res?.ok) {
          const data = (await res.json()) as { data?: Array<{ id: string; name?: string }> };
          const models = (data.data ?? []).map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            contextWindow: 128_000,
            costPerMTokInput: 1,
            costPerMTokOutput: 3,
            supportsTools: true,
          }));
          if (models.length > 0) return models;
        }
      }
      return args.fallback;
    },
  };
}

const copilotSpec: ProviderSpec = {
  id: "copilot",
  name: "GitHub Copilot",
  tier: "frontier",
  envKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
  supportedMethods: ["oauth", "apiKey"],
  docsUrl: "https://github.com/settings/tokens",
  fallbackModels: [
    {
      id: "copilot-gpt-4.1",
      name: "GPT-4.1 (Copilot)",
      contextWindow: 128_000,
      costPerMTokInput: 0,
      costPerMTokOutput: 0,
      supportsTools: true,
    },
    {
      id: "copilot-claude-sonnet",
      name: "Claude Sonnet (Copilot)",
      contextWindow: 200_000,
      costPerMTokInput: 0,
      costPerMTokOutput: 0,
      supportsTools: true,
    },
  ],
  async detectCredential(ctx) {
    const env = pickEnv(this.envKeys, ctx.env);
    if (env) return { method: "apiKey", label: "GitHub PAT", token: env.value, source: "env" };
    const saved = ctx.storedCredentials["copilot"];
    if (saved)
      return {
        method: saved.method,
        label: saved.label ?? "GitHub Copilot",
        token: saved.token,
        source: saved._storedAt === "keychain" ? "keychain" : "stored-file",
      };
    return null;
  },
  async listModels(credential) {
    if (credential?.token) {
      const tokenRes = await fetchWithTimeout("https://api.github.com/copilot_internal/v2/token", {
        headers: { Authorization: `token ${credential.token}` },
      });
      if (tokenRes?.ok) {
        const tokenData = (await tokenRes.json()) as {
          token?: string;
          endpoints?: { api?: string };
        };
        const copilotToken = tokenData.token;
        const apiBase = tokenData.endpoints?.api ?? "https://api.githubcopilot.com";
        if (copilotToken) {
          const modelsRes = await fetchWithTimeout(`${apiBase}/models`, {
            headers: { Authorization: `Bearer ${copilotToken}` },
          });
          if (modelsRes?.ok) {
            const modelsData = (await modelsRes.json()) as {
              data?: Array<{ id: string; name?: string }>;
            };
            const models = (modelsData.data ?? []).map((m) => ({
              id: m.id,
              name: m.name ?? m.id,
              contextWindow: 128_000,
              costPerMTokInput: 0,
              costPerMTokOutput: 0,
              supportsTools: true,
            }));
            if (models.length > 0) return models;
          }
        }
      }
    }
    return this.fallbackModels;
  },
};

export const PROVIDER_SPECS: readonly ProviderSpec[] = [
  anthropicSpec,
  openaiSpec,
  codexSpec,
  geminiSpec,
  ollamaSpec,
  groqSpec,
  copilotSpec,
  openAICompatSpec({
    id: "mistral",
    name: "Mistral",
    tier: "frontier",
    envKeys: ["MISTRAL_API_KEY"],
    baseUrl: "https://api.mistral.ai/v1",
    docsUrl: "https://console.mistral.ai/api-keys",
    fallback: [
      {
        id: "mistral-large-latest",
        name: "Mistral Large",
        contextWindow: 128_000,
        costPerMTokInput: 2,
        costPerMTokOutput: 6,
        supportsTools: true,
      },
      {
        id: "codestral-latest",
        name: "Codestral",
        contextWindow: 128_000,
        costPerMTokInput: 0.3,
        costPerMTokOutput: 0.9,
        supportsTools: true,
      },
    ],
  }),
  openAICompatSpec({
    id: "deepseek",
    name: "DeepSeek",
    tier: "fast",
    envKeys: ["DEEPSEEK_API_KEY"],
    baseUrl: "https://api.deepseek.com",
    docsUrl: "https://platform.deepseek.com/api_keys",
    fallback: [
      {
        id: "deepseek-chat",
        name: "DeepSeek V3",
        contextWindow: 64_000,
        costPerMTokInput: 0.27,
        costPerMTokOutput: 1.1,
        supportsTools: true,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek R1",
        contextWindow: 64_000,
        costPerMTokInput: 0.55,
        costPerMTokOutput: 2.19,
        supportsThinking: true,
      },
    ],
  }),
  openAICompatSpec({
    id: "perplexity",
    name: "Perplexity",
    tier: "specialised",
    envKeys: ["PERPLEXITY_API_KEY"],
    baseUrl: "https://api.perplexity.ai",
    docsUrl: "https://www.perplexity.ai/settings/api",
    fallback: [
      {
        id: "sonar-pro",
        name: "Sonar Pro",
        contextWindow: 128_000,
        costPerMTokInput: 3,
        costPerMTokOutput: 15,
      },
    ],
  }),
  openAICompatSpec({
    id: "xai",
    name: "xAI (Grok)",
    tier: "frontier",
    envKeys: ["XAI_API_KEY"],
    baseUrl: "https://api.x.ai/v1",
    docsUrl: "https://console.x.ai/",
    fallback: [
      {
        id: "grok-4-0709",
        name: "Grok 4",
        contextWindow: 256_000,
        costPerMTokInput: 3,
        costPerMTokOutput: 15,
        supportsVision: true,
        supportsTools: true,
      },
      {
        id: "grok-code-fast-1",
        name: "Grok Code Fast",
        contextWindow: 128_000,
        costPerMTokInput: 0.2,
        costPerMTokOutput: 1.5,
      },
    ],
  }),
  openAICompatSpec({
    id: "together",
    name: "Together AI",
    tier: "fast",
    envKeys: ["TOGETHER_API_KEY"],
    baseUrl: "https://api.together.xyz/v1",
    docsUrl: "https://api.together.xyz/settings/api-keys",
    fallback: [
      {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        name: "Llama 3.3 70B Turbo",
        contextWindow: 131_072,
        costPerMTokInput: 0.88,
        costPerMTokOutput: 0.88,
        supportsTools: true,
      },
    ],
  }),
  openAICompatSpec({
    id: "fireworks",
    name: "Fireworks AI",
    tier: "fast",
    envKeys: ["FIREWORKS_API_KEY"],
    baseUrl: "https://api.fireworks.ai/inference/v1",
    docsUrl: "https://fireworks.ai/account/api-keys",
    fallback: [
      {
        id: "accounts/fireworks/models/llama-v3p3-70b-instruct",
        name: "Llama 3.3 70B",
        contextWindow: 131_072,
        costPerMTokInput: 0.9,
        costPerMTokOutput: 0.9,
        supportsTools: true,
      },
    ],
  }),
  openAICompatSpec({
    id: "sambanova",
    name: "SambaNova",
    tier: "fast",
    envKeys: ["SAMBANOVA_API_KEY"],
    baseUrl: "https://api.sambanova.ai/v1",
    docsUrl: "https://cloud.sambanova.ai/apis",
    fallback: [
      {
        id: "Meta-Llama-3.3-70B-Instruct",
        name: "Llama 3.3 70B",
        contextWindow: 131_072,
        costPerMTokInput: 0.6,
        costPerMTokOutput: 1.2,
        supportsTools: true,
      },
    ],
  }),
  openAICompatSpec({
    id: "openrouter",
    name: "OpenRouter",
    tier: "specialised",
    envKeys: ["OPENROUTER_API_KEY"],
    baseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/keys",
    fallback: [],
  }),
  openAICompatSpec({
    id: "cerebras",
    name: "Cerebras",
    tier: "fast",
    envKeys: ["CEREBRAS_API_KEY"],
    baseUrl: "https://api.cerebras.ai/v1",
    docsUrl: "https://cloud.cerebras.ai/",
    fallback: [
      {
        id: "llama-3.3-70b",
        name: "Llama 3.3 70B (Cerebras)",
        contextWindow: 128_000,
        costPerMTokInput: 0.6,
        costPerMTokOutput: 0.6,
        supportsTools: true,
      },
    ],
  }),
  openAICompatSpec({
    id: "huggingface",
    name: "Hugging Face",
    tier: "specialised",
    envKeys: ["HF_TOKEN", "HUGGINGFACE_API_KEY", "HUGGING_FACE_HUB_TOKEN"],
    baseUrl: "https://api-inference.huggingface.co/v1",
    docsUrl: "https://huggingface.co/settings/tokens",
    fallback: [],
  }),
];

// ── ProviderService ────────────────────────────────────────────

/**
 * Events emitted by the ProviderService:
 *
 *   - "changed"        — any provider state changed
 *   - "credential"     — a credential was added/updated/removed
 *   - "activeChanged"  — the active provider+model changed
 *   - "refreshed"      — a discovery pass completed
 */
export type ProviderEvent =
  | "changed"
  | "credential"
  | "activeChanged"
  | "refreshed"
  | "credentialExpired";

export interface ProviderSnapshot {
  readonly providers: readonly ProviderState[];
  readonly active: { provider: string; model: string } | null;
  readonly lastRefreshedAt: number;
}

export class ProviderService extends EventEmitter {
  private readonly store: CredentialStore;
  private readonly specs: ReadonlyMap<string, ProviderSpec>;
  private states: Map<string, ProviderState> = new Map();
  private lastRefreshedAt = 0;
  private refreshing: Promise<void> | null = null;
  private active: { provider: string; model: string } | null = null;
  /** TTL for cached discovery results — forced refresh returns earlier. */
  private readonly cacheTtlMs: number;

  // ── Phase 13 Wave 3B: per-provider circuit breaker + retry policy.
  // Each provider has its own breaker (opens on 10 rolling failures in
  // a 60s window) so a single flaky provider cannot poison the rest.
  // testCredential() dispatches through withBreaker + withRetries so
  // transient 429/5xx/network errors get exponential backoff rather
  // than fail-fast back to the UI.
  private readonly breakers: Map<string, CircuitBreaker> = new Map();
  private readonly retryPolicy: RetryPolicy;

  // ── V9 Wave 6-MM: per-session expired-token tracker.
  //
  // When a provider stream returns 401 mid-flight (key rotated /
  // revoked / expired in-flight), the adapter calls
  // `markCredentialExpired(providerId, token)` and we remember the
  // token here so the next `detectCredential` pass can refuse to
  // re-emit it without a manual re-login. Cleared by
  // `clearExpiredCredential` after a successful save / delete.
  //
  // QB#7: per-instance Map (NOT module-global) so parallel
  // ProviderService instances in tests don't bleed expired state.
  private readonly expiredTokens: Map<string, Set<string>> = new Map();

  constructor(options: { cacheTtlMs?: number; credentialStorePath?: string } = {}) {
    super();
    this.store = new CredentialStore(options.credentialStorePath);
    this.specs = new Map(PROVIDER_SPECS.map((s) => [s.id, s]));
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.retryPolicy = defaultRetryPolicy({ maxAttempts: 3 });
  }

  /**
   * Phase 13 Wave 3B: Get (or lazily create) the per-provider circuit
   * breaker. Opens on 10 rolling failures within a 60s window, so one
   * misbehaving provider doesn't block retries on the others.
   */
  private getBreaker(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker({ minRequests: 10, failureThreshold: 0.5 });
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  /** Phase 13 Wave 3B: introspect breaker state (for diagnostics). */
  getBreakerState(providerId: string): "closed" | "open" | "half-open" | "unknown" {
    const breaker = this.breakers.get(providerId);
    return breaker?.getState() ?? "unknown";
  }

  /** Available providers (even those not configured). */
  knownProviderIds(): readonly string[] {
    return [...this.specs.keys()];
  }

  getSpec(id: string): ProviderSpec | undefined {
    return this.specs.get(id);
  }

  /**
   * Return the current snapshot. If the cache is older than `cacheTtlMs`
   * or `force` is true, triggers a refresh first.
   */
  async getSnapshot(options: { force?: boolean } = {}): Promise<ProviderSnapshot> {
    const stale = Date.now() - this.lastRefreshedAt > this.cacheTtlMs;
    if (options.force || stale || this.states.size === 0) {
      await this.refresh();
    }
    return this.currentSnapshot();
  }

  /** Snapshot without refreshing — for hot-path callers that need speed. */
  currentSnapshot(): ProviderSnapshot {
    return {
      providers: [...this.states.values()].sort((a, b) => a.name.localeCompare(b.name)),
      active: this.active,
      lastRefreshedAt: this.lastRefreshedAt,
    };
  }

  /** Re-discover all providers concurrently. Safe to call repeatedly. */
  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async doRefresh(): Promise<void> {
    // Merge ~/.wotann/providers.env into process.env so user-saved keys are
    // picked up without a daemon restart. We do NOT overwrite env vars that
    // are already set — explicit shell exports always win.
    const fileEnv = loadProvidersEnvFile();
    for (const [key, value] of Object.entries(fileEnv)) {
      if (!process.env[key]) process.env[key] = value;
    }

    const storedCredentials = await this.store.all();
    const ctx: DetectContext = { env: process.env, storedCredentials };

    const tasks = [...this.specs.values()].map(async (spec) => {
      try {
        const credential = await spec.detectCredential(ctx);
        const models = credential ? await spec.listModels(credential) : [];
        const defaultModel = models[0]?.id ?? null;
        const state: ProviderState = {
          id: spec.id,
          name: spec.name,
          tier: spec.tier,
          configured: credential !== null,
          credential,
          models,
          defaultModel,
          lastRefreshedAt: Date.now(),
        };
        this.states.set(spec.id, state);
      } catch (err) {
        const prev = this.states.get(spec.id);
        const errState: ProviderState = {
          id: spec.id,
          name: spec.name,
          tier: spec.tier,
          configured: false,
          credential: null,
          models: prev?.models ?? spec.fallbackModels,
          defaultModel: prev?.defaultModel ?? spec.fallbackModels[0]?.id ?? null,
          lastRefreshedAt: Date.now(),
          lastError: err instanceof Error ? err.message : String(err),
        };
        this.states.set(spec.id, errState);
      }
    });

    await Promise.all(tasks);
    this.lastRefreshedAt = Date.now();
    this.emit("refreshed");
    this.emit("changed");
  }

  /** Save an API key (or OAuth access token) for a provider. */
  async saveCredential(
    providerId: string,
    params: {
      method: AuthMethod;
      token: string;
      expiresAt?: number;
      label?: string;
    },
  ): Promise<ProviderState | null> {
    const spec = this.specs.get(providerId);
    if (!spec) throw new Error(`Unknown provider: ${providerId}`);
    if (!spec.supportedMethods.includes(params.method)) {
      throw new Error(`${spec.name} does not support ${params.method}`);
    }

    const cred: SavedCredential = {
      method: params.method,
      token: params.token,
      ...(params.expiresAt !== undefined ? { expiresAt: params.expiresAt } : {}),
      ...(params.label !== undefined ? { label: params.label } : {}),
      savedAt: Date.now(),
    };
    await this.store.save(providerId, cred);

    // For API keys, also mirror into providers.env so shell / launchd can see it
    if (params.method === "apiKey") {
      const primaryEnvKey = spec.envKeys[0];
      if (primaryEnvKey) {
        try {
          writeProvidersEnvKey(primaryEnvKey, params.token);
          process.env[primaryEnvKey] = params.token;
        } catch (err) {
          // Non-fatal — credential is stored in credentials.json regardless.

          console.warn(
            `[providers] providers.env write failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // V9 Wave 6-MM: a fresh save means the user re-authenticated, so
    // any token previously flagged as expired by markCredentialExpired
    // is no longer guaranteed to be the same as the new one. Clear the
    // expired set entirely — if the new token coincidentally matches a
    // formerly-expired one, the next live request will tell us.
    this.expiredTokens.delete(providerId);

    this.emit("credential", { providerId, action: "save" });
    await this.refresh();
    return this.states.get(providerId) ?? null;
  }

  /** Remove credentials for a provider. Clears providers.env mirror, keychain, and file entry. */
  async deleteCredential(providerId: string): Promise<void> {
    const spec = this.specs.get(providerId);
    if (!spec) throw new Error(`Unknown provider: ${providerId}`);
    await this.store.delete(providerId);
    for (const key of spec.envKeys) {
      try {
        deleteProvidersEnvKey(key);
        delete process.env[key];
      } catch {
        /* best effort */
      }
    }
    // V9 Wave 6-MM: drop the expired-token set when credentials are
    // deleted — there's nothing left to compare against.
    this.expiredTokens.delete(providerId);
    this.emit("credential", { providerId, action: "delete" });
    await this.refresh();
  }

  /**
   * V9 Wave 6-MM — mid-stream 401 hook.
   *
   * Called by adapters when a streaming request returns 401 (key
   * rotated, revoked, or expired in-flight). The token is remembered
   * for this process so subsequent calls to `getCurrentCredential` and
   * `getAlternateCredential` can refuse to re-emit it without a manual
   * re-login.
   *
   * The credential's stored row is NOT deleted automatically — the
   * user may have multiple keys for the same provider (env + stored,
   * or a fallback shell export). Deletion is reserved for explicit
   * `deleteCredential` calls so a transient 401 (e.g. clock skew on
   * an OAuth check) can recover when the user re-runs `wotann login`.
   *
   * QB#6: emits `credentialExpired` so the UI can surface a clear
   * "Re-authenticate via wotann login {provider}" prompt instead of
   * burying the failure inside a stream error.
   *
   * @param providerId provider id (e.g. "anthropic", "openai", "groq")
   * @param token the bearer that 401'd; pass empty string when unknown
   * @returns true if the provider exists; false otherwise
   */
  markCredentialExpired(providerId: string, token: string): boolean {
    const spec = this.specs.get(providerId);
    if (!spec) return false;
    const set = this.expiredTokens.get(providerId) ?? new Set<string>();
    if (token) set.add(token);
    this.expiredTokens.set(providerId, set);
    this.emit("credentialExpired", { providerId, hadToken: !!token });
    this.emit("changed");
    return true;
  }

  /** True if the given token has been flagged as expired this process. */
  isCredentialExpired(providerId: string, token: string): boolean {
    if (!token) return false;
    const set = this.expiredTokens.get(providerId);
    return !!set?.has(token);
  }

  /** Drop the expired flag for a provider — used after a successful re-login. */
  clearExpiredCredential(providerId: string): void {
    this.expiredTokens.delete(providerId);
  }

  /**
   * V9 Wave 6-MM — basic key rotation.
   *
   * Returns an alternate credential for the provider when one exists
   * and `WOTANN_KEY_ROTATION=1` is set. The current implementation
   * walks the spec's env keys (the priority list provider-service
   * already maintains) plus the stored-file token, returning the first
   * usable token whose value differs from `currentToken` and which has
   * NOT been marked expired this process. When rotation is disabled or
   * no alternate exists, returns null and the caller surfaces the
   * standard "auth_expired" error.
   *
   * Opt-in by env (off by default — explicit, per the task brief): if
   * `WOTANN_KEY_ROTATION` is unset, falsy, or `0`, this returns null
   * even when alternates exist.
   *
   * @param providerId provider id
   * @param currentToken token that just 401'd; excluded from results
   * @param env env snapshot (defaults to process.env, override for tests)
   */
  getAlternateCredential(
    providerId: string,
    currentToken: string,
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): { token: string; source: "env" | "stored-file" | "keychain" } | null {
    const flag = env["WOTANN_KEY_ROTATION"];
    if (flag !== "1") return null;
    const spec = this.specs.get(providerId);
    if (!spec) return null;

    // Walk env keys first — explicit shell exports win in this codebase.
    for (const envKey of spec.envKeys) {
      const value = env[envKey];
      if (!value) continue;
      if (value === currentToken) continue;
      if (this.isCredentialExpired(providerId, value)) continue;
      return { token: value, source: "env" };
    }

    // Fall through to the stored credential when env didn't yield an alt.
    // peekCache() is sync — getAlternateCredential is called from sync
    // re-auth callbacks inside provider adapters. The cache is warmed by
    // doRefresh() at startup, so a miss here means rotation simply
    // returns null (the same outcome as Wave 3-P).
    const stored = this.store.peekCache(providerId);
    if (stored?.token && stored.token !== currentToken) {
      if (!this.isCredentialExpired(providerId, stored.token)) {
        const source = stored._storedAt === "keychain" ? "keychain" : "stored-file";
        return { token: stored.token, source };
      }
    }

    return null;
  }

  /** Ping the provider's API with the current credential to validate. */
  async testCredential(
    providerId: string,
  ): Promise<{ ok: boolean; error?: string; modelCount?: number }> {
    const spec = this.specs.get(providerId);
    if (!spec) return { ok: false, error: `Unknown provider: ${providerId}` };
    const state = this.states.get(providerId);
    if (!state?.credential) return { ok: false, error: "Not configured" };
    // Phase 13 Wave 3B: wrap the call in circuit-breaker + retry policy.
    // Breaker fails fast when a provider has been down — no thundering
    // herd. Retry absorbs transient 429/5xx/network errors with
    // exponential backoff. Honest bubble-up on persistent failure.
    const breaker = this.getBreaker(providerId);
    const credential = state.credential;
    try {
      const outcome = await withRetries(
        () => withBreaker(() => spec.listModels(credential), breaker),
        { policy: this.retryPolicy, maxAttempts: 3 },
      );
      return { ok: outcome.result.length > 0, modelCount: outcome.result.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Validate and set the active provider+model. Throws on invalid combos. */
  setActive(providerId: string, modelId: string): void {
    const state = this.states.get(providerId);
    if (!state) throw new Error(`Unknown provider: ${providerId}`);
    if (!state.configured) throw new Error(`${state.name} is not configured`);
    const model = state.models.find((m) => m.id === modelId);
    if (!model) throw new Error(`Model ${modelId} not available on ${state.name}`);
    this.active = { provider: providerId, model: modelId };
    this.emit("activeChanged", this.active);
    this.emit("changed");
  }

  getActive(): { provider: string; model: string } | null {
    return this.active;
  }

  /**
   * Import credentials from a discovered auth file path (e.g. ~/.codex/auth.json).
   * This is a convenience for "Found existing ChatGPT Plus login — tap to import".
   */
  async importFromPath(providerId: string, path: string): Promise<ProviderState | null> {
    const spec = this.specs.get(providerId);
    if (!spec) throw new Error(`Unknown provider: ${providerId}`);
    if (!existsSync(path)) throw new Error(`File not found: ${path}`);
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    // Codex auth.json shape
    if (providerId === "codex") {
      const tokens = data["tokens"] as { id_token?: string; access_token?: string } | undefined;
      const token = tokens?.id_token ?? tokens?.access_token;
      if (token)
        return this.saveCredential("codex", {
          method: "subscription",
          token,
          label: "ChatGPT (imported)",
        });
    }
    // Generic: look for access_token or api_key
    const token =
      (data["access_token"] as string | undefined) ?? (data["api_key"] as string | undefined);
    if (token)
      return this.saveCredential(providerId, { method: "apiKey", token, label: "Imported" });
    throw new Error(`Could not extract credential from ${path}`);
  }
}

// ── Singleton instance (process-wide) ──────────────────────────

let SINGLETON: ProviderService | null = null;

export function getProviderService(): ProviderService {
  if (!SINGLETON) SINGLETON = new ProviderService();
  return SINGLETON;
}

export function resetProviderService(): void {
  SINGLETON = null;
}
