/**
 * Dead-code runtime hooks — Phase 14.
 *
 * Three previously-orphaned modules now have runtime hook wrappers.
 * Callers (runtime.ts, autopilot, agent bridge) can opt in by
 * invoking the relevant hook at the right moment — no global state,
 * no side-effects unless invoked.
 *
 * 1. perception-adapter-hook: wraps PerceptionEngine output through
 *    PerceptionAdapter to make Desktop Control work on EVERY provider
 *    (not just frontier-vision). Multiplies supported providers from
 *    3 to 11 on benchmarks that require screen interaction.
 *
 * 2. crystallization-hook: after a successful autopilot run, writes
 *    the successful task → prompt + steps as a SKILL.md to
 *    ~/.wotann/skills/auto/. Tier-4 self-evolution primitive.
 *
 * 3. required-reading-hook: loads the task YAML's required_reading
 *    section + prepends the content to the agent's system prompt.
 *    Ensures the agent sees the docs BEFORE picking up a task.
 *
 * Each hook is pure-invocation — caller decides when to run it.
 * This avoids breaking existing flows while making the dead modules
 * actively callable.
 *
 * ── Phase C wire-up status (who calls what) ───────────────────────
 *   (a) crystallizeSuccessHook — WIRED. Called from
 *       src/orchestration/autonomous.ts inside AutonomousExecutor.execute()
 *       immediately after the `tests-pass` exit branch. Emits the
 *       crystallize_skipped signal via the optional onCrystallize
 *       callback when the run fails eligibility (honest no-op, never
 *       silent). Tier-4 self-evolution activates the moment an
 *       autopilot run passes tests + changes enough files.
 *
 *   (b) requiredReadingHook — WIRED. Called from
 *       src/orchestration/agent-registry.ts AgentRegistry.spawn()
 *       when the agent's definition has a non-empty `requiredReading`
 *       list (loaded from YAML via parseAgentSpecYaml). The block is
 *       prepended to the agent's system prompt before the bridge
 *       dispatches. Items come from the agent YAML's `required_reading:`
 *       field — file paths resolved against the workspace root.
 *
 *   (c) routePerception — WIRED. Called from
 *       src/computer-use/computer-agent.ts via
 *       ComputerUseAgent.adaptPerceptionForModel(). The CLI `wotann cu`
 *       command and the daemon's Desktop Control path can now pass
 *       modelId + capabilities and get a provider-tiered payload
 *       (frontier-vision / small-vision / text-only) instead of being
 *       pinned to the text-only toText() branch.
 */

import type {
  PerceptionAdapter,
  PerceptionOutput,
  ModelCapabilities,
} from "../computer-use/perception-adapter.js";
import type { Perception } from "../computer-use/types.js";
import {
  crystallizeSuccess,
  type CrystallizationInput,
  type CrystallizationResult,
} from "../skills/self-crystallization.js";
import {
  loadRequiredReading,
  renderRequiredReadingBlock,
  type RequiredReadingItem,
  type RequiredReadingOptions,
} from "../agents/required-reading.js";

// ── 1. Perception adapter hook ────────────────────────

/**
 * Input shape for {@link routePerception}. `rawPerception` is the
 * PerceptionEngine's raw output (screenshot + a11y tree + elements).
 * `modelId` + `capabilities` let the adapter classify the tier
 * (frontier-vision / small-vision / text-only). `contextWindow` caps
 * the element budget.
 *
 * Wave 3H fix: the prior `rawOutput: PerceptionOutput` shape was
 * upside-down — PerceptionOutput is what `adapt()` returns, not what
 * it consumes. Taking a `Perception` matches the actual adapter
 * contract so callers no longer need untyped casts.
 */
export interface PerceptionHookInput {
  readonly rawPerception: Perception;
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;
  readonly adapter: PerceptionAdapter;
  /** Target model's context window. Defaults to 200k if omitted. */
  readonly contextWindow?: number;
}

