/**
 * Remote Control View — manage and view active remote sessions.
 * Shows connected iOS devices that are controlling the desktop session.
 */

import { useState, useCallback, useEffect } from "react";
import { commands, type CompanionSessionInfo } from "../../hooks/useTauriCommand";

function formatDuration(startTs: number): string {
  const diff = Date.now() - startTs;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function RemoteControlView() {
  const [sessions, setSessions] = useState<readonly CompanionSessionInfo[]>([]);
  const [viewingLogId, setViewingLogId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const nextSessions = await commands.getCompanionSessions();
      setSessions(nextSessions);
      setError(null);
    } catch (err) {
      setSessions([]);
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const handleDisconnect = useCallback(async (sessionId: string) => {
    try {
      await commands.endCompanionSession(sessionId);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end session");
    }
  }, [refreshSessions]);

  const handleViewLog = useCallback((sessionId: string) => {
    setViewingLogId((prev) => (prev === sessionId ? null : sessionId));
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ padding: "var(--space-lg)", background: "var(--color-bg-primary)" }}>
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: 600, color: "var(--color-text-primary)" }}>Remote Control</h2>
        <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-xs)" }}>
          Active sessions from companion devices
        </p>
      </div>

      {/* Active Sessions */}
      <div className="flex-1">
        {error && (
          <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-error)", marginBottom: "var(--space-sm)" }}>
            {error}
          </p>
        )}
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div
              className="flex items-center justify-center"
              style={{
                width: 64,
                height: 64,
                borderRadius: "var(--radius-pill)",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-2)",
                marginBottom: "var(--space-md)",
              }}
              aria-hidden="true"
            >
              <svg width="28" height="28" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4.5 4.5a5 5 0 0 1 7 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M2.5 2.5a8 8 0 0 1 11 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p style={{ fontWeight: 500, color: "var(--color-text-secondary)" }}>No Active Sessions</p>
            <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", marginTop: "var(--space-xs)", maxWidth: 384 }}>
              Connect from the WOTANN iOS app to start a remote session.
              You can control this desktop from your phone.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {sessions.map((session) => (
              <div
                key={session.id}
                style={{ borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)", padding: "var(--space-md)", background: "var(--surface-2)" }}
              >
                <div className="flex items-center justify-between" style={{ marginBottom: "12px" }}>
                  <div className="flex items-center" style={{ gap: "12px" }}>
                    <div className={session.status === "active" ? "animate-pulse" : ""} style={{
                      width: 12,
                      height: 12,
                      borderRadius: "var(--radius-pill)",
                      background: session.status === "active" ? "var(--color-success)" :
                        session.status === "idle" ? "var(--color-warning)" : "var(--color-text-dim)",
                    }} aria-hidden="true" />
                    <div>
                      <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>
                        {session.deviceName}
                      </p>
                      <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                        Connected for {formatDuration(session.connectedAt)}
                      </p>
                    </div>
                  </div>
                  <span
                  style={{
                    fontSize: "var(--font-size-xs)",
                    padding: "2px var(--space-sm)",
                    borderRadius: "var(--radius-pill)",
                    ...(session.status === "active" ? { background: "var(--color-success-muted)", color: "var(--color-success)" } :
                    session.status === "idle" ? { background: "var(--color-warning-muted)", color: "var(--color-warning)" } :
                    { background: "var(--surface-3)", color: "var(--color-text-secondary)" }),
                  }}>
                    {session.status}
                  </span>
                </div>

                <div className="grid grid-cols-2" style={{ gap: "12px" }}>
                  <div style={{ borderRadius: "var(--radius-md)", padding: "var(--space-sm)", background: "var(--surface-3)" }}>
                    <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Messages</p>
                    <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>
                      {session.messagesExchanged}
                    </p>
                  </div>
                  <div style={{ borderRadius: "var(--radius-md)", padding: "var(--space-sm)", background: "var(--surface-3)" }}>
                    <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Session ID</p>
                    <p style={{ fontSize: "var(--font-size-sm)", fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>
                      {session.id.slice(0, 8)}
                    </p>
                  </div>
                </div>

                <div className="flex" style={{ gap: "var(--space-sm)", marginTop: "12px" }}>
                  <button
                    onClick={() => handleViewLog(session.id)}
                    className="flex-1 btn-press transition-colors"
                    style={{
                      padding: "6px 12px",
                      fontSize: "var(--font-size-xs)",
                      fontWeight: 500,
                      borderRadius: "var(--radius-md)",
                      border: "none",
                      cursor: "pointer",
                      background: viewingLogId === session.id ? "var(--accent-glow)" : "var(--surface-3)",
                      color: viewingLogId === session.id ? "var(--color-primary)" : "var(--color-text-secondary)",
                    }}
                    aria-label={viewingLogId === session.id ? `Hide log for ${session.deviceName}` : `View log for ${session.deviceName}`}
                  >
                    {viewingLogId === session.id ? "Hide Log" : "View Log"}
                  </button>
                  <button
                    onClick={() => handleDisconnect(session.id)}
                    disabled={session.status === "disconnected"}
                    className="btn-press transition-colors"
                    style={{
                      padding: "6px 12px",
                      fontSize: "var(--font-size-xs)",
                      fontWeight: 500,
                      borderRadius: "var(--radius-md)",
                      border: "none",
                      cursor: session.status === "disconnected" ? "default" : "pointer",
                      background: session.status === "disconnected" ? "var(--surface-3)" : "var(--color-error-muted)",
                      color: session.status === "disconnected" ? "var(--color-text-dim)" : "var(--color-error)",
                    }}
                    aria-label={`Disconnect ${session.deviceName}`}
                  >
                    {session.status === "disconnected" ? "Disconnected" : "Disconnect"}
                  </button>
                </div>

                {/* Inline session log */}
                {viewingLogId === session.id && (
                  <div
                    className="overflow-y-auto"
                    style={{
                      marginTop: "12px",
                      borderRadius: "var(--radius-md)",
                      padding: "12px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-size-xs)",
                      maxHeight: 160,
                      background: "var(--color-bg-primary)",
                      color: "var(--color-text-muted)",
                    }}
                    role="log"
                    aria-label={`Session log for ${session.deviceName}`}
                  >
                    <div>[{new Date(session.connectedAt).toLocaleTimeString()}] Session started from {session.deviceName}</div>
                    <div>[{new Date(session.connectedAt).toLocaleTimeString()}] WebSocket connected (encrypted)</div>
                    {session.messagesExchanged > 0 && (
                      <div>[...] {session.messagesExchanged} messages exchanged</div>
                    )}
                    <div>[{new Date().toLocaleTimeString()}] Status: {session.status}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connection Info */}
      <div style={{ marginTop: "var(--space-lg)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", padding: "var(--space-md)", background: "var(--surface-2)" }}>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
          Remote sessions use end-to-end encrypted WebSocket connections.
          Each session gets its own git worktree for isolation.
        </p>
      </div>
    </div>
  );
}
