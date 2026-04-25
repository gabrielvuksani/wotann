/**
 * Delivery — V9 T5.7 desktop-app surface.
 *
 * The daemon's `FileDelivery` (`src/session/file-delivery.ts`)
 * exposes four RPC methods:
 *   - `delivery.notify`     — daemon-side push (rare on desktop)
 *   - `delivery.pending`    — list outstanding records
 *   - `delivery.acknowledge`— mark a record acknowledged
 *   - `delivery.subscribe`  — long-poll subscription drain
 *
 * iOS already consumes these. The desktop audit (2026-04-25)
 * flagged that desktop has no UI to render delivery notifications
 * + acks, so notifications fired on the daemon were effectively
 * invisible to a paired desktop user. This component closes that
 * gap with a lightweight notification list:
 *
 *   - Header: count + manual refresh
 *   - List: one card per pending delivery with Acknowledge button
 *   - Empty state: "No pending deliveries" — explicit, not blank
 *   - Errors: rendered in a banner (no silent swallow)
 *
 * NEW: optional auto-poll. When `autoPollMs > 0`, the component
 * polls `delivery.pending` at the configured cadence so a user
 * who leaves the tab open sees fresh deliveries without manual
 * refresh. Default is OFF (auto-poll = 0) to match the
 * intelligence dashboard's "explicit refresh" pattern.
 *
 * RPC pattern: same `commands.sendMessage` -> JSON-RPC envelope ->
 * `{result}` shape used by other surfaces (`CreationsBrowser`,
 * `intelligenceUtils`).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { commands } from "../hooks/useTauriCommand";

// ── Types ───────────────────────────────────────────────────

/**
 * One delivery record. Mirrors the daemon's `DeliveryRecord` shape
 * minus internal fields. Extra fields are ignored — forward-compat
 * with daemon additions.
 */
export interface DeliveryRecordView {
  readonly deliveryId: string;
  readonly sessionId: string;
  readonly filename: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly state?: "pending" | "acknowledged" | "expired";
  readonly createdAt?: number;
  readonly expiresAt?: number;
  readonly acknowledgedAt?: number;
}

export interface DeliveryProps {
  /** Optional session filter. When set, only that session's deliveries appear. */
  readonly sessionId?: string;
  /** Device id used when acknowledging. Required by `delivery.acknowledge`. */
  readonly deviceId?: string;
  /** Auto-poll interval in ms. 0 disables (default). */
  readonly autoPollMs?: number;
  /** Injected RPC for tests. */
  readonly rpc?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

// ── RPC helpers ─────────────────────────────────────────────

interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
  readonly id?: number;
}

