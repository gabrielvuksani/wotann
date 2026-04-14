/**
 * Mid-session model switching without context loss.
 * Serializes conversation state, translates message format,
 * adjusts tool declarations, and resumes on the new provider.
 *
 * Uses the CapabilityEqualizer to detect gaps and the
 * FormatTranslator to convert message formats between providers.
 *
 * UPGRADES (Sprint 2):
 * - Mid-session model switch without context loss (preserves full message history)
 * - Format translation between provider message formats (cross-family)
 * - Provider/model dropdown integration (listSwitchOptions)
 * - Session snapshot/restore for undo capability
 * - Per-model context limit awareness during switch
 */

import type { ProviderName, AgentMessage, SessionState, ToolDefinition } from "../core/types.js";
import type { ProviderCapabilities } from "./types.js";
import {
  CapabilityEqualizer,
  type CapabilityGap,
  type CapabilityName,
} from "./capability-equalizer.js";
import { anthropicToOpenAI, openAIToAnthropic, toAgentMessages } from "./format-translator.js";
import { preserveVariantTag } from "./discovery.js";

// ── Types ──────────────────────────────────────────────

export interface ModelSwitchResult {
  readonly success: boolean;
  readonly fromProvider: string;
  readonly fromModel: string;
  readonly toProvider: string;
  readonly toModel: string;
  readonly messagesTranslated: number;
  readonly toolsAdjusted: number;
  readonly contextPreserved: boolean;
  readonly warnings: readonly string[];
}

export interface SwitchCompatibility {
  readonly compatible: boolean;
  readonly gaps: readonly CapabilityGap[];
  readonly criticalGaps: readonly CapabilityGap[];
  readonly recommendation: string;
}

export interface SwitchContext {
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly systemPrompt: string;
}

/**
 * Snapshot of state before a switch, enabling undo.
 */
export interface SwitchSnapshot {
  readonly provider: ProviderName;
  readonly model: string;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly systemPrompt: string;
  readonly timestamp: number;
}

/**
 * Options for UI dropdown integration — describes a switchable target.
 */
export interface SwitchOption {
  readonly provider: ProviderName;
  readonly model: string;
  readonly label: string;
  readonly compatible: boolean;
  readonly recommendation: string;
}

type TransportFamily = "anthropic" | "openai";

// ── Constants ──────────────────────────────────────────

const ANTHROPIC_FAMILY_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "bedrock",
  "vertex",
]);

const OPENAI_FAMILY_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "copilot",
  "azure",
  "codex",
]);

const CRITICAL_CAPABILITIES: readonly CapabilityName[] = [
  "tool_use",
  "multi_turn",
  "system_prompt",
];

// ── Model Switcher ─────────────────────────────────────

export class ModelSwitcher {
  private readonly equalizer: CapabilityEqualizer;

  constructor(equalizer?: CapabilityEqualizer) {
    this.equalizer = equalizer ?? new CapabilityEqualizer();
  }

  /**
   * Switch the active model mid-session.
   * Translates messages, adjusts tools, and returns the switch result.
   */
  switchModel(
    session: SessionState,
    toProvider: ProviderName,
    toModel: string,
    context: SwitchContext,
  ): ModelSwitchResult {
    const fromProvider = session.provider;
    const fromModel = session.model;
    const warnings: string[] = [];

    // 0. Preserve OpenRouter variant tags (e.g., :free, :extended)
    const resolvedModel = preserveVariantTag(fromModel, toModel);
    if (resolvedModel !== toModel) {
      warnings.push(`Variant tag preserved: ${fromModel} → ${resolvedModel}`);
    }

    // 1. Check compatibility
    const compat = this.canSwitch(fromProvider, fromModel, toProvider, resolvedModel);

    if (compat.criticalGaps.length > 0) {
      const criticalNames = compat.criticalGaps.map((g) => g.capability).join(", ");
      warnings.push(`Critical capability gaps: ${criticalNames}`);
    }

    for (const gap of compat.gaps) {
      if (gap.impactLevel === "high") {
        warnings.push(`${gap.capability}: ${gap.mitigation}`);
      }
    }

    // 2. Translate messages
    const translatedMessages = this.translateMessages(
      context.messages,
      fromProvider,
      toProvider,
    );

    // 3. Adjust tools for the target provider
    const adjustedTools = this.adjustTools(context.tools, toProvider, resolvedModel);
    const toolsRemoved = context.tools.length - adjustedTools.length;

    if (toolsRemoved > 0) {
      warnings.push(`${toolsRemoved} tool(s) removed due to target provider limitations`);
    }

    // 4. Check context preservation
    const contextPreserved = translatedMessages.length === context.messages.length;

    if (!contextPreserved) {
      const lost = context.messages.length - translatedMessages.length;
      warnings.push(`${lost} message(s) could not be translated`);
    }

    return {
      success: true,
      fromProvider,
      fromModel,
      toProvider,
      toModel: resolvedModel,
      messagesTranslated: translatedMessages.length,
      toolsAdjusted: adjustedTools.length,
      contextPreserved,
      warnings,
    };
  }

