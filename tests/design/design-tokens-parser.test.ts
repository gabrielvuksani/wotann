/**
 * W3C Design Tokens parser tests.
 */
import { describe, it, expect } from "vitest";
import {
  parseDesignTokens,
  emitTokensCss,
} from "../../src/design/design-tokens-parser.js";

describe("parseDesignTokens", () => {
  it("extracts colors from a W3C token tree", () => {
    const tokens = parseDesignTokens({
      color: {
        primary: { $value: "#0A84FF", $type: "color" },
        danger: { $value: "#E74C3C", $type: "color" },
      },
    });
    expect(tokens.colors.map((c) => c.name)).toEqual(["color-primary", "color-danger"]);
    expect(tokens.colors[0]?.value).toBe("#0A84FF");
  });

  it("extracts typography as composite tokens", () => {
    const tokens = parseDesignTokens({
      typography: {
        heading: {
          $type: "typography",
          $value: {
            fontFamily: "Inter",
            fontSize: "24px",
            fontWeight: 600,
          },
        },
      },
    });
    expect(tokens.typography).toHaveLength(1);
    const t = tokens.typography[0];
    expect(t?.name).toBe("typography-heading");
    expect(t?.value).toContain("fontFamily: Inter");
  });

  it("resolves {alias} references at parse time", () => {
    const tokens = parseDesignTokens({
      color: {
        brand: { $value: "#00FF88", $type: "color" },
        primary: { $value: "{color.brand}", $type: "color" },
      },
    });
    const primary = tokens.colors.find((c) => c.name === "color-primary");
    expect(primary?.value).toBe("#00FF88");
  });

  it("throws on a non-object payload", () => {
    expect(() => parseDesignTokens(null)).toThrow(/JSON object/);
    expect(() => parseDesignTokens([1, 2, 3])).toThrow(/JSON object/);
  });

  it("buckets unknown types into extras", () => {
    const tokens = parseDesignTokens({
      motion: {
        ease: { $value: "cubic-bezier(0.2, 0.8, 0.2, 1)", $type: "cubicBezier" },
      },
    });
    expect(tokens.extras).toHaveLength(1);
    expect(tokens.colors).toHaveLength(0);
  });

  it("reports totalCount across all buckets", () => {
    const tokens = parseDesignTokens({
      color: {
        a: { $value: "#000", $type: "color" },
        b: { $value: "#fff", $type: "color" },
      },
      spacing: {
        sm: { $value: "4px", $type: "spacing" },
      },
    });
    expect(tokens.totalCount).toBe(3);
  });
});

describe("emitTokensCss", () => {
  it("emits a :root block with CSS custom properties", () => {
    const tokens = parseDesignTokens({
      color: {
        primary: { $value: "#0A84FF", $type: "color" },
      },
      spacing: {
        sm: { $value: "4px", $type: "spacing" },
      },
    });
    const css = emitTokensCss(tokens);
    expect(css).toContain(":root {");
    expect(css).toContain("--color-primary: #0A84FF;");
    expect(css).toContain("--spacing-sm: 4px;");
    expect(css).toMatch(/^\:root \{[\s\S]+\}\n$/);
  });

  it("expands typography composite values into sub-properties", () => {
    const tokens = parseDesignTokens({
      typography: {
        heading: {
          $type: "typography",
          $value: {
            fontFamily: "Inter",
            fontSize: "24px",
          },
        },
      },
    });
    const css = emitTokensCss(tokens);
    expect(css).toContain("--typography-heading-font-family: Inter;");
    expect(css).toContain("--typography-heading-font-size: 24px;");
  });

  it("skips tokens with empty resolved values", () => {
    const tokens = parseDesignTokens({
      color: {
        missing: { $value: null, $type: "color" },
      },
    });
    const css = emitTokensCss(tokens);
    // The empty value should not appear as a bare `--color-missing: ;`.
    expect(css).not.toMatch(/--color-missing:\s*;/);
  });
});
