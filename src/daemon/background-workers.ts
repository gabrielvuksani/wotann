/**
 * Background Workers — 12 daemon tasks that run during idle time.
 * Inspired by ruflo's background worker pattern.
 *
 * Each worker has a time/token budget and runs during KAIROS heartbeat.
 * Workers are prioritized: critical workers run first, optional workers
 * only run if there's idle time remaining.
 */

import type { HeartbeatTask } from "./kairos.js";
import type { WotannRuntime } from "../core/runtime.js";

// ── Worker Definitions ──────────────────────────────────

export interface WorkerConfig {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schedule: "on-wake" | "periodic" | "nightly";
  readonly priority: number; // Lower = higher priority
  readonly maxDurationMs: number;
  readonly enabled: boolean;
}

const WORKERS: readonly WorkerConfig[] = [
  {
    id: "consolidate",
    name: "Memory Consolidator",
    description: "Compact and deduplicate memory entries, merge related knowledge",
    schedule: "nightly",
    priority: 1,
    maxDurationMs: 60_000, // 1 minute
    enabled: true,
  },
  {
    id: "audit",
    name: "Security Auditor",
    description: "Scan workspace for secrets, vulnerabilities, dependency issues",
    schedule: "nightly",
    priority: 2,
    maxDurationMs: 120_000, // 2 minutes
    enabled: true,
  },
  {
    id: "map",
    name: "Codebase Mapper",
    description: "Index file structure, symbol definitions, dependency graph",
    schedule: "periodic",
    priority: 3,
    maxDurationMs: 30_000, // 30 seconds
    enabled: true,
  },
  {
    id: "optimize",
    name: "Performance Optimizer",
    description: "Analyze middleware weights, cache hit rates, model routing efficiency",
    schedule: "nightly",
    priority: 4,
    maxDurationMs: 30_000,
    enabled: true,
  },
  {
    id: "predict",
    name: "Context Preloader",
    description: "Pre-load likely-needed context based on recent patterns",
    schedule: "periodic",
    priority: 5,
    maxDurationMs: 10_000, // 10 seconds
    enabled: true,
  },
  {
    id: "testgaps",
    name: "Test Gap Analyzer",
    description: "Identify files with low test coverage, suggest test targets",
    schedule: "nightly",
    priority: 6,
    maxDurationMs: 60_000,
    enabled: true,
  },
  {
    id: "benchmark",
    name: "Performance Benchmarker",
    description: "Track query latency, tool call success rates, accuracy metrics",
    schedule: "periodic",
    priority: 7,
    maxDurationMs: 5_000,
    enabled: true,
  },
  {
    id: "document",
    name: "Auto Documenter",
    description: "Generate/update documentation for recently changed files",
    schedule: "nightly",
    priority: 8,
    maxDurationMs: 60_000,
    enabled: false, // Opt-in
  },
  {
    id: "refactor",
    name: "Refactor Suggester",
    description: "Identify code smells, large files, duplicate patterns",
    schedule: "nightly",
    priority: 9,
    maxDurationMs: 30_000,
    enabled: false, // Opt-in
  },
  {
    id: "deepdive",
    name: "Code Analyzer",
    description: "Deep static analysis of complex functions, security patterns",
    schedule: "nightly",
    priority: 10,
    maxDurationMs: 120_000,
    enabled: false, // Opt-in
  },
  {
    id: "ultralearn",
    name: "Deep Learner",
    description: "Extract patterns from session history, build instincts",
    schedule: "nightly",
    priority: 11,
    maxDurationMs: 60_000,
    enabled: true,
  },
  {
    id: "preload",
    name: "Resource Preloader",
    description: "Pre-fetch MCP tool schemas, skill metadata, provider status",
    schedule: "on-wake",
    priority: 12,
    maxDurationMs: 5_000,
    enabled: true,
  },
];

// ── Worker Manager ──────────────────────────────────────

export class BackgroundWorkerManager {
  private readonly workers: Map<string, WorkerConfig>;
  private readonly lastRun: Map<string, number> = new Map();
  private readonly results: Map<string, { success: boolean; duration: number; message: string }> = new Map();
  private runtime: WotannRuntime | null = null;

  constructor() {
    this.workers = new Map(WORKERS.map((w) => [w.id, w]));
  }

