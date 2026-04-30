/**
 * BuildPanel — V9 R-02 desktop reach for the `wotann build` CLI.
 *
 * Audit-identified gap (V9_UNIFIED_GAP_MATRIX_2026-04-25 §3 R-02):
 * `src/cli/commands/build.ts` exposes `runBuildCommand` (variant
 * planning + execution), but no desktop surface lets users dispatch
 * a build run, watch its progress, or inspect its result. This panel
 * exposes a simple prompt → variants → run flow against the daemon
 * RPC `build.run` / `build.status` / `build.cancel` methods.
 *
 * RPC pattern: JSON-RPC 2.0 envelope via `commands.sendMessage` —
 * identical to RecipePanel and CreationsBrowser. Daemon-side
 * handlers are owned by Wave B; surfacing "method not found" is
 * the honest stub behavior (QB#6) until those land.
 *
 * DESIGN
 * - Header: title + status pill + refresh
 * - Form: prompt textarea + variants slider + Run button
 * - Output: per-variant diff preview / status / cost
 * - Per-mount state (QB#7).
 * - Errors render in an alert banner.
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

interface BuildVariantSummary {
  readonly id: string;
  readonly model?: string;
  readonly status: "pending" | "running" | "success" | "failed";
  readonly summary?: string;
  readonly costUsd?: number;
}

interface BuildRunResult {
  readonly prompt: string;
  readonly variants: readonly BuildVariantSummary[];
  readonly success: boolean;
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
    if (parsed.error) throw new Error(`${method}: ${parsed.error.message}`);
    return parsed.result ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${method}:`)) throw err;
    return null;
  }
}

function parseVariants(raw: unknown): readonly BuildVariantSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: BuildVariantSummary[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (typeof e["id"] !== "string") continue;
    const status = e["status"];
    const validStatus =
      status === "pending" ||
      status === "running" ||
      status === "success" ||
      status === "failed"
        ? status
        : "pending";
    out.push({
      id: e["id"] as string,
      model: typeof e["model"] === "string" ? (e["model"] as string) : undefined,
      status: validStatus,
      summary:
        typeof e["summary"] === "string" ? (e["summary"] as string) : undefined,
      costUsd:
        typeof e["costUsd"] === "number" ? (e["costUsd"] as number) : undefined,
    });
  }
  return Object.freeze(out);
}

function parseRunResult(result: unknown, prompt: string): BuildRunResult {
  if (!result || typeof result !== "object") {
    return { prompt, variants: [], success: false };
  }
  const obj = result as Record<string, unknown>;
  const variants = parseVariants(obj["variants"] ?? obj["plans"]);
  const success =
    obj["success"] === true ||
    obj["ok"] === true ||
    variants.some((v) => v.status === "success");
  return { prompt, variants, success };
}

// ── Component ────────────────────────────────────────────────

export function BuildPanel(): ReactElement {
  const [prompt, setPrompt] = useState<string>("");
  const [variants, setVariants] = useState<number>(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<BuildRunResult | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState<boolean>(false);
  const [stubEnvelope, setStubEnvelope] =
    useState<NotImplementedEnvelope | null>(null);

  const refreshStatus = useCallback(async (): Promise<void> => {
    setStatusRefreshing(true);
    setErrorMessage(null);
    try {
      const result = await rpcCall("build.status", {});
      if (result && typeof result === "object") {
        const obj = result as Record<string, unknown>;
        if (obj["running"] === true) setIsRunning(true);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setStatusRefreshing(false);
    }
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (prompt.trim().length === 0) return;
    setIsRunning(true);
    setErrorMessage(null);
    setLastResult(null);
    try {
      const result = await rpcCall("build.run", {
        prompt: prompt.trim(),
        variants,
      });
      if (isNotImplemented(result)) {
        setStubEnvelope(result);
        return;
      }
      setLastResult(parseRunResult(result, prompt.trim()));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [prompt, variants]);

  const cancel = useCallback(async (): Promise<void> => {
    setErrorMessage(null);
    try {
      await rpcCall("build.cancel", {});
      setIsRunning(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const statusPill = useMemo(() => {
    if (isRunning) return { label: "Running", color: "var(--color-info, #38bdf8)" };
    if (lastResult?.success) return { label: "OK", color: "var(--color-success, #4ade80)" };
    if (lastResult && !lastResult.success)
      return { label: "Failed", color: "var(--color-error, #ef4444)" };
    return { label: "Idle", color: "var(--color-text-secondary)" };
  }, [isRunning, lastResult]);

  if (stubEnvelope) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-auto" data-testid="build-panel">
        <NotImplementedBanner envelope={stubEnvelope} panelTitle="Build" />
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="build-panel"
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
            Build
          </h2>
          <p
            style={{
              margin: "var(--space-2xs, 2px) 0 0 0",
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
            }}
          >
            Agent writes code from a natural-language prompt.
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
            onClick={() => void refreshStatus()}
            disabled={statusRefreshing}
            className="btn-press"
            style={{
              padding: "4px 10px",
              fontSize: "var(--font-size-2xs, 10px)",
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-2)",
              color: "var(--color-text-secondary)",
              cursor: statusRefreshing ? "wait" : "pointer",
              opacity: statusRefreshing ? 0.6 : 1,
            }}
          >
            {statusRefreshing ? "…" : "Refresh"}
          </button>
        </div>
      </header>

      {errorMessage !== null && (
        <div
          role="alert"
          data-testid="build-error"
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
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the change to build (e.g. add dark-mode toggle to settings)…"
          aria-label="Build prompt"
          rows={3}
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: "var(--font-size-sm, 13px)",
            fontFamily: "var(--font-sans)",
            background: "var(--surface-1)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm, 6px)",
            resize: "vertical",
            minHeight: 60,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm, 8px)",
          }}
        >
          <label
            htmlFor="variants-input"
            style={{
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
            }}
          >
            Variants
          </label>
          <input
            id="variants-input"
            type="number"
            min={1}
            max={5}
            value={variants}
            onChange={(e) =>
              setVariants(
                Math.min(5, Math.max(1, Number(e.target.value) || 1)),
              )
            }
            style={{
              width: 60,
              padding: "4px 8px",
              fontSize: "var(--font-size-sm, 13px)",
              fontFamily: "var(--font-mono)",
              background: "var(--surface-1)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm, 6px)",
            }}
          />
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void run()}
            disabled={prompt.trim().length === 0 || isRunning}
            className="btn-press"
            style={{
              padding: "6px 14px",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 600,
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-subtle)",
              background:
                prompt.trim().length === 0 || isRunning
                  ? "var(--surface-2)"
                  : "var(--color-primary)",
              color:
                prompt.trim().length === 0 || isRunning
                  ? "var(--color-text-muted)"
                  : "#fff",
              cursor:
                prompt.trim().length === 0 || isRunning
                  ? "not-allowed"
                  : "pointer",
              opacity: prompt.trim().length === 0 || isRunning ? 0.55 : 1,
            }}
          >
            Run Build
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
          overflow: "auto",
          padding: "var(--space-md, 12px)",
        }}
      >
        {isRunning ? (
          <div
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-sm, 13px)",
              textAlign: "center",
              padding: "var(--space-lg, 16px)",
            }}
          >
            Building…
          </div>
        ) : lastResult === null ? (
          <div
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-sm, 13px)",
              fontStyle: "italic",
              textAlign: "center",
              padding: "var(--space-lg, 16px)",
            }}
          >
            Enter a prompt and press Run Build.
          </div>
        ) : lastResult.variants.length === 0 ? (
          <div
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-sm, 13px)",
              textAlign: "center",
              padding: "var(--space-lg, 16px)",
            }}
          >
            Build returned no variants.
          </div>
        ) : (
          <ul
            data-testid="build-variants"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-sm, 8px)",
            }}
          >
            {lastResult.variants.map((v) => (
              <li
                key={v.id}
                style={{
                  padding: "var(--space-sm, 8px) var(--space-md, 12px)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm, 6px)",
                  background: "var(--surface-1)",
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
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-size-sm, 13px)",
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {v.id}
                  </span>
                  {v.model && (
                    <span
                      style={{
                        fontSize: "var(--font-size-2xs, 10px)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {v.model}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span
                    style={{
                      fontSize: "var(--font-size-2xs, 10px)",
                      fontWeight: 700,
                      color:
                        v.status === "success"
                          ? "var(--color-success, #4ade80)"
                          : v.status === "failed"
                            ? "var(--color-error, #ef4444)"
                            : "var(--color-text-secondary)",
                    }}
                  >
                    {v.status.toUpperCase()}
                  </span>
                  {typeof v.costUsd === "number" && (
                    <span
                      style={{
                        fontSize: "var(--font-size-2xs, 10px)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      ${v.costUsd.toFixed(4)}
                    </span>
                  )}
                </div>
                {v.summary && (
                  <p
                    style={{
                      margin: "var(--space-xs, 4px) 0 0 0",
                      fontSize: "var(--font-size-xs, 11px)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {v.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
