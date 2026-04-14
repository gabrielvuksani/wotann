/**
 * ProofBundleList — left pane of the Proofs tab.
 *
 * Lists proof bundles from the daemon (RPC `proofs.list`). Each row:
 * action title, timestamp, verification badge (pass/fail/partial).
 * Clicking opens ProofBundleDetail on the right.
 */

import { useEffect, useState } from "react";
import {
  TRUST_COLORS as C,
  TRUST_FONT as F,
  trustRpc,
  type ProofBundleSummary,
} from "./TrustView";

interface ProofsListResponse {
  readonly bundles?: readonly Partial<ProofBundleSummary>[];
}

function normalize(raw: Partial<ProofBundleSummary>, idx: number): ProofBundleSummary {
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `bundle-${idx}`;
  const action =
    typeof raw.action === "string" && raw.action.length > 0 ? raw.action : "Untitled action";
  const ts = typeof raw.timestamp === "number" ? raw.timestamp : Date.now();
  const v =
    raw.verification === "pass" || raw.verification === "fail" || raw.verification === "partial"
      ? raw.verification
      : "partial";
  return {
    id,
    action,
    timestamp: ts,
    verification: v,
    cost: typeof raw.cost === "number" ? raw.cost : undefined,
  };
}

export function ProofBundleList({
  selected,
  onSelect,
}: {
  readonly selected: ProofBundleSummary | null;
  readonly onSelect: (b: ProofBundleSummary | null) => void;
}) {
  const [bundles, setBundles] = useState<readonly ProofBundleSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = (await trustRpc("proofs.list", {})) as
        | ProofsListResponse
        | readonly Partial<ProofBundleSummary>[]
        | null;
      if (cancelled) return;
      const raw = Array.isArray(result)
        ? result
        : Array.isArray(result?.bundles)
          ? result.bundles
          : [];
      setBundles(raw.map((r, i) => normalize(r, i)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Empty label="Loading proof bundles..." />;
  if (bundles.length === 0)
    return <Empty label="No proof bundles yet. Agent runs will appear here after verification completes." />;

  return (
    <ul
      role="list"
      style={{
        listStyle: "none",
        margin: 0,
        padding: "8px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: F,
      }}
    >
      {bundles.map((b) => (
        <Row
          key={b.id}
          bundle={b}
          isSelected={selected?.id === b.id}
          onClick={() => onSelect(b)}
        />
      ))}
    </ul>
  );
}

// ── Row + badge ──────────────────────────────────────────

function Row({
  bundle,
  isSelected,
  onClick,
}: {
  readonly bundle: ProofBundleSummary;
  readonly isSelected: boolean;
  readonly onClick: () => void;
}) {
  return (
    <li role="listitem">
      <button
        onClick={onClick}
        aria-pressed={isSelected}
        style={{
          width: "100%",
          minHeight: 36,
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 12,
          background: isSelected ? "rgba(10,132,255,0.12)" : C.surface,
          border: `1px solid ${isSelected ? C.accent : C.divider}`,
          color: C.textPrimary,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "background 160ms ease, border-color 160ms ease",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: C.textPrimary,
            }}
          >
            {bundle.action}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
            {formatRelative(bundle.timestamp)}
          </div>
        </div>
        <Badge status={bundle.verification} />
      </button>
    </li>
  );
}

function Badge({ status }: { readonly status: "pass" | "fail" | "partial" }) {
  const palette = {
    pass: { bg: "rgba(48,209,88,0.14)", fg: C.success, label: "Pass" },
    fail: { bg: "rgba(255,69,58,0.14)", fg: C.error, label: "Fail" },
    partial: { bg: "rgba(255,159,10,0.14)", fg: C.warning, label: "Partial" },
  } as const;
  const p = palette[status];
  return (
    <span
      aria-label={`Verification ${p.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        background: p.bg,
        color: p.fg,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.3px",
        textTransform: "uppercase",
        border: `1px solid ${p.fg}30`,
      }}
    >
      {p.label}
    </span>
  );
}

function Empty({ label }: { readonly label: string }) {
  return (
    <div
      role="status"
      style={{ padding: 24, color: C.textDim, fontFamily: F, fontSize: 12, textAlign: "center" }}
    >
      {label}
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return new Date(ts).toLocaleString();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