/**
 * Route a PerceptionEngine's output through PerceptionAdapter.adapt()
 * so the downstream ComputerAgent sees a provider-appropriate form
 * (raw pixels for frontier vision, Set-of-Mark for small vision,
 * accessibility-tree text for text-only).
 *
 * Returns the adapter's {@link PerceptionOutput} which already carries
 * the right shape for the classified tier.
 */
export function routePerception(input: PerceptionHookInput): PerceptionOutput {
  const tier = input.adapter.classifyModel(input.modelId, input.capabilities);
  return input.adapter.adapt(input.rawPerception, tier, input.contextWindow ?? 200_000);
}

// ── 2. Crystallization hook ───────────────────────────

export interface CrystallizationEligibility {
  /** Minimum cycles (agent turns) before we even consider crystallizing. Default 3. */
  readonly minCycles?: number;
  /** Minimum file diff size before eligible. Default 1. */
  readonly minFilesChanged?: number;
  /** Minimum score (if autopilot produced one). Default 0.8. */
  readonly minScore?: number;
}

export interface CrystallizationHookInput extends CrystallizationInput {
  /** Actual cycle count for this run. */
  readonly cyclesCompleted: number;
  /** Number of files the agent changed. */
  readonly filesChanged: number;
  /** Optional completion score (e.g. from CompletionOracle). */
  readonly score?: number;
}

export interface CrystallizationHookResult {
  readonly eligible: boolean;
  readonly reason: string;
  readonly crystallized?: CrystallizationResult;
}

/**
 * Shape that AutonomousExecutor callers pass in. The executor owns the
 * cycle/file counts; the input block mirrors CrystallizationInput so the
 * wrapper is a 1-to-1 projection. Names match the spec handed to the
 * wire-up agent: `{prompt, toolCalls, diffSummary, title, cyclesConsumed,
 * filesChanged}` — `cyclesConsumed` is the caller-facing alias for
 * `cyclesCompleted`.
 */
export interface CrystallizeSuccessHookArgs {
  readonly input: {
    readonly prompt: string;
    readonly toolCalls: readonly string[];
    readonly diffSummary: string;
    readonly title?: string;
    readonly cyclesConsumed: number;
    readonly filesChanged: number;
    readonly score?: number;
  };
  readonly eligibility?: CrystallizationEligibility;
}

/**
 * Evaluate eligibility + crystallize if eligible. Does NOT write to
 * disk on its own — that's crystallizeSuccess's responsibility.
 * Returns {eligible, reason, crystallized?} so caller can log/display.
 */
export function crystallizeIfEligible(
  input: CrystallizationHookInput,
  eligibility: CrystallizationEligibility = {},
): CrystallizationHookResult {
  const minCycles = eligibility.minCycles ?? 3;
  const minFilesChanged = eligibility.minFilesChanged ?? 1;
  const minScore = eligibility.minScore ?? 0.8;

  if (input.cyclesCompleted < minCycles) {
    return {
      eligible: false,
      reason: `only ${input.cyclesCompleted} cycles (need >= ${minCycles})`,
    };
  }
  if (input.filesChanged < minFilesChanged) {
    return {
      eligible: false,
      reason: `only ${input.filesChanged} files changed (need >= ${minFilesChanged})`,
    };
  }
  if (input.score !== undefined && input.score < minScore) {
    return {
      eligible: false,
      reason: `score ${input.score} below threshold ${minScore}`,
    };
  }

  const crystallized = crystallizeSuccess({
    prompt: input.prompt,
    toolCalls: input.toolCalls,
    diffSummary: input.diffSummary,
    title: input.title,
  });

  return {
    eligible: true,
    reason: `eligible: ${input.cyclesCompleted} cycles, ${input.filesChanged} files${input.score !== undefined ? `, score ${input.score}` : ""}`,
    crystallized,
  };
}

/**
 * AutonomousExecutor-facing wrapper around {@link crystallizeIfEligible}.
 *
 * Signature mirrors the Phase C wire-up contract:
 *   await crystallizeSuccessHook({input, eligibility})
 *
 * Async so call-sites can `await` it alongside other post-success
 * callbacks (checkpoint save, shadow-git commit) without adaptor code.
 * Returns the same CrystallizationHookResult — the caller decides
 * whether to emit a `crystallize_skipped` event on ineligibility. The
 * hook NEVER silently no-ops; an ineligible run returns
 * `{eligible: false, reason: ...}` so the caller can surface it.
 */
