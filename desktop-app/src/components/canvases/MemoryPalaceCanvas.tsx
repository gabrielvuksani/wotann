/**
 * MemoryPalaceCanvas — visualize a MemPalace graph (Lane 3) with the
 * wings → halls → rooms hierarchy.
 *
 * Mental model: the agent's memory is organized as a "palace":
 *   - Wings are top-level domains (Projects, People, Patterns, …)
 *   - Halls are sub-domains inside a wing (one wing can have N halls)
 *   - Rooms are individual memories, each carrying a summary + tags.
 *
 * Payload shape (runtime-validated):
 *   {
 *     title?: string
 *     wings: Array<{
 *       id: string
 *       name: string
 *       description?: string
 *       halls: Array<{
 *         id: string
 *         name: string
 *         rooms: Array<{
 *           id: string
 *           title: string
 *           summary?: string
 *           tags?: string[]
 *           updatedAt?: number       // epoch ms
 *           observationCount?: number
 *         }>
 *       }>
 *     }>
 *   }
 *
 * Interactivity:
 *   - Each wing and hall is collapsible (default: wings expanded, halls
 *     collapsed for long graphs).
 *   - Clicking a room dispatches a `canvas:memory-palace:drill`
 *     CustomEvent with { blockId, wingId, hallId, roomId }.
 */

import { useCallback, useMemo, useState } from "react";
import type { CanvasProps } from "../../lib/canvas-registry";
import { InvalidPayload, isPlainObject, EmptyPayload } from "./CanvasFallback";

// ────────────────────────────────────────────────────────────
// Types + validation
// ────────────────────────────────────────────────────────────

interface Room {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly updatedAt?: number;
  readonly observationCount?: number;
}

interface Hall {
  readonly id: string;
  readonly name: string;
  readonly rooms: readonly Room[];
}

interface Wing {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly halls: readonly Hall[];
}

interface PalacePayload {
  readonly title?: string;
  readonly wings: readonly Wing[];
}

function parseRoom(value: unknown): Room | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") {
    return null;
  }
  let tags: readonly string[] | undefined;
  if (Array.isArray(value.tags) && value.tags.every((t) => typeof t === "string")) {
    tags = value.tags as readonly string[];
  }
  return {
    id: value.id,
    title: value.title,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    tags,
    updatedAt:
      typeof value.updatedAt === "number" ? value.updatedAt : undefined,
    observationCount:
      typeof value.observationCount === "number"
        ? value.observationCount
        : undefined,
  };
}

function parseHall(value: unknown): Hall | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  const rawRooms = Array.isArray(value.rooms) ? value.rooms : [];
  const rooms: Room[] = [];
  for (const r of rawRooms) {
    const room = parseRoom(r);
    if (room) rooms.push(room);
  }
  return { id: value.id, name: value.name, rooms };
}

function parseWing(value: unknown): Wing | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  const rawHalls = Array.isArray(value.halls) ? value.halls : [];
  const halls: Hall[] = [];
  for (const h of rawHalls) {
    const hall = parseHall(h);
    if (hall) halls.push(hall);
  }
  return {
    id: value.id,
    name: value.name,
    description:
      typeof value.description === "string" ? value.description : undefined,
    halls,
  };
}

