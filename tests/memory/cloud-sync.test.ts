import { describe, it, expect } from "vitest";
import {
  CloudSyncEngine,
  verifyChecksum,
  type SyncEntry,
  type MemorySnapshot,
} from "../../src/memory/cloud-sync.js";

describe("Cloud Sync", () => {
  const makeEntry = (
    id: string,
    key: string,
    value: string,
    updatedAt: string = "2026-01-01T00:00:00.000Z",
  ): SyncEntry => ({
    id,
    key,
    value,
    updatedAt,
    source: "test",
  });

  describe("CloudSyncEngine", () => {
    it("starts with no entries", () => {
      const engine = new CloudSyncEngine();
      expect(engine.getEntries()).toHaveLength(0);
    });

    it("loads entries", () => {
      const engine = new CloudSyncEngine();
      engine.loadEntries([
        makeEntry("e1", "key1", "value1"),
        makeEntry("e2", "key2", "value2"),
      ]);
      expect(engine.getEntries()).toHaveLength(2);
    });

    it("gets a single entry by ID", () => {
      const engine = new CloudSyncEngine();
      engine.loadEntries([makeEntry("e1", "key1", "hello")]);
      const entry = engine.getEntry("e1");
      expect(entry).toBeDefined();
      expect(entry!.value).toBe("hello");
    });

    it("returns undefined for missing entry", () => {
      const engine = new CloudSyncEngine();
      expect(engine.getEntry("nope")).toBeUndefined();
    });
  });

  describe("exportSnapshot", () => {
    it("produces a valid snapshot with checksum", () => {
      const engine = new CloudSyncEngine();
      engine.loadEntries([
        makeEntry("e1", "key1", "value1"),
      ]);

      const snapshot = engine.exportSnapshot();
      expect(snapshot.version).toBe(1);
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.timestamp).toBeTruthy();
      expect(snapshot.checksum).toBeTruthy();
      expect(verifyChecksum(snapshot)).toBe(true);
    });

    it("produces different checksums for different data", () => {
      const engine1 = new CloudSyncEngine();
      engine1.loadEntries([makeEntry("e1", "k1", "v1")]);

      const engine2 = new CloudSyncEngine();
      engine2.loadEntries([makeEntry("e1", "k1", "v2")]);

      const snap1 = engine1.exportSnapshot();
      const snap2 = engine2.exportSnapshot();
      expect(snap1.checksum).not.toBe(snap2.checksum);
    });
  });

  describe("verifyChecksum", () => {
    it("validates correct checksum", () => {
      const engine = new CloudSyncEngine();
      engine.loadEntries([makeEntry("e1", "k", "v")]);
      const snapshot = engine.exportSnapshot();
      expect(verifyChecksum(snapshot)).toBe(true);
    });

    it("rejects tampered checksum", () => {
      const engine = new CloudSyncEngine();
      engine.loadEntries([makeEntry("e1", "k", "v")]);
      const snapshot = engine.exportSnapshot();

      const tampered: MemorySnapshot = { ...snapshot, checksum: "deadbeef00000000" };
      expect(verifyChecksum(tampered)).toBe(false);
    });
  });

  describe("importSnapshot (last-write-wins)", () => {
    it("inserts new entries from remote", () => {
      const local = new CloudSyncEngine();
      local.loadEntries([makeEntry("e1", "k1", "local-val")]);

      const remote = new CloudSyncEngine();
      remote.loadEntries([
        makeEntry("e1", "k1", "local-val"),
        makeEntry("e2", "k2", "remote-val"),
      ]);
      const remoteSnapshot = JSON.stringify(remote.exportSnapshot());

      const result = local.importSnapshot(remoteSnapshot);
      expect(result.inserted).toBe(1);
      expect(local.getEntry("e2")?.value).toBe("remote-val");
    });

    it("updates local entries when remote is newer", () => {
      const local = new CloudSyncEngine();
      local.loadEntries([
        makeEntry("e1", "k1", "old-value", "2026-01-01T00:00:00.000Z"),
      ]);

      const remote = new CloudSyncEngine();
      remote.loadEntries([
        makeEntry("e1", "k1", "new-value", "2026-06-01T00:00:00.000Z"),
      ]);
      const remoteSnapshot = JSON.stringify(remote.exportSnapshot());

      const result = local.importSnapshot(remoteSnapshot);
      expect(result.updated).toBe(1);
      expect(local.getEntry("e1")?.value).toBe("new-value");
    });

    it("keeps local value when local is newer", () => {
      const local = new CloudSyncEngine();
      local.loadEntries([
        makeEntry("e1", "k1", "newer-local", "2026-06-01T00:00:00.000Z"),
      ]);

      const remote = new CloudSyncEngine();
      remote.loadEntries([
        makeEntry("e1", "k1", "older-remote", "2026-01-01T00:00:00.000Z"),
      ]);
      const remoteSnapshot = JSON.stringify(remote.exportSnapshot());

      const result = local.importSnapshot(remoteSnapshot);
      expect(result.updated).toBe(0);
      expect(local.getEntry("e1")?.value).toBe("newer-local");
    });

    it("rejects snapshot with invalid checksum", () => {
      const local = new CloudSyncEngine();
      const badSnapshot: MemorySnapshot = {
        version: 1,
        entries: [makeEntry("e1", "k1", "v1")],
        timestamp: new Date().toISOString(),
        checksum: "invalid_checksum_x",
      };

      const result = local.importSnapshot(JSON.stringify(badSnapshot));
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.entryId).toBe("__checksum__");
      expect(result.inserted).toBe(0);
    });
  });

  describe("importSnapshot (manual conflict resolution)", () => {
    it("reports conflicts instead of auto-resolving", () => {
      const local = new CloudSyncEngine({ conflictResolution: "manual" });
      local.loadEntries([
        makeEntry("e1", "k1", "local-v", "2026-01-01T00:00:00.000Z"),
      ]);

      const remote = new CloudSyncEngine();
      remote.loadEntries([
        makeEntry("e1", "k1", "remote-v", "2026-06-01T00:00:00.000Z"),
      ]);
      const remoteSnapshot = JSON.stringify(remote.exportSnapshot());

      const result = local.importSnapshot(remoteSnapshot);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.localValue).toBe("local-v");
      expect(result.conflicts[0]!.remoteValue).toBe("remote-v");
      // Value should NOT be updated
      expect(local.getEntry("e1")?.value).toBe("local-v");
    });
  });

  describe("diffSnapshots", () => {
    it("identifies inserts from remote", () => {
      const engine = new CloudSyncEngine();
      const local: MemorySnapshot = {
        version: 1,
        entries: [],
        timestamp: new Date().toISOString(),
        checksum: "",
      };
      const remote: MemorySnapshot = {
        version: 1,
        entries: [makeEntry("e1", "k1", "v1")],
        timestamp: new Date().toISOString(),
        checksum: "",
      };

      const ops = engine.diffSnapshots(local, remote);
      expect(ops).toHaveLength(1);
      expect(ops[0]!.type).toBe("insert");
    });

    it("identifies no changes when snapshots match", () => {
      const engine = new CloudSyncEngine();
      const entries = [makeEntry("e1", "k1", "v1")];
      const snapshot: MemorySnapshot = {
        version: 1,
        entries,
        timestamp: new Date().toISOString(),
        checksum: "",
      };

      const ops = engine.diffSnapshots(snapshot, snapshot);
      expect(ops).toHaveLength(0);
    });
  });
});