export async function crystallizeSuccessHook(
  args: CrystallizeSuccessHookArgs,
): Promise<CrystallizationHookResult> {
  const { input, eligibility } = args;
  return crystallizeIfEligible(
    {
      prompt: input.prompt,
      toolCalls: input.toolCalls,
      diffSummary: input.diffSummary,
      ...(input.title !== undefined ? { title: input.title } : {}),
      cyclesCompleted: input.cyclesConsumed,
      filesChanged: input.filesChanged,
      ...(input.score !== undefined ? { score: input.score } : {}),
    },
    eligibility ?? {},
  );
}

// ── 3. Required-reading hook ──────────────────────────

export interface RequiredReadingHookInput {
  /**
   * Files / URLs to load (from task YAML's required_reading field).
   * Strings are treated as mandatory paths; objects allow
   * `optional: true` entries plus per-file budget overrides.
   */
  readonly paths: readonly RequiredReadingItem[];
  /** Options forwarded to loadRequiredReading. */
  readonly options: RequiredReadingOptions;
}

export interface RequiredReadingHookResult {
  readonly block: string;
  readonly anyMandatoryFailed: boolean;
}

/**
 * Load required reading, render to a prompt-block string, return both
 * the block and a "did any mandatory fail to load" flag. Callers can
 * refuse to proceed if anyMandatoryFailed is true.
 */
export function loadRequiredReadingBlock(
  input: RequiredReadingHookInput,
): RequiredReadingHookResult {
  const resolved = loadRequiredReading(input.paths, input.options);
  const block = renderRequiredReadingBlock(resolved);
  // Mandatory-failure detection: entries with status "failed" OR
  // "missing" flagged as mandatory by loadRequiredReading's internal logic
  const anyMandatoryFailed = resolved.some(
    (r) =>
      (r as { mandatory?: boolean; status?: string }).mandatory === true &&
      ((r as { status?: string }).status === "failed" ||
        (r as { status?: string }).status === "missing"),
  );
  return { block, anyMandatoryFailed };
}

/**
 * Prepend a required-reading block to a system prompt. Empty block →
 * systemPrompt unchanged.
 */
export function prependRequiredReading(systemPrompt: string, block: string): string {
  if (!block.trim()) return systemPrompt;
  if (!systemPrompt) return block;
  return `${block}\n\n---\n\n${systemPrompt}`;
}

/**
 * Shape passed in by the agent registry (Phase C wire-up contract):
 *
 *   const prepend = await requiredReadingHook({
 *     items: agentSpec.required_reading,
 *     options,
 *   });
 *   systemPrompt = prepend + "\n\n" + systemPrompt;
 *
 * `items` maps straight to the YAML `required_reading:` list (string or
 * {path, optional?, maxChars?, label?} entries). `options` carries the
 * workspace root + budget caps. Returns the rendered prompt block (may
 * be an empty string if no items supplied).
 */
export interface RequiredReadingHookArgs {
  readonly items: readonly RequiredReadingItem[];
  readonly options: RequiredReadingOptions;
}

/**
 * AgentRegistry-facing wrapper around loadRequiredReading +
 * renderRequiredReadingBlock. Async for consistency with the
 * `await` call-site contract; the underlying work is synchronous today
 * but this shape leaves room for a future remote-URL fetcher without
 * callers changing.
 *
 * Returns the rendered block (ready to prepend). Callers that need the
 * mandatory-failure signal should use {@link loadRequiredReadingBlock}
 * directly.
 */
export async function requiredReadingHook(args: RequiredReadingHookArgs): Promise<string> {
  if (args.items.length === 0) return "";
  const { block } = loadRequiredReadingBlock({
    paths: args.items,
    options: args.options,
  });
  return block;
}
