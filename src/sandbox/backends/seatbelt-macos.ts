/**
 * macOS Seatbelt sandbox backend.
 *
 * Wraps `/usr/bin/sandbox-exec` (private but stable Apple API). Generates
 * a Scheme-style profile from a `KernelSandboxPolicy`, writes it to a
 * temp file, then runs the user command under sandbox-exec.
 *
 * Apple has been "deprecating" sandbox-exec since 2017 but every macOS
 * release continues to ship it because it's the foundation of Mac App
 * Store sandboxing. We treat it as the reference implementation for the
 * kernel-sandbox abstraction on Darwin.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type KernelSandboxBackend,
  type KernelSandboxPolicy,
  type KernelSandboxRunResult,
  validatePolicy,
} from "../sandbox-policy.js";

const SEATBELT_BINARY = "/usr/bin/sandbox-exec";
const BACKEND_NAME = "seatbelt";

// ── Profile generation ────────────────────────────────

/**
 * Generate a Seatbelt profile (Scheme syntax) from a policy.
 *
 * Visible for testing. Defaults to deny-all and then opts in the
 * paths/network the policy allows.
 */
export function generateSeatbeltProfile(policy: KernelSandboxPolicy): string {
  const lines: string[] = [];
  lines.push("(version 1)");
  lines.push("(deny default)");

  // Always allow process-fork/exec for the sandbox-exec invocation itself.
  // Without these the wrapper cannot start the child at all.
  lines.push("(allow process-fork)");
  lines.push("(allow process-exec)");
  lines.push("(allow process-info-pidinfo)");
  lines.push("(allow process-info-setcontrol)");

  // Sysctls and basic syscalls a typical CLI needs.
  lines.push("(allow sysctl-read)");
  lines.push("(allow file-read-metadata)");
  lines.push("(allow mach-lookup)");
  lines.push("(allow signal (target self))");
  lines.push("(allow ipc-posix-shm)");

  // Read paths
  for (const p of policy.allowedReadPaths) {
    lines.push(`(allow file-read* (subpath "${escapeScheme(p)}"))`);
  }
  // /usr, /System, /Library are needed for dyld + frameworks. We treat
  // these as implicit reads. Without them the child process can't even
  // load libSystem.
  for (const p of ["/usr", "/System", "/Library", "/private/var/folders", "/private/tmp", "/dev"]) {
    lines.push(`(allow file-read* (subpath "${p}"))`);
  }

  // Write paths
  for (const p of policy.allowedWritePaths) {
    lines.push(`(allow file-write* (subpath "${escapeScheme(p)}"))`);
  }
  // /private/var/folders is the macOS tmp dir; allow writes there for
  // standard library temp behaviour.
  lines.push(`(allow file-write* (subpath "/private/var/folders"))`);
  lines.push(`(allow file-write* (subpath "/private/tmp"))`);

  // Network
  switch (policy.network) {
    case "none":
      // Default-deny already covers this; explicit deny for clarity.
      lines.push("(deny network*)");
      break;
    case "loopback":
      lines.push('(allow network* (local ip "*:*"))');
      lines.push('(allow network* (remote ip "localhost:*"))');
      break;
    case "restricted":
      lines.push('(allow network* (local ip "*:*"))');
      for (const ep of policy.allowedNetworkEndpoints ?? []) {
        lines.push(`(allow network* (remote ip "${escapeScheme(ep)}"))`);
      }
      break;
    case "full":
      lines.push("(allow network*)");
      break;
  }

  // Child processes
  if (policy.allowChildProcesses === false) {
    // Deny additional fork/exec beyond the immediate child. We can't
    // reliably block sub-fork on macOS without entitlements, but we
    // include a comment for auditability.
    lines.push("; allowChildProcesses=false (advisory; macOS lacks per-descendant block)");
  }

  return lines.join("\n");
}

function escapeScheme(s: string): string {
  // Scheme-style strings need backslash-escaping for backslash and quote.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ── Backend impl ──────────────────────────────────────

interface SeatbeltOptions {
  /** Optional override for the sandbox-exec binary (used in tests). */
  readonly seatbeltBinary?: string;
}

/**
 * Create a Seatbelt backend. Caller is responsible for checking
 * `isAvailable()` before relying on it.
 */
export function createSeatbeltBackend(opts: SeatbeltOptions = {}): KernelSandboxBackend {
  const binary = opts.seatbeltBinary ?? SEATBELT_BINARY;
  const available = process.platform === "darwin" && existsSync(binary);

  const backend: KernelSandboxBackend = {
    name: BACKEND_NAME,
    unavailableReason: available
      ? undefined
      : process.platform !== "darwin"
        ? `Seatbelt is macOS-only; current platform is ${process.platform}`
        : `sandbox-exec not found at ${binary}`,
    async isAvailable() {
      return available;
    },
    async run(command, policy) {
      if (!available) {
        return {
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: false,
          backend: BACKEND_NAME,
          reason:
            process.platform !== "darwin"
              ? `seatbelt unavailable: not macOS (${process.platform})`
              : `seatbelt unavailable: ${binary} not found`,
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

      return runSandboxed(binary, command, validated.policy);
    },
  };
  return backend;
}

/**
 * Run a command inside a freshly-built Seatbelt profile.
 */
async function runSandboxed(
  binary: string,
  command: readonly string[],
  policy: KernelSandboxPolicy,
): Promise<KernelSandboxRunResult> {
  const profile = generateSeatbeltProfile(policy);
  const dir = mkdtempSync(join(tmpdir(), "wotann-seatbelt-"));
  const profilePath = join(dir, "profile.sb");

  try {
    writeFileSync(profilePath, profile, { mode: 0o600 });
    const args = ["-f", profilePath, "--", ...command];
    const env = buildSandboxEnv(policy);
    const timeoutMs = (policy.timeoutSeconds ?? 60) * 1000;

    return await runProcess(binary, args, {
      cwd: policy.workingDirectory,
      env,
      timeoutMs,
    });
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}

function buildSandboxEnv(policy: KernelSandboxPolicy): NodeJS.ProcessEnv {
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
        enforced: !timedOut,
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
        enforced: true,
        backend: BACKEND_NAME,
      });
    });
  });
}
