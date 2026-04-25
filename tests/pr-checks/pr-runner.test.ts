/**
 * PR runner — verifies the actual contract:
 *   - Markdown frontmatter parses strictly
 *   - Pluggable runCheck is invoked with each def
 *   - Errors are surfaced as ERROR results, never silent PASS
 *   - Overall conclusion respects severity rules
 *
 * QB #14: tests verify real orchestration, not stubs returning hard-coded PASS.
 */

import { describe, expect, it } from "vitest";
import {
  loadCheckDefs,
  parseCheckMarkdown,
  parseModelResponse,
  runPrChecks,
  runCheckEcho,
} from "../../src/pr-checks/pr-runner.js";

describe("parseCheckMarkdown", () => {
  it("parses valid frontmatter + body", () => {
    const md = [
      "---",
      "id: no-todos",
      "severity: blocking",
      "provider: anthropic",
      "model: sonnet",
      "---",
      "Reject any new TODO comment.",
      "",
      "Respond PASS or FAIL.",
    ].join("\n");
    const parsed = parseCheckMarkdown(md, "no-todos.md");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.def.id).toBe("no-todos");
      expect(parsed.def.severity).toBe("blocking");
      expect(parsed.def.provider).toBe("anthropic");
      expect(parsed.def.model).toBe("sonnet");
      expect(parsed.def.body).toContain("Reject any new TODO");
    }
  });

  it("defaults severity to advisory when omitted", () => {
    const md = ["---", "id: x", "---", "body"].join("\n");
    const parsed = parseCheckMarkdown(md, "x.md");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.def.severity).toBe("advisory");
  });

  it("rejects missing frontmatter delimiter", () => {
    const md = "no frontmatter here";
    const parsed = parseCheckMarkdown(md, "x.md");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/frontmatter/);
  });

  it("rejects missing id field", () => {
    const md = ["---", "severity: blocking", "---", "body"].join("\n");
    const parsed = parseCheckMarkdown(md, "x.md");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/id/);
  });

  it("rejects invalid severity", () => {
    const md = ["---", "id: x", "severity: bogus", "---", "body"].join("\n");
    const parsed = parseCheckMarkdown(md, "x.md");
    expect(parsed.ok).toBe(false);
  });

  it("rejects empty body — body is the system prompt", () => {
    const md = ["---", "id: x", "---", ""].join("\n");
    const parsed = parseCheckMarkdown(md, "x.md");
    expect(parsed.ok).toBe(false);
  });

  it("rejects non-kebab-case id", () => {
    const md = ["---", "id: Bad_ID", "---", "body"].join("\n");
    const parsed = parseCheckMarkdown(md, "x.md");
    expect(parsed.ok).toBe(false);
  });
});

describe("parseModelResponse", () => {
  it("recognizes PASS", () => {
    expect(parseModelResponse("PASS").status).toBe("pass");
    expect(parseModelResponse("PASS:").status).toBe("pass");
    expect(parseModelResponse("PASS: clean").status).toBe("pass");
  });

  it("extracts FAIL reason", () => {
    const r = parseModelResponse("FAIL: hardcoded API key on line 7");
    expect(r.status).toBe("fail");
    expect(r.message).toBe("hardcoded API key on line 7");
  });

  it("returns neutral on unparseable response", () => {
    expect(parseModelResponse("hmm let me think").status).toBe("neutral");
    expect(parseModelResponse("").status).toBe("neutral");
  });
});

