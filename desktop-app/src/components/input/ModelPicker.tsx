/**
 * Provider + model dropdown selector.
 * Groups models by provider with cost indicators.
 * Designed to sit in the Header and open downward.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useStore } from "../../store";

export function ModelPicker() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const providers = useStore((s) => s.providers);
  const currentProvider = useStore((s) => s.provider);
  const currentModel = useStore((s) => s.model);
  const setProvider = useStore((s) => s.setProvider);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) {
      // Defer focus so the element is rendered first
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setSearch("");
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Filter providers/models by search term
  const filteredProviders = useMemo(() => {
    if (!search.trim()) return providers;
    const term = search.toLowerCase();
    return providers
      .map((provider) => ({
        ...provider,
        models: provider.models.filter(
          (m) =>
            m.name.toLowerCase().includes(term) ||
            m.id.toLowerCase().includes(term) ||
            provider.name.toLowerCase().includes(term)
        ),
      }))
      .filter((p) => p.models.length > 0);
  }, [providers, search]);

  // Keyboard navigation: Escape closes, Arrow keys navigate
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) return;
    // Flatten all enabled models for arrow navigation
    const allModels = filteredProviders.flatMap((p) =>
      p.enabled ? p.models.map((m) => ({ provider: p.id, model: m.id })) : []
    );
    if (allModels.length === 0) return;
    const currentIdx = allModels.findIndex(
      (m) => m.provider === currentProvider && m.model === currentModel
    );
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = allModels[(currentIdx + 1) % allModels.length]!;
      setProvider(next.provider, next.model);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = allModels[(currentIdx - 1 + allModels.length) % allModels.length]!;
      setProvider(prev.provider, prev.model);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setOpen(false);
    }
  }, [open, filteredProviders, currentProvider, currentModel, setProvider]);

  const activeProvider = providers.find((p) => p.id === currentProvider);
  const activeModel = activeProvider?.models.find((m) => m.id === currentModel);

  return (
    <div className="relative" ref={ref} onKeyDown={handleKeyDown}>
      <button
        onClick={() => setOpen(!open)}
        className="btn-press"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: "var(--font-size-xs)",
          borderRadius: 8,
          background: "var(--bg-surface)",
          color: "var(--color-text-secondary)",
          border: "1px solid rgba(255,255,255,0.06)",
          cursor: "pointer",
          transition: "background 150ms ease, border-color 150ms ease",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current model: ${activeModel?.name ?? currentModel}. Click to change.`}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", flexShrink: 0 }} aria-hidden="true" />
        <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeModel?.name ?? (currentModel || "No model")}
        </span>
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 animate-scaleIn"
          style={{
            top: "100%",
            right: 0,
            marginTop: 4,
            width: 280,
            background: "#1C1C1E",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            boxShadow: "var(--shadow-lg)",
          }}
          role="listbox"
          aria-label="Select a model"
        >
          {/* Search input */}
          <div style={{ padding: "8px 8px 0" }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full bg-transparent focus:outline-none"
              style={{
                height: 36,
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-primary)",
                padding: "0 10px",
                borderRadius: 10,
                background: "var(--surface-1)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
              aria-label="Search models"
            />
          </div>

          <div style={{ maxHeight: 400, overflowY: "auto", padding: "4px 0" }}>
            {filteredProviders.length === 0 && (
              <div className="px-3 py-4 text-center" style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
                No models match "{search}"
              </div>
            )}
            {filteredProviders.map((provider) => (
              <div key={provider.id} role="group" aria-label={provider.name}>
                <div
                  className="px-3 py-1.5 font-semibold uppercase sticky top-0"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    color: "var(--color-text-dim)",
                    background: "rgba(28, 28, 30, 0.95)",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  {provider.name}
                  {!provider.enabled && (
                    <span className="ml-1" style={{ color: "var(--color-text-dim)" }}>(not configured)</span>
                  )}
                </div>
                {provider.models.map((model) => {
                  const isActive = currentProvider === provider.id && currentModel === model.id;
                  return (
                    <button
                      key={model.id}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        setProvider(provider.id, model.id);
                        setOpen(false);
                      }}
                      disabled={!provider.enabled}
                      className="w-full text-left px-3 py-2 flex items-center justify-between transition-colors hover:bg-[var(--bg-surface-hover)]"
                      style={{
                        ...(isActive
                          ? { background: "var(--accent-muted)", color: "var(--color-primary)" }
                          : provider.enabled
                            ? { color: "var(--color-text-secondary)" }
                            : { color: "var(--color-text-dim)", cursor: "not-allowed" }),
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 15 }}>{model.name}</div>
                        <div style={{ fontSize: 11, color: "var(--color-text-dim)" }}>
                          {(model.contextWindow / 1000).toFixed(0)}K context
                          {model.costPerMTok > 0
                            ? ` · $${model.costPerMTok}/MTok`
                            : " · Free (local)"}
                        </div>
                      </div>
                      {isActive && (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path
                            d="M13.5 4.5l-7 7L3 8"
                            stroke="var(--color-primary)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
