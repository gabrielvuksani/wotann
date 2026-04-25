/**
 * ConversationBraids — V9 T14.4 motif #3.
 *
 * A multi-thread canvas where 3-5 parallel conversations are rendered
 * as braided strands flowing left → right. Each strand is a different
 * conversation with its own colour and timeline of events. Strands can
 * fork (branch out from a shared point) or merge (collapse back into
 * a single point).
 *
 * Triggered by Cmd+Shift+B in the host app; this component just
 * renders the canvas surface from a `threads` prop.
 *
 * Layout:
 *   - The component fills its parent. Internally it renders a single
 *     SVG with a fixed virtual width; CSS scales the viewport.
 *   - Each strand has a stable horizontal lane (vertical offset),
 *     gently weaving up/down between events to give the braid feel.
 *   - Events are circles on the strand. Forks and merges are rendered
 *     as offset circles where two strands meet.
 *   - Tick lines mark the event index axis.
 *
 * Animation:
 *   - On mount, every strand path animates its `stroke-dashoffset`
 *     from full to zero so the braid "draws itself" into view.
 *
 * Sizing knobs:
 *   - Each strand is 40px tall.
 *   - Each event step is 80px wide.
 *   - Strand colour palette wraps after 5 to keep contrast strong.
 */

import { useMemo, useState, type JSX } from "react";
import "../../styles/norse-motifs.css";

// ── Types ────────────────────────────────────────────────

export type BraidEventKind =
  | "message"
  | "tool"
  | "fork"   // strand branches from another strand
  | "merge"; // strand merges back into another

export interface BraidEvent {
  /** Stable id for the event. */
  readonly id: string;
  /** The visual kind of the event. */
  readonly kind: BraidEventKind;
  /** Event index along the timeline (0..N). Determines x-position. */
  readonly tick: number;
  /** Optional partner thread id for fork / merge events. */
  readonly partnerThreadId?: string;
  /** Optional human-readable label. */
  readonly label?: string;
}

export interface BraidThread {
  /** Stable id for the thread. */
  readonly id: string;
  /** Display title of the thread. */
  readonly title: string;
  /** Optional CSS colour override. If omitted, the component uses
   *  one of the five `--norse-braid-*` tokens by lane order. */
  readonly color?: string;
  /** Events along the thread, ordered by `tick`. */
  readonly events: readonly BraidEvent[];
}

export interface ConversationBraidsProps {
  /** The threads to render (3-5 recommended). */
  readonly threads: readonly BraidThread[];
  /** Optional callback when an event is clicked. */
  readonly onEventClick?: (threadId: string, event: BraidEvent) => void;
  /** Optional inline style override. */
  readonly className?: string;
}

// ── Constants ────────────────────────────────────────────

const LANE_HEIGHT = 64;
const LANE_PADDING = 32;
const EVENT_STEP = 80;
const SIDE_PADDING = 60;
const NODE_RADIUS = 6;
const FORK_OFFSET = 12;

const PALETTE_TOKENS = [
  "var(--norse-braid-1)",
  "var(--norse-braid-2)",
  "var(--norse-braid-3)",
  "var(--norse-braid-4)",
  "var(--norse-braid-5)",
] as const;

// ── Geometry helpers ─────────────────────────────────────

/** Compute (x, y) for a given thread lane and tick. */
function eventPosition(laneIndex: number, tick: number): { x: number; y: number } {
  return {
    x: SIDE_PADDING + tick * EVENT_STEP,
    y: LANE_PADDING + laneIndex * LANE_HEIGHT + LANE_HEIGHT / 2,
  };
}

/**
 * Build a smooth SVG path connecting every event for a thread. Between
 * any two consecutive events we use a horizontal cubic bézier so the
 * line breathes a little instead of running dead-flat.
 *
 * Fork / merge events kink the path toward the partner lane so the
 * braid reads as actually crossing.
 */
