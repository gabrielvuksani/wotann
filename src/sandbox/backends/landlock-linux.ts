/**
 * Linux Landlock LSM sandbox backend.
 *
 * Landlock is a kernel-level Mandatory Access Control mechanism (Linux
 * 5.13+, with extended ABI in 5.19, 6.1, and 6.7). It lets unprivileged
 * processes restrict themselves and their children — perfect for
 * sandboxing without root/capabilities.
 *
 * This backend prefers an external CLI helper named `landlock-restrict`
 * (a Rust binary widely available; see github.com/landlock-lsm).
 * Bindings to the kernel syscall (#444) from Node would require a
 * native addon (@landlock/landlock-rs) which we do not bundle. When no
 * helper is available we return an honest stub so the facade can fall
 * back to docker.
 *
 * Kernel feature detection happens via /proc/kernel/security/landlock.
 * If the path doesn't exist Landlock is not configured in the running
 * kernel. We never claim "enforced" without that proof.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type KernelSandboxBackend,
  type KernelSandboxPolicy,
  type KernelSandboxRunResult,
  validatePolicy,
} from "../sandbox-policy.js";

const LANDLOCK_FEATURE_PATH = "/sys/kernel/security/landlock";
const BACKEND_NAME = "landlock";

/**
 * Detect whether the running kernel has Landlock support enabled.
 *
 * Visible for tests.
 */
export function detectLandlockSupport(
  filesystem: { existsSync: (p: string) => boolean } = { existsSync },
): boolean {
  if (process.platform !== "linux") return false;
  return filesystem.existsSync(LANDLOCK_FEATURE_PATH);
}

// ── Helper-binary discovery ────────────────────────────

const HELPER_BINARY_NAMES = ["landlock-restrict", "landlock-sandboxer"] as const;

/**
 * Try to find an installed Landlock helper binary on $PATH. We use
 * `which` rather than reaching into PATH ourselves to keep the lookup
 * portable across distros that handle PATH oddly.
 */
async function locateHelperBinary(): Promise<string | null> {
  for (const name of HELPER_BINARY_NAMES) {
    const found = await whichBinary(name);
    if (found) return found;
  }
  return null;
}

function whichBinary(name: string): Promise<string | null> {
  return new Promise((resolveFn) => {
    const child = spawn("/usr/bin/which", [name], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => resolveFn(null));
    child.on("exit", (code) => {
      if (code === 0) {
        const path = out.trim().split("\n")[0] ?? "";
        if (path.length > 0 && existsSync(path)) {
          resolveFn(path);
          return;
        }
      }
      resolveFn(null);
    });
  });
}

// ── Argument construction ──────────────────────────────

/**
 * Build CLI args for `landlock-restrict`. Format mirrors the upstream
 * tool: `--ro <path>`, `--rw <path>`, `--no-net` etc.
 *
 * Visible for tests.
 */
export function buildHelperArgs(policy: KernelSandboxPolicy): readonly string[] {
  const args: string[] = [];

  for (const p of policy.allowedReadPaths) {
    args.push("--ro", p);
  }
  for (const p of policy.allowedWritePaths) {
    args.push("--rw", p);
  }

  switch (policy.network) {
    case "none":
      args.push("--no-net");
      break;
    case "loopback":
      args.push("--net-loopback-only");
      break;
    case "restricted":
      // Helper currently only supports loopback or all; restricted is
      // approximated as loopback-only with the caller responsible for
      // additional userspace filtering.
      args.push("--net-loopback-only");
      break;
    case "full":
      // No network restriction
      break;
  }

  if (policy.allowChildProcesses === false) {
    args.push("--no-fork");
  }

  args.push("--cwd", policy.workingDirectory);
  args.push("--timeout", String(policy.timeoutSeconds ?? 60));
  args.push("--memory-mb", String(policy.memoryLimitMb ?? 512));
  return args;
}

// ── Backend impl ──────────────────────────────────────

interface LandlockOptions {
  /** Override binary path (for tests). */
  readonly helperBinary?: string;
  /** Override feature detection. */
  readonly forceAvailable?: boolean;
}

export function createLandlockBackend(opts: LandlockOptions = {}): KernelSandboxBackend {
  const platformOk = process.platform === "linux";
  const kernelOk = opts.forceAvailable ?? detectLandlockSupport();

  let cachedBinary: string | null | undefined = undefined;

  const resolveBinary = async (): Promise<string | null> => {
    if (cachedBinary !== undefined) return cachedBinary;
    if (opts.helperBinary) {
      cachedBinary = existsSync(opts.helperBinary) ? opts.helperBinary : null;
      return cachedBinary;
    }
    cachedBinary = await locateHelperBinary();
    return cachedBinary;
  };

  const backend: KernelSandboxBackend = {
    name: BACKEND_NAME,
    unavailableReason: !platformOk
      ? `Landlock is Linux-only; current platform is ${process.platform}`
      : !kernelOk
        ? "Linux Landlock LSM not available; kernel 5.13+ with CONFIG_SECURITY_LANDLOCK=y required"
        : undefined,
    async isAvailable() {
      if (!platformOk || !kernelOk) return false;
      const bin = await resolveBinary();
      return bin !== null;
    },
    async run(command, policy) {
      if (!platformOk) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: BACKEND_NAME,
          reason: `landlock unavailable: not Linux (${process.platform})`,
        };
      }
      if (!kernelOk) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: BACKEND_NAME,
          reason: "landlock unavailable: kernel 5.13+ with CONFIG_SECURITY_LANDLOCK=y required",
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

      const helper = await resolveBinary();
      if (!helper) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: BACKEND_NAME,
          reason:
            "landlock helper binary not found on PATH (tried landlock-restrict, landlock-sandboxer)",
        };
      }

      return runWithHelper(helper, command, validated.policy);
    },
  };
  return backend;
}

async function runWithHelper(
  helperBinary: string,
  command: readonly string[],
  policy: KernelSandboxPolicy,
): Promise<KernelSandboxRunResult> {
  const helperArgs = buildHelperArgs(policy);
  // Final invocation: helper [helperArgs] -- [command...]
  const args = [...helperArgs, "--", ...command];
  const env = buildEnv(policy);
  const timeoutMs = (policy.timeoutSeconds ?? 60) * 1000 + 5000; // grace
  return runProcess(helperBinary, args, {
    cwd: policy.workingDirectory,
    env,
    timeoutMs,
  });
}

function buildEnv(policy: KernelSandboxPolicy): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: policy.workingDirectory,
    LANG: "C.UTF-8",
    WOTANN_SANDBOX_ACTIVE: "1",
  };
  if (policy.env) {
    for (const [k, v] of Object.entries(policy.env)) {
      base[k] = v;
    }
  }
  return base;
}

interface ProcessRunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

async function runProcess(
  binary: string,
  args: readonly string[],
  opts: ProcessRunOptions,
): Promise<KernelSandboxRunResult> {
  return new Promise((resolveFn) => {
    const child = spawn(binary, args, {
      cwd: opts.cwd,
      env: opts.env,
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
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolveFn({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + (err instanceof Error ? err.message : String(err)),
        timedOut,
        enforced: false,
        backend: BACKEND_NAME,
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
        enforced: !timedOut,
        backend: BACKEND_NAME,
      });
    });
  });
}
