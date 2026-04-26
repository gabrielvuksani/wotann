/**
 * AtReferences — Cursor-style @ autocomplete popover for the chat composer.
 *
 * Supports 6 prefixes: @file:, @symbol:, @git:, @memory:, @skill:, @web:
 * Each prefix maps to an RPC route (files.search, lsp.symbols, git.log,
 * memory.search, skills.list) or a pure text trigger (@web:).
 *
 * Design:
 * - Dark popover pinned at caret, backdrop blur, rounded 12px
 * - Max 10 items per category, max-height 320px
 * - Up/Down to navigate, Enter to insert, Esc to cancel
 * - Shimmer loading state for in-flight queries
 * - Token-backed accent on the selected row (themes.ts `accent`)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { commands } from "../../hooks/useTauriCommand";
import { color } from "../../design/tokens.generated";

// ── Types ────────────────────────────────────────────────────────────────

export type AtPrefix = "file" | "symbol" | "git" | "memory" | "skill" | "web";

/** A single selectable suggestion rendered inside the popover. */
export interface AtItem {
  readonly kind: AtPrefix;
  /** Raw value used when inserted (file path, symbol id, commit sha, etc.). */
  readonly value: string;
  /** Primary line shown in the row. */
  readonly title: string;
  /** Secondary, dimmer line shown beneath the title. */
  readonly subtitle?: string;
  /** Short display label used inside the resulting chip. */
  readonly chipLabel: string;
}

/** Pixel anchor for positioning the popover (top-left of the caret). */
export interface AtCaretAnchor {
  readonly top: number;
  readonly left: number;
}

