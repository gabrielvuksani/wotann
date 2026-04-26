/**
 * WebhookServerSection — controls for the inbound connector webhook
 * HTTP server. Surfaces the daemon's `connectors.webhook.{start,stop,stats}`
 * RPCs which were previously unreachable from the desktop UI.
 *
 * Two visible states:
 *  - Stopped (default) — the user supplies port (default 8765), host
 *    (default 127.0.0.1), and a small per-connector secrets table.
 *    Pressing "Start" calls connectors.webhook.start.
 *  - Running — host:port banner, a stats grid auto-refreshed every 5 s,
 *    and a "Stop" button that calls connectors.webhook.stop.
 *
 * The secrets UI is functional but minimal: every row collects
 * connectorId, kind (linear/jira/slack/github/stripe/discord/intercom/
 * custom), HMAC secret (masked input), and signatureHeader. The header
 * defaults to the vendor convention so common cases work without typing.
 *
 * Style: Apple-dark palette borrowed from IntegrationsView.PALETTE so
 * the section drops cleanly into ConnectorsTab.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { commands } from "../../hooks/useTauriCommand";
import { PALETTE } from "./IntegrationsView";

// ── Types ────────────────────────────────────────────────────

type WebhookKind =
  | "linear"
  | "jira"
  | "slack"
  | "github"
  | "stripe"
  | "discord"
  | "intercom"
  | "custom";

const WEBHOOK_KINDS: readonly WebhookKind[] = [
  "linear",
  "jira",
  "slack",
  "github",
  "stripe",
  "discord",
  "intercom",
  "custom",
] as const;

/**
 * Vendor-default HMAC signature header. Caller can override via the
 * row's "header" input.
 */
const KIND_DEFAULT_HEADER: Readonly<Record<WebhookKind, string>> = {
  linear: "linear-signature",
  jira: "x-atlassian-webhook-identifier",
  slack: "x-slack-signature",
  github: "x-hub-signature-256",
  stripe: "stripe-signature",
  discord: "x-signature-ed25519",
  intercom: "x-hub-signature",
  custom: "x-webhook-signature",
};

interface SecretRow {
  readonly rowId: string;
  readonly connectorId: string;
  readonly kind: WebhookKind;
  readonly secret: string;
  readonly signatureHeader: string;
}

interface WebhookStats {
  readonly received: number;
  readonly accepted: number;
  readonly rejectedBadSignature: number;
  readonly rejectedMissingConnector: number;
  readonly rejectedBadBody: number;
  readonly errors: number;
}

interface RunningState {
  readonly host: string;
  readonly port: number;
  readonly stats: WebhookStats | null;
}

const ZERO_STATS: WebhookStats = {
  received: 0,
  accepted: 0,
  rejectedBadSignature: 0,
  rejectedMissingConnector: 0,
  rejectedBadBody: 0,
  errors: 0,
};

// ── Parsing ──────────────────────────────────────────────────

function parseStats(raw: unknown): { running: boolean; stats: WebhookStats } {
  if (!raw || typeof raw !== "object") return { running: false, stats: ZERO_STATS };
  const r = raw as Record<string, unknown>;
  const running = r["running"] === true;
  const num = (key: string): number =>
    typeof r[key] === "number" ? (r[key] as number) : 0;
  return {
    running,
    stats: {
      received: num("received"),
      accepted: num("accepted"),
      rejectedBadSignature: num("rejectedBadSignature"),
      rejectedMissingConnector: num("rejectedMissingConnector"),
      rejectedBadBody: num("rejectedBadBody"),
      errors: num("errors"),
    },
  };
}

function parseStartResult(
  raw: unknown,
  fallbackHost: string,
  fallbackPort: number,
): { ok: true; host: string; port: number } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid response from daemon" };
  }
  const r = raw as Record<string, unknown>;
  if (r["ok"] !== true) {
    const err = typeof r["error"] === "string" ? (r["error"] as string) : "Unknown error";
    return { ok: false, error: err };
  }
  const host =
    typeof r["host"] === "string" ? (r["host"] as string) : fallbackHost;
  const port =
    typeof r["port"] === "number" ? (r["port"] as number) : fallbackPort;
  return { ok: true, host, port };
}

// ── Helpers ──────────────────────────────────────────────────

