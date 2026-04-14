/**
 * Source Monitoring System (Appendix T of V4 spec).
 * Tracks 60+ repos for new commits, releases, and features since last sync.
 *
 * Architecture:
 * 1. Reads monitor-config.yaml for tracked repos
 * 2. Checks each repo for changes since last_sync date
 * 3. Produces a human-readable digest of changes
 * 4. Optionally auto-suggests spec updates
 *
 * Usage:
 *   wotann repos check  — check all tracked repos for changes
 *   wotann repos sync   — update last_sync dates
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────

export interface TrackedRepo {
  readonly name: string;
  readonly remote: string;
  readonly branch: string;
  readonly priority: "high" | "medium" | "low";
  readonly watchPatterns: readonly string[];
  readonly extractedFeatures: readonly string[];
  readonly checkSchedule: "daily" | "weekly" | "monthly";
}

export interface RepoChange {
  readonly repo: string;
  readonly commitCount: number;
  readonly latestCommit: string;
  readonly latestDate: string;
  readonly relevantFiles: readonly string[];
  readonly hasNewRelease: boolean;
  readonly releaseName?: string;
}

export interface MonitorDigest {
  readonly checkedAt: string;
  readonly reposChecked: number;
  readonly reposWithChanges: number;
  readonly changes: readonly RepoChange[];
  readonly errors: readonly string[];
}

// ── Config Loader ──────────────────────────────────────────

interface YamlRepoEntry {
  readonly name: string;
  readonly remote: string;
  readonly branch: string;
  readonly priority: string;
  readonly watch_patterns: readonly string[];
  readonly extracted_features: readonly string[];
  readonly check_schedule: string;
}

/**
 * Load tracked repos from monitor-config.yaml.
 * Uses simple line-based YAML parsing (no external dependency).
 */
export function loadTrackedRepos(configPath: string): readonly TrackedRepo[] {
  if (!existsSync(configPath)) return [];

  const content = readFileSync(configPath, "utf-8");
  const repos: TrackedRepo[] = [];

  // Simple YAML parsing for the cloned_repos section
  const lines = content.split("\n");
  let currentRepo: Partial<YamlRepoEntry> | null = null;
  let inClonedRepos = false;
  let currentListField: string | null = null;
  let currentList: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "cloned_repos:") {
      inClonedRepos = true;
      continue;
    }

    if (!inClonedRepos) continue;

    // New section at top level ends cloned_repos
    if (!line.startsWith(" ") && !line.startsWith("\t") && trimmed.endsWith(":") && !trimmed.startsWith("-") && !trimmed.startsWith("#")) {
      if (currentRepo?.name) {
        repos.push(finalizeRepo(currentRepo, currentListField, currentList));
      }
      break;
    }

    // New repo entry
    if (trimmed.startsWith("- name:")) {
      if (currentRepo?.name) {
        repos.push(finalizeRepo(currentRepo, currentListField, currentList));
      }
      currentRepo = { name: trimmed.replace("- name:", "").trim() };
      currentListField = null;
      currentList = [];
      continue;
    }

    if (!currentRepo) continue;

    // Simple key: value fields
    if (trimmed.startsWith("remote:")) {
      currentRepo = { ...currentRepo, remote: trimmed.replace("remote:", "").trim() };
    } else if (trimmed.startsWith("branch:")) {
      currentRepo = { ...currentRepo, branch: trimmed.replace("branch:", "").trim() };
    } else if (trimmed.startsWith("priority:")) {
      currentRepo = { ...currentRepo, priority: trimmed.replace("priority:", "").trim() };
    } else if (trimmed.startsWith("check_schedule:")) {
      currentRepo = { ...currentRepo, check_schedule: trimmed.replace("check_schedule:", "").trim() };
    } else if (trimmed.startsWith("watch_patterns:")) {
      if (currentListField) {
        currentRepo = applyList(currentRepo, currentListField, currentList);
      }
      currentListField = "watch_patterns";
      currentList = parseInlineArray(trimmed.replace("watch_patterns:", "").trim());
    } else if (trimmed.startsWith("extracted_features:")) {
      if (currentListField) {
        currentRepo = applyList(currentRepo, currentListField, currentList);
      }
      currentListField = "extracted_features";
      currentList = parseInlineArray(trimmed.replace("extracted_features:", "").trim());
    }
  }

  // Don't forget the last repo
  if (currentRepo?.name) {
    repos.push(finalizeRepo(currentRepo, currentListField, currentList));
  }

  return repos;
}

