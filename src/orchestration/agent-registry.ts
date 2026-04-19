/**
 * Centralized Agent Registry: 14 specialist agent definitions.
 *
 * Maps agent ID -> AgentDefinition with model tier, tools, prompts, and limits.
 * Used by AgentBridge for spawning, and by the fleet dashboard for status display.
 *
 * Agent tiers (from AGENTS_ROSTER.md):
 *   - opus:   Architecture & Planning (planner, architect, critic, reviewer, workflow-architect)
 *   - sonnet: Implementation (executor, test-engineer, debugger, security-reviewer, build-resolver)
 *   - haiku:  Utility (analyst, simplifier, verifier)
 *   - sonnet: Specialist on-demand (computer-use)
 */

import { requiredReadingHook } from "../runtime-hooks/dead-code-hooks.js";
import type { RequiredReadingItem } from "../agents/required-reading.js";

export type AgentModel = "opus" | "sonnet" | "haiku" | "local";

export type AgentTier = "planning" | "implementation" | "utility" | "specialist";

/**
 * Per-agent model override loaded from YAML. Lets an individual agent spec
 * pin a specific provider + model (+ thinking token budget) without touching
 * the built-in registry definitions.
 */
export interface AgentModelOverride {
  readonly provider: string;
  readonly name: string;
  readonly thinkingTokens?: number;
}

export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly model: AgentModel;
  readonly systemPrompt: string;
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
  /** Skill names this agent is allowed to use. Empty = no skill restrictions. */
  readonly availableSkills: readonly string[];
  readonly maxTurns: number;
  readonly timeout: number;
  /** Optional provider/model override supplied via YAML agent spec. */
  readonly modelOverride?: AgentModelOverride;
  /**
   * Optional required_reading list (E13) loaded from the agent's YAML
   * spec. When present, AgentRegistry.spawnWithContext() prepends the
   * rendered block to the system prompt. Strings are mandatory file
   * paths; objects carry `optional: true` flags for best-effort reads.
   */
  readonly requiredReading?: readonly RequiredReadingItem[];
}

export interface SpawnConfig {
  readonly agentId: string;
  readonly model: AgentModel;
  readonly systemPrompt: string;
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
  /** Skill names this agent is allowed to use. Empty = no skill restrictions. */
  readonly availableSkills: readonly string[];
  readonly maxTurns: number;
  readonly timeout: number;
  readonly task: string;
  /** Per-agent model override; present only when YAML specified one. */
  readonly modelOverride?: AgentModelOverride;
  /**
   * required_reading items carried through to the dispatcher (E13).
   * AgentBridge/runtime uses these to re-resolve the block at dispatch
   * time with workspace-specific options; the static prompt string in
   * `systemPrompt` already has the block prepended for callers that
   * don't want to re-resolve.
   */
  readonly requiredReading?: readonly RequiredReadingItem[];
}

// ── Agent Definitions ──────────────────────────────────────────

const DEFAULT_TIMEOUT = 900_000; // 15 min
const DEFAULT_MAX_TURNS = 50;

function defineAgent(partial: {
  readonly id: string;
  readonly name: string;
  readonly model: AgentModel;
  readonly systemPrompt: string;
  readonly allowedTools: readonly string[];
  readonly deniedTools?: readonly string[];
  /** Skill names this agent is allowed to use. Empty = no skill restrictions. */
  readonly availableSkills?: readonly string[];
  readonly maxTurns?: number;
  readonly timeout?: number;
  readonly modelOverride?: AgentModelOverride;
  readonly requiredReading?: readonly RequiredReadingItem[];
}): AgentDefinition {
  return {
    id: partial.id,
    name: partial.name,
    model: partial.model,
    systemPrompt: partial.systemPrompt,
    allowedTools: partial.allowedTools,
    deniedTools: partial.deniedTools ?? [],
    availableSkills: partial.availableSkills ?? [],
    maxTurns: partial.maxTurns ?? DEFAULT_MAX_TURNS,
    timeout: partial.timeout ?? DEFAULT_TIMEOUT,
    ...(partial.modelOverride ? { modelOverride: partial.modelOverride } : {}),
    ...(partial.requiredReading && partial.requiredReading.length > 0
      ? { requiredReading: partial.requiredReading }
      : {}),
  };
}

