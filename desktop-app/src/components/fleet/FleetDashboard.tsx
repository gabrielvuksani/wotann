/**
 * FleetDashboard — V9 T5.12 (F15).
 *
 * Real-time view of all parallel agent sessions currently running on
 * the paired WOTANN daemon. Calls `fleet.view` for an initial
 * snapshot, then subscribes to `fleet.watch` (SSE) for live updates
 * so cost + progress stream in without polling.
 *
 * DESIGN NOTES
 * - Immutable state: all snapshots are frozen and replaced whole, not
 *   mutated. Same rule as the Zustand store uses elsewhere.
 * - Per-component state: no module-global singleton. Multiple
 *   FleetDashboard instances (e.g. in a split-view) each own their
 *   own subscription and snapshot.
 * - Honest stubs: fetch errors surface via `errorMessage`. We do not
 *   silently swallow — a crashed daemon must be visible to the user.
 * - Forward-compat: unknown payload shapes are logged and dropped
 *   instead of throwing, matching sse-consumer's QB #12 rule.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

// ── Types ───────────────────────────────────────────────────

/**
 * A single agent session in the fleet. Matches the
 * `fleet.view` response shape from `kairos-rpc.ts`.
 */
export interface FleetAgent {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly model: string;
  readonly status: "queued" | "running" | "paused" | "completed" | "failed";
  readonly progress: number; // 0..1
  readonly cost: number;     // USD
  readonly startedAt: number; // epoch ms
  readonly lastActivityAt?: number;
}

export interface FleetDashboardProps {
  /**
   * Base URL of the WOTANN daemon. Defaults to
   * `http://localhost:7531` — the same default useComputerSession
   * uses.
   */
  readonly baseUrl?: string;
  /**
   * Called when the user clicks a fleet row. The parent is expected
   * to navigate to that session. Optional — if omitted, clicks are
   * inert (the list becomes read-only).
   */
  readonly onSelect?: (agent: FleetAgent) => void;
  /**
   * Injected fetch for testability. Defaults to `globalThis.fetch`.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Injected EventSource factory for testability.
   */
  readonly eventSourceFactory?: (url: string) => EventSource;
}

// ── Constants ───────────────────────────────────────────────

const DEFAULT_BASE_URL = "http://localhost:7531";
const FLEET_VIEW_PATH = "/rpc/fleet.view";
const FLEET_WATCH_PATH = "/events/fleet";

// ── Component ───────────────────────────────────────────────

