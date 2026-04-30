/**
 * OffloadPanel — V9 R-02 desktop reach for the `wotann offload` CLI.
 *
 * Audit-identified gap (V9_UNIFIED_GAP_MATRIX_2026-04-25 §3 R-02):
 * V9 T11.3 ships `wotann offload <task>` with three cloud providers
 * (anthropic-managed, fly-sprites, cloudflare-agents), but no desktop
 * surface exposes the offload trait. This panel routes a task to a
 * picked provider via `offload.providers`, `offload.run`,
 * `offload.status` daemon RPCs.
 *
 * RPC pattern: JSON-RPC 2.0 envelope via `commands.sendMessage`.
 * Daemon-side handlers are owned by Wave B; honest stub until then.
 *
 * DESIGN
 * - Header: title + status pill + refresh
 * - Form: provider picker + task textarea + Run / Cancel
 * - Output: per-stage cost preview + result body
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
import {
  isNotImplemented,
  NotImplementedBanner,
  type NotImplementedEnvelope,
} from "../_shared/honestStub";

// ── Types ────────────────────────────────────────────────────

interface OffloadProvider {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly available?: boolean;
}

interface OffloadResult {
  readonly provider: string;
  readonly success: boolean;
  readonly output: string;
  readonly costUsd?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly sessionId?: string;
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

const DEFAULT_PROVIDERS: readonly OffloadProvider[] = Object.freeze([
  {
    id: "anthropic-managed",
    name: "Anthropic Managed",
    description: "Anthropic-hosted long-running session",
    available: false,
  },
  {
    id: "fly-sprites",
    name: "Fly Sprites",
    description: "Fly.io ephemeral compute sprites",
    available: false,
  },
  {
    id: "cloudflare-agents",
    name: "Cloudflare Agents",
    description: "Cloudflare Durable Objects + Workers AI",
    available: false,
  },
]);

function parseProviders(result: unknown): readonly OffloadProvider[] {
  if (!result || typeof result !== "object") return DEFAULT_PROVIDERS;
  const obj = result as Record<string, unknown>;
  const raw = obj["providers"] ?? obj["entries"];
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_PROVIDERS;
  const out: OffloadProvider[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e["id"] !== "string") continue;
    out.push({
      id: e["id"] as string,
      name:
        typeof e["name"] === "string" ? (e["name"] as string) : (e["id"] as string),
      description:
        typeof e["description"] === "string"
          ? (e["description"] as string)
          : undefined,
      available: e["available"] !== false,
    });
  }
  return out.length > 0 ? Object.freeze(out) : DEFAULT_PROVIDERS;
}

function parseRunResult(result: unknown, provider: string): OffloadResult {
  if (!result || typeof result !== "object") {
    return { provider, success: false, output: "" };
  }
  const obj = result as Record<string, unknown>;
  const success = obj["success"] === true || obj["ok"] === true;
  const output =
    typeof obj["output"] === "string"
      ? (obj["output"] as string)
      : typeof obj["text"] === "string"
        ? (obj["text"] as string)
        : "";
  return {
    provider,
    success,
    output,
    costUsd:
      typeof obj["costUsd"] === "number" ? (obj["costUsd"] as number) : undefined,
    tokensIn:
      typeof obj["tokensIn"] === "number" ? (obj["tokensIn"] as number) : undefined,
    tokensOut:
      typeof obj["tokensOut"] === "number"
        ? (obj["tokensOut"] as number)
        : undefined,
    sessionId:
      typeof obj["sessionId"] === "string"
        ? (obj["sessionId"] as string)
        : undefined,
  };
}

// ── Component ────────────────────────────────────────────────

export function OffloadPanel(): ReactElement {
  const [providers, setProviders] = useState<readonly OffloadProvider[]>(
    DEFAULT_PROVIDERS,
  );
  const [selected, setSelected] = useState<string>(
    DEFAULT_PROVIDERS[0]?.id ?? "",
  );
  const [task, setTask] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<OffloadResult | null>(null);
  const [stubEnvelope, setStubEnvelope] =
    useState<NotImplementedEnvelope | null>(null);

  const refreshProviders = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await rpcCall("offload.providers", {});
      if (isNotImplemented(result)) {
        setStubEnvelope(result);
        return;
      }
      const list = parseProviders(result);
      setProviders(list);
      if (!list.some((p) => p.id === selected) && list.length > 0) {
        const first = list[0];
        if (first) setSelected(first.id);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
    // selected is intentionally stable across refreshes when present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (task.trim().length === 0) return;
    setIsRunning(true);
    setErrorMessage(null);
    setLastResult(null);
    try {
      const result = await rpcCall("offload.run", {
        provider: selected,
        task: task.trim(),
      });
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
  }, [selected, task]);

  const cancel = useCallback(async (): Promise<void> => {
    setErrorMessage(null);
    try {
      await rpcCall("offload.cancel", { provider: selected });
      setIsRunning(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [selected]);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  const statusPill = useMemo(() => {
    if (isRunning) return { label: "Running", color: "var(--color-info, #38bdf8)" };
    if (lastResult?.success) return { label: "Done", color: "var(--color-success, #4ade80)" };
    if (lastResult && !lastResult.success)
      return { label: "Failed", color: "var(--color-error, #ef4444)" };
    return { label: "Idle", color: "var(--color-text-secondary)" };
  }, [isRunning, lastResult]);

  if (stubEnvelope) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-auto" data-testid="offload-panel">
        <NotImplementedBanner envelope={stubEnvelope} panelTitle="Offload" />
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="offload-panel"
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
            Cloud Offload
          </h2>
          <p
            style={{
              margin: "var(--space-2xs, 2px) 0 0 0",
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
            }}
          >
            Route a task to a managed cloud session.
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
            onClick={() => void refreshProviders()}
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
          data-testid="offload-error"
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
        <div
          style={{
            display: "flex",
            gap: "var(--space-xs, 4px)",
            flexWrap: "wrap",
          }}
          role="radiogroup"
          aria-label="Offload provider"
        >
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected === p.id}
              onClick={() => setSelected(p.id)}
              disabled={p.available === false}
              className="btn-press"
              style={{
                padding: "6px 12px",
                fontSize: "var(--font-size-xs, 11px)",
                borderRadius: "var(--radius-sm, 6px)",
                border:
                  selected === p.id
                    ? "1px solid var(--color-primary)"
                    : "1px solid var(--border-subtle)",
                background:
                  selected === p.id
                    ? "rgba(10, 132, 255, 0.12)"
                    : "var(--surface-1)",
                color:
                  selected === p.id
                    ? "var(--color-text-primary)"
                    : "var(--color-text-secondary)",
                cursor: p.available === false ? "not-allowed" : "pointer",
                opacity: p.available === false ? 0.4 : 1,
              }}
              title={p.description ?? p.name}
            >
              {p.name}
            </button>
          ))}
        </div>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Task to offload (e.g. analyze the test failures and propose a fix)…"
          aria-label="Offload task"
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
            minHeight: 70,
          }}
        />
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
            disabled={task.trim().length === 0 || isRunning}
            className="btn-press"
            style={{
              padding: "6px 14px",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 600,
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-subtle)",
              background:
                task.trim().length === 0 || isRunning
                  ? "var(--surface-2)"
                  : "var(--color-primary)",
              color:
                task.trim().length === 0 || isRunning
                  ? "var(--color-text-muted)"
                  : "#fff",
              cursor:
                task.trim().length === 0 || isRunning
                  ? "not-allowed"
                  : "pointer",
              opacity: task.trim().length === 0 || isRunning ? 0.55 : 1,
            }}
          >
            Offload
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
            Offloading to {selected}…
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
            Pick a provider, write a task, press Offload.
          </div>
        ) : (
          <>
            <div
              style={{
                padding: "var(--space-sm, 8px) var(--space-md, 12px)",
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex",
                gap: "var(--space-md, 12px)",
                flexWrap: "wrap",
                fontSize: "var(--font-size-2xs, 10px)",
                color: "var(--color-text-secondary)",
              }}
            >
              <span>
                Provider:{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>
                  {lastResult.provider}
                </code>
              </span>
              {typeof lastResult.costUsd === "number" && (
                <span>Cost: ${lastResult.costUsd.toFixed(4)}</span>
              )}
              {typeof lastResult.tokensIn === "number" && (
                <span>In: {lastResult.tokensIn}</span>
              )}
              {typeof lastResult.tokensOut === "number" && (
                <span>Out: {lastResult.tokensOut}</span>
              )}
              {lastResult.sessionId && (
                <span>
                  Session:{" "}
                  <code style={{ fontFamily: "var(--font-mono)" }}>
                    {lastResult.sessionId}
                  </code>
                </span>
              )}
            </div>
            <pre
              data-testid="offload-output"
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
              {lastResult.output ||
                (lastResult.success
                  ? "(offload completed with no output)"
                  : "(offload failed with no output)")}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
