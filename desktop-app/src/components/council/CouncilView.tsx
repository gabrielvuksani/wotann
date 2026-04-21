/**
 * Council Deliberation View — D2.
 *
 * Multiple models review the same task in parallel, then produce a consensus.
 * Wires into the `run_council` Tauri command which routes through KAIROS's
 * `council` RPC. Presentational parts live in CouncilCards.tsx.
 */

import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import { color } from "../../design/tokens.generated";
import {
  ModelPicker,
  PromptRow,
  ResponsesGrid,
  ConsensusPane,
  type CouncilEntry,
  type CouncilResult,
} from "./CouncilCards";

/**
 * Parse the council RPC response into a normalized shape. The backend returns
 * a string (markdown) whose structure depends on the KAIROS version — try to
 * extract per-model responses if delimiters are present, otherwise fall back
 * to the whole string as the consensus.
 */
function parseCouncilRaw(raw: string, models: readonly string[]): CouncilResult {
  try {
    const parsed = JSON.parse(raw) as Partial<CouncilResult>;
    if (parsed && Array.isArray(parsed.entries) && typeof parsed.consensus === "string") {
      return { entries: parsed.entries as CouncilEntry[], consensus: parsed.consensus };
    }
  } catch { /* not JSON */ }

  const sections = raw.split(/\n##\s+/).filter(Boolean);
  if (sections.length >= 2) {
    const entries: CouncilEntry[] = [];
    let consensus = "";
    for (const section of sections) {
      const lowered = section.slice(0, 60).toLowerCase();
      if (lowered.includes("consensus") || lowered.includes("summary") || lowered.includes("verdict")) {
        consensus = section.replace(/^[^\n]*\n/, "").trim();
      } else {
        const firstLine = section.split("\n", 1)[0] ?? "";
        const modelMatch = models.find((m) => firstLine.toLowerCase().includes(m.toLowerCase()));
        entries.push({
          model: modelMatch ?? (firstLine.trim() || "model"),
          provider: "",
          response: section.replace(/^[^\n]*\n/, "").trim(),
          status: "done",
        });
      }
    }
    if (entries.length > 0) {
      return { entries, consensus: consensus || raw };
    }
  }

  return {
    entries: models.map((m) => ({
      model: m,
      provider: "",
      response: "",
      status: "done" as const,
    })),
    consensus: raw,
  };
}

export function CouncilView() {
  const providers = useStore((s) => s.providers);
  const engineConnected = useStore((s) => s.engineConnected);
  const [task, setTask] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<CouncilResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allModels = useMemo(() => providers.flatMap((p) =>
    p.models.map((m) => ({ id: m.id, name: m.name, provider: p.name, providerId: p.id })),
  ), [providers]);

  const toggleModel = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const convene = useCallback(async () => {
    if (!task.trim() || selected.size < 2) return;
    setRunning(true);
    setError(null);
    setResult(null);

    const selectedArr = Array.from(selected);
    // Optimistic pending state
    setResult({
      entries: selectedArr.map((id) => ({
        model: id,
        provider: allModels.find((m) => m.id === id)?.provider ?? "",
        response: "",
        status: "pending",
      })),
      consensus: "",
    });

    try {
      const raw = await invoke<string>("run_council", {
        query: task,
        models: selectedArr,
      });
      const parsed = parseCouncilRaw(raw, selectedArr);
      const entries = parsed.entries.map((e) => ({
        ...e,
        provider: e.provider || allModels.find((m) => m.id === e.model || m.name === e.model)?.provider || e.provider,
      }));
      setResult({ entries, consensus: parsed.consensus });
    } catch (err) {
      setError(String(err ?? "Council failed"));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [task, selected, allModels]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" role="region" aria-label="Council deliberation">
      {/* Header */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)", margin: 0, letterSpacing: "-0.01em" }}>
          Council
        </h2>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0 0" }}>
          Multiple models deliberate the same task and produce a consensus
        </p>
      </div>

      <ModelPicker
        models={allModels}
        selected={selected}
        onToggle={toggleModel}
        engineConnected={engineConnected}
      />

      <PromptRow
        task={task}
        setTask={setTask}
        selectedCount={selected.size}
        running={running}
        onConvene={convene}
      />

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 24px",
            fontSize: 12,
            background: "rgba(255,69,58,0.08)",
            color: color("error"),
            borderBottom: "1px solid rgba(255,69,58,0.2)",
          }}
        >
          {error}
        </div>
      )}

      {/* Responses + consensus */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto" style={{ padding: "16px 24px" }}>
          {!result ? (
            <div className="flex items-center justify-center h-full">
              <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                Pick models, enter a task, and convene the council.
              </p>
            </div>
          ) : (
            <ResponsesGrid entries={result.entries} />
          )}
        </div>
        {result?.consensus && <ConsensusPane consensus={result.consensus} />}
      </div>
    </div>
  );
}
