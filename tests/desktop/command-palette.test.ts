import { describe, it, expect, vi } from "vitest";
import {
  CommandPalette,
  fuzzyScore,
} from "../../src/desktop/command-palette.js";
import type { PaletteCommand } from "../../src/desktop/command-palette.js";

// ── Test Helpers ───────────────────────────────────────

function makeCommand(overrides?: Partial<PaletteCommand>): PaletteCommand {
  return {
    id: "test-cmd",
    label: "Test Command",
    description: "A test command",
    icon: "star",
    category: "session",
    action: vi.fn(),
    keywords: ["test"],
    ...overrides,
  };
}

// ── Fuzzy Score Tests ──────────────────────────────────

describe("fuzzyScore", () => {
  it("should return 0 for no match", () => {
    expect(fuzzyScore("xyz", "abc")).toBe(0);
  });

  it("should return positive score for exact substring", () => {
    const score = fuzzyScore("test", "Test Command");
    expect(score).toBeGreaterThan(0);
  });

  it("should give higher score for prefix match", () => {
    const prefixScore = fuzzyScore("test", "Test Command");
    const midScore = fuzzyScore("test", "A Test Thing");
    expect(prefixScore).toBeGreaterThan(midScore);
  });

  it("should return score for empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(1);
  });

  it("should return 0 for empty target", () => {
    expect(fuzzyScore("test", "")).toBe(0);
  });

  it("should match case-insensitively", () => {
    const score = fuzzyScore("CMD", "command");
    expect(score).toBeGreaterThan(0);
  });

  it("should score consecutive matches higher", () => {
    const consecutive = fuzzyScore("com", "command");
    const scattered = fuzzyScore("cmd", "command");
    expect(consecutive).toBeGreaterThan(scattered);
  });
});

// ── Command Palette Tests ──────────────────────────────

describe("CommandPalette", () => {
  it("should register and retrieve commands", () => {
    const palette = new CommandPalette();
    const cmd = makeCommand();
    palette.addCommand(cmd);

    expect(palette.size).toBe(1);
    expect(palette.getAllCommands()).toHaveLength(1);
  });

  it("should register multiple commands at once", () => {
    const palette = new CommandPalette();
    palette.addCommands([
      makeCommand({ id: "cmd-1", label: "First" }),
      makeCommand({ id: "cmd-2", label: "Second" }),
      makeCommand({ id: "cmd-3", label: "Third" }),
    ]);
    expect(palette.size).toBe(3);
  });

  it("should remove a command", () => {
    const palette = new CommandPalette();
    palette.addCommand(makeCommand({ id: "removable" }));
    expect(palette.removeCommand("removable")).toBe(true);
    expect(palette.size).toBe(0);
  });

  it("should return false when removing non-existent command", () => {
    const palette = new CommandPalette();
    expect(palette.removeCommand("nope")).toBe(false);
  });

  it("should search commands by label", () => {
    const palette = new CommandPalette();
    palette.addCommands([
      makeCommand({ id: "new-chat", label: "New Chat" }),
      makeCommand({ id: "settings", label: "Open Settings" }),
      makeCommand({ id: "enhance", label: "Enhance Prompt" }),
    ]);

    const results = palette.search("chat");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.command.id).toBe("new-chat");
  });

  it("should search commands by keywords", () => {
    const palette = new CommandPalette();
    palette.addCommand(makeCommand({
      id: "voice",
      label: "Voice Input",
      keywords: ["mic", "audio", "speech"],
    }));

    const results = palette.search("mic");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.command.id).toBe("voice");
  });

  it("should return recent commands for empty query", () => {
    const palette = new CommandPalette();
    const action = vi.fn();
    palette.addCommand(makeCommand({ id: "recent-cmd", action }));
    palette.executeCommand("recent-cmd");

    const results = palette.search("");
    expect(results).toHaveLength(1);
    expect(results[0]?.command.id).toBe("recent-cmd");
  });

  it("should execute a command and track as recent", () => {
    const palette = new CommandPalette();
    const action = vi.fn();
    palette.addCommand(makeCommand({ id: "exec-test", action }));

    const executed = palette.executeCommand("exec-test");
    expect(executed).toBe(true);
    expect(action).toHaveBeenCalledOnce();

    const recent = palette.getRecentCommands();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.command.id).toBe("exec-test");
  });

  it("should return false when executing non-existent command", () => {
    const palette = new CommandPalette();
    expect(palette.executeCommand("nope")).toBe(false);
  });

  it("should order recent commands most-recent first", () => {
    const palette = new CommandPalette();
    palette.addCommands([
      makeCommand({ id: "a", label: "A" }),
      makeCommand({ id: "b", label: "B" }),
      makeCommand({ id: "c", label: "C" }),
    ]);

    palette.executeCommand("a");
    palette.executeCommand("b");
    palette.executeCommand("c");

    const recent = palette.getRecentCommands();
    expect(recent[0]?.command.id).toBe("c");
    expect(recent[1]?.command.id).toBe("b");
    expect(recent[2]?.command.id).toBe("a");
  });

  it("should filter commands by category", () => {
    const palette = new CommandPalette();
    palette.addCommands([
      makeCommand({ id: "s1", category: "session" }),
      makeCommand({ id: "s2", category: "settings" }),
      makeCommand({ id: "s3", category: "session" }),
    ]);

    const sessionCmds = palette.getCommandsByCategory("session");
    expect(sessionCmds).toHaveLength(2);
  });

  it("should limit search results", () => {
    const palette = new CommandPalette();
    const commands: PaletteCommand[] = [];
    for (let i = 0; i < 30; i++) {
      commands.push(makeCommand({ id: `cmd-${i}`, label: `Command ${i}` }));
    }
    palette.addCommands(commands);

    const results = palette.search("Command");
    expect(results.length).toBeLessThanOrEqual(20);
  });
});
