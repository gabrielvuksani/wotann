/**
 * Memory contents browser with search and filtering.
 */

import type React from "react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useStore } from "../../store";
import { searchMemory } from "../../store/engine";
import type { MemoryEntry } from "../../types";

const TYPE_STYLES: Record<string, { bgStyle: React.CSSProperties; textColor: string }> = {
  case: { bgStyle: { background: "var(--color-info-muted)", borderColor: "rgba(96, 165, 250, 0.3)" }, textColor: "var(--info)" },
  pattern: { bgStyle: { background: "var(--color-success-muted)", borderColor: "rgba(16, 185, 129, 0.3)" }, textColor: "var(--color-success)" },
  decision: { bgStyle: { background: "var(--color-warning-muted)", borderColor: "rgba(245, 158, 11, 0.3)" }, textColor: "var(--color-warning)" },
  feedback: { bgStyle: { background: "var(--accent-muted)", borderColor: "var(--border-focus)" }, textColor: "var(--color-primary)" },
  project: { bgStyle: { background: "rgba(6, 182, 212, 0.1)", borderColor: "rgba(6, 182, 212, 0.3)" }, textColor: "var(--color-accent)" },
  reference: { bgStyle: { background: "rgba(236, 72, 153, 0.1)", borderColor: "rgba(236, 72, 153, 0.3)" }, textColor: "var(--red)" },
};

type FilterType = "all" | MemoryEntry["type"];

/**
 * Infer the architectural memory layer from a MemoryEntry's type and source.
 * MemoryEntry does not have an explicit layer field, so we map based on
 * content type and source metadata to the 8 architectural layers.
 */
function inferLayer(entry: MemoryEntry): LayerFilter {
  const src = entry.source.toLowerCase();
  // Source-based inference
  if (src.includes("auto") || src.includes("capture"))     return "auto_capture";
  if (src.includes("team") || src.includes("shared"))       return "team";
  if (src.includes("proactive") || src.includes("suggest")) return "proactive";
  if (src.includes("graph") || src.includes("knowledge"))   return "knowledge_graph";
  if (src.includes("archive") || src.includes("archival"))  return "archival";
  if (src.includes("recall") || src.includes("search"))     return "recall";
  if (src.includes("working") || src.includes("session"))   return "working";
  // Type-based fallback
  switch (entry.type) {
    case "feedback":
    case "project":
    case "reference":
      return "core_blocks";
    case "case":
    case "pattern":
      return "knowledge_graph";
    case "decision":
      return "archival";
    default:
      return "core_blocks";
  }
}

const MEMORY_LAYERS = [
  "all",
  "auto_capture",
  "core_blocks",
  "working",
  "knowledge_graph",
  "archival",
  "recall",
  "team",
  "proactive",
] as const;

type LayerFilter = (typeof MEMORY_LAYERS)[number];

const LAYER_LABELS: Record<LayerFilter, string> = {
  all: "All Layers",
  auto_capture: "Auto-Capture",
  core_blocks: "Core Blocks",
  working: "Working",
  knowledge_graph: "Knowledge Graph",
  archival: "Archival",
  recall: "Recall",
  team: "Team",
  proactive: "Proactive",
};