// ── Architecture & Planning (Opus-tier) ────────────────────────

const planner = defineAgent({
  id: "planner",
  name: "Planner",
  model: "opus",
  systemPrompt:
    "You are a planning agent. Create implementation plans. Generate 2-3 approaches, " +
    "evaluate tradeoffs, and pick the best. Output a structured plan with phases, " +
    "dependencies, risks, and acceptance criteria.",
  allowedTools: ["Read", "Glob", "Grep", "WebSearch", "LSP"],
  deniedTools: ["Write", "Edit", "Bash"],
  availableSkills: [
    "research",
    "search-first",
    "agent-reach",
    "planning-with-files",
    "spec-driven-workflow",
  ],
});

const architect = defineAgent({
  id: "architect",
  name: "Architect",
  model: "opus",
  systemPrompt:
    "You are a system architecture agent. Design system architecture. Evaluate " +
    "tradeoffs between approaches. Produce Architecture Decision Records (ADRs). " +
    "Focus on scalability, maintainability, and correctness.",
  allowedTools: ["Read", "Glob", "Grep", "LSP"],
  deniedTools: ["Write", "Edit", "Bash"],
  availableSkills: ["research", "search-first", "spec-driven-workflow"],
});

const critic = defineAgent({
  id: "critic",
  name: "Critic",
  model: "opus",
  systemPrompt:
    "You are an adversarial reviewer. Review plans and designs skeptically. " +
    "Find flaws, gaps, risks, and unstated assumptions. Challenge every decision. " +
    "Your job is to make the plan stronger by finding its weaknesses.",
  allowedTools: ["Read", "Glob", "Grep"],
  deniedTools: ["Write", "Edit", "Bash"],
  availableSkills: ["research"],
});

const reviewer = defineAgent({
  id: "reviewer",
  name: "Reviewer",
  model: "opus",
  systemPrompt:
    "You are a code review agent. Review code for correctness, performance, " +
    "security, and maintainability. Report findings by severity: CRITICAL, HIGH, " +
    "MEDIUM, LOW. Provide specific line references and fix suggestions.",
  allowedTools: ["Read", "Glob", "Grep", "LSP", "Bash"],
  deniedTools: ["Write", "Edit"],
  availableSkills: ["research", "cso", "a11y-audit"],
});

const workflowArchitect = defineAgent({
  id: "workflow-architect",
  name: "Workflow Architect",
  model: "opus",
  systemPrompt:
    "You are a workflow architecture agent. Map every path through a system. " +
    "Identify decision nodes, failure modes, and recovery strategies. Produce " +
    "comprehensive flow diagrams and edge case documentation.",
  allowedTools: ["Read", "Glob", "Grep", "LSP"],
  deniedTools: ["Write", "Edit", "Bash"],
  availableSkills: ["research", "spec-driven-workflow"],
});

// ── Implementation (Sonnet-tier) ───────────────────────────────

const executor = defineAgent({
  id: "executor",
  name: "Executor",
  model: "sonnet",
  systemPrompt:
    "You are an implementation agent. Implement code per spec. Write tests first " +
    "(TDD). Verify after implementation. Follow existing codebase patterns. Keep " +
    "changes minimal and focused.",
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "LSP"],
  availableSkills: ["test-driven-development", "systematic-debugging", "research", "focused-fix"],
});

const testEngineer = defineAgent({
  id: "test-engineer",
  name: "Test Engineer",
  model: "sonnet",
  systemPrompt:
    "You are a test engineering agent. Write tests using RED-GREEN-REFACTOR. " +
    "Target 80% minimum coverage. Write unit, integration, and e2e tests. " +
    "Never modify tests to make them pass unless the test itself is wrong.",
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  deniedTools: ["LSP"],
  availableSkills: ["test-driven-development", "systematic-debugging", "ultraqa"],
});

