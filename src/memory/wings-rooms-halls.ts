/**
 * Wings / Rooms / Halls — MemPalace hierarchical partitioning (Phase H Task 6).
 *
 * +34% retrieval precision per the MemPalace paper (60.9% → 94.8%)
 * when queries filter by domain+topic.
 *
 * Vocabulary for this module (matches the Phase H task spec):
 *   - Wing: top-level domain — "person:maya", "project:wotann",
 *     "team:infra". The "who/what" of the memory.
 *   - Room: named idea within a wing — "onboarding", "migration-plan",
 *     "auth-review". The "which" of the memory.
 *   - Hall: typed corridor — "facts", "events", "discoveries",
 *     "preferences", "advice". The "how" of the memory.
 *
 * Note on terminology: an earlier module (src/memory/mem-palace.ts)
 * used a different hierarchy — Hall=top / Wing=mid / Room=leaf. That
 * remains unchanged for backwards-compatibility; this module is the
 * Phase H canonical partition. Both persist into the store's
 * (domain, topic) columns via partition-aware helpers below.
 *
 * Bridging:
 *   - wing → store.domain
 *   - room → store.topic (leading segment)
 *   - hall → store.topic (trailing segment, after a pipe separator)
 *
 * Example: { wing: "project:wotann", room: "migration-plan", hall: "facts" }
 *   persists as domain="project:wotann", topic="migration-plan|facts".
 *
 * Pure module — no I/O. Callers use the existing MemoryStore via the
 * partition helpers.
 */

// ── Types ──────────────────────────────────────────────

export const HALLS = ["facts", "events", "discoveries", "preferences", "advice"] as const;
export type Hall = (typeof HALLS)[number];

export interface WingRoomHall {
  /** Top-level domain: who/what the memory is about. */
  readonly wing: string;
  /** Named idea within the wing. Optional (wing-only memories). */
  readonly room?: string;
  /** Typed corridor. Optional (undifferentiated memories). */
  readonly hall?: Hall;
}

export interface WingRoomHallQuery {
  readonly wing?: string;
  readonly room?: string;
  readonly hall?: Hall;
}

// ── Path parsing ──────────────────────────────────────

/**
 * Parse "wing" | "wing/room" | "wing/room#hall" into a WingRoomHall.
 * Empty / invalid input throws — deterministic failure rather than
 * defaulting to a vague record.
 */
export function parseWrh(pathString: string): WingRoomHall {
  const trimmed = pathString.trim();
  if (trimmed.length === 0) {
    throw new Error("parseWrh: empty path");
  }
  const hashIdx = trimmed.indexOf("#");
  const hall = hashIdx >= 0 ? (trimmed.slice(hashIdx + 1).trim() as Hall) : undefined;
  if (hall !== undefined && !HALLS.includes(hall)) {
    throw new Error(`parseWrh: unknown hall "${hall}"`);
  }
  const wingRoom = (hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed).trim();
  const parts = wingRoom
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error("parseWrh: missing wing");
  }
  const result: WingRoomHall = { wing: parts[0]! };
  return {
    ...result,
    ...(parts[1] ? { room: parts[1] } : {}),
    ...(hall !== undefined ? { hall } : {}),
  };
}

export function formatWrh(path: WingRoomHall): string {
  const parts: string[] = [path.wing];
  if (path.room) parts.push(path.room);
  const base = parts.join("/");
  return path.hall ? `${base}#${path.hall}` : base;
}

// ── Store-field bridging ──────────────────────────────

/**
 * Bridge a WingRoomHall to the existing MemoryStore.{domain, topic}
 * fields. Callers use the returned pair when inserting into the store
 * so the same query machinery benefits from the partition.
 *
 *   { wing: "p:w", room: "r", hall: "facts" } →
 *     { domain: "p:w", topic: "r|facts" }
 *   { wing: "p:w", room: "r" }               →
 *     { domain: "p:w", topic: "r" }
 *   { wing: "p:w" }                          →
 *     { domain: "p:w", topic: "" }
 */
export function toStoreFields(path: WingRoomHall): {
  readonly domain: string;
  readonly topic: string;
} {
  const domain = path.wing;
  let topic = "";
  if (path.room && path.hall) {
    topic = `${path.room}|${path.hall}`;
  } else if (path.room) {
    topic = path.room;
  } else if (path.hall) {
    topic = `|${path.hall}`;
  }
  return { domain, topic };
}