export function MemoryInspector() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [layerFilter, setLayerFilter] = useState<LayerFilter>("all");
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const memoryEntries = useStore((s) => s.memoryEntries);

  // Load initial entries on mount
  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      setLoading(true);
      await searchMemory("*");
      if (!cancelled) {
        setInitialLoaded(true);
        setLoading(false);
      }
    }
    loadInitial();
    return () => { cancelled = true; };
  }, []);

  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    setSearchError(null);
    try {
      if (query.trim()) {
        setLoading(true);
        await searchMemory(query);
      } else {
        setLoading(true);
        await searchMemory("*");
      }
    } catch {
      setSearchError("Memory search failed. Engine may be disconnected.");
    }
    setLoading(false);
  }, []);

  const filtered = useMemo(() => {
    let result = [...memoryEntries];
    if (filterType !== "all") {
      result = result.filter((e) => e.type === filterType);
    }
    if (layerFilter !== "all") {
      result = result.filter((e) => inferLayer(e) === layerFilter);
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((e) => e.content.toLowerCase().includes(query));
    }
    return result.sort((a, b) => b.score - a.score);
  }, [memoryEntries, filterType, layerFilter, searchQuery]);

  const typeFilters: readonly { id: FilterType; label: string }[] = [
    { id: "all", label: "All" },
    { id: "case", label: "Cases" },
    { id: "pattern", label: "Patterns" },
    { id: "decision", label: "Decisions" },
    { id: "feedback", label: "Feedback" },
    { id: "project", label: "Project" },
    { id: "reference", label: "Reference" },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b p-4 animate-fadeIn" style={{ borderColor: "var(--border-subtle)" }}>
        <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>Memory</h2>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Persistent knowledge that survives across sessions — decisions, bugs, patterns, and conventions
        </p>
      </div>

      {/* Search + filter */}
      <div className="border-b p-3 space-y-2" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="relative">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--color-text-muted)" }}
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search memory entries..."
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg focus:outline-none transition-colors"
            style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
            aria-label="Search memory entries"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {typeFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id)}
              className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
                filterType !== f.id ? "filter-chip-inactive" : ""
              }`}
              style={filterType === f.id
                ? { background: "var(--accent-glow)", borderColor: "var(--border-focus)", color: "var(--color-primary)" }
                : { background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-muted)" }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Layer filter */}
        <div className="flex gap-1.5 flex-wrap pt-1">
          {MEMORY_LAYERS.map((layer) => (
            <button
              key={layer}
              onClick={() => setLayerFilter(layer)}
              className={`px-2.5 py-1 text-[10px] rounded-lg border transition-colors ${
                layerFilter !== layer ? "filter-chip-inactive" : ""
              }`}
              style={layerFilter === layer
                ? { background: "rgba(10, 132, 255, 0.12)", borderColor: "rgba(10, 132, 255, 0.4)", color: "rgb(10, 132, 255)" }
                : { background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-dim)" }
              }
            >
              {LAYER_LABELS[layer]}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="px-4 py-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
        {loading ? "Searching..." : `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"} found`}
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {loading && !initialLoaded ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-primary)" }} />
              Loading memory...
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <div className="w-12 h-12 rounded-xl border flex items-center justify-center" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
              <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3M8 10v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {searchError ? searchError : searchQuery ? "No entries match your search" : "No memory entries yet"}
            </p>
            {!searchQuery && (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Memory accumulates as you use WOTANN across sessions
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {filtered.map((entry) => {
              const typeStyle = TYPE_STYLES[entry.type] ?? TYPE_STYLES["feedback"]!;
              return (
                <div
                  key={entry.id}
                  className="px-4 py-3 transition-colors"
                  style={{ cursor: "default" }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="px-1.5 py-0.5 text-[10px] rounded font-medium border"
                      style={{ ...typeStyle.bgStyle, color: typeStyle.textColor }}
                    >
                      {entry.type}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                      {(entry.score * 100).toFixed(0)}% relevance
                    </span>
                    <span
                      className="px-1.5 py-0.5 text-[9px] rounded font-medium border"
                      style={{ background: "rgba(10, 132, 255, 0.08)", borderColor: "rgba(10, 132, 255, 0.25)", color: "rgb(10, 132, 255)" }}
                    >
                      {LAYER_LABELS[inferLayer(entry)]}
                    </span>
                    <span className="text-[10px] ml-auto" style={{ color: "var(--color-text-muted)" }}>
                      {entry.source}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                    {entry.content}
                  </p>
                  <div className="text-[10px] mt-1.5" style={{ color: "var(--color-text-muted)" }}>
                    {new Date(entry.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
