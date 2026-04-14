/**
 * MCPTab — registered MCP servers from ~/.wotann/wotann.yaml.
 * RPCs: mcp.list, mcp.toggle, mcp.add
 */

import { useCallback, useEffect, useState } from "react";
import { PALETTE, safeInvoke } from "./IntegrationsView";

interface MCPServer {
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly transport: "stdio" | "http" | string;
  readonly toolCount?: number;
  readonly enabled: boolean;
  readonly status?: string;
}

interface Draft { name: string; command: string; args: string; transport: "stdio" | "http" }

interface Props { readonly onRefresh?: () => Promise<void> | void }

export function MCPTab({ onRefresh }: Props) {
  const [servers, setServers] = useState<readonly MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ name: "", command: "", args: "", transport: "stdio" });
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const r = await safeInvoke<readonly MCPServer[]>("mcp.list");
    setServers(r ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (name: string, enabled: boolean) => {
    setBusy((p) => ({ ...p, [name]: true }));
    await safeInvoke<unknown>("mcp.toggle", { name, enabled: !enabled });
    await load();
    if (onRefresh) await onRefresh();
    setBusy((p) => ({ ...p, [name]: false }));
  }, [load, onRefresh]);

  const add = useCallback(async () => {
    if (draft.name.trim() === "" || draft.command.trim() === "") return;
    const args = draft.args.trim() === "" ? [] : draft.args.split(/\s+/).filter((a) => a.length > 0);
    await safeInvoke<unknown>("mcp.add", {
      name: draft.name.trim(), command: draft.command.trim(), args, transport: draft.transport,
    });
    setDraft({ name: "", command: "", args: "", transport: "stdio" });
    setModalOpen(false);
    await load();
    if (onRefresh) await onRefresh();
  }, [draft, load, onRefresh]);

  if (loading) return <div style={{ padding: 32, color: PALETTE.textSecondary, fontSize: 13 }}>Loading MCP servers...</div>;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: PALETTE.textSecondary, margin: 0 }}>
          {servers.length === 0
            ? "No MCP servers configured. See docs."
            : `${servers.length} server${servers.length === 1 ? "" : "s"} registered in wotann.yaml`}
        </p>
        <button onClick={() => setModalOpen(true)} style={{
          minHeight: 44, padding: "0 16px", borderRadius: 10, border: "none",
          background: PALETTE.accent, color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>+ Add MCP Server</button>
      </div>
      {servers.length === 0 ? (
        <div style={{
          padding: 40, textAlign: "center", color: PALETTE.textSecondary, fontSize: 13,
          background: PALETTE.surface, borderRadius: 12, border: `1px solid ${PALETTE.divider}`,
        }}>No MCP servers yet. Click "Add MCP Server" to register one.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {servers.map((s) => (
            <ServerRow key={s.name} server={s} busy={busy[s.name] === true} onToggle={() => toggle(s.name, s.enabled)} />
          ))}
        </div>
      )}
      {modalOpen && <AddModal draft={draft} onChange={setDraft} onCancel={() => setModalOpen(false)} onSave={add} />}
    </div>
  );
}

function ServerRow({ server, busy, onToggle }: { readonly server: MCPServer; readonly busy: boolean; readonly onToggle: () => void }) {
  const running = server.status === "running";
  return (
    <div style={{
      background: PALETTE.surface, borderRadius: 12,
      border: `1px solid ${PALETTE.divider}`, padding: 16,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span aria-label={running ? "Running" : "Stopped"} style={{
        width: 8, height: 8, borderRadius: 4, flexShrink: 0,
        background: running ? PALETTE.green : PALETTE.grey,
        boxShadow: running ? `0 0 6px ${PALETTE.green}` : "none",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: PALETTE.textPrimary }}>{server.name}</div>
        <div style={{
          fontSize: 11, color: PALETTE.textSecondary, marginTop: 2,
          fontFamily: "ui-monospace, monospace",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{server.command} {(server.args ?? []).join(" ")}</div>
        <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: PALETTE.textSecondary }}>
          <span style={{
            padding: "2px 8px", background: PALETTE.surface2, borderRadius: 6,
            fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
          }}>{server.transport}</span>
          <span>{server.toolCount ?? 0} tool{(server.toolCount ?? 0) === 1 ? "" : "s"}</span>
        </div>
      </div>
      <Toggle enabled={server.enabled} busy={busy} onToggle={onToggle} />
    </div>
  );
}

function Toggle({ enabled, busy, onToggle }: { readonly enabled: boolean; readonly busy: boolean; readonly onToggle: () => void }) {
  return (
    <button
      aria-label={enabled ? "Disable server" : "Enable server"}
      aria-pressed={enabled}
      onClick={onToggle}
      disabled={busy}
      style={{
        minHeight: 44, minWidth: 44, padding: 0, border: "none",
        background: "transparent", cursor: busy ? "wait" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
    >
      <span style={{
        display: "block", width: 51, height: 31, borderRadius: 22,
        background: enabled ? PALETTE.green : PALETTE.surface2,
        transition: "background 180ms ease", position: "relative", opacity: busy ? 0.5 : 1,
      }}>
        <span style={{
          position: "absolute", top: 2, left: enabled ? 22 : 2,
          width: 27, height: 27, borderRadius: 14, background: "#FFFFFF",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left 180ms ease",
        }} />
      </span>
    </button>
  );
}

function AddModal({ draft, onChange, onCancel, onSave }: {
  readonly draft: Draft;
  readonly onChange: (d: Draft) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  return (
    <div
      role="dialog" aria-modal="true" aria-label="Add MCP server"
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 420, maxWidth: "90vw", background: PALETTE.surface,
        borderRadius: 12, border: `1px solid ${PALETTE.divider}`, padding: 20,
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: PALETTE.textPrimary }}>Add MCP Server</h3>
        <Field label="Name" value={draft.name} onChange={(v) => onChange({ ...draft, name: v })} placeholder="my-server" />
        <Field label="Command" value={draft.command} onChange={(v) => onChange({ ...draft, command: v })} placeholder="npx @example/mcp-server" />
        <Field label="Arguments (space-separated)" value={draft.args} onChange={(v) => onChange({ ...draft, args: v })} placeholder="--flag value" />
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: PALETTE.textSecondary }}>Transport</span>
          <select
            value={draft.transport}
            onChange={(e) => onChange({ ...draft, transport: e.target.value as "stdio" | "http" })}
            style={{
              minHeight: 36, padding: "8px 10px", borderRadius: 8,
              background: PALETTE.bg, border: `1px solid ${PALETTE.divider}`,
              color: PALETTE.textPrimary, fontSize: 12,
            }}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={onCancel} style={{
            flex: 1, minHeight: 44, borderRadius: 10,
            border: `1px solid ${PALETTE.divider}`, background: "transparent",
            color: PALETTE.textPrimary, fontSize: 13, fontWeight: 500, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={onSave} style={{
            flex: 1, minHeight: 44, borderRadius: 10, border: "none",
            background: PALETTE.accent, color: "#FFFFFF",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  readonly label: string; readonly value: string;
  readonly onChange: (v: string) => void; readonly placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: PALETTE.textSecondary }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          minHeight: 36, padding: "8px 10px", borderRadius: 8,
          background: PALETTE.bg, border: `1px solid ${PALETTE.divider}`,
          color: PALETTE.textPrimary, fontSize: 12, outline: "none",
          fontFamily: "ui-monospace, monospace",
        }}
      />
    </label>
  );
}
