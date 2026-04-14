/**
 * VerificationTimeline — Verification tab.
 *
 * Chronological list of verification events (typecheck, tests, lint,
 * visual-match, llm-judge, build). Each row shows a status icon,
 * duration, and a compact evidence preview. Calls RPC
 * `verification.history` with limit 50.
 */

import { useEffect, useState } from "react";
import { TRUST_COLORS as C, TRUST_FONT as F, trustRpc } from "./TrustView";

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

type EventStatus = "pass" | "fail" | "warn";
type EventKind =
  | "typecheck" | "tests" | "lint" | "visual-match" | "llm-judge" | "build" | "other";

interface RawEvent {
  readonly id?: string;
  readonly kind?: string;
  readonly status?: string;
  readonly startedAt?: number;
  readonly durationMs?: number;
  readonly evidence?: string;
  readonly summary?: string;
}

interface TimelineEvent {
  readonly id: string;
  readonly kind: EventKind;
  readonly status: EventStatus;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly evidence: string;
}

interface HistoryResponse {
  readonly events?: readonly RawEvent[];
}

const KNOWN_KINDS: readonly EventKind[] = [
  "typecheck", "tests", "lint", "visual-match", "llm-judge", "build",
];

function normalize(raw: RawEvent, idx: number): TimelineEvent {
  const rk = typeof raw.kind === "string" ? raw.kind.toLowerCase() : "";
  const kind: EventKind = (KNOWN_KINDS as readonly string[]).includes(rk)
    ? (rk as EventKind)
    : "other";
  const rs = typeof raw.status === "string" ? raw.status.toLowerCase() : "";
  const status: EventStatus =
    rs === "pass" || rs === "ok" || rs === "success" ? "pass" :
    rs === "fail" || rs === "error" ? "fail" : "warn";
  return {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `event-${idx}`,
    kind,
    status,
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : 0,
    evidence:
      typeof raw.evidence === "string" ? raw.evidence :
      typeof raw.summary === "string" ? raw.summary : "",
  };
}

export function VerificationTimeline() {
  const [events, setEvents] = useState<readonly TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = (await trustRpc("verification.history", { limit: 50 })) as
        | HistoryResponse
        | readonly RawEvent[]
        | null;
      if (cancelled) return;
      const raw: readonly RawEvent[] = Array.isArray(result)
        ? result
        : result && "events" in result && Array.isArray(result.events)
          ? result.events
          : [];
      const sorted = raw
        .map((r: RawEvent, i: number) => normalize(r, i))
        .sort((a: VerificationEvent, b: VerificationEvent) => b.startedAt - a.startedAt);
      setEvents(sorted);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Empty label="Loading verification history..." />;
  if (events.length === 0)
    return <Empty label="No verification events recorded yet. They appear here after the first agent run." />;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "12px 16px", fontFamily: F }}>
      <ol role="list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((ev) => (
          <Row key={ev.id} event={ev} />
        ))}
      </ol>
    </div>
  );
}

// ── Row + icon ───────────────────────────────────────────

function Row({ event }: { readonly event: TimelineEvent }) {
  const color = event.status === "pass" ? C.success : event.status === "fail" ? C.error : C.warning;
  return (
    <li
      role="listitem"
      style={{
        minHeight: 36,
        padding: 12,
        background: C.surface,
        border: `1px solid ${C.divider}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 12,
        display: "grid",
        gridTemplateColumns: "32px 1fr auto",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Icon status={event.status} color={color} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
          <span>{kindLabel(event.kind)}</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.4px", textTransform: "uppercase", color }}>
            {event.status}
          </span>
        </div>
        {event.evidence && (
          <div
            style={{
              fontSize: 11,
              color: C.textDim,
              marginTop: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: MONO,
            }}
            title={event.evidence}
          >
            {event.evidence}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", fontSize: 11, color: C.textDim, lineHeight: 1.35 }}>
        <div>{formatRelative(event.startedAt)}</div>
        <div style={{ color: C.textGhost, fontSize: 10 }}>{formatDuration(event.durationMs)}</div>
      </div>
    </li>
  );
}

const ICON_PATHS: Record<EventStatus, string> = {
  pass: "M3 7.5l3 3 5-6",
  fail: "M4 4l6 6M10 4l-6 6",
  warn: "M7 3v5M7 10v0.5",
};

function Icon({ status, color }: { readonly status: EventStatus; readonly color: string }) {
  return (
    <div
      aria-label={`${status} icon`}
      style={{
        width: 32,
        height: 32,
        minWidth: 32,
        borderRadius: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `${color}18`,
        color,
        border: `1px solid ${color}40`,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d={ICON_PATHS[status]}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin={status === "pass" ? "round" : undefined}
        />
      </svg>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────

function kindLabel(kind: EventKind): string {
  switch (kind) {
    case "typecheck": return "Typecheck";
    case "tests": return "Tests";
    case "lint": return "Lint";
    case "visual-match": return "Visual match";
    case "llm-judge": return "LLM judge";
    case "build": return "Build";
    default: return "Check";
  }
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return new Date(ts).toLocaleString();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms < 0) return "--";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

function Empty({ label }: { readonly label: string }) {
  return (
    <div role="status" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 32, fontFamily: F, fontSize: 12, color: C.textDim, textAlign: "center" }}>
      {label}
    </div>
  );
}
