/**
 * DataExplorerCanvas — render tabular agent output as a sortable,
 * filterable table with inline mini-charts per numeric column.
 *
 * Use cases:
 *   - Agent dumped a CSV / JSON array and wants the user to browse
 *     it without opening a separate viewer.
 *   - Benchmark aggregator results (per-model latencies, costs, etc.).
 *
 * Payload shape (runtime-validated):
 *   {
 *     title?: string
 *     rows: Array<Record<string, unknown>>   // primitive values only
 *     schema?: Array<{ name: string, type: 'number' | 'string' | 'bool' }>
 *   }
 *
 * If `schema` is omitted, we infer column types from the first row's
 * values. Non-primitive cell values (objects, arrays) are rendered
 * as JSON strings so we never silently swallow data.
 *
 * Events: none. This canvas is read-only.
 */

import { useMemo, useState } from "react";
import type { CanvasProps } from "../../lib/canvas-registry";
import { InvalidPayload, isPlainObject, EmptyPayload } from "./CanvasFallback";

// ────────────────────────────────────────────────────────────
// Types + validation
// ────────────────────────────────────────────────────────────

type CellValue = string | number | boolean | null;
type ColumnType = "number" | "string" | "bool";

interface Column {
  readonly name: string;
  readonly type: ColumnType;
}

interface DataPayload {
  readonly title?: string;
  readonly rows: readonly Readonly<Record<string, CellValue>>[];
  readonly columns: readonly Column[];
}

function toCellValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
    return v;
  }
  // Arrays / objects: coerce to string so the user at least sees the shape.
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function inferType(sample: CellValue): ColumnType {
  if (typeof sample === "number") return "number";
  if (typeof sample === "boolean") return "bool";
  return "string";
}

function validate(data: unknown): DataPayload | { readonly error: string } {
  if (!isPlainObject(data)) return { error: "Payload must be an object." };
  const rawRows = data.rows;
  if (!Array.isArray(rawRows)) return { error: "`rows` must be an array." };

  const rows: Readonly<Record<string, CellValue>>[] = [];
  for (const r of rawRows) {
    if (!isPlainObject(r)) continue;
    const cleanRow: Record<string, CellValue> = {};
    for (const [k, v] of Object.entries(r)) cleanRow[k] = toCellValue(v);
    rows.push(cleanRow);
  }

  // Collect all column names across rows so we never drop a sparse
  // column just because an early row is missing it.
  const colNames: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!colNames.includes(key)) colNames.push(key);
    }
  }

  // Honor explicit schema if provided; fall back to inferred types.
  let columns: Column[];
  if (Array.isArray(data.schema)) {
    columns = [];
    for (const entry of data.schema) {
      if (!isPlainObject(entry)) continue;
      if (typeof entry.name !== "string") continue;
      const rawType = entry.type;
      const type: ColumnType =
        rawType === "number" || rawType === "bool" || rawType === "string"
          ? rawType
          : "string";
      columns.push({ name: entry.name, type });
    }
    // Merge in any names that appear in rows but were omitted from the schema.
    for (const name of colNames) {
      if (columns.some((c) => c.name === name)) continue;
      const firstNonNull = rows
        .map((r) => r[name])
        .find((v) => v !== null && v !== undefined);
      columns.push({ name, type: inferType(firstNonNull ?? "") });
    }
  } else {
    columns = colNames.map((name) => {
      const firstNonNull = rows
        .map((r) => r[name])
        .find((v) => v !== null && v !== undefined);
      return { name, type: inferType(firstNonNull ?? "") };
    });
  }

  return {
    title: typeof data.title === "string" ? data.title : undefined,
    rows,
    columns,
  };
}

// ────────────────────────────────────────────────────────────
// Sort + filter helpers
// ────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

interface SortState {
  readonly column: string;
  readonly dir: SortDir;
}

