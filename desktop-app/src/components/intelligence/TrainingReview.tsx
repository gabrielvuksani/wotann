/**
 * Training & Self-Evolution Review — D9.
 *
 * Surfaces the self-evolution pipeline that runs inside the KAIROS daemon:
 *  - Pending evolution items (approve / reject)
 *  - Pattern history (reusable patterns discovered)
 *  - Training status (idle, training, evaluating)
 *  - Skill forge triggers (what's queued for skill extraction)
 *
 * All card rendering lives in TrainingCards.tsx — this file owns data flow.
 */

import { useState, useEffect, useCallback } from "react";
import { rpc, StatusBadge } from "./intelligenceUtils";
import {
  PendingEvolutionCard,
  TrainingStatusCard,
  PatternHistoryCard,
  SkillForgeCard,
  STATUS_COLOR,
  type EvolutionItem,
  type Pattern,
  type TrainingStatus,
  type TrainingState,
  type SkillForgeTrigger,
} from "./TrainingCards";
import { color } from "../../design/tokens.generated";

// ── Normalizers — the daemon may return shapes in slightly different keys ──

function asArray<T>(x: unknown, key?: string): readonly T[] {
  if (Array.isArray(x)) return x as T[];
  if (key && x && typeof x === "object" && Array.isArray((x as Record<string, unknown>)[key])) {
    return (x as Record<string, unknown>)[key] as T[];
  }
  return [];
}

function normEvolution(raw: unknown): readonly EvolutionItem[] {
  return asArray<Record<string, unknown>>(raw, "items").map((r, i) => ({
    id: String(r.id ?? r.evolutionId ?? `evo-${i}`),
    title: String(r.title ?? r.name ?? "Untitled"),
    description: String(r.description ?? r.summary ?? r.body ?? ""),
    kind: (["instinct", "skill", "rule", "persona"] as const).includes((r.kind as "instinct") ?? "other")
      ? (r.kind as EvolutionItem["kind"])
      : "other",
    source: typeof r.source === "string" ? r.source : undefined,
    proposedAt: typeof r.proposedAt === "number" ? r.proposedAt
      : typeof r.timestamp === "number" ? r.timestamp
      : Date.now(),
    confidence: typeof r.confidence === "number" ? r.confidence : undefined,
  }));
}

function normPatterns(raw: unknown): readonly Pattern[] {
  return asArray<Record<string, unknown>>(raw, "patterns").map((r, i) => ({
    id: String(r.id ?? `pat-${i}`),
    name: String(r.name ?? r.pattern ?? "unnamed"),
    hits: Number(r.hits ?? r.count ?? 0),
    lastSeen: typeof r.lastSeen === "number" ? r.lastSeen
      : typeof r.timestamp === "number" ? r.timestamp
      : Date.now(),
    category: typeof r.category === "string" ? r.category : undefined,
  }));
}

function normStatus(raw: unknown): TrainingStatus {
  if (!raw || typeof raw !== "object") return { state: "idle" };
  const r = raw as Record<string, unknown>;
  const rawState = String(r.state ?? r.status ?? "idle");
  const allowed: readonly TrainingState[] = ["idle", "queued", "training", "evaluating", "error"];
  const state: TrainingState = (allowed as readonly string[]).includes(rawState) ? rawState as TrainingState : "idle";
  return {
    state,
    runId: typeof r.runId === "string" ? r.runId : undefined,
    progress: typeof r.progress === "number" ? r.progress : undefined,
    eta: typeof r.eta === "number" ? r.eta : undefined,
    message: typeof r.message === "string" ? r.message : undefined,
  };
}

function normForge(raw: unknown): readonly SkillForgeTrigger[] {
  return asArray<Record<string, unknown>>(raw, "triggers").map((r, i) => ({
    id: String(r.id ?? `forge-${i}`),
    trigger: String(r.trigger ?? r.name ?? "trigger"),
    occurrences: Number(r.occurrences ?? r.count ?? 0),
    readyToForge: Boolean(r.readyToForge ?? r.ready ?? false),
  }));
}

// ── Main component ────────────────────────────────────

export function TrainingReview() {
  const [pending, setPending] = useState<readonly EvolutionItem[]>([]);
  const [patterns, setPatterns] = useState<readonly Pattern[]>([]);
  const [status, setStatus] = useState<TrainingStatus>({ state: "idle" });
  const [forge, setForge] = useState<readonly SkillForgeTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evoRaw, patRaw, statRaw, forgeRaw] = await Promise.all([
        rpc("evolution.pending", {}).catch(() => null),
        rpc("patterns.list", {}).catch(() => null),
        rpc("train.status", {}).catch(() => null),
        rpc("skills.forge.triggers", {}).catch(() => null),
      ]);
      setPending(normEvolution(evoRaw));
      setPatterns(normPatterns(patRaw));
      setStatus(normStatus(statRaw));
      setForge(normForge(forgeRaw));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const decide = useCallback(async (item: EvolutionItem, action: "approve" | "reject") => {
    setBusy(item.id);
    setError(null);
    try {
      const method = action === "approve" ? "evolution.approve" : "evolution.reject";
      await rpc(method, { id: item.id });
      setPending((prev) => prev.filter((p) => p.id !== item.id));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }, []);

  const forgeOne = useCallback(async (t: SkillForgeTrigger) => {
    setBusy(t.id);
    setError(null);
    try {
      await rpc("skills.forge.run", { id: t.id });
      await loadAll();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }, [loadAll]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" role="region" aria-label="Training and evolution review">
      {/* Header */}
      <div
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)", margin: 0, letterSpacing: "-0.01em" }}>
            Training & Evolution
          </h2>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0 0" }}>
            Review what the agent wants to learn before it becomes permanent
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge text={status.state} color={STATUS_COLOR[status.state]} />
          <button
            onClick={loadAll}
            disabled={loading}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
              color: "var(--color-text-secondary)",
              cursor: loading ? "wait" : "pointer",
              minHeight: 32,
            }}
            aria-label="Refresh all training data"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 24px",
            background: "rgba(255,69,58,0.08)",
            color: color("error"),
            fontSize: 12,
            borderBottom: "1px solid rgba(255,69,58,0.2)",
          }}
        >
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto" style={{ padding: "16px 24px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 12,
            maxWidth: 1400,
            margin: "0 auto",
          }}
        >
          <PendingEvolutionCard items={pending} loading={loading} busy={busy} onDecide={decide} />
          <TrainingStatusCard status={status} />
          <PatternHistoryCard patterns={patterns} loading={loading} />
          <SkillForgeCard triggers={forge} loading={loading} busy={busy} onForge={forgeOne} />
        </div>
      </div>
    </div>
  );
}
