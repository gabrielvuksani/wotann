/**
 * Provider Cost Dashboard -- real-time cost tracking with per-provider breakdown,
 * budget alerts, and cost-per-quality optimization.
 *
 * Tracks cost, token usage, and quality scores per provider/model combination.
 * Provides daily, weekly, and monthly breakdowns. Finds cheapest provider
 * for a given task type. Renders a formatted text dashboard.
 */

// -- Types -------------------------------------------------------------------

export interface CostRecord {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly tokens: number;
  readonly cost: number;
  readonly quality: number;
  readonly taskType: string;
  readonly timestamp: number;
}

export interface ProviderCostBreakdown {
  readonly date: string;
  readonly providers: readonly ProviderSummary[];
  readonly totalCost: number;
  readonly totalTokens: number;
}

export interface ProviderSummary {
  readonly provider: string;
  readonly model: string;
  readonly cost: number;
  readonly tokens: number;
  readonly requestCount: number;
  readonly avgQuality: number;
  readonly costPerKToken: number;
}

export interface CheapestRoute {
  readonly taskType: string;
  readonly provider: string;
  readonly model: string;
  readonly avgCost: number;
  readonly avgQuality: number;
  readonly sampleSize: number;
}

export interface BudgetAlert {
  readonly level: "warning" | "critical" | "exceeded";
  readonly budget: number;
  readonly spent: number;
  readonly percentUsed: number;
  readonly message: string;
}

// -- Implementation ----------------------------------------------------------

export class ProviderCostDashboard {
  private readonly records: CostRecord[] = [];
  private idCounter = 0;

  /**
   * Track a cost record for a provider/model combination.
   */
  recordCost(
    provider: string,
    model: string,
    tokens: number,
    cost: number,
    quality: number,
    taskType = "general",
  ): CostRecord {
    const record: CostRecord = {
      id: `cr_${++this.idCounter}`,
      provider,
      model,
      tokens,
      cost,
      quality: Math.max(0, Math.min(1, quality)),
      taskType,
      timestamp: Date.now(),
    };
    this.records.push(record);
    return record;
  }

  /**
   * Get a daily cost breakdown for a specific date (YYYY-MM-DD).
   */
  getDailyBreakdown(date: string): ProviderCostBreakdown {
    const dayRecords = this.records.filter((r) => toDateString(r.timestamp) === date);
    return buildBreakdown(date, dayRecords);
  }

  /**
   * Get a weekly breakdown (last 7 days ending on the given date).
   */
  getWeeklyBreakdown(endDate: string): ProviderCostBreakdown {
    // Use timestamp math to avoid timezone issues with Date string parsing
    const endMs = Date.parse(endDate) + 24 * 60 * 60 * 1000; // End of the end day (exclusive next day)
    const startMs = endMs - 8 * 24 * 60 * 60 * 1000; // 7 full days before end day

    const weekRecords = this.records.filter((r) => r.timestamp >= startMs && r.timestamp < endMs);

    return buildBreakdown(`week ending ${endDate}`, weekRecords);
  }

  /**
   * Find the cheapest provider for a given task type based on historical data.
   */
  getCheapestForTask(taskType: string): CheapestRoute | null {
    const relevant = this.records.filter((r) => r.taskType === taskType);
    if (relevant.length === 0) return null;

    // Group by provider+model
    const groups = new Map<string, CostRecord[]>();
    for (const r of relevant) {
      const key = `${r.provider}:${r.model}`;
      const group = groups.get(key) ?? [];
      group.push(r);
      groups.set(key, group);
    }

    let cheapest: CheapestRoute | null = null;

    for (const [key, records] of groups) {
      const [provider, model] = key.split(":") as [string, string];
      const avgCost = records.reduce((s, r) => s + r.cost, 0) / records.length;
      const avgQuality = records.reduce((s, r) => s + r.quality, 0) / records.length;

      if (cheapest === null || avgCost < cheapest.avgCost) {
        cheapest = {
          taskType,
          provider,
          model,
          avgCost,
          avgQuality,
          sampleSize: records.length,
        };
      }
    }

    return cheapest;
  }

