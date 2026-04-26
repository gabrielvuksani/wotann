/**
 * oauth-rotator.ts — H-K4 fix: proactive OAuth token rotation.
 *
 * Without proactive rotation, `refreshOAuthToken` only fires on a stream
 * mid-flight 401 — the user sees a query stall while the refresh races
 * the request. This module sweeps the credential pool on a fixed interval,
 * refreshing any token whose `expiresAt` is within `WINDOW_MS` of now so
 * the next request always lands on a fresh credential.
 *
 * Designed dependency-injection-style so the credential pool implementation
 * stays decoupled from this rotator. Wire from a composition root (typically
 * kairos.ts after credential pool init) by calling `startOAuthRotator(...)`.
 *
 * Honest fallbacks (QB#6):
 *   - Unknown / malformed expiresAt → skip (don't crash the sweep loop)
 *   - Refresh throws → log and continue with the next entry
 *   - Empty credential pool → no-op tick, never errors
 */

export interface RotatableCredential {
  readonly id: string;
  readonly provider: string;
  readonly refreshToken: string;
  /** ms-since-epoch when the access token expires. */
  readonly expiresAt: number;
}

export interface OAuthRotatorOptions {
  /**
   * How often to sweep (ms). Default 60_000 (one minute).
   * Tighter intervals catch shorter expiry windows; looser intervals reduce
   * background-CPU on idle daemons.
   */
  readonly sweepIntervalMs?: number;
  /**
   * Refresh any token whose expiresAt is within this many ms of now.
   * Default 300_000 (5 minutes per H-K4 audit recommendation).
   */
  readonly windowMs?: number;
  /**
   * Enumerate all known credentials. The rotator filters for those nearing
   * expiry — callers don't need to pre-filter.
   */
  readonly listCredentials: () =>
    | readonly RotatableCredential[]
    | Promise<readonly RotatableCredential[]>;
  /**
   * Refresh a single credential. Should call refreshOAuthToken under the
   * hood and persist the new token + expiresAt back into the credential pool.
   */
  readonly refresh: (cred: RotatableCredential) => Promise<void>;
  /**
   * Optional logger. Default: silent.
   */
  readonly log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export interface OAuthRotatorHandle {
  /** Stop the sweep loop. Idempotent. */
  readonly stop: () => void;
  /** Trigger a sweep immediately (in addition to the periodic loop). */
  readonly sweepNow: () => Promise<void>;
}

const DEFAULT_SWEEP_MS = 60_000;
const DEFAULT_WINDOW_MS = 5 * 60_000;

export function startOAuthRotator(opts: OAuthRotatorOptions): OAuthRotatorHandle {
  const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_MS;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const log = opts.log ?? (() => {});

  let stopped = false;

  async function sweepOnce(): Promise<void> {
    if (stopped) return;
    let creds: readonly RotatableCredential[];
    try {
      creds = await opts.listCredentials();
    } catch (err) {
      log("error", `oauth-rotator: listCredentials failed — ${(err as Error).message}`);
      return;
    }
    const now = Date.now();
    const due = creds.filter((c) => {
      if (typeof c.expiresAt !== "number" || !Number.isFinite(c.expiresAt)) return false;
      return c.expiresAt - now <= windowMs;
    });
    if (due.length === 0) return;
    log("info", `oauth-rotator: refreshing ${due.length} credential(s) nearing expiry`);
    for (const cred of due) {
      try {
        await opts.refresh(cred);
      } catch (err) {
        log(
          "warn",
          `oauth-rotator: refresh failed for ${cred.provider}/${cred.id} — ${(err as Error).message}`,
        );
      }
    }
  }

  // Run the first sweep immediately so a freshly-started daemon doesn't wait
  // the full sweep interval before catching an already-expiring token.
  void sweepOnce();
  const handle = setInterval(() => {
    void sweepOnce();
  }, sweepIntervalMs);
  // unref so the timer doesn't keep the process alive on shutdown.
  handle.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
    sweepNow: () => sweepOnce(),
  };
}
