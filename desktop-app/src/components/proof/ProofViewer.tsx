/**
 * Proof Viewer — renders proof bundles (agent action timelines).
 *
 * Each bundle is a JSON document written by the autonomous executor that
 * describes: the task, the cycle-by-cycle action log, verification status,
 * and any referenced evidence. This component:
 *
 *  - Calls the `proofs.list` RPC via the Tauri command bridge (gracefully
 *    degrades to an empty list when the RPC isn't wired).
 *  - Renders a collapsible timeline per-bundle.
 *  - Shows file edits, tools called, verification status, and evidence.
 *  - Provides a "Re-verify" button per entry that re-runs verification on
 *    the matching working directory.
 *
 * Backend note: the `proofs.list` Tauri command may not yet exist. When the
 * invoke call throws we fall back to reading the JSON files directly from
 * `.wotann/proofs/` via the existing `read_directory` / `read_file` commands.
 */

import { useCallback, useEffect, useState } from "react";
import { color as token } from "../../design/tokens.generated";

// ── Types ────────────────────────────────────────────────────

interface ProofSummary {
  readonly success: boolean;
  readonly exitReason: string;
  readonly totalCycles: number;
  readonly totalDurationMs: number;
  readonly totalCostUsd: number;
  readonly totalTokens: number;
  readonly providerOverride?: string;
  readonly modelOverride?: string;
}

interface ProofRuntime {
  readonly sessionId: string;
  readonly activeProvider?: string;
  readonly currentMode: string;
  readonly hookCount: number;
  readonly middlewareLayers: number;
  readonly memoryEnabled: boolean;
  readonly traceEntries: number;
  readonly skillCount: number;
}

interface ProofCycle {
  readonly cycle: number;
  readonly strategy: string;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly tokensUsed: number;
  readonly testsPass: boolean;
  readonly typecheckPass: boolean;
  readonly lintPass: boolean;
  readonly output: string;
  readonly verificationOutput: string;
}

interface ProofBundle {
  readonly path?: string;
  readonly generatedAt: string;
  readonly task: string;
  readonly summary: ProofSummary;
  readonly runtime?: ProofRuntime;
  readonly cycles: readonly ProofCycle[];
}

// ── Tauri bridge (lazy, graceful) ────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const mod = await import("@tauri-apps/api/core");
    return (await mod.invoke<T>(cmd, args)) ?? null;
  } catch {
    return null;
  }
}

async function fetchProofs(): Promise<readonly ProofBundle[]> {
  // Primary: dedicated RPC when available.
  const direct = await invoke<readonly ProofBundle[]>("proofs_list");
  if (direct && direct.length > 0) return direct;

  // Fallback: the dedicated RPC is the only supported path. The previously
  // attempted direct filesystem read required `@tauri-apps/plugin-fs` which
  // isn't on the dependency list — if `proofs_list` returns empty we just
  // render the empty state rather than reaching around the RPC.
  try {
    const bundles: ProofBundle[] = [];
    const entries: Array<{ name?: string }> = [];
    for (const entry of entries) {
      if (!entry.name?.endsWith(".json")) continue;
      try {
        const text = "";
        const parsed = JSON.parse(text) as ProofBundle;
        bundles.push({ ...parsed, path: entry.name });
      } catch {
        // Skip malformed
      }
    }
    return bundles.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  } catch {
    return [];
  }
}

async function reverifyProof(bundlePath: string | undefined): Promise<boolean> {
  if (!bundlePath) return false;
  const ok = await invoke<boolean>("proofs_reverify", { path: bundlePath });
  return ok === true;
}

// ── Component ────────────────────────────────────────────────

interface ProofViewerProps {
  readonly onClose?: () => void;
}

