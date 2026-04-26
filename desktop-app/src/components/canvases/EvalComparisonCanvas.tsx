/**
 * EvalComparisonCanvas — 2-3 side-by-side model columns with per-task
 * pass/fail rows and an expandable trajectory panel.
 *
 * Targets the TerminalBench / SWE-bench / internal-eval pipelines where
 * WOTANN-Free is benchmarked against WOTANN-Sonnet and a competitor.
 *
 * Payload shape (runtime-validated):
 *   {
 *     title?: string
 *     models: Array<{ id: string, label: string, accent?: string }>  // 2..3
 *     tasks: Array<{
 *       id: string
 *       name: string
 *       results: Record<modelId, {
 *         passed: boolean
 *         latencyMs?: number
 *         tokens?: number
 *         costUsd?: number
 *         trajectory?: string   // raw log the user can expand
 *       }>
 *     }>
 *   }
 *
 * Events: none. Read-only today. Future: click a cell to emit
 *   `canvas:eval:rerun` with { taskId, modelId }.
 */

import { useMemo, useState } from "react";
import type { CanvasProps } from "../../lib/canvas-registry";
import { InvalidPayload, isPlainObject, EmptyPayload } from "./CanvasFallback";

// ────────────────────────────────────────────────────────────
// Types + validation
// ────────────────────────────────────────────────────────────

interface ModelColumn {
  readonly id: string;
  readonly label: string;
  readonly accent?: string;
}

interface TaskResult {
  readonly passed: boolean;
  readonly latencyMs?: number;
  readonly tokens?: number;
  readonly costUsd?: number;
  readonly trajectory?: string;
}

interface TaskRow {
  readonly id: string;
  readonly name: string;
  readonly results: Readonly<Record<string, TaskResult>>;
}

interface EvalPayload {
  readonly title?: string;
  readonly models: readonly ModelColumn[];
  readonly tasks: readonly TaskRow[];
}

function validateResult(value: unknown): TaskResult | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.passed !== "boolean") return null;
  return {
    passed: value.passed,
    latencyMs:
      typeof value.latencyMs === "number" ? value.latencyMs : undefined,
    tokens: typeof value.tokens === "number" ? value.tokens : undefined,
    costUsd: typeof value.costUsd === "number" ? value.costUsd : undefined,
    trajectory:
      typeof value.trajectory === "string" ? value.trajectory : undefined,
  };
}