const debugger_ = defineAgent({
  id: "debugger",
  name: "Debugger",
  model: "sonnet",
  systemPrompt:
    "You are a debugging agent. Investigate bugs using hypothesis-driven " +
    "methodology. Form hypotheses, design experiments to test them, and report " +
    "root cause with evidence. Never guess — prove.",
  allowedTools: ["Read", "Glob", "Grep", "Bash", "LSP"],
  deniedTools: ["Write", "Edit"],
  availableSkills: ["systematic-debugging", "trace", "tree-search", "focused-fix"],
});

const securityReviewer = defineAgent({
  id: "security-reviewer",
  name: "Security Reviewer",
  model: "sonnet",
  systemPrompt:
    "You are a security review agent. Scan for OWASP Top 10 vulnerabilities, " +
    "hardcoded secrets, injection attacks, XSS, CSRF, and auth bypass. " +
    "Flag findings and provide fixes. Rotate any exposed secrets.",
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  availableSkills: ["cso", "understand", "skill-security-auditor", "a11y-audit"],
});

const buildResolver = defineAgent({
  id: "build-resolver",
  name: "Build Resolver",
  model: "sonnet",
  systemPrompt:
    "You are a build error resolution agent. Fix build and type errors with " +
    "minimal diffs. No refactoring — only fix what's broken. Verify the fix " +
    "compiles clean before reporting success.",
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  availableSkills: ["systematic-debugging", "focused-fix"],
});

// ── Utility (Haiku/Local-tier) ─────────────────────────────────

const analyst = defineAgent({
  id: "analyst",
  name: "Analyst",
  model: "haiku",
  systemPrompt:
    "You are a requirements analysis agent. Analyze requirements and convert " +
    "ambiguous scope into specific acceptance criteria. Identify missing " +
    "information, contradictions, and implicit assumptions.",
  allowedTools: ["Read", "Glob", "Grep", "WebSearch"],
  deniedTools: ["Write", "Edit", "Bash"],
  availableSkills: ["research", "deep-interview", "agent-reach"],
});

const simplifier = defineAgent({
  id: "simplifier",
  name: "Simplifier",
  model: "haiku",
  systemPrompt:
    "You are a code simplification agent. Simplify code by removing unnecessary " +
    "complexity. Preserve all existing behavior. Reduce nesting, extract helpers, " +
    "and improve naming. Less is more.",
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
  deniedTools: ["Bash"],
  availableSkills: ["ai-slop-cleaner"],
});

const verifier = defineAgent({
  id: "verifier",
  name: "Verifier",
  model: "haiku",
  systemPrompt:
    "You are a verification agent. Verify that work is complete by running tests, " +
    "checking types, and reviewing output. Provide evidence of completion. " +
    "Never claim success without proof.",
  allowedTools: ["Read", "Glob", "Grep", "Bash"],
  deniedTools: ["Write", "Edit"],
  availableSkills: ["verify"],
});

// ── Specialist (On-demand) ─────────────────────────────────────

const computerUse = defineAgent({
  id: "computer-use",
  name: "Computer Use",
  model: "sonnet",
  systemPrompt:
    "You are a computer use agent. Control the computer to complete tasks. " +
    "Prefer API/CLI first, accessibility tree second, screenshot last. " +
    "Minimize screenshot usage — text-mediated approaches are faster and cheaper.",
  allowedTools: ["ComputerUse", "Read", "Bash"],
  deniedTools: ["Write", "Edit"],
  availableSkills: ["scrape", "clone-website"],
  maxTurns: 100,
  timeout: 1_800_000, // 30 min — CU tasks tend to be longer
});

// ── Model → Tier Mapping ───────────────────────────────────────

const MODEL_TO_TIER: ReadonlyMap<AgentModel, AgentTier> = new Map<AgentModel, AgentTier>([
  ["opus", "planning"],
  ["sonnet", "implementation"],
  ["haiku", "utility"],
  ["local", "utility"],
]);

