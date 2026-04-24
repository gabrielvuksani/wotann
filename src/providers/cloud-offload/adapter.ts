/**
 * Cloud-offload adapter — shared trait + registry.
 *
 * PORT OF: Anthropic Managed Agents / Fly Sprites / Cloudflare Agents
 * all share the same lifecycle (snapshot → remote boot → metered stream
 * → final session record), so WOTANN expresses that lifecycle as a
 * single trait + registry. Concrete adapters (anthropic-managed.ts,
 * fly-sprites.ts, cloudflare-agents.ts) live in sibling files and each
 * export a factory returning a CloudOffloadAdapter.
 *
 * WHY 3 ADAPTERS, NOT 1:
 * Quality bar — no vendor bias. If WOTANN only shipped with Anthropic
 * Managed Agents, the harness would quietly recommend it by default.
 * Shipping 3 back-ends with the same trait proves the trait is
 * provider-neutral and keeps the user's sovereignty over which cloud
 * owns their session.
 *
 * QUALITY BARS HONORED:
 * - QB #6 (honest failures): every operation returns nullable / typed
 *   results; no silent successes. The registry returns null rather
 *   than throwing on `get()` with an unknown provider.
 * - QB #7 (per-caller state): createCloudOffloadRegistry() returns a
 *   fresh registry per caller. Never module-global state.
 * - QB #13 (env guard): adapter.ts itself does not read process.env.
 *   The snapshot.ts allowlist is the only env-access path, and callers
 *   inject their own filtered env into it.
 */

// ── Provider enum ────────────────────────────────────────────

/**
 * Currently supported cloud-offload back-ends.
 *
 * `anthropic-managed` — Anthropic Managed Agents (public beta Apr 2026)
 * `fly-sprites`       — Fly.io Firecracker VMs with Claude preinstalled
 * `cloudflare-agents` — Cloudflare Agents SDK (Durable Objects, $0 idle)
 */
export type CloudOffloadProvider = "anthropic-managed" | "fly-sprites" | "cloudflare-agents";

// ── Snapshot shape (shared with snapshot.ts) ─────────────────

/**
 * Re-exported shape of a captured cloud snapshot. The full capture
 * machinery lives in `./snapshot.ts`; adapter.ts only needs the
 * immutable value so the trait signatures stay self-contained.
 */
export interface CloudSnapshot {
  readonly capturedAt: number;
  readonly cwd: string;
  readonly gitHead: string | null;
  readonly gitStatus: string | null;
  readonly envAllowlist: Readonly<Record<string, string>>;
  readonly memoryExportPath?: string;
  readonly tarballPath?: string;
  readonly sizeBytes: number;
  readonly warnings: readonly string[];
}

// ── Session shape ────────────────────────────────────────────

export interface CloudOffloadSession {
  readonly sessionId: string;
  readonly provider: CloudOffloadProvider;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly costUsd: number;
  readonly tokensUsed: number;
}

// ── Frame streaming ──────────────────────────────────────────

export interface OffloadFrame {
  readonly sessionId: string;
  readonly kind: "stdout" | "stderr" | "tool-call" | "cost-update" | "done" | "error";
  readonly content: string;
  readonly timestamp: number;
}

// ── Start-offload options ────────────────────────────────────

export interface StartOffloadOptions {
  readonly task: string;
  readonly snapshot: CloudSnapshot;
  readonly budgetUsd?: number;
  readonly maxDurationMs?: number;
  readonly onFrame?: (frame: OffloadFrame) => void;
}

// ── Trait ────────────────────────────────────────────────────

/**
 * The shared trait every cloud-offload adapter implements. Concrete
 * adapters must be pure: all mutable state (sessions, cost counters)
 * lives inside the adapter closure, never in module scope.
 */
export interface CloudOffloadAdapter {
  readonly provider: CloudOffloadProvider;
  /** Kick off an offloaded session; returns the initial session record. */
  readonly start: (opts: StartOffloadOptions) => Promise<CloudOffloadSession>;
  /** Cancel an in-flight session. Returns true if the provider accepted it. */
  readonly cancel: (sessionId: string) => Promise<boolean>;
  /** Fetch the current status of a session, or null if unknown. */
  readonly status: (sessionId: string) => Promise<CloudOffloadSession | null>;
  /** List all sessions this adapter knows about (read-only snapshot). */
  readonly list: () => Promise<readonly CloudOffloadSession[]>;
}

// ── Registry ─────────────────────────────────────────────────

/**
 * In-memory registry that maps provider name → adapter instance.
 *
 * Concurrency: not thread-safe, but Node is single-threaded at the JS
 * level. The registry is intentionally per-caller so test suites and
 * concurrent WotannRuntime instances don't clobber each other.
 *
 * Duplicate-register policy: **last wins**. The last adapter registered
 * under a provider name replaces the prior one, mirroring how
 * WOTANN's provider-router handles hot-swap in tests. A warning is
 * NOT emitted — callers that need uniqueness should call `has()` first.
 */
export interface CloudOffloadRegistry {
  readonly register: (adapter: CloudOffloadAdapter) => void;
  readonly get: (provider: CloudOffloadProvider) => CloudOffloadAdapter | null;
  readonly list: () => readonly CloudOffloadAdapter[];
  readonly has: (provider: CloudOffloadProvider) => boolean;
}

/**
 * Factory. Every caller should use this rather than constructing the
 * registry inline so per-session state stays isolated.
 */
export function createCloudOffloadRegistry(): CloudOffloadRegistry {
  const adapters = new Map<CloudOffloadProvider, CloudOffloadAdapter>();

  return {
    register(adapter: CloudOffloadAdapter): void {
      // QB #6: no silent failure, but also no throw — last-wins is the
      // documented policy so tests and prod code can re-register
      // without guarding. Callers wanting strict uniqueness call has()
      // first.
      adapters.set(adapter.provider, adapter);
    },

    get(provider: CloudOffloadProvider): CloudOffloadAdapter | null {
      return adapters.get(provider) ?? null;
    },

    list(): readonly CloudOffloadAdapter[] {
      return Array.from(adapters.values());
    },

    has(provider: CloudOffloadProvider): boolean {
      return adapters.has(provider);
    },
  };
}

// ── Provider-name sanity helper ──────────────────────────────

/**
 * Type guard for narrowing arbitrary strings (e.g. CLI args) into
 * CloudOffloadProvider. Returns false for anything else, no throw.
 */
export function isCloudOffloadProvider(value: unknown): value is CloudOffloadProvider {
  return value === "anthropic-managed" || value === "fly-sprites" || value === "cloudflare-agents";
}
