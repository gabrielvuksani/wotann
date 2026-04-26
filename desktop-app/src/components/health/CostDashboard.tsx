/**
 * Cost tracking dashboard with usage breakdown.
 */

import { useState, useEffect } from "react";
import { useStore } from "../../store";
import { getCostDetails, getLifetimeTokenStats } from "../../store/engine";
import type { DayUsage, ProviderCostBreakdown } from "../../hooks/useTauriCommand";
import { ArbitrageDashboard } from "./ArbitrageDashboard";
import { color } from "../../design/tokens.generated";

type CostTab = "overview" | "providers";

const COST_TABS: readonly { readonly id: CostTab; readonly label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "providers", label: "Provider Comparison" },
];

/**
 * Map provider name to a CSS color. Tries provider-specific vars first
 * (`--color-provider-<id>`) and falls back to a deterministic palette
 * derived from the provider id's hash so any provider added in the
 * future gets a stable, distinguishable color without code changes.
 */
function providerBarColor(provider: string): string {
  const key = provider.toLowerCase();
  // First-class providers ship dedicated CSS vars; no enum check needed —
  // the var lookup falls back to undefined if absent and CSS treats
  // undefined-var-with-fallback as the fallback. See globals.css for
  // shipped first-class colors.
  return `var(--color-provider-${key}, ${derivedHashColor(key)})`;
}

/** Stable HSL color derived from a 32-bit hash of the provider id. */
function derivedHashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  }
  // 11 hue steps spread evenly so hashed neighbours don't collide; sat/lum
  // tuned to read against both light + dark surfaces.
  return `hsl(${(h % 360)}, 55%, 55%)`;
}

