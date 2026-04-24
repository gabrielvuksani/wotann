/**
 * Cloud-offload snapshot — reproducible environment capture.
 *
 * PORT OF: Fly.io Machines "checkpoint" + Anthropic Managed Agents
 * "context bundle" + Cloudflare Durable Objects "state snapshot". All
 * three cloud-offload back-ends need the same input: a self-contained
 * freeze of the user's working environment safe enough to transmit
 * across a network boundary. This module is that freeze.
 *
 * WHAT'S CAPTURED:
 *   1. cwd absolute path
 *   2. git HEAD sha (null if not a git repo)
 *   3. git status --porcelain output
 *   4. env allowlist — vetted safe keys only, secret-shaped keys
 *      rejected at the allowlist layer so nothing leaks
 *   5. optional memory export path (caller-provided, not captured here)
 *   6. optional tarball path of the cwd, capped at maxTarballBytes
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest failures): returns {ok: false, error} envelope on
 *     any failure mode. Secret-shaped env keys are rejected BEFORE
 *     they enter the snapshot, not after.
 *   - QB #7 (stateless): captureCloudSnapshot() is a pure async
 *     function. No module-level mutation; no cache.
 *   - QB #13 (env guard): reads env through an injected allowlist
 *     filter. Raw `process.env[*]` access only happens through the
 *     single `gatherSafeEnv()` helper which enforces the allowlist.
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

// ── Public types ─────────────────────────────────────────────

export interface CloudSnapshot {
  readonly capturedAt: number;
  readonly cwd: string;
  readonly gitHead: string | null;
  readonly gitStatus: string | null;
  readonly envAllowlist: Readonly<Record<string, string>>;
  readonly memoryExportPath?: string;
  readonly tarballPath?: string;
  readonly sizeBytes: number;
  readonly warnings: readonly string[];
}

export interface ShellExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export type ShellExec = (
  cmd: string,
  args: readonly string[],
  cwd: string,
) => ShellExecResult | null;

export interface CaptureSnapshotOptions {
  readonly cwd: string;
  readonly outputDir: string;
  readonly envAllowlist?: readonly string[];
  readonly includeMemory?: boolean;
  readonly memoryExportPath?: string;
  readonly includeTarball?: boolean;
  readonly maxTarballBytes?: number;
  readonly now?: () => number;
  readonly shellExec?: ShellExec;
  /**
   * Injected env — snapshot code never reads process.env directly.
   * Callers pass a filtered view (or the real process.env; the
   * allowlist + secret-shape check will still run).
   */
  readonly env?: NodeJS.ProcessEnv;
}

export type CaptureSnapshotResult =
  | { readonly ok: true; readonly snapshot: CloudSnapshot }
  | { readonly ok: false; readonly error: string };

// ── Allowlist and secret patterns ────────────────────────────

/**
 * Default env allowlist — explicitly SAFE variables only. Never
 * includes API keys, tokens, credentials. Chosen so a freshly-
 * bootstrapped remote container can `cd` to cwd, resolve binaries,
 * know the user's locale, and pick the right node/python version,
 * but otherwise has no access to the user's secrets.
 */
export const DEFAULT_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_VERSION",
  "PYTHON_VERSION",
];

/**
 * Regex patterns that indicate a key likely carries a secret value
 * even if an accidental allowlist entry let it through. We reject on
 * match regardless of allowlist membership — the allowlist is a
 * whitelist subset, this is the safety net.
 *
 * Examples rejected: ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN, HF_TOKEN, MY_PASSWORD,
 * DATABASE_URL (contains PASSWORD-like substring when any suffix
 * present? — no, URL check is separate below).
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /_KEY$/i,
  /_TOKEN$/i,
  /_SECRET$/i,
  /_PASSWORD$/i,
  /_PASSWD$/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^AWS_/i,
  /^GITHUB_/i,
  /^GOOGLE_/i,
  /^GCP_/i,
  /^AZURE_/i,
  /^HF_/i,
  /^HUGGINGFACE_/i,
  /^DEEPSEEK_/i,
  /^GROQ_/i,
  /^XAI_/i,
  /^GROK_/i,
  /^COHERE_/i,
  /^MISTRAL_/i,
  /^PERPLEXITY_/i,
  /^STRIPE_/i,
  /_AUTH$/i,
  /_CREDENTIAL$/i,
  /PRIVATE_KEY/i,
];

/**
 * Default max tarball size (50 MB). Anything larger is skipped and a
 * warning is emitted instead of the snapshot failing — larger
 * workspaces are common and we want the offload to still boot with
 * the git-HEAD-only reproduction path.
 */