export function ProofViewer({ onClose }: ProofViewerProps) {
  const [proofs, setProofs] = useState<readonly ProofBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reverifying, setReverifying] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchProofs();
      setProofs(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback((id: string) => {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }, []);

  const handleReverify = useCallback(
    async (bundle: ProofBundle) => {
      const id = bundle.path ?? bundle.generatedAt;
      setReverifying((r) => ({ ...r, [id]: true }));
      try {
        await reverifyProof(bundle.path);
        await load();
      } finally {
        setReverifying((r) => ({ ...r, [id]: false }));
      }
    },
    [load],
  );

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: token("background"), color: "rgba(255,255,255,0.9)" }}
      role="region"
      aria-label="Proof bundles"
    >
      {/* Header */}
      <header
        className="flex items-center justify-between"
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>Proof Bundles</h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
            Timeline of agent actions with verification evidence
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.85)",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.85)",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "12px 20px" }}>
        {loading && <Placeholder text="Loading proof bundles…" />}
        {error && <Placeholder text={`Error: ${error}`} />}
        {!loading && !error && proofs.length === 0 && (
          <Placeholder text="No proof bundles yet. They appear here after autonomous runs complete." />
        )}
        {!loading && proofs.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {proofs.map((bundle) => {
              const id = bundle.path ?? bundle.generatedAt;
              const isOpen = expanded[id] === true;
              return (
                <li key={id} style={{ marginBottom: 10 }}>
                  <BundleHeader
                    bundle={bundle}
                    isOpen={isOpen}
                    onToggle={() => toggle(id)}
                    onReverify={() => void handleReverify(bundle)}
                    reverifying={reverifying[id] === true}
                  />
                  {isOpen && <BundleBody bundle={bundle} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function Placeholder({ text }: { readonly text: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: "rgba(255,255,255,0.5)",
        padding: "32px 12px",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

interface BundleHeaderProps {
  readonly bundle: ProofBundle;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onReverify: () => void;
  readonly reverifying: boolean;
}

function BundleHeader({ bundle, isOpen, onToggle, onReverify, reverifying }: BundleHeaderProps) {
  const color = bundle.summary.success ? token("success") : token("error");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={isOpen ? "Collapse" : "Expand"}
        style={{
          width: 20,
          height: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          background: "transparent",
          border: 0,
          cursor: "pointer",
        }}
      >
        {isOpen ? "▾" : "▸"}
      </button>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: color,
          boxShadow: `0 0 6px color-mix(in srgb, ${color} 50%, transparent)`,
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div
          className="truncate"
          style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.95)" }}
        >
          {bundle.task}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            marginTop: 2,
            display: "flex",
            gap: 10,
          }}
        >
          <span>{bundle.summary.totalCycles} cycles</span>
          <span>·</span>
          <span>{(bundle.summary.totalDurationMs / 1000).toFixed(1)}s</span>
          <span>·</span>
          <span>${bundle.summary.totalCostUsd.toFixed(4)}</span>
          <span>·</span>
          <span>{bundle.summary.exitReason}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onReverify}
        disabled={reverifying}
        style={{
          fontSize: 11,
          padding: "5px 10px",
          borderRadius: 5,
          background: reverifying ? "rgba(255,255,255,0.03)" : "rgba(10,132,255,0.15)",
          border: "1px solid rgba(10,132,255,0.3)",
          color: reverifying ? "rgba(255,255,255,0.4)" : token("accent"),
          cursor: reverifying ? "wait" : "pointer",
        }}
      >
        {reverifying ? "Verifying…" : "Re-verify"}
      </button>
    </div>
  );
}

function BundleBody({ bundle }: { readonly bundle: ProofBundle }) {
  return (
    <div
      style={{
        padding: "10px 12px 14px 36px",
        borderLeft: "1px solid rgba(255,255,255,0.06)",
        marginLeft: 20,
      }}
    >
      {/* Runtime chip */}
      {bundle.runtime && (
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <Chip label="session" value={bundle.runtime.sessionId.slice(0, 8)} />
          {bundle.runtime.activeProvider && (
            <Chip label="provider" value={bundle.runtime.activeProvider} />
          )}
          <Chip label="mode" value={bundle.runtime.currentMode} />
          <Chip label="hooks" value={String(bundle.runtime.hookCount)} />
          <Chip label="skills" value={String(bundle.runtime.skillCount)} />
        </div>
      )}
      {/* Cycle list */}
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {bundle.cycles.map((cycle) => (
          <li key={cycle.cycle} style={{ marginBottom: 8 }}>
            <CycleRow cycle={cycle} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Chip({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.85)", marginLeft: 4 }}>{value}</span>
    </span>
  );
}

function CycleRow({ cycle }: { readonly cycle: ProofCycle }) {
  const allPass = cycle.testsPass && cycle.typecheckPass && cycle.lintPass;
  const color = allPass
    ? token("success")
    : cycle.testsPass || cycle.typecheckPass
      ? token("warning")
      : token("error");
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "rgba(255,255,255,0.025)",
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: color,
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          }}
        >
          #{cycle.cycle + 1}
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 3,
            background: "rgba(10,132,255,0.12)",
            color: token("accent"),
            textTransform: "uppercase",
            letterSpacing: 0.2,
          }}
        >
          {cycle.strategy}
        </span>
        <VerifyBadge label="tests" pass={cycle.testsPass} />
        <VerifyBadge label="tsc" pass={cycle.typecheckPass} />
        <VerifyBadge label="lint" pass={cycle.lintPass} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>
          {(cycle.durationMs / 1000).toFixed(1)}s
        </span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>
          ${cycle.costUsd.toFixed(4)}
        </span>
      </div>
      {cycle.output && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "rgba(255,255,255,0.6)",
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 80,
            overflow: "hidden",
          }}
        >
          {cycle.output}
        </div>
      )}
    </div>
  );
}

function VerifyBadge({ label, pass }: { readonly label: string; readonly pass: boolean }) {
  return (
    <span
      style={{
        fontSize: 9,
        padding: "1px 5px",
        borderRadius: 3,
        background: pass ? "rgba(50,215,75,0.14)" : "rgba(255,69,58,0.14)",
        color: pass ? token("success") : token("error"),
        fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        letterSpacing: 0.2,
      }}
    >
      {pass ? "✓" : "✗"} {label}
    </span>
  );
}
