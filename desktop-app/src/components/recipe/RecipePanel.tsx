/**
 * RecipePanel — V9 R-02 desktop reach for the `wotann recipe` CLI.
 *
 * Audit-identified gap (V9_UNIFIED_GAP_MATRIX_2026-04-25 §3 R-02):
 * recipe runners exist (`src/recipes/recipe-loader.ts`,
 * `recipe-runtime.ts`) and the CLI wires `wotann recipe ...`, but no
 * desktop surface lets users browse or run them. This panel closes
 * the loop by exposing list + run + status flow against the daemon
 * RPC surface (`recipe.list`, `recipe.run`, `recipe.status`).
 *
 * RPC pattern: identical to CreationsBrowser — wrap each call in a
 * JSON-RPC 2.0 envelope and dispatch via `commands.sendMessage`.
 * Daemon-side handlers are owned by Wave B; until they ship the
 * panel surfaces a clear "method not found" banner rather than
 * silently no-op (QB#6 honest stub).
 *
 * DESIGN
 * - Header: title + refresh + status pill
 * - Action row: pick recipe + Run button + Cancel button (if a run
 *   is in flight)
 * - Output area: streaming output / last-run summary
 * - Per-mount state (QB#7): no module globals.
 * - Errors render in an alert banner; never silently swallowed.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { commands } from "../../hooks/useTauriCommand";
import {
  isNotImplemented,
  NotImplementedBanner,
  type NotImplementedEnvelope,
} from "../_shared/honestStub";

// ── Types ────────────────────────────────────────────────────

export interface RecipeEntry {
  readonly name: string;
  readonly description?: string;
  readonly path?: string;
}

interface RecipeRunResult {
  readonly recipe: string;
  readonly success: boolean;
  readonly output: string;
  readonly durationMs?: number;
}

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
    if (parsed.error) {
      throw new Error(`${method}: ${parsed.error.message}`);
    }
    return parsed.result ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${method}:`)) {
      throw err;
    }
    return null;
  }
}

function parseEntries(result: unknown): readonly RecipeEntry[] {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  const raw = obj["recipes"] ?? obj["entries"] ?? obj["items"];
  if (!Array.isArray(raw)) return [];
  const out: RecipeEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e["name"] !== "string") continue;
    out.push({
      name: e["name"] as string,
      description:
        typeof e["description"] === "string"
          ? (e["description"] as string)
          : undefined,
      path: typeof e["path"] === "string" ? (e["path"] as string) : undefined,
    });
  }
  return Object.freeze(out);
}

function parseRunResult(result: unknown, recipe: string): RecipeRunResult {
  if (!result || typeof result !== "object") {
    return { recipe, success: false, output: "" };
  }
  const obj = result as Record<string, unknown>;
  const success = obj["success"] === true || obj["ok"] === true;
  const output =
    typeof obj["output"] === "string"
      ? (obj["output"] as string)
      : typeof obj["log"] === "string"
        ? (obj["log"] as string)
        : "";
  const durationMs =
    typeof obj["durationMs"] === "number"
      ? (obj["durationMs"] as number)
      : undefined;
  return { recipe, success, output, durationMs };
}

// ── Component ────────────────────────────────────────────────

export function RecipePanel(): ReactElement {
  const [entries, setEntries] = useState<readonly RecipeEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<RecipeRunResult | null>(null);
  const [stubEnvelope, setStubEnvelope] =
    useState<NotImplementedEnvelope | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await rpcCall("recipe.list", {});
      if (isNotImplemented(result)) {
        setStubEnvelope(result);
        return;
      }
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
    // selected is closure-only: refreshing should not trigger loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (selected === null) return;
    setIsRunning(true);
    setErrorMessage(null);
    setLastResult(null);
    try {
      const result = await rpcCall("recipe.run", { name: selected });
      if (isNotImplemented(result)) {
        setStubEnvelope(result);
        return;
      }
      setLastResult(parseRunResult(result, selected));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [selected]);

  const cancel = useCallback(async (): Promise<void> => {
    setErrorMessage(null);
    try {
      await rpcCall("recipe.cancel", { name: selected ?? "" });
      setIsRunning(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const statusPill = useMemo(() => {
    if (isRunning) return { label: "Running", color: "var(--color-info, #38bdf8)" };
    if (lastResult?.success) return { label: "OK", color: "var(--color-success, #4ade80)" };
    if (lastResult && !lastResult.success)
      return { label: "Failed", color: "var(--color-error, #ef4444)" };
    return { label: "Idle", color: "var(--color-text-secondary)" };
  }, [isRunning, lastResult]);

  if (stubEnvelope) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-auto" data-testid="recipe-panel">
        <NotImplementedBanner envelope={stubEnvelope} panelTitle="Recipes" />
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="recipe-panel"
    >
      <PanelHeader
        title="Recipes"
        subtitle="Reusable agent workflows from .wotann/recipes/."
        statusLabel={statusPill.label}
        statusColor={statusPill.color}
        onRefresh={() => void refresh()}
        refreshing={isLoading}
      />

      {errorMessage !== null && (
        <ErrorBanner message={errorMessage} />
      )}

      <div
        style={{
          padding: "var(--space-md, 12px)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm, 8px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <select
          value={selected ?? ""}
          onChange={(e) => setSelected(e.target.value || null)}
          disabled={entries.length === 0}
          aria-label="Recipe"
          style={{
            flex: 1,
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
            <option value="">No recipes available</option>
          ) : (
            entries.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
                {e.description ? ` — ${e.description}` : ""}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={() => void run()}
          disabled={selected === null || isRunning}
          className="btn-press"
          style={{
            padding: "6px 14px",
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 600,
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px solid var(--border-subtle)",
            background:
              selected === null || isRunning
                ? "var(--surface-2)"
                : "var(--color-primary)",
            color:
              selected === null || isRunning
                ? "var(--color-text-muted)"
                : "#fff",
            cursor:
              selected === null || isRunning ? "not-allowed" : "pointer",
            opacity: selected === null || isRunning ? 0.55 : 1,
          }}
        >
          Run
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

      <OutputArea result={lastResult} isRunning={isRunning} />
    </div>
  );
}

// ── Shared sub-components (kept local to the file) ──────────

interface PanelHeaderProps {
  readonly title: string;
  readonly subtitle: string;
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly onRefresh: () => void;
  readonly refreshing: boolean;
}

function PanelHeader(props: PanelHeaderProps): ReactElement {
  return (
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
          {props.title}
        </h2>
        <p
          style={{
            margin: "var(--space-2xs, 2px) 0 0 0",
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {props.subtitle}
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
          aria-label={`Status: ${props.statusLabel}`}
          style={{
            fontSize: "var(--font-size-2xs, 10px)",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "3px 8px",
            borderRadius: "var(--radius-pill)",
            background: "rgba(255,255,255,0.04)",
            color: props.statusColor,
            border: `1px solid ${props.statusColor}33`,
          }}
        >
          {props.statusLabel}
        </span>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.refreshing}
          className="btn-press"
          style={{
            padding: "4px 10px",
            fontSize: "var(--font-size-2xs, 10px)",
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px solid var(--border-subtle)",
            background: "var(--surface-2)",
            color: "var(--color-text-secondary)",
            cursor: props.refreshing ? "wait" : "pointer",
            opacity: props.refreshing ? 0.6 : 1,
          }}
        >
          {props.refreshing ? "…" : "Refresh"}
        </button>
      </div>
    </header>
  );
}

interface ErrorBannerProps {
  readonly message: string;
}

function ErrorBanner(props: ErrorBannerProps): ReactElement {
  return (
    <div
      role="alert"
      data-testid="recipe-error"
      style={{
        margin: "var(--space-sm, 8px)",
        padding: "var(--space-sm, 8px) var(--space-md, 12px)",
        background: "var(--color-error-bg, rgba(239, 68, 68, 0.08))",
        color: "var(--color-error, #ef4444)",
        borderRadius: "var(--radius-sm, 6px)",
        fontSize: "var(--font-size-xs, 11px)",
      }}
    >
      {props.message}
    </div>
  );
}

interface OutputAreaProps {
  readonly result: RecipeRunResult | null;
  readonly isRunning: boolean;
}

function OutputArea(props: OutputAreaProps): ReactElement {
  if (props.isRunning) {
    return (
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
        Running recipe…
      </div>
    );
  }
  if (props.result === null) {
    return (
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
        Select a recipe and press Run to see output.
      </div>
    );
  }
  return (
    <pre
      data-testid="recipe-output"
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
      {props.result.output ||
        (props.result.success
          ? "(recipe completed with no output)"
          : "(recipe failed with no output)")}
    </pre>
  );
}
