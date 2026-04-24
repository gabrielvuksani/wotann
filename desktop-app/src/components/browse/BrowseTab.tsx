/**
 * BrowseTab — 5th primary tab, view-only (V9 Tier 10 T10.3).
 *
 * ── WHAT ────────────────────────────────────────────────────────────
 * Renders the agentic-browse session produced by the T10.1
 * orchestrator (src/browser/agentic-browser.ts). This component is
 * purely presentational: every piece of state comes in via props,
 * every user action goes out via callback props. No IPC, no store,
 * no imperative side effects.
 *
 * Layout (3 columns):
 *   Left  (~30%): task input + plan step list
 *   Center (~50%): live screenshot + DOM element overlay
 *   Right (~20%): approval queue + turn history
 *
 * ── CRITICAL UX RULE: TRUST BOUNDARY AT OS LEVEL ─────────────────────
 * V9 §T10.3: the approval UI lives in WOTANN desktop (Tauri), NEVER
 * inside the browser window. A compromised browser tab (prompt
 * injection, hidden instructions, cross-origin trickery) cannot spoof
 * these dialogs because they are drawn on a different OS-level
 * surface. Every approval button carries a small "Decision made in
 * WOTANN, not the page" annotation so the user can visually confirm
 * the boundary before acting.
 *
 * This is not cosmetic. A classic agentic-browse exploit goes:
 *   1. Page renders "click YES to continue".
 *   2. LLM sees the text, routes an approval back.
 *   3. User, trusting the UI, clicks YES in the page.
 *   4. Attacker wins.
 *
 * By forcing the decision surface to be a native Tauri widget, step
 * (3) becomes impossible — the user clicks a button that the page
 * cannot see, cannot re-skin, and cannot script.
 *
 * ── WHY PROPS AND NOT A STORE ───────────────────────────────────────
 * This task ships the view component only. The caller (a future IPC
 * adapter) is responsible for binding orchestrator events to props.
 * That separation (a) makes the component trivially testable without
 * running the T10.1 pipeline, (b) lets us swap the transport
 * (Tauri command, SSE, WebSocket) without touching the view, and
 * (c) preserves QB #7 — per-session state, not module globals.
 *
 * ── QUALITY BARS ────────────────────────────────────────────────────
 *  - QB #1 immutable props: every prop is `readonly`.
 *  - QB #6 honest failures: halted / failed statuses render
 *    distinctly. The approval queue never auto-approves — even an
 *    empty queue shows the "awaiting-approval" state explicitly.
 *  - QB #7 per-session state: only local useState for the task
 *    input draft; everything else is a prop.
 *  - QB #11 sibling-site scan: this is the ONLY browse tab view.
 *  - QB #13 env guard: no `process.env` reads anywhere.
 *
 * V9 reference: docs/MASTER_PLAN_V9.md line 1449-1456.
 */

import type { CSSProperties, JSX } from "react";
import { useCallback, useMemo, useState } from "react";
import type {
  BrowsePlanStepKindView,
  BrowsePlanStepView,
  BrowseSessionStatusView,
  BrowseSessionView,
  BrowseTurnView,
  DomElementView,
  PendingApproval,
} from "./types";

// ═══ Pure helpers (exported + tested) ════════════════════════════════════

/**
 * Format a turn duration for display in the history list.
 *
 * - `endTs === null` → in-progress; returns elapsed from startTs to
 *   now() suffixed with "…".
 * - `endTs >= startTs` → formats the delta in a human unit.
 *
 * Three units (ms / s / min) so the column stays narrow while keeping
 * precision for sub-second hits and multi-minute approval waits.
 */
export function formatTurnDuration(
  startTs: number,
  endTs: number | null,
  now: () => number,
): string {
  const end = endTs === null ? now() : endTs;
  const delta = Math.max(0, end - startTs);
  const suffix = endTs === null ? "…" : "";
  if (delta < 1000) return `${delta}ms${suffix}`;
  if (delta < 60_000) return `${(delta / 1000).toFixed(1)}s${suffix}`;
  const mins = Math.floor(delta / 60_000);
  const secs = Math.floor((delta % 60_000) / 1000);
  return `${mins}m${secs}s${suffix}`;
}

