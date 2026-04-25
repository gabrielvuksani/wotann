/**
 * Modal.com sandbox backend — V9 Tier 12 T12.16.
 *
 * Adapter that runs sandboxed shell commands via Modal's REST API.
 * The host pays Modal directly per execution; this adapter never
 * touches its own process.env.
 *
 * QB #6: every failure path returns a structured CloudSandboxResult
 * with `ok=false` + an error string. No silent stderr drops.
 * QB #7: createModalSandbox() returns a fresh closure per call.
 * QB #13: every config knob (apiKey, baseUrl) arrives via constructor.
 */

import type {
  CloudSandboxBackend,
  CloudSandboxConfig,
  CloudSandboxResult,
  CloudSandboxSpawnOptions,
} from "./cloud-sandbox-types.js";

const DEFAULT_BASE = "https://api.modal.com";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MEMORY_MB = 512;
/** Modal's public per-second on-demand price (Sandbox tier, 2026). */
const COST_PER_SECOND_USD = 0.000_222;

export function createModalSandbox(config: CloudSandboxConfig): CloudSandboxBackend {
  if (!config || typeof config.apiKey !== "string" || config.apiKey.length === 0) {
    throw new Error("createModalSandbox: config.apiKey required");
  }
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const fetcher = config.fetcher ?? globalThis.fetch;
  const now = config.now ?? Date.now;

  async function run(opts: CloudSandboxSpawnOptions): Promise<CloudSandboxResult> {
    const startedAt = now();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryMb = opts.memoryMb ?? DEFAULT_MEMORY_MB;

    if (typeof opts.image !== "string" || opts.image.length === 0) {
      return failure(0, "modal: image required");
    }
    if (typeof opts.command !== "string" || opts.command.length === 0) {
      return failure(0, "modal: command required");
    }

    let res: Response;
    try {
      res = await fetcher(`${baseUrl}/v1/sandboxes`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          image: opts.image,
          command: opts.command,
          timeout_ms: timeoutMs,
          memory_mb: memoryMb,
          env: opts.env ?? {},
        }),
        signal: AbortSignal.timeout(timeoutMs + 5_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return failure(now() - startedAt, `modal-fetch-error: ${reason}`);
    }

    if (!res.ok) {
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch {
        bodyText = "";
      }
      return failure(now() - startedAt, `modal-http-${res.status}: ${bodyText.slice(0, 200)}`);
    }

    let body: {
      stdout?: string;
      stderr?: string;
      exit_code?: number;
      duration_ms?: number;
    };
    try {
      body = (await res.json()) as typeof body;
    } catch (err) {
      return failure(
        now() - startedAt,
        `modal-bad-json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const durationMs = body.duration_ms ?? now() - startedAt;
    return {
      ok: (body.exit_code ?? 1) === 0,
      stdout: body.stdout ?? "",
      stderr: body.stderr ?? "",
      exitCode: body.exit_code ?? 1,
      durationMs,
      costUsd: (durationMs / 1000) * COST_PER_SECOND_USD,
    };
  }

  async function probe(): Promise<boolean> {
    try {
      const res = await fetcher(`${baseUrl}/v1/health`, {
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

  return { provider: "modal", run, probe };
}
