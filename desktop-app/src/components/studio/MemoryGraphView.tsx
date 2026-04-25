/**
 * MemoryGraphView — V9 T12.12 Mastra Studio sub-component.
 *
 * Per the brief: full graph visualization is OUT OF SCOPE. Render
 * a simple node list grouped by entity-type. A future revision can
 * upgrade to a force-directed graph (cytoscape/visx) without
 * changing the public props.
 *
 * Layout: collapsible sections per entity-type. Inside each section
 * a list of nodes with title + summary. Honest empty state when no
 * nodes exist.
 */

import {
  useMemo,
  useState,
  type ReactElement,
} from "react";

// ── Types ───────────────────────────────────────────────────

export interface MemoryGraphNode {
  readonly id: string;
  readonly entityType: string;
  readonly title: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly updatedAt?: number;
  readonly observationCount?: number;
}

export interface MemoryGraphEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relation: string;
}

export interface MemoryGraphViewProps {
  readonly nodes: readonly MemoryGraphNode[];
  /** Optional edges. Currently surfaced as a count per entity-type. */
  readonly edges?: readonly MemoryGraphEdge[];
  readonly selectedId?: string | null;
  readonly onSelect?: (node: MemoryGraphNode) => void;
}

// ── Component ───────────────────────────────────────────────

export function MemoryGraphView(props: MemoryGraphViewProps): ReactElement {
  const grouped = useMemo(() => groupByEntityType(props.nodes), [props.nodes]);
  const edgeCounts = useMemo(
    () => countEdgesByType(props.nodes, props.edges ?? []),
    [props.nodes, props.edges],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const toggle = (entityType: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(entityType)) next.delete(entityType);
      else next.add(entityType);
      return next;
    });
  };

  return (
    <div
      data-testid="memory-graph-view"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: "var(--font-size-2xs, 10px)",
          color: "var(--color-text-secondary)",
          flexShrink: 0,
        }}
      >
        {props.nodes.length} {props.nodes.length === 1 ? "node" : "nodes"}
        {props.edges
          ? ` · ${props.edges.length} ${props.edges.length === 1 ? "edge" : "edges"}`
          : ""}
      </div>

      {props.nodes.length === 0 ? (
        <div
          data-testid="memory-graph-empty"
          style={{
            padding: "var(--space-lg, 16px)",
            color: "var(--color-text-secondary)",
            fontSize: "var(--font-size-sm, 13px)",
            textAlign: "center",
            fontStyle: "italic",
          }}
        >
          No nodes in the knowledge graph yet.
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
          }}
        >
          {Array.from(grouped.entries()).map(([entityType, nodes]) => {
            const isCollapsed = collapsed.has(entityType);
            return (
              <section
                key={entityType}
                data-testid={`memory-graph-section-${entityType}`}
              >
                <button
                  type="button"
                  onClick={() => toggle(entityType)}
                  className="btn-press"
                  style={{
                    width: "100%",
                    padding: "var(--space-xs, 6px) var(--space-md, 12px)",
                    background: "var(--surface-2, rgba(255,255,255,0.03))",
                    border: "none",
                    borderBottom: "1px solid var(--border-subtle)",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: "var(--font-size-xs, 11px)",
                    fontWeight: 600,
                    color: "var(--color-text-primary)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-sm, 8px)",
                  }}
                  aria-expanded={!isCollapsed}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 10,
                      transition: "transform 120ms",
                      transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    }}
                  >
                    ▾
                  </span>
                  <span style={{ flex: 1 }}>{entityType}</span>
                  <span
                    style={{
                      fontSize: "var(--font-size-2xs, 10px)",
                      color: "var(--color-text-secondary)",
                      fontWeight: 500,
                    }}
                  >
                    {nodes.length}
                    {edgeCounts.get(entityType)
                      ? ` · ${edgeCounts.get(entityType)} edges`
                      : ""}
                  </span>
                </button>
                {!isCollapsed && (
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                    }}
                  >
                    {nodes.map((node) => (
                      <NodeRow
                        key={node.id}
                        node={node}
                        selected={props.selectedId === node.id}
                        onSelect={props.onSelect}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────

interface NodeRowProps {
  readonly node: MemoryGraphNode;
  readonly selected: boolean;
  readonly onSelect?: (node: MemoryGraphNode) => void;
}

function NodeRow(props: NodeRowProps): ReactElement {
  return (
    <li
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        background: props.selected
          ? "var(--surface-2, rgba(255,255,255,0.03))"
          : "transparent",
      }}
    >
      <button
        type="button"
        onClick={() => props.onSelect?.(props.node)}
        data-testid={`memory-graph-node-${props.node.id}`}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          textAlign: "left",
          cursor: props.onSelect ? "pointer" : "default",
          color: "var(--color-text-primary)",
          font: "inherit",
        }}
      >
        <span
          style={{
            display: "block",
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: props.selected ? 600 : 500,
          }}
        >
          {props.node.title}
        </span>
        {props.node.summary ? (
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
              lineHeight: 1.4,
            }}
          >
            {props.node.summary}
          </span>
        ) : null}
        {props.node.tags && props.node.tags.length > 0 ? (
          <span
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              marginTop: 4,
            }}
          >
            {props.node.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  padding: "1px 6px",
                  fontSize: "var(--font-size-2xs, 10px)",
                  borderRadius: "var(--radius-sm, 4px)",
                  background: "var(--surface-2, rgba(255,255,255,0.05))",
                  color: "var(--color-text-secondary)",
                }}
              >
                {tag}
              </span>
            ))}
          </span>
        ) : null}
      </button>
    </li>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function groupByEntityType(
  nodes: readonly MemoryGraphNode[],
): ReadonlyMap<string, readonly MemoryGraphNode[]> {
  const map = new Map<string, MemoryGraphNode[]>();
  for (const node of nodes) {
    const existing = map.get(node.entityType);
    if (existing) {
      existing.push(node);
    } else {
      map.set(node.entityType, [node]);
    }
  }
  // Freeze each bucket so consumers can't mutate.
  const frozen = new Map<string, readonly MemoryGraphNode[]>();
  for (const [k, v] of map) frozen.set(k, Object.freeze(v));
  return frozen;
}

function countEdgesByType(
  nodes: readonly MemoryGraphNode[],
  edges: readonly MemoryGraphEdge[],
): ReadonlyMap<string, number> {
  if (edges.length === 0) return new Map<string, number>();
  const idToType = new Map<string, string>();
  for (const node of nodes) idToType.set(node.id, node.entityType);
  const counts = new Map<string, number>();
  for (const edge of edges) {
    const sType = idToType.get(edge.sourceId);
    if (sType) counts.set(sType, (counts.get(sType) ?? 0) + 1);
    const tType = idToType.get(edge.targetId);
    if (tType && tType !== sType) {
      counts.set(tType, (counts.get(tType) ?? 0) + 1);
    }
  }
  return counts;
}
