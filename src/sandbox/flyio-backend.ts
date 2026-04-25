/**
 * Fly.io sandbox backend — V9 Tier 12 T12.16.
 *
 * Adapter that runs sandboxed shell commands via Fly.io Machines REST
 * API. Per-second VM billing — host pays Fly directly. Adapter is
 * pure; no process.env reads.
 *
 * Same trait as modal-backend.ts so callers can swap with one config
 * change.
 */

import type {
  CloudSandboxBackend,
  CloudSandboxConfig,
  CloudSandboxResult,
  CloudSandboxSpawnOptions,
} from "./cloud-sandbox-types.js";

const DEFAULT_BASE = "https://api.machines.dev";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MEMORY_MB = 512;
/** Fly.io per-second shared-1x price (2026 listing). */
const COST_PER_SECOND_USD = 0.000_009_25;

interface FlyConfig extends CloudSandboxConfig {
  /** Required: Fly app name (must already exist). */
  readonly providerOpts?: {
    readonly app?: string;
    readonly region?: string;
    readonly cpuKind?: "shared" | "performance";
  };
}

export function createFlyIoSandbox(config: FlyConfig): CloudSandboxBackend {
  if (!config || typeof config.apiKey !== "string" || config.apiKey.length === 0) {
    throw new Error("createFlyIoSandbox: config.apiKey required");
  }
  const appName = config.providerOpts?.app;
  if (typeof appName !== "string" || appName.length === 0) {
    throw new Error("createFlyIoSandbox: config.providerOpts.app required");
  }
  const app: string = appName;
  const region = config.providerOpts?.region ?? "iad";
  const cpuKind = config.providerOpts?.cpuKind ?? "shared";
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const fetcher = config.fetcher ?? globalThis.fetch;
  const now = config.now ?? Date.now;

  async function run(opts: CloudSandboxSpawnOptions): Promise<CloudSandboxResult> {
    const startedAt = now();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryMb = opts.memoryMb ?? DEFAULT_MEMORY_MB;

    if (typeof opts.image !== "string" || opts.image.length === 0) {
      return failure(0, "flyio: image required");
    }
    if (typeof opts.command !== "string" || opts.command.length === 0) {
      return failure(0, "flyio: command required");
    }

    let res: Response;
    try {
      res = await fetcher(`${baseUrl}/v1/apps/${encodeURIComponent(app)}/machines`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          region,
          config: {
            image: opts.image,
            init: { cmd: ["sh", "-lc", opts.command] },
            env: opts.env ?? {},
            guest: { cpu_kind: cpuKind, cpus: 1, memory_mb: memoryMb },
            auto_destroy: true,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs + 5_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return failure(now() - startedAt, `flyio-fetch-error: ${reason}`);
    }

    if (!res.ok) {
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch {
        bodyText = "";
      }
      return failure(now() - startedAt, `flyio-http-${res.status}: ${bodyText.slice(0, 200)}`);
    }

    let body: {
      stdout?: string;
      stderr?: string;
      exit_code?: number;
      state?: string;
    };
    try {
      body = (await res.json()) as typeof body;
    } catch (err) {
      return failure(
        now() - startedAt,
        `flyio-bad-json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const durationMs = now() - startedAt;
    const exitCode = body.exit_code ?? (body.state === "stopped" ? 0 : 1);
    return {
      ok: exitCode === 0,
      stdout: body.stdout ?? "",
      stderr: body.stderr ?? "",
      exitCode,
      durationMs,
      costUsd: (durationMs / 1000) * COST_PER_SECOND_USD,
    };
  }

  async function probe(): Promise<boolean> {
    try {
      const res = await fetcher(`${baseUrl}/v1/apps/${encodeURIComponent(app)}`, {
        method: "GET",
        headers: { authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function failure(durationMs: number, error: string): CloudSandboxResult {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: 1,
      durationMs,
      costUsd: 0,
      error,
    };
  }

  return { provider: "flyio", run, probe };
}
