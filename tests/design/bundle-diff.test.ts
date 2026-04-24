/**
 * V9 T8.3 — Bundle diff tests.
 *
 * Covers added / removed / changed classification, subtree removal
 * (every leaf inside a gone group surfaces), shape changes
 * (token ↔ group), determinism, and the plain-text formatter.
 */

import { describe, expect, it } from "vitest";
import type { DtcgBundle } from "../../src/design/dtcg-emitter.js";
import {
  diffBundles,
  formatDiff,
  type BundleDiff,
  type DiffEntry,
} from "../../src/design/bundle-diff.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function emptyBundle(): DtcgBundle {
  return {
    colors: {},
    spacing: {},
    typography: {},
    borderRadius: {},
    shadows: {},
    extras: {},
  };
}

function baseBundle(): DtcgBundle {
  return {
    colors: {
      primary: { $type: "color", $value: "#06b6d4" },
      accent: { $type: "color", $value: "#f59e0b" },
    },
    spacing: {
      "space-1": { $type: "dimension", $value: "16px" },
    },
    typography: {},
    borderRadius: {},
    shadows: {},
    extras: {},
  };
}

function getPaths(entries: readonly DiffEntry[]): readonly string[] {
  return entries.map((e) => e.path.join("."));
}

// ── Equality base case ────────────────────────────────────────────────────

