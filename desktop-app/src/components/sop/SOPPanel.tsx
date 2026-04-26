/**
 * SOPPanel — V9 R-02 desktop reach for the `wotann sop` CLI.
 *
 * Audit-identified gap (V9_UNIFIED_GAP_MATRIX_2026-04-25 §3 R-02):
 * `src/cli/commands/sop.ts` ships `runSopCommand` for staged
 * standard-operating-procedure runs (V9 T12.7), but no desktop
 * surface lets users select stages + dispatch a run. This panel
 * exposes the stage picker → run → emit summary flow against the
 * daemon RPC `sop.list`, `sop.run`, `sop.cancel`.
 *
 * RPC pattern: JSON-RPC 2.0 envelope via `commands.sendMessage`.
 * Daemon-side handlers are owned by Wave B; honest stub until then.
 *
 * DESIGN
 * - Header: title + status pill + refresh
 * - Form: SOP picker + stage checkboxes + Run / Cancel
 * - Output: emitted-files banner + log
 * - Per-mount state (QB#7).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { commands } from "../../hooks/useTauriCommand";

// ── Types ────────────────────────────────────────────────────

interface SopEntry {
  readonly name: string;
  readonly description?: string;
  readonly stages?: readonly string[];
}

interface SopRunResult {
  readonly name: string;
  readonly success: boolean;
  readonly emitted: readonly string[];
  readonly log: string;
}

const DEFAULT_STAGES: readonly string[] = Object.freeze([
  "prd",
  "architecture",
  "system_design",
  "tech_doc",
  "task_list",
]);

// ── RPC helpers ─────────────────────────────────────────────

interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
  readonly id?: number;
}

async function rpcCall(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await commands.sendMessage(
    JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  );
  if (!response) return null;
  try {
    const parsed = JSON.parse(response) as JsonRpcResponse;
    if (parsed.error) throw new Error(`${method}: ${parsed.error.message}`);
    return parsed.result ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${method}:`)) throw err;
    return null;
  }
}

function parseEntries(result: unknown): readonly SopEntry[] {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  const raw = obj["sops"] ?? obj["entries"] ?? obj["items"];
  if (!Array.isArray(raw)) return [];
  const out: SopEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e["name"] !== "string") continue;
    const stagesRaw = e["stages"];
    const stages = Array.isArray(stagesRaw)
      ? (stagesRaw.filter((s) => typeof s === "string") as readonly string[])
      : undefined;
    out.push({
      name: e["name"] as string,
      description:
        typeof e["description"] === "string"
          ? (e["description"] as string)
          : undefined,
      stages,
    });
  }
  return Object.freeze(out);
}

function parseRunResult(result: unknown, name: string): SopRunResult {
  if (!result || typeof result !== "object") {
    return { name, success: false, emitted: [], log: "" };
  }
  const obj = result as Record<string, unknown>;
  const success = obj["success"] === true || obj["ok"] === true;
  const emittedRaw = obj["emitted"];
  const emitted: readonly string[] = Array.isArray(emittedRaw)
    ? (emittedRaw.filter((s) => typeof s === "string") as readonly string[])
    : Object.freeze([] as string[]);
  const log =
    typeof obj["log"] === "string"
      ? (obj["log"] as string)
      : typeof obj["output"] === "string"
        ? (obj["output"] as string)
        : "";
  return { name, success, emitted, log };
}

// ── Component ────────────────────────────────────────────────

export function SOPPanel(): ReactElement {
  const [entries, setEntries] = useState<readonly SopEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stagesEnabled, setStagesEnabled] = useState<ReadonlySet<string>>(
    () => new Set<string>(DEFAULT_STAGES),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<SopRunResult | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await rpcCall("sop.list", {});
      const list = parseEntries(result);
      setEntries(list);
      if (selected !== null && !list.some((e) => e.name === selected)) {
        setSelected(null);
      }
      if (selected === null && list.length > 0) {
        const first = list[0];
        if (first) setSelected(first.name);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
    // selected is closure-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleStage = useCallback((stage: string) => {
    setStagesEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (selected === null) return;
    setIsRunning(true);
    setErrorMessage(null);
    setLastResult(null);
    try {
      const result = await rpcCall("sop.run", {
        name: selected,
        stages: Array.from(stagesEnabled),
      });
      setLastResult(parseRunResult(result, selected));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [selected, stagesEnabled]);

  const cancel = useCallback(async (): Promise<void> => {
    setErrorMessage(null);
    try {
      await rpcCall("sop.cancel", { name: selected ?? "" });
      setIsRunning(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allStages = useMemo(() => {
    const fromEntry = entries.find((e) => e.name === selected)?.stages;
    return fromEntry && fromEntry.length > 0 ? fromEntry : DEFAULT_STAGES;
  }, [entries, selected]);

  const statusPill = useMemo(() => {
    if (isRunning) return { label: "Running", color: "var(--color-info, #38bdf8)" };
    if (lastResult?.success) return { label: "OK", color: "var(--color-success, #4ade80)" };
    if (lastResult && !lastResult.success)
      return { label: "Failed", color: "var(--color-error, #ef4444)" };
    return { label: "Idle", color: "var(--color-text-secondary)" };
  }, [isRunning, lastResult]);

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="sop-panel"
    >
      <header
        style={{
          padding: "var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: "var(--font-size-lg, 16px)",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            SOP
          </h2>
          <p
            style={{
              margin: "var(--space-2xs, 2px) 0 0 0",
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
            }}
          >
            Standard operating procedure — staged document generation.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm, 8px)",
          }}
        >
          <span
            aria-label={`Status: ${statusPill.label}`}
            style={{
              fontSize: "var(--font-size-2xs, 10px)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "3px 8px",
              borderRadius: "var(--radius-pill)",
              background: "rgba(255,255,255,0.04)",
              color: statusPill.color,
              border: `1px solid ${statusPill.color}33`,
            }}
          >
            {statusPill.label}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isLoading}
            className="btn-press"
            style={{
              padding: "4px 10px",
              fontSize: "var(--font-size-2xs, 10px)",
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-2)",
              color: "var(--color-text-secondary)",
              cursor: isLoading ? "wait" : "pointer",
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? "…" : "Refresh"}
          </button>
        </div>
      </header>

      {errorMessage !== null && (
        <div
          role="alert"
          data-testid="sop-error"
          style={{
            margin: "var(--space-sm, 8px)",
            padding: "var(--space-sm, 8px) var(--space-md, 12px)",
            background: "var(--color-error-bg, rgba(239, 68, 68, 0.08))",
            color: "var(--color-error, #ef4444)",
            borderRadius: "var(--radius-sm, 6px)",
            fontSize: "var(--font-size-xs, 11px)",
          }}
        >
          {errorMessage}
        </div>
      )}

      <div
        style={{
          padding: "var(--space-md, 12px)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm, 8px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <select
          value={selected ?? ""}
          onChange={(e) => setSelected(e.target.value || null)}
          disabled={entries.length === 0}
          aria-label="SOP"
          style={{
            padding: "6px 10px",
            fontSize: "var(--font-size-sm, 13px)",
            fontFamily: "var(--font-mono)",
            background: "var(--surface-1)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm, 6px)",
          }}
        >
          {entries.length === 0 ? (
            <option value="">No SOPs available</option>
          ) : (
            entries.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
                {e.description ? ` — ${e.description}` : ""}
              </option>
            ))
          )}
        </select>

        <fieldset
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-xs, 4px)",
            border: "none",
            margin: 0,
            padding: 0,
          }}
        >
          <legend
            style={{
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
              padding: 0,
              marginBottom: "var(--space-2xs, 2px)",
            }}
          >
            Stages
          </legend>
          {allStages.map((stage) => (
            <label
              key={stage}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                fontSize: "var(--font-size-xs, 11px)",
                borderRadius: "var(--radius-sm, 6px)",
                border: "1px solid var(--border-subtle)",
                background: stagesEnabled.has(stage)
                  ? "rgba(10, 132, 255, 0.12)"
                  : "var(--surface-1)",
                color: stagesEnabled.has(stage)
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={stagesEnabled.has(stage)}
                onChange={() => toggleStage(stage)}
                style={{ accentColor: "var(--color-primary)" }}
              />
              {stage}
            </label>
          ))}
        </fieldset>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm, 8px)",
          }}
        >
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void run()}
            disabled={selected === null || isRunning || stagesEnabled.size === 0}
            className="btn-press"
            style={{
              padding: "6px 14px",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 600,
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-subtle)",
              background:
                selected === null || isRunning || stagesEnabled.size === 0
                  ? "var(--surface-2)"
                  : "var(--color-primary)",
              color:
                selected === null || isRunning || stagesEnabled.size === 0
                  ? "var(--color-text-muted)"
                  : "#fff",
              cursor:
                selected === null || isRunning || stagesEnabled.size === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                selected === null || isRunning || stagesEnabled.size === 0
                  ? 0.55
                  : 1,
            }}
          >
            Run SOP
          </button>
          {isRunning && (
            <button
              type="button"
              onClick={() => void cancel()}
              className="btn-press"
              style={{
                padding: "6px 14px",
                fontSize: "var(--font-size-sm, 13px)",
                fontWeight: 600,
                borderRadius: "var(--radius-sm, 6px)",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-2)",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {isRunning ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-sm, 13px)",
            }}
          >
            Running SOP {selected}…
          </div>
        ) : lastResult === null ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-sm, 13px)",
              fontStyle: "italic",
            }}
          >
            Pick an SOP and stages, then press Run SOP.
          </div>
        ) : (
          <>
            {lastResult.emitted.length > 0 && (
              <div
                style={{
                  padding: "var(--space-sm, 8px) var(--space-md, 12px)",
                  borderBottom: "1px solid var(--border-subtle)",
                  fontSize: "var(--font-size-xs, 11px)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Emitted ({lastResult.emitted.length}):{" "}
                {lastResult.emitted.map((p, i) => (
                  <span key={p}>
                    <code
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {p}
                    </code>
                    {i < lastResult.emitted.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            )}
            <pre
              data-testid="sop-log"
              style={{
                flex: 1,
                margin: 0,
                padding: "var(--space-md, 12px)",
                overflow: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-size-xs, 11px)",
                color: "var(--color-text-primary)",
                background: "var(--bg-base, transparent)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {lastResult.log ||
                (lastResult.success
                  ? "(SOP completed with no log output)"
                  : "(SOP failed with no log output)")}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
