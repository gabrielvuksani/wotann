/**
 * DeployPanel — V9 R-02 desktop reach for the `wotann deploy` CLI.
 *
 * Audit-identified gap (V9_UNIFIED_GAP_MATRIX_2026-04-25 §3 R-02):
 * `src/cli/commands/deploy.ts` ships `runDeployCommand` for Dokploy /
 * Coolify / etc., but no desktop surface lets users pick a target +
 * dispatch a deploy + watch its result. This panel exposes the
 * target picker → run → status flow against the daemon RPC
 * `deploy.targets`, `deploy.run`, `deploy.status` methods.
 *
 * RPC pattern: JSON-RPC 2.0 envelope via `commands.sendMessage`.
 * Daemon-side handlers are owned by Wave B.
 *
 * DESIGN
 * - Header: title + status pill + refresh
 * - Form: target picker + environment + Deploy button
 * - Output: deploy log with timestamps
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

interface DeployTarget {
  readonly id: string;
  readonly name: string;
  readonly kind?: string;
}

interface DeployRunResult {
  readonly target: string;
  readonly env: string;
  readonly success: boolean;
  readonly log: string;
  readonly url?: string;
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

function parseTargets(result: unknown): readonly DeployTarget[] {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  const raw = obj["targets"] ?? obj["entries"];
  if (!Array.isArray(raw)) return [];
  const out: DeployTarget[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e["id"] !== "string") continue;
    out.push({
      id: e["id"] as string,
      name:
        typeof e["name"] === "string" ? (e["name"] as string) : (e["id"] as string),
      kind: typeof e["kind"] === "string" ? (e["kind"] as string) : undefined,
    });
  }
  return Object.freeze(out);
}

function parseRunResult(
  result: unknown,
  target: string,
  env: string,
): DeployRunResult {
  if (!result || typeof result !== "object") {
    return { target, env, success: false, log: "" };
  }
  const obj = result as Record<string, unknown>;
  const success = obj["success"] === true || obj["ok"] === true;
  const log =
    typeof obj["log"] === "string"
      ? (obj["log"] as string)
      : typeof obj["output"] === "string"
        ? (obj["output"] as string)
        : "";
  const url = typeof obj["url"] === "string" ? (obj["url"] as string) : undefined;
  return { target, env, success, log, url };
}

// ── Component ────────────────────────────────────────────────

export function DeployPanel(): ReactElement {
  const [targets, setTargets] = useState<readonly DeployTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [env, setEnv] = useState<string>("production");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DeployRunResult | null>(null);
  const [stubEnvelope, setStubEnvelope] =
    useState<NotImplementedEnvelope | null>(null);

  const refreshTargets = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await rpcCall("deploy.targets", {});
      if (isNotImplemented(result)) {
        setStubEnvelope(result);
        return;
      }
      const list = parseTargets(result);
      setTargets(list);
      if (
        selectedTarget !== null &&
        !list.some((t) => t.id === selectedTarget)
      ) {
        setSelectedTarget(null);
      }
      if (selectedTarget === null && list.length > 0) {
        const first = list[0];
        if (first) setSelectedTarget(first.id);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
    // selectedTarget intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (selectedTarget === null) return;
    setIsRunning(true);
    setErrorMessage(null);
    setLastResult(null);
    try {
      const result = await rpcCall("deploy.run", {
        target: selectedTarget,
        env,
      });
      if (isNotImplemented(result)) {
        setStubEnvelope(result);
        return;
      }
      setLastResult(parseRunResult(result, selectedTarget, env));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [selectedTarget, env]);

  useEffect(() => {
    void refreshTargets();
  }, [refreshTargets]);

  const statusPill = useMemo(() => {
    if (isRunning) return { label: "Deploying", color: "var(--color-info, #38bdf8)" };
    if (lastResult?.success) return { label: "Live", color: "var(--color-success, #4ade80)" };
    if (lastResult && !lastResult.success)
      return { label: "Failed", color: "var(--color-error, #ef4444)" };
    return { label: "Idle", color: "var(--color-text-secondary)" };
  }, [isRunning, lastResult]);

  if (stubEnvelope) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-auto" data-testid="deploy-panel">
        <NotImplementedBanner envelope={stubEnvelope} panelTitle="Deploy" />
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="deploy-panel"
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
            Deploy
          </h2>
          <p
            style={{
              margin: "var(--space-2xs, 2px) 0 0 0",
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
            }}
          >
            Push the current build to a configured target.
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
            onClick={() => void refreshTargets()}
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
          data-testid="deploy-error"
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
          alignItems: "center",
          gap: "var(--space-sm, 8px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <select
          value={selectedTarget ?? ""}
          onChange={(e) => setSelectedTarget(e.target.value || null)}
          disabled={targets.length === 0}
          aria-label="Deploy target"
          style={{
            flex: 1,
            minWidth: 200,
            padding: "6px 10px",
            fontSize: "var(--font-size-sm, 13px)",
            fontFamily: "var(--font-mono)",
            background: "var(--surface-1)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm, 6px)",
          }}
        >
          {targets.length === 0 ? (
            <option value="">No deploy targets configured</option>
          ) : (
            targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.kind ? ` — ${t.kind}` : ""}
              </option>
            ))
          )}
        </select>
        <select
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          aria-label="Environment"
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
          <option value="production">production</option>
          <option value="staging">staging</option>
          <option value="preview">preview</option>
        </select>
        <button
          type="button"
          onClick={() => void run()}
          disabled={selectedTarget === null || isRunning}
          className="btn-press"
          style={{
            padding: "6px 14px",
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 600,
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px solid var(--border-subtle)",
            background:
              selectedTarget === null || isRunning
                ? "var(--surface-2)"
                : "var(--color-primary)",
            color:
              selectedTarget === null || isRunning
                ? "var(--color-text-muted)"
                : "#fff",
            cursor:
              selectedTarget === null || isRunning ? "not-allowed" : "pointer",
            opacity: selectedTarget === null || isRunning ? 0.55 : 1,
          }}
        >
          Deploy
        </button>
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
            Deploying to {selectedTarget}…
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
            Pick a target and press Deploy.
          </div>
        ) : (
          <>
            {lastResult.url && (
              <div
                style={{
                  padding: "var(--space-sm, 8px) var(--space-md, 12px)",
                  borderBottom: "1px solid var(--border-subtle)",
                  fontSize: "var(--font-size-xs, 11px)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Live URL:{" "}
                <code
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {lastResult.url}
                </code>
              </div>
            )}
            <pre
              data-testid="deploy-log"
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
                  ? "(deploy completed with no log output)"
                  : "(deploy failed with no log output)")}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
