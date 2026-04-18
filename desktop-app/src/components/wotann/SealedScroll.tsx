/**
 * Sealed Scroll — proof-bundle materialisation at task completion.
 *
 * Design spec §4.3: on task completion, the proof bundle appears as a
 * vellum-textured card that unrolls from the bottom of the conversation
 * (height 0→auto, 420ms). Four seals in a horizontal row — Tests, Typecheck,
 * Diff, Screenshots — each a 32×32 wax-seal SVG with state:
 *   empty circle (pending) · spinning rune (running) · solid gold (passed)
 *   · cracked red (failed).
 *
 * Clicking the scroll icon exports the bundle as a single Markdown file
 * with embedded SHAs.
 */

import { useId, type JSX } from "react";

// ── Types ────────────────────────────────────────────────────────

export type SealState = "pending" | "running" | "passed" | "failed" | "skipped";

export interface ProofSeal {
  readonly kind: "tests" | "typecheck" | "diff" | "screenshots" | string;
  readonly state: SealState;
  /** Short one-line summary (e.g. "3923/3933 passed") */
  readonly detail?: string;
  /** SHA prefix for the artifact (e.g. git SHA, log hash). */
  readonly sha?: string;
}

export interface SealedScrollProps {
  /** 3-6 seals. Order is left-to-right. */
  readonly seals: readonly ProofSeal[];
  /** Proof bundle ID — used as the filename root on export. */
  readonly bundleId: string;
  /** Called when user clicks the scroll icon to export. */
  readonly onExport?: (bundleId: string) => void;
  readonly className?: string;
}

// ── Seal glyphs (kind-specific sigils) ───────────────────────────

const SEAL_ICON: Record<string, string> = {
  tests: "ᛏ",      // Tiwaz — victory / justice
  typecheck: "ᛒ",  // Berkano — growth / structure
  diff: "ᛞ",       // Dagaz — day / clarity
  screenshots: "ᛉ", // Algiz — protection / witness
};

const STATE_COLOR: Record<SealState, string> = {
  pending: "var(--color-text-dim, rgba(138,176,224,0.35))",
  running: "var(--wotann-rune-cyan, #66D9EF)",
  passed: "var(--wotann-rune-gold, #FFA843)",
  failed: "var(--wotann-rune-blood, #E5484D)",
  skipped: "var(--color-text-muted, #9FB1C8)",
};

const STATE_BG: Record<SealState, string> = {
  pending: "rgba(138,176,224,0.04)",
  running: "rgba(102,217,239,0.1)",
  passed: "rgba(255,168,67,0.12)",
  failed: "rgba(229,72,77,0.12)",
  skipped: "rgba(138,176,224,0.04)",
};

// ── Main component ───────────────────────────────────────────────

