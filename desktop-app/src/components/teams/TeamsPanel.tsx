/**
 * Teams Panel — multi-agent team coordination (ClawTeam port).
 *
 * Three sections:
 *   1. Templates list — built-in + project + user TOML templates with
 *      a "preview" button that shows the rendered task strings.
 *   2. Inbox board — pending / consumed / done counts per agent in a
 *      named team; refresh to poll progress.
 *   3. Send / receive — quick CLI-style send + drain UI for testing.
 */

import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { commands, type TeamTemplateSummary, type TeamTemplateRendered, type InboxMessage, type TeamBoardEntry } from "../../hooks/useTauriCommand";

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 16,
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "var(--surface-1)",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: 13,
  padding: "6px 10px",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  background: "var(--surface-0)",
  color: "var(--text-primary)",
  width: "100%",
};

const buttonStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid var(--border-default)",
  background: "var(--accent-muted)",
  color: "var(--text-primary)",
  cursor: "pointer",
};

function TemplateCard({
  tpl,
  onPreview,
}: {
  readonly tpl: TeamTemplateSummary;
  readonly onPreview: (name: string) => void;
}): React.JSX.Element {
  const tagColor =
    tpl.source === "project"
      ? "var(--color-success)"
      : tpl.source === "user"
        ? "var(--color-primary)"
        : "var(--text-secondary)";
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 14 }}>{tpl.name}</strong>
        <span style={{ fontSize: 11, color: tagColor }}>{tpl.source}</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>{tpl.description}</p>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        leader: <code>{tpl.leader.name}</code> ({tpl.leader.type})
        {tpl.agents.length > 0 && (
          <>
            <br />
            agents: {tpl.agents.map((a) => <code key={a.name} style={{ marginRight: 6 }}>{a.name}</code>)}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => onPreview(tpl.name)}
        style={{ ...buttonStyle, alignSelf: "flex-start" }}
      >
        Preview rendered template
      </button>
    </div>
  );
}

function PreviewModal({
  preview,
  onClose,
}: {
  readonly preview: TeamTemplateRendered;
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-1)",
          borderRadius: 8,
          padding: 24,
          maxWidth: 720,
          maxHeight: "80vh",
          overflow: "auto",
          width: "100%",
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 18 }}>Template: {preview.name}</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>{preview.description}</p>
        <h4 style={{ fontSize: 14, marginBottom: 4 }}>Leader: {preview.leader.name} ({preview.leader.type})</h4>
        <pre style={{ background: "var(--surface-0)", padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: "pre-wrap" }}>
          {preview.leader.task}
        </pre>
        {preview.agents.map((a) => (
          <div key={a.name}>
            <h4 style={{ fontSize: 14, marginBottom: 4 }}>Agent: {a.name} ({a.type})</h4>
            <pre style={{ background: "var(--surface-0)", padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: "pre-wrap" }}>
              {a.task}
            </pre>
          </div>
        ))}
        <button type="button" onClick={onClose} style={{ ...buttonStyle, marginTop: 12 }}>Close</button>
      </div>
    </div>
  );
}

export function TeamsPanel(): React.JSX.Element {
  const [templates, setTemplates] = useState<readonly TeamTemplateSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TeamTemplateRendered | null>(null);
  const [previewGoal, setPreviewGoal] = useState("ship the new feature safely");

  const [team, setTeam] = useState("alpha");
  const [agent, setAgent] = useState("builder");
  const [body, setBody] = useState("hello team");
  const [received, setReceived] = useState<readonly InboxMessage[]>([]);
  const [board, setBoard] = useState<readonly TeamBoardEntry[]>([]);
  const [opError, setOpError] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    try {
      const t = await commands.teamsListTemplates();
      setTemplates(t);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  const onPreview = useCallback(
    async (name: string) => {
      try {
        const r = await commands.teamsShowTemplate(name, previewGoal);
        setPreview(r);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [previewGoal],
  );

  const onSend = useCallback(async () => {
    setOpError(null);
    try {
      await commands.teamsSend(team, agent, body, "desktop");
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  }, [team, agent, body]);

  const onReceive = useCallback(async () => {
    setOpError(null);
    try {
      const r = await commands.teamsReceive(team, agent);
      setReceived(r);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  }, [team, agent]);

  const onBoardRefresh = useCallback(async () => {
    setOpError(null);
    try {
      const b = await commands.teamsBoard(team);
      setBoard(b);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  }, [team]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 16, gap: 16, overflow: "auto" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Teams</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", maxWidth: 720 }}>
          Multi-agent team templates and inbox transport. Templates spawn coordinated agent teams; the inbox lets agents (or you) hand off work between them.
        </p>
      </header>

      {loadError && (
        <div style={{ ...cardStyle, background: "var(--color-warning-muted)", color: "var(--color-warning)" }}>
          Could not reach daemon: {loadError}
        </div>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Available templates</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Preview goal:</label>
          <input
            value={previewGoal}
            onChange={(e) => setPreviewGoal(e.target.value)}
            style={{ ...inputStyle, maxWidth: 380 }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
          {templates.map((t) => (
            <TemplateCard key={t.name} tpl={t} onPreview={onPreview} />
          ))}
        </div>
      </section>

      <section style={{ ...cardStyle, gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Inbox</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Team</label>
            <input value={team} onChange={(e) => setTeam(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Agent</label>
            <input value={agent} onChange={(e) => setAgent(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Message body</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onSend} style={buttonStyle}>Send</button>
          <button type="button" onClick={onReceive} style={buttonStyle}>Receive (drain)</button>
          <button type="button" onClick={onBoardRefresh} style={buttonStyle}>Refresh board</button>
        </div>
        {opError && (
          <pre style={{ background: "var(--color-warning-muted)", color: "var(--color-warning)", padding: 8, borderRadius: 6, fontSize: 12 }}>
            {opError}
          </pre>
        )}
        {received.length > 0 && (
          <div>
            <h4 style={{ fontSize: 13, margin: "8px 0 4px" }}>Received messages</h4>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
              {received.map((m) => (
                <li key={m.id}>
                  <code>{m.from}</code> → <code>{m.to}</code>: {m.body}
                </li>
              ))}
            </ul>
          </div>
        )}
        {board.length > 0 && (
          <table style={{ fontSize: 12, marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                <th style={{ padding: "4px 8px" }}>agent</th>
                <th style={{ padding: "4px 8px" }}>pending</th>
                <th style={{ padding: "4px 8px" }}>consumed</th>
                <th style={{ padding: "4px 8px" }}>done</th>
              </tr>
            </thead>
            <tbody>
              {board.map((b) => (
                <tr key={b.agent}>
                  <td style={{ padding: "4px 8px" }}><code>{b.agent}</code></td>
                  <td style={{ padding: "4px 8px" }}>{b.pending}</td>
                  <td style={{ padding: "4px 8px" }}>{b.consumed}</td>
                  <td style={{ padding: "4px 8px" }}>{b.done}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
