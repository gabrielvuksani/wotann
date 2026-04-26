/**
 * ConnectorsTab — knowledge-connector cards.
 * RPCs: connectors.list, connectors.sync, connectors.configure
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PALETTE, safeInvoke } from "./IntegrationsView";
import { WebhookServerSection } from "./WebhookServerSection";

interface ConnectorStatus {
  readonly id: string;
  readonly name?: string;
  readonly connected: boolean;
  readonly documentsCount?: number;
  readonly lastSyncAt?: number | null;
}

interface ConnectorMeta {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly description: string;
  readonly configKeys: readonly string[];
}

const CATALOG: readonly ConnectorMeta[] = [
  { id: "google-drive", name: "Google Drive", icon: "\uD83D\uDCC1", description: "Files, Docs, and Sheets", configKeys: ["GOOGLE_DRIVE_TOKEN", "DRIVE_FOLDER_ID"] },
  { id: "notion", name: "Notion", icon: "\uD83D\uDCDD", description: "Workspaces and databases", configKeys: ["NOTION_TOKEN", "NOTION_DATABASE_ID"] },
  { id: "github", name: "GitHub", icon: "\uD83D\uDC3E", description: "Repos, issues, and PRs", configKeys: ["GITHUB_TOKEN", "GITHUB_ORG"] },
  { id: "slack", name: "Slack", icon: "\uD83D\uDCAC", description: "Channel history and messages", configKeys: ["SLACK_USER_TOKEN"] },
  { id: "linear", name: "Linear", icon: "\u26A1", description: "Teams and projects", configKeys: ["LINEAR_API_KEY"] },
  { id: "jira", name: "Jira", icon: "\uD83D\uDD39", description: "Issues and sprints", configKeys: ["JIRA_HOST", "JIRA_EMAIL", "JIRA_TOKEN"] },
] as const;

interface Props { readonly onRefresh?: () => Promise<void> | void }

function fmt(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || ts === 0) return "Never synced";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = Date.now() - ms;
  if (d < 60_000) return "Just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function isSecretKey(k: string): boolean {
  const lo = k.toLowerCase();
  return lo.includes("token") || lo.includes("key") || lo.includes("pass");
}

export function ConnectorsTab({ onRefresh }: Props) {
  const [statuses, setStatuses] = useState<readonly ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const r = await safeInvoke<readonly ConnectorStatus[]>("get_connectors");
    setStatuses(r ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const statusById = useMemo(() => {
    const m = new Map<string, ConnectorStatus>();
    for (const s of statuses) m.set(s.id, s);
    return m;
  }, [statuses]);

  const merged = useMemo(
    () => CATALOG.map((m) => ({
      meta: m,
      status: statusById.get(m.id) ?? { id: m.id, name: m.name, connected: false, documentsCount: 0, lastSyncAt: null },
    })),
    [statusById],
  );

  const sync = useCallback(async (id: string) => {
    setSyncing((p) => ({ ...p, [id]: true }));
    await safeInvoke<unknown>("connectors.sync", { connectorId: id });
    await load();
    if (onRefresh) await onRefresh();
    setSyncing((p) => ({ ...p, [id]: false }));
  }, [load, onRefresh]);

  const saveConfig = useCallback(async (id: string) => {
    await safeInvoke<unknown>("connectors.configure", { connectorId: id, config: draft[id] ?? {} });
    setConfiguringId(null);
    await load();
    if (onRefresh) await onRefresh();
  }, [draft, load, onRefresh]);

  const updateDraft = useCallback((id: string, key: string, value: string) => {
    setDraft((p) => ({ ...p, [id]: { ...(p[id] ?? {}), [key]: value } }));
  }, []);

  if (loading) return <Block label="Loading connectors..." />;
  if (merged.length === 0) return <Block label="No connectors configured. See docs." />;

  return (
    <div style={{
      height: "100%", overflowY: "auto", padding: "20px 24px",
      display: "flex", flexDirection: "column", gap: 16,
    }}>
      <WebhookServerSection />
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 12, alignContent: "start",
      }}>
      {merged.map(({ meta, status }) => {
        const isSyncing = syncing[meta.id] === true;
        const isConfiguring = configuringId === meta.id;
        return (
          <article key={meta.id} style={{
            background: PALETTE.surface, borderRadius: "var(--radius-lg)",
            border: `1px solid ${PALETTE.divider}`, padding: 16,
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <header style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden="true">{meta.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: PALETTE.textPrimary }}>{meta.name}</div>
                <p style={{ fontSize: 12, color: PALETTE.textSecondary, margin: "2px 0 0 0" }}>{meta.description}</p>
              </div>
              <span aria-label={status.connected ? "Connected" : "Disconnected"}
                style={{
                  width: 8, height: 8, borderRadius: "var(--radius-xs)", marginTop: 6,
                  background: status.connected ? PALETTE.green : PALETTE.grey,
                  boxShadow: status.connected ? `0 0 6px ${PALETTE.green}` : "none",
                }}
              />
            </header>
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: PALETTE.textSecondary }}>
              <span>
                <strong style={{ color: PALETTE.textPrimary, fontWeight: 600 }}>{status.documentsCount ?? 0}</strong>
                {" "}{status.documentsCount === 1 ? "document" : "documents"}
              </span>
              <span>{fmt(status.lastSyncAt)}</span>
            </div>
            {isConfiguring && meta.configKeys.length > 0 && (
              <ConfigFormInline
                keys={meta.configKeys}
                values={draft[meta.id] ?? {}}
                onChange={(k, v) => updateDraft(meta.id, k, v)}
                onSave={() => saveConfig(meta.id)}
              />
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfiguringId(isConfiguring ? null : meta.id)} style={outlineBtn}>
                {isConfiguring ? "Close" : "Configure"}
              </button>
              <button onClick={() => sync(meta.id)} disabled={isSyncing} style={{
                ...primaryBtn, cursor: isSyncing ? "wait" : "pointer", opacity: isSyncing ? 0.6 : 1,
              }}>
                {isSyncing ? "Syncing..." : "Sync Now"}
              </button>
            </div>
          </article>
        );
      })}
      </div>
    </div>
  );
}

const outlineBtn: React.CSSProperties = {
  flex: 1, minHeight: 44, borderRadius: 10,
  border: `1px solid ${PALETTE.divider}`, background: "transparent",
  color: PALETTE.textPrimary, fontSize: 13, fontWeight: 500, cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  flex: 1, minHeight: 44, borderRadius: 10, border: "none",
  background: PALETTE.accent, color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: "pointer",
};

interface ConfigProps {
  readonly keys: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly onChange: (k: string, v: string) => void;
  readonly onSave: () => void;
}

function ConfigFormInline({ keys, values, onChange, onSave }: ConfigProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {keys.map((k) => (
        <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: PALETTE.textSecondary, fontFamily: "ui-monospace, monospace" }}>{k}</span>
          <input
            type={isSecretKey(k) ? "password" : "text"}
            value={values[k] ?? ""}
            onChange={(e) => onChange(k, e.target.value)}
            style={{
              minHeight: 36, padding: "8px 10px", borderRadius: "var(--radius-md)",
              background: PALETTE.bg, border: `1px solid ${PALETTE.divider}`,
              color: PALETTE.textPrimary, fontSize: 12, outline: "none",
              fontFamily: "ui-monospace, monospace",
            }}
          />
        </label>
      ))}
      <button onClick={onSave} style={{
        minHeight: 36, borderRadius: "var(--radius-md)", border: "none",
        background: PALETTE.accent, color: "#FFFFFF",
        fontSize: 12, fontWeight: 600, cursor: "pointer",
      }}>Save configuration</button>
    </div>
  );
}

function Block({ label }: { readonly label: string }) {
  return <div style={{ padding: 32, color: PALETTE.textSecondary, fontSize: 13 }}>{label}</div>;
}