  /**
   * Check budget and return an alert if thresholds are crossed.
   */
  checkBudget(budget: number): BudgetAlert | null {
    const spent = this.records.reduce((s, r) => s + r.cost, 0);
    const percentUsed = (spent / budget) * 100;

    if (percentUsed >= 100) {
      return {
        level: "exceeded",
        budget,
        spent,
        percentUsed,
        message: `Budget EXCEEDED: $${spent.toFixed(4)} spent of $${budget.toFixed(2)} budget (${percentUsed.toFixed(1)}%)`,
      };
    }

    if (percentUsed >= 90) {
      return {
        level: "critical",
        budget,
        spent,
        percentUsed,
        message: `Budget CRITICAL: $${spent.toFixed(4)} of $${budget.toFixed(2)} (${percentUsed.toFixed(1)}%)`,
      };
    }

    if (percentUsed >= 75) {
      return {
        level: "warning",
        budget,
        spent,
        percentUsed,
        message: `Budget warning: $${spent.toFixed(4)} of $${budget.toFixed(2)} (${percentUsed.toFixed(1)}%)`,
      };
    }

    return null;
  }

  /**
   * Render a formatted text dashboard.
   */
  renderDashboard(): string {
    const today = toDateString(Date.now());
    const breakdown = this.getDailyBreakdown(today);
    const totalSpent = this.records.reduce((s, r) => s + r.cost, 0);
    const totalTokens = this.records.reduce((s, r) => s + r.tokens, 0);

    const lines: string[] = [
      "=== Provider Cost Dashboard ===",
      "",
      `Total Spent: $${totalSpent.toFixed(4)}`,
      `Total Tokens: ${totalTokens.toLocaleString()}`,
      `Total Requests: ${this.records.length}`,
      "",
      `--- Today (${today}) ---`,
      `Cost: $${breakdown.totalCost.toFixed(4)}`,
      `Tokens: ${breakdown.totalTokens.toLocaleString()}`,
      "",
    ];

    if (breakdown.providers.length > 0) {
      lines.push("Provider Breakdown:");
      for (const p of breakdown.providers) {
        lines.push(
          `  ${p.provider}/${p.model}: $${p.cost.toFixed(4)} | ${p.requestCount} reqs | avg quality: ${(p.avgQuality * 100).toFixed(0)}%`,
        );
      }
    } else {
      lines.push("No activity today.");
    }

    return lines.join("\n");
  }

  /**
   * Get total record count (useful for testing).
   */
  getRecordCount(): number {
    return this.records.length;
  }

  /**
   * Get all records (read-only snapshot).
   */
  getRecords(): readonly CostRecord[] {
    return [...this.records];
  }
}

// -- Helpers -----------------------------------------------------------------

function toDateString(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0] ?? "";
}

function buildBreakdown(label: string, records: readonly CostRecord[]): ProviderCostBreakdown {
  const groups = new Map<string, CostRecord[]>();
  for (const r of records) {
    const key = `${r.provider}:${r.model}`;
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }

  const providers: ProviderSummary[] = [...groups.entries()].map(([key, recs]) => {
    const [provider, model] = key.split(":") as [string, string];
    const totalCost = recs.reduce((s, r) => s + r.cost, 0);
    const totalTokens = recs.reduce((s, r) => s + r.tokens, 0);
    const avgQuality = recs.reduce((s, r) => s + r.quality, 0) / recs.length;

    return {
      provider,
      model,
      cost: totalCost,
      tokens: totalTokens,
      requestCount: recs.length,
      avgQuality,
      costPerKToken: totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0,
    };
  });

  return {
    date: label,
    providers,
    totalCost: records.reduce((s, r) => s + r.cost, 0),
    totalTokens: records.reduce((s, r) => s + r.tokens, 0),
  };
}