function compareCells(a: CellValue, b: CellValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls sort last
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? 1 : -1;
  }
  return String(a).localeCompare(String(b));
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function DataExplorerCanvas({ data }: CanvasProps) {
  const parsed = useMemo(() => validate(data), [data]);
  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});

  const processed = useMemo(() => {
    if ("error" in parsed) return null;

    // Apply filters (case-insensitive substring match on string repr).
    let next = parsed.rows;
    const activeFilters = Object.entries(filters).filter(
      ([, v]) => v.trim().length > 0,
    );
    if (activeFilters.length > 0) {
      next = next.filter((row) =>
        activeFilters.every(([col, query]) => {
          const cell = row[col];
          if (cell === null) return false;
          return String(cell).toLowerCase().includes(query.toLowerCase());
        }),
      );
    }

    // Apply sort.
    if (sort) {
      next = [...next].sort((a, b) => {
        const cmp = compareCells(a[sort.column] ?? null, b[sort.column] ?? null);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }

    return next;
  }, [parsed, filters, sort]);

  if ("error" in parsed) {
    return (
      <InvalidPayload
        canvasLabel="Data Explorer"
        reason={parsed.error}
        data={data}
      />
    );
  }

  if (parsed.rows.length === 0) {
    return (
      <EmptyPayload
        canvasLabel="Data Explorer"
        hint="The agent returned a data table with zero rows."
      />
    );
  }

  const toggleSort = (col: string): void => {
    setSort((prev) => {
      if (!prev || prev.column !== col) return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: col, dir: "desc" };
      return null;
    });
  };

  const updateFilter = (col: string, value: string): void => {
    setFilters((prev) => ({ ...prev, [col]: value }));
  };

  return (
    <section
      className="liquid-glass"
      data-glass-tier="medium"
      style={{
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md, 10px)",
        margin: "var(--space-sm) 0",
      }}
      aria-label={parsed.title ?? "Data explorer"}
    >
      {parsed.title ? (
        <h3
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            marginBottom: "var(--space-sm)",
          }}
        >
          {parsed.title}
        </h3>
      ) : null}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-sm)",
          fontSize: "var(--font-size-2xs)",
          color: "var(--color-text-dim)",
        }}
      >
        <span>
          {processed?.length ?? 0} of {parsed.rows.length} rows
          {parsed.columns.length > 0 ? ` × ${parsed.columns.length} cols` : ""}
        </span>
        {sort ? (
          <button
            type="button"
            onClick={() => setSort(null)}
            className="btn-press"
            style={{
              padding: "2px 8px",
              fontSize: "var(--font-size-2xs)",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-text-muted)",
              borderRadius: "var(--radius-sm, 6px)",
              cursor: "pointer",
            }}
          >
            Clear sort
          </button>
        ) : null}
      </div>

      {/* Mini-charts row for numeric columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "var(--space-sm)",
          marginBottom: "var(--space-sm)",
        }}
      >
        {parsed.columns
          .filter((c) => c.type === "number")
          .map((col) => {
            const series = parsed.rows
              .map((r) => r[col.name])
              .filter(
                (v): v is number => typeof v === "number" && Number.isFinite(v),
              );
            if (series.length === 0) return null;
            return (
              <MiniChart key={col.name} column={col.name} values={series} />
            );
          })}
      </div>

      {/* Table */}
      <div
        style={{
          overflow: "auto",
          maxHeight: 420,
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm, 6px)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs)",
          }}
        >
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: "var(--bg-surface)",
              zIndex: 1,
            }}
          >
            <tr>
              {parsed.columns.map((col) => {
                const active = sort?.column === col.name;
                const arrow = active ? (sort?.dir === "asc" ? "↑" : "↓") : "↕";
                return (
                  <th
                    key={col.name}
                    scope="col"
                    style={{
                      padding: "6px 8px",
                      textAlign: "left",
                      borderBottom: "1px solid var(--border-subtle)",
                      color: "var(--color-text-secondary)",
                      fontWeight: 600,
                      verticalAlign: "top",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.name)}
                      aria-sort={
                        active
                          ? sort?.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className="btn-press"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        background: "transparent",
                        border: "none",
                        color: "inherit",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      <span>{col.name}</span>
                      <span
                        aria-hidden="true"
                        style={{
                          color: active
                            ? "var(--color-text-primary)"
                            : "var(--color-text-dim)",
                        }}
                      >
                        {arrow}
                      </span>
                      <span
                        aria-hidden="true"
                        style={{
                          color: "var(--color-text-dim)",
                          fontSize: "var(--font-size-2xs)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          marginLeft: 4,
                        }}
                      >
                        {col.type}
                      </span>
                    </button>
                    <input
                      type="text"
                      placeholder="filter"
                      value={filters[col.name] ?? ""}
                      onChange={(e) => updateFilter(col.name, e.target.value)}
                      aria-label={`Filter ${col.name}`}
                      style={{
                        marginTop: 4,
                        width: "100%",
                        padding: "2px 4px",
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm, 6px)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--font-size-2xs)",
                        color: "var(--color-text-primary)",
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(processed ?? []).map((row, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: "1px solid var(--border-subtle)",
                  background:
                    i % 2 === 0 ? "transparent" : "var(--bg-surface)",
                }}
              >
                {parsed.columns.map((col) => {
                  const value = row[col.name];
                  return (
                    <td
                      key={col.name}
                      style={{
                        padding: "4px 8px",
                        color:
                          value === null
                            ? "var(--color-text-dim)"
                            : "var(--color-text-secondary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 240,
                      }}
                    >
                      {value === null ? "—" : String(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {processed?.length === 0 ? (
        <div
          style={{
            padding: "var(--space-sm)",
            textAlign: "center",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          No rows match the active filters.
        </div>
      ) : null}
    </section>
  );
}

// ────────────────────────────────────────────────────────────
// Mini-chart — SVG sparkline-ish bar chart for numeric columns
// ────────────────────────────────────────────────────────────

function MiniChart({
  column,
  values,
}: {
  readonly column: string;
  readonly values: readonly number[];
}) {
  const { min, max, mean } = useMemo(() => {
    let mn = values[0] ?? 0;
    let mx = values[0] ?? 0;
    let sum = 0;
    for (const v of values) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sum += v;
    }
    return { min: mn, max: mx, mean: sum / values.length };
  }, [values]);

  // 40 bar slots max so the chart stays legible for any row count.
  const W = 140;
  const H = 32;
  const slots = Math.min(values.length, 40);
  const step = values.length > slots ? Math.floor(values.length / slots) : 1;
  const sampled: number[] = [];
  for (let i = 0; i < values.length && sampled.length < slots; i += step) {
    const v = values[i];
    if (typeof v === "number") sampled.push(v);
  }
  const range = max - min || 1;
  const barW = W / Math.max(sampled.length, 1);

  return (
    <div
      style={{
        padding: "var(--space-sm)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm, 6px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-2xs)",
            fontWeight: 600,
            color: "var(--color-text-secondary)",
          }}
        >
          {column}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-dim)",
          }}
        >
          {formatNumber(mean)}
        </span>
      </div>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Mini chart for ${column}, min ${min}, max ${max}`}
        style={{ display: "block" }}
      >
        {sampled.map((v, i) => {
          const h = ((v - min) / range) * (H - 4) + 2;
          return (
            <rect
              key={i}
              x={i * barW}
              y={H - h}
              width={Math.max(barW - 1, 1)}
              height={h}
              fill="var(--accent)"
              opacity={0.7}
            />
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 2,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-2xs)",
          color: "var(--color-text-dim)",
        }}
      >
        <span>{formatNumber(min)}</span>
        <span>{formatNumber(max)}</span>
      </div>
    </div>
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
