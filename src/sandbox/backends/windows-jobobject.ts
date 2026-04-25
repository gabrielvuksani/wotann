/**
 * Windows Job Object sandbox backend.
 *
 * Windows ships kernel-level process isolation via Job Objects (since
 * NT 4.0) plus AppContainer (since Windows 8) and modern AICs (Windows
 * 10+). A native implementation requires:
 *
 *   - CreateJobObjectW + AssignProcessToJobObject (kernel32)
 *   - SetInformationJobObject with JOBOBJECT_BASIC_LIMIT_INFORMATION
 *     for memory + CPU + UI restrictions
 *   - For path/registry restrictions: AppContainer profiles via
 *     CreateAppContainerProfile + capability SIDs (userenv.dll)
 *
 * None of those primitives are exposed in pure Node.js; binding to
 * them requires a native addon (n-api). Rather than ship a half-built
 * implementation that pretends to enforce policies it does not, this
 * backend ships an HONEST stub:
 *   - On Windows: returns {ok: false, reason: "windows-jobobject backend
 *     requires a native addon that is not bundled"}.
 *   - On non-Windows: returns {ok: false, reason: "not Windows"}.
 *
 * The facade in kernel-sandbox.ts will see this and degrade gracefully
 * (typically falling through to docker, or surfacing a clear error to
 * the operator).
 *
 * Future: when a native addon is bundled (e.g. via node-gyp targeting
 * win32), the stub here can be replaced. The shape of `KernelSandboxBackend`
 * is the contract — the addon must satisfy it.
 */

import {
  type KernelSandboxBackend,
  type KernelSandboxPolicy,
  type KernelSandboxRunResult,
  validatePolicy,
} from "../sandbox-policy.js";

const BACKEND_NAME = "windows-jobobject";

// ── Stub policy -> JOBOBJECT_BASIC_LIMIT translation ──

/**
 * Build a *descriptive* representation of the JOBOBJECT_BASIC_LIMIT_INFORMATION
 * structure that *would* be passed to SetInformationJobObject. This is
 * not used at runtime by the stub — it exists so:
 *
 *   1. tests can assert the policy is being correctly translated to the
 *      shape a future native addon will consume,
 *   2. operators can dump the planned limits for an audit log without
 *      executing.
 *
 * Visible for tests.
 */
export interface JobObjectBasicLimits {
  readonly memoryLimitBytes: number;
  readonly cpuRateLimitPercent: number;
  readonly processCountLimit: number;
  readonly killOnJobClose: boolean;
  readonly uiRestrictions: {
    readonly desktop: boolean;
    readonly displaySettings: boolean;
    readonly globalAtoms: boolean;
    readonly handles: boolean;
    readonly readClipboard: boolean;
    readonly systemParameters: boolean;
    readonly writeClipboard: boolean;
  };
  readonly allowChildProcesses: boolean;
  readonly allowedReadPaths: readonly string[];
  readonly allowedWritePaths: readonly string[];
  readonly networkPolicy: KernelSandboxPolicy["network"];
  readonly allowedNetworkEndpoints: readonly string[];
}

export function buildJobObjectLimits(policy: KernelSandboxPolicy): JobObjectBasicLimits {
  return {
    memoryLimitBytes: (policy.memoryLimitMb ?? 512) * 1024 * 1024,
    cpuRateLimitPercent: 100, // No CPU cap by default; could be made configurable.
    processCountLimit: policy.allowChildProcesses === false ? 1 : 32,
    killOnJobClose: true,
    uiRestrictions: {
      desktop: true,
      displaySettings: true,
      globalAtoms: true,
      handles: true,
      readClipboard: true,
      systemParameters: true,
      writeClipboard: true,
    },
    allowChildProcesses: policy.allowChildProcesses ?? true,
    allowedReadPaths: policy.allowedReadPaths,
    allowedWritePaths: policy.allowedWritePaths,
    networkPolicy: policy.network,
    allowedNetworkEndpoints: policy.allowedNetworkEndpoints ?? [],
  };
}

// ── Backend impl ──────────────────────────────────────

interface WindowsOptions {
  /**
   * For tests only: pretend we have a native addon, so isAvailable() returns
   * true. Run still returns a stub result (with addon=false in reason)
   * unless a backing impl is also injected.
   */
  readonly pretendAddonAvailable?: boolean;
  /**
   * Optional injected runner (for tests that simulate a native addon).
   */
  readonly addonRunner?: (
    command: readonly string[],
    limits: JobObjectBasicLimits,
    policy: KernelSandboxPolicy,
  ) => Promise<KernelSandboxRunResult>;
}

export function createWindowsJobObjectBackend(opts: WindowsOptions = {}): KernelSandboxBackend {
  const isWindows = process.platform === "win32";
  const addonAvailable =
    opts.pretendAddonAvailable === true || typeof opts.addonRunner === "function";

  const backend: KernelSandboxBackend = {
    name: BACKEND_NAME,
    unavailableReason: !isWindows
      ? `Windows Job Objects only available on win32; current platform is ${process.platform}`
      : !addonAvailable
        ? "windows-jobobject backend requires a native addon that is not bundled"
        : undefined,
    async isAvailable() {
      if (!isWindows) return false;
      return addonAvailable;
    },
    async run(command, policy) {
      if (!isWindows) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: BACKEND_NAME,
          reason: `windows-jobobject unavailable: not win32 (${process.platform})`,
        };
      }

      const validated = validatePolicy(policy);
      if (!validated.ok) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: BACKEND_NAME,
          reason: `policy validation failed: ${validated.reason}`,
        };
      }

      if (command.length === 0) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: BACKEND_NAME,
          reason: "command must not be empty",
        };
      }

      const limits = buildJobObjectLimits(validated.policy);

      if (opts.addonRunner) {
        try {
          return await opts.addonRunner(command, limits, validated.policy);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            exitCode: null,
            stdout: "",
            stderr: "",
            timedOut: false,
            enforced: false,
            backend: BACKEND_NAME,
            reason: `addon runner threw: ${message}`,
          };
        }
      }

      // Honest stub: we are on Windows but no native addon is bundled.
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        enforced: false,
        backend: BACKEND_NAME,
        reason:
          "windows-jobobject backend requires a native addon (kernel32.AssignProcessToJobObject) that is not bundled in this WOTANN build",
      };
    },
  };
  return backend;
}
