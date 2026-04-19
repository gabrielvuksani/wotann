/**
 * Extended sandbox backends — Phase 5.
 *
 * Core execution-environments.ts ships local/worktree/docker. This
 * module extends the catalog with 5 additional backends that matter
 * for serious benchmark runs:
 *
 *   - daytona:    cloud dev sandbox (https://daytona.io) — fast boot,
 *                 pre-provisioned env, pay per second
 *   - modal:      serverless Python/Node runtime (https://modal.com) —
 *                 free tier + GPU availability
 *   - singularity: HPC container format — rootless, read-only root FS
 *   - ssh:        remote host via SSH; useful for running on isolated
 *                 laptops / VMs / bare-metal runners
 *   - landlock:   local with Linux landlock LSM filesystem restrictions
 *                 (no FS writes outside allowlist; no network unless
 *                 opted in)
 *
 * This module does NOT ship runtime adapters (no actual Daytona/Modal
 * client calls) — those require API keys + network. What it DOES ship
 * is the ExecutionEnvironment catalog entries + a
 * detectAvailableBackends() probe so the selector can widen its
 * fallback chain.
 */

import type { ExecutionEnvironment } from "./execution-environments.js";

// ── Extended catalog ──────────────────────────────────

export type ExtendedEnvName = "daytona" | "modal" | "singularity" | "ssh" | "landlock";

/**
 * Shape matches the core ExecutionEnvironment but with a widened name
 * field (core union is "local"|"worktree"|"docker"). Callers that need
 * the strict core type can cast via `as unknown as ExecutionEnvironment`
 * once they've verified the name is core.
 */
export type ExtendedEnvironment = Omit<ExecutionEnvironment, "name"> & {
  readonly name: ExtendedEnvName;
};

export const EXTENDED_EXECUTION_ENVIRONMENTS: Record<ExtendedEnvName, ExtendedEnvironment> = {
  daytona: {
    name: "daytona",
    label: "Daytona",
    description: "Cloud dev sandbox — fast boot, ephemeral, pay per second",
    isolation: "full",
    startupCostMs: 3_000,
    supportsRollback: true,
    tradeoffs: [
      "~3s boot; ephemeral (cleaned on session end)",
      "Requires DAYTONA_API_KEY env; outbound network only",
      "Best for: CI-style benchmark runs without local Docker",
    ],
  },
  modal: {
    name: "modal",
    label: "Modal",
    description: "Serverless GPU/CPU runtime — free tier + pay per second",
    isolation: "full",
    startupCostMs: 5_000,
    supportsRollback: true,
    tradeoffs: [
      "~5s boot; free tier = 10k req/month + cold starts",
      "Requires MODAL_TOKEN_ID + MODAL_TOKEN_SECRET",
      "Best for: GPU benchmarks (MLE-bench), parallel sweeps",
    ],
  },
  singularity: {
    name: "singularity",
    label: "Singularity",
    description: "HPC rootless containers — read-only root FS, no Docker daemon needed",
    isolation: "full",
    startupCostMs: 2_000,
    supportsRollback: true,
    tradeoffs: [
      "~2s boot; rootless (no sudo required)",
      "Requires `singularity` binary; not macOS-native",
      "Best for: HPC cluster runs, shared-machine environments",
    ],
  },
  ssh: {
    name: "ssh",
    label: "SSH remote",
    description: "Run on a remote host via SSH — isolated laptop / VM / bare metal",
    isolation: "filesystem",
    startupCostMs: 500,
    supportsRollback: false,
    tradeoffs: [
      "~500ms per command (network RTT dominates)",
      "Requires `ssh` configured + target host reachable",
      "Best for: running on a dedicated benchmark box",
    ],
  },
  landlock: {
    name: "landlock",
    label: "Landlock",
    description: "Local with Linux LSM filesystem restrictions",
    isolation: "filesystem",
    startupCostMs: 10,
    supportsRollback: false,
    tradeoffs: [
      "Near-zero overhead; FS writes restricted to allowlist",
      "Requires Linux 5.13+ with landlock enabled",
      "Best for: trusted-but-paranoid local runs (no network block)",
    ],
  },
};

// ── Detection ─────────────────────────────────────────

export interface BackendAvailability {
  readonly name: ExtendedEnvName;
  readonly available: boolean;
  readonly reason: string;
}

