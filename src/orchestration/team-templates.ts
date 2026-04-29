/**
 * Team templates — TOML-driven multi-agent team specifications.
 *
 * Port of HKUDS/ClawTeam's clawteam/templates/*.toml + spawn module.
 * A template names the team, lists a leader + N agents, and gives each
 * a task prompt that references {goal}, {team_name}, and {agent_name}.
 *
 * Templates live in:
 *   1. <project>/.wotann/team-templates/<name>.toml (project-level)
 *   2. ~/.wotann/team-templates/<name>.toml (user-level)
 *   3. The built-in templates baked into the package (read-only)
 *
 * Resolution order is project -> user -> built-in. The first match wins.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

export interface AgentSpec {
  readonly name: string;
  readonly type: string;
  readonly task: string;
  readonly model?: string;
}

export interface TeamTemplate {
  readonly name: string;
  readonly description: string;
  readonly invokeArgs: ReadonlyArray<string>;
  readonly backend: "tmux" | "wotann" | "none";
  readonly leader: AgentSpec;
  readonly agents: ReadonlyArray<AgentSpec>;
  readonly source: "project" | "user" | "built-in";
  readonly path?: string;
}

export function parseTemplateToml(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  let cursor: Record<string, unknown> = root;
  let inMultilineKey: string | null = null;
  let multilineBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (inMultilineKey) {
      if (raw.trimEnd().endsWith('"""')) {
        const tail = raw.replace(/"""\s*$/, "");
        multilineBuffer.push(tail);
        cursor[inMultilineKey] = multilineBuffer.join("\n");
        inMultilineKey = null;
        multilineBuffer = [];
      } else {
        multilineBuffer.push(raw);
      }
      continue;
    }
    const line = raw.replace(/(^|[^\\])#.*$/, "$1").trim();
    if (line.length === 0) continue;

    const arrayHeader = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line);
    if (arrayHeader) {
      const path = arrayHeader[1]!.split(".").map((p) => p.trim());
      cursor = ensureArrayPath(root, path);
      continue;
    }
    const tableHeader = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (tableHeader) {
      const path = tableHeader[1]!.split(".").map((p) => p.trim());
      cursor = ensureTablePath(root, path);
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const valuePart = kv[2]!;
    if (valuePart.startsWith('"""')) {
      const remainder = valuePart.slice(3);
      if (remainder.endsWith('"""')) {
        cursor[key] = remainder.slice(0, -3);
      } else {
        inMultilineKey = key;
        multilineBuffer = [remainder];
      }
      continue;
    }
    cursor[key] = parseScalar(valuePart);
  }
  return root;
}

function ensureTablePath(
  root: Record<string, unknown>,
  path: ReadonlyArray<string>,
): Record<string, unknown> {
  let cur: Record<string, unknown> = root;
  for (const part of path) {
    if (!cur[part] || typeof cur[part] !== "object" || Array.isArray(cur[part])) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  return cur;
}

function ensureArrayPath(
  root: Record<string, unknown>,
  path: ReadonlyArray<string>,
): Record<string, unknown> {
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const part = path[i]!;
    if (!cur[part] || typeof cur[part] !== "object" || Array.isArray(cur[part])) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  const last = path[path.length - 1]!;
  if (!Array.isArray(cur[last])) cur[last] = [];
  const arr = cur[last] as Array<Record<string, unknown>>;
  const next: Record<string, unknown> = {};
  arr.push(next);
  return next;
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((p) => parseScalar(p));
  }
  const num = Number(trimmed);
  if (!Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(trimmed)) return num;
  return trimmed;
}

export function coerceTemplate(
  parsed: Record<string, unknown>,
  source: TeamTemplate["source"],
  path?: string,
): TeamTemplate {
  const tpl = (parsed.template as Record<string, unknown>) ?? {};
  const leader = (tpl.leader as Record<string, unknown>) ?? {};
  const agents = (tpl.agents as Array<Record<string, unknown>>) ?? [];

  if (typeof tpl.name !== "string") {
    throw new Error(`Template ${path ?? "(unknown)"} missing [template].name`);
  }
  if (typeof leader.name !== "string" || typeof leader.task !== "string") {
    throw new Error(`Template ${path ?? "(unknown)"} missing [template.leader] name or task`);
  }
  return {
    name: tpl.name,
    description: typeof tpl.description === "string" ? tpl.description : "",
    invokeArgs: Array.isArray(tpl.invoke_args) ? (tpl.invoke_args as string[]) : ["wotann"],
    backend: ((tpl.backend as string) ?? "wotann") as TeamTemplate["backend"],
    leader: {
      name: leader.name,
      type: typeof leader.type === "string" ? leader.type : leader.name,
      task: leader.task,
      model: typeof leader.model === "string" ? leader.model : undefined,
    },
    agents: agents
      .map((a) => ({
        name: typeof a.name === "string" ? a.name : "",
        type: typeof a.type === "string" ? a.type : typeof a.name === "string" ? a.name : "",
        task: typeof a.task === "string" ? a.task : "",
        model: typeof a.model === "string" ? a.model : undefined,
      }))
      .filter((a) => a.name.length > 0 && a.task.length > 0),
    source,
    path,
  };
}

export function renderTemplate(
  tpl: TeamTemplate,
  vars: { readonly goal: string; readonly teamName: string },
): TeamTemplate {
  const fill = (s: string, agentName: string): string =>
    s
      .replace(/\{goal\}/g, vars.goal)
      .replace(/\{team_name\}/g, vars.teamName)
      .replace(/\{agent_name\}/g, agentName);

  return {
    ...tpl,
    leader: { ...tpl.leader, task: fill(tpl.leader.task, tpl.leader.name) },
    agents: tpl.agents.map((a) => ({ ...a, task: fill(a.task, a.name) })),
  };
}

const PROJECT_TEMPLATE_DIR = ".wotann/team-templates";
const USER_TEMPLATE_SUBDIR = "team-templates";

export function listTemplateSearchDirs(
  cwd: string = process.cwd(),
): ReadonlyArray<{ readonly source: TeamTemplate["source"]; readonly dir: string }> {
  return [
    { source: "project", dir: join(cwd, PROJECT_TEMPLATE_DIR) },
    { source: "user", dir: resolveWotannHomeSubdir(USER_TEMPLATE_SUBDIR) },
  ];
}

export function loadAllTemplates(cwd: string = process.cwd()): ReadonlyArray<TeamTemplate> {
  const found = new Map<string, TeamTemplate>();
  for (const { source, dir } of listTemplateSearchDirs(cwd)) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".toml")) continue;
      const path = join(dir, entry);
      try {
        const parsed = parseTemplateToml(readFileSync(path, "utf8"));
        const tpl = coerceTemplate(parsed, source, path);
        if (!found.has(tpl.name)) found.set(tpl.name, tpl);
      } catch {
        // skip malformed templates rather than failing the whole listing
      }
    }
  }
  for (const [name, body] of Object.entries(BUILT_IN_TEMPLATES)) {
    if (found.has(name)) continue;
    const parsed = parseTemplateToml(body);
    found.set(name, coerceTemplate(parsed, "built-in"));
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadTemplate(name: string, cwd: string = process.cwd()): TeamTemplate | null {
  return loadAllTemplates(cwd).find((t) => t.name === name) ?? null;
}

export function ensureUserTemplateDir(): string {
  const dir = resolveWotannHomeSubdir(USER_TEMPLATE_SUBDIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeUserTemplate(name: string, body: string): string {
  const dir = ensureUserTemplateDir();
  const path = join(dir, `${name}.toml`);
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
  return path;
}

export const BUILT_IN_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
  "code-review": `
[template]
name = "code-review"
description = "Multi-perspective PR review: security + performance + style + clarity"
invoke_args = ["wotann"]
backend = "wotann"

[template.leader]
name = "lead-reviewer"
type = "synthesizer"
task = """You coordinate a multi-perspective PR review.
Goal: {goal}
Team: {team_name}

Workflow:
1. Wait until all reviewer tasks complete (poll the team board).
2. Collect findings from inbox.
3. Synthesize into: must-fix / should-fix / nice-to-have / verdict.
4. Mark task completed."""

[[template.agents]]
name = "security-reviewer"
type = "security"
task = """Review {goal} for security: input validation, auth, secrets,
unsafe deserialization, dependency CVEs, race exploits.
Send findings to lead-reviewer with prefix SECURITY:."""

[[template.agents]]
name = "performance-reviewer"
type = "performance"
task = """Review {goal} for performance: algorithmic complexity, N+1
queries, missing indexes, unnecessary serialization, memory leaks.
Send findings to lead-reviewer with prefix PERF:."""

[[template.agents]]
name = "style-reviewer"
type = "style"
task = """Review {goal} for code style: naming, structure, comments,
test coverage, error handling, dead code.
Send findings to lead-reviewer with prefix STYLE:."""
`,
  autopilot: `
[template]
name = "autopilot"
description = "Autonomous build team — planner + builder + verifier"
invoke_args = ["wotann"]
backend = "wotann"

[template.leader]
name = "planner"
type = "planner"
task = """Plan and dispatch work for: {goal}
Team: {team_name}

Workflow:
1. Decompose the goal into 3-7 ordered steps.
2. Assign each step to builder via inbox.
3. After verifier reports back, decide ship or revise."""

[[template.agents]]
name = "builder"
type = "builder"
task = """Implement steps from {team_name}'s planner. Send progress
updates to verifier as you complete each step."""

[[template.agents]]
name = "verifier"
type = "verifier"
task = """Verify each step from builder by running tests, type-check,
and an integration smoke. Report pass/fail to planner."""
`,
  "research-paper": `
[template]
name = "research-paper"
description = "Research paper team — outline + sections + citations + critic"
invoke_args = ["wotann"]
backend = "wotann"

[template.leader]
name = "editor-in-chief"
type = "editor"
task = """Coordinate writing of: {goal}
Team: {team_name}
Workflow: outline -> sections -> citations -> critic pass -> publish."""

[[template.agents]]
name = "outliner"
type = "outliner"
task = """Produce a 5-7 section outline for {goal}, send to editor-in-chief."""

[[template.agents]]
name = "section-writer"
type = "writer"
task = """Draft one section per inbox message; cite sources inline."""

[[template.agents]]
name = "critic"
type = "critic"
task = """Critically review draft sections: clarity, evidence, gaps,
counter-arguments. Send feedback to editor-in-chief."""
`,
  "strategy-room": `
[template]
name = "strategy-room"
description = "Decision-making team — three viewpoints + facilitator"
invoke_args = ["wotann"]
backend = "wotann"

[template.leader]
name = "facilitator"
type = "facilitator"
task = """Facilitate a decision about: {goal}
Team: {team_name}
Workflow: collect each viewpoint, surface tradeoffs, prompt for decision."""

[[template.agents]]
name = "optimist"
type = "advocate"
task = """Make the strongest case FOR {goal}. Concrete benefits, expected upside."""

[[template.agents]]
name = "pessimist"
type = "advocate"
task = """Make the strongest case AGAINST {goal}. Costs, risks, fail modes."""

[[template.agents]]
name = "pragmatist"
type = "advocate"
task = """Identify the smallest reversible step that tests {goal} cheaply."""
`,
});
