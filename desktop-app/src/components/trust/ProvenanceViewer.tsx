/**
 * ProvenanceViewer — Provenance tab.
 *
 * Renders the current session's system prompt line by line, each line
 * annotated with its source of origin (AGENTS.md, SOUL.md, memory, mode,
 * tools, etc.). A search box filters rows by source or keyword.
 *
 * Relies on RPC `prompt.provenance`:
 *   { text: string, sourceMap: Record<lineNumber, source> }
 * If the RPC is unavailable, shows a neutral placeholder.
 */

import { useEffect, useMemo, useState } from "react";
import { TRUST_COLORS as C, TRUST_FONT as F, trustRpc } from "./TrustView";

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

interface ProvenanceResponse {
  readonly text?: string;
  readonly sourceMap?: Record<string, string>;
}

interface Row {
  readonly lineNumber: number;
  readonly content: string;
  readonly source: string;
}

/** Stable color per source label (hashed hue). */
function colorForSource(source: string): string {
  let h = 0;
  for (let i = 0; i < source.length; i++) {
    h = (h * 31 + source.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360}, 55%, 62%)`;
}

export function ProvenanceViewer() {
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = (await trustRpc("prompt.provenance", {})) as
        | ProvenanceResponse
        | null;
      if (cancelled) return;

      if (!result || typeof result.text !== "string") {
        setRows(null);
        setLoading(false);
        return;
      }

      const lines = result.text.split("\n");
      const map = result.sourceMap ?? {};
      const normalized: Row[] = lines.map((content, i) => {
        const lineNumber = i + 1;
        const src = map[String(lineNumber)];
        return {
          lineNumber,
          content,
          source: typeof src === "string" && src.length > 0 ? src : "unknown",
        };
      });
      setRows(normalized);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.source.toLowerCase().includes(q) ||
        r.content.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const sources = useMemo(() => {
    if (!rows) return [] as readonly string[];
    const set = new Set<string>();
    for (const r of rows) set.add(r.source);
    return Array.from(set).sort();
  }, [rows]);

  if (loading) return <Placeholder label="Loading provenance..." />;
  if (!rows)
    return <Placeholder label="Provenance data will appear after the first agent turn." />;

  return (
    <div className="h-full flex flex-col" style={{ fontFamily: F, overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${C.divider}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by source or keyword..."
          aria-label="Filter provenance"
          style={{
            flex: "1 1 240px",
            minWidth: 200,
            minHeight: 36,
            padding: "8px 12px",
            background: C.surface,
            border: `1px solid ${C.divider}`,
            borderRadius: 10,
            color: C.textPrimary,
            fontFamily: "inherit",
            fontSize: 13,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} aria-label="Provenance sources">
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setQuery(s)}
              style={{
                minHeight: 24,
                padding: "3px 8px",
                borderRadius: "var(--radius-pill)",
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${colorForSource(s)}40`,
                color: colorForSource(s),
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.3px",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              aria-label={`Filter by source ${s}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px", background: C.bg }}>
        {filtered && filtered.length === 0 ? (
          <Placeholder label="No lines match the filter." />
        ) : (
          <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {filtered?.map((row) => (
              <li
                key={row.lineNumber}
                role="listitem"
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px 100px 1fr",
                  gap: 8,
                  padding: "4px 8px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 12,
                  alignItems: "baseline",
                }}
              >
                <span style={{ color: C.textGhost, fontFamily: MONO, fontSize: 11, textAlign: "right", userSelect: "none" }}>
                  {row.lineNumber}
                </span>
                <span
                  style={{
                    color: colorForSource(row.source),
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.3px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={row.source}
                >
                  {row.source}
                </span>
                <span style={{ color: C.textPrimary, fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {row.content.length === 0 ? "\u00A0" : row.content}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Placeholder({ label }: { readonly label: string }) {
  return (
    <div
      role="status"
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        fontFamily: F,
        fontSize: 12,
        color: C.textDim,
        textAlign: "center",
      }}
    >
      {label}
    </div>
  );
}