// ── Registry ───────────────────────────────────────────────────

export class AgentRegistry {
  private readonly agents: ReadonlyMap<string, AgentDefinition>;

  constructor(definitions: readonly AgentDefinition[]) {
    const map = new Map<string, AgentDefinition>();
    for (const def of definitions) {
      map.set(def.id, def);
    }
    this.agents = map;
  }

  /** Get a single agent definition by ID. */
  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  /** Get all registered agent definitions. */
  getAll(): readonly AgentDefinition[] {
    return [...this.agents.values()];
  }

  /**
   * Get agents by their tier classification.
   * Tier is derived from the agent's model assignment:
   *   opus -> planning, sonnet -> implementation, haiku/local -> utility
   * Special case: computer-use is "specialist" regardless of model.
   */
  getByTier(tier: AgentTier): readonly AgentDefinition[] {
    return [...this.agents.values()].filter((agent) => {
      if (agent.id === "computer-use") {
        return tier === "specialist";
      }
      return MODEL_TO_TIER.get(agent.model) === tier;
    });
  }

  /**
   * Produce a SpawnConfig for the AgentBridge to use when launching an agent.
   * Returns undefined if the agent ID is not registered.
   *
   * NOTE: this synchronous variant does NOT resolve `requiredReading` into
   * the system prompt (that requires file IO). Callers that want the full
   * prepended prompt must await {@link spawnWithContext}. The raw
   * `requiredReading` list is still carried through on the SpawnConfig so
   * a dispatcher that prefers late-binding can resolve it itself.
   */
  spawn(id: string, task: string): SpawnConfig | undefined {
    const agent = this.agents.get(id);
    if (!agent) return undefined;

    return {
      agentId: agent.id,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      allowedTools: agent.allowedTools,
      deniedTools: agent.deniedTools,
      availableSkills: agent.availableSkills,
      maxTurns: agent.maxTurns,
      timeout: agent.timeout,
      task,
      ...(agent.modelOverride ? { modelOverride: agent.modelOverride } : {}),
      ...(agent.requiredReading && agent.requiredReading.length > 0
        ? { requiredReading: agent.requiredReading }
        : {}),
    };
  }

  /**
   * Async variant of {@link spawn} (Phase C wire-up). Resolves the
   * agent's `required_reading` list into a prompt block via
   * {@link requiredReadingHook} and returns a SpawnConfig whose
   * `systemPrompt` already has the block prepended.
   *
   * Contract:
   *   const prepend = await requiredReadingHook({items, options})
   *   systemPrompt = prepend + "\n\n" + systemPrompt
   *
   * Missing workspaceRoot ⇒ skip resolution (the dispatcher can still
   * read the raw `requiredReading` list off the returned config).
   * Empty list ⇒ identical output to the sync spawn().
   */
  async spawnWithContext(
    id: string,
    task: string,
    options?: {
      readonly workspaceRoot?: string;
      readonly defaultMaxCharsPerFile?: number;
      readonly totalBudgetChars?: number;
    },
  ): Promise<SpawnConfig | undefined> {
    const base = this.spawn(id, task);
    if (!base) return undefined;

    const items = base.requiredReading ?? [];
    if (items.length === 0 || !options?.workspaceRoot) {
      return base;
    }

    const prepend = await requiredReadingHook({
      items,
      options: {
        workspaceRoot: options.workspaceRoot,
        ...(options.defaultMaxCharsPerFile !== undefined
          ? { defaultMaxCharsPerFile: options.defaultMaxCharsPerFile }
          : {}),
        ...(options.totalBudgetChars !== undefined
          ? { totalBudgetChars: options.totalBudgetChars }
          : {}),
      },
    });

    if (!prepend) return base;

    return { ...base, systemPrompt: prepend + "\n\n" + base.systemPrompt };
  }

