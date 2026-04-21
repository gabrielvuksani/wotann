/**
 * Bootstrap Snapshot — Droid/Meta-Harness environment capture.
 *
 * PORT OF: Droid / Meta-Harness "environment bootstrap" pattern.
 * Instead of letting the agent discover state via scattered tool calls,
 * capture a concrete snapshot of the workspace at session start and
 * prepend it to the system prompt. Empirically +2-3pp on TerminalBench 2.0
 * ("establishes context" axis).
 *
 * WHAT'S CAPTURED (6 fields):
 *   1. tree      — depth-limited directory listing (no node_modules/.git/dist/.wotann/lock files)
 *   2. git       — { head, branch, dirty } resolved via shell exec
 *   3. env       — filtered process.env (KEY/TOKEN/SECRET/PASSWORD scrubbed)
 *   4. services  — process.uptime(), process.memoryUsage(), optional lsof
 *   5. logs      — tail of most-recent kairos daemon log file, if present
 *   6. lockfiles — sha256 of package-lock/pnpm-lock/yarn/Cargo/requirements/uv/Gemfile/go.sum
 *
 * INTEGRATION POINTS:
 *   - src/core/runtime.ts injects formatForPrompt(snapshot) into the
 *     system prompt at session-start time (see this.localContextPrompt
 *     assembly around line 1762).
 *   - Bypass via `skipBootstrapSnapshot: true` in RuntimeConfig for
 *     benchmark runs where ~50ms capture overhead matters.
 *
 * QUALITY BARS:
 *   - QB #6 (honest stubs): any subsystem that fails (missing git/lsof,
 *     permission denied, unreadable log file) produces an explicit
 *     `{captured: false, reason: "..."}` entry, NEVER silent omit.
 *   - QB #7 (per-session state): each session gets its own snapshot via
 *     SessionBootstrapCache; the snapshot is frozen for the session
 *     lifetime so it does not drift mid-task.
 *   - QB #14 (verify existing): this module deliberately does NOT overlap
 *     with middleware/local-context.ts (which captures tools/deps) or
 *     hooks/benchmark-engineering.ts (which formats a lighter bootstrap).
 *     The snapshot covers git SHA + branch + dirty, env filtering,
 *     runtime services, log tail, and lockfile shas — all net-new state.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────

/** A field that either captured cleanly or failed honestly. */
export type CaptureResult<T> =
  | { readonly captured: true; readonly value: T }
  | { readonly captured: false; readonly reason: string };

export interface GitState {
  readonly head: string;
  readonly branch: string;
  readonly dirty: boolean;
}

export interface ServiceState {
  /** process.uptime() at capture time (seconds). */
  readonly uptimeSeconds: number;
  /** process.memoryUsage().rss at capture time (bytes). */
  readonly rssBytes: number;
  /** process.memoryUsage().heapUsed at capture time (bytes). */
  readonly heapUsedBytes: number;
  /** lsof output for open ports by this process; null if lsof unavailable. */
  readonly openPorts: CaptureResult<readonly string[]>;
}

export interface LockfileEntry {
  readonly path: string;
  readonly sha256: string;
}

export interface BootstrapSnapshot {
  readonly workspaceRoot: string;
  readonly capturedAt: Date;
  readonly tree: CaptureResult<readonly string[]>;
  readonly git: CaptureResult<GitState>;
  readonly env: CaptureResult<Record<string, string>>;
  readonly services: CaptureResult<ServiceState>;
  readonly logs: CaptureResult<{ readonly path: string; readonly tail: readonly string[] }>;
  readonly lockfiles: CaptureResult<readonly LockfileEntry[]>;
}

// ── Constants ─────────────────────────────────────────────

const TREE_MAX_DEPTH = 2;
const TREE_MAX_ENTRIES_PER_DIR = 40;
const TREE_IGNORE: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".wotann",
  ".nexus",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".turbo",
  ".cache",
  "target",
  "coverage",
]);

/** Redact env keys whose name contains any of these (case-insensitive). */
const ENV_SECRET_MARKERS: readonly string[] = [
  "KEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "AUTH",
  "CREDENTIAL",
  "PRIVATE",
];

/**
 * Allow-list of env vars we always keep regardless of the secret markers.
 * These are useful for the agent and never contain user secrets.
 */
const ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TERM_PROGRAM",
  "TZ",
  "PWD",
  "CI",
  "NODE_ENV",
  "WOTANN_MODE",
  "WOTANN_THINK_IN_CODE",
]);