export interface AtReferencesProps {
  /** The prefix the user is currently typing (after `@`). */
  readonly prefix: AtPrefix;
  /** Raw search query (text between `prefix:` and the cursor). */
  readonly query: string;
  /** Whether the popover should be visible. */
  readonly open: boolean;
  /** Caret position in the viewport; popover renders above this point. */
  readonly anchor: AtCaretAnchor;
  /** Called when the user selects an item (Enter / click). */
  readonly onSelect: (item: AtItem) => void;
  /** Called when the user dismisses the popover (Esc or outside click). */
  readonly onDismiss: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────

const MAX_ITEMS = 10;
// Token-backed: maps to the active theme's accent via CSS custom property.
const ACCENT = color("accent");
const POPOVER_WIDTH = 360;
const POPOVER_MAX_HEIGHT = 320;

const PREFIX_LABELS: Readonly<Record<AtPrefix, string>> = {
  file: "File",
  symbol: "Symbol",
  git: "Commit",
  memory: "Memory",
  skill: "Skill",
  web: "Web",
};

// ── Icons (inline SVG — zero runtime deps) ───────────────────────────────

function PrefixIcon({ kind }: { readonly kind: AtPrefix }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true,
  } as const;
  switch (kind) {
    case "file":
      return (
        <svg {...common}>
          <path d="M3 1h6l4 4v10H3V1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "symbol":
      return (
        <svg {...common}>
          <path d="M5 2l-1.5 12M12.5 2L11 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M2 6h12M2 10h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "git":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 1.5v4M8 10.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "memory":
      return (
        <svg {...common}>
          <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5 4V2M11 4V2M5 14v-2M11 14v-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "skill":
      return (
        <svg {...common}>
          <path d="M8 1.5l2 4.2 4.5.5-3.3 3 .9 4.5L8 11.6 3.9 13.7l.9-4.5-3.3-3 4.5-.5L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "web":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
  }
}

// ── RPC Envelope ─────────────────────────────────────────────────────────
// The engine accepts structured JSON-RPC-style payloads through the single
// `send_message` command. We wrap call/response so failures surface as empty
// arrays (the UI is always usable even if the daemon is offline).

interface RpcEnvelope {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T | null> {
  try {
    const payload: RpcEnvelope = { method, params };
    const raw = await commands.sendMessage(JSON.stringify(payload));
    if (raw == null || raw === "") return null;
    try {
      const parsed = JSON.parse(raw) as { result?: T } | T;
      if (parsed && typeof parsed === "object" && "result" in (parsed as object)) {
        return (parsed as { result?: T }).result ?? null;
      }
      return parsed as T;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ── Fetchers ─────────────────────────────────────────────────────────────
// Each fetcher converts an RPC payload to a typed `AtItem[]`. Unknown shapes
// are rejected — we never surface raw engine payloads into the UI.

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clipItems(items: readonly AtItem[]): readonly AtItem[] {
  return items.slice(0, MAX_ITEMS);
}

async function fetchFiles(query: string): Promise<readonly AtItem[]> {
  const result = await rpc<ReadonlyArray<{ path?: unknown; name?: unknown }>>(
    "files.search",
    { query, limit: MAX_ITEMS },
  );
  if (!Array.isArray(result)) return [];
  const items: AtItem[] = [];
  for (const row of result) {
    const path = asString(row?.path);
    if (!path) continue;
    const name = asString(row?.name) || path.split("/").pop() || path;
    items.push({
      kind: "file",
      value: path,
      title: name,
      subtitle: path,
      chipLabel: name,
    });
  }
  return clipItems(items);
}

async function fetchSymbols(query: string): Promise<readonly AtItem[]> {
  const result = await rpc<ReadonlyArray<{ name?: unknown; kind?: unknown; path?: unknown; line?: unknown }>>(
    "lsp.symbols",
    { query, limit: MAX_ITEMS },
  );
  if (!Array.isArray(result)) return [];
  const items: AtItem[] = [];
  for (const row of result) {
    const name = asString(row?.name);
    if (!name) continue;
    const kind = asString(row?.kind);
    const path = asString(row?.path);
    const line = typeof row?.line === "number" ? row.line : null;
    const locSuffix = line != null ? `:${line}` : "";
    items.push({
      kind: "symbol",
      value: path ? `${path}${locSuffix}#${name}` : name,
      title: name,
      subtitle: [kind, path ? `${path}${locSuffix}` : null].filter(Boolean).join(" \u00b7 "),
      chipLabel: name,
    });
  }
  return clipItems(items);
}

async function fetchGit(query: string): Promise<readonly AtItem[]> {
  const result = await rpc<ReadonlyArray<{ sha?: unknown; subject?: unknown; author?: unknown; date?: unknown }>>(
    "git.log",
    { query, limit: MAX_ITEMS },
  );
  if (!Array.isArray(result)) return [];
  const items: AtItem[] = [];
  for (const row of result) {
    const sha = asString(row?.sha);
    if (!sha) continue;
    const short = sha.slice(0, 7);
    const subject = asString(row?.subject) || "(no message)";
    const author = asString(row?.author);
    const date = asString(row?.date);
    items.push({
      kind: "git",
      value: sha,
      title: subject,
      subtitle: [short, author, date].filter(Boolean).join(" \u00b7 "),
      chipLabel: short,
    });
  }
  return clipItems(items);
}

async function fetchMemory(query: string): Promise<readonly AtItem[]> {
  const result = await rpc<ReadonlyArray<{ id?: unknown; title?: unknown; snippet?: unknown; source?: unknown }>>(
    "memory.search",
    { query, limit: MAX_ITEMS },
  );
  if (!Array.isArray(result)) return [];
  const items: AtItem[] = [];
  for (const row of result) {
    const id = asString(row?.id);
    if (!id) continue;
    const title = asString(row?.title) || id;
    const snippet = asString(row?.snippet);
    const source = asString(row?.source);
    items.push({
      kind: "memory",
      value: id,
      title,
      subtitle: snippet || source || undefined,
      chipLabel: title.length > 28 ? `${title.slice(0, 25)}...` : title,
    });
  }
  return clipItems(items);
}

async function fetchSkills(query: string): Promise<readonly AtItem[]> {
  const result = await rpc<ReadonlyArray<{ name?: unknown; description?: unknown; category?: unknown }>>(
    "skills.list",
    { query, limit: MAX_ITEMS },
  );
  if (!Array.isArray(result)) return [];
  const lower = query.toLowerCase();
  const items: AtItem[] = [];
  for (const row of result) {
    const name = asString(row?.name);
    if (!name) continue;
    if (lower && !name.toLowerCase().includes(lower)) continue;
    const description = asString(row?.description);
    const category = asString(row?.category);
    items.push({
      kind: "skill",
      value: name,
      title: name,
      subtitle: description || category || undefined,
      chipLabel: name,
    });
  }
  return clipItems(items);
}

/** @web: is a pure-text trigger — no RPC. We expose one synthetic option. */
function webItems(query: string): readonly AtItem[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [
      {
        kind: "web",
        value: "",
        title: "Web search",
        subtitle: "Type a query after @web: to search with Perplexity",
        chipLabel: "Web",
      },
    ];
  }
  return [
    {
      kind: "web",
      value: trimmed,
      title: `Search the web for "${trimmed}"`,
      subtitle: "Runs a Perplexity-backed query",
      chipLabel: trimmed.length > 24 ? `${trimmed.slice(0, 21)}...` : trimmed,
    },
  ];
}

async function fetchItems(prefix: AtPrefix, query: string): Promise<readonly AtItem[]> {
  switch (prefix) {
    case "file":
      return fetchFiles(query);
    case "symbol":
      return fetchSymbols(query);
    case "git":
      return fetchGit(query);
    case "memory":
      return fetchMemory(query);
    case "skill":
      return fetchSkills(query);
    case "web":
      return webItems(query);
  }
}

// ── Shimmer ──────────────────────────────────────────────────────────────

const SHIMMER_KEYFRAMES_ID = "wotann-at-shimmer";
if (typeof document !== "undefined" && !document.getElementById(SHIMMER_KEYFRAMES_ID)) {
  const style = document.createElement("style");
  style.id = SHIMMER_KEYFRAMES_ID;
  style.textContent = `
    @keyframes wotannAtShimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;
  document.head.appendChild(style);
}

function ShimmerRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 100%)",
          backgroundSize: "200% 100%",
          animation: "wotannAtShimmer 1.4s linear infinite",
        }}
      />
      <div style={{ flex: 1 }}>
        <div
          style={{
            height: 11,
            borderRadius: 3,
            width: "58%",
            background: "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 100%)",
            backgroundSize: "200% 100%",
            animation: "wotannAtShimmer 1.4s linear infinite",
            marginBottom: 4,
          }}
        />
        <div
          style={{
            height: 9,
            borderRadius: 3,
            width: "82%",
            background: "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)",
            backgroundSize: "200% 100%",
            animation: "wotannAtShimmer 1.4s linear infinite",
          }}
        />
      </div>
    </div>
  );
}

// ── Popover component ────────────────────────────────────────────────────

export function AtReferences({
  prefix,
  query,
  open,
  anchor,
  onSelect,
  onDismiss,
}: AtReferencesProps) {
  const [items, setItems] = useState<readonly AtItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestIdRef = useRef(0);

  // Fetch items whenever prefix/query changes while open.
  useEffect(() => {
    if (!open) return;
    const currentRequest = ++requestIdRef.current;
    setLoading(true);
    fetchItems(prefix, query).then((result) => {
      if (requestIdRef.current !== currentRequest) return;
      setItems(result);
      setSelectedIndex(0);
      setLoading(false);
    });
  }, [open, prefix, query]);

  // Reset selection when closing.
  useEffect(() => {
    if (!open) {
      setSelectedIndex(0);
      setItems([]);
    }
  }, [open]);

  // Keyboard navigation — listens at the window level so the composer's
  // textarea can stay focused while the popover is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (items.length === 0 ? 0 : (prev + 1) % items.length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          items.length === 0 ? 0 : (prev - 1 + items.length) % items.length,
        );
        return;
      }
      if (e.key === "Enter") {
        if (items.length === 0) return;
        const chosen = items[Math.min(selectedIndex, items.length - 1)];
        if (!chosen) return;
        e.preventDefault();
        onSelect(chosen);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, items, selectedIndex, onSelect, onDismiss]);

  // Scroll the selected row into view when navigating with the keyboard.
  useEffect(() => {
    const node = rowRefs.current[selectedIndex];
    if (node) {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const header = useMemo(() => PREFIX_LABELS[prefix], [prefix]);

  if (!open) return null;

  // Render the popover above the caret, clamped inside the viewport.
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const maxLeft = Math.max(8, viewportWidth - POPOVER_WIDTH - 8);
  const left = Math.min(Math.max(8, anchor.left), maxLeft);
  const top = Math.max(8, anchor.top - POPOVER_MAX_HEIGHT - 8);

  return (
    <div
      role="listbox"
      aria-label={`${header} suggestions`}
      style={{
        position: "fixed",
        top,
        left,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_MAX_HEIGHT,
        display: "flex",
        flexDirection: "column",
        borderRadius: "var(--radius-lg)",
        background: "rgba(20,20,22,0.92)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        overflow: "hidden",
        zIndex: 1000,
        font: "15px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
        color: "rgba(255,255,255,0.92)",
      }}
    >
      {/* Header strip */}
      <div
        style={{
          padding: "8px 12px",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "rgba(255,255,255,0.48)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ color: ACCENT }}>@{prefix}:</span>
        <span>{header}</span>
        {query && (
          <span style={{ color: "rgba(255,255,255,0.32)", marginLeft: "auto" }}>
            {query}
          </span>
        )}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
        {loading && (
          <>
            <ShimmerRow />
            <ShimmerRow />
            <ShimmerRow />
          </>
        )}
        {!loading && items.length === 0 && (
          <div
            style={{
              padding: "14px 12px",
              fontSize: 13,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            No matches
          </div>
        )}
        {!loading &&
          items.map((item, idx) => {
            const selected = idx === selectedIndex;
            return (
              <button
                key={`${item.kind}-${item.value}-${idx}`}
                ref={(node) => {
                  rowRefs.current[idx] = node;
                }}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => onSelect(item)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  background: selected ? "rgba(10,132,255,0.16)" : "transparent",
                  boxShadow: selected ? `inset 0 0 0 1px rgba(10,132,255,0.35)` : "none",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "background 120ms ease",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    background: selected ? "rgba(10,132,255,0.22)" : "rgba(255,255,255,0.05)",
                    color: selected ? ACCENT : "rgba(255,255,255,0.65)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <PrefixIcon kind={item.kind} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 14,
                      fontWeight: 500,
                      color: selected ? color("text") : "rgba(255,255,255,0.92)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "rgba(255,255,255,0.48)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        marginTop: 1,
                      }}
                    >
                      {item.subtitle}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

// ── Token parsing helper (shared with ComposerInput) ────────────────────
// Returns the active `@prefix:query` token if the cursor is inside one.
// Example: "hi @file:src/m|ain.ts" -> { prefix: "file", query: "src/m", ... }
export interface AtTokenMatch {
  readonly prefix: AtPrefix;
  readonly query: string;
  /** Index of the `@` character in the input string. */
  readonly startIndex: number;
  /** Index one past the last query character (exclusive). */
  readonly endIndex: number;
}

const PREFIX_PATTERN = /@(file|symbol|git|memory|skill|web):([^\s@]*)$/i;

export function findActiveAtToken(input: string, cursor: number): AtTokenMatch | null {
  const before = input.slice(0, cursor);
  const match = before.match(PREFIX_PATTERN);
  if (!match) return null;
  const prefix = match[1]?.toLowerCase() as AtPrefix | undefined;
  if (!prefix) return null;
  const query = match[2] ?? "";
  const startIndex = before.length - match[0].length;
  const endIndex = cursor;
  return { prefix, query, startIndex, endIndex };
}
