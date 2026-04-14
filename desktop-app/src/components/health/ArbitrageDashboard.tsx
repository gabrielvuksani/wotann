/**
 * Provider Arbitrage Dashboard — visual cost comparison across all providers.
 * "This query would cost $0.15 on Opus, $0.08 on GPT-5.4, $0.01 on Gemini"
 * One-click re-route to the optimal provider.
 */

import type React from "react";
import { useState, useCallback } from "react";
import { useStore } from "../../store";
import { getArbitrageEstimates } from "../../store/engine";
import type { ArbitrageEstimate } from "../../hooks/useTauriCommand";

const QUALITY_COLORS: Record<string, React.CSSProperties> = {
  best: { color: "var(--color-success)" },
  good: { color: "var(--info)" },
  acceptable: { color: "var(--color-warning)" },
};

export function ArbitrageDashboard() {
  const [estimates, setEstimates] = useState<readonly ArbitrageEstimate[]>([]);
  const [promptInput, setPromptInput] = useState("");
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const currentProvider = useStore((s) => s.provider);
  const setProvider = useStore((s) => s.setProvider);

  const fetchEstimates = useCallback(async () => {
    if (!promptInput.trim()) return;
    setLoading(true);
    setActivePrompt(promptInput);
    const results = await getArbitrageEstimates(promptInput);
    setEstimates(results);
    setLoading(false);
  }, [promptInput]);

  const cheapest = estimates.length > 0
    ? [...estimates].sort((a, b) => a.estimatedCost - b.estimatedCost)[0]
    : undefined;
  const fastest = estimates.length > 0
    ? [...estimates].sort((a, b) => a.estimatedLatencyMs - b.estimatedLatencyMs)[0]
    : undefined;

  return (
    <div className="h-full overflow-y-auto" style={{ padding: "var(--space-md)" }}>
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--color-text-primary)" }}>Provider Arbitrage</h2>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginTop: "var(--space-xs)" }}>
          Compare cost, speed, and quality across all providers for the same query
        </p>
      </div>

      {/* Prompt input for estimation */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-md)", marginBottom: "var(--space-md)" }}>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginBottom: "var(--space-sm)" }}>Enter a prompt to estimate costs:</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchEstimates()}
            placeholder="Describe what you want the model to do..."
            className="flex-1 transition-colors"
            style={{
              padding: "var(--space-sm) 12px",
              fontSize: "var(--font-size-sm)",
              boxShadow: "0px 0px 0px 1px rgba(255,255,255,0.1)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-3)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
            aria-label="Prompt for cost estimation"
          />
          <button
            onClick={fetchEstimates}
            disabled={!promptInput.trim() || loading}
            className="btn-press transition-colors"
            style={{
              padding: "var(--space-sm) var(--space-md)",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              borderRadius: "var(--radius-md)",
              border: "none",
              cursor: promptInput.trim() && !loading ? "pointer" : "not-allowed",
              ...(promptInput.trim() && !loading
                ? { background: "var(--color-primary)", color: "white" }
                : { background: "var(--surface-3)", color: "var(--color-text-muted)" }
              ),
            }}
            aria-label={loading ? "Estimating costs" : "Estimate costs"}
          >
            {loading ? "Estimating..." : "Estimate"}
          </button>
        </div>
      </div>

      {/* Active prompt display */}
      {activePrompt && (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-md)", marginBottom: "var(--space-md)" }}>
          <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginBottom: "var(--space-xs)" }}>Estimating cost for:</p>
          <p style={{ fontSize: "var(--font-size-sm)", fontStyle: "italic", color: "var(--color-text-primary)" }}>"{activePrompt}"</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-primary)" }} />
            Fetching estimates from providers...
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && estimates.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl border flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
              <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
                <path d="M2 8h12M8 2v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Enter a prompt above to compare provider costs
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {!loading && estimates.length > 0 && (
        <>
          {/* Quick stats */}
          <div className="grid grid-cols-3" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
            <div className="text-center" style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", padding: "12px", background: "var(--surface-2)" }}>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Cheapest</p>
              <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-success)" }}>{cheapest?.model}</p>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>${cheapest?.estimatedCost.toFixed(4)}</p>
            </div>
            <div className="text-center" style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", padding: "12px", background: "var(--surface-2)" }}>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Fastest</p>
              <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--info)" }}>{fastest?.model}</p>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>{fastest?.estimatedLatencyMs}ms</p>
            </div>
            <div className="text-center" style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", padding: "12px", background: "var(--surface-2)" }}>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Current</p>
              <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-primary)" }}>{currentProvider || "None"}</p>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>Active</p>
            </div>
          </div>

          {/* Provider cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {estimates.map((est) => {
              const isActive = est.provider.toLowerCase() === currentProvider;
              return (
                <div
                  key={est.model}
                  className="transition-colors"
                  style={{
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid",
                    padding: "var(--space-md)",
                    background: "var(--surface-2)",
                    borderColor: isActive ? "var(--border-focus)" : est.recommended ? "var(--color-success-muted)" : "var(--border-subtle)",
                  }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: "12px" }}>
                    <div className="flex items-center" style={{ gap: "12px" }}>
                      <div>
                        <div className="flex items-center" style={{ gap: "var(--space-sm)" }}>
                          <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>{est.model}</h3>
                          {est.recommended && (
                            <span style={{ fontSize: "var(--font-size-2xs)", padding: "2px 6px", borderRadius: 9999, background: "var(--color-success-muted)", color: "var(--color-success)" }}>
                              Recommended
                            </span>
                          )}
                          {isActive && (
                            <span style={{ fontSize: "var(--font-size-2xs)", padding: "2px 6px", borderRadius: 9999, background: "var(--accent-muted)", color: "var(--color-primary)" }}>
                              Active
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>{est.provider}</p>
                      </div>
                    </div>
                    {!isActive && (
                      <button
                        onClick={() => setProvider(est.provider.toLowerCase(), est.model)}
                        className="btn-press transition-colors"
                        style={{
                          padding: "4px 12px",
                          fontSize: "var(--font-size-xs)",
                          fontWeight: 500,
                          color: "white",
                          borderRadius: "var(--radius-md)",
                          background: "var(--color-primary)",
                          border: "none",
                          cursor: "pointer",
                        }}
                        aria-label={`Switch to ${est.model}`}
                      >
                        Switch
                      </button>
                    )}
                  </div>

                  {/* Metrics bar */}
                  <div className="grid grid-cols-3" style={{ gap: "12px" }}>
                    <div>
                      <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>Cost</p>
                      <p style={{ fontSize: "var(--font-size-sm)", fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>
                        ${est.estimatedCost.toFixed(4)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>Latency</p>
                      <p style={{ fontSize: "var(--font-size-sm)", fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>
                        {(est.estimatedLatencyMs / 1000).toFixed(1)}s
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>Quality</p>
                      <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, ...(QUALITY_COLORS[est.quality] ?? {}) }}>
                        {est.quality}
                      </p>
                    </div>
                  </div>

                  {/* Cost bar visualization */}
                  <div className="overflow-hidden" style={{ marginTop: "var(--space-sm)", height: 4, borderRadius: 9999, background: "var(--surface-3)" }}>
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 9999,
                        width: `${Math.min((est.estimatedCost / 0.02) * 100, 100)}%`,
                        background: est.estimatedCost === 0 ? "var(--color-success)" :
                          est.estimatedCost < 0.01 ? "var(--info)" :
                          "var(--color-primary)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