export function CostDashboard() {
  const [activeTab, setActiveTab] = useState<CostTab>("overview");
  const budgetLimit = useStore((s) => s.settings.budgetLimit ?? 50);
  const cost = useStore((s) => s.cost);
  const [dailyUsage, setDailyUsage] = useState<readonly DayUsage[]>([]);
  const [providerCosts, setProviderCosts] = useState<readonly ProviderCostBreakdown[]>([]);
  const [weekTokens, setWeekTokens] = useState(0);
  const [weekConversations, setWeekConversations] = useState(0);
  const [avgCostPerMessage, setAvgCostPerMessage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lifetimeStats, setLifetimeStats] = useState<{
    totalInputTokens: number;
    totalOutputTokens: number;
    sessionCount: number;
    byProvider: Record<string, { input: number; output: number }>;
    byModel: Record<string, { input: number; output: number }>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadDetails() {
      setLoading(true);
      setLoadError(null);
      try {
        const details = await getCostDetails();
        if (!cancelled && details) {
          setDailyUsage(details.dailyUsage);
          setProviderCosts(details.providerCosts);
          setWeekTokens(details.weekTokens);
          setWeekConversations(details.weekConversations);
          setAvgCostPerMessage(details.avgCostPerMessage);
        } else if (!cancelled && !details) {
          setLoadError("Could not load cost data. Engine may be disconnected.");
        }
        // Also load lifetime token stats
        const lifetime = await getLifetimeTokenStats();
        if (!cancelled && lifetime) {
          setLifetimeStats(lifetime);
        }
      } catch {
        if (!cancelled) setLoadError("Failed to load cost data. Check engine connection.");
      }
      if (!cancelled) setLoading(false);
    }
    loadDetails();
    return () => { cancelled = true; };
  }, []);

  const maxBar = Math.max(...dailyUsage.map((d) => d.cost), 0.01);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b animate-fadeIn" style={{ borderColor: "var(--border-subtle)", padding: "var(--space-md)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-xs)" }}>Cost Dashboard</h2>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
          Track spending across providers, models, and sessions
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center shrink-0" style={{ padding: "0 16px", borderBottom: "1px solid var(--border-subtle)" }} role="tablist" aria-label="Cost dashboard tabs">
        {COST_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className="btn-press"
              style={{
                padding: "10px 16px",
                fontSize: "var(--font-size-sm)",
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                border: "none",
                borderBottom: isActive ? "2px solid var(--color-primary)" : "2px solid transparent",
                background: "transparent",
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "providers" ? (
        <div className="flex-1 overflow-hidden" role="tabpanel">
          <ArbitrageDashboard />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto" style={{ padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
        {loadError && (
          <div role="alert" style={{ padding: "var(--space-md)", background: "var(--color-error-muted)", border: "1px solid var(--color-error)", borderRadius: "var(--radius-md)", color: "var(--color-error)", fontSize: "var(--font-size-sm)" }}>
            {loadError}
          </div>
        )}
        {/* Summary cards */}
        <div className="grid grid-cols-4" style={{ gap: "var(--space-sm)" }}>
          <CostCard label="Session" value={cost.sessionCost} />
          <CostCard label="Today" value={cost.todayCost} />
          <CostCard label="This Week" value={cost.weekCost} />
          <CostCard
            label="Budget Left"
            value={cost.budgetRemaining ?? 0}
            alert={cost.budgetRemaining !== null && cost.budgetRemaining < 10}
          />
        </div>

        {/* Daily usage chart */}
        <div style={{ background: color("surface"), border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-md)" }}>
          <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "-0.1px", marginBottom: "var(--space-md)" }}>Daily Usage (7 days)</h3>
          {loading ? (
            <div className="flex items-center justify-center" style={{ height: 128, fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              Loading usage data...
            </div>
          ) : dailyUsage.length === 0 ? (
            <div className="flex items-center justify-center" style={{ height: 128, fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              No usage data available
            </div>
          ) : (
            <div className="flex items-end" style={{ gap: "var(--space-sm)", height: 128 }}>
              {dailyUsage.map((day) => (
                <div key={day.date} className="flex-1 flex flex-col items-center" style={{ gap: "var(--space-xs)" }}>
                  <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>
                    {day.cost > 0 ? `$${day.cost.toFixed(2)}` : ""}
                  </span>
                  <div className="w-full flex flex-col justify-end" style={{ height: 80 }}>
                    <div
                      className="w-full transition-all"
                      style={{
                        background: "var(--gradient-accent)",
                        height: `${(day.cost / maxBar) * 100}%`,
                        minHeight: 2,
                        borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>{day.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Provider breakdown */}
        <div style={{ background: color("surface"), border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-md)" }}>
          <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "-0.1px", marginBottom: "var(--space-md)" }}>Spending by Provider (This Week)</h3>
          {loading ? (
            <div style={{ fontSize: "var(--font-size-xs)", textAlign: "center", padding: "var(--space-md) 0", color: "var(--color-text-muted)" }}>Loading...</div>
          ) : providerCosts.length === 0 ? (
            <div style={{ fontSize: "var(--font-size-xs)", textAlign: "center", padding: "var(--space-md) 0", color: "var(--color-text-muted)" }}>No provider data available</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {providerCosts.map((pc) => (
                <div key={pc.provider}>
                  <div className="flex items-center justify-between" style={{ fontSize: "var(--font-size-xs)", marginBottom: "var(--space-xs)" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>{pc.provider}</span>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      ${pc.cost.toFixed(2)} ({pc.percentage}%)
                    </span>
                  </div>
                  <div className="overflow-hidden" style={{ height: 6, borderRadius: "var(--radius-pill)", background: "var(--surface-3)" }}>
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "var(--radius-pill)",
                        background: providerBarColor(pc.provider),
                        width: `${pc.percentage}%`,
                        transition: "width 400ms var(--ease-expo)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Token stats */}
        <div style={{ background: color("surface"), border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-md)" }}>
          <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "-0.1px", marginBottom: "var(--space-md)" }}>Token Summary</h3>
          {loading ? (
            <div style={{ fontSize: "var(--font-size-xs)", textAlign: "center", padding: "var(--space-md) 0", color: "var(--color-text-muted)" }}>Loading...</div>
          ) : (
            <div className="grid grid-cols-3" style={{ gap: "var(--space-md)" }}>
              <div>
                <div style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.5px" }}>
                  {weekTokens >= 1000 ? `${(weekTokens / 1000).toFixed(0)}K` : weekTokens}
                </div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Tokens this week</div>
              </div>
              <div>
                <div style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)" }}>{weekConversations}</div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Conversations</div>
              </div>
              <div>
                <div style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)" }}>${avgCostPerMessage.toFixed(3)}</div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Avg cost/msg</div>
              </div>
            </div>
          )}
        </div>

        {/* Lifetime Stats */}
        {lifetimeStats && (
          <div style={{ background: color("surface"), border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-md)" }}>
            <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "-0.1px", marginBottom: "var(--space-md)" }}>Lifetime Stats</h3>
            <div className="grid grid-cols-3" style={{ gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
              <div>
                <div style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {(lifetimeStats.totalInputTokens + lifetimeStats.totalOutputTokens) >= 1_000_000
                    ? `${((lifetimeStats.totalInputTokens + lifetimeStats.totalOutputTokens) / 1_000_000).toFixed(1)}M`
                    : (lifetimeStats.totalInputTokens + lifetimeStats.totalOutputTokens) >= 1000
                      ? `${((lifetimeStats.totalInputTokens + lifetimeStats.totalOutputTokens) / 1000).toFixed(0)}K`
                      : lifetimeStats.totalInputTokens + lifetimeStats.totalOutputTokens}
                </div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Total tokens (all sessions)</div>
              </div>
              <div>
                <div style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)" }}>{lifetimeStats.sessionCount}</div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Total sessions</div>
              </div>
              <div>
                <div style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {Object.keys(lifetimeStats.byProvider).length}
                </div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Providers used</div>
              </div>
            </div>
            {/* Breakdown by provider */}
            {Object.keys(lifetimeStats.byProvider).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--color-text-secondary)" }}>By Provider</div>
                {Object.entries(lifetimeStats.byProvider).map(([provider, stats]) => (
                  <div key={provider} className="flex items-center justify-between" style={{ fontSize: "var(--font-size-xs)" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>{provider}</span>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      {(stats.input + stats.output) >= 1000
                        ? `${((stats.input + stats.output) / 1000).toFixed(0)}K tokens`
                        : `${stats.input + stats.output} tokens`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Breakdown by model */}
            {Object.keys(lifetimeStats.byModel).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "var(--space-sm)" }}>
                <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--color-text-secondary)" }}>By Model</div>
                {Object.entries(lifetimeStats.byModel).map(([model, stats]) => (
                  <div key={model} className="flex items-center justify-between" style={{ fontSize: "var(--font-size-xs)" }}>
                    <span style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>{model}</span>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      {(stats.input + stats.output) >= 1000
                        ? `${((stats.input + stats.output) / 1000).toFixed(0)}K tokens`
                        : `${stats.input + stats.output} tokens`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Budget progress */}
        {cost.budgetRemaining !== null && (
          <div style={{ background: color("surface"), border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-md)" }}>
            <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "-0.1px", marginBottom: 12 }}>Monthly Budget</h3>
            <div className="flex items-center justify-between" style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginBottom: "6px" }}>
              <span>
                ${(budgetLimit - cost.budgetRemaining).toFixed(2)} spent
              </span>
              <span>${cost.budgetRemaining.toFixed(2)} remaining</span>
            </div>
            <div className="overflow-hidden" style={{ height: 8, borderRadius: "var(--radius-pill)", background: "var(--surface-3)" }}>
              <div
                style={{
                  height: "100%",
                  borderRadius: "var(--radius-pill)",
                  background: cost.budgetRemaining < 10
                    ? "var(--color-error)"
                    : cost.budgetRemaining < 25
                      ? "var(--color-warning)"
                      : "var(--color-primary)",
                  width: `${((budgetLimit - cost.budgetRemaining) / budgetLimit) * 100}%`,
                  transition: "width 400ms var(--ease-expo), background 200ms var(--ease-expo)",
                }}
              />
            </div>
            <div style={{ fontSize: "var(--font-size-2xs)", marginTop: "var(--space-xs)", color: "var(--color-text-muted)" }}>${budgetLimit.toFixed(2)} monthly limit</div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function CostCard({
  label,
  value,
  alert = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly alert?: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        border: "1px solid",
        padding: "14px 16px",
        background: alert ? "var(--color-warning-muted)" : color("surface"),
        borderColor: alert ? "var(--color-warning)" : "var(--border-subtle)",
        transition: "border-color 200ms var(--ease-expo)",
      }}
    >
      <div style={{ fontSize: "var(--font-size-2xs)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500, color: "var(--color-text-muted)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: alert ? "var(--color-warning)" : "var(--color-text-primary)", letterSpacing: "-0.5px" }}>
        ${value.toFixed(2)}
      </div>
    </div>
  );
}
