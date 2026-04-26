/**
 * AuditLogView — surface the daemon's audit trail.
 *
 * RPC surface (daemon-owned):
 *  - audit.query { since?, until?, type?, limit? } -> AuditEntry[]
 *
 * AuditEntry shape (per task contract):
 *  { timestamp, type, action, target, metadata }
 *
 * Filters: type (dropdown of distinct values from the current page +
 * common defaults), date range (since/until inputs). Refresh button
 * re-runs the query with the active filters. Empty/loading/error states
 * delegate to shared primitives.
 *
 * Style mirrors ExecApprovals + AutomationsPanel: design tokens for
 * color, Tailwind for layout, per-mount state, no module globals.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { commands } from "../../hooks/useTauriCommand";
import { ErrorState, EmptyState } from "../shared/ErrorState";
import { Skeleton } from "../shared/Skeleton";

// ── Types ────────────────────────────────────────────────────

export interface AuditEntry {
  readonly timestamp: number;
  readonly type: string;
  readonly action: string;
  readonly target: string;
  readonly metadata?: Record<string, unknown>;
}

interface QueryFilters {
  readonly type: string; // "" === all
  readonly since: string; // datetime-local string or ""
  readonly until: string; // datetime-local string or ""
}

const DEFAULT_LIMIT = 100;

// Common audit types worth pre-populating the dropdown with even if the
// current result page hasn't surfaced them yet. Real values from the
// daemon are merged in at render time.
const COMMON_TYPES: readonly string[] = [
  "auth",
  "rpc",
  "command",
  "file",
  "secret",
  "permission",
  "policy",
  "config",
];

const EMPTY_ICON =
  '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h6M5 9h6M5 12h3"/></svg>';

// Type → badge color mapping. Falls back to neutral.
const TYPE_COLOR: Readonly<Record<string, string>> = {
  auth: "var(--color-primary)",
  rpc: "var(--color-info, #5AC8FA)",
  command: "var(--color-warning)",
  file: "var(--color-text-secondary)",
  secret: "var(--color-error)",
  permission: "var(--color-warning)",
  policy: "var(--color-success)",
  config: "var(--color-text-muted)",
};

function colorForType(t: string): string {
  return TYPE_COLOR[t] ?? "var(--color-text-secondary)";
}

// ── Parsing ──────────────────────────────────────────────────

function parseEntries(result: unknown): readonly AuditEntry[] {
  if (!Array.isArray(result)) return [];
  const out: AuditEntry[] = [];
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const tsRaw = e["timestamp"];
    const timestamp =
      typeof tsRaw === "number"
        ? tsRaw
        : typeof tsRaw === "string"
          ? Date.parse(tsRaw)
          : NaN;
    if (!Number.isFinite(timestamp)) continue;
    const type = typeof e["type"] === "string" ? (e["type"] as string) : "unknown";
    const action = typeof e["action"] === "string" ? (e["action"] as string) : "";
    const target = typeof e["target"] === "string" ? (e["target"] as string) : "";
    const metadataRaw = e["metadata"];
    const metadata =
      metadataRaw !== null &&
      typeof metadataRaw === "object" &&
      !Array.isArray(metadataRaw)
        ? (metadataRaw as Record<string, unknown>)
        : undefined;
    out.push({ timestamp, type, action, target, metadata });
  }
  // Newest first.
  return Object.freeze(out.slice().sort((a, b) => b.timestamp - a.timestamp));
}

function toUnixSeconds(local: string): number | undefined {
  if (local === "") return undefined;
  const ms = Date.parse(local);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function formatTs(ts: number): string {
  // Heuristic: timestamps below 10^12 are seconds; above are millis.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  return d.toLocaleString();
}

// ── Component ────────────────────────────────────────────────

export function AuditLogView(): ReactElement {
  const [entries, setEntries] = useState<readonly AuditEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<QueryFilters>({
    type: "",
    since: "",
    until: "",
  });

  const buildParams = useCallback((f: QueryFilters): Record<string, unknown> => {
    const params: Record<string, unknown> = { limit: DEFAULT_LIMIT };
    if (f.type !== "") params["type"] = f.type;
    const since = toUnixSeconds(f.since);
    const until = toUnixSeconds(f.until);
    if (since !== undefined) params["since"] = since;
    if (until !== undefined) params["until"] = until;
    return params;
  }, []);

  const load = useCallback(
    async (f: QueryFilters): Promise<void> => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const result = await commands.rpcCall("audit.query", buildParams(f));
        setEntries(parseEntries(result));
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [buildParams],
  );

  useEffect(() => {
    void load(filters);
    // Initial load — re-runs only via Refresh / explicit filter apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const distinctTypes = useMemo(() => {
    const set = new Set<string>(COMMON_TYPES);
    for (const e of entries) set.add(e.type);
    return Array.from(set).sort();
  }, [entries]);

  const refresh = useCallback(() => {
    void load(filters);
  }, [filters, load]);

  const updateFilter = useCallback(
    (patch: Partial<QueryFilters>) => {
      setFilters((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  const apply = useCallback(() => {
    void load(filters);
  }, [filters, load]);

  const clearFilters = useCallback(() => {
    const empty: QueryFilters = { type: "", since: "", until: "" };
    setFilters(empty);
    void load(empty);
  }, [load]);

  return (
    <div
      className="h-full flex flex-col"
      style={{
        background: "var(--color-bg-primary)",
        color: "var(--color-text-primary)",
      }}
    >
      <header
        style={{
          padding: "var(--space-md, 16px) var(--space-lg, 24px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "var(--font-size-lg, 16px)",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              Audit Log
            </h2>
            <p
              style={{
                margin: "2px 0 0 0",
                fontSize: "var(--font-size-xs, 11px)",
                color: "var(--color-text-secondary)",
              }}
            >
              {loading
                ? "Loading…"
                : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}` +
                  (entries.length === DEFAULT_LIMIT ? " (limit reached)" : "")}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh audit log"
            className="btn-press"
            style={{
              minHeight: 36,
              padding: "0 14px",
              borderRadius: "var(--radius-md, 8px)",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-text-primary)",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 500,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <FilterBar
          filters={filters}
          types={distinctTypes}
          onChange={updateFilter}
          onApply={apply}
          onClear={clearFilters}
        />
      </header>

      <main
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ padding: "var(--space-md, 16px) var(--space-lg, 24px)" }}
      >
        {errorMsg !== null && !loading && entries.length === 0 ? (
          <ErrorState
            title="Could not load audit log"
            message={errorMsg}
            onRetry={refresh}
          />
        ) : loading ? (
          <div className="flex flex-col" style={{ gap: 6 }} aria-label="Loading audit entries">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  background: "var(--surface-2)",
                  borderRadius: "var(--radius-sm, 6px)",
                  border: "1px solid var(--border-subtle)",
                  padding: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Skeleton width="120px" height="11px" />
                <Skeleton width="60px" height="16px" rounded="full" />
                <Skeleton width="40%" height="11px" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={EMPTY_ICON}
            title="No audit entries"
            message={
              filters.type !== "" || filters.since !== "" || filters.until !== ""
                ? "No entries match the current filters. Try clearing them."
                : "The audit log is empty. Activity will appear here as it happens."
            }
            action={
              filters.type !== "" || filters.since !== "" || filters.until !== ""
                ? { label: "Clear filters", onClick: clearFilters }
                : undefined
            }
          />
        ) : (
          <>
            {errorMsg !== null && (
              <div
                role="alert"
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm, 6px)",
                  background: "var(--color-error-muted)",
                  color: "var(--color-error)",
                  fontSize: "var(--font-size-xs, 11px)",
                }}
              >
                {errorMsg}
              </div>
            )}
            <div className="flex flex-col" style={{ gap: 4 }} role="list" aria-label="Audit entries">
              {entries.map((e, i) => (
                <AuditRow key={`${e.timestamp}-${i}`} entry={e} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Filter Bar ───────────────────────────────────────────────

function FilterBar({
  filters,
  types,
  onChange,
  onApply,
  onClear,
}: {
  readonly filters: QueryFilters;
  readonly types: readonly string[];
  readonly onChange: (patch: Partial<QueryFilters>) => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
}): ReactElement {
  const hasFilter =
    filters.type !== "" || filters.since !== "" || filters.until !== "";
  return (
    <div
      className="flex flex-wrap items-end"
      style={{ gap: 10 }}
      role="group"
      aria-label="Audit filters"
    >
      <FilterField label="Type">
        <select
          value={filters.type}
          onChange={(e) => onChange({ type: e.target.value })}
          aria-label="Filter by type"
          style={filterInputStyle}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </FilterField>
      <FilterField label="Since">
        <input
          type="datetime-local"
          value={filters.since}
          onChange={(e) => onChange({ since: e.target.value })}
          aria-label="Filter from this date"
          style={filterInputStyle}
        />
      </FilterField>
      <FilterField label="Until">
        <input
          type="datetime-local"
          value={filters.until}
          onChange={(e) => onChange({ until: e.target.value })}
          aria-label="Filter up to this date"
          style={filterInputStyle}
        />
      </FilterField>
      <div className="flex" style={{ gap: 6 }}>
        <button
          type="button"
          onClick={onApply}
          aria-label="Apply filters"
          className="btn-press"
          style={{
            minHeight: 32,
            padding: "0 12px",
            borderRadius: "var(--radius-sm, 6px)",
            border: "none",
            background: "var(--color-primary)",
            color: "#FFFFFF",
            fontSize: "var(--font-size-xs, 11px)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        {hasFilter && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear filters"
            className="btn-press"
            style={{
              minHeight: 32,
              padding: "0 12px",
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-xs, 11px)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

const filterInputStyle: React.CSSProperties = {
  minHeight: 32,
  padding: "6px 10px",
  borderRadius: "var(--radius-sm, 6px)",
  background: "var(--color-bg-secondary)",
  border: "1px solid var(--border-subtle)",
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-xs, 11px)",
  outline: "none",
  fontFamily: "var(--font-sans)",
};

function FilterField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: "var(--font-size-2xs, 10px)",
          color: "var(--color-text-secondary)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

// ── Row ──────────────────────────────────────────────────────

function AuditRow({ entry }: { readonly entry: AuditEntry }): ReactElement {
  const color = colorForType(entry.type);
  return (
    <div
      role="listitem"
      style={{
        background: "var(--surface-2)",
        borderRadius: "var(--radius-sm, 6px)",
        border: "1px solid var(--border-subtle)",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-2xs, 10px)",
          color: "var(--color-text-muted)",
          flexShrink: 0,
          minWidth: 130,
          whiteSpace: "nowrap",
        }}
      >
        {formatTs(entry.timestamp)}
      </span>
      <span
        aria-label={`Type ${entry.type}`}
        style={{
          padding: "2px 8px",
          borderRadius: "var(--radius-pill)",
          background: "rgba(255,255,255,0.04)",
          color,
          border: `1px solid ${color}33`,
          fontSize: "var(--font-size-2xs, 10px)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
      >
        {entry.type}
      </span>
      <span
        style={{
          fontSize: "var(--font-size-xs, 11px)",
          color: "var(--color-text-primary)",
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {entry.action || "(no action)"}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "var(--font-size-xs, 11px)",
          color: "var(--color-text-secondary)",
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={entry.target}
      >
        {entry.target}
      </span>
    </div>
  );
}