/** Inverse of toStoreFields. Legacy rows (no separator) map to room-only. */
export function fromStoreFields(fields: {
  readonly domain: string;
  readonly topic: string;
}): WingRoomHall {
  const wing = fields.domain;
  const topic = fields.topic;
  if (!topic || topic.length === 0) {
    return { wing };
  }

  const sepIdx = topic.indexOf("|");
  if (sepIdx < 0) {
    return { wing, room: topic };
  }
  const roomPart = topic.slice(0, sepIdx);
  const hallPart = topic.slice(sepIdx + 1);
  const hall = HALLS.includes(hallPart as Hall) ? (hallPart as Hall) : undefined;
  const result: WingRoomHall = { wing };
  return {
    ...result,
    ...(roomPart ? { room: roomPart } : {}),
    ...(hall !== undefined ? { hall } : {}),
  };
}

// ── Query matching ────────────────────────────────────

/** Does a WingRoomHall match a query? Undefined query fields = wildcard. */
export function matchesQuery(path: WingRoomHall, query: WingRoomHallQuery): boolean {
  if (query.wing !== undefined && path.wing !== query.wing) return false;
  if (query.room !== undefined && path.room !== query.room) return false;
  if (query.hall !== undefined && path.hall !== query.hall) return false;
  return true;
}

/**
 * Expand a partition query into a store-compatible {domain, topic}
 * filter. Hall-only queries become topic-suffix filters so the store's
 * indexed domain/topic columns still carry the query.
 */
export function toStoreQuery(query: WingRoomHallQuery): {
  readonly domain?: string;
  readonly topic?: string;
} {
  const result: { domain?: string; topic?: string } = {};
  if (query.wing !== undefined) result.domain = query.wing;
  if (query.room !== undefined && query.hall !== undefined) {
    result.topic = `${query.room}|${query.hall}`;
  } else if (query.room !== undefined) {
    result.topic = query.room;
  } else if (query.hall !== undefined) {
    // No exact topic — caller should apply a client-side filter via
    // matchesQuery(). We expose the partial filter so the store can
    // pre-narrow on wing.
  }
  return result;
}

// ── Partition stats ───────────────────────────────────

export interface PartitionCount {
  readonly wing: string;
  readonly rooms: ReadonlyArray<{
    readonly room: string;
    readonly halls: Record<Hall, number>;
    readonly total: number;
  }>;
  readonly total: number;
}

/**
 * Aggregate a list of paths into a count tree — useful for UI display
 * ("person:maya has 12 facts in onboarding, 3 events in shipping").
 */
export function aggregateCounts(paths: readonly WingRoomHall[]): readonly PartitionCount[] {
  type MutRoom = { room: string; halls: Record<Hall, number>; total: number };
  type MutWing = { wing: string; rooms: MutRoom[]; total: number };

  const byWing = new Map<string, MutWing>();
  for (const path of paths) {
    let wingRec = byWing.get(path.wing);
    if (!wingRec) {
      wingRec = { wing: path.wing, rooms: [], total: 0 };
      byWing.set(path.wing, wingRec);
    }
    wingRec.total++;

    const roomKey = path.room ?? "(root)";
    let roomRec = wingRec.rooms.find((r) => r.room === roomKey);
    if (!roomRec) {
      roomRec = {
        room: roomKey,
        halls: { facts: 0, events: 0, discoveries: 0, preferences: 0, advice: 0 },
        total: 0,
      };
      wingRec.rooms.push(roomRec);
    }
    roomRec.total++;
    if (path.hall) roomRec.halls[path.hall]++;
  }

  const wings = [...byWing.values()].sort((a, b) => a.wing.localeCompare(b.wing));
  for (const w of wings) w.rooms.sort((a, b) => a.room.localeCompare(b.room));
  return wings.map((w) => ({
    wing: w.wing,
    rooms: w.rooms.map((r) => ({
      room: r.room,
      halls: { ...r.halls },
      total: r.total,
    })),
    total: w.total,
  }));
}

// ── Observation-type → hall mapping ────────────────────

/**
 * Map the ObservationType vocabulary into the Wings/Rooms/Halls
 * "hall" typed-corridor vocabulary. This is the canonical mapping
 * used when session-ingestion routes observations into partitioned
 * memory.
 */
export function observationTypeToHall(
  type: "decision" | "preference" | "milestone" | "problem" | "discovery",
): Hall {
  switch (type) {
    case "decision":
      return "facts";
    case "preference":
      return "preferences";
    case "milestone":
      return "events";
    case "problem":
      return "events";
    case "discovery":
      return "discoveries";
  }
}
