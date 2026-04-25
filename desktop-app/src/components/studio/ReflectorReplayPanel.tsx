/**
 * ReflectorReplayPanel — V9 T12.12 Mastra Studio sub-component.
 *
 * Per the brief: "select a trace + replay button. Full replay
 * execution is out of scope, just show the trace's verification
 * outcome."
 *
 * Layout:
 *   - Top: trace picker (dropdown of available trace ids + dates)
 *   - Middle: trace meta + verification outcome card
 *   - Bottom: Replay button (disabled with explanatory tooltip
 *     when no trace selected; click invokes parent callback)
 *
 * The actual replay engine (re-running tools deterministically)
 * lives in a future RPC slice. This component is the surface.
 */

import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";

// ── Types ───────────────────────────────────────────────────

export type VerificationOutcome = "passed" | "failed" | "skipped" | "pending";

export interface TraceSummary {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: number;
  readonly toolCount: number;
  readonly durationMs: number;
  readonly outcome: VerificationOutcome;
  readonly outcomeReason?: string;
  readonly model?: string;
}

export interface ReflectorReplayPanelProps {
  readonly traces: readonly TraceSummary[];
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string | null) => void;
  /**
   * Click handler for the Replay button. Receives the selected
   * trace summary so callers can dispatch the replay request
   * (RPC, Tauri command, etc.). Replay execution itself is the
   * caller's responsibility — this panel only surfaces intent.
   */
  readonly onReplay?: (trace: TraceSummary) => void;
  readonly busy?: boolean;
}

// ── Component ───────────────────────────────────────────────

export function ReflectorReplayPanel(
  props: ReflectorReplayPanelProps,
): ReactElement {
  const [localId, setLocalId] = useState<string | null>(
    props.selectedId ?? null,
  );

  // Reset local selection when the prop-driven id changes.
  useEffect(() => {
    if (props.selectedId !== undefined) setLocalId(props.selectedId);
  }, [props.selectedId]);

  const effectiveId = props.selectedId ?? localId;
  const selected = useMemo(
    () =>
      effectiveId === null
        ? null
        : (props.traces.find((t) => t.id === effectiveId) ?? null),
    [props.traces, effectiveId],
  );

  const onChange = (id: string | null): void => {
    setLocalId(id);
    props.onSelect?.(id);
  };

  return (
    <div
      data-testid="reflector-replay-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        padding: "var(--space-md, 12px)",
        gap: "var(--space-md, 12px)",
      }}
    >
      <div>
        <label
          htmlFor="reflector-trace-select"
          style={{
            display: "block",
            fontSize: "var(--font-size-xs, 11px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            marginBottom: 4,
          }}
        >
          Select a trace
        </label>
        <select
          id="reflector-trace-select"
          value={effectiveId ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          style={{
            width: "100%",
            padding: "6px 10px",
            fontSize: "var(--font-size-sm, 13px)",
            background: "var(--surface-1)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm, 6px)",
          }}
        >
          <option value="">— choose a trace —</option>
          {props.traces.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} · {formatDate(t.recordedAt)}
            </option>
          ))}
        </select>
      </div>

      {selected === null ? (
        <div
          data-testid="reflector-empty"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-text-secondary)",
            fontSize: "var(--font-size-sm, 13px)",
            fontStyle: "italic",
            border: "1px dashed var(--border-subtle)",
            borderRadius: "var(--radius-md, 8px)",
            padding: "var(--space-lg, 16px)",
            textAlign: "center",
          }}
        >
          Pick a trace to see its verification outcome.
        </div>
      ) : (
        <TraceCard trace={selected} />
      )}

      <button
        type="button"
        onClick={() => selected && props.onReplay?.(selected)}
        disabled={selected === null || props.busy === true}
        className="btn-press"
        data-testid="reflector-replay-button"
        style={{
          padding: "8px 16px",
          fontSize: "var(--font-size-sm, 13px)",
          fontWeight: 600,
          borderRadius: "var(--radius-sm, 6px)",
          border: "1px solid var(--border-subtle)",
          background:
            selected === null || props.busy
              ? "var(--surface-2)"
              : "var(--color-primary)",
          color:
            selected === null || props.busy
              ? "var(--color-text-muted)"
              : "#fff",
          cursor: selected === null || props.busy ? "not-allowed" : "pointer",
          opacity: selected === null || props.busy ? 0.55 : 1,
          alignSelf: "flex-end",
        }}
        title={
          selected === null
            ? "Select a trace first"
            : props.busy
              ? "Replay in progress…"
              : "Re-run this trace"
        }
      >
        {props.busy ? "Replaying…" : "Replay"}
      </button>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────

interface TraceCardProps {
  readonly trace: TraceSummary;
}

function TraceCard(props: TraceCardProps): ReactElement {
  const t = props.trace;
  const color = colorForOutcome(t.outcome);
  return (
    <div
      style={{
        flex: 1,
        padding: "var(--space-md, 12px)",
        borderRadius: "var(--radius-md, 8px)",
        background: "var(--surface-2, rgba(255,255,255,0.03))",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm, 8px)",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm, 8px)",
        }}
      >
        <span
          style={{
            padding: "2px 8px",
            borderRadius: "var(--radius-sm, 4px)",
            fontSize: "var(--font-size-2xs, 10px)",
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            color,
          }}
        >
          {t.outcome}
        </span>
        <span
          style={{
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {formatDate(t.recordedAt)}
        </span>
        {t.model ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-2xs, 10px)",
              color: "var(--color-text-secondary)",
            }}
          >
            {t.model}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: "var(--font-size-md, 14px)",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        {t.title}
      </div>
      <div
        style={{
          fontSize: "var(--font-size-xs, 11px)",
          color: "var(--color-text-secondary)",
        }}
      >
        {t.toolCount} tool {t.toolCount === 1 ? "call" : "calls"} · {t.durationMs}ms total
      </div>
      {t.outcomeReason ? (
        <div
          style={{
            marginTop: "var(--space-xs, 6px)",
            padding: "var(--space-sm, 8px)",
            background: "var(--surface-1)",
            borderRadius: "var(--radius-sm, 6px)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-primary)",
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {t.outcomeReason}
        </div>
      ) : null}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function colorForOutcome(outcome: VerificationOutcome): string {
  switch (outcome) {
    case "passed":
      return "var(--color-success, #34c759)";
    case "failed":
      return "var(--color-error, #ef4444)";
    case "pending":
      return "var(--color-warning, #ff9f0a)";
    case "skipped":
      return "var(--color-text-muted, #a7a7a7)";
    default:
      return "var(--color-text-tertiary, #666)";
  }
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const d = new Date(timestamp);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