function parseInlineArray(text: string): string[] {
  if (!text.startsWith("[")) return [];
  return text.replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

function applyList(repo: Partial<YamlRepoEntry>, field: string, list: string[]): Partial<YamlRepoEntry> {
  if (field === "watch_patterns") return { ...repo, watch_patterns: list };
  if (field === "extracted_features") return { ...repo, extracted_features: list };
  return repo;
}

function finalizeRepo(
  partial: Partial<YamlRepoEntry>,
  lastField: string | null,
  lastList: string[],
): TrackedRepo {
  const applied = lastField ? applyList(partial, lastField, lastList) : partial;
  return {
    name: applied.name ?? "unknown",
    remote: applied.remote ?? "",
    branch: applied.branch ?? "main",
    priority: (applied.priority ?? "medium") as "high" | "medium" | "low",
    watchPatterns: applied.watch_patterns ?? [],
    extractedFeatures: applied.extracted_features ?? [],
    checkSchedule: (applied.check_schedule ?? "weekly") as "daily" | "weekly" | "monthly",
  };
}

// ── Sync State ─────────────────────────────────────────────

interface SyncState {
  [repoName: string]: {
    lastSync: string;
    lastCommit: string;
  };
}

function loadSyncState(statePath: string): SyncState {
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as SyncState;
  } catch {
    return {};
  }
}

function saveSyncState(statePath: string, state: SyncState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ── Repo Checking ──────────────────────────────────────────

/**
 * Check a single local repo for changes since last sync.
 */
function checkLocalRepo(
  repoDir: string,
  repo: TrackedRepo,
  lastSync: string,
): RepoChange | null {
  if (!existsSync(repoDir)) return null;

  try {
    // Fetch latest
    execFileSync("git", ["fetch", "--quiet"], {
      cwd: repoDir, timeout: 30_000, stdio: "pipe",
    });

    // Count new commits since last sync
    const logOutput = execFileSync("git", [
      "log", `--since=${lastSync}`, "--oneline", `origin/${repo.branch}`,
    ], { cwd: repoDir, timeout: 10_000, encoding: "utf-8", stdio: "pipe" });

    const commits = logOutput.trim().split("\n").filter((l) => l.length > 0);
    if (commits.length === 0) return null;

    // Get latest commit info
    const latestInfo = execFileSync("git", [
      "log", "-1", "--format=%H|%aI|%s", `origin/${repo.branch}`,
    ], { cwd: repoDir, timeout: 5_000, encoding: "utf-8", stdio: "pipe" });

    const [hash, date, subject] = latestInfo.trim().split("|");

    // Check for changed files matching watch patterns
    const diffOutput = execFileSync("git", [
      "diff", "--name-only", `--since=${lastSync}`, `origin/${repo.branch}`,
    ], { cwd: repoDir, timeout: 10_000, encoding: "utf-8", stdio: "pipe" }).trim();

    const changedFiles = diffOutput.split("\n").filter((f) => f.length > 0);
    const relevantFiles = repo.watchPatterns.length > 0
      ? changedFiles.filter((f) => repo.watchPatterns.some((p) => matchGlob(f, p)))
      : changedFiles;

    // Check for new tags/releases
    const tagsOutput = execFileSync("git", [
      "tag", "--sort=-creatordate", "-l",
    ], { cwd: repoDir, timeout: 5_000, encoding: "utf-8", stdio: "pipe" });

    const tags = tagsOutput.trim().split("\n").filter((t) => t.length > 0);
    const latestTag = tags[0];

    return {
      repo: repo.name,
      commitCount: commits.length,
      latestCommit: subject ?? hash ?? "unknown",
      latestDate: date ?? new Date().toISOString(),
      relevantFiles,
      hasNewRelease: latestTag !== undefined && latestTag.length > 0,
      releaseName: latestTag,
    };
  } catch {
    return null;
  }
}

function matchGlob(path: string, pattern: string): boolean {
  // Simple glob: "src/**" matches "src/foo/bar.ts"
  const prefix = pattern.replace(/\*\*.*$/, "");
  return path.startsWith(prefix);
}

// ── Main Monitor Function ──────────────────────────────────

/**
 * Check all tracked repos for changes since last sync.
 */
export function checkAllRepos(
  configPath: string,
  researchDir: string,
  statePath: string,
): MonitorDigest {
  const repos = loadTrackedRepos(configPath);
  const syncState = loadSyncState(statePath);
  const changes: RepoChange[] = [];
  const errors: string[] = [];

  const defaultSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const repo of repos) {
    const repoDir = join(researchDir, repo.name);
    const lastSync = syncState[repo.name]?.lastSync ?? defaultSince;

    try {
      const change = checkLocalRepo(repoDir, repo, lastSync);
      if (change) {
        changes.push(change);
      }
    } catch (error) {
      errors.push(`${repo.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    reposChecked: repos.length,
    reposWithChanges: changes.length,
    changes: changes.sort((a, b) => b.commitCount - a.commitCount),
    errors,
  };
}

/**
 * Update sync state after checking.
 */
export function syncAllRepos(
  configPath: string,
  statePath: string,
): void {
  const repos = loadTrackedRepos(configPath);
  const syncState = loadSyncState(statePath);

  for (const repo of repos) {
    syncState[repo.name] = {
      lastSync: new Date().toISOString(),
      lastCommit: syncState[repo.name]?.lastCommit ?? "",
    };
  }

  saveSyncState(statePath, syncState);
}