  /** Check if an agent ID is registered. */
  has(id: string): boolean {
    return this.agents.has(id);
  }

  /** Get the count of registered agents. */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Apply a per-agent model override. Returns a new registry with the
   * override merged in. Existing registry stays unchanged (immutable
   * update pattern — callers swap in the new registry where needed).
   */
  withModelOverride(id: string, override: AgentModelOverride): AgentRegistry {
    const existing = this.agents.get(id);
    if (!existing) return this;
    const updated: AgentDefinition = { ...existing, modelOverride: override };
    const nextList = [...this.agents.values()].map((a) => (a.id === id ? updated : a));
    return new AgentRegistry(nextList);
  }

  /**
   * Apply a per-agent `required_reading` list (E13 / Phase C). Same
   * immutable-update pattern as {@link withModelOverride}: returns a new
   * registry; the original is untouched. Empty list removes the field.
   */
  withRequiredReading(id: string, items: readonly RequiredReadingItem[]): AgentRegistry {
    const existing = this.agents.get(id);
    if (!existing) return this;
    const updated: AgentDefinition =
      items.length > 0
        ? { ...existing, requiredReading: items }
        : (() => {
            const { requiredReading: _omit, ...rest } = existing;
            return rest;
          })();
    const nextList = [...this.agents.values()].map((a) => (a.id === id ? updated : a));
    return new AgentRegistry(nextList);
  }
}

// ── YAML Override Loader ───────────────────────────────────────
//
// Each agent spec YAML lives under `.wotann/agents/<id>.yaml` (or
// wherever the caller passes). Its shape:
//
//   name: security-reviewer
//   model:
//     provider: anthropic
//     name: claude-opus-4-6
//     thinkingTokens: 64000
//
// We avoid pulling in a full YAML library to keep zero-dep guarantees —
// a small parser handles the 2-level nested structure we care about.

/** Minimal shape of an agent-spec YAML after parsing. */
interface ParsedAgentSpec {
  readonly name: string;
  readonly model?: AgentModelOverride;
  readonly requiredReading?: readonly RequiredReadingItem[];
}

/**
 * Parse an agent-spec YAML string. Supports:
 *   - flat `name: <string>` key
 *   - nested `model.*` block (provider, name, thinkingTokens)
 *   - `required_reading:` list (E13 / Phase C). Entries may be bare
 *     strings or inline-flow objects like
 *     `{path: docs/foo.md, optional: true}`.
 *
 * Returns null on shapes that do not match so callers can skip malformed
 * specs gracefully.
 */
export function parseAgentSpecYaml(source: string): ParsedAgentSpec | null {
  const lines = source.split(/\r?\n/);
  let name: string | undefined;
  let provider: string | undefined;
  let modelName: string | undefined;
  let thinkingTokens: number | undefined;
  let inModelBlock = false;
  let inRequiredReadingBlock = false;
  const requiredReading: RequiredReadingItem[] = [];

  for (const rawLine of lines) {
    // Strip comments first, but preserve strings — specs never need `#` mid-value.
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (line.trim() === "") continue;

    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inModelBlock = false;
      inRequiredReadingBlock = false;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!match) continue;
      const key = match[1]!;
      const value = match[2]!.trim();
      if (key === "name") {
        name = stripQuotes(value);
      } else if (key === "model" && value === "") {
        inModelBlock = true;
      } else if (key === "required_reading" && value === "") {
        inRequiredReadingBlock = true;
      }
      continue;
    }

    if (inModelBlock) {
      const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!match) continue;
      const key = match[1]!;
      const value = stripQuotes(match[2]!.trim());
      if (key === "provider") provider = value;
      else if (key === "name") modelName = value;
      else if (key === "thinkingTokens") {
        const n = Number(value);
        if (Number.isFinite(n)) thinkingTokens = n;
      }
      continue;
    }

    if (inRequiredReadingBlock) {
      // List entries: `  - <path>` or `  - {path: x, optional: true}`
      const listMatch = line.match(/^\s+-\s+(.*)$/);
      if (!listMatch) continue;
      const entry = listMatch[1]!.trim();
      const parsed = parseRequiredReadingEntry(entry);
      if (parsed !== null) requiredReading.push(parsed);
    }
  }

  if (!name) return null;
  const model: AgentModelOverride | undefined =
    provider && modelName
      ? {
          provider,
          name: modelName,
          ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
        }
      : undefined;
  return {
    name,
    ...(model ? { model } : {}),
    ...(requiredReading.length > 0 ? { requiredReading } : {}),
  };
}