async function defaultRpc(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const response = await commands.sendMessage(
    JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  );
  if (!response) return null;
  try {
    const parsed = JSON.parse(response) as JsonRpcResponse;
    if (parsed.error) {
      throw new Error(`${method} failed: ${parsed.error.message}`);
    }
    return parsed.result ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${method} failed`)) {
      throw err;
    }
    return null;
  }
}

// ── Constants ───────────────────────────────────────────────

const DEFAULT_DEVICE_ID = "wotann-desktop";

// ── Component ───────────────────────────────────────────────

export function Delivery(props: DeliveryProps): ReactElement {
  const rpc = props.rpc ?? defaultRpc;
  const deviceId = props.deviceId ?? DEFAULT_DEVICE_ID;
  const autoPollMs = props.autoPollMs ?? 0;

  const [records, setRecords] = useState<readonly DeliveryRecordView[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAck, setPendingAck] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const fetchPending = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const params: Record<string, unknown> = {};
      if (typeof props.sessionId === "string" && props.sessionId.length > 0) {
        params["sessionId"] = props.sessionId;
      }
      const result = await rpc("delivery.pending", params);
      const list = parsePendingResult(result);
      setRecords(list);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [rpc, props.sessionId]);

  const acknowledge = useCallback(
    async (deliveryId: string): Promise<void> => {
      setPendingAck((prev) => {
        const next = new Set(prev);
        next.add(deliveryId);
        return next;
      });
      setErrorMessage(null);
      try {
        await rpc("delivery.acknowledge", {
          deliveryId,
          deviceId,
        });
        // Optimistic removal — we'll resync via fetchPending anyway.
        setRecords((prev) => prev.filter((r) => r.deliveryId !== deliveryId));
        await fetchPending();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setPendingAck((prev) => {
          const next = new Set(prev);
          next.delete(deliveryId);
          return next;
        });
      }
    },
    [rpc, deviceId, fetchPending],
  );

  // Initial + reactive load.
  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  // Optional auto-poll.
  useEffect(() => {
    if (autoPollMs <= 0) return undefined;
    const handle = window.setInterval(() => {
      void fetchPending();
    }, autoPollMs);
    return () => window.clearInterval(handle);
  }, [autoPollMs, fetchPending]);

  const sorted = useMemo(() => {
    const copy = records.slice();
    copy.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return Object.freeze(copy);
  }, [records]);

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="delivery-panel"
    >
      <header
        style={{
          padding: "var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm, 8px)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            style={{
              fontSize: "var(--font-size-lg, 16px)",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            Delivery
          </h2>
          <p
            style={{
              margin: "var(--space-2xs, 2px) 0 0 0",
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
            }}
          >
            Files the daemon has flagged for delivery to this device.
          </p>
        </div>
        <span
          style={{
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {sorted.length} pending
        </span>
        <button
          type="button"
          onClick={() => void fetchPending()}
          className="btn-press"
          style={{
            padding: "4px 10px",
            fontSize: "var(--font-size-2xs, 10px)",
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px solid var(--border-subtle)",
            background: "var(--surface-2)",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </header>

      {errorMessage !== null && (
        <div
          role="alert"
          data-testid="delivery-error"
          style={{
            margin: "var(--space-sm, 8px)",
            padding: "var(--space-sm, 8px) var(--space-md, 12px)",
            background: "var(--color-error-bg, rgba(239, 68, 68, 0.08))",
            color: "var(--color-error, #ef4444)",
            borderRadius: "var(--radius-sm, 6px)",
            fontSize: "var(--font-size-xs, 11px)",
          }}
        >
          {errorMessage}
        </div>
      )}

      {isLoading && sorted.length === 0 ? (
        <div
          style={{
            padding: "var(--space-lg, 16px)",
            color: "var(--color-text-secondary)",
            fontSize: "var(--font-size-sm, 13px)",
          }}
        >
          Loading deliveries…
        </div>
      ) : sorted.length === 0 ? (
        <div
          data-testid="delivery-empty"
          style={{
            padding: "var(--space-lg, 16px)",
            color: "var(--color-text-secondary)",
            fontSize: "var(--font-size-sm, 13px)",
            textAlign: "center",
            fontStyle: "italic",
          }}
        >
          No pending deliveries.
        </div>
      ) : (
        <ul
          data-testid="delivery-list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {sorted.map((record) => (
            <DeliveryCard
              key={record.deliveryId}
              record={record}
              isAcking={pendingAck.has(record.deliveryId)}
              onAck={() => void acknowledge(record.deliveryId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────

interface DeliveryCardProps {
  readonly record: DeliveryRecordView;
  readonly isAcking: boolean;
  readonly onAck: () => void;
}

function DeliveryCard(props: DeliveryCardProps): ReactElement {
  const r = props.record;
  const titleSource = r.displayName ?? r.filename;
  const expired = isExpired(r);
  return (
    <li
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        padding: "var(--space-md, 12px)",
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-md, 12px)",
        opacity: expired ? 0.55 : 1,
      }}
      data-testid={`delivery-card-${r.deliveryId}`}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          marginTop: 6,
          background: expired
            ? "var(--color-text-tertiary, #666)"
            : "var(--color-primary, #7b5cff)",
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {titleSource}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {r.sessionId} · {r.filename}
        </div>
        {r.description ? (
          <div
            style={{
              marginTop: 4,
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
              lineHeight: 1.4,
            }}
          >
            {r.description}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 4,
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {r.createdAt ? `Created ${formatRelative(r.createdAt)}` : ""}
          {r.expiresAt ? ` · Expires ${formatRelative(r.expiresAt)}` : ""}
          {expired ? " · expired" : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={props.onAck}
        disabled={props.isAcking || expired}
        className="btn-press"
        style={{
          padding: "6px 12px",
          fontSize: "var(--font-size-xs, 11px)",
          fontWeight: 600,
          borderRadius: "var(--radius-sm, 6px)",
          border: "1px solid var(--border-subtle)",
          background: expired ? "var(--surface-2)" : "var(--color-primary)",
          color: expired ? "var(--color-text-muted)" : "#fff",
          cursor: props.isAcking || expired ? "not-allowed" : "pointer",
          opacity: props.isAcking || expired ? 0.55 : 1,
          flexShrink: 0,
        }}
        aria-label={`Acknowledge delivery ${r.deliveryId}`}
      >
        {props.isAcking ? "…" : "Acknowledge"}
      </button>
    </li>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function isExpired(record: DeliveryRecordView): boolean {
  if (record.state === "expired") return true;
  if (
    typeof record.expiresAt === "number" &&
    Number.isFinite(record.expiresAt) &&
    record.expiresAt < Date.now()
  ) {
    return true;
  }
  return false;
}

function formatRelative(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const delta = Date.now() - timestamp;
  const abs = Math.abs(delta);
  const past = delta >= 0;
  if (abs < 60_000) {
    return past ? "just now" : "in seconds";
  }
  if (abs < 3_600_000) {
    const m = Math.round(abs / 60_000);
    return past ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < 86_400_000) {
    const h = Math.round(abs / 3_600_000);
    return past ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(abs / 86_400_000);
  return past ? `${d}d ago` : `in ${d}d`;
}

function parsePendingResult(result: unknown): readonly DeliveryRecordView[] {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  const raw = obj["pending"];
  if (!Array.isArray(raw)) return [];
  const out: DeliveryRecordView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e["deliveryId"] !== "string") continue;
    if (typeof e["sessionId"] !== "string") continue;
    if (typeof e["filename"] !== "string") continue;
    const stateRaw = e["state"];
    const state =
      stateRaw === "pending" || stateRaw === "acknowledged" || stateRaw === "expired"
        ? stateRaw
        : undefined;
    out.push({
      deliveryId: e["deliveryId"] as string,
      sessionId: e["sessionId"] as string,
      filename: e["filename"] as string,
      displayName:
        typeof e["displayName"] === "string"
          ? (e["displayName"] as string)
          : undefined,
      description:
        typeof e["description"] === "string"
          ? (e["description"] as string)
          : undefined,
      state,
      createdAt:
        typeof e["createdAt"] === "number" ? (e["createdAt"] as number) : undefined,
      expiresAt:
        typeof e["expiresAt"] === "number" ? (e["expiresAt"] as number) : undefined,
      acknowledgedAt:
        typeof e["acknowledgedAt"] === "number"
          ? (e["acknowledgedAt"] as number)
          : undefined,
    });
  }
  return Object.freeze(out);
}
