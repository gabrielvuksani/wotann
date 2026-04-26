/**
 * WOTANN custom-agent definitions — V9 T3.4 Wave 3.
 *
 * Generates the JSON shape `claude --agents <file>` consumes (per
 * code.claude.com/docs/en/sub-agents). Defines four WOTANN-specific
 * agents:
 *
 *   wotann-primary       — the main interactive agent. Drives every user
 *                          turn, has full WOTANN MCP access, no built-in
 *                          tool access. Hook-routed via `defer` to council
 *                          / arena / approval as needed.
 *   wotann-council-member — a single voter in a Council vote. Receives a
 *                          tool-call proposal + context, returns a yes/no
 *                          + 1-2 sentence rationale. Strict tool budget.
 *   wotann-arena-judge    — adjudicates Arena races. Receives N candidate
 *                          outputs + the original prompt, returns a ranked
 *                          list with structured rationale.
 *   wotann-exploit-lane   — runs the Exploit workshop's adversarial probing
 *                          on an artifact. Read-only by default; can call
 *                          one tool (mcp__wotann__exploit_lane).
 *
 * The agent JSON is built fresh per session — no module-level cache. This
 * mirrors the "no module-level singleton" Quality Bar (#7).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentModel } from "../../orchestration/agent-registry.js";

// ── JSON shape ─────────────────────────────────────────────────

export interface AgentDefinition {
  readonly description: string;
  readonly prompt: string;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly model: string;
  readonly permissionMode?: "auto" | "ask" | "dontAsk" | "bypassPermissions";
  readonly maxTurns?: number;
  readonly skills?: readonly string[];
  readonly mcpServers?: ReadonlyArray<Record<string, unknown>>;
  readonly hooks?: Record<string, ReadonlyArray<Record<string, unknown>>>;
  readonly memory?: "user" | "session" | "none";
  readonly effort?: "default" | "high" | "max";
  readonly initialPrompt?: string;
  readonly isolation?: "none" | "worktree";
  readonly color?: string;
}

export interface AgentsConfig {
  readonly version: 1;
  readonly agents: Record<string, AgentDefinition>;
}

// ── Per-agent system prompts ───────────────────────────────────

const PRIMARY_PROMPT = `You are WOTANN — an Asgardian AI engineering harness. The user runs WOTANN
locally; every tool call you make routes through WOTANN's middleware
(memory injection, sandbox audit, shadow-git commit). Trust WOTANN's
hooks: when a hook returns "block", you MUST stop and address the
reason; when a hook returns "inject", treat the additionalContext as
authoritative system context.

Always prefer the WOTANN MCP toolset over generic shell. Memory recall,
skill loading, council votes, arena races, and approvals all live as
mcp__wotann__* tools.

When the Reflector blocks your Stop, run the verification step it asks
for and surface evidence — never claim "done" without test/build/lint
output.

WOTANN's contract with the user is verify-before-done. Honour it.`;

const COUNCIL_MEMBER_PROMPT = `You are a single voter in a WOTANN Council. The Council aggregates 3-9
parallel votes on a tool-call proposal. Your job: read the proposal +
context, return a yes/no decision plus a 1-2 sentence rationale.

Evaluate the proposal on:
  - Reversibility — can the user undo this if it goes wrong?
  - Blast radius — what other systems are affected?
  - Confidence — does the proposed input match the user's stated intent?

Return ONLY the decision in the structured format:
  { "vote": "yes" | "no", "reason": "...", "confidence": 0-1 }

Do not call tools. Do not propose alternatives. Vote and return.`;

const ARENA_JUDGE_PROMPT = `You are the Arena Judge. The Arena runs N candidate generators in
parallel; your job is to rank their outputs against the original prompt
and a quality rubric.

For each candidate, evaluate:
  - Correctness — does the output answer the prompt?
  - Completeness — does it cover edge cases?
  - Style — does it match the codebase's existing conventions?
  - Cost — favor concise outputs when correctness is tied.

Return a ranked list:
  [{ "rank": 1, "candidateId": "A", "rationale": "..." }, ...]

Do not call tools. Read the candidates, rank, return.`;

const EXPLOIT_LANE_PROMPT = `You are the Exploit Lane — WOTANN's adversarial probe. The user has
shipped an artifact (code, prompt, doc, system); your job is to find
ways it breaks. Probe by:
  - Adversarial inputs — what malicious input bypasses the guard?
  - Edge cases — what zero-length, unicode, race-condition input fails?
  - Assumptions — what does the artifact silently rely on?

You may call mcp__wotann__exploit_lane with structured probes; do NOT
call destructive tools. Report findings as a ranked list of risks +
suggested mitigations.`;

// ── Builder ────────────────────────────────────────────────────

export interface AgentsConfigOptions {
  /**
   * Model id used by primary, arena-judge, and exploit-lane agents. When
   * omitted we resolve via the canonical agent-registry tier ("strong"
   * → the active provider's oracleModel, or the canonical Anthropic
   * fallback). V9 DEHARDCODE: this default reads from PROVIDER_DEFAULTS
   * and respects WOTANN_AGENT_MODEL_STRONG; it is no longer a literal.
   */
  readonly model?: string;
  /**
   * Provider hint passed to the resolver so PROVIDER_DEFAULTS can pick
   * the right tier model. When the host runtime knows the active
   * provider it should pass it here (V9 DEHARDCODE). Omitting it is
   * still honest — the resolver falls through to the canonical default.
   */
  readonly providerHint?: string;
  /** WOTANN MCP server descriptor — usually emitted by `claude/mcp/`. */
  readonly wotannMcpServer?: Record<string, unknown>;
  /** Base URL of the running hooks server (per V9 T3.3). */
  readonly hooksBaseUrl?: string;
  /** Skills auto-loaded for the primary agent. */
  readonly primarySkills?: readonly string[];
  /** Initial prompt the primary agent receives at boot. */
  readonly initialPrompt?: string;
  /** Color hint for terminal renderers. */
  readonly primaryColor?: string;
}

