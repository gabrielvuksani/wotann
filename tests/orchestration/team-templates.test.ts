/**
 * Tests for ClawTeam port: TOML parser, template coercion, file transport.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUILT_IN_TEMPLATES,
  coerceTemplate,
  loadAllTemplates,
  parseTemplateToml,
  renderTemplate,
} from "../../src/orchestration/team-templates.js";
import { FileTransport } from "../../src/orchestration/file-transport.js";

let prevHome: string | undefined;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "wotann-teams-"));
  prevHome = process.env.WOTANN_HOME;
  process.env.WOTANN_HOME = tempDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.WOTANN_HOME;
  else process.env.WOTANN_HOME = prevHome;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("parseTemplateToml", () => {
  it("parses basic table + array-of-tables + multiline strings", () => {
    const toml = `
[template]
name = "x"
description = "A team"
backend = "wotann"

[template.leader]
name = "lead"
task = """Multi
line
task"""

[[template.agents]]
name = "a1"
task = "do thing 1"

[[template.agents]]
name = "a2"
task = "do thing 2"
`;
    const parsed = parseTemplateToml(toml) as {
      template: { name: string; leader: { task: string }; agents: Array<{ name: string; task: string }> };
    };
    expect(parsed.template.name).toBe("x");
    expect(parsed.template.leader.task).toContain("Multi");
    expect(parsed.template.leader.task).toContain("line");
    expect(parsed.template.agents.length).toBe(2);
    expect(parsed.template.agents[0]?.name).toBe("a1");
    expect(parsed.template.agents[1]?.task).toBe("do thing 2");
  });

  it("ignores comments and blank lines", () => {
    const toml = `
# top
[template] # inline comment
name = "y"

[template.leader]
name = "L"
task = "t"
`;
    const parsed = parseTemplateToml(toml) as { template: { name: string } };
    expect(parsed.template.name).toBe("y");
  });
});

describe("coerceTemplate + renderTemplate", () => {
  it("rejects templates missing leader.task", () => {
    expect(() =>
      coerceTemplate(
        { template: { name: "n", leader: { name: "L" } } },
        "built-in",
      ),
    ).toThrow(/leader/);
  });

  it("substitutes {goal} {team_name} {agent_name}", () => {
    const parsed = parseTemplateToml(BUILT_IN_TEMPLATES["code-review"]!);
    const tpl = coerceTemplate(parsed, "built-in");
    const rendered = renderTemplate(tpl, { goal: "fix login", teamName: "alpha" });
    expect(rendered.leader.task).toContain("fix login");
    expect(rendered.leader.task).toContain("alpha");
    expect(rendered.agents[0]?.task).toContain("fix login");
  });
});

describe("loadAllTemplates", () => {
  it("returns the four built-in templates by default", () => {
    const tpls = loadAllTemplates(tempDir);
    const names = tpls.map((t) => t.name).sort();
    expect(names).toContain("code-review");
    expect(names).toContain("autopilot");
    expect(names).toContain("research-paper");
    expect(names).toContain("strategy-room");
  });
});

describe("FileTransport", () => {
  it("send -> receive moves message through inbox states", () => {
    const t = new FileTransport();
    const sent = t.send({ team: "team1", from: "alice", to: "bob", body: "hi" });
    expect(sent.id).toBeTruthy();
    expect(t.peek("team1", "bob")).toBe(1);
    const received = t.receive("team1", "bob");
    expect(received.length).toBe(1);
    expect(received[0]?.body).toBe("hi");
    expect(t.peek("team1", "bob")).toBe(0);
  });

  it("validates team and agent identifiers", () => {
    const t = new FileTransport();
    expect(() => t.send({ team: "../../etc", from: "a", to: "b", body: "" })).toThrow();
    expect(() => t.send({ team: "ok", from: "a", to: "../etc", body: "" })).toThrow();
  });

  it("history reports pending/consumed/done states", () => {
    const t = new FileTransport();
    t.send({ team: "th", from: "a", to: "b", body: "m1" });
    t.send({ team: "th", from: "a", to: "b", body: "m2" });
    t.receive("th", "b", 1); // consume one
    const hist = t.history("th", "b");
    expect(hist.length).toBe(2);
    const states = hist.map((h) => h.state).sort();
    expect(states).toContain("pending");
    expect(states).toContain("done");
  });
});
