/**
 * Common policy type accepted by every kernel-sandbox backend.
 *
 * This is the minimal contract the macOS, Linux, and Windows backends
 * must understand. A `KernelSandboxPolicy` describes what the sandboxed
 * process is allowed to do — file paths, network endpoints, env vars,
 * resource limits.
 *
 * Each backend translates this policy into its native form:
 *  - macOS Seatbelt: a `(version 1)`-style sandbox profile string
 *  - Linux Landlock: a series of LSM ruleset syscalls (or a CLI invocation)
 *  - Windows Job Object: AssignProcessToJobObject + UI restriction flags
 *
 * Validation happens here so all backends benefit. Backends never see
 * unvalidated input.
 */

import { isAbsolute, normalize, resolve } from "node:path";

// ── Public types ───────────────────────────────────────

/**
 * The default-deny posture of a kernel sandbox. Every operation not
 * explicitly allowed by the policy is denied.
 */
export interface KernelSandboxPolicy {
  /** Stable name for the policy (used for telemetry + debugging). */
  readonly name: string;

  /**
   * Absolute paths whose contents the sandboxed process may READ.
   * Subdirectories are included recursively.
   */
  readonly allowedReadPaths: readonly string[];

  /**
   * Absolute paths whose contents the sandboxed process may WRITE.
   * Subdirectories are included recursively. By default empty (no writes).
   */
  readonly allowedWritePaths: readonly string[];

  /**
   * Network policy:
   *   "none"       — block all network (default for read-only audits)
   *   "loopback"   — only 127.0.0.1 / ::1
   *   "restricted" — caller-supplied allowlist of host:port pairs
   *   "full"       — unrestricted (NOT recommended; for dev only)
   */
  readonly network: KernelSandboxNetworkMode;

  /**
   * If `network === "restricted"`, this is the allowlist. Each entry is
   * `host:port` or `host:*`. Use empty array if none.
   */
  readonly allowedNetworkEndpoints?: readonly string[];

  /**
   * Process-creation policy. When false, the sandboxed process may not
   * spawn child processes. When true, children inherit the same sandbox.
   * Default false on macOS/Linux, true on Windows (Job Objects can't
   * easily forbid CreateProcess).
   */
  readonly allowChildProcesses?: boolean;

  /**
   * Maximum wall-clock seconds the sandboxed command may run.
   * Default: 60s.
   */
  readonly timeoutSeconds?: number;

  /**
   * Maximum memory in MB the sandboxed process may use.
   * Default: 512.
   */
  readonly memoryLimitMb?: number;

  /**
   * Environment variables exposed inside the sandbox. Empty object means
   * minimal env (just PATH + HOME).
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Working directory inside the sandbox. Must be one of the
   * allowedReadPaths (or allowedWritePaths if writing is needed).
   */
  readonly workingDirectory: string;
}

export type KernelSandboxNetworkMode = "none" | "loopback" | "restricted" | "full";

/**
 * The result of running a command inside a kernel sandbox.
 */
export interface KernelSandboxRunResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True if the process was killed by the timeout. */
  readonly timedOut: boolean;
  /** True if the kernel actually enforced the sandbox (vs unsandboxed fallback). */
  readonly enforced: boolean;
  /** Backend name that ran the command. */
  readonly backend: string;
  /**
   * Optional reason a backend declined to run (e.g. unsupported platform,
   * Landlock kernel too old). When present, exitCode/stdout/stderr are
   * empty and enforced=false.
   */
  readonly reason?: string;
}

/**
 * What a backend looks like from the facade's perspective.
 */
export interface KernelSandboxBackend {
  /** Stable backend name: "seatbelt", "landlock", "windows-jobobject", "stub". */
  readonly name: string;

  /** True if the backend can actually run on this OS + kernel version. */
  isAvailable(): Promise<boolean>;

  /** Reason the backend is unavailable (when isAvailable returns false). */
  readonly unavailableReason?: string;

  /**
   * Run a command inside the sandbox. The backend returns an honest
   * `{ok: false, reason: ...}` if it cannot enforce the policy — never
   * fakes success.
   */
  run(command: readonly string[], policy: KernelSandboxPolicy): Promise<KernelSandboxRunResult>;
}

// ── Validation ─────────────────────────────────────────

export type PolicyValidationResult =
  | { readonly ok: true; readonly policy: KernelSandboxPolicy }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate + normalize a `KernelSandboxPolicy`. Reject:
 *  - non-absolute paths
 *  - paths containing `..` segments
 *  - empty `name`
 *  - missing `workingDirectory`
 *  - workingDirectory not contained in allowed paths
 *  - timeoutSeconds <= 0
 *  - memoryLimitMb <= 0
 *  - bad network endpoint format when network=restricted
 */