describe("loadCheckDefs", () => {
  it("loads multiple defs and skips invalid ones", async () => {
    const files = ["a.md", "b.md", "c.txt", "bad.md"];
    const contents: Record<string, string> = {
      "a.md": "---\nid: a\nseverity: blocking\n---\nA body",
      "b.md": "---\nid: b\nseverity: advisory\n---\nB body",
      "bad.md": "no frontmatter",
    };

    const result = await loadCheckDefs(".wotann/checks", {
      readdirFn: async () => files,
      readFileFn: async (p: string) => {
        const f = p.split("/").pop() ?? "";
        return contents[f] ?? "";
      },
      statFn: async () => ({ isFile: () => true }),
    });

    expect(result.defs.length).toBe(2);
    expect(result.defs.map((d) => d.id).sort()).toEqual(["a", "b"]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.filename).toBe("bad.md");
  });

  it("returns empty + error if dir cannot be read", async () => {
    const result = await loadCheckDefs(".wotann/checks", {
      readdirFn: async () => {
        throw new Error("ENOENT");
      },
      readFileFn: async () => "",
      statFn: async () => ({ isFile: () => true }),
    });
    expect(result.defs.length).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.error).toContain("ENOENT");
  });
});

describe("runPrChecks", () => {
  const stubFs = {
    readdirFn: async () => ["one.md", "two.md"],
    readFileFn: async (p: string) => {
      if (p.endsWith("one.md"))
        return "---\nid: one\nseverity: blocking\n---\nReject hardcoded keys.";
      return "---\nid: two\nseverity: advisory\n---\nFlag missing JSDoc.";
    },
    statFn: async () => ({ isFile: () => true }),
  };

  it("invokes runCheck for each def with the diff", async () => {
    const seen: string[] = [];
    const summary = await runPrChecks({
      ...stubFs,
      prDiff: "diff --git a/x b/x\n",
      runCheck: async (def, diff) => {
        seen.push(def.id);
        expect(diff).toContain("diff --git");
        return {
          id: def.id,
          status: "pass",
          message: "PASS:",
          severity: def.severity,
          durationMs: 1,
        };
      },
    });
    expect(seen.sort()).toEqual(["one", "two"]);
    expect(summary.overall).toBe("success");
    expect(summary.results.length).toBe(2);
  });

  it("FAIL+blocking → overall failure; FAIL+advisory → overall neutral", async () => {
    const failBlocking = await runPrChecks({
      ...stubFs,
      prDiff: "",
      runCheck: async (def) => ({
        id: def.id,
        status: def.id === "one" ? "fail" : "pass",
        message: def.id === "one" ? "FAIL: bad" : "PASS",
        severity: def.severity,
        durationMs: 0,
      }),
    });
    expect(failBlocking.overall).toBe("failure");

    const failAdvisory = await runPrChecks({
      ...stubFs,
      prDiff: "",
      runCheck: async (def) => ({
        id: def.id,
        status: def.id === "two" ? "fail" : "pass",
        message: def.id === "two" ? "FAIL: meh" : "PASS",
        severity: def.severity,
        durationMs: 0,
      }),
    });
    expect(failAdvisory.overall).toBe("neutral");
  });

  it("reports parse errors as ERROR results — never silent PASS", async () => {
    const summary = await runPrChecks({
      readdirFn: async () => ["broken.md"],
      readFileFn: async () => "no frontmatter",
      statFn: async () => ({ isFile: () => true }),
      prDiff: "",
      runCheck: async () => {
        throw new Error("should not be called for broken def");
      },
    });
    expect(summary.results.length).toBe(1);
    expect(summary.results[0]?.status).toBe("error");
  });

  it("catches thrown runCheck and turns it into ERROR result", async () => {
    const summary = await runPrChecks({
      ...stubFs,
      prDiff: "",
      runCheck: async () => {
        throw new Error("model down");
      },
    });
    expect(summary.results.every((r) => r.status === "error")).toBe(true);
    expect(summary.results[0]?.message).toContain("model down");
  });

  it("runCheckEcho returns PASS without calling any model", async () => {
    const summary = await runPrChecks({
      ...stubFs,
      prDiff: "",
      runCheck: runCheckEcho,
    });
    expect(summary.overall).toBe("success");
    expect(summary.results.every((r) => r.status === "pass")).toBe(true);
  });

  it("filter() controls which checks run", async () => {
    const summary = await runPrChecks({
      ...stubFs,
      prDiff: "",
      runCheck: runCheckEcho,
      filter: (filename) => filename === "one.md",
    });
    expect(summary.results.length).toBe(1);
    expect(summary.results[0]?.id).toBe("one");
  });
});
