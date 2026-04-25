/**
 * StudioTab — V9 T12.12 Mastra Studio parent.
 *
 * Composes four panels into a single tab:
 *   1. TraceExplorer       — virtual list of trace events
 *   2. MemoryGraphView     — knowledge graph nodes by entity-type
 *   3. ObserverPolicyEditor— JSON editor + validate
 *   4. ReflectorReplayPanel— pick a trace + replay
 *
 * The Mastra backend (trace store, observer engine, reflector
 * replay machinery) is OUT OF SCOPE for this slice. This parent
 * holds local UI state (active sub-tab, current selections) and
 * dispatches everything else through props so a future RPC layer
 * can wire data without modifying the layout.
 *
 * The audit (2026-04-25) flagged this entire surface as missing.
 * This commit lands the surface; data wiring follows.
 *
 * DESIGN NOTES
 * - Per-mount state: every StudioTab instance owns its own active
 *   sub-tab and selections. No module globals.
 * - Honest stubs: when the parent does not supply trace events /
 *   memory nodes / policy / reflector traces, each sub-component
 *   renders its own honest empty state ("No trace events", etc.).
 * - Visual rhythm: matches WorkshopView's tab bar so Studio feels
 *   like a coherent member of the primary-tab family.
 */

import {
  useCallback,
  useState,
  type ReactElement,
} from "react";

import { TraceExplorer, type TraceEvent } from "./TraceExplorer";
import {
  MemoryGraphView,
  type MemoryGraphEdge,
  type MemoryGraphNode,
} from "./MemoryGraphView";
import {
  ObserverPolicyEditor,
  type ObserverPolicy,
  type ValidationResult,
} from "./ObserverPolicyEditor";
import {
  ReflectorReplayPanel,
  type TraceSummary,
} from "./ReflectorReplayPanel";

// ── Types ───────────────────────────────────────────────────

type StudioPanel = "trace" | "graph" | "policy" | "replay";

const PANELS: readonly { readonly id: StudioPanel; readonly label: string }[] = [
  { id: "trace", label: "Trace" },
  { id: "graph", label: "Memory Graph" },
  { id: "policy", label: "Observer Policy" },
  { id: "replay", label: "Replay" },
];

export interface StudioTabProps {
  // Trace explorer
  readonly traceEvents?: readonly TraceEvent[];
  readonly selectedTraceEventId?: string | null;
  readonly onSelectTraceEvent?: (event: TraceEvent) => void;

  // Memory graph
  readonly memoryNodes?: readonly MemoryGraphNode[];
  readonly memoryEdges?: readonly MemoryGraphEdge[];
  readonly selectedMemoryNodeId?: string | null;
  readonly onSelectMemoryNode?: (node: MemoryGraphNode) => void;

  // Observer policy
  readonly observerPolicy?: ObserverPolicy | null;
  readonly onSavePolicy?: (policy: ObserverPolicy) => void;
  readonly onValidatePolicy?: (decoded: unknown) => ValidationResult;
  readonly readOnlyPolicy?: boolean;

  // Reflector replay
  readonly traceSummaries?: readonly TraceSummary[];
  readonly selectedTraceSummaryId?: string | null;
  readonly onSelectTraceSummary?: (id: string | null) => void;
  readonly onReplayTrace?: (trace: TraceSummary) => void;
  readonly replayBusy?: boolean;
}

// ── Component ───────────────────────────────────────────────

export function StudioTab(props: StudioTabProps): ReactElement {
  const [active, setActive] = useState<StudioPanel>("trace");
  const [toolFilter, setToolFilter] = useState<string>("");

  const renderPanel = useCallback((): ReactElement => {
    switch (active) {
      case "trace":
        return (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: "var(--space-sm, 8px) var(--space-md, 12px)",
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm, 8px)",
                flexShrink: 0,
              }}
            >
              <input
                type="text"
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                placeholder="Filter by tool name…"
                aria-label="Filter trace by tool name"
                style={{
                  padding: "4px 10px",
                  fontSize: "var(--font-size-xs, 11px)",
                  fontFamily: "var(--font-mono)",
                  background: "var(--surface-1)",
                  color: "var(--color-text-primary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm, 6px)",
                  flex: 1,
                  minWidth: 200,
                }}
              />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <TraceExplorer
                events={props.traceEvents ?? []}
                selectedId={props.selectedTraceEventId ?? null}
                onSelect={props.onSelectTraceEvent}
                toolFilter={toolFilter}
              />
            </div>
          </div>
        );
      case "graph":
        return (
          <MemoryGraphView
            nodes={props.memoryNodes ?? []}
            edges={props.memoryEdges}
            selectedId={props.selectedMemoryNodeId ?? null}
            onSelect={props.onSelectMemoryNode}
          />
        );
      case "policy":
        return (
          <ObserverPolicyEditor
            initialPolicy={props.observerPolicy ?? null}
            onSave={props.onSavePolicy}
            onValidate={props.onValidatePolicy}
            readOnly={props.readOnlyPolicy === true}
          />
        );
      case "replay":
        return (
          <ReflectorReplayPanel
            traces={props.traceSummaries ?? []}
            selectedId={props.selectedTraceSummaryId ?? null}
            onSelect={props.onSelectTraceSummary}
            onReplay={props.onReplayTrace}
            busy={props.replayBusy === true}
          />
        );
      default:
        return <div />;
    }
  }, [active, props, toolFilter]);

  return (
    <div
      data-testid="studio-tab"
      className="flex-1 flex flex-col h-full overflow-hidden"
    >
      <header
        style={{
          padding: "var(--space-md, 12px) var(--space-md, 12px) var(--space-2xs, 2px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            fontSize: "var(--font-size-lg, 16px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            margin: 0,
          }}
        >
          Mastra Studio
        </h2>
        <p
          style={{
            margin: "var(--space-2xs, 2px) 0 var(--space-sm, 8px) 0",
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
          }}
        >
          Inspect trace timelines, browse the memory graph, edit observer
          policies, and replay stored traces.
        </p>

        <div
          role="tablist"
          aria-label="Studio sub-panels"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
          }}
        >
          {PANELS.map((panel) => {
            const isActive = active === panel.id;
            return (
              <button
                key={panel.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(panel.id)}
                className="btn-press"
                style={{
                  padding: "10px 14px",
                  fontSize: "var(--font-size-sm, 13px)",
                  fontWeight: isActive ? 600 : 400,
                  cursor: "pointer",
                  border: "none",
                  borderBottom: isActive
                    ? "2px solid var(--color-primary)"
                    : "2px solid transparent",
                  background: "transparent",
                  color: isActive
                    ? "var(--color-text-primary)"
                    : "var(--color-text-muted)",
                }}
              >
                {panel.label}
              </button>
            );
          })}
        </div>
      </header>

      <div
        role="tabpanel"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {renderPanel()}
      </div>
    </div>
  );
}