function validate(data: unknown): EvalPayload | { readonly error: string } {
  if (!isPlainObject(data)) return { error: "Payload must be an object." };
  if (!Array.isArray(data.models)) return { error: "`models` must be an array." };
  if (!Array.isArray(data.tasks)) return { error: "`tasks` must be an array." };

  const models: ModelColumn[] = [];
  for (const m of data.models) {
    if (!isPlainObject(m)) continue;
    if (typeof m.id !== "string" || typeof m.label !== "string") continue;
    models.push({
      id: m.id,
      label: m.label,
      accent: typeof m.accent === "string" ? m.accent : undefined,
    });
  }
  if (models.length < 1) {
    return { error: "`models` must contain at least one valid entry." };
  }
  if (models.length > 3) {
    return {
      error: `Eval canvas supports 1..3 models; received ${models.length}.`,
    };
  }

  const tasks: TaskRow[] = [];
  for (const t of data.tasks) {
    if (!isPlainObject(t)) continue;
    if (typeof t.id !== "string" || typeof t.name !== "string") continue;
    const rawResults = isPlainObject(t.results) ? t.results : {};
    const results: Record<string, TaskResult> = {};
    for (const [modelId, raw] of Object.entries(rawResults)) {
      const normalized = validateResult(raw);
      if (normalized) results[modelId] = normalized;
    }
    tasks.push({ id: t.id, name: t.name, results });
  }

  return {
    title: typeof data.title === "string" ? data.title : undefined,
    models,
    tasks,
  };
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function EvalComparisonCanvas({ data }: CanvasProps) {
  const parsed = useMemo(() => validate(data), [data]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if ("error" in parsed) {
    return (
      <InvalidPayload
        canvasLabel="Eval Comparison"
        reason={parsed.error}
        data={data}
      />
    );
  }

  if (parsed.tasks.length === 0) {
    return (
      <EmptyPayload
        canvasLabel="Eval Comparison"
        hint="No tasks in this benchmark run."
      />
    );
  }

  const summaries = useMemo(() => {
    const out: Record<
      string,
      { passed: number; total: number; latencyMs: number; costUsd: number }
    > = {};
    for (const model of parsed.models) {
      let passed = 0;
      let total = 0;
      let latency = 0;
      let cost = 0;
      for (const task of parsed.tasks) {
        const r = task.results[model.id];
        if (!r) continue;
        total += 1;
        if (r.passed) passed += 1;
        if (typeof r.latencyMs === "number") latency += r.latencyMs;
        if (typeof r.costUsd === "number") cost += r.costUsd;
      }
      out[model.id] = { passed, total, latencyMs: latency, costUsd: cost };
    }
    return out;
  }, [parsed]);

  const toggleTask = (taskKey: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskKey)) next.delete(taskKey);
      else next.add(taskKey);
      return next;
    });
  };

  return (
    <section
      className="liquid-glass"
      data-glass-tier="medium"
      style={{
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md, 10px)",
        margin: "var(--space-sm) 0",
      }}
      aria-label={parsed.title ?? "Eval comparison"}
    >
      {parsed.title ? (
        <h3
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            marginBottom: "var(--space-sm)",
          }}
        >
          {parsed.title}
        </h3>
      ) : null}

      {/* Summary header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(0, 1fr) repeat(${parsed.models.length}, minmax(120px, 1fr))`,
          gap: "var(--space-sm)",
          paddingBottom: "var(--space-sm)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Summary ({parsed.tasks.length} tasks)
        </div>
        {parsed.models.map((model) => {
          const s = summaries[model.id] ?? {
            passed: 0,
            total: 0,
            latencyMs: 0,
            costUsd: 0,
          };
          const passRate = s.total > 0 ? (s.passed / s.total) * 100 : 0;
          return (
            <div
              key={model.id}
              style={{
                padding: "var(--space-sm)",
                borderRadius: "var(--radius-sm, 6px)",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  fontSize: "var(--font-size-2xs)",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  marginBottom: 4,
                }}
              >
                {model.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 700,
                  color:
                    passRate >= 80
                      ? "var(--color-success)"
                      : passRate >= 50
                        ? "var(--color-warning)"
                        : "var(--color-error)",
                }}
              >
                {passRate.toFixed(0)}%
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-2xs)",
                  color: "var(--color-text-muted)",
                }}
              >
                {s.passed}/{s.total} passed
                {s.latencyMs > 0 ? ` · ${formatMs(s.latencyMs)}` : ""}
                {s.costUsd > 0 ? ` · $${s.costUsd.toFixed(3)}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task grid */}
      <div
        style={{
          marginTop: "var(--space-sm)",
          maxHeight: 440,
          overflow: "auto",
        }}
      >
        {parsed.tasks.map((task) => {
          const isExpanded = expanded.has(task.id);
          return (
            <div
              key={task.id}
              style={{
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `minmax(0, 1fr) repeat(${parsed.models.length}, minmax(120px, 1fr))`,
                  gap: "var(--space-sm)",
                  padding: "6px 0",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleTask(task.id)}
                  aria-expanded={isExpanded}
                  className="btn-press"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-secondary)",
                    fontSize: "var(--font-size-xs)",
                    textAlign: "left",
                    padding: 0,
                    cursor: "pointer",
                    minWidth: 0,
                    overflow: "hidden",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 10,
                      color: "var(--color-text-dim)",
                      transform: isExpanded ? "rotate(90deg)" : "none",
                      transition: "transform 160ms var(--ease-out)",
                      display: "inline-block",
                    }}
                  >
                    ▸
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {task.name}
                  </span>
                </button>
                {parsed.models.map((model) => {
                  const result = task.results[model.id];
                  return (
                    <ResultCell
                      key={`${task.id}-${model.id}`}
                      result={result}
                      modelLabel={model.label}
                    />
                  );
                })}
              </div>
              {isExpanded ? (
                <div
                  style={{
                    padding: "var(--space-sm) 0 var(--space-md) 20px",
                    display: "grid",
                    gridTemplateColumns: `repeat(${parsed.models.length}, minmax(0, 1fr))`,
                    gap: "var(--space-sm)",
                  }}
                >
                  {parsed.models.map((model) => {
                    const r = task.results[model.id];
                    return (
                      <TrajectoryPanel
                        key={`${task.id}-${model.id}-traj`}
                        modelLabel={model.label}
                        result={r}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────
// Presentational subcomponents
// ────────────────────────────────────────────────────────────

function ResultCell({
  result,
  modelLabel,
}: {
  readonly result: TaskResult | undefined;
  readonly modelLabel: string;
}) {
  if (!result) {
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-2xs)",
          color: "var(--color-text-dim)",
        }}
        aria-label={`${modelLabel}: no result`}
      >
        —
      </span>
    );
  }
  const color = result.passed
    ? "var(--color-success)"
    : "var(--color-error)";
  const bg = result.passed
    ? "var(--color-success-muted)"
    : "var(--color-error-muted)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill, 9999px)",
        background: bg,
        color,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--font-size-2xs)",
        fontWeight: 600,
        justifySelf: "start",
      }}
      aria-label={`${modelLabel}: ${result.passed ? "passed" : "failed"}`}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "var(--radius-pill)",
          background: color,
        }}
      />
      {result.passed ? "pass" : "fail"}
      {typeof result.latencyMs === "number" ? (
        <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
          · {formatMs(result.latencyMs)}
        </span>
      ) : null}
    </span>
  );
}

function TrajectoryPanel({
  modelLabel,
  result,
}: {
  readonly modelLabel: string;
  readonly result: TaskResult | undefined;
}) {
  if (!result) {
    return (
      <div
        style={{
          padding: "var(--space-sm)",
          background: "var(--bg-surface)",
          border: "1px dashed var(--border-subtle)",
          borderRadius: "var(--radius-sm, 6px)",
          fontSize: "var(--font-size-2xs)",
          color: "var(--color-text-dim)",
        }}
      >
        {modelLabel} — no data
      </div>
    );
  }
  return (
    <div
      style={{
        padding: "var(--space-sm)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm, 6px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-2xs)",
          color: "var(--color-text-secondary)",
        }}
      >
        <strong style={{ fontWeight: 600 }}>{modelLabel}</strong>
        <span style={{ color: "var(--color-text-muted)" }}>
          {typeof result.tokens === "number"
            ? `${result.tokens.toLocaleString()} tok`
            : ""}
          {typeof result.costUsd === "number"
            ? ` · $${result.costUsd.toFixed(4)}`
            : ""}
        </span>
      </div>
      {result.trajectory ? (
        <pre
          style={{
            margin: 0,
            padding: "var(--space-sm)",
            background: "var(--bg-raised)",
            borderRadius: "var(--radius-sm, 6px)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-secondary)",
            whiteSpace: "pre-wrap",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {result.trajectory}
        </pre>
      ) : (
        <div
          style={{
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-dim)",
          }}
        >
          Trajectory not captured.
        </div>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