/** CSS color token for a risk level. */
export function riskColor(risk: "low" | "medium" | "high"): string {
  if (risk === "low") return "var(--color-info, #6ea7ff)";
  if (risk === "medium") return "var(--amber, #f59e0b)";
  return "var(--color-error, #ef4444)";
}

/**
 * Short symbol for a plan-step kind. Emoji is fine — Tauri's webview
 * ships an emoji font on every supported platform. Each kind has a
 * distinct icon (enforced by tests).
 */
export function stepIcon(kind: BrowsePlanStepKindView): string {
  switch (kind) {
    case "navigate": return "🌐";
    case "click":    return "🖱";
    case "type":     return "⌨";
    case "read":     return "👁";
    case "extract":  return "📋";
    case "approve":  return "✋";
  }
}

/**
 * Is the session in a state where the agent is (or could imminently
 * be) taking action? Used by the top bar (Abort enable) and by the
 * task input (disable submit while running).
 */
export function isSessionActive(status: BrowseSessionStatusView): boolean {
  return status === "planning" || status === "awaiting-approval" || status === "running";
}

/** One-line summary of a plan for the plan-step column header. */
export function summarizePlan(steps: readonly BrowsePlanStepView[]): string {
  if (steps.length === 0) return "No plan yet";
  if (steps.length === 1) {
    const only = steps[0]!;
    return `1 step: ${stepIcon(only.kind)} ${only.kind}`;
  }
  if (steps.length <= 4) {
    return `${steps.length} steps: ${steps.map((s) => stepIcon(s.kind)).join("")}`;
  }
  const firstFour = steps.slice(0, 4).map((s) => stepIcon(s.kind)).join("");
  return `${steps.length} steps (first ${firstFour})`;
}

// Status → chrome (label + fg/bg). Exported for the test.
const STATUS_CHROME: Record<
  BrowseSessionStatusView,
  { readonly label: string; readonly color: string; readonly bg: string }
> = {
  planning: {
    label: "PLANNING",
    color: "var(--color-info, #6ea7ff)",
    bg: "var(--color-info-muted, rgba(110,167,255,0.12))",
  },
  "awaiting-approval": {
    label: "AWAITING APPROVAL",
    color: "var(--amber, #f59e0b)",
    bg: "var(--color-warning-muted, rgba(245,158,11,0.12))",
  },
  running: {
    label: "RUNNING",
    color: "var(--color-success, #22c55e)",
    bg: "var(--color-success-muted, rgba(34,197,94,0.12))",
  },
  halted: {
    label: "HALTED",
    color: "var(--amber, #f59e0b)",
    bg: "var(--color-warning-muted, rgba(245,158,11,0.12))",
  },
  complete: {
    label: "COMPLETE",
    color: "var(--color-text-muted, #a7a7a7)",
    bg: "var(--surface-2, rgba(255,255,255,0.04))",
  },
  failed: {
    label: "FAILED",
    color: "var(--color-error, #ef4444)",
    bg: "var(--color-error-muted, rgba(239,68,68,0.12))",
  },
};

/** Chrome for a status — exported so tests assert without rendering. */
export function statusChrome(status: BrowseSessionStatusView): {
  readonly label: string;
  readonly color: string;
  readonly bg: string;
} {
  return STATUS_CHROME[status];
}

// ═══ Styles (shared) ═════════════════════════════════════════════════════

const MONO = "var(--font-mono, ui-monospace, Menlo, monospace)";
const C_MUTED = "var(--color-text-muted, #a7a7a7)";
const C_PRIMARY = "var(--color-text-primary, #eaeaea)";
const C_ERROR = "var(--color-error, #ef4444)";
const C_SUCCESS = "var(--color-success, #22c55e)";
const BORDER_SUBTLE = "1px solid var(--border-subtle, rgba(255,255,255,0.06))";
const FS_XS = "var(--font-size-xs, 11px)";
const FS_2XS = "var(--font-size-2xs, 10px)";
const FS_SM = "var(--font-size-sm, 13px)";
const RADIUS_MD = "var(--radius-md, 8px)";
const SURFACE_1 = "var(--surface-1, rgba(0,0,0,0.25))";
const SURFACE_2 = "var(--surface-2, rgba(255,255,255,0.03))";