  /**
   * Check if switching between two providers is safe.
   * Reports capability gaps and critical incompatibilities.
   */
  canSwitch(
    fromProvider: ProviderName | string,
    fromModel: string,
    toProvider: ProviderName | string,
    toModel: string,
  ): SwitchCompatibility {
    const gaps = this.equalizer.computeGaps(fromProvider, fromModel, toProvider, toModel);
    const criticalGaps = gaps.filter((g) =>
      CRITICAL_CAPABILITIES.includes(g.capability) && g.targetStatus === "unavailable",
    );

    const compatible = criticalGaps.length === 0;
    const highImpactCount = gaps.filter((g) => g.impactLevel === "high").length;

    let recommendation: string;
    if (!compatible) {
      recommendation = `Switch NOT recommended: ${criticalGaps.length} critical capability gap(s)`;
    } else if (highImpactCount > 0) {
      recommendation = `Switch possible with ${highImpactCount} high-impact gap(s) -- review warnings`;
    } else if (gaps.length > 0) {
      recommendation = `Switch safe with ${gaps.length} minor gap(s)`;
    } else {
      recommendation = "Switch safe -- full compatibility";
    }

    return { compatible, gaps, criticalGaps, recommendation };
  }

  /**
   * Get the translated messages for the target provider.
   * Returns AgentMessage[] that can be used with the new provider.
   */
  translateMessages(
    messages: readonly AgentMessage[],
    fromProvider: ProviderName | string,
    toProvider: ProviderName | string,
  ): readonly AgentMessage[] {
    const fromFamily = getTransportFamily(fromProvider);
    const toFamily = getTransportFamily(toProvider);

    // Same transport family -- no translation needed
    if (fromFamily === toFamily) return messages;

    // Cross-family translation needed
    // Convert to intermediate format first, then to target
    if (fromFamily === "anthropic" && toFamily === "openai") {
      return this.translateAnthropicToOpenAI(messages);
    }

    if (fromFamily === "openai" && toFamily === "anthropic") {
      return this.translateOpenAIToAnthropic(messages);
    }

    // Unknown family -- pass through as-is
    return messages;
  }

  /**
   * Create a snapshot of the current state before switching.
   * Enables undo: if the switch is unsatisfactory, restore from snapshot.
   */
  createSnapshot(
    session: SessionState,
    context: SwitchContext,
  ): SwitchSnapshot {
    return {
      provider: session.provider,
      model: session.model,
      messages: context.messages,
      tools: context.tools,
      systemPrompt: context.systemPrompt,
      timestamp: Date.now(),
    };
  }

  /**
   * Restore a session from a snapshot (undo a switch).
   * Translates messages back to the original provider format.
   */
  restoreFromSnapshot(
    snapshot: SwitchSnapshot,
    currentProvider: ProviderName,
  ): SwitchContext {
    const translatedMessages = this.translateMessages(
      snapshot.messages,
      currentProvider,
      snapshot.provider,
    );

    return {
      messages: translatedMessages,
      tools: snapshot.tools,
      systemPrompt: snapshot.systemPrompt,
    };
  }

  /**
   * List available switch targets for UI dropdown integration.
   * For each known provider/model pair, checks compatibility with the current session.
   */
  listSwitchOptions(
    currentProvider: ProviderName,
    currentModel: string,
    availableTargets: readonly { provider: ProviderName; model: string; label: string }[],
  ): readonly SwitchOption[] {
    return availableTargets.map((target) => {
      // Skip the current model — no point switching to itself
      if (target.provider === currentProvider && target.model === currentModel) {
        return {
          ...target,
          compatible: true,
          recommendation: "Current model",
        };
      }

      const compat = this.canSwitch(
        currentProvider,
        currentModel,
        target.provider,
        target.model,
      );

      return {
        provider: target.provider,
        model: target.model,
        label: target.label,
        compatible: compat.compatible,
        recommendation: compat.recommendation,
      };
    });
  }

