import { describe, it, expect } from "vitest";
import {
  ApprovalRuleEngine,
  makeSessionAllowRule,
  type ApprovalRule,
} from "../../src/sandbox/approval-rules.js";

function rule(overrides: Partial<ApprovalRule> & { id: string }): ApprovalRule {
  return {
    pattern: "",
    action: "allow",
    scope: "session",
    ...overrides,
  };
}

describe("ApprovalRuleEngine — evaluate", () => {
  it("returns ask when no rules installed", () => {
    const e = new ApprovalRuleEngine();
    const r = e.evaluate("Bash", "ls -la");
    expect(r.action).toBe("ask");
    expect(r.matchedRuleId).toBeNull();
  });

  it("matches string literal pattern", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", toolName: "Bash", pattern: "ls" }));
    expect(e.evaluate("Bash", "ls -la").action).toBe("allow");
    expect(e.evaluate("Bash", "rm -rf /").action).toBe("ask");
  });

  it("matches regex pattern", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", toolName: "Bash", pattern: /^ls\s+/ }));
    expect(e.evaluate("Bash", "ls -la").action).toBe("allow");
    expect(e.evaluate("Bash", "mv ls file.txt").action).toBe("ask");
  });

  it("respects toolName — does not match different tool", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", toolName: "Bash", pattern: "ls" }));
    expect(e.evaluate("Write", "ls").action).toBe("ask");
  });

  it("omitted toolName matches ANY tool", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", pattern: "safe" }));
    expect(e.evaluate("Bash", "safe command").action).toBe("allow");
    expect(e.evaluate("Write", "safe file").action).toBe("allow");
  });

  it("deny action returns deny", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", toolName: "Bash", pattern: /rm\s+-rf/, action: "deny" }));
    expect(e.evaluate("Bash", "rm -rf /").action).toBe("deny");
  });

  it("first-match-wins — earlier rules take precedence", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", toolName: "Bash", pattern: "ls", action: "allow" }));
    e.addRule(rule({ id: "r2", toolName: "Bash", pattern: "ls", action: "deny" }));
    expect(e.evaluate("Bash", "ls -la").action).toBe("allow");
  });

  it("expired rules are ignored", () => {
    const now = 1_000_000;
    const e = new ApprovalRuleEngine({ now: () => now });
    e.addRule(rule({ id: "old", pattern: "x", expiresAt: now - 1 }));
    e.addRule(rule({ id: "fresh", pattern: "x", expiresAt: now + 1000 }));
    const r = e.evaluate("Bash", "x");
    expect(r.matchedRuleId).toBe("fresh");
  });

  it("stringifies object inputs for pattern matching", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", pattern: /"path":"safe\// }));
    expect(e.evaluate("Write", { path: "safe/x.txt", content: "" }).action).toBe("allow");
    expect(e.evaluate("Write", { path: "/etc/passwd", content: "" }).action).toBe("ask");
  });

  it("handles null and undefined inputs", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", pattern: "" })); // empty pattern matches everything
    expect(e.evaluate("Bash", null).action).toBe("allow");
    expect(e.evaluate("Bash", undefined).action).toBe("allow");
  });
});

describe("ApprovalRuleEngine — lifecycle", () => {
  it("addRule requires id", () => {
    const e = new ApprovalRuleEngine();
    expect(() =>
      e.addRule({ id: "", pattern: "x", action: "allow", scope: "session" }),
    ).toThrow(/id is required/);
  });

  it("removeRule removes by id", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", pattern: "x" }));
    expect(e.removeRule("r1")).toBe(true);
    expect(e.removeRule("r1")).toBe(false);
    expect(e.listRules()).toHaveLength(0);
  });

  it("listRules returns snapshot", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "r1", pattern: "x" }));
    const snap1 = e.listRules();
    e.addRule(rule({ id: "r2", pattern: "y" }));
    const snap2 = e.listRules();
    expect(snap1).toHaveLength(1);
    expect(snap2).toHaveLength(2);
  });

  it("clearSessionRules drops session-scoped only", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "s1", pattern: "x", scope: "session" }));
    e.addRule(rule({ id: "p1", pattern: "y", scope: "persistent" }));
    e.addRule(rule({ id: "s2", pattern: "z", scope: "session" }));
    const cleared = e.clearSessionRules();
    expect(cleared).toBe(2);
    expect(e.listRules()).toHaveLength(1);
    expect(e.listRules()[0]?.id).toBe("p1");
  });
});

describe("ApprovalRuleEngine — serialization", () => {
  it("serializePersistent includes ONLY persistent rules", () => {
    const e = new ApprovalRuleEngine();
    e.addRule(rule({ id: "s1", pattern: "x", scope: "session" }));
    e.addRule(rule({ id: "p1", pattern: /y/, scope: "persistent" }));
    const ser = e.serializePersistent();
    expect(ser).toHaveLength(1);
    expect(ser[0]?.id).toBe("p1");
    expect(ser[0]?.patternIsRegex).toBe(true);
  });

  it("loadSerialized reinstates rules", () => {
    const e1 = new ApprovalRuleEngine();
    e1.addRule(rule({ id: "p1", pattern: /ls/, scope: "persistent", toolName: "Bash" }));
    const json = e1.serializePersistent();
    const e2 = new ApprovalRuleEngine();
    const loaded = e2.loadSerialized(json);
    expect(loaded).toBe(1);
    expect(e2.evaluate("Bash", "ls -la").action).toBe("allow");
  });

  it("loadSerialized skips invalid regex", () => {
    const e = new ApprovalRuleEngine();
    const loaded = e.loadSerialized([
      {
        id: "bad",
        patternSource: "[invalid regex",
        patternIsRegex: true,
        action: "allow",
        scope: "persistent",
      },
    ]);
    expect(loaded).toBe(0);
  });

  it("round-trips a literal-string pattern", () => {
    const e1 = new ApprovalRuleEngine();
    e1.addRule(rule({ id: "p1", pattern: "literal", scope: "persistent" }));
    const json = e1.serializePersistent();
    expect(json[0]?.patternIsRegex).toBe(false);
    const e2 = new ApprovalRuleEngine();
    e2.loadSerialized(json);
    expect(e2.evaluate("Bash", "some literal thing").action).toBe("allow");
  });
});

describe("makeSessionAllowRule", () => {
  it("produces a session/allow rule with fresh id", () => {
    const r = makeSessionAllowRule("Bash", /^ls/);
    expect(r.action).toBe("allow");
    expect(r.scope).toBe("session");
    expect(r.toolName).toBe("Bash");
    expect(r.id).toMatch(/^rule-/);
  });

  it("generates unique ids on rapid calls", () => {
    const a = makeSessionAllowRule(undefined, "x");
    const b = makeSessionAllowRule(undefined, "x");
    expect(a.id).not.toBe(b.id);
  });
});