function validate(data: unknown): PalacePayload | { readonly error: string } {
  if (!isPlainObject(data)) return { error: "Payload must be an object." };
  if (!Array.isArray(data.wings)) return { error: "`wings` must be an array." };

  const wings: Wing[] = [];
  for (const w of data.wings) {
    const wing = parseWing(w);
    if (wing) wings.push(wing);
  }

  return {
    title: typeof data.title === "string" ? data.title : undefined,
    wings,
  };
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

interface DrillDetail {
  readonly blockId: string;
  readonly wingId: string;
  readonly hallId: string;
  readonly roomId: string;
}

function dispatchDrill(detail: DrillDetail): void {
  window.dispatchEvent(
    new CustomEvent("canvas:memory-palace:drill", {
      detail,
      bubbles: true,
    }),
  );
}

export default function MemoryPalaceCanvas({ data, blockId }: CanvasProps) {
  const parsed = useMemo(() => validate(data), [data]);
  const [collapsedWings, setCollapsedWings] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [collapsedHalls, setCollapsedHalls] = useState<ReadonlySet<string>>(
    () => {
      // Collapse halls by default once the graph is large enough that
      // the wall of rooms would be overwhelming.
      if ("error" in parsed) return new Set();
      const totalRooms = parsed.wings.reduce(
        (sum, w) => sum + w.halls.reduce((s, h) => s + h.rooms.length, 0),
        0,
      );
      if (totalRooms <= 24) return new Set();
      const initial = new Set<string>();
      for (const wing of parsed.wings) {
        for (const hall of wing.halls) {
          initial.add(hallKey(wing.id, hall.id));
        }
      }
      return initial;
    },
  );

  const toggleWing = useCallback((wingId: string) => {
    setCollapsedWings((prev) => {
      const next = new Set(prev);
      if (next.has(wingId)) next.delete(wingId);
      else next.add(wingId);
      return next;
    });
  }, []);

  const toggleHall = useCallback((wingId: string, hallId: string) => {
    setCollapsedHalls((prev) => {
      const next = new Set(prev);
      const key = hallKey(wingId, hallId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onDrill = useCallback(
    (wingId: string, hallId: string, roomId: string) => {
      dispatchDrill({ blockId, wingId, hallId, roomId });
    },
    [blockId],
  );

  if ("error" in parsed) {
    return (
      <InvalidPayload
        canvasLabel="Memory Palace"
        reason={parsed.error}
        data={data}
      />
    );
  }

  if (parsed.wings.length === 0) {
    return (
      <EmptyPayload
        canvasLabel="Memory Palace"
        hint="The palace has no wings yet. Save a memory to seed the graph."
      />
    );
  }

  const totalRooms = parsed.wings.reduce(
    (sum, w) => sum + w.halls.reduce((s, h) => s + h.rooms.length, 0),
    0,
  );
  const totalHalls = parsed.wings.reduce((sum, w) => sum + w.halls.length, 0);

  return (
    <section
      className="liquid-glass"
      data-glass-tier="medium"
      style={{
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md, 10px)",
        margin: "var(--space-sm) 0",
      }}
      aria-label={parsed.title ?? "Memory palace"}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "var(--space-sm)",
          gap: "var(--space-sm)",
          flexWrap: "wrap",
        }}
      >
        <h3
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {parsed.title ?? "Memory Palace"}
        </h3>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-dim)",
            display: "flex",
            gap: 12,
          }}
        >
          <span>{parsed.wings.length} wings</span>
          <span>{totalHalls} halls</span>
          <span>{totalRooms} rooms</span>
        </div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {parsed.wings.map((wing) => {
          const wingCollapsed = collapsedWings.has(wing.id);
          return (
            <div
              key={wing.id}
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm, 6px)",
                background: "var(--bg-surface)",
              }}
            >
              <button
                type="button"
                onClick={() => toggleWing(wing.id)}
                aria-expanded={!wingCollapsed}
                className="btn-press"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--color-text-primary)",
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    color: "var(--color-text-dim)",
                    transform: wingCollapsed ? "none" : "rotate(90deg)",
                    transition: "transform 160ms var(--ease-out)",
                    display: "inline-block",
                  }}
                >
                  ▸
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: "var(--accent)",
                    opacity: 0.7,
                  }}
                />
                <span style={{ flex: 1 }}>{wing.name}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--font-size-2xs)",
                    color: "var(--color-text-dim)",
                    fontWeight: 400,
                  }}
                >
                  {wing.halls.length} halls
                </span>
              </button>
              {wing.description && !wingCollapsed ? (
                <div
                  style={{
                    padding: "0 10px 8px 30px",
                    fontSize: "var(--font-size-2xs)",
                    color: "var(--color-text-muted)",
                    lineHeight: 1.5,
                  }}
                >
                  {wing.description}
                </div>
              ) : null}
              {!wingCollapsed ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "0 10px 10px 26px",
                  }}
                >
                  {wing.halls.length === 0 ? (
                    <div
                      style={{
                        fontSize: "var(--font-size-2xs)",
                        color: "var(--color-text-dim)",
                        fontStyle: "italic",
                      }}
                    >
                      Empty wing.
                    </div>
                  ) : (
                    wing.halls.map((hall) => {
                      const key = hallKey(wing.id, hall.id);
                      const hallCollapsed = collapsedHalls.has(key);
                      return (
                        <div
                          key={hall.id}
                          style={{
                            borderLeft: "1px solid var(--border-subtle)",
                            paddingLeft: 8,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => toggleHall(wing.id, hall.id)}
                            aria-expanded={!hallCollapsed}
                            className="btn-press"
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "4px 6px",
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              textAlign: "left",
                              color: "var(--color-text-secondary)",
                              fontSize: "var(--font-size-2xs)",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                width: 8,
                                color: "var(--color-text-dim)",
                                transform: hallCollapsed
                                  ? "none"
                                  : "rotate(90deg)",
                                transition: "transform 160ms var(--ease-out)",
                                display: "inline-block",
                              }}
                            >
                              ▸
                            </span>
                            <span style={{ flex: 1 }}>{hall.name}</span>
                            <span
                              style={{
                                color: "var(--color-text-dim)",
                                fontFamily: "var(--font-mono)",
                                textTransform: "none",
                                letterSpacing: 0,
                                fontWeight: 400,
                              }}
                            >
                              {hall.rooms.length}
                            </span>
                          </button>
                          {!hallCollapsed ? (
                            <ul
                              style={{
                                listStyle: "none",
                                margin: 0,
                                padding: "2px 0 6px 14px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                              }}
                            >
                              {hall.rooms.length === 0 ? (
                                <li
                                  style={{
                                    fontSize: "var(--font-size-2xs)",
                                    color: "var(--color-text-dim)",
                                    fontStyle: "italic",
                                  }}
                                >
                                  No rooms yet.
                                </li>
                              ) : (
                                hall.rooms.map((room) => (
                                  <li key={room.id}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onDrill(wing.id, hall.id, room.id)
                                      }
                                      className="btn-press"
                                      style={{
                                        width: "100%",
                                        textAlign: "left",
                                        padding: "4px 6px",
                                        background: "transparent",
                                        border: "1px solid transparent",
                                        borderRadius: "var(--radius-sm, 6px)",
                                        cursor: "pointer",
                                        fontSize: "var(--font-size-xs)",
                                        color: "var(--color-text-primary)",
                                        fontWeight: 500,
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "baseline",
                                          gap: 6,
                                          flexWrap: "wrap",
                                        }}
                                      >
                                        <span
                                          style={{
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {room.title}
                                        </span>
                                        {typeof room.observationCount ===
                                        "number" ? (
                                          <span
                                            style={{
                                              fontFamily: "var(--font-mono)",
                                              fontSize: "var(--font-size-2xs)",
                                              color: "var(--color-text-dim)",
                                              fontWeight: 400,
                                            }}
                                          >
                                            {room.observationCount} obs
                                          </span>
                                        ) : null}
                                        {typeof room.updatedAt === "number" ? (
                                          <span
                                            style={{
                                              fontFamily: "var(--font-mono)",
                                              fontSize: "var(--font-size-2xs)",
                                              color: "var(--color-text-dim)",
                                              fontWeight: 400,
                                            }}
                                          >
                                            {formatRelativeTime(
                                              room.updatedAt,
                                            )}
                                          </span>
                                        ) : null}
                                      </div>
                                      {room.summary ? (
                                        <div
                                          style={{
                                            fontSize: "var(--font-size-2xs)",
                                            color: "var(--color-text-muted)",
                                            fontWeight: 400,
                                            lineHeight: 1.5,
                                            marginTop: 2,
                                          }}
                                        >
                                          {room.summary}
                                        </div>
                                      ) : null}
                                      {room.tags && room.tags.length > 0 ? (
                                        <div
                                          style={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: 4,
                                            marginTop: 4,
                                          }}
                                        >
                                          {room.tags.map((tag) => (
                                            <span
                                              key={tag}
                                              style={{
                                                fontFamily: "var(--font-mono)",
                                                fontSize:
                                                  "var(--font-size-2xs)",
                                                color: "var(--color-text-dim)",
                                                background: "var(--bg-surface)",
                                                border:
                                                  "1px solid var(--border-subtle)",
                                                borderRadius:
                                                  "var(--radius-pill, 9999px)",
                                                padding: "1px 6px",
                                              }}
                                            >
                                              {tag}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </button>
                                  </li>
                                ))
                              )}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function hallKey(wingId: string, hallId: string): string {
  return `${wingId}::${hallId}`;
}

function formatRelativeTime(epochMs: number): string {
  const now = Date.now();
  const delta = now - epochMs;
  if (!Number.isFinite(delta) || delta < 0) return "";
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(epochMs).toISOString().slice(0, 10);
}