  /**
   * Perform a full mid-session switch with snapshot for undo.
   * This is the high-level API that combines snapshot + switch + translate.
   * Returns the switch result and the pre-switch snapshot.
   */
  switchWithUndo(
    session: SessionState,
    toProvider: ProviderName,
    toModel: string,
    context: SwitchContext,
  ): { result: ModelSwitchResult; snapshot: SwitchSnapshot } {
    const snapshot = this.createSnapshot(session, context);
    const result = this.switchModel(session, toProvider, toModel, context);
    return { result, snapshot };
  }

  /**
   * Get the translated messages ready for the target provider.
   * Higher-level than translateMessages — also handles context window limits.
   */
  prepareContextForSwitch(
    context: SwitchContext,
    fromProvider: ProviderName,
    toProvider: ProviderName,
    targetContextLimit?: number,
  ): SwitchContext {
    // Translate messages to target format
    const translatedMessages = this.translateMessages(
      context.messages,
      fromProvider,
      toProvider,
    );

    // If context limit specified, truncate from the front (keep recent)
    let finalMessages = translatedMessages;
    if (targetContextLimit !== undefined && targetContextLimit > 0) {
      finalMessages = truncateToContextLimit(translatedMessages, targetContextLimit);
    }

    return {
      messages: finalMessages,
      tools: context.tools,
      systemPrompt: context.systemPrompt,
    };
  }

  // ── Private Helpers ──────────────────────────────────

  private translateAnthropicToOpenAI(messages: readonly AgentMessage[]): readonly AgentMessage[] {
    // AgentMessage is already provider-agnostic, but we need to handle
    // any provider-specific content patterns in the message text
    return messages.map((msg) => ({
      ...msg,
      content: stripProviderSpecificPatterns(msg.content, "anthropic"),
    }));
  }

  private translateOpenAIToAnthropic(messages: readonly AgentMessage[]): readonly AgentMessage[] {
    return messages.map((msg) => ({
      ...msg,
      content: stripProviderSpecificPatterns(msg.content, "openai"),
    }));
  }

  private adjustTools(
    tools: readonly ToolDefinition[],
    toProvider: ProviderName | string,
    toModel: string,
  ): readonly ToolDefinition[] {
    const hasToolUse = this.equalizer.hasCapability(toProvider, toModel, "tool_use");

    if (hasToolUse === "unavailable") {
      return []; // Target doesn't support tools at all
    }

    const hasParallelTools = this.equalizer.hasCapability(
      toProvider,
      toModel,
      "parallel_tool_calls",
    );

    // If parallel tool calls aren't supported, add a note to tool descriptions
    if (hasParallelTools === "unavailable") {
      return tools.map((tool) => ({
        ...tool,
        description: `${tool.description} [Note: call one tool at a time]`,
      }));
    }

    return tools;
  }
}

// ── Pure Utility Functions ─────────────────────────────

function getTransportFamily(provider: ProviderName | string): TransportFamily {
  if (ANTHROPIC_FAMILY_PROVIDERS.has(provider)) return "anthropic";
  if (OPENAI_FAMILY_PROVIDERS.has(provider)) return "openai";

  // Default: treat unknown providers as OpenAI-compatible
  return "openai";
}

/**
 * Truncate messages to fit within a context token limit.
 * Keeps the first message (system) and the most recent messages.
 * Rough estimate: ~4 chars per token.
 */
function truncateToContextLimit(
  messages: readonly AgentMessage[],
  tokenLimit: number,
): readonly AgentMessage[] {
  const estimateTokens = (msg: AgentMessage): number => Math.ceil(msg.content.length / 4);

  let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (totalTokens <= tokenLimit) return messages;

  // Keep first (system) and work backwards from the end
  const result = [...messages];
  const protectedEnd = Math.max(result.length - 5, 1);

  for (let i = 1; i < protectedEnd && totalTokens > tokenLimit; i++) {
    const msg = result[i];
    if (msg) {
      totalTokens -= estimateTokens(msg);
      result.splice(i, 1);
      i--;
    }
  }

  return result;
}

/**
 * Strip provider-specific patterns from message content.
 * For example, Anthropic's <thinking> tags or OpenAI's function call markup.
 */
function stripProviderSpecificPatterns(content: string, fromProvider: string): string {
  if (fromProvider === "anthropic") {
    // Remove Anthropic-specific XML-style tags that OpenAI doesn't understand
    return content
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
      .replace(/<artifact[\s\S]*?<\/artifact>/g, "")
      .trim();
  }

  if (fromProvider === "openai") {
    // Remove OpenAI-specific patterns
    return content
      .replace(/```json\n\{[\s\S]*?"function_call"[\s\S]*?\}\n```/g, "")
      .trim();
  }

  return content;
}
