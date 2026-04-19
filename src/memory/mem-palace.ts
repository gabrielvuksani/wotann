/**
 * MemPalace hierarchy — Phase 6B.
 *
 * Spatial metaphor for memory organization. Three nested levels:
 *   - Hall:  top-level scope (e.g. "coding", "personal", "medical")
 *   - Wing:  mid-level (e.g. "coding/wotann", "personal/family")
 *   - Room:  leaf (e.g. "coding/wotann/benchmarks")
 *
 * Queries can scope to any level — "find all WOTANN benchmark notes"
 * is a room-scoped query, "find all coding notes" is a hall-scoped
 * query. Without hierarchy, you're stuck with flat tags that lose
 * transitivity.
 *
 * Existing `memory/store.ts` has `domain` and `topic` fields — two
 * levels. MemPalace extends to three with stable navigation + query
 * patterns that the existing store can consume without schema changes.
 * `hall = domain`, `wing = topic`, `room = a new optional field`.
 *
 * Benchmarks: Mem0 + Supermemory see +12-34% retrieval precision when
 * queries filter by topic (their 2-level). 3 levels compound this for
 * large corpora (>10k entries).
 *
 * Pure module. No storage coupling — callers use existing MemoryStore
 * with palace-derived topic strings.
 */

// ── Types ──────────────────────────────────────────────

export interface MemPalacePath {
  readonly hall: string;
  readonly wing?: string;
  readonly room?: string;
}

export interface MemPalaceEntry<T = unknown> {
  readonly path: MemPalacePath;
  readonly data: T;
}

export interface MemPalaceQuery {
  readonly hall?: string;
  readonly wing?: string;
  readonly room?: string;
}

// ── Path parsing ──────────────────────────────────────

/**
 * Parse "hall/wing/room" or "hall/wing" or "hall" into a structured
 * MemPalacePath. Empty segments are ignored.
 */
export function parsePath(pathString: string): MemPalacePath {
  const parts = pathString
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error("parsePath: empty path");
  }
  const hall = parts[0]!;
  const result: MemPalacePath = { hall };
  const wing = parts[1];
  const room = parts[2];
  return {
    ...result,
    ...(wing ? { wing } : {}),
    ...(room ? { room } : {}),
  };
}

/** Render a path as "hall/wing/room". Omits undefined segments. */
export function formatPath(path: MemPalacePath): string {
  const parts = [path.hall];
  if (path.wing) parts.push(path.wing);
  if (path.room) parts.push(path.room);
  return parts.join("/");
}

/**
 * Does `candidate` fall under `ancestor`? A path falls under its own
 * hall, wing, or room; a wing falls under its hall; etc.
 *
 *   ancestor = coding           → any path whose hall = "coding" matches
 *   ancestor = coding/wotann    → any path with hall=coding + wing=wotann
 *   ancestor = coding/wotann/x  → exact match only
 */
export function isUnder(candidate: MemPalacePath, ancestor: MemPalacePath): boolean {
  if (candidate.hall !== ancestor.hall) return false;
  if (ancestor.wing === undefined) return true;
  if (candidate.wing !== ancestor.wing) return false;
  if (ancestor.room === undefined) return true;
  return candidate.room === ancestor.room;
}

// ── Query + filter ────────────────────────────────────

/**
 * Filter entries matching a query. Undefined query fields are wildcards:
 *   {} matches everything
 *   {hall: "x"} matches any entry in hall x
 *   {hall: "x", wing: "y"} matches any entry in x/y
 */
export function filterByQuery<T>(
  entries: readonly MemPalaceEntry<T>[],
  query: MemPalaceQuery,
): readonly MemPalaceEntry<T>[] {
  return entries.filter((entry) => {
    if (query.hall !== undefined && entry.path.hall !== query.hall) return false;
    if (query.wing !== undefined && entry.path.wing !== query.wing) return false;
    if (query.room !== undefined && entry.path.room !== query.room) return false;
    return true;
  });
}

// ── Navigation helpers ────────────────────────────────

/** List all distinct halls in the entry set. */
export function listHalls<T>(entries: readonly MemPalaceEntry<T>[]): readonly string[] {
  const halls = new Set<string>();
  for (const e of entries) halls.add(e.path.hall);
  return [...halls].sort();
}