/**
 * Parse a single `required_reading:` list entry. Supports:
 *   - `docs/foo.md` → mandatory string path
 *   - `"docs/foo.md"` → quoted string path
 *   - `{path: docs/foo.md, optional: true, maxChars: 2000, label: "Foo"}`
 *     → inline-flow object
 *
 * Returns null for unparseable entries so one bad line doesn't drop the
 * whole list.
 */
function parseRequiredReadingEntry(raw: string): RequiredReadingItem | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Inline-flow object: {path: x, optional: true, ...}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return null;

    let path: string | undefined;
    let optional: boolean | undefined;
    let maxChars: number | undefined;
    let label: string | undefined;

    for (const piece of splitFlowPairs(inner)) {
      const colonAt = piece.indexOf(":");
      if (colonAt === -1) continue;
      const key = piece.slice(0, colonAt).trim();
      const value = stripQuotes(piece.slice(colonAt + 1).trim());
      if (key === "path") path = value;
      else if (key === "optional") optional = value === "true";
      else if (key === "maxChars") {
        const n = Number(value);
        if (Number.isFinite(n)) maxChars = n;
      } else if (key === "label") label = value;
    }

    if (!path) return null;
    return {
      path,
      ...(optional !== undefined ? { optional } : {}),
      ...(maxChars !== undefined ? { maxChars } : {}),
      ...(label !== undefined ? { label } : {}),
    };
  }

  // Bare string entry — mandatory path.
  return stripQuotes(trimmed);
}

/**
 * Split an inline-flow payload on top-level commas only so that quoted
 * commas inside values are preserved. Keeps the parser zero-dep.
 */
function splitFlowPairs(inner: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (const ch of inner) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === ",") {
      if (buf.trim() !== "") out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== "") out.push(buf);
  return out;
}

function stripQuotes(raw: string): string {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Load all `<id>.yaml` specs from a directory and fold their model
 * overrides + required_reading into the given registry. Missing
 * directory = no-op. Invalid specs are logged and skipped so one bad
 * file doesn't break the whole load.
 */
export async function loadAgentSpecsFromDir(
  registry: AgentRegistry,
  directory: string,
): Promise<AgentRegistry> {
  const { existsSync, readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  if (!existsSync(directory)) return registry;

  let next = registry;
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (err) {
    console.error(
      "[AgentRegistry] Failed to read agent specs dir:",
      err instanceof Error ? err.message : String(err),
    );
    return registry;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
    try {
      const source = readFileSync(join(directory, entry), "utf-8");
      const parsed = parseAgentSpecYaml(source);
      if (!parsed) continue;
      if (!next.has(parsed.name)) continue;
      if (parsed.model) {
        next = next.withModelOverride(parsed.name, parsed.model);
      }
      if (parsed.requiredReading && parsed.requiredReading.length > 0) {
        next = next.withRequiredReading(parsed.name, parsed.requiredReading);
      }
    } catch (err) {
      console.error(
        `[AgentRegistry] Failed to parse ${entry}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return next;
}

// ── Singleton Instance ─────────────────────────────────────────

const ALL_AGENTS: readonly AgentDefinition[] = [
  planner,
  architect,
  critic,
  reviewer,
  workflowArchitect,
  executor,
  testEngineer,
  debugger_,
  securityReviewer,
  buildResolver,
  analyst,
  simplifier,
  verifier,
  computerUse,
];

export const agentRegistry = new AgentRegistry(ALL_AGENTS);
