/**
 * ComputerSessionPanel — V9 T1.2 UI mount.
 *
 * The T1.1 vertical wired the producer (`computer.session.step` -> store
 * -> SSE `/events/computer-session`) and T1.2's transport+hook layers
 * already existed (`desktop-app/src/daemon/sse-consumer.ts`,
 * `desktop-app/src/hooks/useComputerSession.ts`). What was missing —
 * per the V9 desktop-app gap audit (2026-04-25) — was a UI surface that
 * actually subscribes via the hook so the user can SEE the live event
 * stream of their computer-use session.
 *
 * This panel is that mount. It accepts an optional `sessionId` prop.
 * When supplied, it subscribes via `useComputerSession` and renders a
 * timeline of dispatched actions, results, errors, and lifecycle
 * markers. When omitted, it renders an honest empty state — a simple
 * input lets the user wire a session id manually until WorkshopView
 * routes a live id from the daemon.
 *
 * DESIGN NOTES
 * - Per-session state: this component owns the input `sessionId`
 *   draft. Once committed via the form, it's lifted to the hook.
 *   No module-global state; mounting twice yields two independent
 *   subscriptions (matches QB #7).
 * - Honest stubs: connection failures surface as `errorMessage` from
 *   the hook. We render them in a status banner — never silently
 *   swallowed.
 * - Bounded buffer: the hook caps at 500 events. We render the most
 *   recent 200 in the timeline (newest on top) so the DOM doesn't
 *   grow unbounded.
 * - Forward-compat: unknown event kinds aren't rendered specially —
 *   they fall through to a generic row that surfaces the `kind` and
 *   timestamp. New variants added upstream won't crash the UI.
 * - Visual language: matches FleetDashboard token palette + spacing
 *   so the Workshop tab feels coherent.
 */

import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useComputerSession } from "../../hooks/useComputerSession";
import type { ComputerSessionEvent } from "../../daemon/sse-consumer";

// ── Types ───────────────────────────────────────────────────

export interface ComputerSessionPanelProps {
  /**
   * Live session id. When `null` or missing, the panel renders the
   * empty-state form letting the user enter an id manually. Updating
   * the prop tears down the previous subscription and opens a fresh
   * one for the new id (the hook handles this).
   */
  readonly sessionId?: string | null;
  /**
   * Optional daemon base URL override. Defaults to
   * `http://localhost:7531` (the standard Engine port). Forwarded to
   * `useComputerSession`.
   */
  readonly baseUrl?: string;
}

// ── Visual constants ────────────────────────────────────────

const MAX_RENDERED_EVENTS = 200;

// ── Component ───────────────────────────────────────────────

