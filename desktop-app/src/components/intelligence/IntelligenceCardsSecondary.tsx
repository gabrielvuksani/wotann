/**
 * Secondary card components for the Intelligence Dashboard.
 *
 * DeviceContextCard, IdleStatusCard, SpecDivergenceCard, FileSearchCard
 */

import { useState, useEffect, useCallback } from "react";
import { rpc, Card, StatusBadge, formatTimeAgo } from "./intelligenceUtils";
import type {
  DeviceContext,
  IdleStatus,
  SpecDivergence,
  FileSearchResult,
} from "./intelligenceUtils";

// ── Device Context Card ───────────────────────────────

const DEVICE_LABELS: Record<string, string> = { desktop: "D", phone: "P", watch: "W" };

const DEFAULT_DEVICES: DeviceContext["devices"] = [
  { type: "desktop", connected: false, lastSync: null },
  { type: "phone", connected: false, lastSync: null },
  { type: "watch", connected: false, lastSync: null },
];

export function DeviceContextCard() {
  const [data, setData] = useState<DeviceContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("crossdevice.context").then((res) => {
      if (!cancelled && res) setData(res as DeviceContext);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card title="Device Context">
      <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center" }}>
        {(data?.devices ?? DEFAULT_DEVICES).map((device) => (
          <div key={device.type} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-md)",
                border: `1px solid ${device.connected ? "var(--color-success)" : "var(--border-subtle)"}`,
                background: device.connected ? "var(--color-success-muted)" : "var(--surface-1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: device.connected ? "var(--color-success)" : "var(--color-text-dim)",
                fontSize: "var(--font-size-sm)",
                fontWeight: 700,
              }}
            >
              {DEVICE_LABELS[device.type] ?? device.type.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", textTransform: "capitalize" }}>
              {device.type}
            </span>
            <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
              {device.connected
                ? (device.lastSync ? formatTimeAgo(device.lastSync) : "connected")
                : "offline"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Idle Status Card ──────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

export function IdleStatusCard() {
  const [data, setData] = useState<IdleStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("idle.status").then((res) => {
      if (!cancelled && res) setData(res as IdleStatus);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card title="Idle Status">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-xs)" }}>
          <span style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
            {data ? formatDuration(data.durationMs) : "--"}
          </span>
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>idle</span>
        </div>
        {data?.lastActivity && (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
            Last activity: {formatTimeAgo(data.lastActivity)}
          </span>
        )}
      </div>
    </Card>
  );
}

// ── Spec Divergence Card ──────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  synced: "var(--color-success)",
  diverged: "var(--color-error)",
  unknown: "var(--color-text-dim)",
};

const SEVERITY_COLORS: Record<string, string> = {
  high: "var(--color-error)",
  medium: "var(--color-warning)",
  low: "var(--color-text-dim)",
};

export function SpecDivergenceCard() {
  const [data, setData] = useState<SpecDivergence | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc("spec.divergence").then((res) => {
      if (!cancelled && res) setData(res as SpecDivergence);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card title="Spec Divergence">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
        <StatusBadge
          text={data?.status ?? "unknown"}
          color={STATUS_COLORS[data?.status ?? "unknown"] ?? "var(--color-text-dim)"}
        />
        {data?.divergences && data.divergences.length > 0 && (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
            {data.divergences.length} divergence{data.divergences.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
        {(data?.divergences ?? []).slice(0, 5).map((d, i) => (
          <div key={i} style={{ fontSize: "var(--font-size-2xs)", color: SEVERITY_COLORS[d.severity] ?? "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: SEVERITY_COLORS[d.severity] ?? "var(--color-text-dim)", flexShrink: 0 }} aria-hidden="true" />
            {d.description}
          </div>
        ))}
        {(!data?.divergences || data.divergences.length === 0) && (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>
            {data?.status === "synced" ? "Spec and codebase are in sync" : "No spec data available"}
          </span>
        )}
      </div>
    </Card>
  );
}

// ── File Search Card ──────────────────────────────────

export function FileSearchCard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly FileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await rpc("files.search", { query: query.trim() });
    if (res) setResults(res as readonly FileSearchResult[]);
    setSearching(false);
  }, [query]);

  return (
    <Card title="File Search">
      <div style={{ display: "flex", gap: "var(--space-xs)" }}>
        <input
          type="text"
          placeholder="Search files by frecency..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          style={{ flex: 1, background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "4px 8px", fontSize: "var(--font-size-xs)", color: "var(--color-text-primary)", outline: "none", fontFamily: "var(--font-sans)" }}
        />
        <button
          onClick={handleSearch}
          className="btn-press"
          disabled={searching}
          style={{ padding: "4px 10px", fontSize: "var(--font-size-2xs)", background: "var(--surface-1)", color: "var(--color-text-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", cursor: searching ? "wait" : "pointer" }}
        >
          {searching ? "..." : "Search"}
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 120, overflowY: "auto" }}>
        {results.length === 0 && query.trim() && !searching && (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>No results</span>
        )}
        {results.slice(0, 8).map((r) => (
          <div key={r.path} style={{ fontSize: "var(--font-size-2xs)", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--color-text-dim)", fontSize: "var(--font-size-2xs)", flexShrink: 0 }}>
              {Math.round(r.score * 100)}
            </span>
            {r.path}
          </div>
        ))}
      </div>
    </Card>
  );
}