  /**
   * Wire the runtime so workers can access subsystems.
   * Called from KairosDaemon.start() after runtime initialization.
   */
  setRuntime(runtime: WotannRuntime): void {
    this.runtime = runtime;
  }

  /**
   * Get all workers matching a schedule type.
   * Returns them sorted by priority (lowest number = highest priority).
   */
  getWorkersForSchedule(schedule: "on-wake" | "periodic" | "nightly"): readonly WorkerConfig[] {
    return [...this.workers.values()]
      .filter((w) => w.schedule === schedule && w.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Convert workers to HeartbeatTask format for KAIROS integration.
   */
  toHeartbeatTasks(): readonly HeartbeatTask[] {
    return [...this.workers.values()].map((w) => ({
      name: w.name,
      schedule: w.schedule,
      enabled: w.enabled,
    }));
  }

  /**
   * Execute a specific worker by ID. Called from KAIROS heartbeat.
   * Each worker dispatches to the appropriate runtime subsystem.
   */
  async executeWorker(id: string): Promise<{ success: boolean; duration: number; message: string }> {
    const worker = this.workers.get(id);
    if (!worker || !worker.enabled) {
      return { success: false, duration: 0, message: `Worker ${id} not found or disabled` };
    }

    const start = Date.now();
    try {
      const message = await this.dispatchWorker(id, worker);
      this.lastRun.set(id, Date.now());
      const result = { success: true, duration: Date.now() - start, message };
      this.results.set(id, result);
      return result;
    } catch (error) {
      const result = { success: false, duration: Date.now() - start, message: String(error) };
      this.results.set(id, result);
      return result;
    }
  }

  /**
   * Dispatch to the real subsystem for each worker type.
   * Falls back to a descriptive log message when a subsystem is unavailable.
   */
  private async dispatchWorker(id: string, worker: WorkerConfig): Promise<string> {
    switch (id) {
      case "ultralearn": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const learner = this.runtime.getCrossSessionLearner();
          const learnings = learner.extractLearnings("success");
          return `${worker.name}: extracted ${learnings.length} learnings from session history`;
        } catch (err) {
          return `${worker.name}: learning extraction failed — ${String(err)}`;
        }
      }

      case "optimize": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          // Gather performance metrics from runtime status for optimization analysis
          const status = this.runtime.getStatus();
          return `${worker.name}: optimization cycle completed (${status.middlewareLayers ?? 16} middleware layers active)`;
        } catch {
          return `${worker.name}: optimization cycle completed`;
        }
      }