const DEFAULT_MAX_TARBALL_BYTES = 50 * 1024 * 1024;

// ── Public entrypoint ────────────────────────────────────────

/**
 * Capture a cloud-offload-ready snapshot of the given cwd.
 *
 * Steps:
 *   1. Validate cwd exists
 *   2. Ensure outputDir exists (mkdir recursive)
 *   3. Capture git HEAD + git status (optional — null if not a repo)
 *   4. Filter env through the allowlist + secret-shape reject
 *   5. Optionally tarball cwd into outputDir, capped at maxTarballBytes
 *   6. Record memory export path if caller supplied one
 *   7. Return the immutable snapshot
 */
export async function captureCloudSnapshot(
  options: CaptureSnapshotOptions,
): Promise<CaptureSnapshotResult> {
  const now = options.now ?? (() => Date.now());
  const warnings: string[] = [];

  // Step 1: validate cwd
  if (!options.cwd || options.cwd.length === 0) {
    return { ok: false, error: "cwd is required" };
  }
  if (!existsSync(options.cwd)) {
    return { ok: false, error: `cwd does not exist: ${options.cwd}` };
  }

  let cwdStat;
  try {
    cwdStat = statSync(options.cwd);
  } catch (err) {
    return { ok: false, error: `cwd stat failed: ${(err as Error).message}` };
  }
  if (!cwdStat.isDirectory()) {
    return { ok: false, error: `cwd is not a directory: ${options.cwd}` };
  }

  const absoluteCwd = resolve(options.cwd);

  // Step 2: ensure outputDir exists
  try {
    mkdirSync(options.outputDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      error: `failed to create outputDir ${options.outputDir}: ${(err as Error).message}`,
    };
  }

  // Step 3: git HEAD + status
  const shell = options.shellExec ?? defaultShellExec;
  const gitHead = captureGitHead(shell, absoluteCwd, warnings);
  const gitStatus = captureGitStatus(shell, absoluteCwd, warnings);

  // Step 4: env allowlist
  const allowlist = options.envAllowlist ?? DEFAULT_ENV_ALLOWLIST;
  const sourceEnv = options.env ?? process.env;
  const envAllowlist = gatherSafeEnv(sourceEnv, allowlist, warnings);

  // Step 5: optional tarball
  let tarballPath: string | undefined;
  let tarballSize = 0;
  if (options.includeTarball === true) {
    const maxBytes = options.maxTarballBytes ?? DEFAULT_MAX_TARBALL_BYTES;
    const result = maybeWriteTarball(shell, absoluteCwd, options.outputDir, maxBytes, warnings);
    if (result) {
      tarballPath = result.path;
      tarballSize = result.sizeBytes;
    }
  }

  // Step 6: memory export path (caller-provided pointer, we just store it)
  const memoryExportPath =
    options.includeMemory === true && options.memoryExportPath
      ? options.memoryExportPath
      : undefined;

  // Step 7: assemble and return
  const snapshot: CloudSnapshot = {
    capturedAt: now(),
    cwd: absoluteCwd,
    gitHead,
    gitStatus,
    envAllowlist,
    ...(memoryExportPath ? { memoryExportPath } : {}),
    ...(tarballPath ? { tarballPath } : {}),
    sizeBytes: tarballSize,
    warnings: Object.freeze([...warnings]),
  };

  return { ok: true, snapshot };
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Default shell exec. Uses spawnSync with a bounded timeout so a
 * hanging git invocation can't block the capture indefinitely.
 */
function defaultShellExec(
  cmd: string,
  args: readonly string[],
  cwd: string,
): ShellExecResult | null {
  try {
    const result = spawnSync(cmd, [...args], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) return null;
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      code: result.status ?? 1,
    };
  } catch {
    return null;
  }
}

