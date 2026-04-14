import { describe, it, expect } from "vitest";
import {
  ShortcutRegistry,
  normalizeShortcut,
  DEFAULT_SHORTCUTS,
} from "../../src/desktop/keyboard-shortcuts.js";

// ── Normalize Tests ────────────────────────────────────

describe("normalizeShortcut", () => {
  it("should normalize modifier order", () => {
    expect(normalizeShortcut("Shift+Cmd+K")).toBe("Cmd+Shift+K");
    expect(normalizeShortcut("Alt+Cmd+Shift+X")).toBe("Cmd+Shift+Alt+X");
  });

  it("should handle case variations", () => {
    expect(normalizeShortcut("cmd+k")).toBe("Cmd+k");
    expect(normalizeShortcut("CTRL+S")).toBe("Ctrl+S");
  });

  it("should treat Meta as Cmd", () => {
    expect(normalizeShortcut("Meta+K")).toBe("Cmd+K");
  });

  it("should treat Option as Alt", () => {
    expect(normalizeShortcut("Option+K")).toBe("Alt+K");
  });

  it("should treat Command as Cmd", () => {
    expect(normalizeShortcut("Command+K")).toBe("Cmd+K");
  });

  it("should deduplicate modifiers", () => {
    expect(normalizeShortcut("Cmd+Cmd+K")).toBe("Cmd+K");
  });

  it("should handle simple keys", () => {
    expect(normalizeShortcut("Escape")).toBe("Escape");
  });
});

// ── ShortcutRegistry Tests ─────────────────────────────

describe("ShortcutRegistry", () => {
  it("should initialize with default shortcuts", () => {
    const registry = new ShortcutRegistry();
    expect(registry.size).toBe(DEFAULT_SHORTCUTS.length);
  });

  it("should initialize with custom shortcuts", () => {
    const registry = new ShortcutRegistry([
      { id: "test", keys: "Cmd+T", label: "Test", action: "test", scope: "app" },
    ]);
    expect(registry.size).toBe(1);
  });

  it("should register a new shortcut", () => {
    const registry = new ShortcutRegistry([]);
    const conflict = registry.register({
      id: "save",
      keys: "Cmd+S",
      label: "Save",
      action: "save",
      scope: "app",
    });
    expect(conflict).toBeNull();
    expect(registry.size).toBe(1);
  });

  it("should detect conflicts", () => {
    const registry = new ShortcutRegistry([]);
    registry.register({
      id: "first",
      keys: "Cmd+K",
      label: "First",
      action: "first",
      scope: "app",
    });

    const conflict = registry.register({
      id: "second",
      keys: "Cmd+K",
      label: "Second",
      action: "second",
      scope: "app",
    });

    expect(conflict).not.toBeNull();
    expect(conflict?.existing.id).toBe("first");
    expect(conflict?.incoming.id).toBe("second");
  });

  it("should allow same keys in different scopes", () => {
    const registry = new ShortcutRegistry([]);
    registry.register({
      id: "app-k",
      keys: "Cmd+K",
      label: "App K",
      action: "appK",
      scope: "app",
    });

    const conflict = registry.register({
      id: "editor-k",
      keys: "Cmd+K",
      label: "Editor K",
      action: "editorK",
      scope: "editor",
    });

    expect(conflict).toBeNull();
    expect(registry.size).toBe(2);
  });

  it("should unregister a shortcut", () => {
    const registry = new ShortcutRegistry([
      { id: "removable", keys: "Cmd+R", label: "Remove", action: "remove", scope: "app" },
    ]);
    expect(registry.unregister("removable")).toBe(true);
    expect(registry.size).toBe(0);
  });

  it("should return false for unregistering non-existent shortcut", () => {
    const registry = new ShortcutRegistry([]);
    expect(registry.unregister("nope")).toBe(false);
  });

  it("should resolve action by keys and scope", () => {
    const registry = new ShortcutRegistry([
      { id: "palette", keys: "Cmd+K", label: "Palette", action: "openPalette", scope: "app" },
    ]);

    expect(registry.resolve("Cmd+K", "app")).toBe("openPalette");
    expect(registry.resolve("Cmd+K", "editor")).toBeNull();
    expect(registry.resolve("Cmd+J", "app")).toBeNull();
  });

  it("should get all shortcuts", () => {
    const registry = new ShortcutRegistry(DEFAULT_SHORTCUTS);
    const all = registry.getAll();
    expect(all.length).toBe(DEFAULT_SHORTCUTS.length);
  });

  it("should filter by scope", () => {
    const registry = new ShortcutRegistry(DEFAULT_SHORTCUTS);
    const editorShortcuts = registry.getAll("editor");
    expect(editorShortcuts.every((s) => s.scope === "editor")).toBe(true);
    expect(editorShortcuts.length).toBeGreaterThan(0);
  });

  it("should get a shortcut by ID", () => {
    const registry = new ShortcutRegistry(DEFAULT_SHORTCUTS);
    const shortcut = registry.getById("command-palette");
    expect(shortcut).toBeDefined();
    expect(shortcut?.keys).toBe("Cmd+K");
  });

  it("should rebind a shortcut", () => {
    const registry = new ShortcutRegistry([
      { id: "rebindable", keys: "Cmd+K", label: "Test", action: "test", scope: "app" },
    ]);

    const conflict = registry.rebind("rebindable", "Cmd+J");
    expect(conflict).toBeNull();

    const updated = registry.getById("rebindable");
    expect(updated?.keys).toBe("Cmd+J");

    // Old binding should no longer resolve
    expect(registry.resolve("Cmd+K", "app")).toBeNull();
    expect(registry.resolve("Cmd+J", "app")).toBe("test");
  });

  it("should return null when rebinding non-existent shortcut", () => {
    const registry = new ShortcutRegistry([]);
    expect(registry.rebind("nope", "Cmd+X")).toBeNull();
  });

  it("should detect conflict when rebinding", () => {
    const registry = new ShortcutRegistry([
      { id: "a", keys: "Cmd+A", label: "A", action: "a", scope: "app" },
      { id: "b", keys: "Cmd+B", label: "B", action: "b", scope: "app" },
    ]);

    const conflict = registry.rebind("b", "Cmd+A");
    expect(conflict).not.toBeNull();
    expect(conflict?.existing.id).toBe("a");
  });
});