function buildStrandPath(
  thread: BraidThread,
  laneIndex: number,
  laneByThreadId: ReadonlyMap<string, number>,
): string {
  const events = thread.events.slice().sort((a, b) => a.tick - b.tick);
  if (events.length === 0) return "";

  const points: { x: number; y: number }[] = events.map((evt) => {
    const { x, y: ownY } = eventPosition(laneIndex, evt.tick);
    if ((evt.kind === "fork" || evt.kind === "merge") && evt.partnerThreadId) {
      const partnerLane = laneByThreadId.get(evt.partnerThreadId);
      if (partnerLane !== undefined) {
        const dir = partnerLane > laneIndex ? 1 : -1;
        // Pull the strand toward the partner lane so the curve looks
        // like it actually meets the other strand mid-air.
        return { x, y: ownY + dir * FORK_OFFSET };
      }
    }
    return { x, y: ownY };
  });

  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const cx1 = prev.x + (curr.x - prev.x) / 2;
    const cx2 = prev.x + (curr.x - prev.x) / 2;
    d += ` C ${cx1} ${prev.y}, ${cx2} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

// ── Component ────────────────────────────────────────────

export function ConversationBraids({
  threads,
  onEventClick,
  className,
}: ConversationBraidsProps): JSX.Element {
  const [hoverEvent, setHoverEvent] = useState<{ threadId: string; eventId: string } | null>(null);

  // Derived geometry — recompute when threads change (which is rare).
  const geometry = useMemo(() => {
    const laneByThreadId = new Map<string, number>();
    threads.forEach((t, i) => laneByThreadId.set(t.id, i));

    const maxTick = threads.reduce((acc, t) => {
      return t.events.reduce((m, e) => Math.max(m, e.tick), acc);
    }, 0);

    const totalWidth = SIDE_PADDING * 2 + Math.max(maxTick, 1) * EVENT_STEP;
    const totalHeight = LANE_PADDING * 2 + threads.length * LANE_HEIGHT;

    const strands = threads.map((thread, laneIndex) => {
      const color = thread.color ?? PALETTE_TOKENS[laneIndex % PALETTE_TOKENS.length];
      const path = buildStrandPath(thread, laneIndex, laneByThreadId);
      return { thread, laneIndex, color, path };
    });

    return { laneByThreadId, totalWidth, totalHeight, strands, maxTick };
  }, [threads]);

  return (
    <div className={`conv-braid${className ? ` ${className}` : ""}`}
      role="figure"
      aria-label="Conversation braids — parallel threads"
    >
      <svg
        className="conv-braid__svg"
        viewBox={`0 0 ${geometry.totalWidth} ${geometry.totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
      >
        {/* Tick lines — vertical guides every event step. */}
        {Array.from({ length: geometry.maxTick + 1 }).map((_, t) => {
          const x = SIDE_PADDING + t * EVENT_STEP;
          return (
            <line
              key={`tick-${t}`}
              className="conv-braid__tick"
              x1={x}
              y1={LANE_PADDING / 2}
              x2={x}
              y2={geometry.totalHeight - LANE_PADDING / 2}
            />
          );
        })}

        {/* Strand paths. */}
        {geometry.strands.map(({ thread, color, path }) => (
          <path
            key={`strand-${thread.id}`}
            className="conv-braid__strand conv-braid__strand--animating"
            d={path}
            stroke={color}
            data-thread-id={thread.id}
          />
        ))}

        {/* Strand labels at the leading edge. */}
        {geometry.strands.map(({ thread, laneIndex, color }) => {
          const { y } = eventPosition(laneIndex, 0);
          return (
            <text
              key={`label-${thread.id}`}
              className="conv-braid__label"
              x={SIDE_PADDING - 12}
              y={y + 4}
              textAnchor="end"
              fill={color}
            >
              {thread.title}
            </text>
          );
        })}

        {/* Event nodes. */}
        {geometry.strands.flatMap(({ thread, laneIndex, color }) =>
          thread.events.map((evt) => {
            const { x, y } = eventPosition(laneIndex, evt.tick);
            const isHover =
              hoverEvent?.threadId === thread.id && hoverEvent?.eventId === evt.id;
            const isFork = evt.kind === "fork" || evt.kind === "merge";
            return (
              <g key={`evt-${thread.id}-${evt.id}`}>
                <circle
                  className="conv-braid__node"
                  cx={x}
                  cy={isFork && evt.partnerThreadId
                    ? y + (geometry.laneByThreadId.get(evt.partnerThreadId)! > laneIndex ? FORK_OFFSET : -FORK_OFFSET)
                    : y}
                  r={isHover ? NODE_RADIUS + 2 : NODE_RADIUS}
                  stroke={color}
                  style={{ cursor: onEventClick ? "pointer" : "default" }}
                  onMouseEnter={() => setHoverEvent({ threadId: thread.id, eventId: evt.id })}
                  onMouseLeave={() => setHoverEvent(null)}
                  onClick={() => onEventClick?.(thread.id, evt)}
                  aria-label={evt.label ?? `${thread.title} — ${evt.kind}`}
                  role={onEventClick ? "button" : undefined}
                />
                {evt.label && isHover && (
                  <text
                    className="conv-braid__label"
                    x={x}
                    y={y - NODE_RADIUS - 6}
                    textAnchor="middle"
                  >
                    {evt.label}
                  </text>
                )}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
