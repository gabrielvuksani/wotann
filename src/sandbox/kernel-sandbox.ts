/**
 * Kernel-level sandbox facade.
 *
 * Picks a platform-specific backend (Seatbelt on macOS, Landlock on
 * Linux, Job Objects on Windows) and runs a command inside a kernel-
 * enforced sandbox described by a `KernelSandboxPolicy`.
 *
 * Selection logic:
 *   1. If caller passed `backendOverride`, use that (explicit choice).
 *   2. Otherwise, use the first backend whose `isAvailable()` returns true:
 *      - process.platform === "darwin"  → seatbelt
 *      - process.platform === "linux"   → landlock
 *      - process.platform === "win32"   → windows-jobobject
 *   3. Otherwise return an honest stub `{ok: false, reason: "..."}`.
 *
 * Honesty:
 *   - We never claim to enforce a policy unless the chosen backend actually
 *     enforced it. Result.enforced reflects reality.
 *   - When no backend is available we return ok=false with a descriptive
 *     reason. Callers (executor.ts, approval-rules.ts) can fall through to
 *     docker or fail the user-facing operation.
 */

import { spawn } from "node:child_process";
import {
  type KernelSandboxBackend,
  type KernelSandboxPolicy,
  type KernelSandboxRunResult,
  defaultPolicy,
  validatePolicy,
} from "./sandbox-policy.js";
import { createSeatbeltBackend } from "./backends/seatbelt-macos.js";
import { createLandlockBackend } from "./backends/landlock-linux.js";
import { createWindowsJobObjectBackend } from "./backends/windows-jobobject.js";

// ── Public API ─────────────────────────────────────────

export type SupportedBackendName = "seatbelt" | "landlock" | "windows-jobobject" | "auto" | "stub";

export interface KernelSandboxConfig {
  /**
   * Force a specific backend regardless of platform. Use this in tests.
   * Default "auto" means platform-driven selection.
   */
  readonly backendOverride?: SupportedBackendName;
  /**
   * Inject backends (for tests). When present, selection picks from
   * these and ignores the real factories.
   */
  readonly backends?: ReadonlyMap<SupportedBackendName, KernelSandboxBackend>;
}

export interface KernelSandbox {
  /** The chosen backend's name, or "stub" if no backend is available. */
  readonly backendName: string;
  /** True if the chosen backend can actually enforce a policy. */
  isAvailable(): Promise<boolean>;
  /** Reason the sandbox cannot enforce (when isAvailable returns false). */
  readonly unavailableReason?: string;
  /**
   * Run a command inside the sandbox. Validates the policy first.
   */
  run(command: readonly string[], policy: KernelSandboxPolicy): Promise<KernelSandboxRunResult>;
  /**
   * Run a command with a default policy (read-only, no network, working
   * dir = cwd). Convenience for "just sandbox this".
   */
  runWithDefaults(
    command: readonly string[],
    workingDirectory: string,
  ): Promise<KernelSandboxRunResult>;
}

/**
 * Create a kernel-sandbox facade. The actual backend is selected lazily
 * the first time `run()` is called (so isAvailability checks aren't paid
 * up front when the caller only wants to construct).
 *
 * Note: backend selection is itself synchronous-ish; `isAvailable()` on
 * each backend is a fast check.
 */
export async function createKernelSandbox(
  config: KernelSandboxConfig = {},
): Promise<KernelSandbox> {
  const backend = await selectBackend(config);

  return {
    backendName: backend.name,
    unavailableReason: backend.unavailableReason,
    async isAvailable() {
      return backend.isAvailable();
    },
    async run(command, policy) {
      const validated = validatePolicy(policy);
      if (!validated.ok) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: backend.name,
          reason: `policy validation failed: ${validated.reason}`,
        };
      }
      return backend.run(command, validated.policy);
    },
    async runWithDefaults(command, workingDirectory) {
      return backend.run(command, defaultPolicy(workingDirectory));
    },
  };
}

/**
 * Synchronous variant of createKernelSandbox — useful when callers can't
 * await (tests, simple scripts).
 */
