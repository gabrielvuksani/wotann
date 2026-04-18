/**
 * ProofBundleDetail — right pane of the Proofs tab.
 *
 * Shows full metadata for a selected proof bundle: task, timing, cost,
 * file edits with diff line counts, tool calls with timings, and
 * verification evidence cards. A "Re-verify" button calls RPC
 * `verification.rerun` and reflects the new status inline.
 *
 * Fetches detail via `proofs.get`; falls back to the summary on failure.
 */

import { useEffect, useMemo, useState } from "react";
import {
  TRUST_COLORS as C,
  TRUST_FONT as F,
  trustRpc,
  type ProofBundleFull,
  type ProofBundleSummary,
} from "./TrustView";
import { SealedScroll, type ProofSeal, type SealState } from "../wotann/SealedScroll";

const MONO =
  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

function mapEvidenceStatusToSealState(s: "pass" | "fail" | "partial"): SealState {
  if (s === "pass") return "passed";
  if (s === "fail") return "failed";
  return "skipped";
}

export function ProofBundleDetail({
  bundle,
}: {
  readonly bundle: ProofBundleSummary | null;
}) {
  const [detail, setDetail] = useState<ProofBundleFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunStatus, setRerunStatus] = useState<string | null>(null);

  useEffect(() => {
    setRerunStatus(null);
    if (!bundle) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const r = (await trustRpc("proofs.get", { id: bundle.id })) as
        | ProofBundleFull
        | null;
      if (cancelled) return;
      setDetail(r && typeof r === "object" ? { ...bundle, ...r } : { ...bundle });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bundle]);

  if (!bundle) return <Placeholder label="Select a proof bundle on the left to inspect its evidence." />;
  if (loading && !detail) return <Placeholder label="Loading bundle details..." />;

  const d: ProofBundleFull = detail ?? { ...bundle };

  const onRerun = async () => {
    setRerunning(true);
    setRerunStatus(null);
    const res = (await trustRpc("verification.rerun", { id: bundle.id })) as
      | { readonly status?: string }
      | null;
    setRerunStatus(res?.status ?? "queued");
    setRerunning(false);
  };

  // SealedScroll seal strip synthesised from the bundle's `evidence[]`
  // plus top-level verification status. Session-10 activation: this
  // component was previously defined but never mounted. Now every
  // proof bundle detail opens with its signature wax-seal strip.
  const seals = useMemo<readonly ProofSeal[]>(() => {
    const evidence = d.evidence ?? [];
    // If we have evidence cards, map each one directly to a seal.
    if (evidence.length > 0) {
      return evidence.map((e) => ({
        kind: e.kind,
        state: mapEvidenceStatusToSealState(e.status),
        detail: e.summary,
      }));
    }
    // No evidence yet — fall back to the bundle-level verification to
    // at least show a single summary seal rather than empty space.
    return [
      {
        kind: "verification",
        state:
          d.verification === "pass"
            ? "passed"
            : d.verification === "fail"
              ? "failed"
              : rerunning
                ? "running"
                : "pending",
        detail: rerunning ? "Re-verifying…" : undefined,
      },
    ];
  }, [d.evidence, d.verification, rerunning]);

  return (
    <div style={{ padding: 16, fontFamily: F, display: "flex", flexDirection: "column", gap: 12 }}>
      <SealedScroll seals={seals} bundleId={d.id} />

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={titleStyle}>{d.action}</h2>
        <button
          onClick={onRerun}
          disabled={rerunning}
          aria-label="Re-run verification"
          style={{
            minHeight: 36, padding: "8px 14px", borderRadius: 10,
            background: rerunning ? "rgba(10,132,255,0.4)" : C.accent,
            color: "#fff", border: "none",
            cursor: rerunning ? "progress" : "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 600, letterSpacing: "0.2px",
          }}
        >
          {rerunning ? "Re-verifying..." : "Re-verify"}
        </button>
      </div>

      {rerunStatus && (
        <div role="status" style={statusStyle}>Verification {rerunStatus}</div>
      )}

      <Card>
        <Meta label="Task" value={d.task ?? d.action} />
        <Hr />
        <Meta label="Start" value={new Date(d.start ?? d.timestamp).toLocaleString()} />
        <Hr />
        <Meta label="End" value={d.end !== undefined ? new Date(d.end).toLocaleString() : "In progress"} />
        <Hr />
        <Meta label="Duration" value={formatDuration(d.durationMs)} />
        <Hr />
        <Meta label="Cost" value={typeof d.cost === "number" ? `$${d.cost.toFixed(4)}` : "Unknown"} />
      </Card>

      {d.fileEdits && d.fileEdits.length > 0 && (
        <Card title="File edits">
          {d.fileEdits.map((e) => (
            <div key={e.path} style={rowStyle}>
              <span style={pathStyle} title={e.path}>{e.path}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.success }}>+{e.additions}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.error }}>-{e.deletions}</span>
            </div>
          ))}
        </Card>
      )}

      {d.toolCalls && d.toolCalls.length > 0 && (
        <Card title="Tools called">
          {d.toolCalls.map((t, i) => (
            <div key={`${t.name}-${i}`} style={rowStyle}>
              <Dot ok={t.ok} />
              <span style={{ flex: 1, fontSize: 12, color: C.textPrimary, fontFamily: MONO }}>{t.name}</span>
              <span style={{ fontSize: 11, color: C.textDim }}>{formatDuration(t.durationMs)}</span>
            </div>
          ))}
        </Card>
      )}

      {d.evidence && d.evidence.length > 0 && (
        <Card title="Verification evidence">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            {d.evidence.map((e, i) => (
              <Evidence key={`${e.kind}-${i}`} item={e} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "6px 0", borderBottom: `1px solid ${C.divider}`,
};

const pathStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 12, fontFamily: MONO, color: C.textPrimary,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const titleStyle: React.CSSProperties = {
  margin: 0, fontSize: 17, fontWeight: 600, color: C.textPrimary,
  flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const statusStyle: React.CSSProperties = {
  fontSize: 11, color: C.textDim, padding: "6px 10px",
  background: "rgba(10,132,255,0.08)", border: `1px solid ${C.accent}30`, borderRadius: 8,
};

function Evidence({
  item,
}: {
  readonly item: { readonly kind: string; readonly status: "pass" | "fail" | "partial"; readonly summary: string };
}) {
  const color = item.status === "pass" ? C.success : item.status === "fail" ? C.error : C.warning;
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background: "#0C0C0E",
        border: `1px solid ${color}30`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color }}>
        <Dot ok={item.status === "pass"} />
        {item.kind}
      </div>
      <div
        style={{ fontSize: 12, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={item.summary}
      >
        {item.summary}
      </div>
    </div>
  );
}

// ── Primitives ───────────────────────────────────────────

function Card({ title, children }: { readonly title?: string; readonly children: React.ReactNode }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.divider}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {title && (
        <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", color: C.textDim }}>
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

function Meta({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
      <span style={{ color: C.textDim, fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span style={{ color: C.textPrimary, fontWeight: 500, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function Hr() {
  return <div aria-hidden="true" style={{ height: 1, background: C.divider }} />;
}

function Dot({ ok }: { readonly ok: boolean }) {
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: ok ? C.success : C.error, flexShrink: 0 }} />;
}

function Placeholder({ label }: { readonly label: string }) {
  return (
    <div role="status" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 32, fontFamily: F, fontSize: 12, color: C.textDim, textAlign: "center" }}>
      {label}
    </div>
  );
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "Unknown";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}