const KNOWN_LOCKFILES: readonly string[] = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "requirements.txt",
  "poetry.lock",
  "uv.lock",
  "Gemfile.lock",
  "go.sum",
  "composer.lock",
];

/** Default lines of daemon log to tail. */
const DEFAULT_LOG_TAIL_LINES = 40;

/** Default shell exec timeout for git/lsof calls (ms). */
const SHELL_TIMEOUT_MS = 3000;

// ── Capture API ───────────────────────────────────────────

export interface CaptureOptions {
  readonly workspaceRoot: string;
  /** Override log tail line count (default 40). */
  readonly logTailLines?: number;
  /** Override shell command timeout (default 3000ms). */
  readonly shellTimeoutMs?: number;
  /**
   * For tests: override process.uptime / process.memoryUsage so the
   * same capture on the same machine is deterministic.
   */
  readonly processOverrides?: {
    readonly uptime?: () => number;
    readonly memoryUsage?: () => NodeJS.MemoryUsage;
    readonly env?: NodeJS.ProcessEnv;
  };
}

/**
 * Capture a full bootstrap snapshot. Each sub-capture is independent;
 * one failure does not taint the others (honest-failure policy).
 */
export async function captureBootstrapSnapshot(
  options: CaptureOptions,
): Promise<BootstrapSnapshot> {
  const root = options.workspaceRoot;
  const shellTimeout = options.shellTimeoutMs ?? SHELL_TIMEOUT_MS;
  const logLines = options.logTailLines ?? DEFAULT_LOG_TAIL_LINES;
  const processEnv = options.processOverrides?.env ?? process.env;

  return {
    workspaceRoot: root,
    capturedAt: new Date(),
    tree: captureTree(root),
    git: captureGit(root, shellTimeout),
    env: captureEnv(processEnv),
    services: captureServices(shellTimeout, options.processOverrides),
    logs: captureKairosLogTail(root, logLines),
    lockfiles: captureLockfiles(root),
  };
}

// ── Tree Capture ──────────────────────────────────────────

function captureTree(root: string): CaptureResult<readonly string[]> {
  try {
    if (!existsSync(root)) {
      return { captured: false, reason: `workspace root does not exist: ${root}` };
    }
    const lines: string[] = [];
    walkTree(root, "", 0, TREE_MAX_DEPTH, lines);
    return { captured: true, value: lines };
  } catch (err) {
    return {
      captured: false,
      reason: `readdir failed: ${(err as Error).message}`,
    };
  }
}

function walkTree(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  lines: string[],
): void {
  if (depth > maxDepth) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  const filtered = entries
    .filter((name) => !TREE_IGNORE.has(name))
    .filter((name) => !name.endsWith(".lock") && !name.endsWith(".log"))
    .sort()
    .slice(0, TREE_MAX_ENTRIES_PER_DIR);

  for (const name of filtered) {
    const full = join(dir, name);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      lines.push(`${prefix}${name}/`);
      if (depth < maxDepth) {
        walkTree(full, `${prefix}  `, depth + 1, maxDepth, lines);
      }
    } else if (s.isFile()) {
      lines.push(`${prefix}${name}`);
    }
  }
}

// ── Git Capture ───────────────────────────────────────────

function captureGit(root: string, timeoutMs: number): CaptureResult<GitState> {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      stdio: "pipe",
      timeout: timeoutMs,
      encoding: "utf-8",
    }).trim();

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      stdio: "pipe",
      timeout: timeoutMs,
      encoding: "utf-8",
    }).trim();

    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      stdio: "pipe",
      timeout: timeoutMs,
      encoding: "utf-8",
    });

    return {
      captured: true,
      value: {
        head,
        branch,
        dirty: status.trim().length > 0,
      },
    };
  } catch (err) {
    return {
      captured: false,
      reason: `git exec failed: ${(err as Error).message}`,
    };
  }
}

// ── Env Capture ───────────────────────────────────────────

function captureEnv(env: NodeJS.ProcessEnv): CaptureResult<Record<string, string>> {
  try {
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string") continue;
      if (ENV_ALLOWLIST.has(key)) {
        safe[key] = value;
        continue;
      }
      if (containsSecretMarker(key)) continue;
      safe[key] = value;
    }
    return { captured: true, value: safe };
  } catch (err) {
    return {
      captured: false,
      reason: `env enumeration failed: ${(err as Error).message}`,
    };
  }
}

function containsSecretMarker(key: string): boolean {
  const upper = key.toUpperCase();
  for (const marker of ENV_SECRET_MARKERS) {
    if (upper.includes(marker)) return true;
  }
  return false;
}

