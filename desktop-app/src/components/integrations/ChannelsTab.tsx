/**
 * ChannelsTab — messaging-channel adapter cards.
 * RPCs: channels.status, channels.start, channels.stop,
 *       channels.policy.{list,add,remove}
 *
 * Route policies live at the bottom of the tab. They map an inbound
 * (channelType, channelId, senderId) tuple to a (provider, model)
 * pair so the dispatch plane knows which runtime to wake when an
 * external message arrives. The daemon owns the storage layer; this
 * UI is a CRUD form over `channels.policy.{list,add,remove}`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { PALETTE, safeInvoke } from "./IntegrationsView";
import { commands } from "../../hooks/useTauriCommand";
import { useStore } from "../../store";

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
      display: "flex", flexDirection: "column", gap: 16,
    }}>
      <div style={{
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
      <RoutePoliciesSection />
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

// ── Route Policies ───────────────────────────────────────────

interface RoutePolicy {
  readonly id: string;
  readonly label?: string;
  readonly channelType?: string;
  readonly channelId?: string;
  readonly senderId?: string;
  readonly provider?: string;
  readonly model?: string;
}

interface PolicyDraft {
  readonly label: string;
  readonly channelType: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly provider: string;
  readonly model: string;
}

const EMPTY_POLICY_DRAFT: PolicyDraft = {
  label: "",
  channelType: "",
  channelId: "",
  senderId: "",
  provider: "",
  model: "",
};

const CHANNEL_TYPE_OPTIONS: readonly string[] = CATALOG.map((c) => c.id);

function parsePolicies(result: unknown): readonly RoutePolicy[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const raw = Array.isArray(r["policies"]) ? (r["policies"] as readonly unknown[]) : [];
  const out: RoutePolicy[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const id = typeof e["id"] === "string" ? (e["id"] as string) : null;
    if (id === null) continue;
    const optString = (key: string): string | undefined =>
      typeof e[key] === "string" ? (e[key] as string) : undefined;
    out.push({
      id,
      label: optString("label"),
      channelType: optString("channelType"),
      channelId: optString("channelId"),
      senderId: optString("senderId"),
      provider: optString("provider"),
      model: optString("model"),
    });
  }
  return Object.freeze(out);
}

function RoutePoliciesSection(): ReactElement {
  const [policies, setPolicies] = useState<readonly RoutePolicy[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState<PolicyDraft>(EMPTY_POLICY_DRAFT);
  const [saving, setSaving] = useState<boolean>(false);

  const providers = useStore((s) => s.providers);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const raw = await commands.rpcCall("channels.policy.list");
      setPolicies(parsePolicies(raw));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openForm = useCallback(() => {
    setDraft(EMPTY_POLICY_DRAFT);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setDraft(EMPTY_POLICY_DRAFT);
  }, []);

  const updateDraft = useCallback(
    (patch: Partial<PolicyDraft>): void => {
      setDraft((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  const save = useCallback(async (): Promise<void> => {
    setErrorMsg(null);
    setSaving(true);
    try {
      // Strip empty fields so the daemon stores `undefined` instead of "".
      const payload: Record<string, unknown> = {};
      const trimmed: Record<keyof PolicyDraft, string> = {
        label: draft.label.trim(),
        channelType: draft.channelType.trim(),
        channelId: draft.channelId.trim(),
        senderId: draft.senderId.trim(),
        provider: draft.provider.trim(),
        model: draft.model.trim(),
      };
      for (const [key, value] of Object.entries(trimmed)) {
        if (value.length > 0) payload[key] = value;
      }
      // At least one match field is required for a policy to be useful.
      if (
        trimmed.channelType.length === 0 &&
        trimmed.channelId.length === 0 &&
        trimmed.senderId.length === 0
      ) {
        setErrorMsg(
          "Provide at least one match field: channel type, channel ID, or sender ID.",
        );
        return;
      }
      await commands.rpcCall("channels.policy.add", payload);
      closeForm();
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, closeForm, load]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      setBusy((p) => ({ ...p, [id]: true }));
      setErrorMsg(null);
      try {
        await commands.rpcCall("channels.policy.remove", { id });
        await load();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      }
    },
    [load],
  );

  // Models for the active provider, derived for the inline form. Empty
  // when no provider is selected so we don't surface unrelated models.
  const modelOptions = useMemo<readonly string[]>(() => {
    if (draft.provider === "") return [];
    const id = draft.provider.toLowerCase();
    const match = providers.find(
      (p) => p.id.toLowerCase() === id || p.name.toLowerCase() === id,
    );
    if (!match) return [];
    return match.models.map((m) => m.id);
  }, [draft.provider, providers]);

  return (
    <section
      aria-label="Route policies"
      style={{
        background: PALETTE.surface,
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${PALETTE.divider}`,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: PALETTE.textPrimary,
              letterSpacing: "-0.01em",
            }}
          >
            Route Policies
          </h3>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: 12,
              color: PALETTE.textSecondary,
            }}
          >
            {loading
              ? "Loading…"
              : policies.length === 0
                ? "No policies yet — every inbound message uses the default runtime."
                : `${policies.length} polic${policies.length === 1 ? "y" : "ies"} routing inbound messages`}
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openForm}
            aria-label="Add a route policy"
            className="btn-press"
            style={{
              minHeight: 36,
              padding: "0 14px",
              borderRadius: "var(--radius-md, 8px)",
              border: "none",
              background: PALETTE.accent,
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Add Policy
          </button>
        )}
      </header>

      {errorMsg !== null && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            borderRadius: "var(--radius-sm, 6px)",
            background: "var(--color-error-muted)",
            color: "var(--color-error)",
            fontSize: 12,
          }}
        >
          {errorMsg}
        </div>
      )}

      {formOpen && (
        <PolicyForm
          draft={draft}
          providers={providers.map((p) => ({ id: p.id, name: p.name }))}
          modelOptions={modelOptions}
          saving={saving}
          onChange={updateDraft}
          onCancel={closeForm}
          onSave={() => void save()}
        />
      )}

      {loading ? (
        <p
          style={{
            margin: 0,
            padding: "12px 0",
            fontSize: 12,
            color: PALETTE.textSecondary,
          }}
        >
          Loading policies…
        </p>
      ) : policies.length === 0 && !formOpen ? (
        <p
          style={{
            margin: 0,
            padding: "12px 0",
            fontSize: 12,
            color: PALETTE.textSecondary,
          }}
        >
          No policies defined. Add one to route an inbound channel to a
          specific provider/model.
        </p>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {policies.map((p) => (
            <PolicyRow
              key={p.id}
              policy={p}
              busy={busy[p.id] === true}
              onRemove={() => void remove(p.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Policy Row ───────────────────────────────────────────────

function PolicyRow({
  policy,
  busy,
  onRemove,
}: {
  readonly policy: RoutePolicy;
  readonly busy: boolean;
  readonly onRemove: () => void;
}): ReactElement {
  const matchSummary = [
    policy.channelType !== undefined ? `type=${policy.channelType}` : null,
    policy.channelId !== undefined ? `channel=${policy.channelId}` : null,
    policy.senderId !== undefined ? `sender=${policy.senderId}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" · ");
  const targetSummary = [
    policy.provider !== undefined ? policy.provider : null,
    policy.model !== undefined ? policy.model : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" / ");
  return (
    <li
      style={{
        background: PALETTE.bg,
        borderRadius: "var(--radius-md, 8px)",
        border: `1px solid ${PALETTE.divider}`,
        padding: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: PALETTE.textPrimary,
          }}
        >
          {policy.label !== undefined && policy.label.length > 0
            ? policy.label
            : policy.id}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 2,
            fontSize: 11,
            color: PALETTE.textSecondary,
            flexWrap: "wrap",
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          }}
        >
          {matchSummary.length > 0 && <span>{matchSummary}</span>}
          {targetSummary.length > 0 && (
            <span>
              <span aria-hidden="true">→</span> {targetSummary}
            </span>
          )}
          {matchSummary.length === 0 && targetSummary.length === 0 && (
            <span style={{ opacity: 0.6 }}>(no match or target fields set)</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={`Remove policy ${policy.label ?? policy.id}`}
        className="btn-press"
        style={{
          minHeight: 32,
          padding: "0 10px",
          borderRadius: "var(--radius-sm, 6px)",
          border: `1px solid ${PALETTE.divider}`,
          background: "transparent",
          color: PALETTE.danger,
          fontSize: 12,
          fontWeight: 500,
          cursor: busy ? "wait" : "pointer",
          flexShrink: 0,
        }}
      >
        {busy ? "…" : "Remove"}
      </button>
    </li>
  );
}

// ── Policy Form ──────────────────────────────────────────────

function PolicyForm({
  draft,
  providers,
  modelOptions,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  readonly draft: PolicyDraft;
  readonly providers: readonly { id: string; name: string }[];
  readonly modelOptions: readonly string[];
  readonly saving: boolean;
  readonly onChange: (patch: Partial<PolicyDraft>) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}): ReactElement {
  return (
    <div
      style={{
        background: PALETTE.bg,
        borderRadius: "var(--radius-md, 8px)",
        border: `1px solid ${PALETTE.divider}`,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <PolicyField label="Label" htmlForId="policy-label">
        <input
          id="policy-label"
          type="text"
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Engineering on-call"
          aria-label="Policy label"
          style={policyInputStyle}
        />
      </PolicyField>
      <div style={{ display: "flex", gap: 8 }}>
        <PolicyField
          label="Channel type"
          htmlForId="policy-channel-type"
          style={{ flex: 1 }}
        >
          <select
            id="policy-channel-type"
            value={draft.channelType}
            onChange={(e) => onChange({ channelType: e.target.value })}
            aria-label="Channel type"
            style={policyInputStyle}
          >
            <option value="">— any —</option>
            {CHANNEL_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </PolicyField>
        <PolicyField
          label="Channel ID"
          htmlForId="policy-channel-id"
          style={{ flex: 1 }}
        >
          <input
            id="policy-channel-id"
            type="text"
            value={draft.channelId}
            onChange={(e) => onChange({ channelId: e.target.value })}
            placeholder="C0123456789"
            aria-label="Channel ID"
            style={policyInputStyle}
          />
        </PolicyField>
        <PolicyField
          label="Sender ID"
          htmlForId="policy-sender-id"
          style={{ flex: 1 }}
        >
          <input
            id="policy-sender-id"
            type="text"
            value={draft.senderId}
            onChange={(e) => onChange({ senderId: e.target.value })}
            placeholder="U0123456789"
            aria-label="Sender ID"
            style={policyInputStyle}
          />
        </PolicyField>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <PolicyField
          label="Provider"
          htmlForId="policy-provider"
          style={{ flex: 1 }}
        >
          <select
            id="policy-provider"
            value={draft.provider}
            onChange={(e) =>
              // When the provider changes, blank out the model so the
              // user picks a model that actually belongs to the new
              // provider's catalogue.
              onChange({ provider: e.target.value, model: "" })
            }
            aria-label="Provider"
            style={policyInputStyle}
          >
            <option value="">— any —</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </PolicyField>
        <PolicyField
          label="Model"
          htmlForId="policy-model"
          style={{ flex: 1 }}
        >
          {modelOptions.length > 0 ? (
            <select
              id="policy-model"
              value={draft.model}
              onChange={(e) => onChange({ model: e.target.value })}
              aria-label="Model"
              style={policyInputStyle}
            >
              <option value="">— any —</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="policy-model"
              type="text"
              value={draft.model}
              onChange={(e) => onChange({ model: e.target.value })}
              placeholder={
                draft.provider === ""
                  ? "Pick a provider first"
                  : "Model id (e.g. claude-sonnet-4-5)"
              }
              aria-label="Model"
              style={policyInputStyle}
            />
          )}
        </PolicyField>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel adding policy"
          className="btn-press"
          style={{
            minHeight: 36,
            padding: "0 14px",
            borderRadius: "var(--radius-md, 8px)",
            border: `1px solid ${PALETTE.divider}`,
            background: "transparent",
            color: PALETTE.textPrimary,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          aria-label="Save route policy"
          className="btn-press"
          style={{
            minHeight: 36,
            padding: "0 14px",
            borderRadius: "var(--radius-md, 8px)",
            border: "none",
            background: PALETTE.accent,
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? "wait" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function PolicyField({
  label,
  htmlForId,
  style,
  children,
}: {
  readonly label: string;
  readonly htmlForId?: string;
  readonly style?: React.CSSProperties;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <label
      htmlFor={htmlForId}
      style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}
    >
      <span
        style={{
          fontSize: 10,
          color: PALETTE.textSecondary,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const policyInputStyle: React.CSSProperties = {
  minHeight: 32,
  padding: "6px 8px",
  borderRadius: "var(--radius-sm, 6px)",
  background: PALETTE.surface,
  border: `1px solid ${PALETTE.divider}`,
  color: PALETTE.textPrimary,
  fontSize: 12,
  outline: "none",
  width: "100%",
};
