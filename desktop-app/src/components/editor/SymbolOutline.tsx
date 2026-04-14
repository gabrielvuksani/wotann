/**
 * Symbol Outline Panel — D8 (LSP).
 *
 * Shows the LSP symbol tree (classes, methods, fields) for the currently
 * open file. Calls the daemon RPC `lsp.symbols` via the JSON-RPC bridge
 * shared with the Intelligence Dashboard. Clicking a symbol dispatches a
 * `wotann:editor-jump-to-line` CustomEvent that the editor can listen for.
 *
 * Pure rendering logic lives in SymbolTree.tsx.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { commands } from "../../hooks/useTauriCommand";
import { normalizeSymbols, SymbolRow, type RpcSymbol, type UISymbol } from "./SymbolTree";

interface SymbolOutlineProps {
  readonly filePath: string | null;
}

async function fetchSymbols(filePath: string): Promise<readonly UISymbol[]> {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "lsp.symbols",
    params: { path: filePath, uri: `file://${filePath}` },
    id: Date.now(),
  });
  const response = await commands.sendMessage(payload);
  if (!response) return [];
  try {
    const parsed = JSON.parse(response) as { result?: unknown; error?: { message?: string } };
    if (parsed.error) throw new Error(parsed.error.message ?? "lsp.symbols failed");
    const result = parsed.result;
    if (Array.isArray(result)) return normalizeSymbols(result as RpcSymbol[]);
    if (result && typeof result === "object" && Array.isArray((result as { symbols?: unknown }).symbols)) {
      return normalizeSymbols((result as { symbols: RpcSymbol[] }).symbols);
    }
    return [];
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export function SymbolOutline({ filePath }: SymbolOutlineProps) {
  const [symbols, setSymbols] = useState<readonly UISymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!filePath) {
      setSymbols([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await fetchSymbols(filePath);
        if (!cancelled) setSymbols(data);
      } catch (err) {
        if (!cancelled) setError(String(err instanceof Error ? err.message : err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  const refresh = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSymbols(filePath);
      setSymbols(data);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  const filtered = useMemo(() => {
    if (!filter) return symbols;
    const q = filter.toLowerCase();
    const match = (s: UISymbol): UISymbol | null => {
      const kidsMatched = s.children.map(match).filter((x): x is UISymbol => x !== null);
      if (s.name.toLowerCase().includes(q) || kidsMatched.length > 0) {
        return { ...s, children: kidsMatched };
      }
      return null;
    };
    return symbols.map(match).filter((s): s is UISymbol => s !== null);
  }, [symbols, filter]);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: "#000",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        minWidth: 220,
      }}
      role="region"
      aria-label="Symbol outline"
    >
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-dim)" }}>
          Outline
        </div>
        <button
          onClick={refresh}
          disabled={!filePath || loading}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent",
            color: "var(--color-text-secondary)",
            cursor: filePath && !loading ? "pointer" : "not-allowed",
            opacity: filePath && !loading ? 1 : 0.5,
          }}
          aria-label="Refresh symbols"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {filePath && symbols.length > 0 && (
        <div style={{ padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter symbols..."
            style={{
              width: "100%",
              background: "#1C1C1E",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12,
              color: "var(--color-text-primary)",
              outline: "none",
            }}
            aria-label="Filter symbols"
          />
        </div>
      )}

      <div className="flex-1 overflow-auto" style={{ padding: "4px 0" }}>
        {!filePath ? (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)", padding: "16px 12px", textAlign: "center", fontStyle: "italic" }}>
            Open a file to see symbols
          </p>
        ) : error ? (
          <p style={{ fontSize: 12, color: "#ff453a", padding: "12px" }}>{error}</p>
        ) : loading && symbols.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)", padding: "12px" }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)", padding: "12px", fontStyle: "italic" }}>
            {filter ? "No matching symbols" : "No symbols found"}
          </p>
        ) : (
          filtered.map((s) => (
            <SymbolRow key={s.id} symbol={s} depth={0} filePath={filePath} />
          ))
        )}
      </div>
    </div>
  );
}
