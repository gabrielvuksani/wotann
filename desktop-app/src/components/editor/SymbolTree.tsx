/**
 * Symbol tree + LSP kind mapping — pure presentation + normalizers.
 * Extracted from SymbolOutline to keep each file focused and small.
 */

import { useState } from "react";
import { color as tokenColor } from "../../design/tokens.generated";

/** LSP-ish SymbolKind numeric → readable label mapping. */
const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method",
  7: "property", 8: "field", 9: "constructor", 10: "enum", 11: "interface",
  12: "function", 13: "variable", 14: "constant", 15: "string", 16: "number",
  17: "boolean", 18: "array", 19: "object", 20: "key", 21: "null",
  22: "enum-member", 23: "struct", 24: "event", 25: "operator", 26: "type-parameter",
};

export interface RpcSymbol {
  readonly name: string;
  readonly kind: number | string;
  readonly line?: number;
  readonly startLine?: number;
  readonly range?: { readonly start?: { readonly line?: number } };
  readonly location?: { readonly range?: { readonly start?: { readonly line?: number } } };
  readonly children?: readonly RpcSymbol[];
  readonly detail?: string;
}

export interface UISymbol {
  readonly id: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly line: number;
  readonly detail?: string;
  readonly children: readonly UISymbol[];
}

function extractLine(s: RpcSymbol): number {
  return (
    s.line ??
    s.startLine ??
    s.range?.start?.line ??
    s.location?.range?.start?.line ??
    0
  );
}

function normalizeKind(kind: number | string): string {
  if (typeof kind === "string") return kind.toLowerCase();
  return SYMBOL_KIND_NAMES[kind] ?? "symbol";
}

/** Recursively convert LSP-shaped symbols into UI-friendly tree nodes. */
export function normalizeSymbols(symbols: readonly RpcSymbol[] | undefined, prefix = ""): readonly UISymbol[] {
  if (!Array.isArray(symbols)) return [];
  return symbols.map((s, i) => {
    const id = `${prefix}${s.name ?? "node"}-${i}`;
    return {
      id,
      name: s.name ?? "(unnamed)",
      kindLabel: normalizeKind(s.kind ?? 0),
      line: extractLine(s),
      detail: s.detail,
      children: normalizeSymbols(s.children, `${id}-`),
    };
  });
}

function kindIconColor(kind: string): string {
  if (kind === "class" || kind === "interface" || kind === "struct") return tokenColor("accent");
  if (kind === "method" || kind === "function" || kind === "constructor") return tokenColor("success");
  if (kind === "property" || kind === "field") return tokenColor("warning");
  // TODO(design-token): no purple/violet semantic token exists; keep literal
  if (kind === "variable" || kind === "constant") return "#bf5af2";
  return tokenColor("muted");
}

function kindIconLetter(kind: string): string {
  const first = kind.charAt(0).toUpperCase();
  return first || "?";
}

/** Fires a CustomEvent that the editor listens for to jump to a line. */
function jumpToLine(path: string, line: number) {
  window.dispatchEvent(new CustomEvent("wotann:editor-jump-to-line", { detail: { path, line } }));
}

export function SymbolRow({ symbol, depth, filePath }: { readonly symbol: UISymbol; readonly depth: number; readonly filePath: string }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = symbol.children.length > 0;
  const color = kindIconColor(symbol.kindLabel);

  return (
    <>
      <button
        onClick={() => {
          if (hasChildren) setExpanded((v) => !v);
          jumpToLine(filePath, symbol.line);
        }}
        style={{
          width: "100%",
          padding: `4px 8px 4px ${8 + depth * 14}px`,
          background: "transparent",
          border: "none",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          color: "var(--color-text-primary)",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          borderRadius: 4,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        aria-label={`Jump to ${symbol.name} on line ${symbol.line + 1}`}
      >
        {hasChildren ? (
          <span
            style={{
              width: 10,
              display: "inline-block",
              transform: expanded ? "rotate(0)" : "rotate(-90deg)",
              transition: "transform 120ms",
              color: "var(--color-text-dim)",
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            ▾
          </span>
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} aria-hidden="true" />
        )}
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            background: `${color}20`,
            color,
            fontSize: 10,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontFamily: "var(--font-sans)",
          }}
          aria-hidden="true"
          title={symbol.kindLabel}
        >
          {kindIconLetter(symbol.kindLabel)}
        </span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {symbol.name}
        </span>
        {symbol.detail && (
          <span style={{ color: "var(--color-text-dim)", fontSize: 11, flexShrink: 0 }}>{symbol.detail}</span>
        )}
        <span style={{ color: "var(--color-text-dim)", fontSize: 10, flexShrink: 0 }}>
          {symbol.line + 1}
        </span>
      </button>
      {hasChildren && expanded && symbol.children.map((c) => (
        <SymbolRow key={c.id} symbol={c} depth={depth + 1} filePath={filePath} />
      ))}
    </>
  );
}