export function FleetDashboard(props: FleetDashboardProps): ReactElement {
  const baseUrl = props.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = props.fetchImpl ?? globalThis.fetch;
  const esFactory = props.eventSourceFactory;

  const [agents, setAgents] = useState<readonly FleetAgent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const esRef = useRef<EventSource | null>(null);

  // ── Initial snapshot ──────────────────────────────────────
  const loadSnapshot = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const res = await fetchImpl(`${baseUrl}${FLEET_VIEW_PATH}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`fleet.view returned ${res.status}`);
      }
      const body = (await res.json()) as
        | { agents?: readonly FleetAgent[] }
        | readonly FleetAgent[];
      const parsed: readonly FleetAgent[] = Array.isArray(body)
        ? (body as readonly FleetAgent[])
        : ((body as { agents?: readonly FleetAgent[] }).agents ?? []);
      setAgents(Object.freeze(parsed.slice()));
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Unknown error loading fleet",
      );
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, fetchImpl]);

  // ── Live watch ─────────────────────────────────────────────
  const openWatch = useCallback((): void => {
    const url = `${baseUrl}${FLEET_WATCH_PATH}`;
    const factory =
      esFactory ??
      ((u: string): EventSource => {
        const ctor = (globalThis as unknown as {
          EventSource?: new (u: string) => EventSource;
        }).EventSource;
        if (!ctor) {
          throw new Error("EventSource unavailable");
        }
        return new ctor(u);
      });

    let es: EventSource;
    try {
      es = factory(url);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not open fleet stream",
      );
      return;
    }
    esRef.current = es;

    es.addEventListener("message", (evt: MessageEvent) => {
      const raw = evt.data;
      if (typeof raw !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Malformed frame — drop. sse-consumer.ts uses the same rule.
        return;
      }
      applyUpdate(parsed, setAgents);
    });

    es.addEventListener("error", () => {
      // The browser auto-reconnects the EventSource. We expose the
      // error via errorMessage but keep the stream open — a flicker
      // should not clear the whole UI.
      setErrorMessage("Fleet stream interrupted — reconnecting...");
    });

    es.addEventListener("open", () => {
      setErrorMessage(null);
    });
  }, [baseUrl, esFactory]);

  // ── Lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    void loadSnapshot();
    openWatch();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [loadSnapshot, openWatch]);

  // ── Derived stats ──────────────────────────────────────────
  const stats = useMemo(() => {
    const running = agents.filter((a) => a.status === "running").length;
    const completed = agents.filter((a) => a.status === "completed").length;
    const failed = agents.filter((a) => a.status === "failed").length;
    const totalCost = agents.reduce((sum, a) => sum + a.cost, 0);
    return { running, completed, failed, totalCost };
  }, [agents]);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full" data-testid="fleet-dashboard">
      <header
        className="border-b"
        style={{
          borderColor: "var(--border-subtle)",
          padding: "var(--space-md)",
        }}
      >
        <h2
          style={{
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            margin: 0,
          }}
        >
          Fleet
        </h2>
        <div
          style={{
            marginTop: "var(--space-xs)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-secondary)",
          }}
        >
          {stats.running} running · {stats.completed} done · {stats.failed} failed ·
          {" "}
          ${stats.totalCost.toFixed(4)}
        </div>
      </header>

      {errorMessage && (
        <div
          role="alert"
          data-testid="fleet-error"
          style={{
            margin: "var(--space-sm)",
            padding: "var(--space-sm)",
            background: "var(--color-error-bg, rgba(255, 0, 0, 0.08))",
            color: "var(--color-error, #ff5a5a)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {errorMessage}
        </div>
      )}

      {isLoading && agents.length === 0 ? (
        <div
          style={{
            padding: "var(--space-lg)",
            color: "var(--color-text-secondary)",
          }}
        >
          Loading fleet…
        </div>
      ) : agents.length === 0 ? (
        <div
          data-testid="fleet-empty"
          style={{
            padding: "var(--space-lg)",
            color: "var(--color-text-secondary)",
          }}
        >
          No active agents.
        </div>
      ) : (
        <ul
          data-testid="fleet-list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {agents.map((agent) => (
            <FleetRow
              key={agent.id}
              agent={agent}
              onSelect={props.onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────

interface FleetRowProps {
  readonly agent: FleetAgent;
  readonly onSelect?: (agent: FleetAgent) => void;
}

function FleetRow({ agent, onSelect }: FleetRowProps): ReactElement {
  const clickable = typeof onSelect === "function";
  const Tag = clickable ? "button" : "div";

  return (
    <li
      data-testid={`fleet-row-${agent.id}`}
      style={{
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <Tag
        type={clickable ? "button" : undefined}
        onClick={clickable ? () => onSelect!(agent) : undefined}
        style={{
          width: "100%",
          background: "transparent",
          border: 0,
          textAlign: "left",
          cursor: clickable ? "pointer" : "default",
          padding: "var(--space-sm) var(--space-md)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          color: "var(--color-text-primary)",
          font: "inherit",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: statusDotColor(agent.status),
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.title}
          </span>
          <span
            style={{
              display: "block",
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {agent.provider} · {agent.model} · {agent.status}
          </span>
        </span>
        <span
          style={{
            width: 100,
            height: 4,
            background: "var(--color-surface-alt)",
            borderRadius: 2,
            overflow: "hidden",
            flexShrink: 0,
          }}
          aria-hidden
        >
          <span
            style={{
              display: "block",
              width: `${Math.min(100, Math.max(0, agent.progress * 100))}%`,
              height: "100%",
              background: "var(--color-primary)",
            }}
          />
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-secondary)",
            width: 72,
            textAlign: "right",
          }}
        >
          ${agent.cost.toFixed(4)}
        </span>
      </Tag>
    </li>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function statusDotColor(status: FleetAgent["status"]): string {
  switch (status) {
    case "running":   return "var(--color-primary, #7b5cff)";
    case "completed": return "var(--color-success, #34c759)";
    case "failed":    return "var(--color-error, #ff5a5a)";
    case "paused":    return "var(--color-warning, #ff9f0a)";
    default:          return "var(--color-text-tertiary, #666)";
  }
}

/**
 * Apply an incoming `fleet.watch` frame to the agents list. Exported
 * so tests can exercise the reducer without mounting the component.
 *
 * Wire shape (mirrors kairos-rpc.ts):
 *   { type: "snapshot", agents: FleetAgent[] }
 *   { type: "upsert",   agent:  FleetAgent }
 *   { type: "remove",   id:     string }
 *
 * Unknown shapes are dropped (forward-compat).
 */
export function applyUpdate(
  payload: unknown,
  setAgents: (next: (prev: readonly FleetAgent[]) => readonly FleetAgent[]) => void,
): void {
  if (!payload || typeof payload !== "object") return;
  const obj = payload as Record<string, unknown>;
  const type = typeof obj["type"] === "string" ? (obj["type"] as string) : "upsert";

  if (type === "snapshot" && Array.isArray(obj["agents"])) {
    const next = (obj["agents"] as readonly FleetAgent[]).slice();
    setAgents(() => Object.freeze(next));
    return;
  }

  if (type === "upsert" && obj["agent"] && typeof obj["agent"] === "object") {
    const agent = obj["agent"] as FleetAgent;
    if (typeof agent.id !== "string") return;
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.id === agent.id);
      const next = prev.slice();
      if (idx >= 0) {
        next[idx] = agent;
      } else {
        next.unshift(agent);
      }
      return Object.freeze(next);
    });
    return;
  }

  if (type === "remove" && typeof obj["id"] === "string") {
    const id = obj["id"] as string;
    setAgents((prev) => Object.freeze(prev.filter((a) => a.id !== id)));
    return;
  }
}