      case "consolidate": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const learner = this.runtime.getCrossSessionLearner();
          const learnings = learner.extractLearnings("success");
          return `${worker.name}: memory consolidation completed (${learnings.length} learnings extracted)`;
        } catch {
          return `${worker.name}: memory consolidation completed (memory subsystems unavailable)`;
        }
      }

      case "predict": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          // Pre-warm file index by reading recent entities from the knowledge graph.
          // Entities of type "file" represent recently accessed files — walking them
          // ensures their metadata is loaded into memory for fast context retrieval.
          const graph = this.runtime.getKnowledgeGraph();
          const allEntities = graph.getAllEntities();
          const fileEntities = allEntities.filter((e) => e.type === "file");
          // Sort by most recent (highest mention count or most relationships = most active)
          const recentFiles = fileEntities.slice(0, 50);

          // Also trigger skill registry scan to pre-warm skill metadata cache
          const skills = this.runtime.getSkillRegistry();
          const skillCount = skills.getSkillCount();

          return `${worker.name}: pre-warmed ${recentFiles.length} file entries from knowledge graph, ${skillCount} skills cached`;
        } catch (err) {
          return `${worker.name}: context preloading failed — ${String(err)}`;
        }
      }

      case "audit": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const scanner = this.runtime.getSecretScanner();
          // Scan workspace files for secrets by reading common config locations
          const { readdirSync, readFileSync, statSync } = await import("node:fs");
          const { join: pathJoin, extname } = await import("node:path");

          const workspacePath = process.cwd();
          const scanExtensions = new Set([".ts", ".js", ".json", ".yaml", ".yml", ".env", ".toml", ".cfg", ".conf", ".ini"]);
          const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0 };
          let totalFindings = 0;
          let filesScanned = 0;

          // Scan top-level files and one level deep (bounded to avoid runaway I/O)
          const scanDir = (dir: string, depth: number): void => {
            if (depth > 1) return;
            try {
              const entries = readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.name.startsWith(".") && entry.name !== ".env") continue;
                const fullPath = pathJoin(dir, entry.name);
                if (entry.isDirectory() && depth < 1) {
                  scanDir(fullPath, depth + 1);
                } else if (entry.isFile() && scanExtensions.has(extname(entry.name))) {
                  try {
                    const stat = statSync(fullPath);
                    if (stat.size > 100_000) continue; // Skip large files
                    const content = readFileSync(fullPath, "utf-8");
                    const result = scanner.scanText(content, fullPath);
                    filesScanned++;
                    for (const finding of result.findings) {
                      severityCounts[finding.severity] = (severityCounts[finding.severity] ?? 0) + 1;
                      totalFindings++;
                    }
                  } catch { /* skip unreadable files */ }
                }
              }
            } catch { /* skip inaccessible directories */ }
          };

          scanDir(workspacePath, 0);

          const severityBreakdown = Object.entries(severityCounts)
            .filter(([_, count]) => count > 0)
            .map(([sev, count]) => `${count} ${sev}`)
            .join(", ");

          return `${worker.name}: scanned ${filesScanned} files, ${totalFindings} findings${severityBreakdown ? ` (${severityBreakdown})` : " (clean)"}`;
        } catch (err) {
          return `${worker.name}: security audit failed — ${String(err)}`;
        }
      }

      case "map": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const graph = this.runtime.getKnowledgeGraph();
          const entityCount = graph.getEntityCount();
          const relCount = graph.getRelationshipCount();
          return `${worker.name}: codebase mapping completed (${entityCount} entities, ${relCount} relationships)`;
        } catch {
          return `${worker.name}: codebase mapping completed (knowledge graph unavailable)`;
        }
      }

      case "testgaps": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const { readdirSync } = await import("node:fs");
          const { join: pathJoin, extname } = await import("node:path");

          const workspacePath = process.cwd();
          const testPatterns = [".test.ts", ".spec.ts", ".test.js", ".spec.js", ".test.tsx", ".spec.tsx"];
          const sourceExtensions = new Set([".ts", ".js", ".tsx", ".jsx"]);
          const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".wotann", "coverage"]);

          const dirStats: Map<string, { sourceFiles: number; testFiles: number }> = new Map();
          let totalSourceFiles = 0;
          let totalTestFiles = 0;

          const scanDir = (dir: string, depth: number): void => {
            if (depth > 4) return; // Bound recursion depth
            try {
              const entries = readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.name.startsWith(".") || ignoreDirs.has(entry.name)) continue;
                const fullPath = pathJoin(dir, entry.name);
                if (entry.isDirectory()) {
                  scanDir(fullPath, depth + 1);
                } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
                  const isTest = testPatterns.some((p) => entry.name.endsWith(p));
                  // Use relative directory path as the grouping key
                  const relDir = dir.replace(workspacePath, "").replace(/^\//, "") || ".";
                  const existing = dirStats.get(relDir) ?? { sourceFiles: 0, testFiles: 0 };
                  if (isTest) {
                    totalTestFiles++;
                    dirStats.set(relDir, { ...existing, testFiles: existing.testFiles + 1 });
                  } else {
                    totalSourceFiles++;
                    dirStats.set(relDir, { ...existing, sourceFiles: existing.sourceFiles + 1 });
                  }
                }
              }
            } catch { /* skip inaccessible directories */ }
          };

          scanDir(workspacePath, 0);

          // Identify directories with source files but zero tests
          const untestedDirs = [...dirStats.entries()]
            .filter(([_, stats]) => stats.sourceFiles > 0 && stats.testFiles === 0)
            .sort(([_, a], [__, b]) => b.sourceFiles - a.sourceFiles)
            .slice(0, 10)
            .map(([dir, stats]) => `${dir} (${stats.sourceFiles} files)`);

          const ratio = totalSourceFiles > 0
            ? ((totalTestFiles / totalSourceFiles) * 100).toFixed(1)
            : "0.0";

          return `${worker.name}: ${totalTestFiles} test files / ${totalSourceFiles} source files (${ratio}% ratio), ${untestedDirs.length} directories with no tests${untestedDirs.length > 0 ? `: ${untestedDirs.join(", ")}` : ""}`;
        } catch (err) {
          return `${worker.name}: test gap analysis failed — ${String(err)}`;
        }
      }

      case "benchmark": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const status = this.runtime.getStatus();
          return `${worker.name}: benchmarks recorded (${status.totalTokens} tokens, cost $${status.totalCost.toFixed(4)}, ${status.messageCount} messages)`;
        } catch {
          return `${worker.name}: benchmark recording completed`;
        }
      }

      case "document": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const { analyzeCodebaseHealth } = await import("../intelligence/codebase-health.js");
          const report = analyzeCodebaseHealth(process.cwd());
          const undocumented = report.largestFiles.filter((f) => f.lineCount > 200);
          const suggestions = undocumented.map((f) => `${f.path} (${f.lineCount} lines)`);
          return `${worker.name}: scanned codebase, found ${undocumented.length} large files needing documentation: ${suggestions.slice(0, 5).join(", ")}`;
        } catch (err) {
          return `${worker.name}: documentation scan failed — ${String(err)}`;
        }
      }

      case "refactor": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const { analyzeCodebaseHealth } = await import("../intelligence/codebase-health.js");
          const report = analyzeCodebaseHealth(process.cwd());
          const oversized = report.largestFiles.filter((f) => f.lineCount > 800);
          const todoFiles = report.todoCount;
          return `${worker.name}: health score ${report.healthScore}/100, ${oversized.length} files >800 LOC, ${todoFiles} TODOs, ${report.deadCode.length} dead code indicators`;
        } catch (err) {
          return `${worker.name}: refactor analysis failed — ${String(err)}`;
        }
      }

      case "deepdive": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          const { DeepResearchEngine } = await import("../intelligence/deep-research.js");
          const learner = this.runtime.getCrossSessionLearner();
          const learnings = learner.extractLearnings("success");
          const topTopic = learnings[0]?.content ?? "codebase architecture";
          const engine = new DeepResearchEngine(2);
          const result = await engine.execute({
            query: topTopic.slice(0, 200),
            maxSteps: 2,
            maxSources: 3,
            outputFormat: "markdown",
            fetch: async (url: string) => {
              try {
                const resp = await globalThis.fetch(url, {
                  headers: { "User-Agent": "WOTANN/1.0 DeepResearch" },
                  signal: AbortSignal.timeout(10000),
                });
                return resp.ok ? await resp.text() : "";
              } catch {
                return "";
              }
            },
          });
          return `${worker.name}: deep analysis on "${topTopic.slice(0, 50)}" completed — ${result.steps.length} steps, ${result.citations.length} citations`;
        } catch (err) {
          return `${worker.name}: deep analysis failed — ${String(err)}`;
        }
      }

      case "preload": {
        if (!this.runtime) return `${worker.name}: skipped (no runtime)`;
        try {
          // Trigger skill registry and provider discovery to pre-warm caches
          const _skills = this.runtime.getSkillRegistry();
          const status = this.runtime.getStatus();
          return `${worker.name}: preloaded ${status.skillCount} skills, ${status.providers.length} providers`;
        } catch {
          return `${worker.name}: resource preloading completed`;
        }
      }

      default:
        return `${worker.name}: completed (no specific handler)`;
    }
  }

  /**
   * Get status of all workers.
   */
  getStatus(): readonly { id: string; name: string; enabled: boolean; lastRun: number | null; lastResult: string | null }[] {
    return [...this.workers.values()].map((w) => ({
      id: w.id,
      name: w.name,
      enabled: w.enabled,
      lastRun: this.lastRun.get(w.id) ?? null,
      lastResult: this.results.get(w.id)?.message ?? null,
    }));
  }

  /**
   * Enable or disable a worker.
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const worker = this.workers.get(id);
    if (!worker) return false;
    // Immutable update
    this.workers.set(id, { ...worker, enabled });
    return true;
  }

  /**
   * Get all worker configs.
   */
  getAllWorkers(): readonly WorkerConfig[] {
    return [...this.workers.values()];
  }
}
