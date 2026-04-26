/**
 * AgentlessPanel — V9 R-02 desktop reach for the `wotann agentless` CLI.
 *
 * Audit-identified gap (V9_UNIFIED_GAP_MATRIX_2026-04-25 §3 R-02):
 * V9 T12.6 ships `wotann agentless <issue>` (LOCALIZE → REPAIR →
 * VALIDATE pipeline at `src/modes/agentless/orchestrator.ts`), but no
 * desktop surface exposes it. This panel takes an issue description,
 * dispatches it to the daemon RPC `agentless.run`, then renders the
 * three-phase result and any candidate patch.
 *
 * RPC pattern: JSON-RPC 2.0 envelope via `commands.sendMessage`.
 * Daemon-side handlers are owned by Wave B; honest stub until then.
 *
 * DESIGN
 * - Header: title + status pill
 * - Form: issue textarea + Repair button
 * - Output: phase indicators (LOCALIZE / REPAIR / VALIDATE) + diff
 * - Per-mount state (QB#7).
 */

import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { commands } from "../../hooks/useTauriCommand";

// ── Types ────────────────────────────────────────────────────

type Phase = "localize" | "repair" | "validate";

interface PhaseResult {
  readonly phase: Phase;
  readonly status: "pending" | "running" | "success" | "failed";
  readonly summary?: string;
}

interface AgentlessResult {
  readonly issue: string;
  readonly success: boolean;
  readonly phases: readonly PhaseResult[];
  readonly diff?: string;
  readonly affectedFiles: readonly string[];
}

const PHASE_ORDER: readonly Phase[] = ["localize", "repair", "validate"];

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

function parsePhases(raw: unknown): readonly PhaseResult[] {
  if (!Array.isArray(raw)) {
    return PHASE_ORDER.map<PhaseResult>((p) => ({
      phase: p,
      status: "pending",
    }));
  }
  const out: PhaseResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const phase = e["phase"];
    if (phase !== "localize" && phase !== "repair" && phase !== "validate") {
      continue;
    }
    const status = e["status"];
    const validStatus =
      status === "running" ||
      status === "success" ||
      status === "failed" ||
      status === "pending"
        ? status
        : "pending";
    out.push({
      phase,
      status: validStatus,
      summary:
        typeof e["summary"] === "string" ? (e["summary"] as string) : undefined,
    });
  }
  // Make sure all 3 phases are represented in canonical order.
  const byPhase = new Map(out.map((p) => [p.phase, p]));
  return PHASE_ORDER.map<PhaseResult>(
    (p) => byPhase.get(p) ?? { phase: p, status: "pending" },
  );
}

function parseRunResult(result: unknown, issue: string): AgentlessResult {
  if (!result || typeof result !== "object") {
    return {
      issue,
      success: false,
      phases: PHASE_ORDER.map((p) => ({ phase: p, status: "pending" })),
      affectedFiles: Object.freeze([] as string[]),
    };
  }
  const obj = result as Record<string, unknown>;
  const success = obj["success"] === true || obj["ok"] === true;
  const phases = parsePhases(obj["phases"]);
  const diff = typeof obj["diff"] === "string" ? (obj["diff"] as string) : undefined;
  const filesRaw = obj["affectedFiles"] ?? obj["files"];
  const affectedFiles: readonly string[] = Array.isArray(filesRaw)
    ? (filesRaw.filter((s) => typeof s === "string") as readonly string[])
    : Object.freeze([] as string[]);
  return { issue, success, phases, diff, affectedFiles };
}

// ── Component ────────────────────────────────────────────────

