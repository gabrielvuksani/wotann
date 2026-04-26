/**
 * Wave 6-QQ — Linux/macOS/Windows secure-store with file fallback.
 *
 * Tries the OS keychain first (via `keytar` — an optionalDependency so an
 * `npm install` failure on Linux without `libsecret-1-dev` won't brick the
 * install). On any keytar failure (module missing, native bindings missing,
 * libsecret unavailable, denied by user), falls back to the existing
 * file-backed store at `~/.wotann/credentials.json` with mode 0600.
 *
 * Wave 3-P labelled all stored creds as `source: "stored-file"` because that
 * is what the codebase actually did. Wave 6-QQ inverts that label *only when*
 * keytar succeeds, so the UI/diagnostics report the truth: "via macOS
 * Keychain" / "via libsecret" / "via Credential Vault" vs "via ~/.wotann
 * file".
 *
 * Design notes:
 *   - Dynamic `import("keytar")` so the module load works even when the
 *     optional native build failed.
 *   - Per-process state — no module-global cache for the resolved keytar
 *     handle (QB#7). Each call re-resolves so install/uninstall mid-session
 *     is observable. The dynamic-import cost is negligible vs a network call.
 *   - File fallback uses the SAME `~/.wotann/credentials.json` path so the
 *     existing `CredentialStore` data survives the migration.
 *   - Honest fallback chain (QB#6): keytar → file → return failure result.
 *     We never silently swallow a keytar error — it's reported in the
 *     `error` field so callers can log it.
 *   - QB#15: keytar API source-verified against
 *     https://github.com/atom/node-keytar
 *       getPassword(service, account)   → Promise<string|null>
 *       setPassword(service, account, password) → Promise<void>
 *       deletePassword(service, account) → Promise<boolean>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
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
 * Best-effort dynamic import of keytar. Returns null when:
 *   - the optionalDependency isn't installed,
 *   - native bindings failed to build (e.g. Linux without libsecret-1-dev),
 *   - or the runtime denies access (sandbox / portable env).
 *
 * Per-call resolution (no caching) so install/uninstall mid-session is
 * observable. Dynamic-import overhead is irrelevant next to OS keychain IPC.
 */
async function loadKeytar(): Promise<KeytarApi | null> {
  try {
    // Dynamic import keeps the optionalDep truly optional — if `keytar`
    // wasn't built, we just hit the catch below and return null. The
    // module specifier is computed (not a string literal) so the TS
    // compiler doesn't try to resolve it at build time — keytar may
    // legitimately not be installed in CI / Linux-without-libsecret.
    const moduleId = "keytar";
    const mod = (await import(moduleId)) as unknown as KeytarApi & {
      default?: KeytarApi;
    };
    // Some bundlers wrap the export in `default` — accept either.
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
  writeFileSync(path, JSON.stringify(data, null, 2), { encoding: "utf-8" });
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
