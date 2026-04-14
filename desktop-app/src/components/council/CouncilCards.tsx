/**
 * Presentational components for CouncilView.
 * Picker, response grid, consensus pane — all pure, no data fetching.
 */

import { MarkdownRenderer } from "../chat/MarkdownRenderer";

export interface CouncilEntry {
  readonly model: string;
  readonly provider: string;
  readonly response: string;
  readonly status: "pending" | "done" | "error";
  readonly error?: string;
  readonly durationMs?: number;
}

export interface CouncilResult {
  readonly entries: readonly CouncilEntry[];
  readonly consensus: string;
}

interface ModelOption {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
}

// ── Model picker ──────────────────────────────────────

export function ModelPicker({
  models,
  selected,
  onToggle,
  engineConnected,
}: {
  readonly models: readonly ModelOption[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly engineConnected: boolean;
}) {
  return (
    <div style={{ padding: "12px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        Select council members ({selected.size})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {models.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)", fontStyle: "italic" }}>
            {engineConnected ? "No models discovered" : "Connect engine to see models"}
          </p>
        ) : models.map((m) => {
          const active = selected.has(m.id);
          return (
            <button
              key={m.id}
              onClick={() => onToggle(m.id)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 999,
                border: `1px solid ${active ? "#0A84FF" : "rgba(255,255,255,0.08)"}`,
                background: active ? "rgba(10,132,255,0.15)" : "#1C1C1E",
                color: active ? "#0A84FF" : "var(--color-text-secondary)",
                cursor: "pointer",
              }}
              aria-pressed={active}
            >
              {m.name}
              <span style={{ marginLeft: 6, color: "var(--color-text-dim)", fontSize: 10 }}>({m.provider})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Prompt row ────────────────────────────────────────

export function PromptRow({
  task,
  setTask,
  selectedCount,
  running,
  onConvene,
}: {
  readonly task: string;
  readonly setTask: (s: string) => void;
  readonly selectedCount: number;
  readonly running: boolean;
  readonly onConvene: () => void;
}) {
  const disabled = !task.trim() || selectedCount < 2 || running;
  return (
    <div style={{ padding: "12px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex gap-2">
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="What should the council deliberate?"
          rows={2}
          style={{
            flex: 1,
            background: "#1C1C1E",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--color-text-primary)",
            outline: "none",
            resize: "vertical",
            fontFamily: "var(--font-sans)",
          }}
          aria-label="Council task"
        />
        <button
          onClick={onConvene}
          disabled={disabled}
          className="btn-press"
          style={{
            minHeight: 44,
            padding: "0 20px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            background: disabled ? "#2c2c2e" : "#0A84FF",
            color: disabled ? "var(--color-text-dim)" : "#fff",
            cursor: disabled ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
          aria-label="Convene council"
        >
          {running ? "Deliberating..." : "Convene Council"}
        </button>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-dim)", margin: "6px 0 0" }}>
        {selectedCount < 2 ? "Select at least 2 models" : `${selectedCount} model${selectedCount === 1 ? "" : "s"} ready`}
      </p>
    </div>
  );
}

// ── Response card ─────────────────────────────────────

function ResponseCard({ entry }: { readonly entry: CouncilEntry }) {
  const dotColor = entry.status === "pending" ? "#0A84FF" : entry.status === "error" ? "#ff453a" : "#30d158";
  return (
    <div
      style={{
        background: "#1C1C1E",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        minHeight: 200,
      }}
    >
      <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: dotColor,
              flexShrink: 0,
              animation: entry.status === "pending" ? "pulse 1.5s ease-in-out infinite" : undefined,
            }}
            aria-label={entry.status}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{entry.model}</span>
          {entry.provider && (
            <span style={{ fontSize: 10, color: "var(--color-text-dim)" }}>{entry.provider}</span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, padding: "12px 14px", overflow: "auto" }}>
        {entry.status === "pending" ? (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)" }}>Waiting for response...</p>
        ) : entry.status === "error" ? (
          <p style={{ fontSize: 12, color: "#ff453a" }}>{entry.error ?? "Error"}</p>
        ) : entry.response ? (
          <MarkdownRenderer content={entry.response} />
        ) : (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)", fontStyle: "italic" }}>
            No individual response emitted — see consensus below.
          </p>
        )}
      </div>
    </div>
  );
}

export function ResponsesGrid({ entries }: { readonly entries: readonly CouncilEntry[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(entries.length, 3)}, minmax(280px, 1fr))`,
        gap: 12,
      }}
    >
      {entries.map((entry) => (
        <ResponseCard key={entry.model} entry={entry} />
      ))}
    </div>
  );
}

// ── Consensus pane ────────────────────────────────────

export function ConsensusPane({ consensus }: { readonly consensus: string }) {
  return (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 24px 20px",
        background: "#0d0d0f",
        maxHeight: "42%",
        overflow: "auto",
      }}
      aria-label="Council consensus"
    >
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1l2 5 5 .5-3.5 3.5.8 5L8 12l-4.3 3 .8-5L1 6.5 6 6l2-5z" stroke="#0A84FF" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", margin: 0, letterSpacing: "-0.01em" }}>
          Consensus
        </h3>
      </div>
      <MarkdownRenderer content={consensus} />
    </div>
  );
}
