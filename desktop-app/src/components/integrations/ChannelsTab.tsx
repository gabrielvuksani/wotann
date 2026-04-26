/**
 * ChannelsTab — messaging-channel adapter cards.
 * RPCs: channels.status, channels.start, channels.stop
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PALETTE, safeInvoke } from "./IntegrationsView";

interface ChannelStatus {
  readonly id: string;
  readonly name?: string;
  readonly connected: boolean;
}

interface ChannelMeta {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly configKeys: readonly string[];
}

const CATALOG: readonly ChannelMeta[] = [
  { id: "slack", name: "Slack", icon: "\uD83D\uDCAC", configKeys: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"] },
  { id: "discord", name: "Discord", icon: "\uD83C\uDFAE", configKeys: ["DISCORD_BOT_TOKEN"] },
  { id: "telegram", name: "Telegram", icon: "\u2708\uFE0F", configKeys: ["TELEGRAM_BOT_TOKEN"] },
  { id: "whatsapp", name: "WhatsApp", icon: "\uD83D\uDCF1", configKeys: ["WHATSAPP_TOKEN"] },
  { id: "signal", name: "Signal", icon: "\uD83D\uDD10", configKeys: ["SIGNAL_NUMBER"] },
  { id: "matrix", name: "Matrix", icon: "\uD83D\uDD36", configKeys: ["MATRIX_HOMESERVER", "MATRIX_TOKEN"] },
  { id: "irc", name: "IRC", icon: "\uD83D\uDCE1", configKeys: ["IRC_SERVER", "IRC_NICK"] },
  { id: "google-chat", name: "Google Chat", icon: "\uD83D\uDCAD", configKeys: ["GOOGLE_CHAT_TOKEN"] },
  { id: "imessage", name: "iMessage", icon: "\uD83D\uDCAC", configKeys: [] },
  { id: "sms", name: "SMS", icon: "\uD83D\uDCE8", configKeys: ["TWILIO_SID", "TWILIO_TOKEN"] },
  { id: "email", name: "Email", icon: "\u2709\uFE0F", configKeys: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"] },
  { id: "webchat", name: "WebChat", icon: "\uD83C\uDF10", configKeys: [] },
  { id: "github", name: "GitHub Bot", icon: "\uD83D\uDC31", configKeys: ["GITHUB_WEBHOOK_SECRET"] },
] as const;

function isSecretKey(k: string): boolean {
  const lower = k.toLowerCase();
  return lower.includes("token") || lower.includes("pass") || lower.includes("secret") || lower.includes("key");
}

interface Props { readonly onRefresh?: () => Promise<void> | void }

export function ChannelsTab({ onRefresh }: Props) {
  const [statuses, setStatuses] = useState<readonly ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const r = await safeInvoke<readonly ChannelStatus[]>("get_channels_status");
    setStatuses(r ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const statusById = useMemo(() => {
    const map = new Map<string, ChannelStatus>();
    for (const s of statuses) map.set(s.id, s);
    return map;
  }, [statuses]);

  const merged = useMemo(
    () => CATALOG.map((m) => ({ meta: m, status: statusById.get(m.id) ?? { id: m.id, name: m.name, connected: false } })),
    [statusById],
  );

  const toggle = useCallback(async (id: string, connected: boolean) => {
    setBusy((p) => ({ ...p, [id]: true }));
    await safeInvoke<unknown>(connected ? "channels.stop" : "channels.start", { id, config: draft[id] ?? {} });
    await load();
    if (onRefresh) await onRefresh();
    setBusy((p) => ({ ...p, [id]: false }));
  }, [draft, load, onRefresh]);

  const updateDraft = useCallback((id: string, key: string, value: string) => {
    setDraft((p) => ({ ...p, [id]: { ...(p[id] ?? {}), [key]: value } }));
  }, []);

  if (loading) return <Block label="Loading channels..." />;
  if (merged.length === 0) return <Block label="No channels configured. See docs." />;

  return (
    <div style={{
      height: "100%", overflowY: "auto", padding: "20px 24px",
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
      gap: 12, alignContent: "start",
    }}>
      {merged.map(({ meta, status }) => {
        const expanded = expandedId === meta.id;
        const isBusy = busy[meta.id] === true;
        return (
          <article key={meta.id} style={cardStyle}>
            <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">{meta.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={titleStyle}>{meta.name}</div>
                <StatusDot connected={status.connected} />
              </div>
              <button
                aria-label={`Configure ${meta.name}`}
                onClick={() => setExpandedId(expanded ? null : meta.id)}
                style={gearBtnStyle}
              >{"\u2699\uFE0F"}</button>
            </header>
            <button
              onClick={() => toggle(meta.id, status.connected)}
              disabled={isBusy}
              style={{
                minHeight: 44, borderRadius: 10, border: "none",
                background: status.connected ? PALETTE.surface2 : PALETTE.accent,
                color: status.connected ? PALETTE.textPrimary : "#FFFFFF",
                fontSize: 13, fontWeight: 600,
                cursor: isBusy ? "wait" : "pointer", opacity: isBusy ? 0.6 : 1,
              }}
            >
              {isBusy ? "..." : status.connected ? "Stop" : "Start"}
            </button>
            {expanded && meta.configKeys.length > 0 && (
              <ConfigForm keys={meta.configKeys} values={draft[meta.id] ?? {}} onChange={(k, v) => updateDraft(meta.id, k, v)} />
            )}
            {expanded && meta.configKeys.length === 0 && (
              <p style={{ fontSize: 12, color: PALETTE.textSecondary, margin: 0 }}>No configuration needed.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: PALETTE.surface, borderRadius: "var(--radius-lg)",
  border: `1px solid ${PALETTE.divider}`, padding: 16,
  display: "flex", flexDirection: "column", gap: 12,
};

const titleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: PALETTE.textPrimary,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};

const gearBtnStyle: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 10, background: "transparent",
  border: "none", color: PALETTE.textSecondary, cursor: "pointer", fontSize: 16,
};

function StatusDot({ connected }: { readonly connected: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "var(--radius-xs)",
        background: connected ? PALETTE.green : PALETTE.grey,
        boxShadow: connected ? `0 0 6px ${PALETTE.green}` : "none",
      }} />
      <span style={{ fontSize: 11, color: PALETTE.textSecondary }}>
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}

interface ConfigFormProps {
  readonly keys: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly onChange: (key: string, value: string) => void;
}

function ConfigForm({ keys, values, onChange }: ConfigFormProps) {
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
    </div>
  );
}

function Block({ label }: { readonly label: string }) {
  return <div style={{ padding: 32, color: PALETTE.textSecondary, fontSize: 13 }}>{label}</div>;
}