function makeRowId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeBlankRow(): SecretRow {
  return {
    rowId: makeRowId(),
    connectorId: "",
    kind: "slack",
    secret: "",
    signatureHeader: KIND_DEFAULT_HEADER.slack,
  };
}

function isRowComplete(row: SecretRow): boolean {
  return (
    row.connectorId.trim().length > 0 &&
    row.secret.trim().length > 0 &&
    row.signatureHeader.trim().length > 0
  );
}

// ── Component ────────────────────────────────────────────────

const STATS_REFRESH_MS = 5000;
const DEFAULT_PORT = 8765;
const DEFAULT_HOST = "127.0.0.1";

export function WebhookServerSection(): ReactElement {
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [running, setRunning] = useState<RunningState | null>(null);

  // Stopped-state form
  const [port, setPort] = useState<number>(DEFAULT_PORT);
  const [host, setHost] = useState<string>(DEFAULT_HOST);
  const [rows, setRows] = useState<readonly SecretRow[]>([makeBlankRow()]);

  // ── Stats polling ──────────────────────────────────────────
  const refreshStats = useCallback(async (): Promise<void> => {
    try {
      const raw = await commands.rpcCall("connectors.webhook.stats");
      const { running: isRunning, stats } = parseStats(raw);
      setRunning((prev) => {
        if (!isRunning) return null;
        // Preserve host/port if we already have them.
        const baseHost = prev?.host ?? DEFAULT_HOST;
        const basePort = prev?.port ?? DEFAULT_PORT;
        return { host: baseHost, port: basePort, stats };
      });
    } catch (err) {
      // Stats polling failures are non-fatal — surface via errorMsg only
      // when it's not the typical "stats not available because stopped"
      // shape, since `parseStats` already handles that.
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  // Poll while running. We use a ref so the interval id never leaks if
  // React Strict-mode double-invokes the effect.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (running === null) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      void refreshStats();
    }, STATS_REFRESH_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, refreshStats]);

  // ── Form mutators (immutable) ─────────────────────────────
  const updateRow = useCallback(
    (rowId: string, patch: Partial<Omit<SecretRow, "rowId">>): void => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.rowId !== rowId) return r;
          const next = { ...r, ...patch };
          // When the kind changes, also update the default signature
          // header — but only if the user hasn't edited it.
          if (patch.kind !== undefined && patch.signatureHeader === undefined) {
            const defaultForOldKind = KIND_DEFAULT_HEADER[r.kind];
            if (r.signatureHeader === defaultForOldKind) {
              next.signatureHeader = KIND_DEFAULT_HEADER[patch.kind];
            }
          }
          return next;
        }),
      );
    },
    [],
  );

  const addRow = useCallback((): void => {
    setRows((prev) => [...prev, makeBlankRow()]);
  }, []);

  const removeRow = useCallback((rowId: string): void => {
    setRows((prev) => {
      const filtered = prev.filter((r) => r.rowId !== rowId);
      // Always keep at least one row visible so the user has somewhere
      // to type.
      return filtered.length === 0 ? [makeBlankRow()] : filtered;
    });
  }, []);

  // ── Actions ───────────────────────────────────────────────
  const start = useCallback(async (): Promise<void> => {
    setErrorMsg(null);
    const completeRows = rows.filter(isRowComplete);
    if (completeRows.length === 0) {
      setErrorMsg("Add at least one connector secret before starting.");
      return;
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setErrorMsg("Port must be between 1 and 65535.");
      return;
    }
    setBusy(true);
    try {
      const secrets: Record<
        string,
        {
          kind: WebhookKind;
          secret: string;
          signatureHeader: string;
        }
      > = {};
      for (const r of completeRows) {
        const id = r.connectorId.trim();
        secrets[id] = {
          kind: r.kind,
          secret: r.secret,
          signatureHeader: r.signatureHeader.trim(),
        };
      }
      const raw = await commands.rpcCall("connectors.webhook.start", {
        port,
        host: host.trim() || DEFAULT_HOST,
        secrets,
      });
      const parsed = parseStartResult(raw, host.trim() || DEFAULT_HOST, port);
      if (!parsed.ok) {
        setErrorMsg(parsed.error);
        return;
      }
      setRunning({ host: parsed.host, port: parsed.port, stats: ZERO_STATS });
      // Pull a fresh stats snapshot immediately so the running grid
      // shows real numbers (not just zeros) once events arrive.
      void refreshStats();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [rows, port, host, refreshStats]);

  const stop = useCallback(async (): Promise<void> => {
    setErrorMsg(null);
    setBusy(true);
    try {
      const raw = await commands.rpcCall("connectors.webhook.stop");
      if (raw && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        if (r["ok"] === false) {
          const err =
            typeof r["error"] === "string" ? (r["error"] as string) : "Stop failed";
          setErrorMsg(err);
          return;
        }
      }
      setRunning(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────
  return (
    <section
      aria-label="Webhook Server (inbound)"
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
            Webhook Server (inbound)
          </h3>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: 12,
              color: PALETTE.textSecondary,
            }}
          >
            Lets connectors receive events (Slack signatures, GitHub push, etc.)
          </p>
        </div>
        <StatusBadge running={running !== null} loading={loading} />
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

      {running !== null ? (
        <RunningView
          state={running}
          busy={busy}
          onStop={() => void stop()}
        />
      ) : (
        <StoppedView
          host={host}
          port={port}
          rows={rows}
          busy={busy}
          loading={loading}
          onHostChange={setHost}
          onPortChange={setPort}
          onUpdateRow={updateRow}
          onAddRow={addRow}
          onRemoveRow={removeRow}
          onStart={() => void start()}
        />
      )}
    </section>
  );
}

// ── Subcomponents ────────────────────────────────────────────

function StatusBadge({
  running,
  loading,
}: {
  readonly running: boolean;
  readonly loading: boolean;
}): ReactElement {
  const label = loading ? "…" : running ? "Running" : "Stopped";
  const color = running ? PALETTE.green : PALETTE.grey;
  return (
    <span
      aria-label={`Webhook server status: ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: PALETTE.textSecondary,
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "var(--radius-xs)",
          background: color,
          boxShadow: running ? `0 0 6px ${color}` : "none",
        }}
      />
      {label}
    </span>
  );
}

function StoppedView({
  host,
  port,
  rows,
  busy,
  loading,
  onHostChange,
  onPortChange,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
  onStart,
}: {
  readonly host: string;
  readonly port: number;
  readonly rows: readonly SecretRow[];
  readonly busy: boolean;
  readonly loading: boolean;
  readonly onHostChange: (v: string) => void;
  readonly onPortChange: (v: number) => void;
  readonly onUpdateRow: (
    rowId: string,
    patch: Partial<Omit<SecretRow, "rowId">>,
  ) => void;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (rowId: string) => void;
  readonly onStart: () => void;
}): ReactElement {
  const canStart =
    !busy && !loading && rows.some(isRowComplete) && Number.isFinite(port);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Host" htmlForId="webhook-host" style={{ flex: 1 }}>
          <input
            id="webhook-host"
            type="text"
            value={host}
            onChange={(e) => onHostChange(e.target.value)}
            placeholder={DEFAULT_HOST}
            aria-label="Webhook server host"
            style={inputStyle}
          />
        </Field>
        <Field label="Port" htmlForId="webhook-port" style={{ width: 110 }}>
          <input
            id="webhook-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onPortChange(n);
            }}
            aria-label="Webhook server port"
            style={inputStyle}
          />
        </Field>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <FieldLabel>Per-connector secrets</FieldLabel>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: PALETTE.textSecondary }}>
              <th style={thStyle}>Connector ID</th>
              <th style={thStyle}>Kind</th>
              <th style={thStyle}>Secret</th>
              <th style={thStyle}>Signature header</th>
              <th style={{ ...thStyle, width: 40 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowId}>
                <td style={tdStyle}>
                  <input
                    type="text"
                    value={row.connectorId}
                    onChange={(e) =>
                      onUpdateRow(row.rowId, { connectorId: e.target.value })
                    }
                    placeholder="acme-slack"
                    aria-label="Connector ID"
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <select
                    value={row.kind}
                    onChange={(e) =>
                      onUpdateRow(row.rowId, {
                        kind: e.target.value as WebhookKind,
                      })
                    }
                    aria-label="Webhook kind"
                    style={inputStyle}
                  >
                    {WEBHOOK_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={tdStyle}>
                  <input
                    type="password"
                    value={row.secret}
                    onChange={(e) =>
                      onUpdateRow(row.rowId, { secret: e.target.value })
                    }
                    placeholder="HMAC shared secret"
                    aria-label="HMAC secret"
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    type="text"
                    value={row.signatureHeader}
                    onChange={(e) =>
                      onUpdateRow(row.rowId, {
                        signatureHeader: e.target.value,
                      })
                    }
                    aria-label="Signature header"
                    style={{
                      ...inputStyle,
                      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                    }}
                  />
                </td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    onClick={() => onRemoveRow(row.rowId)}
                    aria-label={`Remove connector secret row ${row.connectorId || "(unnamed)"}`}
                    className="btn-press"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${PALETTE.divider}`,
                      background: "transparent",
                      color: PALETTE.danger,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                    title="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={onAddRow}
          aria-label="Add connector secret row"
          className="btn-press"
          style={{
            alignSelf: "flex-start",
            minHeight: 32,
            padding: "0 12px",
            borderRadius: "var(--radius-sm, 6px)",
            border: `1px solid ${PALETTE.divider}`,
            background: "transparent",
            color: PALETTE.textPrimary,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Add row
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          aria-label="Start webhook server"
          className="btn-press"
          style={{
            minHeight: 36,
            padding: "0 16px",
            borderRadius: "var(--radius-md, 8px)",
            border: "none",
            background: canStart ? PALETTE.accent : PALETTE.surface2,
            color: canStart ? "#FFFFFF" : PALETTE.textSecondary,
            fontSize: 13,
            fontWeight: 600,
            cursor: canStart ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Starting…" : "Start"}
        </button>
      </div>
    </div>
  );
}

function RunningView({
  state,
  busy,
  onStop,
}: {
  readonly state: RunningState;
  readonly busy: boolean;
  readonly onStop: () => void;
}): ReactElement {
  const stats = state.stats ?? ZERO_STATS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          padding: "10px 12px",
          background: PALETTE.bg,
          borderRadius: "var(--radius-md, 8px)",
          border: `1px solid ${PALETTE.divider}`,
          fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          fontSize: 12,
          color: PALETTE.textPrimary,
        }}
        aria-label="Webhook server bind address"
      >
        http://{state.host}:{state.port}/webhook
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 8,
        }}
        role="group"
        aria-label="Webhook server statistics"
      >
        <StatTile label="Received" value={stats.received} />
        <StatTile label="Accepted" value={stats.accepted} tint="success" />
        <StatTile
          label="Bad signature"
          value={stats.rejectedBadSignature}
          tint={stats.rejectedBadSignature > 0 ? "warning" : undefined}
        />
        <StatTile
          label="Missing connector"
          value={stats.rejectedMissingConnector}
          tint={stats.rejectedMissingConnector > 0 ? "warning" : undefined}
        />
        <StatTile
          label="Bad body"
          value={stats.rejectedBadBody}
          tint={stats.rejectedBadBody > 0 ? "warning" : undefined}
        />
        <StatTile
          label="Errors"
          value={stats.errors}
          tint={stats.errors > 0 ? "error" : undefined}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onStop}
          disabled={busy}
          aria-label="Stop webhook server"
          className="btn-press"
          style={{
            minHeight: 36,
            padding: "0 16px",
            borderRadius: "var(--radius-md, 8px)",
            border: `1px solid ${PALETTE.divider}`,
            background: "transparent",
            color: PALETTE.danger,
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Stopping…" : "Stop"}
        </button>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tint,
}: {
  readonly label: string;
  readonly value: number;
  readonly tint?: "success" | "warning" | "error";
}): ReactElement {
  const valueColor =
    tint === "success"
      ? PALETTE.green
      : tint === "warning"
        ? "var(--color-warning, #FFD60A)"
        : tint === "error"
          ? PALETTE.danger
          : PALETTE.textPrimary;
  return (
    <div
      style={{
        padding: 10,
        background: PALETTE.bg,
        borderRadius: "var(--radius-md, 8px)",
        border: `1px solid ${PALETTE.divider}`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: PALETTE.textSecondary,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: valueColor,
          fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function Field({
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
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

function FieldLabel({
  children,
}: {
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <span
      style={{
        fontSize: 10,
        color: PALETTE.textSecondary,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  minHeight: 32,
  padding: "6px 8px",
  borderRadius: "var(--radius-sm, 6px)",
  background: PALETTE.bg,
  border: `1px solid ${PALETTE.divider}`,
  color: PALETTE.textPrimary,
  fontSize: 12,
  outline: "none",
  width: "100%",
};

const thStyle: React.CSSProperties = {
  padding: "6px 4px",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "4px",
  verticalAlign: "top",
};