export function SealedScroll({
  seals,
  bundleId,
  onExport,
  className,
}: SealedScrollProps): JSX.Element {
  const allDone = seals.every((s) => s.state !== "pending" && s.state !== "running");
  const anyFailed = seals.some((s) => s.state === "failed");
  const overallColor = anyFailed
    ? "var(--wotann-rune-blood, #E5484D)"
    : allDone
    ? "var(--wotann-rune-gold, #FFA843)"
    : "var(--wotann-rune-cyan, #66D9EF)";

  return (
    <div
      className={className}
      role="region"
      aria-label={`Proof bundle ${bundleId}`}
      style={{
        position: "relative",
        padding: 16,
        borderRadius: 14,
        border: `1px solid ${anyFailed ? "rgba(229,72,77,0.3)" : "rgba(255,168,67,0.15)"}`,
        background: "linear-gradient(180deg, rgba(255,248,240,0.02) 0%, rgba(255,248,240,0.05) 100%)",
        boxShadow: anyFailed
          ? "0 4px 12px rgba(229,72,77,0.15)"
          : allDone
          ? "0 4px 12px rgba(255,168,67,0.12), inset 0 0 0 1px rgba(255,168,67,0.08)"
          : "0 4px 12px rgba(0,0,0,0.25)",
        animation: allDone
          ? "wotann-scroll-unroll 420ms cubic-bezier(0.16, 1, 0.3, 1) both"
          : undefined,
        fontFamily: "var(--wotann-font-sans, 'Inter Variable', system-ui)",
      }}
    >
      {/* Header with export affordance */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              background: `linear-gradient(135deg, ${overallColor} 0%, ${overallColor}aa 100%)`,
              boxShadow: `0 0 8px ${overallColor}66`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontFamily: "var(--wotann-font-rune, 'Noto Sans Runic', system-ui)",
              color: "#0C1118",
              fontWeight: 700,
            }}
          >
            ᚦ
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>
            {anyFailed
              ? "Proof bundle — failed"
              : allDone
              ? "Proof bundle — sealed"
              : "Proof bundle — in flight"}
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)",
              color: "var(--color-text-muted, #9FB1C8)",
              padding: "2px 6px",
              background: "rgba(138,176,224,0.06)",
              borderRadius: 4,
            }}
          >
            {bundleId}
          </span>
        </div>
        {onExport && allDone && (
          <button
            type="button"
            onClick={() => onExport(bundleId)}
            aria-label={`Export proof bundle ${bundleId} as Markdown`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 500,
              color: overallColor,
              background: "rgba(255,168,67,0.06)",
              border: `1px solid ${overallColor}33`,
              borderRadius: 6,
              cursor: "pointer",
              transition: "background 120ms ease",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 12 }}>📜</span>
            <span>Export</span>
          </button>
        )}
      </div>

      {/* Seal strip */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {seals.map((seal) => (
          <SealChip key={seal.kind} seal={seal} />
        ))}
      </div>
    </div>
  );
}

// ── Individual seal chip ─────────────────────────────────────────

function SealChip({ seal }: { seal: ProofSeal }): JSX.Element {
  const titleId = useId();
  const color = STATE_COLOR[seal.state];
  const bg = STATE_BG[seal.state];
  const icon = SEAL_ICON[seal.kind] ?? "ᚱ";

  const stateLabel: Record<SealState, string> = {
    pending: "pending",
    running: "running",
    passed: "passed",
    failed: "failed",
    skipped: "skipped",
  };

  return (
    <div
      role="status"
      aria-labelledby={titleId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background: bg,
        border: `1px solid ${color}44`,
        borderRadius: 8,
        fontSize: 12,
        color: color,
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          border: seal.state === "passed" ? "none" : `1px ${seal.state === "failed" ? "dashed" : "solid"} ${color}`,
          background: seal.state === "passed" ? color : "transparent",
          color: seal.state === "passed" ? "#0C1118" : color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--wotann-font-rune, 'Noto Sans Runic', system-ui)",
          fontSize: 14,
          fontWeight: 700,
          animation:
            seal.state === "running"
              ? "wotann-seal-spin var(--wotann-duration-valknut, 1600ms) var(--wotann-ease-standard, cubic-bezier(0.4, 0.14, 0.3, 1)) infinite"
              : undefined,
        }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span id={titleId} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontWeight: 600, textTransform: "capitalize", lineHeight: 1.2 }}>
          {seal.kind} — {stateLabel[seal.state]}
        </span>
        {seal.detail && (
          <span
            style={{
              fontSize: 10,
              color: "var(--color-text-muted, #9FB1C8)",
              lineHeight: 1.3,
              fontFamily: seal.kind === "typecheck" || seal.kind === "tests"
                ? "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)"
                : undefined,
            }}
          >
            {seal.detail}
          </span>
        )}
      </span>
    </div>
  );
}

// ── Keyframes (injected once) ────────────────────────────────────

const KF_ID = "wotann-sealedscroll-keyframes";
if (typeof document !== "undefined" && !document.getElementById(KF_ID)) {
  const style = document.createElement("style");
  style.id = KF_ID;
  style.textContent = `
@keyframes wotann-scroll-unroll {
  from { max-height: 0; opacity: 0; transform: translateY(-4px); }
  to { max-height: 400px; opacity: 1; transform: translateY(0); }
}
@keyframes wotann-seal-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes wotann-scroll-unroll { from, to { max-height: 400px; opacity: 1; transform: none; } }
  @keyframes wotann-seal-spin { from, to { transform: none; } }
}
`;
  document.head.appendChild(style);
}