export function ComputerSessionPanel(
  props: ComputerSessionPanelProps,
): ReactElement {
  const initialId =
    typeof props.sessionId === "string" ? props.sessionId : "";
  const [draft, setDraft] = useState<string>(initialId);
  const [committedId, setCommittedId] = useState<string>(initialId);

  // Prop changes win over the user's local draft — when the parent
  // wires a real id, we pull it down. When the parent passes null,
  // we keep whatever the user typed.
  const effectiveId =
    typeof props.sessionId === "string" && props.sessionId.length > 0
      ? props.sessionId
      : committedId;

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = draft.trim();
      if (trimmed.length === 0) return;
      setCommittedId(trimmed);
    },
    [draft],
  );

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="computer-session-panel"
    >
      <header
        style={{
          padding: "var(--space-md, 12px) var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            fontSize: "var(--font-size-lg, 16px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            margin: 0,
          }}
        >
          Computer Session
        </h2>
        <p
          style={{
            margin: "var(--space-2xs, 2px) 0 0 0",
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
          }}
        >
          Live event stream for a Desktop Control session.
        </p>
      </header>

      {effectiveId.length === 0 ? (
        <EmptyState draft={draft} onDraftChange={setDraft} onSubmit={onSubmit} />
      ) : (
        <LiveStream
          sessionId={effectiveId}
          baseUrl={props.baseUrl}
          onChangeId={() => setCommittedId("")}
        />
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────

interface EmptyStateProps {
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

function EmptyState(props: EmptyStateProps): ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-md, 12px)",
        padding: "var(--space-lg, 16px)",
      }}
      data-testid="computer-session-empty"
    >
      <div
        style={{
          fontSize: "var(--font-size-sm, 13px)",
          color: "var(--color-text-secondary)",
          textAlign: "center",
          maxWidth: 360,
        }}
      >
        No active session yet. Enter a session id to subscribe to its live
        event stream, or start a Desktop Control session from the Workshop
        toolbar.
      </div>
      <form
        onSubmit={props.onSubmit}
        style={{
          display: "flex",
          gap: "var(--space-sm, 8px)",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          placeholder="session-id"
          aria-label="Session id"
          style={{
            padding: "6px 10px",
            fontSize: "var(--font-size-sm, 13px)",
            fontFamily: "var(--font-mono)",
            background: "var(--surface-1)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm, 6px)",
            minWidth: 220,
          }}
        />
        <button
          type="submit"
          disabled={props.draft.trim().length === 0}
          className="btn-press"
          style={{
            padding: "6px 12px",
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 600,
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px solid var(--border-subtle)",
            background:
              props.draft.trim().length === 0
                ? "var(--surface-2)"
                : "var(--color-primary)",
            color:
              props.draft.trim().length === 0
                ? "var(--color-text-muted)"
                : "#fff",
            cursor:
              props.draft.trim().length === 0 ? "not-allowed" : "pointer",
            opacity: props.draft.trim().length === 0 ? 0.55 : 1,
          }}
        >
          Subscribe
        </button>
      </form>
    </div>
  );
}

// ── Live stream ──────────────────────────────────────────────

interface LiveStreamProps {
  readonly sessionId: string;
  readonly baseUrl?: string;
  readonly onChangeId: () => void;
}

function LiveStream(props: LiveStreamProps): ReactElement {
  const result = useComputerSession(props.sessionId, {
    baseUrl: props.baseUrl,
  });

  // Newest-first slice for rendering. Hook delivers oldest-first so
  // we reverse here without mutating the source.
  const visible = useMemo(() => {
    const events = result.events;
    const start = Math.max(0, events.length - MAX_RENDERED_EVENTS);
    const slice = events.slice(start);
    return slice.slice().reverse();
  }, [result.events]);

  const stats = useMemo(() => {
    let dispatched = 0;
    let results = 0;
    let errors = 0;
    let heartbeats = 0;
    for (const event of result.events) {
      switch (event.kind) {
        case "action-dispatched":
          dispatched += 1;
          break;
        case "action-result":
          results += 1;
          break;
        case "action-error":
          errors += 1;
          break;
        case "heartbeat":
          heartbeats += 1;
          break;
        default:
          break;
      }
    }
    return { dispatched, results, errors, heartbeats };
  }, [result.events]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        style={{
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm, 8px)",
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "var(--radius-xs)",
            background: result.connected
              ? "var(--color-success, #34c759)"
              : "var(--color-warning, #ff9f0a)",
          }}
        />
        <span
          style={{
            fontSize: "var(--font-size-xs, 11px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {result.connected ? "Connected" : "Connecting…"}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {props.sessionId}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {stats.dispatched} dispatched · {stats.results} results · {stats.errors} errors · {stats.heartbeats} hb
        </span>
        <button
          type="button"
          onClick={result.reconnect}
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
          Reconnect
        </button>
        <button
          type="button"
          onClick={props.onChangeId}
          className="btn-press"
          style={{
            padding: "4px 10px",
            fontSize: "var(--font-size-2xs, 10px)",
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px dashed var(--border-subtle)",
            background: "transparent",
            color: "var(--color-text-muted)",
            cursor: "pointer",
          }}
        >
          Change id
        </button>
      </div>

      {result.errorMessage !== null && (
        <div
          role="alert"
          style={{
            margin: "var(--space-sm, 8px)",
            padding: "var(--space-sm, 8px) var(--space-md, 12px)",
            background: "var(--color-error-bg, rgba(239, 68, 68, 0.08))",
            color: "var(--color-error, #ef4444)",
            borderRadius: "var(--radius-sm, 6px)",
            fontSize: "var(--font-size-xs, 11px)",
          }}
        >
          {result.errorMessage}
        </div>
      )}

      {visible.length === 0 ? (
        <div
          style={{
            padding: "var(--space-lg, 16px)",
            color: "var(--color-text-secondary)",
            fontSize: "var(--font-size-sm, 13px)",
            textAlign: "center",
            fontStyle: "italic",
          }}
          data-testid="computer-session-no-events"
        >
          No events yet. Waiting for daemon to dispatch the first action.
        </div>
      ) : (
        <ul
          data-testid="computer-session-events"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {visible.map((event, idx) => (
            <EventRow key={`${event.kind}-${event.timestamp}-${idx}`} event={event} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Event row ────────────────────────────────────────────────

interface EventRowProps {
  readonly event: ComputerSessionEvent;
}

function EventRow({ event }: EventRowProps): ReactElement {
  return (
    <li
      style={{
        padding: "var(--space-xs, 6px) var(--space-md, 12px)",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-sm, 8px)",
      }}
      data-event-kind={event.kind}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "var(--radius-xs)",
          marginTop: 6,
          background: kindColor(event.kind),
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-2xs, 10px)",
          color: "var(--color-text-secondary)",
          width: 84,
          flexShrink: 0,
          paddingTop: 1,
        }}
      >
        {formatTimestamp(event.timestamp)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: "var(--font-size-xs, 11px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {labelForKind(event.kind)}
        </span>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
            wordBreak: "break-word",
          }}
        >
          {summaryForEvent(event)}
        </span>
      </span>
    </li>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function kindColor(kind: ComputerSessionEvent["kind"]): string {
  switch (kind) {
    case "session-started":
      return "var(--color-info, #6ea7ff)";
    case "action-dispatched":
      return "var(--color-primary, #7b5cff)";
    case "action-result":
      return "var(--color-success, #34c759)";
    case "action-error":
      return "var(--color-error, #ef4444)";
    case "session-ended":
      return "var(--color-text-muted, #a7a7a7)";
    case "heartbeat":
      return "var(--color-text-tertiary, #666)";
    default:
      return "var(--color-text-tertiary, #666)";
  }
}

function labelForKind(kind: ComputerSessionEvent["kind"]): string {
  switch (kind) {
    case "session-started":
      return "Session started";
    case "action-dispatched":
      return "Action dispatched";
    case "action-result":
      return "Action result";
    case "action-error":
      return "Action error";
    case "session-ended":
      return "Session ended";
    case "heartbeat":
      return "Heartbeat";
    default:
      return kind;
  }
}

function summaryForEvent(event: ComputerSessionEvent): string {
  switch (event.kind) {
    case "session-started":
      return `session=${event.sessionId}`;
    case "action-dispatched": {
      const action = compactJson(event.action);
      return `step=${event.step} ${action}`;
    }
    case "action-result": {
      const result = compactJson(event.result);
      return `step=${event.step} ${event.durationMs}ms ${result}`;
    }
    case "action-error":
      return `step=${event.step} ${event.error}`;
    case "session-ended":
      return `reason=${event.reason}`;
    case "heartbeat":
      return "alive";
    default:
      return "";
  }
}

function compactJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, 160);
  try {
    const json = JSON.stringify(value);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return String(value).slice(0, 200);
  }
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
