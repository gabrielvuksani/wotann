/**
 * Individual card components for the Intelligence Dashboard.
 *
 * Each card wraps one KAIROS RPC subsystem:
 *   HealthScoreCard, FlowActivityCard, DecisionLogCard, PWRPhaseCard,
 *   AmbientSignalsCard, TriggersCard, DeviceContextCard, IdleStatusCard,
 *   SpecDivergenceCard, FileSearchCard
 */

import { useState, useEffect, useCallback } from "react";
import { HealthGauge } from "./HealthGauge";
import { PWRStepper } from "./PWRStepper";
import { rpc, Card, StatusBadge, formatTimeAgo } from "./intelligenceUtils";
import type {
  HealthReport,
  FlowInsights,
  Decision,
  PWRStatus,
  AmbientStatus,
  Trigger,
  DeviceContext,
  IdleStatus,
  SpecDivergence,
  FileSearchResult,
} from "./intelligenceUtils";

// ── Health Score Card ─────────────────────────────────

export function HealthScoreCard() {
  const [data, setData] = useState<HealthReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("health.report").then((res) => {
      if (!cancelled && res) setData(res as HealthReport);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card title="Health Score">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <HealthGauge score={data?.score ?? 0} size={96} label="Codebase" />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {data?.issues?.slice(0, 4).map((issue, i) => (
            <div
              key={i}
              style={{
                fontSize: "var(--font-size-2xs)",
                color: issue.severity === "high" ? "var(--red)" : "var(--color-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: issue.severity === "high" ? "var(--red)" : issue.severity === "medium" ? "var(--color-warning)" : "var(--color-text-dim)",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              {issue.message}
            </div>
          )) ?? (
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
              No health data available
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Flow Activity Card ────────────────────────────────

export function FlowActivityCard() {
  const [data, setData] = useState<FlowInsights | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("flow.insights").then((res) => {
      if (!cancelled && res) setData(res as FlowInsights);
    });
    return () => { cancelled = true; };
  }, []);

  const maxVelocity = Math.max(...(data?.recentActions?.map((a) => a.velocity) ?? [1]), 1);

  return (
    <Card title="Flow Activity">
      {data?.struggling && (
        <div
          style={{
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-warning)",
            background: "var(--color-warning-muted)",
            padding: "3px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-warning)",
          }}
        >
          Struggle detected
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48 }} aria-label="Recent action velocity">
        {(data?.recentActions ?? []).slice(-10).map((action, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: "var(--accent)",
              borderRadius: "2px 2px 0 0",
              height: `${(action.velocity / maxVelocity) * 100}%`,
              minHeight: 2,
              transition: "height 0.3s ease",
            }}
            title={`${action.action}: ${action.velocity}`}
          />
        ))}
        {(!data?.recentActions || data.recentActions.length === 0) && (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>No actions tracked yet</span>
        )}
      </div>
      {data?.hotspots && data.hotspots.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", fontWeight: 500 }}>Hotspots</span>
          {data.hotspots.slice(0, 3).map((file) => (
            <span key={file} style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Decision Log Card ─────────────────────────────────

const DECISION_STATUS_COLORS: Record<string, string> = {
  active: "var(--color-success)",
  superseded: "var(--color-warning)",
  reverted: "var(--color-error)",
};

export function DecisionLogCard() {
  const [decisions, setDecisions] = useState<readonly Decision[]>([]);
  const [recording, setRecording] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newRationale, setNewRationale] = useState("");

  useEffect(() => {
    let cancelled = false;
    rpc("decisions.list").then((res) => {
      if (!cancelled && res) setDecisions(res as readonly Decision[]);
    });
    return () => { cancelled = true; };
  }, []);

  const handleRecord = useCallback(async () => {
    if (!newTitle.trim()) return;
    await rpc("decisions.record", { title: newTitle.trim(), rationale: newRationale.trim() });
    setNewTitle("");
    setNewRationale("");
    setRecording(false);
    const updated = await rpc("decisions.list");
    if (updated) setDecisions(updated as readonly Decision[]);
  }, [newTitle, newRationale]);

  return (
    <Card title="Decision Log">
      {recording ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <input
            type="text"
            placeholder="Decision title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "4px 8px", fontSize: "var(--font-size-xs)", color: "var(--color-text-primary)", outline: "none", fontFamily: "var(--font-sans)" }}
          />
          <textarea
            placeholder="Rationale..."
            value={newRationale}
            onChange={(e) => setNewRationale(e.target.value)}
            rows={2}
            style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "4px 8px", fontSize: "var(--font-size-2xs)", color: "var(--color-text-secondary)", outline: "none", resize: "none", fontFamily: "var(--font-sans)" }}
          />
          <div style={{ display: "flex", gap: "var(--space-xs)" }}>
            <button onClick={handleRecord} className="btn-press" style={{ padding: "4px 10px", fontSize: "var(--font-size-2xs)", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
              Save
            </button>
            <button onClick={() => setRecording(false)} className="btn-press" style={{ padding: "4px 10px", fontSize: "var(--font-size-2xs)", background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, maxHeight: 160 }}>
            {decisions.length === 0 ? (
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>No decisions recorded</span>
            ) : (
              decisions.slice(0, 8).map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "start", gap: 6, padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-primary)", fontWeight: 500 }}>{d.title}</div>
                    <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.rationale}</div>
                  </div>
                  <StatusBadge text={d.status} color={DECISION_STATUS_COLORS[d.status] ?? "var(--color-text-dim)"} />
                </div>
              ))
            )}
          </div>
          <button onClick={() => setRecording(true)} className="btn-press" style={{ padding: "4px 10px", fontSize: "var(--font-size-2xs)", background: "var(--surface-1)", color: "var(--color-text-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", cursor: "pointer", alignSelf: "flex-start" }}>
            + Record Decision
          </button>
        </>
      )}
    </Card>
  );
}

// ── PWR Phase Card ────────────────────────────────────

const DEFAULT_PHASES: readonly string[] = ["discuss", "plan", "implement", "review", "uat", "ship"];

export function PWRPhaseCard() {
  const [status, setStatus] = useState<PWRStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("pwr.status").then((res) => {
      if (!cancelled && res) setStatus(res as PWRStatus);
    });
    return () => { cancelled = true; };
  }, []);

  const handleAdvance = useCallback(async (nextPhase: string) => {
    await rpc("pwr.advance", { message: `Advancing to ${nextPhase}` });
    const updated = await rpc("pwr.status");
    if (updated) setStatus(updated as PWRStatus);
  }, []);

  return (
    <Card title="PWR Phase">
      <PWRStepper
        currentPhase={status?.phase ?? "discuss"}
        phases={status?.phases ?? DEFAULT_PHASES}
        onAdvance={handleAdvance}
      />
      <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
        Current: <strong style={{ color: "var(--color-text-secondary)" }}>{status?.phase ?? "discuss"}</strong>
      </span>
    </Card>
  );
}

