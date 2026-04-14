import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SteeringServer, type SteeringCommand, type SteeringCommandType } from "../../src/core/steering-server.js";
import { mkdtempSync, existsSync, readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Test Helpers ──────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wotann-steering-test-"));
}

function makeCommand(overrides: Partial<Omit<SteeringCommand, "id">> = {}): Omit<SteeringCommand, "id"> {
  return {
    type: overrides.type ?? "pause",
    data: overrides.data ?? "",
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

// ── Tests ─────────────────────────────────────────────

describe("SteeringServer", () => {
  let tempDir: string;
  let server: SteeringServer;

  beforeEach(() => {
    tempDir = makeTempDir();
    server = new SteeringServer(tempDir);
  });

  afterEach(() => {
    server.stopWatching();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates pending and processed subdirectories", () => {
      expect(existsSync(join(tempDir, "pending"))).toBe(true);
      expect(existsSync(join(tempDir, "processed"))).toBe(true);
    });
  });

  describe("writeCommand", () => {
    it("writes a command file to the pending directory", () => {
      const cmd = makeCommand({ type: "pause", data: "reason: user request" });
      const written = server.writeCommand(cmd);

      expect(written.id).toBeTruthy();
      expect(written.type).toBe("pause");
      expect(written.data).toBe("reason: user request");
      expect(written.timestamp).toBe(cmd.timestamp);

      const pendingDir = join(tempDir, "pending");
      const files = readdirSync(pendingDir);
      expect(files).toHaveLength(1);
    });

    it("writes multiple commands as separate files", () => {
      server.writeCommand(makeCommand({ type: "pause" }));
      server.writeCommand(makeCommand({ type: "resume" }));
      server.writeCommand(makeCommand({ type: "abort" }));

      const pendingDir = join(tempDir, "pending");
      const files = readdirSync(pendingDir);
      expect(files).toHaveLength(3);
    });

    it("stores valid JSON in the command file", () => {
      const cmd = makeCommand({ type: "add-context", data: '{"key": "value"}' });
      server.writeCommand(cmd);

      const pendingDir = join(tempDir, "pending");
      const files = readdirSync(pendingDir);
      const filePath = join(pendingDir, files[0]!);
      const content = JSON.parse(readFileSync(filePath, "utf-8"));

      expect(content.type).toBe("add-context");
      expect(content.data).toBe('{"key": "value"}');
    });

    it("generates unique IDs for each command", () => {
      const cmd1 = server.writeCommand(makeCommand());
      const cmd2 = server.writeCommand(makeCommand());

      expect(cmd1.id).not.toBe(cmd2.id);
    });
  });

  describe("checkCommands", () => {
    it("returns empty array when no commands pending", () => {
      expect(server.checkCommands()).toEqual([]);
    });

    it("returns all pending commands sorted by timestamp", () => {
      server.writeCommand(makeCommand({ type: "pause", timestamp: 3000 }));
      server.writeCommand(makeCommand({ type: "resume", timestamp: 1000 }));
      server.writeCommand(makeCommand({ type: "abort", timestamp: 2000 }));

      const commands = server.checkCommands();
      expect(commands).toHaveLength(3);

      // Sorted by filename which starts with timestamp
      expect(commands[0]?.type).toBe("resume");
      expect(commands[1]?.type).toBe("abort");
      expect(commands[2]?.type).toBe("pause");
    });

    it("returns correct command types", () => {
      const types: SteeringCommandType[] = [
        "reprioritize", "add-constraint", "change-model",
        "pause", "resume", "abort", "add-context",
      ];

      for (const type of types) {
        server.writeCommand(makeCommand({ type }));
      }

      const commands = server.checkCommands();
      expect(commands).toHaveLength(7);

      const returnedTypes = commands.map((c) => c.type);
      for (const type of types) {
        expect(returnedTypes).toContain(type);
      }
    });
  });

  describe("clearProcessed", () => {
    it("moves all pending commands to processed", () => {
      server.writeCommand(makeCommand({ type: "pause" }));
      server.writeCommand(makeCommand({ type: "resume" }));

      const cleared = server.clearProcessed();
      expect(cleared).toBe(2);

      expect(server.checkCommands()).toEqual([]);

      const processedDir = join(tempDir, "processed");
      const processedFiles = readdirSync(processedDir);
      expect(processedFiles).toHaveLength(2);
    });

    it("clears only specified command IDs", () => {
      const cmd1 = server.writeCommand(makeCommand({ type: "pause" }));
      server.writeCommand(makeCommand({ type: "resume" }));

      const cleared = server.clearProcessed([cmd1.id]);
      expect(cleared).toBe(1);

      const remaining = server.checkCommands();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.type).toBe("resume");
    });

    it("returns 0 when no commands to clear", () => {
      expect(server.clearProcessed()).toBe(0);
    });
  });

  describe("startWatching / stopWatching", () => {
    it("sets watching state to true", () => {
      server.startWatching(() => {});
      expect(server.isWatching()).toBe(true);
    });

    it("sets watching state to false after stop", () => {
      server.startWatching(() => {});
      server.stopWatching();
      expect(server.isWatching()).toBe(false);
    });

    it("stops previous watcher when starting a new one", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      server.startWatching(callback1);
      server.startWatching(callback2);

      expect(server.isWatching()).toBe(true);
    });

    it("detects new commands via polling", async () => {
      const received: SteeringCommand[] = [];

      server.startWatching(
        (cmd) => received.push(cmd),
        { pollIntervalMs: 50 },
      );

      // Write a command after the watcher starts
      await new Promise((resolve) => setTimeout(resolve, 10));
      server.writeCommand(makeCommand({ type: "add-context", data: "new info" }));

      // Wait for poll to detect it
      await new Promise((resolve) => setTimeout(resolve, 150));

      server.stopWatching();

      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received[0]?.type).toBe("add-context");
    });
  });

  describe("getPendingDir", () => {
    it("returns the path to the pending directory", () => {
      const pendingDir = server.getPendingDir();
      expect(pendingDir).toBe(join(tempDir, "pending"));
    });
  });

  describe("isWatching", () => {
    it("returns false by default", () => {
      expect(server.isWatching()).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles malformed JSON files gracefully", () => {
      const pendingDir = join(tempDir, "pending");
      const { writeFileSync } = require("node:fs") as typeof import("node:fs");
      writeFileSync(join(pendingDir, "bad-file.json"), "not valid json");

      const commands = server.checkCommands();
      expect(commands).toHaveLength(0); // Malformed file is skipped
    });

    it("handles missing required fields in JSON", () => {
      const pendingDir = join(tempDir, "pending");
      const { writeFileSync } = require("node:fs") as typeof import("node:fs");
      writeFileSync(
        join(pendingDir, "incomplete.json"),
        JSON.stringify({ type: "pause" }), // Missing id, data, timestamp
      );

      const commands = server.checkCommands();
      expect(commands).toHaveLength(0); // Incomplete file is skipped
    });

    it("survives if pending directory is deleted externally", () => {
      rmSync(join(tempDir, "pending"), { recursive: true, force: true });
      expect(server.checkCommands()).toEqual([]);
    });
  });
});
