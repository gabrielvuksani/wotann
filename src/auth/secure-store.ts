/**
 * Wave 6-QQ — Linux/macOS/Windows secure-store with file fallback.
 *
 * H-K1 fix: prefers `@napi-rs/keyring` (current, MIT, last published 2026)
 * over `keytar` (archived 2022-12-15) for fresh installs. Both are kept as
 * optionalDependencies so existing installs continue to work and the
 * Linux-without-libsecret path still degrades gracefully.
 *
 * Resolution order on each call:
 *   1. @napi-rs/keyring (current, native, sync API wrapped in Promise)
 *   2. keytar (legacy fallback for environments where @napi-rs/keyring's
 *      prebuilt binary doesn't ship; Node 16-18 on some musl/Alpine images)
 *   3. file fallback at `~/.wotann/credentials.json` with mode 0600
 *
 * Design notes:
 *   - Dynamic `import()` so the optionalDeps stay truly optional.
 *   - Per-process state — no module-global cache (QB#7).
 *   - File fallback uses the SAME `~/.wotann/credentials.json` path so the
 *     existing `CredentialStore` data survives the migration.
 *   - Honest fallback chain (QB#6): keyring → keytar → file → failure result.
 *   - QB#15: APIs source-verified:
 *       @napi-rs/keyring  https://github.com/Brooooooklyn/keyring-node
 *         new Entry(service, account)
 *         entry.setPassword(p) / entry.getPassword() / entry.deletePassword()
 *       keytar           https://github.com/atom/node-keytar
 *         getPassword/setPassword/deletePassword(service, account, ...)
 */

import { readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { writeFileAtomic } from "./../utils/atomic-io.js";
import { join } from "node:path";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

/** Service identifier used when talking to the OS keyring. */
const KEYTAR_SERVICE = "wotann";

/** Tag describing where a credential physically lives. */
export type SecureStoreSource = "keychain" | "file";

/** Minimal slice of the keytar surface we depend on. */
interface KeytarApi {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * H-K1 fix: prefer @napi-rs/keyring (current MIT package, last released 2026)
 * by adapting its `Entry`-class API to the same KeytarApi shape consumed
 * downstream. Falls through to legacy keytar when @napi-rs/keyring isn't
 * available on this platform.
 *
 * Per-call resolution (no caching) so install/uninstall mid-session is
 * observable. Dynamic-import overhead is irrelevant next to OS keychain IPC.
 */
async function loadKeyringApi(): Promise<KeytarApi | null> {
  // 1. @napi-rs/keyring (preferred). Class-based sync API; we wrap in
  //    Promise so callers stay async-uniform.
  try {
    const moduleId = "@napi-rs/keyring";
    type EntryCtor = new (
      service: string,
      account: string,
    ) => {
      setPassword: (p: string) => void;
      getPassword: () => string | null;
      deletePassword: () => boolean;
    };
    const mod = (await import(moduleId)) as { Entry?: EntryCtor; default?: { Entry?: EntryCtor } };
    const Entry = mod.Entry ?? mod.default?.Entry;
    if (typeof Entry === "function") {
      return {
        async getPassword(service, account) {
          try {
            return new Entry(service, account).getPassword();
          } catch {
            return null;
          }
        },
        async setPassword(service, account, password) {
          new Entry(service, account).setPassword(password);
        },
        async deletePassword(service, account) {
          try {
            return new Entry(service, account).deletePassword();
          } catch {
            return false;
          }
        },
      };
    }
  } catch {
    // @napi-rs/keyring not installed or failed to load — fall through.
  }

  // 2. Legacy keytar (archived 2022-12-15 — kept for backwards compat).
  try {
    const moduleId = "keytar";
    const mod = (await import(moduleId)) as unknown as KeytarApi & {
      default?: KeytarApi;
    };
    const api = (mod.default ?? mod) as KeytarApi;
    if (
      typeof api.getPassword !== "function" ||
      typeof api.setPassword !== "function" ||
      typeof api.deletePassword !== "function"
    ) {
      return null;
    }
    return api;
  } catch {
    return null;
  }
}

/** Backwards-compat alias — keep the name external callers may still use. */
async function loadKeytar(): Promise<KeytarApi | null> {
  return loadKeyringApi();
}

// ── File-fallback store ────────────────────────────────────────

interface FileStoreShape {
  [account: string]: string;
}

function fallbackFilePath(): string {
  return resolveWotannHomeSubdir("credentials.json");
}

function readFileStore(path: string): FileStoreShape {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Each value MUST be a string for secureStoreGet to round-trip. The
      // existing CredentialStore wrote SavedCredential objects under the
      // same path; we coerce by JSON-stringifying anything non-string so
      // the legacy shape stays readable through this module.
      const out: FileStoreShape = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeFileStore(path: string, data: FileStoreShape): void {
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Wave 6.5-UU (H-22) — secure store holds OAuth/API credentials.
  // writeFileAtomic prevents a crash mid-write from truncating the
  // credential file (which would lock the user out of every provider).
  writeFileAtomic(path, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort on FSes without chmod (e.g. Windows FAT). */
  }
}

// ── Public API ─────────────────────────────────────────────────

export interface SecureStoreSetResult {
  /** Where the credential ended up. */
  readonly stored: SecureStoreSource;
  /** Populated when keytar was tried and failed (informational only). */
  readonly error?: string;
}

export interface SecureStoreGetResult {
  /** The decrypted password, or null when not found in either backend. */
  readonly password: string | null;
  /** Backend that produced the value (or "file" when both backends miss). */
  readonly source: SecureStoreSource;
}

/**
 * Persist a credential. Tries keytar first; on any failure falls back to
 * the file store. Returns which backend was used and (for diagnostics)
 * the keytar error message when the fallback fired.
 */
export async function secureStoreSet(
  account: string,
  password: string,
): Promise<SecureStoreSetResult> {
  if (!account) throw new Error("secureStoreSet: account must be non-empty");
  if (typeof password !== "string") {
    throw new Error("secureStoreSet: password must be a string");
  }

  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, account, password);
      return { stored: "keychain" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return writeFallback(account, password, message);
    }
  }
  return writeFallback(account, password);
}

function writeFallback(account: string, password: string, error?: string): SecureStoreSetResult {
  const path = fallbackFilePath();
  const current = readFileStore(path);
  writeFileStore(path, { ...current, [account]: password });
  return error ? { stored: "file", error } : { stored: "file" };
}

/**
 * Read a credential. Tries keytar first; on miss or failure consults the
 * file store. Returns `{ password: null, source: "file" }` when neither
 * backend has it (file is the fallback default — caller decides what to do).
 */
export async function secureStoreGet(account: string): Promise<SecureStoreGetResult> {
  if (!account) throw new Error("secureStoreGet: account must be non-empty");

  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const value = await keytar.getPassword(KEYTAR_SERVICE, account);
      if (value !== null && value !== undefined) {
        return { password: value, source: "keychain" };
      }
      // keytar returned null → not in keychain, fall through to file
    } catch {
      // keytar threw — fall through to file. We don't surface the error
      // here because GET is hot-path; SET surfaces it instead.
    }
  }

  const fileStore = readFileStore(fallbackFilePath());
  const fileValue = fileStore[account];
  return {
    password: fileValue ?? null,
    source: "file",
  };
}

/**
 * Remove a credential from BOTH backends (keychain + file). Returns true
 * if at least one backend reported a deletion. Best-effort — never throws.
 */
export async function secureStoreDelete(account: string): Promise<boolean> {
  if (!account) throw new Error("secureStoreDelete: account must be non-empty");

  let removed = false;

  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const ok = await keytar.deletePassword(KEYTAR_SERVICE, account);
      if (ok) removed = true;
    } catch {
      /* keytar miss / unavailable — still try the file store. */
    }
  }

  const path = fallbackFilePath();
  if (existsSync(path)) {
    const current = readFileStore(path);
    if (Object.prototype.hasOwnProperty.call(current, account)) {
      const { [account]: _gone, ...rest } = current;
      writeFileStore(path, rest);
      removed = true;
    }
  }

  return removed;
}

/**
 * Test-only escape hatch: synchronously detect whether keytar would load
 * in this process. Useful for diagnostics ("Why did Wave 6-QQ fall back to
 * file?"). Async because the underlying loader is async.
 */
export async function secureStoreBackendAvailable(): Promise<SecureStoreSource> {
  const keytar = await loadKeytar();
  return keytar ? "keychain" : "file";
}