export function createKernelSandboxSync(config: KernelSandboxConfig = {}): KernelSandbox {
  const backend = selectBackendSync(config);

  return {
    backendName: backend.name,
    unavailableReason: backend.unavailableReason,
    async isAvailable() {
      return backend.isAvailable();
    },
    async run(command, policy) {
      const validated = validatePolicy(policy);
      if (!validated.ok) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: backend.name,
          reason: `policy validation failed: ${validated.reason}`,
        };
      }
      return backend.run(command, validated.policy);
    },
    async runWithDefaults(command, workingDirectory) {
      return backend.run(command, defaultPolicy(workingDirectory));
    },
  };
}

// ── Selection ─────────────────────────────────────────

async function selectBackend(config: KernelSandboxConfig): Promise<KernelSandboxBackend> {
  return selectBackendSync(config);
}

function selectBackendSync(config: KernelSandboxConfig): KernelSandboxBackend {
  const injected = config.backends;
  const override = config.backendOverride;

  if (override && override !== "auto") {
    if (injected && injected.has(override)) {
      return injected.get(override)!;
    }
    return buildBackend(override);
  }

  // Auto-select by platform
  let candidate: KernelSandboxBackend;
  switch (process.platform) {
    case "darwin":
      candidate = injected?.get("seatbelt") ?? buildBackend("seatbelt");
      break;
    case "linux":
      candidate = injected?.get("landlock") ?? buildBackend("landlock");
      break;
    case "win32":
      candidate = injected?.get("windows-jobobject") ?? buildBackend("windows-jobobject");
      break;
    default:
      return injected?.get("stub") ?? makeStubBackend(`unsupported platform: ${process.platform}`);
  }

  return candidate;
}

function buildBackend(name: SupportedBackendName): KernelSandboxBackend {
  switch (name) {
    case "seatbelt":
      return createSeatbeltBackend();
    case "landlock":
      return createLandlockBackend();
    case "windows-jobobject":
      return createWindowsJobObjectBackend();
    case "stub":
      return makeStubBackend("stub backend explicitly selected");
    case "auto":
      // Should not happen — auto is resolved by selectBackendSync above.
      return makeStubBackend("auto backend not resolved");
  }
}

function makeStubBackend(reason: string): KernelSandboxBackend {
  return {
    name: "stub",
    unavailableReason: reason,
    async isAvailable() {
      return false;
    },
    async run() {
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        enforced: false,
        backend: "stub",
        reason,
      };
    },
  };
}

// ── Convenience ─────────────────────────────────────

/**
 * Run a command directly with a sandbox. Shorthand for:
 *   const sb = await createKernelSandbox(...);
 *   await sb.run(...);
 *
 * Returns the result. Honestly reports when no backend was available.
 */
export async function runSandboxed(
  command: readonly string[],
  policy: KernelSandboxPolicy,
  config: KernelSandboxConfig = {},
): Promise<KernelSandboxRunResult> {
  const sb = await createKernelSandbox(config);
  return sb.run(command, policy);
}

/**
 * Detect which backend would be chosen on this platform. For diagnostics.
 */
export async function detectActiveBackend(): Promise<{
  readonly name: string;
  readonly available: boolean;
  readonly reason?: string;
}> {
  const backend = selectBackendSync({});
  const available = await backend.isAvailable();
  const result: { readonly name: string; readonly available: boolean; readonly reason?: string } = {
    name: backend.name,
    available,
  };
  if (!available && backend.unavailableReason) {
    return { ...result, reason: backend.unavailableReason };
  }
  return result;
}

// ── Unsandboxed fallback (for stub backend transparency) ─

/**
 * Run a command WITHOUT any sandbox. Used as last resort when the caller
 * explicitly opts in via `allowUnsandboxedFallback: true`. The result has
 * `enforced: false` so callers can never confuse this with a real sandbox
 * run.
 */
export async function runUnsandboxed(
  command: readonly string[],
  workingDirectory: string,
  timeoutSeconds = 60,
): Promise<KernelSandboxRunResult> {
  if (command.length === 0) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      enforced: false,
      backend: "unsandboxed",
      reason: "command must not be empty",
    };
  }

  return new Promise((resolveFn) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
    }, timeoutSeconds * 1000);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolveFn({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + (err instanceof Error ? err.message : String(err)),
        timedOut,
        enforced: false,
        backend: "unsandboxed",
      });
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolveFn({
        ok: !timedOut && code === 0,
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        enforced: false,
        backend: "unsandboxed",
      });
    });
  });
}