export function AgentlessPanel(): ReactElement {
  const [issue, setIssue] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<AgentlessResult | null>(null);

  const run = useCallback(async (): Promise<void> => {
    if (issue.trim().length === 0) return;
    setIsRunning(true);
    setErrorMessage(null);
    setLastResult(null);
    try {
      const result = await rpcCall("agentless.run", { issue: issue.trim() });
      setLastResult(parseRunResult(result, issue.trim()));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [issue]);

  const cancel = useCallback(async (): Promise<void> => {
    setErrorMessage(null);
    try {
      await rpcCall("agentless.cancel", {});
      setIsRunning(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const statusPill = useMemo(() => {
    if (isRunning) return { label: "Repairing", color: "var(--color-info, #38bdf8)" };
    if (lastResult?.success) return { label: "Patched", color: "var(--color-success, #4ade80)" };
    if (lastResult && !lastResult.success)
      return { label: "Unresolved", color: "var(--color-error, #ef4444)" };
    return { label: "Idle", color: "var(--color-text-secondary)" };
  }, [isRunning, lastResult]);

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="agentless-panel"
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
            Agentless Repair
          </h2>
          <p
            style={{
              margin: "var(--space-2xs, 2px) 0 0 0",
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
            }}
          >
            LOCALIZE → REPAIR → VALIDATE pipeline for issue patches.
          </p>
        </div>
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
      </header>

      {errorMessage !== null && (
        <div
          role="alert"
          data-testid="agentless-error"
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
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="Describe the issue (stack trace, failing test, expected vs actual)…"
          aria-label="Issue description"
          rows={4}
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
            minHeight: 80,
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
            disabled={issue.trim().length === 0 || isRunning}
            className="btn-press"
            style={{
              padding: "6px 14px",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 600,
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-subtle)",
              background:
                issue.trim().length === 0 || isRunning
                  ? "var(--surface-2)"
                  : "var(--color-primary)",
              color:
                issue.trim().length === 0 || isRunning
                  ? "var(--color-text-muted)"
                  : "#fff",
              cursor:
                issue.trim().length === 0 || isRunning
                  ? "not-allowed"
                  : "pointer",
              opacity: issue.trim().length === 0 || isRunning ? 0.55 : 1,
            }}
          >
            Repair
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
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          gap: "var(--space-sm, 8px)",
          flexShrink: 0,
        }}
        aria-label="Phase indicators"
      >
        {(lastResult?.phases ??
          PHASE_ORDER.map((p) => ({
            phase: p,
            status: isRunning ? "running" : "pending",
          } as PhaseResult))).map((p) => (
          <PhaseChip key={p.phase} phase={p} />
        ))}
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
            Running agentless pipeline…
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
            Describe an issue and press Repair.
          </div>
        ) : (
          <>
            {lastResult.affectedFiles.length > 0 && (
              <div
                style={{
                  padding: "var(--space-sm, 8px) var(--space-md, 12px)",
                  borderBottom: "1px solid var(--border-subtle)",
                  fontSize: "var(--font-size-xs, 11px)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Affected ({lastResult.affectedFiles.length}):{" "}
                {lastResult.affectedFiles.map((p, i) => (
                  <span key={p}>
                    <code
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {p}
                    </code>
                    {i < lastResult.affectedFiles.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>
            )}
            <pre
              data-testid="agentless-diff"
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
              {lastResult.diff ||
                (lastResult.success
                  ? "(repair produced no patch — issue may not require code changes)"
                  : "(no patch produced — issue could not be localized or repair failed validation)")}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

// ── Phase chip ──────────────────────────────────────────────

function PhaseChip({ phase }: { readonly phase: PhaseResult }): ReactElement {
  const color =
    phase.status === "success"
      ? "var(--color-success, #4ade80)"
      : phase.status === "failed"
        ? "var(--color-error, #ef4444)"
        : phase.status === "running"
          ? "var(--color-info, #38bdf8)"
          : "var(--color-text-secondary)";
  return (
    <div
      title={phase.summary ?? phase.phase}
      style={{
        flex: 1,
        padding: "6px 10px",
        borderRadius: "var(--radius-sm, 6px)",
        border: `1px solid ${color}33`,
        background: "rgba(255,255,255,0.02)",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: "var(--font-size-2xs, 10px)",
          fontWeight: 700,
          color,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {phase.phase}
      </span>
      <span
        style={{
          fontSize: "var(--font-size-2xs, 10px)",
          color: "var(--color-text-secondary)",
        }}
      >
        {phase.status}
      </span>
    </div>
  );
}
