/**
 * Plugin Manager — browse, install, enable, and configure plugins.
 * OpenAI Codex-inspired: plugins are installable workflow bundles.
 */

import { useState, useEffect, useCallback } from "react";
import { getPlugins } from "../../store/engine";
import type { PluginInfo } from "../../hooks/useTauriCommand";
import { commands } from "../../hooks/useTauriCommand";
import { ValknutSpinner } from "../wotann/ValknutSpinner";

export function PluginManager() {
  const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "installed" | "available">("all");
  const [search, setSearch] = useState("");
  const [manifestInfo, setManifestInfo] = useState<{ skillCount: number; pluginCount: number; lastUpdated: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleInstall = useCallback((pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === pluginId ? { ...p, installed: true, enabled: true } : p,
      ),
    );
  }, []);

  const handleToggleEnabled = useCallback((pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === pluginId ? { ...p, enabled: !p.enabled } : p,
      ),
    );
  }, []);

  const handleRefreshCatalog = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await commands.refreshMarketplaceCatalog();
      setManifestInfo(result);
    } catch {
      // Silently fail — manifest refresh is non-critical
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPlugins() {
      setLoading(true);
      const result = await getPlugins();
      if (!cancelled) {
        setPlugins(result);
        setLoading(false);
      }
      // Also load manifest info
      try {
        const manifest = await commands.getMarketplaceManifest();
        if (!cancelled) setManifestInfo(manifest);
      } catch {
        // Non-critical
      }
    }
    loadPlugins();
    return () => { cancelled = true; };
  }, []);

  const filtered = plugins
    .filter((p) => filter === "all" || (filter === "installed" ? p.installed : !p.installed))
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>Plugins</h2>
          {manifestInfo && (
            <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              {manifestInfo.skillCount} skills, {manifestInfo.pluginCount} plugins
              {manifestInfo.lastUpdated && ` -- updated ${new Date(manifestInfo.lastUpdated).toLocaleDateString()}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefreshCatalog}
            disabled={refreshing}
            className="px-2.5 py-1 text-xs rounded-full transition-colors"
            style={{ background: "var(--surface-3)", color: "var(--color-text-secondary)" }}
            aria-label="Refresh marketplace catalog"
          >
            {refreshing ? "Refreshing..." : "Refresh Catalog"}
          </button>
          <div className="flex gap-1">
            {(["all", "installed", "available"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className="px-2.5 py-1 text-xs rounded-full transition-colors"
                style={filter === f ? { background: "var(--color-primary)", color: "white" } : { background: "var(--surface-3)", color: "var(--color-text-secondary)" }}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <input
        type="text" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search plugins..." aria-label="Search plugins"
        className="w-full mb-4 px-3 py-2 text-sm border rounded-lg focus:outline-none"
        style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <ValknutSpinner size={16} color="var(--color-primary)" label="Loading plugins" />
            Loading plugins...
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 rounded-xl border flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
              <rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 8h4M8 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {search ? "No plugins match your search" : "No plugins available"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((plugin) => (
            <div key={plugin.id} className="rounded-xl border p-4" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{plugin.name}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-3)", color: "var(--color-text-muted)" }}>{plugin.category}</span>
                    <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>v{plugin.version}</span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>{plugin.description}</p>
                  <p className="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>by {plugin.author}</p>
                </div>
                {plugin.installed ? (
                  <button
                    onClick={() => handleToggleEnabled(plugin.id)}
                    className="px-3 py-1 text-xs rounded-lg transition-colors"
                    style={plugin.enabled ? { background: "var(--color-success-muted)", color: "var(--color-success)" } : { background: "var(--surface-3)", color: "var(--color-text-secondary)" }}
                    aria-label={plugin.enabled ? `Disable ${plugin.name}` : `Enable ${plugin.name}`}
                  >
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleInstall(plugin.id)}
                    className="px-3 py-1 text-xs text-white rounded-lg transition-colors"
                    style={{ background: "var(--color-primary)" }}
                    aria-label={`Install ${plugin.name}`}
                  >
                    Install
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