// ── Services Capture ──────────────────────────────────────

function captureServices(
  shellTimeout: number,
  overrides?: CaptureOptions["processOverrides"],
): CaptureResult<ServiceState> {
  try {
    const uptime = (overrides?.uptime ?? process.uptime)();
    const mem = (overrides?.memoryUsage ?? process.memoryUsage)();
    return {
      captured: true,
      value: {
        uptimeSeconds: Math.round(uptime),
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        openPorts: captureOpenPorts(shellTimeout),
      },
    };
  } catch (err) {
    return {
      captured: false,
      reason: `process introspection failed: ${(err as Error).message}`,
    };
  }
}

function captureOpenPorts(timeoutMs: number): CaptureResult<readonly string[]> {
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", String(process.pid)],
      {
        stdio: "pipe",
        timeout: timeoutMs,
        encoding: "utf-8",
      },
    );
    const lines = out
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .slice(1); // drop header row
    return { captured: true, value: lines };
  } catch (err) {
    return {
      captured: false,
      reason: `lsof unavailable: ${(err as Error).message.slice(0, 120)}`,
    };
  }
}

// ── Log Tail Capture ──────────────────────────────────────

function captureKairosLogTail(
  root: string,
  tailLines: number,
): CaptureResult<{ readonly path: string; readonly tail: readonly string[] }> {
  const logDir = join(root, ".wotann", "logs");
  if (!existsSync(logDir)) {
    return { captured: false, reason: `no kairos log dir at ${logDir}` };
  }

  try {
    const entries = readdirSync(logDir)
      .filter((name) => name.endsWith(".jsonl") || name.endsWith(".log"))
      .map((name) => {
        const full = join(logDir, name);
        try {
          const s = statSync(full);
          return { full, mtime: s.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((e): e is { full: string; mtime: number } => e !== null)
      .sort((a, b) => b.mtime - a.mtime);

    if (entries.length === 0) {
      return { captured: false, reason: "no log files in kairos log dir" };
    }

    const target = entries[0]!.full;
    const contents = readFileSync(target, "utf-8");
    const lines = contents.split("\n").filter((line) => line.length > 0);
    const tail = lines.slice(-tailLines);

    return {
      captured: true,
      value: { path: target, tail },
    };
  } catch (err) {
    return {
      captured: false,
      reason: `log read failed: ${(err as Error).message}`,
    };
  }
}

// ── Lockfile Capture ──────────────────────────────────────

function captureLockfiles(root: string): CaptureResult<readonly LockfileEntry[]> {
  try {
    const entries: LockfileEntry[] = [];
    for (const name of KNOWN_LOCKFILES) {
      const full = join(root, name);
      if (!existsSync(full)) continue;
      try {
        const buf = readFileSync(full);
        const sha = createHash("sha256").update(buf).digest("hex");
        entries.push({ path: name, sha256: sha });
      } catch {
        // Individual file unreadable — skip it but continue with the rest.
        // (The overall capture stays `captured: true` because the category
        // operation succeeded; missing files are expected.)
        continue;
      }
    }
    return { captured: true, value: entries };
  } catch (err) {
    return {
      captured: false,
      reason: `lockfile enumeration failed: ${(err as Error).message}`,
    };
  }
}

// ── Formatting ────────────────────────────────────────────

/**
 * Render the snapshot as a concise markdown section suitable for
 * injection into the system prompt. Kept compact (~ < 1500 tokens)
 * to preserve context budget.
 */
export function formatSnapshotForPrompt(snapshot: BootstrapSnapshot): string {
  const lines: string[] = ["## Environment Bootstrap Snapshot"];
  lines.push(`Captured: ${snapshot.capturedAt.toISOString()}`);
  lines.push(`Workspace: ${snapshot.workspaceRoot}`);
  lines.push("");

  // git
  lines.push("### Git");
  if (snapshot.git.captured) {
    lines.push(`- HEAD: \`${snapshot.git.value.head}\``);
    lines.push(`- branch: \`${snapshot.git.value.branch}\``);
    lines.push(`- dirty: ${snapshot.git.value.dirty ? "yes" : "no"}`);
  } else {
    lines.push(`- (skipped: ${snapshot.git.reason})`);
  }
  lines.push("");

  // tree
  lines.push("### Working Tree (depth 2)");
  if (snapshot.tree.captured) {
    const preview = snapshot.tree.value.slice(0, 60);
    for (const line of preview) lines.push(`    ${line}`);
    if (snapshot.tree.value.length > preview.length) {
      lines.push(`    … (+${snapshot.tree.value.length - preview.length} more)`);
    }
  } else {
    lines.push(`- (skipped: ${snapshot.tree.reason})`);
  }
  lines.push("");

  // lockfiles
  lines.push("### Lockfiles");
  if (snapshot.lockfiles.captured) {
    if (snapshot.lockfiles.value.length === 0) {
      lines.push("- (none detected)");
    } else {
      for (const entry of snapshot.lockfiles.value) {
        lines.push(`- ${entry.path}: \`${entry.sha256.slice(0, 16)}\``);
      }
    }
  } else {
    lines.push(`- (skipped: ${snapshot.lockfiles.reason})`);
  }
  lines.push("");

  // services
  lines.push("### Services");
  if (snapshot.services.captured) {
    lines.push(`- uptime: ${snapshot.services.value.uptimeSeconds}s`);
    lines.push(`- RSS: ${Math.round(snapshot.services.value.rssBytes / 1024 / 1024)} MiB`);
    lines.push(`- heap: ${Math.round(snapshot.services.value.heapUsedBytes / 1024 / 1024)} MiB`);
    if (snapshot.services.value.openPorts.captured) {
      const ports = snapshot.services.value.openPorts.value;
      if (ports.length === 0) lines.push("- open ports: (none)");
      else {
        lines.push("- open ports:");
        for (const p of ports.slice(0, 10)) lines.push(`    ${p}`);
      }
    } else {
      lines.push(`- open ports: (skipped: ${snapshot.services.value.openPorts.reason})`);
    }
  } else {
    lines.push(`- (skipped: ${snapshot.services.reason})`);
  }
  lines.push("");

  // logs
  lines.push("### Recent Daemon Logs");
  if (snapshot.logs.captured) {
    lines.push(`- file: ${snapshot.logs.value.path}`);
    lines.push(`- last ${snapshot.logs.value.tail.length} line(s):`);
    for (const line of snapshot.logs.value.tail.slice(-10)) {
      lines.push(`    ${line.slice(0, 240)}`);
    }
  } else {
    lines.push(`- (skipped: ${snapshot.logs.reason})`);
  }
  lines.push("");

  // env — always LAST and heavily summarised so it doesn't dominate
  lines.push("### Environment (filtered, non-secret)");
  if (snapshot.env.captured) {
    const keys = Object.keys(snapshot.env.value).sort();
    lines.push(`- ${keys.length} variable(s) captured`);
    const notable = keys.filter((k) => ENV_ALLOWLIST.has(k));
    for (const k of notable) {
      const v = snapshot.env.value[k] ?? "";
      lines.push(`- ${k}=${v.slice(0, 120)}`);
    }
  } else {
    lines.push(`- (skipped: ${snapshot.env.reason})`);
  }

  return lines.join("\n");
}

// ── Session Cache ─────────────────────────────────────────

/**
 * Per-session cache. Each runtime instance owns one of these so its
 * snapshot is frozen for the session lifetime (QB #7: per-session state,
 * never module-global).
 */
export class SessionBootstrapCache {
  private snapshot: BootstrapSnapshot | null = null;

  /**
   * Return the cached snapshot if present, otherwise capture and cache.
   * When `bypass` is true the capture is skipped entirely and a
   * placeholder snapshot is returned with all fields marked skipped.
   */
  async getOrCapture(
    options: CaptureOptions & { readonly bypass?: boolean },
  ): Promise<BootstrapSnapshot> {
    if (this.snapshot !== null) return this.snapshot;

    if (options.bypass === true) {
      this.snapshot = buildBypassSnapshot(options.workspaceRoot);
      return this.snapshot;
    }

    this.snapshot = await captureBootstrapSnapshot(options);
    return this.snapshot;
  }

  /** Clear the cache (e.g. when the workspace root changes mid-session). */
  invalidate(): void {
    this.snapshot = null;
  }

  /** Inspect the currently-cached snapshot without forcing a capture. */
  peek(): BootstrapSnapshot | null {
    return this.snapshot;
  }
}

function buildBypassSnapshot(root: string): BootstrapSnapshot {
  const reason = "bypassed: skipBootstrapSnapshot=true";
  return {
    workspaceRoot: root,
    capturedAt: new Date(),
    tree: { captured: false, reason },
    git: { captured: false, reason },
    env: { captured: false, reason },
    services: { captured: false, reason },
    logs: { captured: false, reason },
    lockfiles: { captured: false, reason },
  };
}
