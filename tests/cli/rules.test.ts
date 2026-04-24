/**
 * V9 T14.9 — .wotannrules marketplace tests.
 *
 * Covers sanitizeRuleId, matchRules, listInstalled, searchRules,
 * installRule (including the SHA-256 verification path), removeRule.
 * Every fs/network dependency is injected so the suite runs offline
 * and without touching the user's real `.wotann/rules/` dir.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  installRule,
  listInstalled,
  matchRules,
  readInstalledRule,
  removeRule,
  rulePath,
  sanitizeRuleId,
  searchRules,
  type RuleIndex,
  type RuleIndexEntry,
  type RulesFetcher,
} from "../../src/cli/commands/rules.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function mockFetcher(urls: Record<string, { status: number; body: string }>): RulesFetcher {
  return async (url) => {
    const entry = urls[url];
    if (!entry) {
      return { ok: false, status: 404, text: async () => "not found" };
    }
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      text: async () => entry.body,
    };
  };
}

function hashString(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "wotann-rules-"));
});

afterEach(() => {
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
});

// ── sanitizeRuleId ────────────────────────────────────────────────────────

describe("sanitizeRuleId", () => {
  it("lowercases and dash-separates", () => {
    expect(sanitizeRuleId("Auth Rules")).toBe("auth-rules");
  });

  it("strips unsafe chars", () => {
    expect(sanitizeRuleId("foo/bar../baz")).toBe("foo-bar-baz");
    expect(sanitizeRuleId("rule$1")).toBe("rule-1");
  });

  it("trims leading/trailing dashes", () => {
    expect(sanitizeRuleId("---foo---")).toBe("foo");
  });

  it("throws on empty or all-unsafe", () => {
    expect(() => sanitizeRuleId("")).toThrow(/empty/);
    expect(() => sanitizeRuleId("///")).toThrow(/empty/);
  });

  it("caps length at 100 chars", () => {
    expect(() => sanitizeRuleId("a".repeat(120))).toThrow(/<= 100/);
  });
});

// ── matchRules ────────────────────────────────────────────────────────────

describe("matchRules", () => {
  const index: RuleIndex = {
    rules: [
      {
        id: "auth-strict",
        name: "Strict auth",
        description: "Force every endpoint through the auth middleware",
        tags: ["auth", "security"],
        url: "x",
        sha256: "0",
      },
      {
        id: "tdd-required",
        name: "TDD gate",
        description: "Red-green-refactor required for every feature",
        tags: ["testing", "tdd"],
        url: "y",
        sha256: "0",
      },
    ],
  };

  it("empty query returns full index", () => {
    expect(matchRules(index, "")).toHaveLength(2);
  });

  it("matches by id substring", () => {
    const matches = matchRules(index, "auth");
    expect(matches.map((r) => r.id)).toEqual(["auth-strict"]);
  });

  it("matches by description substring (case-insensitive)", () => {
    const matches = matchRules(index, "RED-GREEN");
    expect(matches.map((r) => r.id)).toEqual(["tdd-required"]);
  });

  it("matches by tag equality (not substring)", () => {
    const matches = matchRules(index, "security");
    expect(matches.map((r) => r.id)).toEqual(["auth-strict"]);
  });
});

// ── listInstalled ─────────────────────────────────────────────────────────

describe("listInstalled", () => {
  it("returns empty when rules dir doesn't exist", () => {
    const result = listInstalled({ rulesDir: join(workDir, "missing") });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.installed).toHaveLength(0);
  });

  it("lists .md files sorted by id", () => {
    writeFileSync(join(workDir, "zebra.md"), "z", "utf-8");
    writeFileSync(join(workDir, "alpha.md"), "a", "utf-8");
    writeFileSync(join(workDir, "ignore.txt"), "no", "utf-8");
    const result = listInstalled({ rulesDir: workDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installed.map((r) => r.id)).toEqual(["alpha", "zebra"]);
    }
  });
});

// ── searchRules ───────────────────────────────────────────────────────────

describe("searchRules", () => {
  const indexUrl = "https://wotann.com/rules/index.json";

  it("returns ok:false when the fetcher errors", async () => {
    const fetcher = mockFetcher({});
    const result = await searchRules("x", indexUrl, fetcher);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when the JSON is malformed", async () => {
    const fetcher = mockFetcher({ [indexUrl]: { status: 200, body: "not json" } });
    const result = await searchRules("x", indexUrl, fetcher);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when the JSON has no rules array", async () => {
    const fetcher = mockFetcher({ [indexUrl]: { status: 200, body: "{}" } });
    const result = await searchRules("x", indexUrl, fetcher);
    expect(result.ok).toBe(false);
  });

  it("returns matched rules on successful fetch", async () => {
    const index: RuleIndex = {
      rules: [
        {
          id: "foo",
          name: "Foo",
          description: "does foo",
          url: "x",
          sha256: "0",
        },
      ],
    };
    const fetcher = mockFetcher({
      [indexUrl]: { status: 200, body: JSON.stringify(index) },
    });
    const result = await searchRules("foo", indexUrl, fetcher);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matches).toHaveLength(1);
  });
});

// ── installRule ───────────────────────────────────────────────────────────

describe("installRule", () => {
  const ruleUrl = "https://rules.example.com/my-rule.md";

  function fixtureEntry(content: string): RuleIndexEntry {
    return {
      id: "my-rule",
      name: "My rule",
      description: "desc",
      url: ruleUrl,
      sha256: hashString(content),
    };
  }

  it("writes the rule when sha256 matches", async () => {
    const body = "# Rule\n\nBehavior.";
    const entry = fixtureEntry(body);
    const fetcher = mockFetcher({ [ruleUrl]: { status: 200, body } });
    const result = await installRule(entry, { rulesDir: workDir }, fetcher);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(existsSync(result.installed.path)).toBe(true);
      expect(result.installed.id).toBe("my-rule");
    }
  });

  it("refuses to write when sha256 doesn't match", async () => {
    const entry: RuleIndexEntry = {
      id: "my-rule",
      name: "My rule",
      description: "desc",
      url: ruleUrl,
      sha256: "0".repeat(64),
    };
    const fetcher = mockFetcher({ [ruleUrl]: { status: 200, body: "# actual content" } });
    const result = await installRule(entry, { rulesDir: workDir }, fetcher);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("sha256 mismatch");
    // And CRITICALLY — nothing landed on disk.
    expect(existsSync(rulePath({ rulesDir: workDir }, "my-rule"))).toBe(false);
  });

  it("propagates fetcher errors as ok:false", async () => {
    const entry = fixtureEntry("content");
    const fetcher = mockFetcher({});
    const result = await installRule(entry, { rulesDir: workDir }, fetcher);
    expect(result.ok).toBe(false);
  });

  it("rejects IDs that reduce to empty strings (traversal defense)", async () => {
    const entry: RuleIndexEntry = {
      id: "///",
      name: "bad",
      description: "bad",
      url: ruleUrl,
      sha256: "0",
    };
    const fetcher = mockFetcher({ [ruleUrl]: { status: 200, body: "x" } });
    const result = await installRule(entry, { rulesDir: workDir }, fetcher);
    expect(result.ok).toBe(false);
  });
});

// ── removeRule + readInstalledRule ────────────────────────────────────────

describe("removeRule", () => {
  it("removes an installed rule", () => {
    const path = rulePath({ rulesDir: workDir }, "foo");
    writeFileSync(path, "x", "utf-8");
    const result = removeRule("foo", { rulesDir: workDir });
    expect(result.ok).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("returns ok:false when the rule isn't installed", () => {
    const result = removeRule("not-there", { rulesDir: workDir });
    expect(result.ok).toBe(false);
  });
});

describe("readInstalledRule", () => {
  it("returns the markdown body when present", () => {
    writeFileSync(rulePath({ rulesDir: workDir }, "foo"), "# Foo body", "utf-8");
    expect(readInstalledRule("foo", { rulesDir: workDir })).toBe("# Foo body");
  });

  it("returns null when the rule isn't installed", () => {
    expect(readInstalledRule("ghost", { rulesDir: workDir })).toBeNull();
  });
});
