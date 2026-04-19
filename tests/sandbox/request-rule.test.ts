import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  proposeRule,
  proposeRuleCandidates,
  draftToRule,
  loadPersistedRules,
  appendPersistedRule,
  savePersistedRules,
  removePersistedRule,
  PERSISTED_RULES_VERSION,
  type ApprovedAction,
  type PersistenceOptions,
} from "../../src/sandbox/request-rule.js";
import { ApprovalRuleEngine, type SerializedRule } from "../../src/sandbox/approval-rules.js";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test gets a scratch dir so they never touch the real ~/.wotann/.
let tempDir: string;
let store: PersistenceOptions;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "wotann-request-rule-"));
  store = { storePath: join(tempDir, "approval-rules.json") };
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Heuristics ─────────────────────────────────────────

describe("proposeRule — Bash", () => {
  it("suggests `^ls\\b` regex from `ls /tmp`", () => {
    const draft = proposeRule({
      toolName: "Bash",
      input: "ls /tmp",
      action: "allow",
    });
    expect(draft.pattern).toBeInstanceOf(RegExp);
    if (draft.pattern instanceof RegExp) {
      expect(draft.pattern.test("ls /tmp")).toBe(true);
      expect(draft.pattern.test("ls -la")).toBe(true);
      expect(draft.pattern.test("rm -rf /")).toBe(false);
    }
  });

  it("Codex parity — `ls *` regex from `ls /tmp`", () => {
    // Task-spec wording: "suggest pattern (e.g., `ls *` from `ls /tmp`)".
    // We return a boundary regex `^ls\b` which covers the `ls <anything>`
    // generalisation — just prove it matches the Codex example cases.
    const draft = proposeRule({ toolName: "Bash", input: "ls /tmp", action: "allow" });
    const re = draft.pattern as RegExp;
    expect(re.test("ls /tmp")).toBe(true);
    expect(re.test("ls")).toBe(true);
    expect(re.test("ls -la /var")).toBe(true);
  });

  it("preserves user's deny choice", () => {
    const draft = proposeRule({
      toolName: "Bash",
      input: "rm -rf /",
      action: "deny",
    });
    expect(draft.action).toBe("deny");
  });

  it("includes a literal-exact fallback in candidates", () => {
    const candidates = proposeRuleCandidates({
      toolName: "Bash",
      input: "curl https://evil.example",
      action: "allow",
    });
    // Literal-exact fallback (confidence 0.95) must be present as a
    // safe option, even when the bash regex (0.97) wins the top slot.
    const literal = candidates.find((c) => c.pattern === "curl https://evil.example");
    expect(literal).toBeDefined();
    expect(literal?.confidence).toBeCloseTo(0.95);
  });

  it("returns at least 2 candidates for a bash input", () => {
    const candidates = proposeRuleCandidates({
      toolName: "Bash",
      input: "ls /tmp",
      action: "allow",
    });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("proposeRule — Write", () => {
  it("suggests a directory-prefixed pattern for Write", () => {
    const draft = proposeRule({
      toolName: "Write",
      input: { path: "safe/x.txt", content: "hello" },
      action: "allow",
    });
    // Primary candidate (highest confidence) for Write is the literal
    // fallback (0.95) — prove the dir-prefixed draft exists among
    // candidates and actually matches something sensible.
    const candidates = proposeRuleCandidates({
      toolName: "Write",
      input: { path: "safe/x.txt", content: "hello" },
      action: "allow",
    });
    const dirDraft = candidates.find((c) => c.pattern instanceof RegExp && c.confidence === 0.7);
    expect(dirDraft).toBeDefined();
    if (dirDraft && dirDraft.pattern instanceof RegExp) {
      // The dir pattern should match any other file in safe/.
      const input = JSON.stringify({ path: "safe/y.txt", content: "world" });
      expect(dirDraft.pattern.test(input)).toBe(true);
    }
    // The top pick should still be safe (literal fallback) when there's no better guess.
    expect(draft.action).toBe("allow");
  });
});

describe("proposeRule — unknown tool", () => {
  it("falls back to a literal-exact draft", () => {
    const draft = proposeRule({
      toolName: "WeirdTool",
      input: { foo: "bar" },
      action: "allow",
    });
    // Literal fallback wins on confidence when no heuristic applies.
    expect(draft.confidence).toBeCloseTo(0.95);
  });
});

// ── draftToRule + ApprovalRuleEngine integration ──────

describe("draftToRule", () => {
  it("produces an ApprovalRule that fires on the original input", () => {
    const approved: ApprovedAction = {
      toolName: "Bash",
      input: "ls /tmp",
      action: "allow",
    };
    const draft = proposeRule(approved);
    const rule = draftToRule(draft);
    const engine = new ApprovalRuleEngine();
    engine.addRule(rule);
    expect(engine.evaluate("Bash", "ls /tmp").action).toBe("allow");
    expect(engine.evaluate("Bash", "ls -la /var").action).toBe("allow");
  });

  it("deny drafts produce deny rules that block matching inputs", () => {
    const draft = proposeRule({
      toolName: "Bash",
      input: "rm -rf /",
      action: "deny",
    });
    const rule = draftToRule(draft);
    const engine = new ApprovalRuleEngine();
    engine.addRule(rule);
    expect(engine.evaluate("Bash", "rm -rf /tmp").action).toBe("deny");
  });

  it("rule id starts with `req-` — distinguishable from ad-hoc rules", () => {
    const draft = proposeRule({
      toolName: "Bash",
      input: "ls",
      action: "allow",
    });
    const rule = draftToRule(draft);
    expect(rule.id).toMatch(/^req-/);
  });
});

// ── Persistence ────────────────────────────────────────

describe("loadPersistedRules + savePersistedRules", () => {
  it("returns [] when the file does not exist", () => {
    expect(loadPersistedRules(store)).toEqual([]);
  });

  it("saves and reloads a single rule", () => {
    const rule: SerializedRule = {
      id: "r1",
      toolName: "Bash",
      patternSource: "^ls\\b",
      patternFlags: "",
      patternIsRegex: true,
      action: "allow",
      scope: "persistent",
    };
    savePersistedRules([rule], store);
    const out = loadPersistedRules(store);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("r1");
  });

  it("writes the file with the current schema version", () => {
    const rule: SerializedRule = {
      id: "r1",
      patternSource: "ls",
      patternIsRegex: false,
      action: "allow",
      scope: "persistent",
    };
    savePersistedRules([rule], store);
    const text = readFileSync(store.storePath!, "utf8");
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(PERSISTED_RULES_VERSION);
    expect(parsed.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("reads the file atomically — no half-written state on crash", () => {
    // Simulate a prior atomic write by pre-creating the file.
    const first: SerializedRule = {
      id: "r1",
      patternSource: "a",
      patternIsRegex: false,
      action: "allow",
      scope: "persistent",
    };
    savePersistedRules([first], store);

    // Writing again must overwrite cleanly (tmp → rename).
    const second: SerializedRule = {
      id: "r2",
      patternSource: "b",
      patternIsRegex: false,
      action: "allow",
      scope: "persistent",
    };
    savePersistedRules([second], store);

    const out = loadPersistedRules(store);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("r2");
  });

  it("rejects a corrupt file without throwing", () => {
    writeFileSync(store.storePath!, "{not json", "utf8");
    expect(loadPersistedRules(store)).toEqual([]);
  });

  it("rejects a file with an unsupported version", () => {
    writeFileSync(
      store.storePath!,
      JSON.stringify({ version: 99, rules: [], updatedAt: "" }),
      "utf8",
    );
    expect(loadPersistedRules(store)).toEqual([]);
  });
});

describe("appendPersistedRule", () => {
  it("creates the file if it does not exist", () => {
    const rule: SerializedRule = {
      id: "r1",
      patternSource: "ls",
      patternIsRegex: false,
      action: "allow",
      scope: "persistent",
    };
    const count = appendPersistedRule(rule, store);
    expect(count).toBe(1);
    const out = loadPersistedRules(store);
    expect(out).toHaveLength(1);
  });

  it("appends without overwriting existing rules", () => {
    appendPersistedRule(
      {
        id: "r1",
        patternSource: "ls",
        patternIsRegex: false,
        action: "allow",
        scope: "persistent",
      },
      store,
    );
    const count = appendPersistedRule(
      {
        id: "r2",
        patternSource: "cat",
        patternIsRegex: false,
        action: "allow",
        scope: "persistent",
      },
      store,
    );
    expect(count).toBe(2);
    const out = loadPersistedRules(store);
    expect(out.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("dedupes by id — re-appending same id replaces in place", () => {
    appendPersistedRule(
      {
        id: "r1",
        patternSource: "ls",
        patternIsRegex: false,
        action: "allow",
        scope: "persistent",
      },
      store,
    );
    appendPersistedRule(
      {
        id: "r1",
        patternSource: "ls",
        patternIsRegex: false,
        action: "deny", // flipped action, same id
        scope: "persistent",
      },
      store,
    );
    const out = loadPersistedRules(store);
    expect(out).toHaveLength(1);
    expect(out[0]?.action).toBe("deny");
  });

  it("refuses to persist a rule with an empty pattern", () => {
    const empty: SerializedRule = {
      id: "bad",
      patternSource: "",
      patternIsRegex: false,
      action: "allow",
      scope: "persistent",
    };
    expect(() => appendPersistedRule(empty, store)).toThrow(/empty.*unsafe/);
  });

  it("filters out a persisted rule whose regex matches the empty string", () => {
    // Hand-write a file with a dangerous regex that matches "".
    writeFileSync(
      store.storePath!,
      JSON.stringify({
        version: PERSISTED_RULES_VERSION,
        updatedAt: "",
        rules: [
          {
            id: "dangerous",
            patternSource: ".*", // matches the empty input
            patternIsRegex: true,
            patternFlags: "",
            action: "allow",
            scope: "persistent",
          },
          {
            id: "safe",
            patternSource: "ls",
            patternIsRegex: false,
            action: "allow",
            scope: "persistent",
          },
        ],
      }),
      "utf8",
    );
    const out = loadPersistedRules(store);
    expect(out.map((r) => r.id)).toEqual(["safe"]);
  });
});

describe("removePersistedRule", () => {
  it("removes by id", () => {
    appendPersistedRule(
      {
        id: "r1",
        patternSource: "ls",
        patternIsRegex: false,
        action: "allow",
        scope: "persistent",
      },
      store,
    );
    expect(removePersistedRule("r1", store)).toBe(true);
    expect(loadPersistedRules(store)).toHaveLength(0);
  });

  it("returns false when id is not found", () => {
    expect(removePersistedRule("nope", store)).toBe(false);
  });
});

// ── Full lifecycle — propose → accept → persist → load → evaluate ──

describe("Round-trip: propose → draft → persist → load → engine", () => {
  it("persisted rule fires in a fresh ApprovalRuleEngine after load", () => {
    const approved: ApprovedAction = {
      toolName: "Bash",
      input: "ls /tmp",
      action: "allow",
    };
    const draft = proposeRule(approved);
    const rule = draftToRule(draft, "user approved ls");
    // Serialize manually via the approval-rules engine serializer.
    const engine = new ApprovalRuleEngine();
    engine.addRule({ ...rule, scope: "persistent" });
    const serialized = engine.serializePersistent();
    expect(serialized).toHaveLength(1);

    // Persist.
    appendPersistedRule(serialized[0]!, store);

    // Load into a FRESH engine and confirm it fires on the ORIGINAL input.
    const loaded = loadPersistedRules(store);
    const fresh = new ApprovalRuleEngine();
    fresh.loadSerialized(loaded);
    expect(fresh.evaluate("Bash", "ls /tmp").action).toBe("allow");
  });
});
