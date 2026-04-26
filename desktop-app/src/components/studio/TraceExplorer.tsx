/**
 * TraceExplorer — V9 T12.12 Mastra Studio sub-component.
 *
 * Renders a virtual list of trace events. Each event card shows:
 *   - timestamp (HH:MM:SS.mmm relative or absolute)
 *   - tool name
 *   - JSON-encoded arguments (truncated for long payloads)
 *   - duration (ms)
 *   - status (ok | error | pending)
 *
 * The Mastra trace backend is OUT OF SCOPE for this slice — this
 * component accepts events via props and emits selection callbacks
 * via props. A future RPC layer (`mastra.trace.list` /
 * `mastra.trace.events`) wires the data.
 *
 * Per the brief: keep the trace explorer minimal. We use
 * @tanstack/react-virtual for windowed rendering since traces
 * routinely exceed 1000 events.
 *
 * DESIGN NOTES
 * - Pure presentation. No RPC. No store. The parent decides where
 *   events come from.
 * - Honest empty state: "No trace events" — explicit.
 * - Honest stub for arg JSON: stringify failures fall back to
 *   String(value) rather than crashing the row.
 */

import {
  useMemo,
  useRef,
  type ReactElement,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// ── Types ───────────────────────────────────────────────────

export type TraceEventStatus = "ok" | "error" | "pending";

export interface TraceEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly toolName: string;
  readonly args?: unknown;
  readonly durationMs?: number;
  readonly status: TraceEventStatus;
  readonly errorMessage?: string;
}

export interface TraceExplorerProps {
  readonly events: readonly TraceEvent[];
  readonly selectedId?: string | null;
  readonly onSelect?: (event: TraceEvent) => void;
  /** Render rows in newest-first order. Default true. */
  readonly newestFirst?: boolean;
  /** Filter substring on tool name. Empty string = no filter. */
  readonly toolFilter?: string;
}

// ── Component ───────────────────────────────────────────────

export function TraceExplorer(props: TraceExplorerProps): ReactElement {
  const newestFirst = props.newestFirst ?? true;
  const filter = props.toolFilter?.toLowerCase() ?? "";

  const ordered = useMemo(() => {
    let list = props.events.slice();
    if (filter.length > 0) {
      list = list.filter((e) => e.toolName.toLowerCase().includes(filter));
    }
    list.sort((a, b) =>
      newestFirst ? b.timestamp - a.timestamp : a.timestamp - b.timestamp,
    );
    return list;
  }, [props.events, filter, newestFirst]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  return (
    <div
      data-testid="trace-explorer"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: "var(--font-size-2xs, 10px)",
          color: "var(--color-text-secondary)",
          flexShrink: 0,
        }}
      >
        {ordered.length} {ordered.length === 1 ? "event" : "events"}
        {filter.length > 0 ? ` · filter: "${filter}"` : ""}
      </div>

      {ordered.length === 0 ? (
        <div
          data-testid="trace-empty"
          style={{
            padding: "var(--space-lg, 16px)",
            color: "var(--color-text-secondary)",
            fontSize: "var(--font-size-sm, 13px)",
            textAlign: "center",
            fontStyle: "italic",
          }}
        >
          No trace events. Start an agent run to populate the timeline.
        </div>
      ) : (
        <div
          ref={parentRef}
          data-testid="trace-virtual"
          style={{
            flex: 1,
            overflow: "auto",
            position: "relative",
            minHeight: 0,
          }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const event = ordered[virtualRow.index]!;
              return (
                <div
                  key={event.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TraceEventRow
                    event={event}
                    selected={props.selectedId === event.id}
                    onSelect={props.onSelect}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────

interface TraceEventRowProps {
  readonly event: TraceEvent;
  readonly selected: boolean;
  readonly onSelect?: (event: TraceEvent) => void;
}

function TraceEventRow(props: TraceEventRowProps): ReactElement {
  const { event } = props;
  const statusColor = colorForStatus(event.status);
  const argsText = compactJson(event.args);
  return (
    <button
      type="button"
      onClick={() => props.onSelect?.(event)}
      data-testid={`trace-row-${event.id}`}
      style={{
        width: "100%",
        background: props.selected
          ? "var(--surface-2, rgba(255,255,255,0.03))"
          : "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "var(--space-sm, 8px) var(--space-md, 12px)",
        textAlign: "left",
        cursor: props.onSelect ? "pointer" : "default",
        color: "var(--color-text-primary)",
        font: "inherit",
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-sm, 8px)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "var(--radius-xs)",
          marginTop: 6,
          background: statusColor,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "var(--space-sm, 8px)",
          }}
        >
          <span
            style={{
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {event.toolName}
          </span>
          <span
            style={{
              fontSize: "var(--font-size-2xs, 10px)",
              color: "var(--color-text-secondary)",
              flexShrink: 0,
            }}
          >
            {formatTimestamp(event.timestamp)}
            {typeof event.durationMs === "number"
              ? ` · ${event.durationMs}ms`
              : ""}
          </span>
        </div>
        {argsText.length > 0 ? (
          <div
            style={{
              marginTop: 2,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-2xs, 10px)",
              color: "var(--color-text-secondary)",
              wordBreak: "break-word",
            }}
          >
            {argsText}
          </div>
        ) : null}
        {event.status === "error" && event.errorMessage ? (
          <div
            style={{
              marginTop: 2,
              fontSize: "var(--font-size-2xs, 10px)",
              color: "var(--color-error, #ef4444)",
            }}
          >
            {event.errorMessage}
          </div>
        ) : null}
      </div>
    </button>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function colorForStatus(status: TraceEventStatus): string {
  switch (status) {
    case "ok":
      return "var(--color-success, #34c759)";
    case "error":
      return "var(--color-error, #ef4444)";
    case "pending":
      return "var(--color-warning, #ff9f0a)";
    default:
      return "var(--color-text-tertiary, #666)";
  }
}

function compactJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, 200);
  try {
    const json = JSON.stringify(value);
    return json.length > 220 ? `${json.slice(0, 220)}…` : json;
  } catch {
    return String(value).slice(0, 220);
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
