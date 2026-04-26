/**
 * The Well — shadow-git timeline scrubber.
 *
 * Design spec §5.3 (UI_DESIGN_SPEC_2026-04-16): pinned 48px ribbon at the
 * bottom of the editor (toggleable via ⌘⇧T). Horizontal sequence of
 * vertical rune-ticks, one per shadow-git commit, colored by event type:
 * ᚱ (reads), ᚲ (creates), ᚷ (grants/permissions), ᛉ (edits — Algiz
 * protection), ᚨ (agent messages), ᚠ (file writes), ◆ (tool milestone),
 * ᛗ (memory events), ᛒ (branch / decision).
 *
 * Scrub `▼` left → editor and chat rewind. Release → "rewind to here?"
 * prompt with Restore (forks branch) vs Inspect only (read-only overlay).
 *
 * This is a presentation component — it receives checkpoints from the
 * parent and emits scrub/restore events via callbacks. Backend wiring
 * (`shadow.checkpoints` RPC → checkpoints prop, `shadow.undo` on
 * restore) lives in the caller.
 */

import { useMemo, useState, type JSX } from "react";
import { color } from "../../design/tokens.generated";

// ── Types ────────────────────────────────────────────────────────

export type WellEventKind =
  | "read"
  | "create"
  | "grant"
  | "edit"
  | "message"
  | "write"
  | "milestone"
  | "memory"
  | "branch";

export interface WellCheckpoint {
  readonly sha: string;
  readonly timestamp: number;
  readonly kind: WellEventKind;
  readonly label?: string;
}

export interface WellProps {
  readonly checkpoints: readonly WellCheckpoint[];
  readonly onInspect?: (sha: string) => void;
  readonly onRestore?: (sha: string) => void;
  readonly className?: string;
}

// ── Rune glyphs ──────────────────────────────────────────────────

const RUNE: Record<WellEventKind, string> = {
  read: "ᚱ",       // Raidho — journey / read trajectory
  create: "ᚲ",     // Kenaz — flame / new thing ignited
  grant: "ᚷ",      // Gebo — gift / permission granted
  edit: "ᛉ",       // Algiz — protection / change under watch
  message: "ᚨ",    // Ansuz — messenger / agent spoke
  write: "ᚠ",      // Fehu — wealth / file written
  milestone: "◆",  // lozenge — notable tool completion
  memory: "ᛗ",     // Mannaz — self / memory committed
  branch: "ᛒ",     // Berkano — growth / branch point
};

const COLOR: Record<WellEventKind, string> = {
  read: "rgba(102, 217, 239, 0.5)",       // cyan, dim
  create: "rgba(255, 168, 67, 1)",         // gold, vivid
  grant: "rgba(76, 195, 138, 0.9)",       // moss
  edit: "rgba(255, 210, 154, 0.9)",        // amber
  message: "rgba(233, 220, 186, 0.6)",     // cream, dim
  write: "rgba(255, 168, 67, 1)",          // gold, vivid
  milestone: "rgba(255, 230, 160, 1)",     // pale gold
  memory: "rgba(138, 176, 224, 0.8)",     // slate blue
  branch: "rgba(229, 72, 77, 0.7)",       // blood, dim
};

// ── Component ────────────────────────────────────────────────────