/** List all wings within a hall. */
export function listWings<T>(
  entries: readonly MemPalaceEntry<T>[],
  hall: string,
): readonly string[] {
  const wings = new Set<string>();
  for (const e of entries) {
    if (e.path.hall === hall && e.path.wing !== undefined) wings.add(e.path.wing);
  }
  return [...wings].sort();
}

/** List all rooms within a wing. */
export function listRooms<T>(
  entries: readonly MemPalaceEntry<T>[],
  hall: string,
  wing: string,
): readonly string[] {
  const rooms = new Set<string>();
  for (const e of entries) {
    if (e.path.hall === hall && e.path.wing === wing && e.path.room !== undefined) {
      rooms.add(e.path.room);
    }
  }
  return [...rooms].sort();
}

// ── Count aggregation ─────────────────────────────────

export interface LevelCount {
  readonly name: string;
  readonly count: number;
  readonly wings?: readonly LevelCount[]; // nested for halls
}

/**
 * Produce a tree of counts: halls → wings → rooms with total entries
 * at each level. Good for UI outlining ("palace layout").
 */
export function countTree<T>(entries: readonly MemPalaceEntry<T>[]): readonly LevelCount[] {
  type MutableRoomCount = { name: string; count: number };
  type MutableWingCount = { name: string; count: number; rooms: MutableRoomCount[] };
  type MutableHallCount = { name: string; count: number; wings: MutableWingCount[] };

  const byHall = new Map<string, MutableHallCount>();

  for (const entry of entries) {
    let hallRec = byHall.get(entry.path.hall);
    if (!hallRec) {
      hallRec = { name: entry.path.hall, count: 0, wings: [] };
      byHall.set(entry.path.hall, hallRec);
    }
    hallRec.count++;

    if (entry.path.wing) {
      let wingRec = hallRec.wings.find((w) => w.name === entry.path.wing);
      if (!wingRec) {
        wingRec = { name: entry.path.wing, count: 0, rooms: [] };
        hallRec.wings.push(wingRec);
      }
      wingRec.count++;

      if (entry.path.room) {
        let roomRec = wingRec.rooms.find((r) => r.name === entry.path.room);
        if (!roomRec) {
          roomRec = { name: entry.path.room, count: 0 };
          wingRec.rooms.push(roomRec);
        }
        roomRec.count++;
      }
    }
  }

  const halls = [...byHall.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const hall of halls) {
    hall.wings.sort((a, b) => a.name.localeCompare(b.name));
    for (const wing of hall.wings) {
      wing.rooms.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  return halls.map((hall) => ({
    name: hall.name,
    count: hall.count,
    wings: hall.wings.map((wing) => ({
      name: wing.name,
      count: wing.count,
      wings: wing.rooms.map((room) => ({ name: room.name, count: room.count })),
    })),
  }));
}

/**
 * Compact palace layout as indented text — debugging / CLI display.
 */
export function renderTree(tree: readonly LevelCount[]): string {
  const lines: string[] = [];
  for (const hall of tree) {
    lines.push(`${hall.name} (${hall.count})`);
    for (const wing of hall.wings ?? []) {
      lines.push(`  ${wing.name} (${wing.count})`);
      for (const room of wing.wings ?? []) {
        lines.push(`    ${room.name} (${room.count})`);
      }
    }
  }
  return lines.join("\n");
}

// ── Adoption helpers ──────────────────────────────────

/**
 * Bridge MemPalacePath to the existing MemoryStore {domain, topic}
 * fields. This keeps MemPalace as a pure presentation layer atop the
 * existing storage schema — no migration needed. Room is serialized
 * as a suffix on topic ("wotann/benchmarks") since the store has no
 * dedicated field.
 */
export function toStoreFields(path: MemPalacePath): {
  readonly domain: string;
  readonly topic?: string;
} {
  const result: { domain: string; topic?: string } = { domain: path.hall };
  if (path.wing && path.room) {
    result.topic = `${path.wing}/${path.room}`;
  } else if (path.wing) {
    result.topic = path.wing;
  }
  return result;
}

/** Inverse of toStoreFields. */
export function fromStoreFields(fields: {
  readonly domain: string;
  readonly topic?: string;
}): MemPalacePath {
  const path: MemPalacePath = { hall: fields.domain };
  if (!fields.topic) return path;
  const parts = fields.topic.split("/");
  return {
    ...path,
    wing: parts[0],
    ...(parts[1] ? { room: parts[1] } : {}),
  };
}
