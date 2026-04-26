/**
 * Debug share (E7) + `/debug` slash command (E12).
 *
 * Generates a single-file debug bundle users can paste into bug reports. The
 * bundle is plaintext, redacted, and bounded in size so copying it to a
 * GitHub issue is safe by default. Inspired by hermes-agent's `/debug share`.
 *
 * Contents of the bundle:
 *  - Runtime version, node/npm versions, OS release
 *  - Active provider / model / profile
 *  - Last 30 session events (redacted, PII-stripped)
 *  - Current workspace root + git rev-parse HEAD
 *  - Last 200 lines of ~/.wotann/logs/daemon.log (if present)
 *  - Memory / cost snapshot
 *
 * Redaction:
 *  - API keys, OAuth tokens, JWTs, anything that looks like a secret
 *  - Home directory paths collapsed to `~/`
 *  - Email addresses collapsed to `<user@example.com>`
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform, release, type, cpus, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

const run = promisify(execFile);

export interface DebugBundle {
  readonly generatedAt: string;
  readonly runtime: {
    readonly wotannVersion: string;
    readonly nodeVersion: string;
    readonly platform: string;
    readonly osRelease: string;
    readonly osType: string;
    readonly cpuCount: number;
    readonly totalMemoryMb: number;
  };
  readonly session: {
    readonly activeProvider?: string;
    readonly activeModel?: string;
    readonly activeProfile?: string;
    readonly recentEvents: readonly string[];
  };
  readonly workspace: {
    readonly root?: string;
    readonly gitHead?: string;
    readonly gitBranch?: string;
    readonly dirty?: boolean;
  };
  readonly daemonLogTail: readonly string[];
  readonly memory: {
    readonly totalEntries?: number;
    readonly sizeBytes?: number;
  };
  readonly cost: {
    readonly todayUsd?: number;
    readonly weeklyUsd?: number;
  };
}

export interface DebugShareOptions {
  readonly workspaceRoot?: string;
  readonly activeProvider?: string;
  readonly activeModel?: string;
  readonly activeProfile?: string;
  readonly recentEvents?: readonly string[];
  readonly memoryStats?: { totalEntries?: number; sizeBytes?: number };
  readonly costStats?: { todayUsd?: number; weeklyUsd?: number };
  readonly maxLogLines?: number;
  readonly redactPaths?: boolean;
}

/**
 * Collect a debug bundle. Accepts structured overrides so callers that
 * already have the data can inject it rather than re-deriving.
 */
export async function collectDebugBundle(options: DebugShareOptions = {}): Promise<DebugBundle> {
  const maxLogLines = options.maxLogLines ?? 200;
  const wotannVersion = await readPackageVersion();
  const workspace = await readWorkspaceInfo(options.workspaceRoot);
  const daemonLogTail = readDaemonLogTail(maxLogLines);

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      wotannVersion,
      nodeVersion: process.version,
      platform: platform(),
      osRelease: release(),
      osType: type(),
      cpuCount: cpus().length,
      totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
    },
    session: {
      activeProvider: options.activeProvider,
      activeModel: options.activeModel,
      activeProfile: options.activeProfile,
      recentEvents: (options.recentEvents ?? []).slice(-30).map(redactLine),
    },
    workspace,
    daemonLogTail,
    memory: options.memoryStats ?? {},
    cost: options.costStats ?? {},
  };
}

/**
 * Render a bundle as pasteable markdown. Keep lines under 120 cols when
 * possible so the output reads well in GitHub issues.
 */
export function renderBundleMarkdown(bundle: DebugBundle): string {
  const sections: string[] = [
    `## WOTANN debug bundle`,
    `_Generated ${bundle.generatedAt}_`,
    "",
    `### Runtime`,
    `- WOTANN: ${bundle.runtime.wotannVersion}`,
    `- Node: ${bundle.runtime.nodeVersion}`,
    `- Platform: ${bundle.runtime.platform} ${bundle.runtime.osRelease} (${bundle.runtime.osType})`,
    `- CPU count: ${bundle.runtime.cpuCount}`,
    `- Total RAM: ${bundle.runtime.totalMemoryMb} MB`,
    "",
    `### Session`,
    `- Provider: ${bundle.session.activeProvider ?? "(unset)"}`,
    `- Model: ${bundle.session.activeModel ?? "(unset)"}`,
    `- Profile: ${bundle.session.activeProfile ?? "(unset)"}`,
    "",
    `### Workspace`,
    `- Root: ${bundle.workspace.root ?? "(none)"}`,
    `- Branch: ${bundle.workspace.gitBranch ?? "(detached)"}`,
    `- HEAD: ${bundle.workspace.gitHead ?? "(no git repo)"}`,
    `- Dirty: ${bundle.workspace.dirty ?? "(unknown)"}`,
    "",
  ];

  if (bundle.memory.totalEntries !== undefined) {
    sections.push(
      `### Memory`,
      `- Entries: ${bundle.memory.totalEntries}`,
      `- Size: ${Math.round((bundle.memory.sizeBytes ?? 0) / 1024)} KB`,
      "",
    );
  }

  if (bundle.cost.todayUsd !== undefined || bundle.cost.weeklyUsd !== undefined) {
    sections.push(
      `### Cost`,
      `- Today: $${(bundle.cost.todayUsd ?? 0).toFixed(4)}`,
      `- Weekly: $${(bundle.cost.weeklyUsd ?? 0).toFixed(4)}`,
      "",
    );
  }

  if (bundle.session.recentEvents.length > 0) {
    sections.push(
      `### Recent events (last ${bundle.session.recentEvents.length})`,
      "```",
      ...bundle.session.recentEvents,
      "```",
      "",
    );
  }

  if (bundle.daemonLogTail.length > 0) {
    sections.push(
      `### Daemon log tail (last ${bundle.daemonLogTail.length} lines)`,
      "```",
      ...bundle.daemonLogTail,
      "```",
      "",
    );
  }

  return sections.join("\n");
}

