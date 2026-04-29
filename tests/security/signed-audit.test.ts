/**
 * Tests for signed audit + policy language (protect-mcp port).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalize,
  generateAuditKey,
  getOrCreateKey,
  loadAuditKey,
  signRecord,
  verifyRecord,
} from "../../src/security/signed-audit.js";
import {
  evaluatePolicy,
  matchesMatcher,
  parsePolicy,
} from "../../src/security/policy-language.js";

let prevHome: string | undefined;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "wotann-audit-"));
  prevHome = process.env.WOTANN_HOME;
  process.env.WOTANN_HOME = tempDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.WOTANN_HOME;
  else process.env.WOTANN_HOME = prevHome;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("canonicalize", () => {
  it("sorts keys deterministically", () => {
    expect(canonicalize({ b: 1, a: 2, c: { x: 1, w: 2 } })).toBe('{"a":2,"b":1,"c":{"w":2,"x":1}}');
  });
  it("handles arrays without sorting elements", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("signRecord / verifyRecord", () => {
  it("round-trips a signed record", () => {
    const key = generateAuditKey("test1");
    const envelope = signRecord({ event: "test", actor: "agent" }, key);
    const result = verifyRecord(envelope);
    expect(result.valid).toBe(true);
  });

  it("detects tampering with the record", () => {
    const key = generateAuditKey("test2");
    const envelope = signRecord({ event: "ok" }, key);
    const tampered = { ...envelope, record: { event: "evil" } };
    const result = verifyRecord(tampered);
    expect(result.valid).toBe(false);
  });

  it("detects tampering with the signature", () => {
    const key = generateAuditKey("test3");
    const envelope = signRecord({ event: "ok" }, key);
    const tampered = { ...envelope, signature: "AAAA" };
    const result = verifyRecord(tampered);
    expect(result.valid).toBe(false);
  });

  it("getOrCreateKey returns existing or generates new", () => {
    const k1 = getOrCreateKey("persist");
    const k2 = loadAuditKey("persist");
    expect(k2?.publicPem).toBe(k1.publicPem);
  });
});

describe("policy parsing", () => {
  it("parses basic permit/forbid lines with == clauses", () => {
    const rules = parsePolicy(`
      permit(principal == "agent:reviewer", action == "tool:Read");
      forbid(principal == "agent:*", action == "tool:Bash", resource ~ "rm -rf");
    `);
    expect(rules.length).toBe(2);
    expect(rules[0]?.effect).toBe("permit");
    expect(rules[1]?.effect).toBe("forbid");
  });

  it("parses 'in' clauses with array literals", () => {
    const rules = parsePolicy(`
      permit(principal in ["agent:a","agent:b"], action == "tool:Read");
    `);
    expect(rules[0]?.principal).toEqual({ kind: "in", values: ["agent:a", "agent:b"] });
  });

  it("ignores comments and blank lines", () => {
    const rules = parsePolicy(`
      // a comment
      # another comment

      permit(principal == "x");
    `);
    expect(rules.length).toBe(1);
  });
});

describe("evaluatePolicy", () => {
  const rules = parsePolicy(`
    forbid(principal == "agent:*", action == "tool:Bash", resource ~ "rm -rf");
    permit(principal in ["agent:reviewer","agent:critic"], action == "tool:Read");
    permit(principal == "agent:builder", action == "tool:Edit", resource glob "src/**");
  `);

  it("forbid wins over permit (explicit deny)", () => {
    const d = evaluatePolicy(rules, {
      principal: "agent:builder",
      action: "tool:Bash",
      resource: "rm -rf /",
    });
    expect(d.effect).toBe("forbid");
  });

  it("permits when a permit rule matches and no forbid does", () => {
    const d = evaluatePolicy(rules, {
      principal: "agent:reviewer",
      action: "tool:Read",
      resource: "src/x.ts",
    });
    expect(d.effect).toBe("permit");
  });

  it("default deny when nothing matches", () => {
    const d = evaluatePolicy(rules, {
      principal: "agent:unknown",
      action: "tool:Read",
      resource: "/etc/passwd",
    });
    expect(d.effect).toBe("forbid");
    expect(d.matchedRule).toBeNull();
  });

  it("glob matches src/**", () => {
    const d = evaluatePolicy(rules, {
      principal: "agent:builder",
      action: "tool:Edit",
      resource: "src/foo/bar.ts",
    });
    expect(d.effect).toBe("permit");
  });
});

describe("matchesMatcher", () => {
  it("undefined matcher acts as wildcard", () => {
    expect(matchesMatcher("anything", undefined)).toBe(true);
  });
  it("eq supports literal asterisk wildcard", () => {
    expect(matchesMatcher("anything", { kind: "eq", value: "*" })).toBe(true);
  });
});
