/**
 * Palette conformance tests (P1-UI1).
 *
 * Locks the 5-palette discipline:
 *   - There are exactly 5 canonical palettes.
 *   - Each palette implements every key of the Palette interface.
 *   - Purple-specific hex strings are gone from ui/components.
 *   - Canonical palette switching produces distinct colors.
 *   - The high-contrast palette maintains pure black/white extremes
 *     (smoke test for WCAG-style contrast discipline).
 *
 * These tests are a regression lock — if any palette is later mutated
 * to drop a token, change the 5-palette count, or reintroduce a purple
 * accent hex in a component, the suite fails.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANONICAL_PALETTES,
  CANONICAL_THEMES,
  PALETTES,
  SEVERITY,
  STARTUP_GRADIENT,
  ThemeManager,
  resolvePalette,
  type Palette,
} from "../../src/ui/themes.js";

const PALETTE_KEYS: readonly (keyof Palette)[] = [
  "background",
  "surface",
  "text",
  "muted",
  "border",
  "accent",
  "accentMuted",
  "info",
  "success",
  "warning",
  "error",
  "userMessage",
  "assistantMessage",
  "systemMessage",
  "toolMessage",
  "hudGreen",
  "hudYellow",
  "hudOrange",
  "hudRed",
];

const HEX_RE = /^#[0-9a-fA-F]{3,6}$/;

describe("Palette conformance (P1-UI1)", () => {
  it("exports exactly 5 canonical palette names", () => {
    expect(CANONICAL_PALETTES).toHaveLength(5);
    expect([...CANONICAL_PALETTES].sort()).toEqual(
      ["dark", "high-contrast", "light", "monochrome", "sepia"].sort(),
    );
  });

  it("every canonical palette implements every Palette token", () => {
    for (const name of CANONICAL_PALETTES) {
      const palette = PALETTES[name];
      expect(palette).toBeDefined();
      for (const key of PALETTE_KEYS) {
        const value = palette[key];
        expect(value, `${name}.${String(key)} must be a non-empty string`).toBeTypeOf("string");
        expect(value, `${name}.${String(key)} must match hex pattern`).toMatch(HEX_RE);
      }
    }
  });

  it("CANONICAL_THEMES is a 1:1 mirror of CANONICAL_PALETTES", () => {
    expect(CANONICAL_THEMES).toHaveLength(CANONICAL_PALETTES.length);
    const byName = new Set(CANONICAL_THEMES.map((t) => t.name));
    for (const name of CANONICAL_PALETTES) {
      expect(byName.has(name), `canonical theme "${name}" missing`).toBe(true);
    }
  });

  it("getCanonicalPaletteCount() === 5", () => {
    const mgr = new ThemeManager();
    expect(mgr.getCanonicalPaletteCount()).toBe(5);
  });

  it("resolvePalette() returns each canonical palette by name", () => {
    for (const name of CANONICAL_PALETTES) {
      const palette = resolvePalette(name);
      expect(palette).not.toBeNull();
      expect(palette).toBe(PALETTES[name]);
    }
  });

  it("resolvePalette() resolves legacy aliases to a canonical palette", () => {
    for (const alias of ["default", "dracula", "nord", "tokyo-night", "mimir", "valkyrie"]) {
      const palette = resolvePalette(alias);
      expect(palette, `alias "${alias}" should resolve`).not.toBeNull();
      // Resolved palette must be one of the 5 canonical palette objects
      expect(Object.values(PALETTES)).toContain(palette);
    }
  });

  it("resolvePalette() returns null for unknown theme names", () => {
    expect(resolvePalette("not-a-real-theme")).toBeNull();
  });

  it("canonical palettes produce visibly distinct accents (purple purge)", () => {
    // At least 4 of 5 palettes must have a unique accent — monochrome
    // and high-contrast could each end up on white/cyan, but no more
    // than 2 palettes may share an accent.
    const accents = CANONICAL_PALETTES.map((n) => PALETTES[n].accent);
    const counts = new Map<string, number>();
    for (const a of accents) counts.set(a, (counts.get(a) ?? 0) + 1);
    for (const [color, count] of counts) {
      expect(count, `accent ${color} reused too often (${count}×)`).toBeLessThanOrEqual(2);
    }
  });

  it("no canonical palette uses the legacy purple hex stand-ins", () => {
    const forbidden = new Set([
      "#6366f1", // old primary
      "#8b5cf6", // old secondary
      "#a855f7", // old accent
      "#c084fc",
      "#cba6f7", // old toolMessage
      "#9333ea",
      "#bd93f9",
    ]);
    for (const name of CANONICAL_PALETTES) {
      const palette = PALETTES[name];
      for (const key of PALETTE_KEYS) {
        expect(forbidden.has(palette[key]), `${name}.${String(key)} uses banned purple hex`).toBe(
          false,
        );
      }
    }
  });

  it("high-contrast palette uses pure white text on pure black background", () => {
    const hc = PALETTES["high-contrast"];
    expect(hc.background).toBe("#000000");
    expect(hc.text).toBe("#ffffff");
  });

  it("light palette is the only palette with variant=light in canonical set", () => {
    const mgr = new ThemeManager();
    const light = mgr.getByVariant("light");
    // many aliases map to "light"; the canonical 5 themes themselves
    // should have exactly one "light" canonical entry
    expect(CANONICAL_THEMES.filter((t) => t.variant === "light")).toHaveLength(1);
    expect(light.length).toBeGreaterThan(0);
  });

  it("SEVERITY tokens are all present palette colors (not hardcoded hex)", () => {
    const dark = PALETTES.dark;
    expect(SEVERITY.green).toBe(dark.hudGreen);
    expect(SEVERITY.yellow).toBe(dark.hudYellow);
    expect(SEVERITY.orange).toBe(dark.hudOrange);
    expect(SEVERITY.red).toBe(dark.hudRed);
    expect(SEVERITY.accent).toBe(dark.accent);
  });

  it("STARTUP_GRADIENT entries are all palette-derived (no purple)", () => {
    expect(STARTUP_GRADIENT.length).toBeGreaterThan(0);
    const forbidden = new Set(["#6366f1", "#8b5cf6", "#a855f7", "#c084fc", "#d8b4fe"]);
    for (const hex of STARTUP_GRADIENT) {
      expect(hex).toMatch(HEX_RE);
      expect(forbidden.has(hex), `gradient color ${hex} is banned purple`).toBe(false);
    }
  });
});

describe("Component hex purge (P1-UI1 regression lock)", () => {
  const UI_COMPONENTS = [
    "src/ui/components/StartupScreen.tsx",
    "src/ui/components/MemoryInspector.tsx",
    "src/ui/components/StatusBar.tsx",
    "src/ui/components/ContextSourcePanel.tsx",
  ];

  const PURPLE_HEX = /#(6366f1|8b5cf6|a855f7|c084fc|d8b4fe|cba6f7|bd93f9|9333ea)/i;

  for (const path of UI_COMPONENTS) {
    it(`${path} contains no purple hex stand-ins`, () => {
      const abs = resolve(__dirname, "..", "..", path);
      const source = readFileSync(abs, "utf-8");
      const match = source.match(PURPLE_HEX);
      expect(match, `${path} still has purple hex: ${match?.[0]}`).toBeNull();
    });
  }

  it("known severity colors (#ff8c00) have been replaced with SEVERITY.orange", () => {
    for (const path of UI_COMPONENTS) {
      const abs = resolve(__dirname, "..", "..", path);
      const source = readFileSync(abs, "utf-8");
      expect(source, `${path} still hardcodes #ff8c00`).not.toMatch(/#ff8c00/);
    }
  });
});

describe("ThemeManager backward compatibility", () => {
  it("setTheme accepts every documented alias", () => {
    const mgr = new ThemeManager();
    for (const name of [
      "default",
      "default-light",
      "dracula",
      "nord",
      "tokyo-night",
      "catppuccin-mocha",
      "mimir",
      "yggdrasil",
      "runestone",
      "bifrost",
      "valkyrie",
      "wotann",
      "wotann-light",
    ]) {
      expect(mgr.setTheme(name), `alias ${name} should resolve`).toBe(true);
    }
  });

  it("exposes legacy ThemeColors aliases (primary/secondary/textDim/statusBar)", () => {
    const mgr = new ThemeManager();
    mgr.setTheme("dark");
    const colors = mgr.getCurrent().colors;
    expect(colors.primary).toBe(colors.accent);
    expect(colors.secondary).toBe(colors.accentMuted);
    expect(colors.textDim).toBe(colors.muted);
    expect(colors.statusBar).toBe(colors.surface);
  });
});
