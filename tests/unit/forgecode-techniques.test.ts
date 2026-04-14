import { describe, it, expect } from "vitest";
import {
  optimizeToolSchema,
  DoomLoopFingerprinter,
  getModelProfile,
  correctToolCallArgs,
  runPreCompletionChecklist,
  discoverEntryPoints,
  allocateReasoningBudget,
} from "../../src/intelligence/forgecode-techniques.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Technique 1: Schema Optimization ──────────────────────

describe("optimizeToolSchema", () => {
  it("places required before properties in output", () => {
    const schema = {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path" },
        content: { type: "string", description: "Content" },
      },
      required: ["file_path"],
    };

    const optimized = optimizeToolSchema(schema);
    const keys = Object.keys(optimized);

    const reqIndex = keys.indexOf("required");
    const propIndex = keys.indexOf("properties");
    expect(reqIndex).toBeLessThan(propIndex);
  });

  it("sorts properties alphabetically", () => {
    const schema = {
      type: "object",
      properties: {
        zebra: { type: "string" },
        alpha: { type: "string" },
        middle: { type: "string" },
      },
    };

    const optimized = optimizeToolSchema(schema);
    const props = optimized["properties"] as Record<string, unknown>;
    const propKeys = Object.keys(props);
    expect(propKeys).toEqual(["alpha", "middle", "zebra"]);
  });

  it("sorts required array alphabetically", () => {
    const schema = {
      type: "object",
      required: ["content", "file_path", "action"],
      properties: {
        file_path: { type: "string" },
        content: { type: "string" },
        action: { type: "string" },
      },
    };

    const optimized = optimizeToolSchema(schema);
    expect(optimized["required"]).toEqual(["action", "content", "file_path"]);
  });

  it("strips empty descriptions", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", description: "" },
        age: { type: "number", description: "User age" },
      },
    };

    const optimized = optimizeToolSchema(schema);
    const props = optimized["properties"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(props["name"]?.["description"]).toBeUndefined();
    expect(props["age"]?.["description"]).toBe("User age");
  });

  it("preserves extra top-level keys", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    };

    const optimized = optimizeToolSchema(schema);
    expect(optimized["additionalProperties"]).toBe(false);
  });
});

// ── Technique 2: Doom Loop Fingerprinting ─────────────────

describe("DoomLoopFingerprinter", () => {
  it("does not flag non-repeating calls", () => {
    const fp = new DoomLoopFingerprinter();
    const r1 = fp.record("Read", { file_path: "/a.ts" });
    const r2 = fp.record("Write", { file_path: "/b.ts" });
    expect(r1.isDoomLoop).toBe(false);
    expect(r2.isDoomLoop).toBe(false);
  });

  it("flags 3+ identical consecutive calls", () => {
    const fp = new DoomLoopFingerprinter(3);
    const args = { file_path: "/stuck.ts" };
    fp.record("Read", args);
    fp.record("Read", args);
    const third = fp.record("Read", args);
    expect(third.isDoomLoop).toBe(true);
    expect(third.consecutiveCount).toBe(3);
    expect(third.warning).toContain("Doom loop");
  });

  it("resets consecutive count when different call intervenes", () => {
    const fp = new DoomLoopFingerprinter(3);
    const args = { file_path: "/stuck.ts" };
    fp.record("Read", args);
    fp.record("Read", args);
    fp.record("Write", { file_path: "/other.ts" });
    const fourth = fp.record("Read", args);
    expect(fourth.isDoomLoop).toBe(false);
    expect(fourth.consecutiveCount).toBe(1);
  });

  it("reset clears history", () => {
    const fp = new DoomLoopFingerprinter();
    fp.record("Read", { file_path: "/a.ts" });
    fp.record("Read", { file_path: "/a.ts" });
    fp.reset();
    expect(fp.getHistoryLength()).toBe(0);
  });

  it("trims history beyond maxHistory", () => {
    const fp = new DoomLoopFingerprinter(3, 5);
    for (let i = 0; i < 10; i++) {
      fp.record("Read", { file_path: `/file-${i}.ts` });
    }
    expect(fp.getHistoryLength()).toBe(5);
  });

  it("produces consistent fingerprints for identical inputs", () => {
    const fp = new DoomLoopFingerprinter();
    const r1 = fp.record("Read", { file_path: "/a.ts" });
    const r2 = fp.record("Read", { file_path: "/a.ts" });
    expect(r1.fingerprint).toBe(r2.fingerprint);
  });
});