/** Redact any line before it enters the bundle. */
export function redactLine(line: string): string {
  let out = line;
  // Collapse home directory to ~
  out = out.replaceAll(homedir(), "~");
  // Bearer tokens / x-api-key headers
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>");
  out = out.replace(/x-api-key:\s*[A-Za-z0-9._-]+/gi, "x-api-key: <redacted>");
  out = out.replace(/x-goog-api-key:\s*[A-Za-z0-9._-]+/gi, "x-goog-api-key: <redacted>");
  // API key / token assignments
  out = out.replace(
    /(API_KEY|TOKEN|SECRET)[=:]\s*["']?[A-Za-z0-9._-]{16,}["']?/gi,
    "$1=<redacted>",
  );
  // JWTs (header.payload.signature)
  out = out.replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<jwt>");
  // sk-…, ghp_…, github_pat_… style prefixes
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<openai-key>");
  out = out.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "<github-pat>");
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, "<github-pat>");
  // Email → placeholder
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<user@example.com>");
  return out;
}

async function readPackageVersion(): Promise<string> {
  try {
    const pkgPath = join(process.cwd(), "package.json");
    if (!existsSync(pkgPath)) return "unknown";
    const parsed = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version?: string;
      name?: string;
    };
    if (parsed.name === "wotann") return parsed.version ?? "unknown";
    // If not running from the wotann repo, try the installed package
    const installedPath = join(
      homedir(),
      ".npm-global",
      "lib",
      "node_modules",
      "wotann",
      "package.json",
    );
    if (existsSync(installedPath)) {
      const installed = JSON.parse(readFileSync(installedPath, "utf-8")) as { version?: string };
      return installed.version ?? "unknown";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function readWorkspaceInfo(root?: string): Promise<DebugBundle["workspace"]> {
  const cwd = root ?? process.cwd();
  try {
    const [head, branch, status] = await Promise.all([
      run("git", ["rev-parse", "HEAD"], { cwd })
        .then((r) => r.stdout.trim())
        .catch(() => ""),
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
        .then((r) => r.stdout.trim())
        .catch(() => ""),
      run("git", ["status", "--porcelain"], { cwd })
        .then((r) => r.stdout.length > 0)
        .catch(() => false),
    ]);
    return {
      root: cwd.replace(homedir(), "~"),
      gitHead: head ? head.slice(0, 12) : undefined,
      gitBranch: branch || undefined,
      dirty: status,
    };
  } catch {
    return { root: cwd.replace(homedir(), "~") };
  }
}

function readDaemonLogTail(maxLines: number): readonly string[] {
  const logPath = resolveWotannHomeSubdir("logs", "daemon.log");
  if (!existsSync(logPath)) return [];
  try {
    const raw = readFileSync(logPath, "utf-8");
    const lines = raw
      .split("\n")
      .filter((l) => l.length > 0)
      .slice(-maxLines);
    return lines.map(redactLine);
  } catch {
    return [];
  }
}

// ── /debug slash command handler ──────────────────────────────

/**
 * Parse and dispatch a /debug slash command. Returns a user-facing string
 * ready to render in the TUI or send via a channel adapter.
 *
 * Subcommands:
 *  - /debug share           → paste-ready markdown bundle
 *  - /debug status          → one-line runtime status
 *  - /debug log [N]         → last N log lines (default 40)
 *  - /debug memory          → memory stats
 */
export async function handleDebugCommand(
  input: string,
  options: DebugShareOptions = {},
): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/debug")) return "Not a /debug command.";

  const parts = trimmed.split(/\s+/);
  const subcommand = parts[1] ?? "status";

  const bundle = await collectDebugBundle(options);

  switch (subcommand) {
    case "share":
      return renderBundleMarkdown(bundle);
    case "status":
      return [
        `WOTANN ${bundle.runtime.wotannVersion} on ${bundle.runtime.platform} ${bundle.runtime.osRelease}`,
        `Node ${bundle.runtime.nodeVersion} · ${bundle.runtime.cpuCount} cores · ${bundle.runtime.totalMemoryMb} MB RAM`,
        `Provider: ${bundle.session.activeProvider ?? "(unset)"} · Model: ${bundle.session.activeModel ?? "(unset)"}`,
        bundle.workspace.root
          ? `Workspace: ${bundle.workspace.root} (${bundle.workspace.gitBranch ?? "detached"})`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    case "log": {
      const n = Math.min(Number(parts[2]) || 40, 500);
      return bundle.daemonLogTail.slice(-n).join("\n");
    }
    case "memory": {
      return `Memory entries: ${bundle.memory.totalEntries ?? 0} (${Math.round((bundle.memory.sizeBytes ?? 0) / 1024)} KB)`;
    }
    default:
      return `Unknown /debug subcommand: ${subcommand}. Try: share, status, log, memory.`;
  }
}
