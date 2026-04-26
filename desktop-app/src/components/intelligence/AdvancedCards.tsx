/**
 * Advanced card components for the Intelligence Dashboard (Tier 2/3/4).
 *
 * TaskRouterCard, MemoryQualityCard, BenchmarkCard, WakeUpContextCard
 *
 * Each card wraps one or more KAIROS RPC endpoints that previously had
 * zero client callers.
 */

import { useState, useEffect, useCallback } from "react";
import { rpc, Card, StatusBadge } from "./intelligenceUtils";

// ── Domain types (readonly, strict) ──────────────────

interface RouteClassification {
  readonly taskType: string;
  readonly complexity: string;
  readonly recommendedModel: string;
}

interface FenceStats {
  readonly totalFenced: number;
  readonly totalBlocked: number;
  readonly activeFences: number;
  readonly oldestFenceAge: number;
}

interface RecommendedWeights {
  readonly fts5: number;
  readonly vector: number;
  readonly temporal: number;
  readonly frequency: number;
}

interface QualityMetrics {
  readonly totalRetrievals: number;
  readonly feedbackCount: number;
  readonly usefulRate: number;
  readonly avgResultCount: number;
  readonly avgDurationMs: number;
  readonly methodBreakdown: Readonly<Record<string, { count: number; usefulRate: number }>>;
  readonly domainBreakdown: Readonly<Record<string, { count: number; usefulRate: number }>>;
  readonly recommendedWeights: RecommendedWeights;
}

interface BenchmarkRun {
  readonly id: string;
  readonly type: string;
  readonly score: number;
  readonly maxScore: number;
  readonly percentile: number;
  readonly modelId: string;
  readonly timestamp: number;
  readonly durationMs: number;
}

interface BenchmarkHistory {
  readonly history: {
    readonly type: string;
    readonly runs: readonly BenchmarkRun[];
    readonly bestScore: number;
    readonly trend: "improving" | "stable" | "declining";
    readonly avgImprovement: number;
  };
}

interface WakeUpPayload {
  readonly content: string;
  readonly tokens: number;
}

// ── Complexity color map ─────────────────────────────

const COMPLEXITY_COLORS: Readonly<Record<string, string>> = {
  trivial: "var(--color-text-dim)",
  simple: "var(--green)",
  moderate: "var(--color-warning)",
  complex: "var(--color-warning)",
  expert: "var(--color-error)",
};

// ── Trend arrow helper ───────────────────────────────

function trendArrow(trend: "improving" | "stable" | "declining"): string {
  if (trend === "improving") return "\u2191";
  if (trend === "declining") return "\u2193";
  return "\u2192";
}

function trendColor(trend: "improving" | "stable" | "declining"): string {
  if (trend === "improving") return "var(--green)";
  if (trend === "declining") return "var(--color-error)";
  return "var(--color-text-dim)";
}

// ── Card 1: Task Router Card ─────────────────────────

export function TaskRouterCard() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<RouteClassification | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClassify = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    const res = await rpc("route.classify", { prompt: prompt.trim() });
    if (res) setResult(res as RouteClassification);
    setLoading(false);
  }, [prompt]);

  return (
    <Card title="Task Router">
      <div style={{ display: "flex", gap: "var(--space-xs)" }}>
        <input
          type="text"
          placeholder="Test prompt classification..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleClassify(); }}
          style={{
            flex: 1,
            background: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "4px 8px",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-primary)",
            outline: "none",
            fontFamily: "var(--font-sans)",
          }}
        />
        <button
          onClick={handleClassify}
          className="btn-press"
          disabled={loading}
          style={{
            padding: "4px 10px",
            fontSize: "var(--font-size-2xs)",
            background: "var(--surface-1)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "..." : "Classify"}
        </button>
      </div>
      {result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
            <StatusBadge text={result.taskType} color="var(--accent)" />
            <StatusBadge
              text={result.complexity}
              color={COMPLEXITY_COLORS[result.complexity] ?? "var(--color-text-dim)"}
            />
          </div>
          <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>
            Recommended:{" "}
            <span style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
              {result.recommendedModel}
            </span>
          </div>
        </div>
      ) : (
        <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
          Enter a prompt to see routing classification
        </span>
      )}
    </Card>
  );
}

// ── Card 2: Memory Intelligence Card ─────────────────

