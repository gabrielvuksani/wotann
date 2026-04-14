/**
 * Cloud sync engine for team memory collaboration.
 *
 * Provides:
 * - Snapshot export/import for portable memory transfer
 * - Diff computation between local and remote snapshots
 * - Conflict resolution with last-write-wins (optional manual review)
 * - Checksum verification for data integrity
 *
 * Format: { version, entries, timestamp, checksum }
 */

import { createHash } from "node:crypto";

// ── Types ──────────────────────────────────────────────

export interface SyncEntry {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
  readonly source: string;
}

export interface MemorySnapshot {
  readonly version: number;
  readonly entries: readonly SyncEntry[];
  readonly timestamp: string;
  readonly checksum: string;
}

export type ConflictResolution = "last-write-wins" | "manual";

export interface MergeOperation {
  readonly type: "insert" | "update" | "delete" | "conflict";
  readonly entryId: string;
  readonly localEntry?: SyncEntry;
  readonly remoteEntry?: SyncEntry;
}

export interface MergeResult {
  readonly inserted: number;
  readonly updated: number;
  readonly deleted: number;
  readonly conflicts: readonly MergeConflict[];
  readonly appliedOperations: readonly MergeOperation[];
}

export interface MergeConflict {
  readonly entryId: string;
  readonly localValue: string;
  readonly remoteValue: string;
  readonly localUpdatedAt: string;
  readonly remoteUpdatedAt: string;
}

export interface CloudSyncConfig {
  readonly conflictResolution: ConflictResolution;
  readonly snapshotVersion: number;
}

const DEFAULT_CONFIG: CloudSyncConfig = {
  conflictResolution: "last-write-wins",
  snapshotVersion: 1,
};

// ── Checksum ──────────────────────────────────────────

function computeChecksum(entries: readonly SyncEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(`${entry.id}:${entry.key}:${entry.value}:${entry.updatedAt}`);
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * Verify that a snapshot's checksum matches its content.
 */
export function verifyChecksum(snapshot: MemorySnapshot): boolean {
  const expected = computeChecksum(snapshot.entries);
  return expected === snapshot.checksum;
}

// ── Cloud Sync Engine ─────────────────────────────────

export class CloudSyncEngine {
  private readonly config: CloudSyncConfig;
  private entries: Map<string, SyncEntry>;

  constructor(config: Partial<CloudSyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.entries = new Map();
  }

  /**
   * Load entries into the local store.
   * Used to populate the engine with current memory state.
   */
  loadEntries(entries: readonly SyncEntry[]): void {
    this.entries = new Map(entries.map((e) => [e.id, e]));
  }

  /**
   * Get all current entries.
   */
  getEntries(): readonly SyncEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Get a single entry by ID.
   */
  getEntry(id: string): SyncEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Export the current state as a portable snapshot.
   */
  exportSnapshot(): MemorySnapshot {
    const entries = [...this.entries.values()];
    return {
      version: this.config.snapshotVersion,
      entries,
      timestamp: new Date().toISOString(),
      checksum: computeChecksum(entries),
    };
  }

  /**
   * Import a remote snapshot, merging changes into local state.
   * Returns the merge result with counts and any unresolved conflicts.
   */
  importSnapshot(data: string): MergeResult {
    const remote = JSON.parse(data) as MemorySnapshot;

    if (!verifyChecksum(remote)) {
      return {
        inserted: 0,
        updated: 0,
        deleted: 0,
        conflicts: [
          {
            entryId: "__checksum__",
            localValue: "valid",
            remoteValue: "invalid checksum",
            localUpdatedAt: new Date().toISOString(),
            remoteUpdatedAt: remote.timestamp,
          },
        ],
        appliedOperations: [],
      };
    }

    const local = this.exportSnapshot();
    const operations = this.diffSnapshots(local, remote);
    return this.applyOperations(operations);
  }

  /**
   * Compute the set of merge operations needed to reconcile two snapshots.
   */
  diffSnapshots(
    local: MemorySnapshot,
    remote: MemorySnapshot,
  ): readonly MergeOperation[] {
    const localMap = new Map(local.entries.map((e) => [e.id, e]));
    const remoteMap = new Map(remote.entries.map((e) => [e.id, e]));
    const operations: MergeOperation[] = [];

    // Entries in remote but not in local → insert
    for (const [id, remoteEntry] of remoteMap) {
      const localEntry = localMap.get(id);
      if (!localEntry) {
        operations.push({ type: "insert", entryId: id, remoteEntry });
      } else if (localEntry.value !== remoteEntry.value) {
        // Both have the entry but values differ → conflict or update
        if (this.config.conflictResolution === "last-write-wins") {
          const localTime = new Date(localEntry.updatedAt).getTime();
          const remoteTime = new Date(remoteEntry.updatedAt).getTime();
          if (remoteTime > localTime) {
            operations.push({
              type: "update",
              entryId: id,
              localEntry,
              remoteEntry,
            });
          }
          // If local is newer, keep local (no-op)
        } else {
          operations.push({
            type: "conflict",
            entryId: id,
            localEntry,
            remoteEntry,
          });
        }
      }
      // Same value → no-op
    }

    // Entries in local but not in remote → potential delete
    // (We don't auto-delete; the remote might just not have it yet)

    return operations;
  }

  // ── Private ─────────────────────────────────────────

  private applyOperations(operations: readonly MergeOperation[]): MergeResult {
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    const conflicts: MergeConflict[] = [];
    const applied: MergeOperation[] = [];

    for (const op of operations) {
      switch (op.type) {
        case "insert": {
          if (op.remoteEntry) {
            this.entries.set(op.entryId, op.remoteEntry);
            inserted++;
            applied.push(op);
          }
          break;
        }
        case "update": {
          if (op.remoteEntry) {
            this.entries.set(op.entryId, op.remoteEntry);
            updated++;
            applied.push(op);
          }
          break;
        }
        case "delete": {
          this.entries.delete(op.entryId);
          deleted++;
          applied.push(op);
          break;
        }
        case "conflict": {
          if (op.localEntry && op.remoteEntry) {
            conflicts.push({
              entryId: op.entryId,
              localValue: op.localEntry.value,
              remoteValue: op.remoteEntry.value,
              localUpdatedAt: op.localEntry.updatedAt,
              remoteUpdatedAt: op.remoteEntry.updatedAt,
            });
          }
          break;
        }
      }
    }

    return {
      inserted,
      updated,
      deleted,
      conflicts,
      appliedOperations: applied,
    };
  }
}
