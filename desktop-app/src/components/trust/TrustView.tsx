/**
 * TrustView — Trust UI panel container.
 *
 * Three tabs: Proofs / Provenance / Verification.
 *  - Proofs: list of proof bundles; click opens detail in a 40/60 split.
 *  - Provenance: current system prompt with per-line source attribution.
 *  - Verification: chronological verification event history.
 *
 * Design: token-backed accent + surface/bg from design/tokens.generated,
 * SF Pro via inline fontFamily. Each child catches RPC errors and shows
 * an empty state rather than crashing.
 */

import { useState } from "react";
import { ProofBundleList } from "./ProofBundleList";
import { ProofBundleDetail } from "./ProofBundleDetail";
import { ProvenanceViewer } from "./ProvenanceViewer";
import { VerificationTimeline } from "./VerificationTimeline";
import { color } from "../../design/tokens.generated";

// ── Shared design tokens ─────────────────────────────────

export const TRUST_COLORS = {
  accent: color("accent"),
  bg: color("background"),
  surface: color("surface"),
  divider: "rgba(255,255,255,0.08)",
  success: color("success"),
  error: color("error"),
  warning: color("warning"),
  textPrimary: color("text"),
  textDim: "rgba(235,235,245,0.6)",
  textGhost: "rgba(235,235,245,0.3)",
} as const;

export const TRUST_FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif";

// ── RPC helper ───────────────────────────────────────────

interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
  readonly id?: number;
}

/** Call a JSON-RPC method on the daemon. Returns `null` on any failure. */
export async function trustRpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    const mod = await import("../../hooks/useTauriCommand");
    const raw = await mod.commands.sendMessage(
      JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JsonRpcResponse;
    if (parsed.error) return null;
    return parsed.result ?? null;
  } catch {
    return null;
  }
}

// ── Shared proof bundle types ────────────────────────────

export interface ProofBundleSummary {
  readonly id: string;
  readonly action: string;
  readonly timestamp: number;
  readonly verification: "pass" | "fail" | "partial";
  readonly cost?: number;
}

export interface ProofBundleFull extends ProofBundleSummary {
  readonly task?: string;
  readonly start?: number;
  readonly end?: number;
  readonly durationMs?: number;
  readonly fileEdits?: readonly {
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }[];
  readonly toolCalls?: readonly {
    readonly name: string;
    readonly durationMs: number;
    readonly ok: boolean;
  }[];
  readonly evidence?: readonly {
    readonly kind: string;
    readonly status: "pass" | "fail" | "partial";
    readonly summary: string;
  }[];
}

// ── Tabs ─────────────────────────────────────────────────

type TrustTab = "proofs" | "provenance" | "verification";

const TABS: readonly { readonly id: TrustTab; readonly label: string }[] = [
  { id: "proofs", label: "Proofs" },
  { id: "provenance", label: "Provenance" },
  { id: "verification", label: "Verification" },
];

export function TrustView() {
  const [activeTab, setActiveTab] = useState<TrustTab>("proofs");
  const [selected, setSelected] = useState<ProofBundleSummary | null>(null);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: TRUST_COLORS.bg,
        color: TRUST_COLORS.textPrimary,
        fontFamily: TRUST_FONT,
        overflow: "hidden",
      }}
      role="region"
      aria-label="Trust panel"
    >
      <TabBar activeTab={activeTab} onChange={setActiveTab} />
      <div
        className="flex-1 overflow-hidden"
        role="tabpanel"
        aria-label={`${activeTab} panel`}
      >
        {activeTab === "proofs" && (
          <div
            className="h-full"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(280px, 40%) 1fr",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                borderRight: `1px solid ${TRUST_COLORS.divider}`,
                overflow: "auto",
                minWidth: 0,
              }}
            >
              <ProofBundleList selected={selected} onSelect={setSelected} />
            </div>
            <div style={{ overflow: "auto", minWidth: 0 }}>
              <ProofBundleDetail bundle={selected} />
            </div>
          </div>
        )}
        {activeTab === "provenance" && <ProvenanceViewer />}
        {activeTab === "verification" && <VerificationTimeline />}
      </div>
    </div>
  );
}

// ── Tab bar with sliding underline ───────────────────────

function TabBar({
  activeTab,
  onChange,
}: {
  readonly activeTab: TrustTab;
  readonly onChange: (t: TrustTab) => void;
}) {
  const activeIndex = TABS.findIndex((t) => t.id === activeTab);
  const tabWidthPct = 100 / TABS.length;
  return (
    <div
      className="flex items-center shrink-0 relative"
      style={{
        padding: "0 16px",
        borderBottom: `1px solid ${TRUST_COLORS.divider}`,
        fontFamily: TRUST_FONT,
      }}
      role="tablist"
      aria-label="Trust tabs"
    >
      <div
        className="flex"
        style={{ position: "relative", flex: "1 1 auto", maxWidth: 480 }}
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              style={{
                flex: 1,
                minHeight: 36,
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: isActive
                  ? TRUST_COLORS.textPrimary
                  : TRUST_COLORS.textDim,
                transition: "color 200ms ease",
                fontFamily: "inherit",
              }}
            >
              {tab.label}
            </button>
          );
        })}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: -1,
            left: 0,
            height: 2,
            width: `${tabWidthPct}%`,
            background: TRUST_COLORS.accent,
            borderRadius: 1,
            transform: `translateX(${activeIndex * 100}%)`,
            transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}