export function MemoryQualityCard() {
  const [quality, setQuality] = useState<QualityMetrics | null>(null);
  const [fence, setFence] = useState<FenceStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([rpc("memory.quality"), rpc("memory.fence")]).then(([q, f]) => {
      if (cancelled) return;
      if (q) setQuality(q as QualityMetrics);
      if (f) setFence(f as FenceStats);
    });
    return () => { cancelled = true; };
  }, []);

  const weights = quality?.recommendedWeights;
  const maxWeight = weights
    ? Math.max(weights.fts5, weights.vector, weights.temporal, weights.frequency, 1)
    : 1;

  return (
    <Card title="Memory Intelligence">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        {/* Stats row */}
        <div style={{ display: "flex", gap: "var(--space-md)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
              {quality?.totalRetrievals ?? "--"}
            </span>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>retrievals</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--green)", fontFamily: "var(--font-mono)" }}>
              {quality ? `${Math.round(quality.usefulRate * 100)}%` : "--"}
            </span>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>useful</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
              {quality ? `${Math.round(quality.avgDurationMs)}ms` : "--"}
            </span>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>avg latency</span>
          </div>
        </div>

        {/* Recommended weights bar chart */}
        {weights && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", fontWeight: 500 }}>
              Recommended Weights
            </span>
            {(["fts5", "vector", "temporal", "frequency"] as const).map((key) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", width: 56, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                  {key}
                </span>
                <div style={{ flex: 1, height: 8, background: "var(--surface-1)", borderRadius: "var(--radius-xs)", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${(weights[key] / maxWeight) * 100}%`,
                      background: "var(--accent)",
                      borderRadius: "var(--radius-xs)",
                      transition: "width 0.3s ease",
                      minWidth: 2,
                    }}
                  />
                </div>
                <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", width: 32 }}>
                  {weights[key].toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Fence stats */}
        {fence && (
          <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "var(--surface-1)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--accent)", fontWeight: 600 }}>{fence.activeFences}</span>
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>active fences</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "var(--surface-1)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-error)", fontWeight: 600 }}>{fence.totalBlocked}</span>
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>blocked</span>
            </div>
          </div>
        )}

        {!quality && !fence && (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
            No memory data available
          </span>
        )}
      </div>
    </Card>
  );
}

// ── Card 3: Benchmark Card ───────────────────────────

export function BenchmarkCard() {
  const [data, setData] = useState<BenchmarkHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("benchmark.history", { type: "accuracy" }).then((res) => {
      if (!cancelled && res) setData(res as BenchmarkHistory);
    });
    return () => { cancelled = true; };
  }, []);

  const history = data?.history;
  const lastRun = history?.runs.length
    ? history.runs[history.runs.length - 1]
    : null;

  return (
    <Card title="Benchmark Scores">
      {history ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          {/* Best score + trend */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)" }}>
            <span style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
              {Math.round(history.bestScore)}
            </span>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>best</span>
            <span
              style={{
                fontSize: "var(--font-size-sm)",
                fontWeight: 700,
                color: trendColor(history.trend),
              }}
              title={`Trend: ${history.trend}`}
            >
              {trendArrow(history.trend)}
            </span>
            <StatusBadge text={history.trend} color={trendColor(history.trend)} />
          </div>

          {/* Run count + last run */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
              {history.runs.length} run{history.runs.length !== 1 ? "s" : ""} recorded
            </span>
            {lastRun && (
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>
                Last: {new Date(lastRun.timestamp).toLocaleDateString()} ({lastRun.modelId})
              </span>
            )}
          </div>

          {/* Mini sparkline of recent scores */}
          {history.runs.length > 1 && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 32 }} aria-label="Recent benchmark scores">
              {history.runs.slice(-10).map((run, i) => {
                const pct = history.bestScore > 0 ? (run.percentile / history.bestScore) * 100 : 0;
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      background: "var(--accent)",
                      borderRadius: "2px 2px 0 0",
                      height: `${Math.max(pct, 4)}%`,
                      minHeight: 2,
                      transition: "height 0.3s ease",
                    }}
                    title={`Score: ${run.percentile}`}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
          No benchmark data available
        </span>
      )}
    </Card>
  );
}

// ── Card 4: Wake-up Context Card ─────────────────────

export function WakeUpContextCard() {
  const [data, setData] = useState<WakeUpPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("wakeup.payload").then((res) => {
      if (!cancelled && res) setData(res as WakeUpPayload);
    });
    return () => { cancelled = true; };
  }, []);

  const preview = data?.content
    ? data.content.length > 200
      ? `${data.content.slice(0, 200)}...`
      : data.content
    : null;

  return (
    <Card title="Wake-up Context">
      {data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)" }}>
            <span style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
              {data.tokens.toLocaleString()}
            </span>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>tokens</span>
          </div>
          {preview && (
            <div
              style={{
                fontSize: "var(--font-size-2xs)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-mono)",
                background: "var(--surface-1)",
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
                maxHeight: 80,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.4,
              }}
            >
              {preview}
            </div>
          )}
        </div>
      ) : (
        <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
          No wake-up payload available
        </span>
      )}
    </Card>
  );
}
