/**
 * Shared utilities, types, and components for Intelligence Dashboard cards.
 */

import { commands } from "../../hooks/useTauriCommand";

// ── RPC helper ────────────────────────────────────────

interface JsonRpcResponse {
  readonly jsonrpc: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
  readonly id: number;
}

export async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const response = await commands.sendMessage(
    JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  );
  if (!response) return null;
  try {
    const parsed = JSON.parse(response) as JsonRpcResponse;
    return parsed.result ?? null;
  } catch {
    return null;
  }
}

// ── Domain types (readonly, strict) ───────────────────

export interface HealthReport {
  readonly score: number;
  readonly issues: readonly { readonly message: string; readonly severity: string }[];
}

export interface FlowInsights {
  readonly recentActions: readonly { readonly action: string; readonly velocity: number }[];
  readonly struggling: boolean;
  readonly hotspots: readonly string[];
}

export interface Decision {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly status: "active" | "superseded" | "reverted";
  readonly timestamp: number;
}

export interface PWRStatus {
  readonly phase: string;
  readonly phases: readonly string[];
}

export interface AmbientStatus {
  readonly signals: readonly { readonly type: string; readonly count: number }[];
  readonly latestSuggestion: string | null;
  readonly latestSuggestionAt: number | null;
}

export interface Trigger {
  readonly id: string;
  readonly event: string;
  readonly action: string;
  readonly enabled: boolean;
}

export interface DeviceContext {
  readonly devices: readonly {
    readonly type: string;
    readonly connected: boolean;
    readonly lastSync: number | null;
  }[];
}

export interface IdleStatus {
  readonly idleSince: number | null;
  readonly lastActivity: number | null;
  readonly durationMs: number;
}

export interface SpecDivergence {
  readonly status: "synced" | "diverged" | "unknown";
  readonly divergences: readonly {
    readonly description: string;
    readonly severity: "low" | "medium" | "high";
  }[];
}

export interface FileSearchResult {
  readonly path: string;
  readonly score: number;
}

// ── Shared card wrapper ───────────────────────────────

export function Card({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#1C1C1E",
        border: "1px solid var(--border-subtle)",
        borderRadius: 12,
        padding: "var(--space-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        minHeight: 160,
      }}
    >
      <h3
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          margin: 0,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────

export function StatusBadge({ text, color }: { readonly text: string; readonly color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--font-size-2xs)",
        fontWeight: 500,
        background: `${color}18`,
        color,
        border: `1px solid ${color}30`,
      }}
    >
      {text}
    </span>
  );
}

// ── Time formatting ───────────────────────────────────

export function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
