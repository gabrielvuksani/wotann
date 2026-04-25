/**
 * Cloud sandbox common types — V9 Tier 12 T12.16.
 *
 * Modal + Fly.io sandbox backends share the same trait surface so
 * the runtime can swap them without conditionals. Concrete backends
 * (modal-backend.ts, flyio-backend.ts) implement this interface.
 */

export interface CloudSandboxConfig {
  /** Provider API token. NEVER read from process.env inside library code. */
  readonly apiKey: string;
  /** Provider base URL. Default: provider's public endpoint. */
  readonly baseUrl?: string;
  /** Provider-specific config (workspace id, region, etc.) */
  readonly providerOpts?: Readonly<Record<string, unknown>>;
  /** Injectable fetcher for tests. Default: global fetch. */
  readonly fetcher?: typeof fetch;
  /** Clock for deterministic tests. */
  readonly now?: () => number;
}

export interface CloudSandboxSpawnOptions {
  /** Image / template the sandbox spins up from. */
  readonly image: string;
  /** Shell command(s) to run inside the sandbox. */
  readonly command: string;
  /** Wall-clock cap (ms). Default 60_000. */
  readonly timeoutMs?: number;
  /** Memory cap (MB). Default 512. */
  readonly memoryMb?: number;
  /** Optional environment variables (sandbox-internal, NOT host's). */
  readonly env?: Readonly<Record<string, string>>;
}

export interface CloudSandboxResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly error?: string;
}

export interface CloudSandboxBackend {
  readonly provider: "modal" | "flyio";
  /** Run a sandboxed command. Returns when the sandbox exits or times out. */
  readonly run: (opts: CloudSandboxSpawnOptions) => Promise<CloudSandboxResult>;
  /** Best-effort health probe. Returns false when the provider is unreachable. */
  readonly probe: () => Promise<boolean>;
}