const COL_BASE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm, 8px)",
  overflow: "hidden",
  background: SURFACE_2,
  boxShadow: "var(--shadow-ring, 0 0 0 1px rgba(255,255,255,0.06))",
  borderRadius: "var(--radius-lg, 12px)",
  padding: "var(--space-md, 12px)",
};

const SECTION_LABEL: CSSProperties = {
  fontSize: FS_XS,
  fontWeight: 600,
  color: C_MUTED,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const TRUST_NOTE: CSSProperties = {
  fontSize: FS_2XS,
  color: C_MUTED,
  fontStyle: "italic",
  marginTop: 2,
  letterSpacing: "0.3px",
};

const BTN_BASE: CSSProperties = {
  padding: "6px 10px",
  borderRadius: RADIUS_MD,
  fontSize: FS_XS,
  fontWeight: 700,
  cursor: "pointer",
  flex: 1,
  border: "none",
};

const EMPTY_CENTER: CSSProperties = {
  padding: "8px 0",
  color: C_MUTED,
  fontSize: FS_XS,
  textAlign: "center",
  fontStyle: "italic",
};

// ═══ Subcomponents ═══════════════════════════════════════════════════════

function StatusBadge({ status }: { readonly status: BrowseSessionStatusView }): JSX.Element {
  const chrome = statusChrome(status);
  return (
    <span
      aria-label={`Session status: ${chrome.label}`}
      style={{
        padding: "2px 8px",
        borderRadius: "var(--radius-sm, 4px)",
        background: chrome.bg,
        color: chrome.color,
        fontSize: FS_2XS,
        fontWeight: 700,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
      }}
    >
      {chrome.label}
    </span>
  );
}

/**
 * DOM element overlay on top of the screenshot. `pointer-events: none`
 * so clicks pass through — the screenshot is not an interaction
 * surface. All interaction routes through the plan list + approvals.
 */
function DomOverlay({ elements }: { readonly elements: readonly DomElementView[] }): JSX.Element {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {elements.map((el) => {
        const borderColor = el.interactive
          ? "var(--color-success, #22c55e)"
          : "var(--border-subtle, rgba(255,255,255,0.08))";
        return (
          <div
            key={el.id}
            title={el.label ?? el.selector}
            style={{
              position: "absolute",
              left: el.rect.x,
              top: el.rect.y,
              width: el.rect.width,
              height: el.rect.height,
              border: `1px solid ${borderColor}`,
              borderRadius: 2,
              opacity: el.interactive ? 0.9 : 0.35,
              boxSizing: "border-box",
            }}
          />
        );
      })}
    </div>
  );
}

function TaskInput({
  onTaskSubmit,
  disabled,
}: {
  readonly onTaskSubmit: (task: string) => void;
  readonly disabled: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState("");
  const submit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    onTaskSubmit(trimmed);
    setDraft("");
  }, [draft, onTaskSubmit]);
  const canSubmit = !disabled && draft.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor="browse-task-input" style={SECTION_LABEL}>Task</label>
      <textarea
        id="browse-task-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder="Describe what the agent should do in the browser..."
        disabled={disabled}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: SURFACE_1,
          border: "1px solid var(--border-default, rgba(255,255,255,0.08))",
          borderRadius: RADIUS_MD,
          color: C_PRIMARY,
          fontSize: FS_SM,
          resize: "vertical",
          opacity: disabled ? 0.55 : 1,
        }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="btn-press"
        style={{
          padding: "8px 14px",
          borderRadius: RADIUS_MD,
          background: "var(--accent, #7c5cff)",
          color: "#fff",
          border: "none",
          fontSize: FS_SM,
          fontWeight: 600,
          cursor: canSubmit ? "pointer" : "not-allowed",
          opacity: canSubmit ? 1 : 0.5,
          alignSelf: "flex-end",
        }}
      >
        Start Browse
      </button>
    </div>
  );
}

/**
 * Approval card — every card carries an explicit "Decision made in
 * WOTANN, not the page" annotation. This is the OS-level trust
 * boundary the V9 spec calls out.
 */
function ApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  readonly approval: PendingApproval;
  readonly onApprove: (id: string) => void;
  readonly onDeny: (id: string) => void;
}): JSX.Element {
  const color = riskColor(approval.risk);
  return (
    <div
      style={{
        padding: "var(--space-sm, 8px)",
        background: SURFACE_1,
        boxShadow: "var(--shadow-ring, 0 0 0 1px rgba(255,255,255,0.06))",
        borderLeft: `3px solid ${color}`,
        borderRadius: RADIUS_MD,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            padding: "1px 6px",
            borderRadius: "var(--radius-sm, 4px)",
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            color,
            fontSize: FS_2XS,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          {approval.kind}
        </span>
        <span style={{ fontSize: FS_2XS, color, fontWeight: 600, textTransform: "uppercase" }}>
          {approval.risk} risk
        </span>
      </div>
      <p style={{ fontSize: FS_SM, color: C_PRIMARY, lineHeight: 1.35 }}>
        {approval.description}
      </p>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => onApprove(approval.id)}
          className="btn-press"
          style={{ ...BTN_BASE, background: C_SUCCESS, color: "#fff" }}
          aria-label={`Approve ${approval.kind} in WOTANN (not in the page)`}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onDeny(approval.id)}
          className="btn-press"
          style={{
            ...BTN_BASE,
            background: SURFACE_2,
            color: C_ERROR,
            border: `1px solid ${C_ERROR}`,
          }}
          aria-label={`Deny ${approval.kind} in WOTANN (not in the page)`}
        >
          Deny
        </button>
      </div>
      <p style={TRUST_NOTE}>Decision made in WOTANN, not the page.</p>
    </div>
  );
}

function PlanStepRow({
  step,
  turn,
}: {
  readonly step: BrowsePlanStepView;
  readonly turn: BrowseTurnView | undefined;
}): JSX.Element {
  const hasHalt = turn?.haltReason !== undefined;
  const color = hasHalt ? C_ERROR : turn !== undefined ? C_SUCCESS : C_MUTED;
  const truncated =
    step.target !== undefined && step.target.length > 48
      ? `${step.target.slice(0, 48)}…`
      : step.target;
  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 0",
        borderBottom: BORDER_SUBTLE,
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1.2 }}>{stepIcon(step.kind)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FS_SM, fontWeight: 600, color: C_PRIMARY }}>
          {step.kind}
          {truncated !== undefined ? (
            <span
              style={{
                fontFamily: MONO,
                color: C_MUTED,
                marginLeft: 6,
                fontSize: FS_XS,
                fontWeight: 500,
              }}
            >
              {truncated}
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: FS_XS, color: C_MUTED, marginTop: 2 }}>{step.rationale}</div>
        {hasHalt ? (
          <div style={{ fontSize: FS_2XS, color, marginTop: 2, fontFamily: MONO }}>
            {turn?.haltReason ?? ""}
          </div>
        ) : null}
      </div>
    </li>
  );
}

// ═══ Props + main component ══════════════════════════════════════════════

export interface BrowseTabProps {
  readonly session: BrowseSessionView | null;
  readonly pendingApprovals: readonly PendingApproval[];
  readonly onApprove: (id: string) => void;
  readonly onDeny: (id: string) => void;
  readonly onTaskSubmit: (task: string) => void;
  readonly onAbort: () => void;
  /** Injectable clock for deterministic rendering in tests. */
  readonly now?: () => number;
}

/**
 * O(1) lookup: step id → matching turn record. Lets the plan list
 * paint per-step status without scanning history every render.
 * Last-write-wins — a future retry will show the most recent turn.
 */
function indexHistoryByStep(
  history: readonly BrowseTurnView[],
): ReadonlyMap<string, BrowseTurnView> {
  const map = new Map<string, BrowseTurnView>();
  for (const turn of history) map.set(turn.stepId, turn);
  return map;
}