export function Well({
  checkpoints,
  onInspect,
  onRestore,
  className,
}: WellProps): JSX.Element {
  const [scrubbingAt, setScrubbingAt] = useState<string | null>(null);
  const [confirmingRestoreOf, setConfirmingRestoreOf] = useState<string | null>(null);

  // Sort checkpoints chronologically (oldest → newest) so the scrubber
  // reads left-to-right. Memoised so callers can pass unsorted arrays.
  const sorted = useMemo(
    () => [...checkpoints].sort((a, b) => a.timestamp - b.timestamp),
    [checkpoints],
  );

  // Group adjacent checkpoints within 2s into visual clusters so bursts
  // don't render as unreadable stacks of ticks.
  const clusters = useMemo(() => buildClusters(sorted), [sorted]);

  if (sorted.length === 0) {
    return (
      <div
        className={className}
        role="region"
        aria-label="Shadow-git timeline"
        style={{
          height: 48,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "var(--color-text-dim, rgba(138,176,224,0.35))",
          borderTop: "1px solid var(--border-subtle, rgba(138,176,224,0.08))",
          background: "var(--surface-1, rgba(138,176,224,0.02))",
        }}
      >
        No shadow-git checkpoints yet — The Well reflects your work here.
      </div>
    );
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstLabel = first ? formatTime(first.timestamp) : "";
  const lastLabel = last ? formatTime(last.timestamp) : "";

  return (
    <div
      className={className}
      role="region"
      aria-label="Shadow-git timeline"
      style={{
        height: 56,
        padding: "8px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        borderTop: "1px solid var(--border-subtle, rgba(138,176,224,0.08))",
        background: "var(--surface-1, rgba(138,176,224,0.02))",
        fontFamily: "var(--wotann-font-sans, 'Inter Variable', system-ui)",
        position: "relative",
      }}
    >
      <div
        style={{
          flex: "1 1 auto",
          display: "flex",
          alignItems: "center",
          gap: 2,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
        }}
      >
        {clusters.map((cluster, i) => (
          <WellCluster
            key={cluster.members[0]?.sha ?? `c-${i}`}
            cluster={cluster}
            hovered={scrubbingAt ? cluster.members.some((c) => c.sha === scrubbingAt) : false}
            onHover={(sha) => setScrubbingAt(sha)}
            onLeave={() => setScrubbingAt(null)}
            onClick={(sha) => setConfirmingRestoreOf(sha)}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 9,
          color: color("muted"),
          letterSpacing: "0.02em",
        }}
      >
        <span>{firstLabel}</span>
        <span style={{ opacity: 0.7 }}>
          {sorted.length} checkpoint{sorted.length === 1 ? "" : "s"} · ▼ now
        </span>
        <span>{lastLabel}</span>
      </div>

      {/* Restore confirmation popover */}
      {confirmingRestoreOf && (
        <RestoreConfirm
          sha={confirmingRestoreOf}
          onDismiss={() => setConfirmingRestoreOf(null)}
          onInspect={onInspect ? () => {
            onInspect(confirmingRestoreOf);
            setConfirmingRestoreOf(null);
          } : undefined}
          onRestore={onRestore ? () => {
            onRestore(confirmingRestoreOf);
            setConfirmingRestoreOf(null);
          } : undefined}
        />
      )}
    </div>
  );
}

// ── Cluster helpers ──────────────────────────────────────────────

interface Cluster {
  readonly members: readonly WellCheckpoint[];
  readonly start: number;
  readonly end: number;
}

function buildClusters(sorted: readonly WellCheckpoint[]): readonly Cluster[] {
  if (sorted.length === 0) return [];
  const CLUSTER_WINDOW_MS = 2000;
  const clusters: Cluster[] = [];
  let current: WellCheckpoint[] = [];
  let clusterStart = 0;
  for (const ck of sorted) {
    if (current.length === 0) {
      current.push(ck);
      clusterStart = ck.timestamp;
      continue;
    }
    if (ck.timestamp - clusterStart <= CLUSTER_WINDOW_MS) {
      current.push(ck);
    } else {
      clusters.push({ members: current, start: clusterStart, end: current[current.length - 1]?.timestamp ?? clusterStart });
      current = [ck];
      clusterStart = ck.timestamp;
    }
  }
  if (current.length > 0) {
    clusters.push({ members: current, start: clusterStart, end: current[current.length - 1]?.timestamp ?? clusterStart });
  }
  return clusters;
}

function WellCluster({
  cluster,
  hovered,
  onHover,
  onLeave,
  onClick,
}: {
  cluster: Cluster;
  hovered: boolean;
  onHover: (sha: string) => void;
  onLeave: () => void;
  onClick: (sha: string) => void;
}): JSX.Element {
  if (cluster.members.length === 1) {
    const ck = cluster.members[0]!;
    return (
      <WellTick
        checkpoint={ck}
        hovered={hovered}
        onMouseEnter={() => onHover(ck.sha)}
        onMouseLeave={onLeave}
        onClick={() => onClick(ck.sha)}
      />
    );
  }
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1,
        padding: "0 2px",
        borderRadius: "var(--radius-xs)",
        background: hovered ? "rgba(255,168,67,0.08)" : "transparent",
        transition: "background 120ms ease",
      }}
    >
      {cluster.members.map((ck) => (
        <WellTick
          key={ck.sha}
          checkpoint={ck}
          hovered={hovered}
          onMouseEnter={() => onHover(ck.sha)}
          onMouseLeave={onLeave}
          onClick={() => onClick(ck.sha)}
        />
      ))}
    </div>
  );
}

function WellTick({
  checkpoint,
  hovered,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  checkpoint: WellCheckpoint;
  hovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}): JSX.Element {
  const color = COLOR[checkpoint.kind];
  const glyph = RUNE[checkpoint.kind];
  const label = checkpoint.label ?? `${checkpoint.kind} · ${checkpoint.sha.slice(0, 7)}`;
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      title={`${label} · ${formatTime(checkpoint.timestamp)}`}
      aria-label={`Shadow-git checkpoint ${checkpoint.sha.slice(0, 7)} — ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 24,
        padding: 0,
        fontFamily: "var(--wotann-font-rune, 'Noto Sans Runic', system-ui)",
        fontSize: 12,
        fontWeight: 600,
        color,
        background: "transparent",
        border: "none",
        borderRadius: 2,
        cursor: "pointer",
        opacity: hovered ? 1 : 0.78,
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        transition: "transform 120ms ease, opacity 120ms ease",
        lineHeight: 1,
      }}
    >
      {glyph}
    </button>
  );
}

// ── Restore confirmation ─────────────────────────────────────────

function RestoreConfirm({
  sha,
  onDismiss,
  onInspect,
  onRestore,
}: {
  sha: string;
  onDismiss: () => void;
  onInspect?: () => void;
  onRestore?: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Rewind to checkpoint ${sha.slice(0, 7)}`}
      style={{
        position: "absolute",
        bottom: 60,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "10px 14px",
        background: color("background"),
        border: "1px solid var(--border-subtle, rgba(138,176,224,0.15))",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,168,67,0.06)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 12,
        color: color("text"),
        whiteSpace: "nowrap",
        zIndex: 100,
      }}
    >
      <span>
        Rewind to{" "}
        <span
          style={{
            fontFamily: "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)",
            color: color("warning"),
          }}
        >
          {sha.slice(0, 7)}
        </span>
        ?
      </span>
      {onInspect && (
        <button
          type="button"
          onClick={onInspect}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            color: color("muted"),
            background: "transparent",
            border: "1px solid var(--border-subtle, rgba(138,176,224,0.15))",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          Inspect
        </button>
      )}
      {onRestore && (
        <button
          type="button"
          onClick={onRestore}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            color: color("background"),
            background: color("warning"),
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          Restore
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          padding: "4px 8px",
          fontSize: 11,
          color: color("muted"),
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = d.getHours();
  const mm = d.getMinutes();
  const suffix = hh >= 12 ? "pm" : "am";
  const h = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${h}:${mm.toString().padStart(2, "0")}${suffix}`;
}
