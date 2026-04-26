/**
 * Centralized Agent Registry: 14 specialist agent definitions.
 *
 * Maps agent ID -> AgentDefinition with capability tier, tools, prompts, and limits.
 * Used by AgentBridge for spawning, and by the fleet dashboard for status display.
 *
 * Agent tiers (from AGENTS_ROSTER.md) — capability names, NOT vendor model names:
 *   - strong:   Architecture & Planning (planner, architect, critic, reviewer, workflow-architect)
 *   - balanced: Implementation (executor, test-engineer, debugger, security-reviewer, build-resolver,
 *               computer-use)
 *   - fast:     Utility (analyst, simplifier, verifier)
 *   - local:    Locally hosted models (Ollama / OpenAI-compatible)
 *
 * Wave 6.5-WW (H-13): renamed from "opus|sonnet|haiku|local" to provider-neutral
 * tier names. The runtime resolves a capability tier to a concrete provider+model
 * via {@link resolveAgentModel}, which honours user env overrides
 * (WOTANN_AGENT_MODEL_STRONG / _BALANCED / _FAST / _LOCAL) and falls back to the
 * single-source-of-truth PROVIDER_DEFAULTS table.
 */

import { requiredReadingHook } from "../runtime-hooks/dead-code-hooks.js";
import {
  performHandoff,
  type AgentId as HandoffAgentId,
  type Handoff,
  type HandoffInputData,
  type HandoffResult,
} from "../core/handoff.js";
import type { RequiredReadingItem } from "../agents/required-reading.js";
import { PROVIDER_DEFAULTS } from "../providers/model-defaults.js";

/**
 * Capability tier — provider-neutral name describing the *role* of the model
 * rather than a vendor's product line. Resolves to a concrete model via
 * {@link resolveAgentModel}.
 */
export type AgentModel = "strong" | "balanced" | "fast" | "local";

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

// ── Architecture & Planning (strong tier) ──────────────────────

const planner = defineAgent({
  id: "planner",
  name: "Planner",
  model: "strong",
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
  model: "strong",
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
  model: "strong",
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
  model: "strong",
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
  model: "strong",
  systemPrompt:
    "You are a workflow architecture agent. Map every path through a system. " +
    "Identify decision nodes, failure modes, and recovery strategies. Produce " +
    "comprehensive flow diagrams and edge case documentation.",
  allowedTools: ["Read", "Glob", "Grep", "LSP"],
  deniedTools: ["Write", "Edit", "Bash"],
  availableSkills: ["research", "spec-driven-workflow"],
});

// ── Implementation (balanced tier) ─────────────────────────────

const executor = defineAgent({
  id: "executor",
  name: "Executor",
  model: "balanced",
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
  model: "balanced",
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
  model: "balanced",
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
  model: "balanced",
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
  model: "balanced",
  systemPrompt:
    "You are a build error resolution agent. Fix build and type errors with " +
    "minimal diffs. No refactoring — only fix what's broken. Verify the fix " +
    "compiles clean before reporting success.",
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  availableSkills: ["systematic-debugging", "focused-fix"],
});

// ── Utility (fast / local tier) ────────────────────────────────

