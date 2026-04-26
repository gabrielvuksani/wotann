/**
 * Training / evolution card sub-components.
 * Extracted from TrainingReview to keep each file under the size limit.
 */

import { Card, StatusBadge, formatTimeAgo } from "./intelligenceUtils";
import { color } from "../../design/tokens.generated";

// ── Shared types (mirror TrainingReview) ───────────────

export interface EvolutionItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: "instinct" | "skill" | "rule" | "persona" | "other";
  readonly source?: string;
  readonly proposedAt: number;
  readonly confidence?: number;
}

export interface Pattern {
  readonly id: string;
  readonly name: string;
  readonly hits: number;
  readonly lastSeen: number;
  readonly category?: string;
}

export type TrainingState = "idle" | "queued" | "training" | "evaluating" | "error";

export interface TrainingStatus {
  readonly state: TrainingState;
  readonly runId?: string;
  readonly progress?: number;
  readonly eta?: number;
  readonly message?: string;
}

export interface SkillForgeTrigger {
  readonly id: string;
  readonly trigger: string;
  readonly occurrences: number;
  readonly readyToForge: boolean;
}

export const STATUS_COLOR: Record<TrainingState, string> = {
  idle: color("muted"),
  queued: color("warning"),
  training: color("accent"),
  // TODO(design-token): no violet/purple token exists for "evaluating" state
  evaluating: "#bf5af2",
  error: color("error"),
};

// ── Pending Evolution ─────────────────────────────────

export function PendingEvolutionCard({
  items,
  loading,
  busy,
  onDecide,
}: {
  readonly items: readonly EvolutionItem[];
  readonly loading: boolean;
  readonly busy: string | null;
  readonly onDecide: (item: EvolutionItem, action: "approve" | "reject") => void;
}) {
  return (
    <Card title={`Pending Evolution (${items.length})`}>
      {items.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", fontStyle: "italic" }}>
          {loading ? "Loading..." : "No pending items — the agent is not proposing changes."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                background: color("background"),
                borderRadius: "var(--radius-md)",
                padding: 10,
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div className="flex items-start justify-between" style={{ gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                      {item.title}
                    </span>
                    <StatusBadge text={item.kind} color={color("accent")} />
                  </div>
                  {item.description && (
                    <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0", lineHeight: 1.45 }}>
                      {item.description}
                    </p>
                  )}
                  <p style={{ fontSize: 11, color: "var(--color-text-dim)", margin: 0 }}>
                    {formatTimeAgo(item.proposedAt)}
                    {typeof item.confidence === "number" && ` · ${Math.round(item.confidence * 100)}% confidence`}
                    {item.source && ` · ${item.source}`}
                  </p>
                </div>
                <div className="flex flex-col gap-1" style={{ flexShrink: 0 }}>
                  <button
                    onClick={() => onDecide(item, "approve")}
                    disabled={busy === item.id}
                    style={{
                      fontSize: 11,
                      padding: "4px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(48,209,88,0.3)",
                      background: "rgba(48,209,88,0.15)",
                      color: color("success"),
                      cursor: busy === item.id ? "wait" : "pointer",
                      opacity: busy === item.id ? 0.6 : 1,
                      minWidth: 72,
                    }}
                    aria-label={`Approve ${item.title}`}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onDecide(item, "reject")}
                    disabled={busy === item.id}
                    style={{
                      fontSize: 11,
                      padding: "4px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(255,69,58,0.3)",
                      background: "rgba(255,69,58,0.1)",
                      color: color("error"),
                      cursor: busy === item.id ? "wait" : "pointer",
                      opacity: busy === item.id ? 0.6 : 1,
                      minWidth: 72,
                    }}
                    aria-label={`Reject ${item.title}`}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Training Status ───────────────────────────────────

export function TrainingStatusCard({ status }: { readonly status: TrainingStatus }) {
  return (
    <Card title="Training Status">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: STATUS_COLOR[status.state],
            }}
            aria-hidden="true"
          />
          <span style={{ fontSize: 13, color: "var(--color-text-primary)", fontWeight: 500, textTransform: "capitalize" }}>
            {status.state}
          </span>
          {status.runId && (
            <span style={{ fontSize: 11, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
              {status.runId.slice(0, 8)}
            </span>
          )}
        </div>
        {typeof status.progress === "number" && (
          <div>
            <div style={{ fontSize: 11, color: "var(--color-text-dim)", marginBottom: 4 }}>
              {Math.round(status.progress * 100)}%
              {typeof status.eta === "number" && ` · ${Math.max(0, Math.round(status.eta))}s remaining`}
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(1, status.progress)) * 100}%`,
                  height: "100%",
                  background: color("accent"),
                  transition: "width 400ms ease",
                }}
              />
            </div>
          </div>
        )}
        {status.message && (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>{status.message}</p>
        )}
        {status.state === "idle" && !status.message && (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)", fontStyle: "italic", margin: 0 }}>
            No training run active.
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Pattern History ───────────────────────────────────

export function PatternHistoryCard({ patterns, loading }: { readonly patterns: readonly Pattern[]; readonly loading: boolean }) {
  return (
    <Card title={`Pattern History (${patterns.length})`}>
      {patterns.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", fontStyle: "italic" }}>
          {loading ? "Loading..." : "No patterns yet."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
          {patterns.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between"
              style={{
                padding: "6px 8px",
                background: color("background"),
                borderRadius: "var(--radius-sm)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 10, color: "var(--color-text-dim)" }}>
                  {p.category ? `${p.category} · ` : ""}{formatTimeAgo(p.lastSeen)}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: color("accent"),
                  fontWeight: 600,
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                {p.hits}x
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Skill Forge ───────────────────────────────────────

export function SkillForgeCard({
  triggers,
  loading,
  busy,
  onForge,
}: {
  readonly triggers: readonly SkillForgeTrigger[];
  readonly loading: boolean;
  readonly busy: string | null;
  readonly onForge: (t: SkillForgeTrigger) => void;
}) {
  return (
    <Card title={`Skill Forge (${triggers.length})`}>
      {triggers.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", fontStyle: "italic" }}>
          {loading ? "Loading..." : "No triggers queued."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {triggers.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between"
              style={{
                padding: "8px 10px",
                background: color("background"),
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${t.readyToForge ? "rgba(10,132,255,0.3)" : "rgba(255,255,255,0.05)"}`,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)" }}>{t.trigger}</div>
                <div style={{ fontSize: 10, color: "var(--color-text-dim)" }}>
                  {t.occurrences} occurrence{t.occurrences === 1 ? "" : "s"}
                  {t.readyToForge && " · ready"}
                </div>
              </div>
              <button
                onClick={() => onForge(t)}
                disabled={busy === t.id || !t.readyToForge}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${t.readyToForge ? "rgba(10,132,255,0.3)" : "rgba(255,255,255,0.08)"}`,
                  background: t.readyToForge ? "rgba(10,132,255,0.15)" : "transparent",
                  color: t.readyToForge ? color("accent") : "var(--color-text-dim)",
                  cursor: t.readyToForge && busy !== t.id ? "pointer" : "not-allowed",
                  opacity: busy === t.id ? 0.6 : 1,
                }}
                aria-label={`Forge skill from ${t.trigger}`}
              >
                Forge
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