export function validatePolicy(input: KernelSandboxPolicy): PolicyValidationResult {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return { ok: false, reason: "policy.name must be a non-empty string" };
  }

  if (!Array.isArray(input.allowedReadPaths)) {
    return { ok: false, reason: "policy.allowedReadPaths must be an array" };
  }
  for (const p of input.allowedReadPaths) {
    if (!isAbsolute(p)) {
      return { ok: false, reason: `read path must be absolute: ${p}` };
    }
    if (p.includes("..")) {
      return { ok: false, reason: `read path must not contain '..': ${p}` };
    }
  }

  if (!Array.isArray(input.allowedWritePaths)) {
    return { ok: false, reason: "policy.allowedWritePaths must be an array" };
  }
  for (const p of input.allowedWritePaths) {
    if (!isAbsolute(p)) {
      return { ok: false, reason: `write path must be absolute: ${p}` };
    }
    if (p.includes("..")) {
      return { ok: false, reason: `write path must not contain '..': ${p}` };
    }
  }

  if (
    typeof input.workingDirectory !== "string" ||
    input.workingDirectory.length === 0 ||
    !isAbsolute(input.workingDirectory)
  ) {
    return { ok: false, reason: "policy.workingDirectory must be an absolute path" };
  }
  if (input.workingDirectory.includes("..")) {
    return { ok: false, reason: "policy.workingDirectory must not contain '..'" };
  }

  // workingDirectory must be inside an allowed path
  const wd = normalize(input.workingDirectory);
  const inAllowed =
    input.allowedReadPaths.some((p) => isInside(wd, p)) ||
    input.allowedWritePaths.some((p) => isInside(wd, p));
  if (!inAllowed) {
    return {
      ok: false,
      reason: `policy.workingDirectory ${wd} is not inside any allowed path`,
    };
  }

  if (
    input.network !== "none" &&
    input.network !== "loopback" &&
    input.network !== "restricted" &&
    input.network !== "full"
  ) {
    return { ok: false, reason: `policy.network must be one of none|loopback|restricted|full` };
  }

  if (input.network === "restricted") {
    const endpoints = input.allowedNetworkEndpoints ?? [];
    for (const ep of endpoints) {
      if (!isValidEndpoint(ep)) {
        return { ok: false, reason: `invalid network endpoint: ${ep}` };
      }
    }
  }

  const timeout = input.timeoutSeconds ?? 60;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
    return { ok: false, reason: "policy.timeoutSeconds must be a positive number" };
  }

  const mem = input.memoryLimitMb ?? 512;
  if (typeof mem !== "number" || !Number.isFinite(mem) || mem <= 0) {
    return { ok: false, reason: "policy.memoryLimitMb must be a positive number" };
  }

  return { ok: true, policy: input };
}

/**
 * Check if `child` is inside `parent` after normalization. Uses
 * lexical comparison (does not follow symlinks).
 */
export function isInside(child: string, parent: string): boolean {
  const c = resolve(normalize(child));
  const p = resolve(normalize(parent));
  if (c === p) return true;
  return c.startsWith(p.endsWith("/") ? p : p + "/") || c.startsWith(p + "\\");
}

/** Validate an endpoint string of form `host:port` or `host:*`. */
function isValidEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== "string" || endpoint.length === 0) return false;
  const parts = endpoint.split(":");
  if (parts.length !== 2) return false;
  const host = parts[0]!;
  const port = parts[1]!;
  if (host.length === 0 || host.includes(" ")) return false;
  if (port === "*") return true;
  const portNum = Number.parseInt(port, 10);
  return Number.isFinite(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * Build a minimal default policy for a working directory. Convenient for
 * tests and "just give me sane defaults" callers.
 */
export function defaultPolicy(workingDirectory: string): KernelSandboxPolicy {
  return {
    name: "default",
    allowedReadPaths: [workingDirectory],
    allowedWritePaths: [],
    network: "none",
    workingDirectory,
    allowChildProcesses: false,
    timeoutSeconds: 60,
    memoryLimitMb: 512,
    env: {},
  };
}

/**
 * Honest stub result for when no backend can enforce the policy.
 */
export function stubResult(reason: string, backend = "stub"): KernelSandboxRunResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    enforced: false,
    backend,
    reason,
  };
}