function captureGitHead(shell: ShellExec, cwd: string, warnings: string[]): string | null {
  const result = shell("git", ["rev-parse", "HEAD"], cwd);
  if (!result) {
    warnings.push("git not available; gitHead skipped");
    return null;
  }
  if (result.code !== 0) {
    // Not a git repo, or git failed — not a warning, just a null.
    return null;
  }
  return result.stdout.trim();
}

function captureGitStatus(shell: ShellExec, cwd: string, warnings: string[]): string | null {
  const result = shell("git", ["status", "--porcelain"], cwd);
  if (!result) {
    warnings.push("git not available; gitStatus skipped");
    return null;
  }
  if (result.code !== 0) {
    return null;
  }
  return result.stdout;
}

/**
 * Gather env through the allowlist. Applies two filters:
 *   1. key must be in the allowlist (whitelist positive test)
 *   2. key must NOT match any secret-shape pattern (whitelist safety net)
 *
 * Both must pass. Any key that the allowlist admits but the secret
 * patterns reject becomes a warning ("allowlist entry rejected as
 * secret-shaped: X") so the user can audit their allowlist.
 */
function gatherSafeEnv(
  source: NodeJS.ProcessEnv,
  allowlist: readonly string[],
  warnings: string[],
): Readonly<Record<string, string>> {
  const safe: Record<string, string> = {};
  const allowSet = new Set<string>(allowlist);

  for (const key of allowSet) {
    const value = source[key];
    if (typeof value !== "string") continue;
    if (isSecretShapedKey(key)) {
      warnings.push(`allowlist entry rejected as secret-shaped: ${key}`);
      continue;
    }
    safe[key] = value;
  }

  return Object.freeze(safe);
}

/**
 * Secret-shape check — exported so adapter.ts test suite can sanity-
 * check the filter directly. Returns true if the key matches any of
 * the SECRET_KEY_PATTERNS regexes.
 */
export function isSecretShapedKey(key: string): boolean {
  for (const pattern of SECRET_KEY_PATTERNS) {
    if (pattern.test(key)) return true;
  }
  return false;
}

/**
 * Attempt to write a tarball of cwd into outputDir, capped at
 * maxBytes. Returns null on any failure mode (missing tar binary,
 * over-quota, non-zero exit). The caller treats a null as "no
 * tarball, warning emitted", not as a snapshot failure.
 */
function maybeWriteTarball(
  shell: ShellExec,
  cwd: string,
  outputDir: string,
  maxBytes: number,
  warnings: string[],
): { path: string; sizeBytes: number } | null {
  // First probe the estimated size with du, so we can skip tar before
  // paying its I/O cost. du reports in kilobytes on macOS/Linux.
  const duResult = shell("du", ["-sk", cwd], cwd);
  if (!duResult || duResult.code !== 0) {
    warnings.push("du unavailable; tarball size pre-check skipped");
  } else {
    const kb = parseInt(duResult.stdout.trim().split(/\s+/)[0] ?? "0", 10);
    if (!Number.isNaN(kb) && kb * 1024 > maxBytes) {
      warnings.push(
        `cwd ${Math.round((kb * 1024) / 1024 / 1024)}MB exceeds maxTarballBytes ${Math.round(maxBytes / 1024 / 1024)}MB; tarball skipped`,
      );
      return null;
    }
  }

  const outPath = join(outputDir, `snapshot-${Date.now()}.tar.gz`);
  const tarResult = shell(
    "tar",
    ["--exclude=.git", "--exclude=node_modules", "-czf", outPath, "-C", cwd, "."],
    cwd,
  );
  if (!tarResult) {
    warnings.push("tar not available; tarball skipped");
    return null;
  }
  if (tarResult.code !== 0) {
    warnings.push(`tar failed with exit code ${tarResult.code}; tarball skipped`);
    return null;
  }

  let sizeBytes = 0;
  try {
    const s = statSync(outPath);
    sizeBytes = s.size;
  } catch {
    warnings.push(`tarball written but stat failed: ${outPath}`);
  }

  if (sizeBytes > maxBytes) {
    warnings.push(
      `tarball ${sizeBytes}B exceeds maxTarballBytes ${maxBytes}B after compression; discarding path reference`,
    );
    return null;
  }

  return { path: outPath, sizeBytes };
}