export function buildAgentsConfig(opts: AgentsConfigOptions = {}): AgentsConfig {
  // V9 DEHARDCODE: route the per-tier defaults through the central
  // resolver so adding a new provider in PROVIDER_DEFAULTS automatically
  // updates which models the council/judge/lane agents pick — no literal
  // "claude-opus-4-7" / "claude-sonnet-4-7" strings here.
  const resolverOpts = opts.providerHint ? { providerHint: opts.providerHint } : undefined;
  const strongModel = opts.model ?? resolveAgentModel("strong", resolverOpts).model;
  const fastModel = resolveAgentModel("fast", resolverOpts).model;

  const mcpServers = opts.wotannMcpServer ? [opts.wotannMcpServer] : [];
  const hooks = opts.hooksBaseUrl ? buildHookEntries(opts.hooksBaseUrl) : {};

  const wotannPrimary: AgentDefinition = {
    description: "WOTANN-orchestrated main session",
    prompt: PRIMARY_PROMPT,
    tools: ["mcp__wotann__*", "Read", "Grep", "Glob"],
    disallowedTools: [],
    model: strongModel,
    permissionMode: "dontAsk",
    maxTurns: 200,
    skills: opts.primarySkills ?? ["wotann-core", "wotann-safety"],
    mcpServers,
    hooks,
    memory: "user",
    effort: "max",
    ...(opts.initialPrompt ? { initialPrompt: opts.initialPrompt } : {}),
    isolation: "none",
    color: opts.primaryColor ?? "purple",
  };

  const wotannCouncilMember: AgentDefinition = {
    description: "Council voter for high-risk tool-call proposals",
    prompt: COUNCIL_MEMBER_PROMPT,
    tools: [],
    disallowedTools: ["Bash", "Edit", "Write", "MultiEdit"],
    // V9 DEHARDCODE: cheap-but-capable worker tier for many parallel
    // voters — resolved via PROVIDER_DEFAULTS so non-Anthropic users
    // get their provider's worker model (e.g. gpt-5 on OpenAI,
    // gemma4:e4b on Ollama) rather than a forced Sonnet route.
    model: fastModel,
    permissionMode: "dontAsk",
    maxTurns: 1,
    mcpServers: [],
    memory: "none",
    effort: "default",
    isolation: "worktree",
    color: "cyan",
  };

  const wotannArenaJudge: AgentDefinition = {
    description: "Arena race adjudicator",
    prompt: ARENA_JUDGE_PROMPT,
    tools: [],
    disallowedTools: ["Bash", "Edit", "Write"],
    model: strongModel,
    permissionMode: "dontAsk",
    maxTurns: 2,
    mcpServers: [],
    memory: "none",
    effort: "high",
    isolation: "worktree",
    color: "gold",
  };

  const wotannExploitLane: AgentDefinition = {
    description: "Adversarial probe on an artifact",
    prompt: EXPLOIT_LANE_PROMPT,
    tools: ["mcp__wotann__exploit_lane", "Read", "Grep"],
    disallowedTools: ["Bash", "Edit", "Write", "MultiEdit", "WebFetch"],
    model: strongModel,
    permissionMode: "dontAsk",
    maxTurns: 30,
    mcpServers,
    memory: "session",
    effort: "high",
    isolation: "worktree",
    color: "red",
  };

  return {
    version: 1,
    agents: {
      "wotann-primary": wotannPrimary,
      "wotann-council-member": wotannCouncilMember,
      "wotann-arena-judge": wotannArenaJudge,
      "wotann-exploit-lane": wotannExploitLane,
    },
  };
}

/**
 * Build the per-event hook URL list for an agent's `hooks` field. Each
 * load-bearing event maps to one URL. Other events are not declared
 * because the binary only fires URLs that are listed.
 */
function buildHookEntries(baseUrl: string): Record<string, ReadonlyArray<Record<string, unknown>>> {
  return {
    SessionStart: [{ type: "url", url: `${baseUrl}/wotann/hooks/session-start` }],
    UserPromptSubmit: [{ type: "url", url: `${baseUrl}/wotann/hooks/user-prompt-submit` }],
    PreToolUse: [{ type: "url", url: `${baseUrl}/wotann/hooks/pre-tool-use` }],
    PostToolUse: [{ type: "url", url: `${baseUrl}/wotann/hooks/post-tool-use` }],
    Stop: [{ type: "url", url: `${baseUrl}/wotann/hooks/stop` }],
    PreCompact: [{ type: "url", url: `${baseUrl}/wotann/hooks/pre-compact` }],
  };
}

// ── Disk materialization ───────────────────────────────────────

/**
 * Write the agents config to a temp file the `claude --agents <file>` flag
 * can consume. Returns the path. Caller unlinks at session end.
 */
export function writeAgentsConfigFile(config: AgentsConfig, sessionId: string): string {
  const dir = join(tmpdir(), "wotann-claude-agents");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sanitizeId(sessionId)}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: "utf-8" });
  return path;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 64);
}