// ── Technique 3: Model-Specific Harness Adaptation ────────

describe("getModelProfile", () => {
  it("returns known profile for claude-opus-4-6", () => {
    const profile = getModelProfile("anthropic", "claude-opus-4-6");
    expect(profile.model).toBe("claude-opus-4-6");
    expect(profile.provider).toBe("anthropic");
    expect(profile.promptStyle).toBe("xml");
    expect(profile.thinkingStyle).toBe("native-extended");
    expect(profile.maxToolCallsPerTurn).toBeGreaterThan(0);
  });

  it("returns known profile for gpt-5.4", () => {
    const profile = getModelProfile("openai", "gpt-5.4");
    expect(profile.model).toBe("gpt-5.4");
    expect(profile.promptStyle).toBe("markdown");
  });

  it("returns default profile for unknown model", () => {
    const profile = getModelProfile("unknown-provider", "unknown-model");
    expect(profile.model).toBe("unknown-model");
    expect(profile.provider).toBe("unknown-provider");
    expect(profile.promptStyle).toBe("markdown");
  });
});

// ── Technique 4: Tool-Call Argument Correction ────────────

describe("correctToolCallArgs", () => {
  it("renames common aliases for Read tool", () => {
    const corrected = correctToolCallArgs("Read", {
      path: "/foo.ts",
      filename: "/bar.ts",
    });
    expect(corrected["file_path"]).toBe("/bar.ts");
    // "path" is also an alias
    expect(corrected["file_path"]).toBeDefined();
  });

  it("renames aliases for Edit tool", () => {
    const corrected = correctToolCallArgs("Edit", {
      path: "/foo.ts",
      search: "old text",
      replace: "new text",
    });
    expect(corrected["file_path"]).toBe("/foo.ts");
    expect(corrected["old_string"]).toBe("old text");
    expect(corrected["new_string"]).toBe("new text");
  });

  it("normalizes backslashes in paths", () => {
    const corrected = correctToolCallArgs("Read", {
      file_path: "C:\\Users\\test\\file.ts",
    });
    expect(corrected["file_path"]).toBe("C:/Users/test/file.ts");
  });

  it("strips trailing whitespace from strings", () => {
    const corrected = correctToolCallArgs("Bash", {
      command: "ls -la   ",
    });
    expect(corrected["command"]).toBe("ls -la");
  });

  it("converts number-strings for known numeric fields", () => {
    const corrected = correctToolCallArgs("Grep", {
      pattern: "test",
      limit: "50",
    });
    expect(corrected["limit"]).toBe(50);
  });

  it("passes through unknown tool names without alias mapping", () => {
    const corrected = correctToolCallArgs("CustomTool", {
      foo: "bar",
      baz: 42,
    });
    expect(corrected["foo"]).toBe("bar");
    expect(corrected["baz"]).toBe(42);
  });
});

// ── Technique 5: Pre-Completion Checklist ─────────────────