// ── Ambient Signals Card ──────────────────────────────

const SIGNAL_LABELS: Record<string, string> = { clipboard: "clip", file: "file", terminal: "term" };

export function AmbientSignalsCard() {
  const [data, setData] = useState<AmbientStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("ambient.status").then((res) => {
      if (!cancelled && res) setData(res as AmbientStatus);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card title="Ambient Signals">
      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        {(data?.signals ?? []).map((s) => (
          <div key={s.type} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "var(--surface-1)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--accent)", fontWeight: 600 }}>{s.count}</span>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>{SIGNAL_LABELS[s.type] ?? s.type}</span>
          </div>
        ))}
        {(!data?.signals || data.signals.length === 0) && (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>No signals</span>
        )}
      </div>
      {data?.latestSuggestion && (
        <div style={{ padding: "6px 8px", background: "rgba(10, 132, 255, 0.06)", borderRadius: "var(--radius-sm)", border: "1px solid rgba(10, 132, 255, 0.15)" }}>
          <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-secondary)" }}>{data.latestSuggestion}</div>
          {data.latestSuggestionAt && (
            <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", marginTop: 2 }}>{formatTimeAgo(data.latestSuggestionAt)}</div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Triggers Card ─────────────────────────────────────

export function TriggersCard() {
  const [triggers, setTriggers] = useState<readonly Trigger[]>([]);

  useEffect(() => {
    let cancelled = false;
    rpc("triggers.list").then((res) => {
      if (!cancelled && res) setTriggers(res as readonly Trigger[]);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card title="Triggers">
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
        {triggers.length === 0 ? (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>No triggers configured</span>
        ) : (
          triggers.slice(0, 6).map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.enabled ? "var(--color-success)" : "var(--color-text-dim)", flexShrink: 0 }} aria-label={t.enabled ? "Active" : "Disabled"} />
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>{t.event}</span>
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }} aria-hidden="true">{"→"}</span>
              <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.action}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