const analyst = defineAgent({
  id: "analyst",
  name: "Analyst",
  model: "fast",
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
  model: "fast",
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
  model: "fast",
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
  model: "balanced",
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

// ── Capability Tier → Workflow Tier Mapping ────────────────────

const MODEL_TO_TIER: ReadonlyMap<AgentModel, AgentTier> = new Map<AgentModel, AgentTier>([
  ["strong", "planning"],
  ["balanced", "implementation"],
  ["fast", "utility"],
  ["local", "utility"],
]);

// ── Capability Tier → Concrete Provider/Model Resolver ─────────
//
// The resolver is the single read-side bridge between abstract capability
// names (`strong | balanced | fast | local`) and concrete provider+model
// strings. It honours user env overrides, falls back to the active session's
// provider via PROVIDER_DEFAULTS, and finally to canonical Anthropic IDs as
// the last-resort default (only when no provider context is supplied).
//
// Wave 6.5-WW (H-13): introduced to remove vendor lock-in from agent
// definitions. Agents declare a *role* (strong/balanced/fast/local); the
// runtime decides which concrete model satisfies that role at dispatch time.

/** Resolved model assignment for a given capability tier. */
export interface ResolvedAgentModel {
  /** Concrete provider name (e.g. "anthropic", "openai", "ollama"). */
  readonly provider: string;
  /** Concrete model id understood by that provider's adapter. */
  readonly model: string;
  /** Human-readable provenance — useful for cost preview / fleet status. */
  readonly source: "env-override" | "provider-default" | "canonical-fallback";
}

/**
 * Canonical fallback table — only consulted when neither an env override
 * nor a session-provider hint is available. Values are intentionally
 * Anthropic since the fallback is *deterministic*, not preferential: any
 * caller that ships with a provider context (the runtime always does) will
 * use that provider's PROVIDER_DEFAULTS instead.
 *
 * QB#7: declared `as const` so the table is structurally immutable; the
 * exported type narrows to the literal record.
 */
// CANONICAL_FALLBACK was Anthropic-only across strong/balanced/fast — if a
// caller hit this branch (no env var, no hint, no WOTANN_DEFAULT_PROVIDER),
// every tier silently routed to Claude. The v9 META-AUDIT flagged this as
// the most-hit vendor pin: any cold-start path with no provider context.
// The new fallback derives from PROVIDER_DEFAULTS instead — see
// `deriveCanonicalFallback` below.
const CANONICAL_FALLBACK: Readonly<Record<AgentModel, { provider: string; model: string }>> = {
  strong: { provider: "", model: "" },
  balanced: { provider: "", model: "" },
  fast: { provider: "", model: "" },
  local: { provider: "ollama", model: "gemma4:e4b" },
} as const;

/**
 * Derive a no-context tier mapping from PROVIDER_DEFAULTS rather than a
 * hard-coded vendor table. Picks the first provider whose oracle/worker/
 * default slot exists, scanning PROVIDER_DEFAULTS in declaration order.
 * Returns null when no provider in the table can serve the tier — caller
 * must surface the empty state to the user.
 */
function deriveCanonicalFallback(tier: AgentModel): { provider: string; model: string } | null {
  for (const [provider, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
    const model =
      tier === "strong"
        ? defaults.oracleModel
        : tier === "fast"
          ? defaults.workerModel
          : defaults.defaultModel;
    if (model) {
      return { provider, model };
    }
  }
  return null;
}

/**
 * Per-tier env override knob. Users can pin a specific provider+model for
 * a tier without editing code:
 *
 *   WOTANN_AGENT_MODEL_STRONG="openai:gpt-5"
 *   WOTANN_AGENT_MODEL_BALANCED="anthropic:claude-sonnet-4-7"
 *   WOTANN_AGENT_MODEL_FAST="ollama:llama-4-3b"
 *   WOTANN_AGENT_MODEL_LOCAL="ollama:gemma4:e4b"
 *
 * Format is `provider:model`. Invalid values fall back with a stderr warn.
 */
const ENV_OVERRIDE_KEY: Readonly<Record<AgentModel, string>> = {
  strong: "WOTANN_AGENT_MODEL_STRONG",
  balanced: "WOTANN_AGENT_MODEL_BALANCED",
  fast: "WOTANN_AGENT_MODEL_FAST",
  local: "WOTANN_AGENT_MODEL_LOCAL",
} as const;

/**
 * Resolve a capability tier to a concrete provider+model.
 *
 * Resolution order (first hit wins):
 *   1. `WOTANN_AGENT_MODEL_<TIER>` env var (`provider:model` shape)
 *   2. PROVIDER_DEFAULTS for the supplied `providerHint` —
 *      `strong → oracleModel`, `balanced → defaultModel`, `fast → workerModel`
 *   3. CANONICAL_FALLBACK (Anthropic-shaped defaults, only when no hint)
 *
 * Honest contract (QB#6): if an env override is malformed, we warn on
 * stderr and continue with the next resolution step rather than crashing.
 * The result is always a valid {@link ResolvedAgentModel}.
 */
export function resolveAgentModel(
  tier: AgentModel,
  options?: {
    /**
     * Active session provider — when present, the resolver maps the tier
     * onto that provider's PROVIDER_DEFAULTS triple (oracle/default/worker).
     * When absent, the canonical fallback is used.
     */
    readonly providerHint?: string;
    /** Optional process-env handle for testability; defaults to process.env. */
    readonly env?: NodeJS.ProcessEnv;
  },
): ResolvedAgentModel {
  const env = options?.env ?? process.env;

  // 1. Per-tier env override (`provider:model`).
  const overrideRaw = env[ENV_OVERRIDE_KEY[tier]];
  if (overrideRaw) {
    const colonAt = overrideRaw.indexOf(":");
    if (colonAt > 0 && colonAt < overrideRaw.length - 1) {
      const provider = overrideRaw.slice(0, colonAt).trim();
      const model = overrideRaw.slice(colonAt + 1).trim();
      if (provider && model) {
        return { provider, model, source: "env-override" };
      }
    }
    // Malformed override — warn and fall through (QB#6 honest fallback).
    process.stderr.write(
      `[agent-registry] ignoring malformed ${ENV_OVERRIDE_KEY[tier]}="${overrideRaw}" — expected "provider:model"\n`,
    );
  }

  // 2. Provider-hint-driven mapping via PROVIDER_DEFAULTS.
  if (options?.providerHint && PROVIDER_DEFAULTS[options.providerHint]) {
    const defaults = PROVIDER_DEFAULTS[options.providerHint]!;
    const model =
      tier === "strong"
        ? defaults.oracleModel
        : tier === "fast"
          ? defaults.workerModel
          : defaults.defaultModel; // balanced + local both map to defaultModel
    return { provider: options.providerHint, model, source: "provider-default" };
  }

  // 3. Canonical fallback — only reached when no provider context exists.
  // SB-NEW-7 fix: honor WOTANN_DEFAULT_PROVIDER for the no-hint path so users
  // running Ollama-only (or any non-Anthropic provider) don't silently get
  // pointed at claude-* models. When the env var matches a known provider,
  // re-derive the tier mapping via that provider's PROVIDER_DEFAULTS.
  const envDefault = env["WOTANN_DEFAULT_PROVIDER"];
  if (envDefault && PROVIDER_DEFAULTS[envDefault]) {
    const defaults = PROVIDER_DEFAULTS[envDefault]!;
    const model =
      tier === "strong"
        ? defaults.oracleModel
        : tier === "fast"
          ? defaults.workerModel
          : defaults.defaultModel;
    return { provider: envDefault, model, source: "provider-default" };
  }
  // CANONICAL_FALLBACK is the no-context resort. The static table only
  // has a value for `local` (Ollama with gemma4:e4b — that's a real
  // free-tier default the user can stand up locally with no key). For
  // the other tiers, derive from PROVIDER_DEFAULTS instead of the old
  // hard-coded Anthropic table.
  const canon = CANONICAL_FALLBACK[tier];
  if (canon.provider) {
    return { provider: canon.provider, model: canon.model, source: "canonical-fallback" };
  }
  const derived = deriveCanonicalFallback(tier);
  if (derived) {
    return { provider: derived.provider, model: derived.model, source: "canonical-fallback" };
  }
  // Truly nothing — surface the empty state. Caller should prompt user.
  return { provider: "", model: "", source: "canonical-fallback" };
}

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

  /**
   * Session-13 OpenAI agents-python parity: perform an agent handoff.
   * Delegates to `core/handoff.ts::performHandoff`. The runtime exposes
   * the same entry point via `WotannRuntime.performAgentHandoff()` —
   * this method is for callers that already hold a registry reference
   * without a runtime handle.
   *
   * Honest: throws on from===to per performHandoff() invariant.
   */
  async handoff(
    from: HandoffAgentId,
    to: HandoffAgentId,
    handoff: Handoff,
    data: HandoffInputData,
  ): Promise<HandoffResult> {
    if (!this.agents.has(to)) {
      throw new Error(`handoff: unknown target agent "${to}"`);
    }
    return performHandoff(from, to, handoff, data);
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

  /**
   * Wave 4E: add a new agent definition (e.g. an external ACP agent) to
   * the registry. Returns a new registry with the agent appended.
   * Honest: if an agent with the same ID already exists it will be
   * REPLACED (last-write-wins). Callers that want strict insertion
   * should check `has()` first.
   *
   * The typical flow after `wotann acp install` finishes is:
   *   registry.withAgent(definitionFromAcpManifest(installedAgent))
   * so the user can then `performAgentHandoff(..., 'acp:<name>', ...)`.
   */
  withAgent(definition: AgentDefinition): AgentRegistry {
    const nextList = [...this.agents.values()].filter((a) => a.id !== definition.id);
    nextList.push(definition);
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
