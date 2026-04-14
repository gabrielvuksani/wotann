/**
 * Connectors GUI — two-pane layout: card list on the left, config form on the right.
 * Responsive: stacks vertically on narrow viewports (<768px).
 * Obsidian Precision styling.
 */

import { useState, useEffect } from "react";
import { getConnectors } from "../../store/engine";
import type { ConnectorInfo } from "../../hooks/useTauriCommand";
import { ConnectorCard } from "./ConnectorCard";
import { ConnectorConfigForm, type SupportedConnectorType } from "./ConnectorConfigForm";

const SUPPORTED_TYPES: readonly SupportedConnectorType[] = [
  "google-drive", "notion", "github", "slack", "linear", "jira",
];

const TYPE_META: Readonly<Record<SupportedConnectorType, { readonly name: string; readonly icon: string; readonly description: string }>> = {
  "google-drive": { name: "Google Drive", icon: "\uD83D\uDCC1", description: "Sync Drive folders" },
  "notion":       { name: "Notion",       icon: "\uD83D\uDCDD", description: "Workspace + databases" },
  "github":       { name: "GitHub",       icon: "\uD83D\uDC3E", description: "Repos, issues, PRs" },
  "slack":        { name: "Slack",        icon: "\uD83D\uDCAC", description: "Channels + messages" },
  "linear":       { name: "Linear",       icon: "\u26A1",       description: "Teams + projects" },
  "jira":         { name: "Jira",         icon: "\uD83D\uDD39", description: "Issues + projects" },
};

function isSupportedType(id: string): id is SupportedConnectorType {
  return (SUPPORTED_TYPES as readonly string[]).includes(id);
}

function mergeWithRegistry(
  engineConnectors: readonly ConnectorInfo[],
): readonly ConnectorInfo[] {
  const byId = new Map<string, ConnectorInfo>();
  for (const c of engineConnectors) byId.set(c.id, c);
  return SUPPORTED_TYPES.map((type): ConnectorInfo => {
    const existing = byId.get(type);
    const meta = TYPE_META[type];
    return existing ?? {
      id: type,
      name: meta.name,
      icon: meta.icon,
      description: meta.description,
      connected: false,
      documentsCount: 0,
    };
  });
}

export function ConnectorsGUI() {
  const [connectors, setConnectors] = useState<readonly ConnectorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const result = await getConnectors();
      if (!cancelled) {
        const merged = mergeWithRegistry(result);
        setConnectors(merged);
        setLoading(false);
        if (!selectedId && merged.length > 0) setSelectedId(merged[0]?.id ?? null);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = connectors.find((c) => c.id === selectedId);
  const selectedTypeValid = selected && isSupportedType(selected.id);

  if (loading) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <Header />
        <div className="flex items-center justify-center py-12">
          <div
            className="flex items-center gap-3 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span
              className="w-4 h-4 border-2 rounded-full animate-spin"
              style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-primary)" }}
            />
            Loading connectors&hellip;
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" }}
    >
      <div className="px-4 pt-4">
        <Header />
      </div>
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 px-4 pb-4 mt-4">
        <aside
          className="md:w-64 md:shrink-0 overflow-y-auto rounded-xl border p-2"
          style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
          aria-label="Connectors list"
        >
          <div className="space-y-2">
            {connectors.map((c) => (
              <ConnectorCard
                key={c.id}
                connector={c}
                selected={c.id === selectedId}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </aside>
        <section
          className="flex-1 min-h-0 rounded-xl border overflow-hidden"
          style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
          aria-label="Connector configuration"
        >
          {selected && selectedTypeValid ? (
            <ConnectorConfigForm
              connectorType={selected.id as SupportedConnectorType}
              connectorName={selected.name}
              connected={selected.connected}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {connectors.length === 0
                  ? "No connectors available."
                  : "Select a connector to configure."}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h2
        className="text-lg font-semibold"
        style={{ color: "var(--color-text-primary)" }}
      >
        Data Connectors
      </h2>
      <p
        className="text-xs mt-1"
        style={{ color: "var(--color-text-muted)" }}
      >
        Connect external data sources for context-aware AI assistance
      </p>
    </div>
  );
}
