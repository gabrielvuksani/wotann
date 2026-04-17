/**
 * Live sandboxed command execution.
 *
 * On macOS, verification commands run inside Seatbelt via `sandbox-exec` with
 * writes restricted to the workspace. Other platforms degrade gracefully to
 * unsandboxed execution until a kernel-backed wrapper is available.
 */

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { detectSandbox, type PlatformSandbox } from "./security.js";
import { getTimeoutForCommand } from "../intelligence/forgecode-techniques.js";

const SEATBELT_BINARY = "/usr/bin/sandbox-exec";

export interface SandboxedCommandOptions {
  readonly workingDir: string;
  readonly timeoutMs?: number;
  readonly allowNetwork?: boolean;
  readonly allowWritePaths?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

export interface SandboxedCommandResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly sandbox: PlatformSandbox;
  readonly enforced: boolean;
  readonly command: readonly string[];
  readonly errorMessage?: string;
}

interface SeatbeltProfileOptions {
  readonly allowNetwork: boolean;
  readonly writePaths: readonly string[];
}

export function runSandboxedCommandSync(
  binary: string,
  args: readonly string[],
  options: SandboxedCommandOptions,
): SandboxedCommandResult {
  const workingDir = normalizePath(options.workingDir);
  const sandbox = detectSandbox();
  const nestedSandbox =
    (options.env?.["WOTANN_SANDBOX_ACTIVE"] ?? process.env["WOTANN_SANDBOX_ACTIVE"]) === "1";
  const sandboxEnv = buildSandboxEnv(workingDir, options.env);
  const writePaths = collectWritePaths(workingDir, options.allowWritePaths);
  const enforceSeatbelt = !nestedSandbox && sandbox === "seatbelt" && existsSync(SEATBELT_BINARY);

  const invocation = enforceSeatbelt
    ? {
        binary: SEATBELT_BINARY,
        args: [
          "-p",
          buildSeatbeltProfile({
            allowNetwork: options.allowNetwork ?? false,
            writePaths,
          }),
          binary,
          ...args,
        ],
      }
    : { binary, args: [...args] };

  // Session-6 S5-8: wire getTimeoutForCommand (forgecode technique #9)
  // into the executor so long-running commands (npm install, cargo build,
  // docker, pytest full-suite, yarn, go build, etc.) get extended
  // timeouts instead of failing fast at 60s. Explicit caller timeoutMs
  // wins; if none is given we infer from the command line.
  const inferredTimeout = getTimeoutForCommand([binary, ...args].join(" "));
  const effectiveTimeout = options.timeoutMs ?? inferredTimeout;

  const result = spawnSync(invocation.binary, invocation.args, {
    cwd: workingDir,
    timeout: effectiveTimeout,
    encoding: "utf-8",
    stdio: "pipe",
    env: sandboxEnv,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const errorMessage = result.error?.message;
  const output = [stdout, stderr, errorMessage].filter(Boolean).join(stdout && stderr ? "\n" : "");

  return {
    success: result.status === 0 && !result.error,
    stdout,
    stderr,
    output,
    exitCode: result.status,
    signal: result.signal,
    sandbox,
    enforced: enforceSeatbelt,
    command: [binary, ...args],
    errorMessage,
  };
}

export function buildSeatbeltProfile(options: SeatbeltProfileOptions): string {
  const writeRules = options.writePaths
    .map((path) => `    (subpath "${escapeSeatbeltString(path)}")`)
    .join("\n");

  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow ipc-posix-shm*)",
    "(allow file-read*)",
    options.allowNetwork ? "(allow network*)" : null,
    writeRules.length > 0 ? `(allow file-write*\n${writeRules}\n)` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSandboxEnv(
  workingDir: string,
  baseEnv: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const sandboxRoot = join(workingDir, ".wotann", "sandbox");
  const cacheRoot = join(sandboxRoot, "cache");
  const npmCacheRoot = join(cacheRoot, "npm");
  const xdgCacheRoot = join(cacheRoot, "xdg");
  const tempRoot = join(sandboxRoot, "tmp");
  mkdirSync(npmCacheRoot, { recursive: true });
  mkdirSync(xdgCacheRoot, { recursive: true });
  mkdirSync(tempRoot, { recursive: true });

  return {
    ...process.env,
    ...baseEnv,
    npm_config_cache: npmCacheRoot,
    NPM_CONFIG_CACHE: npmCacheRoot,
    XDG_CACHE_HOME: xdgCacheRoot,
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    WOTANN_SANDBOX_ACTIVE: "1",
  };
}

function collectWritePaths(
  workingDir: string,
  extraWritePaths: readonly string[] | undefined,
): readonly string[] {
  const paths = [workingDir, ...(extraWritePaths ?? []).map((path) => normalizePath(path))];
  return [...new Set(paths)];
}

function normalizePath(path: string): string {
  const resolved = resolve(path);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function escapeSeatbeltString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
