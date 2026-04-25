/**
 * Cloud-sandbox auth token helper — V9 T12.16.
 *
 * Resolves API tokens for the Modal + Fly cloud sandbox backends from
 * the process environment. Caches resolved tokens in-memory per process
 * so repeat calls are zero-cost. The helper performs NO network I/O —
 * it only reads env vars and returns a structured result.
 *
 * Provider env keys
 *   - Modal: MODAL_TOKEN_ID + MODAL_TOKEN_SECRET (both required, joined
 *     with a colon to form the canonical Modal credential string).
 *   - Fly:   FLY_API_TOKEN
 *
 * Quality bars
 *   - QB #6 honest stubs: missing env → returns `null` + a real reason
 *     describing which key was missing. No silent fallbacks.
 *   - QB #7 per-call state: cache key includes the env reference and
 *     provider; callers passing a custom env get an isolated cache slot.
 *   - TypeScript strict; zero `any`.
 */

export type CloudAuthProvider = "modal" | "flyio";

export type CloudAuthSource = "env" | "keychain";

export interface CloudAuthToken {
  readonly token: string;
  readonly source: CloudAuthSource;
}

export interface CloudAuthMissing {
  readonly token: null;
  readonly reason: string;
}

export type CloudAuthResult = CloudAuthToken | CloudAuthMissing;

// ── Cache ──────────────────────────────────────────────────

/**
 * In-memory token cache keyed by `<env-ref>::<provider>`. The env ref
 * is a WeakRef-like identity proxy so per-call envs (used in tests)
 * don't collide with the default `process.env` cache slot.
 */
type CacheKey = string;

const TOKEN_CACHE: Map<CacheKey, CloudAuthToken> = new Map();
const ENV_IDS: WeakMap<NodeJS.ProcessEnv, string> = new WeakMap();
let envIdCounter = 0;

function cacheKey(env: NodeJS.ProcessEnv, provider: CloudAuthProvider): CacheKey {
  let id = ENV_IDS.get(env);
  if (id === undefined) {
    envIdCounter += 1;
    id = `env#${envIdCounter}`;
    ENV_IDS.set(env, id);
  }
  return `${id}::${provider}`;
}

// ── Provider resolvers ─────────────────────────────────────

function resolveModal(env: NodeJS.ProcessEnv): CloudAuthResult {
  const id = env["MODAL_TOKEN_ID"];
  const secret = env["MODAL_TOKEN_SECRET"];
  if (typeof id !== "string" || id.length === 0) {
    return {
      token: null,
      reason:
        "Modal auth unavailable: MODAL_TOKEN_ID env var is missing. Set both MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.",
    };
  }
  if (typeof secret !== "string" || secret.length === 0) {
    return {
      token: null,
      reason:
        "Modal auth unavailable: MODAL_TOKEN_SECRET env var is missing. Set both MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.",
    };
  }
  return { token: `${id}:${secret}`, source: "env" };
}

function resolveFlyio(env: NodeJS.ProcessEnv): CloudAuthResult {
  const token = env["FLY_API_TOKEN"];
  if (typeof token !== "string" || token.length === 0) {
    return {
      token: null,
      reason: "Fly auth unavailable: FLY_API_TOKEN env var is missing.",
    };
  }
  return { token, source: "env" };
}

// ── Public API ─────────────────────────────────────────────

/**
 * Resolve a cloud-sandbox API token from the environment, with an
 * in-memory cache. Returns either `{ token, source }` on success or
 * `{ token: null, reason }` when the required env vars are missing.
 *
 * Pure with respect to network — no HTTP calls, no filesystem access.
 *
 * @param provider The cloud provider whose token to resolve.
 * @param env Optional process env. Defaults to `process.env`. Pass a
 *            custom env to isolate cache (useful for tests).
 */
export async function getCloudAuthToken(
  provider: CloudAuthProvider,
  env?: NodeJS.ProcessEnv,
): Promise<CloudAuthResult> {
  const resolvedEnv: NodeJS.ProcessEnv = env ?? process.env;
  const key = cacheKey(resolvedEnv, provider);

  const hit = TOKEN_CACHE.get(key);
  if (hit !== undefined) return hit;

  const result: CloudAuthResult =
    provider === "modal" ? resolveModal(resolvedEnv) : resolveFlyio(resolvedEnv);

  if (result.token !== null) {
    TOKEN_CACHE.set(key, result);
  }
  return result;
}

/**
 * Drop the in-memory token cache. Intended for tests + long-running
 * daemons that need to react to env-var rotation. Safe to call from
 * any execution context.
 */
export function clearCloudAuthCache(): void {
  TOKEN_CACHE.clear();
}
