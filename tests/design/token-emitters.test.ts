/**
 * Tests for the per-surface design-token emitters.
 *
 * Emitters are pure functions: same input -> byte-identical output.
 */
import { describe, it, expect } from "vitest";
import { WOTANN_TOKENS, CANONICAL_PALETTES } from "../../src/design/tokens.js";
import { emitTui } from "../../src/design/token-emitters/tui.js";
import { emitDesktop } from "../../src/design/token-emitters/desktop.js";
import { emitIos } from "../../src/design/token-emitters/ios.js";
import {
  emitW3cTokens,
  emitW3cTokensJson,
} from "../../src/design/token-emitters/w3c-tokens.js";

describe("emitTui", () => {
  it("returns palettes + severity (dark-palette-backed)", () => {
    const out = emitTui(WOTANN_TOKENS);
    expect(Object.keys(out.palettes).sort()).toEqual([...CANONICAL_PALETTES].sort());
    expect(out.severity.green).toBe(WOTANN_TOKENS.palettes.dark.hudGreen);
    expect(out.severity.accent).toBe(WOTANN_TOKENS.palettes.dark.accent);
  });

  it("is deterministic (same in => same out)", () => {
    const a = emitTui(WOTANN_TOKENS);
    const b = emitTui(WOTANN_TOKENS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("emitDesktop", () => {
  const result = emitDesktop(WOTANN_TOKENS);

  it("emits a banner marking the file as generated", () => {
    expect(result.css).toMatch(/AUTO-GENERATED/);
    expect(result.typescript).toMatch(/AUTO-GENERATED/);
  });

  it("CSS includes a :root block for dark + [data-theme] blocks for the rest", () => {
    expect(result.css).toContain(`:root, [data-theme="dark"]`);
    expect(result.css).toContain(`[data-theme="light"]`);
    expect(result.css).toContain(`[data-theme="high-contrast"]`);
    expect(result.css).toContain(`[data-theme="sepia"]`);
    expect(result.css).toContain(`[data-theme="monochrome"]`);
  });

  it("CSS declares all 19 color tokens per palette (95 declarations total)", () => {
    // Match `--wotann-color-...:` exactly. All 5 palettes × 19 = 95.
    const matches = result.css.match(/--wotann-color-[a-z-]+:/g) ?? [];
    expect(matches.length).toBe(95);
  });

  it("CSS declares spacing, radius, shadow, motion tokens", () => {
    expect(result.css).toMatch(/--wotann-space-base:/);
    expect(result.css).toMatch(/--wotann-radius-md:/);
    expect(result.css).toMatch(/--wotann-shadow-md:/);
    expect(result.css).toMatch(/--wotann-duration-base:/);
    expect(result.css).toMatch(/--wotann-ease-standard:/);
  });

  it("kebab-cases camelCase tokens", () => {
    expect(result.css).toContain("--wotann-color-accent-muted:");
    expect(result.css).toContain("--wotann-color-hud-green:");
    expect(result.css).toContain("--wotann-ease-expo-out:");
  });

  it("TS module declares WOTANN_TOKENS const and helper fns", () => {
    expect(result.typescript).toContain("export const WOTANN_TOKENS");
    expect(result.typescript).toContain("export function cssVarForColor");
    expect(result.typescript).toContain("export function color(");
    expect(result.typescript).toContain("export function space(");
    expect(result.typescript).toContain("export function radius(");
    expect(result.typescript).toContain("export function shadow(");
  });

  it("is deterministic", () => {
    const a = emitDesktop(WOTANN_TOKENS);
    const b = emitDesktop(WOTANN_TOKENS);
    expect(a.css).toBe(b.css);
    expect(a.typescript).toBe(b.typescript);
  });
});

describe("emitIos", () => {
  const out = emitIos(WOTANN_TOKENS);

  it("emits a Swift source file", () => {
    expect(out.swift).toMatch(/^\/\/ AUTO-GENERATED/);
    expect(out.swift).toContain("import SwiftUI");
  });

  it("includes all 5 palette enums", () => {
    expect(out.swift).toContain("public enum Dark {");
    expect(out.swift).toContain("public enum Light {");
    expect(out.swift).toContain("public enum HighContrast {");
    expect(out.swift).toContain("public enum Sepia {");
    expect(out.swift).toContain("public enum Monochrome {");
  });

  it("declares all 19 color tokens per palette (95 declarations total)", () => {
    const matches = out.swift.match(/public static let \w+ = Color\(hex:/g) ?? [];
    expect(matches.length).toBe(95);
  });

  it("converts hex to Swift 0xAABBCC literal", () => {
    // dark.accent is #06b6d4
    expect(out.swift).toContain("accent = Color(hex: 0x06B6D4)");
  });

  it("emits spacing, radius, typography, duration enums", () => {
    expect(out.swift).toContain("public enum Spacing {");
    expect(out.swift).toContain("public enum Radius {");
    expect(out.swift).toContain("public enum Typography {");
    expect(out.swift).toContain("public enum Duration {");
  });

  it("converts durations from ms to seconds", () => {
    // fast = 150ms => 0.150
    expect(out.swift).toContain("fast: TimeInterval = 0.150");
  });

  it("is deterministic", () => {
    expect(emitIos(WOTANN_TOKENS).swift).toBe(out.swift);
  });
});

describe("emitW3cTokens (W3C Design Tokens CG format)", () => {
  const tree = emitW3cTokens(WOTANN_TOKENS);

  it("has top-level color, typography, spacing, radius, shadow, motion groups", () => {
    for (const group of ["color", "typography", "spacing", "radius", "shadow", "motion"]) {
      expect(tree[group], group).toBeTruthy();
    }
  });

  it("color group has 5 palettes with $type=color leaves", () => {
    const colorGroup = tree.color as Record<string, any>;
    for (const name of CANONICAL_PALETTES) {
      const p = colorGroup[name];
      expect(p, name).toBeTruthy();
      const accent = p.accent;
      expect(accent.$type).toBe("color");
      expect(accent.$value).toBe(WOTANN_TOKENS.palettes[name].accent);
    }
  });

  it("spacing uses $type=dimension with px", () => {
    const sp = tree.spacing as Record<string, any>;
    expect(sp.base.$type).toBe("dimension");
    expect(sp.base.$value).toBe("16px");
  });

  it("motion.easing uses $type=cubicBezier with 4-tuple", () => {
    const mo = tree.motion as Record<string, any>;
    expect(mo.easing.standard.$type).toBe("cubicBezier");
    expect(mo.easing.standard.$value.length).toBe(4);
  });

  it("emitW3cTokensJson is valid JSON", () => {
    const json = emitW3cTokensJson(WOTANN_TOKENS);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json.endsWith("\n")).toBe(true);
  });

  it("is deterministic", () => {
    expect(emitW3cTokensJson(WOTANN_TOKENS)).toBe(emitW3cTokensJson(WOTANN_TOKENS));
  });
});

describe("Regression lock: themes.ts ↔ tokens.ts sync", () => {
  it("emitters see the same palette values as themes.ts", async () => {
    const themes = await import("../../src/ui/themes.js");
    for (const name of CANONICAL_PALETTES) {
      expect(emitTui(WOTANN_TOKENS).palettes[name]).toBe(themes.PALETTES[name]);
    }
  });
});