export function BrowseTab(props: BrowseTabProps): JSX.Element {
  const { session, pendingApprovals, onApprove, onDeny, onTaskSubmit, onAbort } = props;
  const active = session !== null && isSessionActive(session.status);
  const historyByStep = useMemo(
    () => indexHistoryByStep(session?.history ?? []),
    [session?.history],
  );

  const steps = session?.steps ?? [];
  const history = session?.history ?? [];

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden animate-fadeIn"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
        padding: "var(--space-xl, 24px)",
        gap: "var(--space-md, 12px)",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md, 12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              borderRadius: RADIUS_MD,
              background: SURFACE_2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            🌐
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <h1
              style={{
                fontSize: "var(--font-size-lg, 16px)",
                fontWeight: 700,
                color: C_PRIMARY,
                margin: 0,
              }}
            >
              Browse
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FS_XS, color: C_MUTED }}>
              {session !== null ? (
                <>
                  <span style={{ fontFamily: MONO }}>{session.id}</span>
                  <StatusBadge status={session.status} />
                </>
              ) : (
                <span>No active session</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onAbort}
          disabled={!active}
          className="btn-press"
          style={{
            padding: "8px 14px",
            borderRadius: RADIUS_MD,
            background: active ? C_ERROR : SURFACE_2,
            color: active ? "#fff" : C_MUTED,
            border: "none",
            fontSize: FS_SM,
            fontWeight: 600,
            cursor: active ? "pointer" : "not-allowed",
            opacity: active ? 1 : 0.55,
          }}
          aria-label="Abort current browse session"
        >
          Abort
        </button>
      </div>

      {/* Body — 3 columns */}
      <div style={{ display: "flex", flex: 1, gap: "var(--space-md, 12px)", overflow: "hidden" }}>
        {/* Left — task + plan */}
        <div style={{ ...COL_BASE, flex: "0 0 30%" }}>
          <TaskInput onTaskSubmit={onTaskSubmit} disabled={active} />

          <div style={{ ...SECTION_LABEL, marginTop: 6 }}>
            Plan — {summarizePlan(steps)}
          </div>

          <ol
            style={{
              flex: 1,
              overflowY: "auto",
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            {steps.map((step) => (
              <PlanStepRow key={step.id} step={step} turn={historyByStep.get(step.id)} />
            ))}
            {steps.length === 0 ? (
              <li style={{ ...EMPTY_CENTER, padding: "12px 0", fontSize: FS_SM }}>
                Submit a task to generate a plan.
              </li>
            ) : null}
          </ol>
        </div>

        {/* Center — screenshot + overlay */}
        <div style={{ ...COL_BASE, flex: "1 1 50%" }}>
          <div style={SECTION_LABEL}>Live Page</div>
          <div
            style={{
              position: "relative",
              flex: 1,
              overflow: "hidden",
              borderRadius: RADIUS_MD,
              background: SURFACE_1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {session?.latestScreenshot ? (
              <>
                <img
                  src={session.latestScreenshot}
                  alt="Live browser screenshot"
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
                />
                <DomOverlay elements={session.domElements} />
              </>
            ) : (
              <div style={{ color: C_MUTED, fontSize: FS_SM, fontStyle: "italic" }}>
                No screenshot yet.
              </div>
            )}
          </div>
        </div>

        {/* Right — approvals + history */}
        <div style={{ ...COL_BASE, flex: "0 0 20%" }}>
          <div style={SECTION_LABEL}>Approvals ({pendingApprovals.length})</div>
          <p style={TRUST_NOTE}>
            All approvals render in WOTANN. A compromised page cannot spoof these buttons.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxHeight: "45%",
              overflowY: "auto",
            }}
          >
            {pendingApprovals.length === 0 ? (
              <div style={EMPTY_CENTER}>No pending approvals.</div>
            ) : (
              pendingApprovals.map((a) => (
                <ApprovalCard key={a.id} approval={a} onApprove={onApprove} onDeny={onDeny} />
              ))
            )}
          </div>

          <div style={{ ...SECTION_LABEL, marginTop: 6 }}>History ({history.length})</div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {history.slice().reverse().map((turn, idx) => (
              <div
                key={`${turn.stepId}-${idx}`}
                style={{
                  fontSize: FS_2XS,
                  fontFamily: MONO,
                  color: turn.haltReason !== undefined ? C_ERROR : C_MUTED,
                  padding: "3px 0",
                  borderBottom: BORDER_SUBTLE,
                }}
                title={turn.haltReason ?? turn.url ?? turn.stepId}
              >
                <span style={{ opacity: 0.75 }}>[{turn.stepId}] </span>
                {turn.haltReason ?? turn.url ?? "ok"}
              </div>
            ))}
            {history.length === 0 ? (
              <div style={EMPTY_CENTER}>No turns yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
