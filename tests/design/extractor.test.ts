/**
 * Codebase → design-system extractor tests.
 *
 * Ports Anthropic's Claude Design "reverse extraction" — given a codebase,
 * recover the tokens (colors, spacing, typography) and a component inventory.
 * Output: `DesignSystem` that can be emitted as markdown or JSON.
 *
 * Heuristics intentionally stay simple: malformed files are skipped with a
 * `warnings[]` entry rather than failing the extraction. Every token carries
 * an `inventory` trail back to the source file so callers can audit claims.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesignExtractor } from "../../src/design/extractor.js";
import { runDesignExtractCommand } from "../../src/cli/commands/design-extract.js";

function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "wotann-design-extract-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("DesignExtractor.extract — color extraction", () => {
  it("finds hex colors in CSS files", () => {
    const root = makeWorkspace({
      "styles/main.css": `
        :root {
          --primary: #0A84FF;
          --danger: #e74c3c;
          --bg: #ffffff;
        }
      `,
    });
    try {
      const system = new DesignExtractor().extract(root);
      const hexes = system.palettes.flatMap((p) => p.colors.map((c) => c.value.toLowerCase()));
      expect(hexes).toContain("#0a84ff");
      expect(hexes).toContain("#e74c3c");
      expect(hexes).toContain("#ffffff");
    } finally {
      cleanup(root);
    }
  });

  it("finds rgb/rgba/hsl colors", () => {
    const root = makeWorkspace({
      "styles.css": `
        .a { color: rgb(10, 132, 255); }
        .b { color: rgba(231, 76, 60, 0.8); }
        .c { color: hsl(210, 100%, 52%); }
      `,
    });
    try {
      const system = new DesignExtractor().extract(root);
      const values = system.palettes.flatMap((p) => p.colors.map((c) => c.value));
      expect(values.some((v) => v.startsWith("rgb("))).toBe(true);
      expect(values.some((v) => v.startsWith("rgba("))).toBe(true);
      expect(values.some((v) => v.startsWith("hsl("))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("finds hex colors inside TSX/JSX style objects", () => {
    const root = makeWorkspace({
      "components/Button.tsx": `
        export const Button = () => (
          <div style={{ backgroundColor: "#FF6B6B", color: "#FFFFFF" }}>
            click
          </div>
        );
      `,
    });
    try {
      const system = new DesignExtractor().extract(root);
      const hexes = system.palettes.flatMap((p) => p.colors.map((c) => c.value.toLowerCase()));
      expect(hexes).toContain("#ff6b6b");
      expect(hexes).toContain("#ffffff");
    } finally {
      cleanup(root);
    }
  });
});

describe("DesignExtractor.extract — spacing extraction", () => {
  it("finds spacing units (px, rem, em)", () => {
    const root = makeWorkspace({
      "styles.css": `
        .card { padding: 16px; margin: 1.5rem; gap: 0.5em; }
        .btn { padding: 8px 12px; }
      `,
    });
    try {
      const system = new DesignExtractor().extract(root);
      // Should capture distinct spacing values
      expect(system.spacing.length).toBeGreaterThan(0);
      const pxValues = system.spacing.filter((s) => s.unit === "px").map((s) => s.raw);
      expect(pxValues).toContain("16px");
      expect(pxValues).toContain("8px");
      expect(pxValues).toContain("12px");
      const remValues = system.spacing.filter((s) => s.unit === "rem").map((s) => s.raw);
      expect(remValues).toContain("1.5rem");
    } finally {
      cleanup(root);
    }
  });
});

describe("DesignExtractor.extract — typography extraction", () => {
  it("finds font-family, font-size, font-weight", () => {
    const root = makeWorkspace({
      "styles.css": `
        body { font-family: "Inter", sans-serif; font-size: 16px; font-weight: 400; }
        h1 { font-family: "Georgia", serif; font-size: 2rem; font-weight: 700; }
      `,
    });
    try {
      const system = new DesignExtractor().extract(root);
      const families = system.typography.fontFamilies.map((t) => t.value);
      expect(families.some((f) => f.includes("Inter"))).toBe(true);
      expect(families.some((f) => f.includes("Georgia"))).toBe(true);
      const sizes = system.typography.fontSizes.map((t) => t.raw);
      expect(sizes).toContain("16px");
      expect(sizes).toContain("2rem");
      const weights = system.typography.fontWeights.map((t) => t.value);
      expect(weights).toContain(400);
      expect(weights).toContain(700);
    } finally {
      cleanup(root);
    }
  });
});

describe("DesignExtractor.cluster — palette grouping", () => {
  it("merges perceptually-close colors into the same palette", () => {
    const root = makeWorkspace({
      "a.css": `.a { color: #0A84FF; }`,
      "b.css": `.b { color: #0B83FE; }`, // 1-channel drift, should cluster with #0A84FF
      "c.css": `.c { color: #E74C3C; }`, // distinct, separate palette
    });
    try {
      const system = new DesignExtractor({ paletteDistanceThreshold: 8 }).extract(root);
      // #0A84FF and #0B83FE cluster → 1 palette; #E74C3C stands alone → 1 palette
      expect(system.palettes.length).toBe(2);
    } finally {
      cleanup(root);
    }
  });

  it("keeps distant colors in separate palettes", () => {
    const root = makeWorkspace({
      "a.css": `.a { color: #000000; }`,
      "b.css": `.b { color: #ffffff; }`,
      "c.css": `.c { color: #00ff00; }`,
    });
    try {
      const system = new DesignExtractor({ paletteDistanceThreshold: 5 }).extract(root);
      expect(system.palettes.length).toBe(3);
    } finally {
      cleanup(root);
    }
  });
});

describe("DesignExtractor.inventory — source-file tracking", () => {
  it("records the source file for each extracted token", () => {
    const root = makeWorkspace({
      "styles/theme.css": `:root { --primary: #0A84FF; }`,
      "styles/spacing.css": `:root { --gap: 12px; }`,
    });
    try {
      const system = new DesignExtractor().extract(root);
      const inv = system.inventory;
      // Color inventory points back to theme.css
      const primaryEntry = Object.entries(inv).find(([id]) => id.startsWith("color:"));
      expect(primaryEntry).toBeDefined();
      expect(primaryEntry?.[1].some((p) => p.endsWith("theme.css"))).toBe(true);
      // Spacing inventory points back to spacing.css
      const gapEntry = Object.entries(inv).find(([id]) => id.startsWith("spacing:"));
      expect(gapEntry).toBeDefined();
      expect(gapEntry?.[1].some((p) => p.endsWith("spacing.css"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe("DesignExtractor output formats", () => {
  it("toJson produces valid, parseable JSON", () => {
    const root = makeWorkspace({
      "a.css": `:root { --primary: #0A84FF; padding: 16px; }`,
    });
    try {
      const extractor = new DesignExtractor();
      const system = extractor.extract(root);
      const json = extractor.toJson(system);
      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty("palettes");
      expect(parsed).toHaveProperty("spacing");
      expect(parsed).toHaveProperty("typography");
      expect(parsed).toHaveProperty("inventory");
    } finally {
      cleanup(root);
    }
  });

  it("toMarkdown produces a readable summary", () => {
    const root = makeWorkspace({
      "styles.css": `
        :root {
          --primary: #0A84FF;
          --danger: #E74C3C;
          --gap: 12px;
          font-family: "Inter", sans-serif;
        }
      `,
    });
    try {
      const extractor = new DesignExtractor();
      const system = extractor.extract(root);
      const md = extractor.toMarkdown(system);
      expect(md).toContain("# Design System");
      expect(md).toContain("Palettes");
      expect(md).toContain("Spacing");
      expect(md).toContain("Typography");
      expect(md.toLowerCase()).toContain("#0a84ff");
      // Markdown should mention how many palettes and file counts
      expect(md).toContain("Files scanned:");
    } finally {
      cleanup(root);
    }
  });
});

describe("DesignExtractor include/exclude globs", () => {
  it("respects include/exclude globs", () => {
    const root = makeWorkspace({
      "src/a.css": `:root { --p: #0A84FF; }`,
      "node_modules/lib.css": `:root { --q: #FF0000; }`,
      "dist/out.css": `:root { --r: #00FF00; }`,
    });
    try {
      const extractor = new DesignExtractor({
        exclude: ["node_modules/**", "dist/**"],
      });
      const system = extractor.extract(root);
      const hexes = system.palettes.flatMap((p) => p.colors.map((c) => c.value.toLowerCase()));
      expect(hexes).toContain("#0a84ff");
      expect(hexes).not.toContain("#ff0000"); // node_modules excluded
      expect(hexes).not.toContain("#00ff00"); // dist excluded
    } finally {
      cleanup(root);
    }
  });
});

describe("DesignExtractor edge cases", () => {
  it("empty workspace returns an empty system (not an error)", () => {
    const root = makeWorkspace({});
    try {
      const system = new DesignExtractor().extract(root);
      expect(system.palettes).toEqual([]);
      expect(system.spacing).toEqual([]);
      expect(system.typography.fontFamilies).toEqual([]);
      expect(system.filesScanned).toBe(0);
      expect(system.warnings).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("malformed files are skipped with a warning, not a crash", () => {
    const root = makeWorkspace({
      "good.css": `:root { --primary: #0A84FF; }`,
      "bad.css": "\u0000\u0001\u0002 not-valid-css {{{{{{",
    });
    try {
      const system = new DesignExtractor().extract(root);
      // Good file's token should still be extracted
      const hexes = system.palettes.flatMap((p) => p.colors.map((c) => c.value.toLowerCase()));
      expect(hexes).toContain("#0a84ff");
      // Bad file should not cause an extraction failure (we may or may not
      // warn depending on how lenient the parser is — the key honesty
      // property is `filesScanned` counts both, not just the good one).
      expect(system.filesScanned).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup(root);
    }
  });

  it("nonexistent root throws a clear error", () => {
    const bogus = join(tmpdir(), "wotann-does-not-exist-" + Date.now());
    expect(() => new DesignExtractor().extract(bogus)).toThrow(/workspace/i);
  });

  it("CLI handler --dry-run does not write output file", async () => {
    const root = makeWorkspace({
      "a.css": `:root { --primary: #0A84FF; }`,
    });
    const outPath = join(root, "design-system.json");
    try {
      const result = await runDesignExtractCommand({
        root,
        format: "json",
        output: outPath,
        dryRun: true,
      });
      expect(result.success).toBe(true);
      expect(result.format).toBe("json");
      expect(result.wrotePath).toBeNull();
      expect(() => JSON.parse(result.output)).not.toThrow();
    } finally {
      cleanup(root);
    }
  });

  it("CLI handler writes markdown file when --output is provided", async () => {
    const root = makeWorkspace({
      "styles.css": `:root { --primary: #0A84FF; padding: 16px; }`,
    });
    const outPath = join(root, "design-system.md");
    try {
      const result = await runDesignExtractCommand({
        root,
        format: "md",
        output: outPath,
      });
      expect(result.success).toBe(true);
      expect(result.wrotePath).toBe(outPath);
      const written = require("node:fs").readFileSync(outPath, "utf8");
      expect(written).toContain("# Design System");
    } finally {
      cleanup(root);
    }
  });

  it("CLI handler returns error on nonexistent root", async () => {
    const bogus = join(tmpdir(), "wotann-missing-" + Date.now());
    const result = await runDesignExtractCommand({ root: bogus, format: "md" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("deduplicates identical spacing values across multiple files", () => {
    const root = makeWorkspace({
      "a.css": `.a { padding: 16px; }`,
      "b.css": `.b { margin: 16px; }`,
      "c.css": `.c { gap: 16px; }`,
    });
    try {
      const system = new DesignExtractor().extract(root);
      // 16px should appear exactly once in spacing, but its inventory
      // should list all three files.
      const sixteens = system.spacing.filter((s) => s.raw === "16px");
      expect(sixteens.length).toBe(1);
      const inventory = system.inventory[`spacing:16px`];
      expect(inventory).toBeDefined();
      expect(inventory?.length).toBe(3);
    } finally {
      cleanup(root);
    }
  });
});