/**
 * Probe each extended backend for availability. Uses env-var presence
 * + `which` checks, not API calls — cheap and synchronous-enough to
 * run on harness startup.
 */
export function detectAvailableBackends(
  env: NodeJS.ProcessEnv = process.env,
): readonly BackendAvailability[] {
  return [
    {
      name: "daytona",
      available: Boolean(env["DAYTONA_API_KEY"]),
      reason: env["DAYTONA_API_KEY"] ? "DAYTONA_API_KEY set" : "DAYTONA_API_KEY not set",
    },
    {
      name: "modal",
      available: Boolean(env["MODAL_TOKEN_ID"] && env["MODAL_TOKEN_SECRET"]),
      reason: env["MODAL_TOKEN_ID"]
        ? env["MODAL_TOKEN_SECRET"]
          ? "Modal tokens present"
          : "MODAL_TOKEN_SECRET missing"
        : "MODAL_TOKEN_ID missing",
    },
    {
      name: "singularity",
      available: commandExists("singularity"),
      reason: commandExists("singularity")
        ? "singularity binary found"
        : "singularity binary not in PATH",
    },
    {
      name: "ssh",
      available: commandExists("ssh") && Boolean(env["WOTANN_SSH_HOST"]),
      reason:
        commandExists("ssh") && env["WOTANN_SSH_HOST"]
          ? `ssh + WOTANN_SSH_HOST=${env["WOTANN_SSH_HOST"]}`
          : !commandExists("ssh")
            ? "ssh not in PATH"
            : "WOTANN_SSH_HOST not set",
    },
    {
      name: "landlock",
      available: isLinux() && env["WOTANN_LANDLOCK"] === "1",
      reason: isLinux()
        ? env["WOTANN_LANDLOCK"] === "1"
          ? "Linux + WOTANN_LANDLOCK=1"
          : "WOTANN_LANDLOCK not enabled"
        : "not Linux",
    },
  ];
}

function isLinux(): boolean {
  return process.platform === "linux";
}

function commandExists(cmd: string): boolean {
  // Check PATH for the binary. Synchronous + cheap.
  const paths = (process.env["PATH"] ?? "").split(":");
  const fs = requireFsSync();
  for (const p of paths) {
    if (!p) continue;
    try {
      const candidate = `${p}/${cmd}`;
      if (fs.existsSync(candidate)) return true;
    } catch {
      // skip
    }
  }
  return false;
}

function requireFsSync(): { existsSync: (p: string) => boolean } {
  // Inline import so this module stays testable without side effects
  // at module-load time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as { existsSync: (p: string) => boolean };
  return fs;
}

// ── Fallback ordering ─────────────────────────────────

/**
 * Given a preferred backend, return the fallback sequence. Based on
 * isolation level: if preferred is "full", fall back to other "full"
 * before stepping down to "filesystem". Local is always last.
 */
export function fallbackChain(preferred: ExtendedEnvName): readonly ExtendedEnvName[] {
  const preferredEnv = EXTENDED_EXECUTION_ENVIRONMENTS[preferred];
  const allEnvs = Object.entries(EXTENDED_EXECUTION_ENVIRONMENTS) as Array<
    [ExtendedEnvName, ExtendedEnvironment]
  >;
  allEnvs.sort(([_a, envA], [_b, envB]) => {
    // Prefer matching isolation level
    const aMatch = envA.isolation === preferredEnv.isolation ? 0 : 1;
    const bMatch = envB.isolation === preferredEnv.isolation ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    // Within same isolation, prefer faster startup
    return envA.startupCostMs - envB.startupCostMs;
  });
  return allEnvs
    .map(([name]) => name)
    .filter((name) => name !== preferred)
    .slice(0, allEnvs.length); // include all alternatives
}

// ── Union registry ────────────────────────────────────

/** Every backend name WOTANN knows about (core + extended). */
export type AnyBackendName = "local" | "worktree" | "docker" | ExtendedEnvName;

/** All available backends, including the core three. */
export function allBackends(): readonly string[] {
  return [
    "local",
    "worktree",
    "docker",
    ...(Object.keys(EXTENDED_EXECUTION_ENVIRONMENTS) as ExtendedEnvName[]),
  ];
}
