import { describe, it, expect } from "vitest";
import { ThemeManager } from "../../src/ui/themes.js";
import { KeybindingManager } from "../../src/ui/keybindings.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Rich TUI (Phase 14)", () => {
  describe("ThemeManager", () => {
    it("has 20+ built-in themes", () => {
      const mgr = new ThemeManager();
      expect(mgr.getThemeCount()).toBeGreaterThanOrEqual(20);
    });

    it("defaults to dark theme", () => {
      const mgr = new ThemeManager();
      expect(mgr.getCurrent().variant).toBe("dark");
    });

    it("switches themes", () => {
      const mgr = new ThemeManager();
      const result = mgr.setTheme("dracula");
      expect(result).toBe(true);
      expect(mgr.getCurrent().name).toBe("dracula");
    });

    it("returns false for unknown themes", () => {
      const mgr = new ThemeManager();
      expect(mgr.setTheme("nonexistent")).toBe(false);
    });

    it("filters by variant", () => {
      const mgr = new ThemeManager();
      const dark = mgr.getByVariant("dark");
      const light = mgr.getByVariant("light");

      expect(dark.length).toBeGreaterThan(0);
      expect(light.length).toBeGreaterThan(0);
      expect(dark.every((t) => t.variant === "dark")).toBe(true);
      expect(light.every((t) => t.variant === "light")).toBe(true);
    });

    it("adds custom themes", () => {
      const mgr = new ThemeManager();
      const countBefore = mgr.getThemeCount();

      mgr.addCustomTheme({
        name: "my-theme",
        variant: "dark",
        colors: mgr.getCurrent().colors,
      });

      expect(mgr.getThemeCount()).toBe(countBefore + 1);
      expect(mgr.setTheme("my-theme")).toBe(true);
    });

    it("auto-detects dark/light variant", () => {
      const mgr = new ThemeManager();
      const variant = mgr.autoDetectVariant();
      expect(["dark", "light"]).toContain(variant);
    });

    it("lists all theme names", () => {
      const mgr = new ThemeManager();
      const names = mgr.getThemeNames();
      expect(names).toContain("default");
      expect(names).toContain("dracula");
      expect(names).toContain("nord");
      expect(names).toContain("tokyo-night");
    });

    it("persists selected theme to disk", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wotann-theme-"));

      try {
        const statePath = join(tempDir, "ui-state.json");
        const mgr = new ThemeManager("default", statePath);
        expect(mgr.setTheme("dracula")).toBe(true);

        const persisted = JSON.parse(readFileSync(statePath, "utf-8")) as { theme: string };
        expect(persisted.theme).toBe("dracula");

        const reloaded = new ThemeManager("default", statePath);
        expect(reloaded.getCurrent().name).toBe("dracula");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("KeybindingManager", () => {
    it("matches key combinations", () => {
      const mgr = new KeybindingManager();
      expect(mgr.matchKey("m", { ctrl: true })).toBe("model-switch");
      expect(mgr.matchKey("t", { ctrl: true })).toBe("thinking-depth");
      expect(mgr.matchKey("/", { ctrl: true })).toBe("global-search");
      expect(mgr.matchKey("tab", {})).toBe("cycle-panel");
    });

    it("returns null for unbound keys", () => {
      const mgr = new KeybindingManager();
      expect(mgr.matchKey("x", { ctrl: true })).toBeNull();
    });

    it("lists all bindings", () => {
      const mgr = new KeybindingManager();
      const bindings = mgr.getBindings();
      expect(bindings.length).toBeGreaterThan(5);
    });

    it("finds binding for action", () => {
      const mgr = new KeybindingManager();
      const binding = mgr.getBindingForAction("model-switch");
      expect(binding).toBeDefined();
      expect(binding!.key).toBe("m");
      expect(binding!.ctrl).toBe(true);
    });

    it("rebinds actions", () => {
      const mgr = new KeybindingManager();
      const result = mgr.rebind("model-switch", { key: "p", ctrl: true });
      expect(result).toBe(true);
      expect(mgr.matchKey("m", { ctrl: true })).toBeNull();
      expect(mgr.matchKey("p", { ctrl: true })).toBe("model-switch");
    });
  });
});