describe("diffBundles — identity", () => {
  it("two identical bundles produce an empty diff", () => {
    const diff = diffBundles(baseBundle(), baseBundle());
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("empty bundle diffs against itself is empty", () => {
    const diff = diffBundles(emptyBundle(), emptyBundle());
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("counts compared leaf tokens", () => {
    const diff = diffBundles(baseBundle(), baseBundle());
    // 2 colors + 1 spacing = 3 leaves shared on both sides
    expect(diff.comparedTokenCount).toBe(3);
  });
});

// ── added / removed ───────────────────────────────────────────────────────

describe("diffBundles — added", () => {
  it("new single token shows up in added with correct path", () => {
    const after = baseBundle();
    (after.colors as Record<string, unknown>)["tertiary"] = {
      $type: "color",
      $value: "#22c55e",
    };
    const diff = diffBundles(baseBundle(), after);
    expect(getPaths(diff.added)).toEqual(["colors.tertiary"]);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("new group emits a group entry + each leaf inside it", () => {
    const after = baseBundle();
    (after.spacing as Record<string, unknown>)["scale"] = {
      small: { $type: "dimension", $value: "4px" },
      medium: { $type: "dimension", $value: "8px" },
    };
    const diff = diffBundles(baseBundle(), after);
    const paths = getPaths(diff.added);
    expect(paths).toContain("spacing.scale");
    expect(paths).toContain("spacing.scale.small");
    expect(paths).toContain("spacing.scale.medium");
  });
});

describe("diffBundles — removed", () => {
  it("deleted token shows up in removed with correct path", () => {
    const after = baseBundle();
    delete (after.colors as Record<string, unknown>)["accent"];
    const diff = diffBundles(baseBundle(), after);
    expect(getPaths(diff.removed)).toEqual(["colors.accent"]);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("deleted subtree surfaces group + all leaves in removed", () => {
    const before = baseBundle();
    (before.spacing as Record<string, unknown>)["scale"] = {
      small: { $type: "dimension", $value: "4px" },
      medium: { $type: "dimension", $value: "8px" },
    };
    const diff = diffBundles(before, baseBundle());
    const paths = getPaths(diff.removed);
    expect(paths).toContain("spacing.scale");
    expect(paths).toContain("spacing.scale.small");
    expect(paths).toContain("spacing.scale.medium");
  });
});

// ── changed ───────────────────────────────────────────────────────────────

describe("diffBundles — changed", () => {
  it("$value change is reported with field=$value", () => {
    const after = baseBundle();
    (after.colors as Record<string, unknown>)["primary"] = {
      $type: "color",
      $value: "#0891b2",
    };
    const diff = diffBundles(baseBundle(), after);
    expect(diff.changed).toHaveLength(1);
    const entry = diff.changed[0];
    expect(entry?.kind).toBe("changed");
    if (entry?.kind === "changed") {
      expect(entry.path).toEqual(["colors", "primary"]);
      expect(entry.field).toBe("$value");
      if (entry.before.kind === "token") expect(entry.before.$value).toBe("#06b6d4");
      if (entry.after.kind === "token") expect(entry.after.$value).toBe("#0891b2");
    }
  });

  it("$type change outranks $value change in field labeling", () => {
    const after = baseBundle();
    (after.colors as Record<string, unknown>)["primary"] = {
      $type: "dimension",
      $value: "#06b6d4", // technically still the same string but type differs
    };
    const diff = diffBundles(baseBundle(), after);
    expect(diff.changed).toHaveLength(1);
    const e = diff.changed[0];
    if (e?.kind === "changed") expect(e.field).toBe("$type");
  });

  it("$description change on token is captured", () => {
    const after = baseBundle();
    (after.colors as Record<string, unknown>)["primary"] = {
      $type: "color",
      $value: "#06b6d4",
      $description: "Brand primary — cyan",
    };
    const diff = diffBundles(baseBundle(), after);
    const e = diff.changed[0];
    if (e?.kind === "changed") expect(e.field).toBe("$description");
  });

  it("group-level $description change is reported", () => {
    const before = baseBundle();
    const after = baseBundle();
    (before.colors as Record<string, unknown>)["$description"] = "Old copy";
    (after.colors as Record<string, unknown>)["$description"] = "New copy";
    const diff = diffBundles(before, after);
    expect(diff.changed.length).toBeGreaterThan(0);
    const match = diff.changed.find((c) => c.path.join(".") === "colors");
    expect(match).toBeDefined();
    if (match?.kind === "changed") expect(match.field).toBe("$description");
  });

  it("token→group shape change is reported with field=shape", () => {
    const after = baseBundle();
    // Replace `primary` token with a nested group
    (after.colors as Record<string, unknown>)["primary"] = {
      base: { $type: "color", $value: "#06b6d4" },
    };
    const diff = diffBundles(baseBundle(), after);
    const match = diff.changed.find((c) => c.path.join(".") === "colors.primary");
    expect(match).toBeDefined();
    if (match?.kind === "changed") expect(match.field).toBe("shape");
  });
});

// ── Determinism ───────────────────────────────────────────────────────────

describe("diffBundles — determinism", () => {
  it("output is sorted lexicographically by dotted path", () => {
    const after = baseBundle();
    (after.colors as Record<string, unknown>)["zulu"] = {
      $type: "color",
      $value: "#000",
    };
    (after.colors as Record<string, unknown>)["alpha"] = {
      $type: "color",
      $value: "#fff",
    };
    const diff = diffBundles(baseBundle(), after);
    const paths = getPaths(diff.added);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it("two diffs of the same inputs produce identical output", () => {
    const before = baseBundle();
    const after = baseBundle();
    (after.colors as Record<string, unknown>)["extra"] = {
      $type: "color",
      $value: "#000",
    };
    const a = JSON.stringify(diffBundles(before, after));
    const b = JSON.stringify(diffBundles(before, after));
    expect(a).toBe(b);
  });
});

// ── formatDiff ────────────────────────────────────────────────────────────

describe("formatDiff", () => {
  it("empty diff returns 'No token drift.'", () => {
    const diff: BundleDiff = {
      added: [],
      removed: [],
      changed: [],
      comparedTokenCount: 0,
    };
    expect(formatDiff(diff)).toBe("No token drift.");
  });

  it("renders one line per entry with kind-prefix and path", () => {
    const after = baseBundle();
    (after.colors as Record<string, unknown>)["tertiary"] = {
      $type: "color",
      $value: "#22c55e",
    };
    delete (after.colors as Record<string, unknown>)["accent"];
    (after.colors as Record<string, unknown>)["primary"] = {
      $type: "color",
      $value: "#0891b2",
    };
    const diff = diffBundles(baseBundle(), after);
    const out = formatDiff(diff);
    expect(out).toContain("+ colors.tertiary");
    expect(out).toContain("- colors.accent");
    expect(out).toContain("~ colors.primary [$value]");
    expect(out).toContain("#06b6d4 → #0891b2");
  });
});
