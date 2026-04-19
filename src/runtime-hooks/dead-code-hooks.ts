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
 */

import type {
  PerceptionAdapter,
  PerceptionOutput,
  ModelCapabilities,
} from "../computer-use/perception-adapter.js";
import {
  crystallizeSuccess,
  type CrystallizationInput,
  type CrystallizationResult,
} from "../skills/self-crystallization.js";
import {
  loadRequiredReading,
  renderRequiredReadingBlock,
  type RequiredReadingOptions,
} from "../agents/required-reading.js";

// ── 1. Perception adapter hook ────────────────────────

export interface PerceptionHookInput {
  readonly rawOutput: PerceptionOutput;
  readonly capabilities: ModelCapabilities;
  readonly adapter: PerceptionAdapter;
}

/**
 * Route a PerceptionEngine's output through PerceptionAdapter.adapt()
 * so the downstream ComputerAgent sees a provider-appropriate form
 * (raw pixels for frontier vision, Set-of-Mark for small vision,
 * accessibility-tree text for text-only).
 *
 * Returns whatever PerceptionAdapter.adapt() returns — typed as
 * unknown because each capability tier has a different output shape.
 */
export function routePerception(input: PerceptionHookInput): unknown {
  // PerceptionAdapter's adapt() shape isn't pinned in the surface
  // type, so we pass through as unknown and let the caller type-assert.
  type AdaptMethod = (raw: PerceptionOutput, caps: ModelCapabilities) => unknown;
  const method = (input.adapter as unknown as { adapt: AdaptMethod }).adapt;
  if (typeof method !== "function") {
    throw new Error("routePerception: PerceptionAdapter.adapt() not available");
  }
  return method.call(input.adapter, input.rawOutput, input.capabilities);
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

// ── 3. Required-reading hook ──────────────────────────

export interface RequiredReadingHookInput {
  /** Files / URLs to load (from task YAML's required_reading field). */
  readonly paths: readonly string[];
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