describe("runPreCompletionChecklist", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("passes when source files exist and no TODOs", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-checklist-"));
    writeFileSync(
      join(tempDir, "main.ts"),
      'export function main() { return "hello"; }\n',
    );

    const result = runPreCompletionChecklist("create a main function", tempDir);
    expect(result.allPassed).toBe(true);
    expect(result.failedItems.length).toBe(0);
  });

  it("fails when no source files exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-checklist-"));
    // Empty directory

    const result = runPreCompletionChecklist("create something", tempDir);
    const fileCheck = result.checks.find((c) => c.check === "files-modified");
    expect(fileCheck?.passed).toBe(false);
  });

  it("flags TODO markers", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-checklist-"));
    writeFileSync(
      join(tempDir, "app.ts"),
      "// TODO: implement this\nexport function app() {}\n",
    );

    const result = runPreCompletionChecklist("create app", tempDir);
    const todoCheck = result.checks.find((c) => c.check === "no-todos");
    expect(todoCheck?.passed).toBe(false);
    expect(todoCheck?.evidence).toContain("TODO");
  });

  it("flags stub implementations", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-checklist-"));
    writeFileSync(
      join(tempDir, "service.ts"),
      'export function serve() { throw new Error("not implemented"); }\n',
    );

    const result = runPreCompletionChecklist("create service", tempDir);
    const stubCheck = result.checks.find((c) => c.check === "no-stubs");
    expect(stubCheck?.passed).toBe(false);
  });
});

// ── Technique 6: Semantic Entry-Point Discovery ───────────

describe("discoverEntryPoints", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("discovers index.ts as an entry point", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-entry-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "src", "index.ts"),
      "export function start() {}\n",
    );

    const entries = discoverEntryPoints(tempDir);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.type === "index")).toBe(true);
  });

  it("discovers package.json as config entry point", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-entry-"));
    writeFileSync(
      join(tempDir, "package.json"),
      '{ "name": "test" }\n',
    );

    const entries = discoverEntryPoints(tempDir);
    expect(entries.some((e) => e.type === "config")).toBe(true);
  });

  it("returns sorted by confidence (highest first)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-entry-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "package.json"), "{}");
    writeFileSync(join(tempDir, "src", "index.ts"), "export const x = 1;\n");

    const entries = discoverEntryPoints(tempDir);
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const curr = entries[i];
      if (prev && curr) {
        expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
      }
    }
  });

  it("returns empty for non-existent directory", () => {
    const entries = discoverEntryPoints("/nonexistent/path/xyz");
    expect(entries.length).toBe(0);
  });
});

// ── Technique 7: Reasoning Budget Control ─────────────────

describe("allocateReasoningBudget", () => {
  it("classifies simple tasks as low complexity", () => {
    const budget = allocateReasoningBudget("fix typo in readme", 20, "high");
    expect(budget.taskComplexity).toBe("low");
    expect(budget.thinkingTokenBudget).toBeLessThan(5000);
    expect(budget.maxTurns).toBeLessThanOrEqual(5);
  });

  it("classifies feature implementation as high complexity", () => {
    const budget = allocateReasoningBudget(
      "implement the user authentication feature with OAuth2",
      30,
      "high",
    );
    expect(budget.taskComplexity).toBe("high");
    expect(budget.thinkingTokenBudget).toBeGreaterThan(10000);
  });

  it("classifies architecture tasks as extreme complexity", () => {
    const budget = allocateReasoningBudget(
      "redesign the distributed message queue system",
      10,
      "high",
    );
    expect(budget.taskComplexity).toBe("extreme");
    expect(budget.allowedStrategies).toContain("parallel-agents");
  });

  it("scales down budget when context is high", () => {
    const normalBudget = allocateReasoningBudget(
      "implement feature X",
      30,
      "high",
    );
    const constrainedBudget = allocateReasoningBudget(
      "implement feature X",
      80,
      "high",
    );
    expect(constrainedBudget.thinkingTokenBudget).toBeLessThan(
      normalBudget.thinkingTokenBudget,
    );
  });

  it("scales down budget for lower capability models", () => {
    const highCap = allocateReasoningBudget(
      "implement feature X",
      30,
      "high",
    );
    const lowCap = allocateReasoningBudget(
      "implement feature X",
      30,
      "low",
    );
    expect(lowCap.thinkingTokenBudget).toBeLessThan(
      highCap.thinkingTokenBudget,
    );
  });

  it("returns medium for ambiguous tasks", () => {
    const budget = allocateReasoningBudget(
      "update the config to use the new values for the database",
      30,
      "high",
    );
    expect(budget.taskComplexity).toBe("medium");
  });
});
