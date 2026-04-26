/**
 * Per-repository model performance tracking.
 * Stores local outcomes so routing decisions can adapt to the current repo.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { dirname } from "node:path";
import type { ProviderName } from "../core/types.js";

export interface RepoModelPerformanceRecord {
  readonly provider: ProviderName;
  readonly model: string;
  readonly successes: number;
  readonly failures: number;
  readonly avgLatencyMs: number;
  readonly avgCostUsd: number;
  readonly totalTokens: number;
  readonly lastUsedAt: string;
}

export interface RepoModelOutcome {
  readonly provider: ProviderName;
  readonly model: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly tokensUsed: number;
  readonly costUsd: number;
}

export class RepoModelPerformanceStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): readonly RepoModelPerformanceRecord[] {
    if (!existsSync(this.filePath)) return [];

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as RepoModelPerformanceRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  record(outcome: RepoModelOutcome): readonly RepoModelPerformanceRecord[] {
    const existing = this.load();
    const key = `${outcome.provider}:${outcome.model}`;
    const byKey = new Map(existing.map((record) => [`${record.provider}:${record.model}`, record]));
    const current = byKey.get(key);

    const successes = (current?.successes ?? 0) + (outcome.success ? 1 : 0);
    const failures = (current?.failures ?? 0) + (outcome.success ? 0 : 1);
    const previousRuns = (current?.successes ?? 0) + (current?.failures ?? 0);
    const nextRuns = previousRuns + 1;

    byKey.set(key, {
      provider: outcome.provider,
      model: outcome.model,
      successes,
      failures,
      avgLatencyMs: rollingAverage(
        current?.avgLatencyMs ?? outcome.durationMs,
        outcome.durationMs,
        nextRuns,
      ),
      avgCostUsd: rollingAverage(current?.avgCostUsd ?? outcome.costUsd, outcome.costUsd, nextRuns),
      totalTokens: (current?.totalTokens ?? 0) + outcome.tokensUsed,
      lastUsedAt: new Date().toISOString(),
    });

    const next = [...byKey.values()].sort((a, b) =>
      `${a.provider}:${a.model}`.localeCompare(`${b.provider}:${b.model}`),
    );

    mkdirSync(dirname(this.filePath), { recursive: true });
    // Wave 6.5-UU (H-22) — model perf history feeds the cost-aware router.
    // Atomic write so a crash mid-flush doesn't trash routing telemetry.
    writeFileAtomic(this.filePath, JSON.stringify(next, null, 2));
    return next;
  }
}

function rollingAverage(previous: number, nextValue: number, runCount: number): number {
  if (runCount <= 1) return nextValue;
  return (previous * (runCount - 1) + nextValue) / runCount;
}
