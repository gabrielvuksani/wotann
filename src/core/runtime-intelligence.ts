import { existsSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { AgentMessage } from "./types.js";
import type { CompactionStage, ContextWindowIntelligence } from "../context/window-intelligence.js";
import type { MemoryStore } from "../memory/store.js";
import type { SkillRegistry } from "../skills/loader.js";
import { compactByImportance, type Turn } from "../context/importance-compactor.js";
import { applyStage0PressureRelief } from "../context/maximizer.js";
import { DEFAULT_STAGE0_TRUNCATION, type Stage0TruncationConfig } from "../context/limits.js";

export interface SkillActivationResult {
  readonly names: readonly string[];
  readonly prompt: string;
  readonly referencedPaths: readonly string[];
}

export interface MemoryActivationResult {
  readonly prompt: string;
  readonly recalledCount: number;
  readonly proactiveCount: number;
}

export interface ConversationCompactionResult {
  readonly messages: readonly AgentMessage[];
  readonly summary: string;
  readonly removedMessages: number;
}

const MAX_SKILLS_IN_PROMPT = 4;
const MAX_SKILL_CHARS = 2_400;
const MAX_MEMORY_VALUE_CHARS = 220;
const MAX_COMPACTION_SUMMARY_CHARS = 2_800;

export function estimateTokenCount(text: string): number {
  if (!text.trim()) return 0;
  return Math.ceil(text.length / 4);
}

export function extractReferencedPaths(prompt: string, workingDir: string): readonly string[] {
  const matches = new Set<string>();
  const pathPattern = /@?((?:\.{1,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]{1,8})/gi;

  for (const match of prompt.matchAll(pathPattern)) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;

    const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(workingDir, candidate);

    if (!existsSync(resolved)) continue;
    matches.add(relative(workingDir, resolved) || basename(resolved));
  }

  return [...matches];
}

export function buildSkillActivationPrompt(
  skillRegistry: Pick<
    SkillRegistry,
    "detectRelevant" | "getAlwaysActive" | "getSummaries" | "loadSkill"
  >,
  prompt: string,
  workingDir: string,
): SkillActivationResult {
  const referencedPaths = extractReferencedPaths(prompt, workingDir);
  const detected = skillRegistry.detectRelevant(referencedPaths);
  const summaries = skillRegistry.getSummaries();
  const terms = tokenize(prompt);
  const alwaysActive = skillRegistry.getAlwaysActive();

  const keywordMatches = summaries
    .map((summary) => ({
      name: summary.name,
      score: scoreSkillSummary(summary.name, summary.description, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.name);

  const selectedNames: string[] = [];
  const pushName = (name: string) => {
    if (!selectedNames.includes(name) && selectedNames.length < MAX_SKILLS_IN_PROMPT) {
      selectedNames.push(name);
    }
  };

  for (const skill of detected) pushName(skill.name);
  for (const name of keywordMatches) pushName(name);

  const alwaysSummary =
    alwaysActive.length > 0
      ? [
          "Passive always-on skills:",
          ...alwaysActive.slice(0, 5).map((skill) => `- ${skill.name}: ${skill.description}`),
        ].join("\n")
      : "";

  const loadedSections = selectedNames
    .map((name) => skillRegistry.loadSkill(name))
    .filter((skill): skill is NonNullable<typeof skill> => skill !== null)
    .map((skill) => {
      const content = stripFrontmatter(skill.content).trim().slice(0, MAX_SKILL_CHARS);
      return [`### Skill: ${skill.metadata.name}`, skill.metadata.description, content]
        .filter(Boolean)
        .join("\n");
    });

  const promptText = [
    alwaysSummary,
    loadedSections.length > 0
      ? [
          "## Active Skill Guidance",
          "Use the following harness skills as hard guidance for this query:",
          ...loadedSections,
        ].join("\n\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    names: selectedNames,
    prompt: promptText,
    referencedPaths,
  };
}

export function buildMemoryActivationPrompt(
  memoryStore: Pick<
    MemoryStore,
    "skepticalSearch" | "getProactiveContext" | "getWorkingMemory"
  > | null,
  sessionId: string,
  prompt: string,
  currentFile?: string,
): MemoryActivationResult {
  if (!memoryStore) {
    return { prompt: "", recalledCount: 0, proactiveCount: 0 };
  }

  let recalled = [] as ReturnType<typeof memoryStore.skepticalSearch>;
  let proactive = [] as ReturnType<typeof memoryStore.getProactiveContext>;
  let working = [] as ReturnType<typeof memoryStore.getWorkingMemory>;
  try {
    const normalizedQuery = normalizeMemoryQuery(prompt, currentFile);
    recalled = normalizedQuery ? memoryStore.skepticalSearch(normalizedQuery, 4) : [];
    proactive = memoryStore.getProactiveContext(sessionId, currentFile).slice(0, 4);
    working = memoryStore.getWorkingMemory(sessionId).slice(0, 4);
  } catch {
    return { prompt: "", recalledCount: 0, proactiveCount: 0 };
  }
  const seen = new Set<string>();

  const recalledLines = recalled
    .filter((entry) => {
      if (seen.has(entry.entry.id)) return false;
      seen.add(entry.entry.id);
      return true;
    })
    .map((entry) => {
      const trust = entry.needsVerification ? "verify" : "trusted";
      return `- [${trust}] ${entry.entry.key}: ${truncate(entry.entry.value, MAX_MEMORY_VALUE_CHARS)}`;
    });

  const proactiveLines = proactive
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .map((entry) => `- ${entry.key}: ${truncate(entry.value, MAX_MEMORY_VALUE_CHARS)}`);

  const workingLines = working
    .filter((entry) => !seen.has(`working:${entry.key}`))
    .map((entry) => {
      seen.add(`working:${entry.key}`);
      return `- ${entry.key}: ${truncate(entry.value, MAX_MEMORY_VALUE_CHARS)}`;
    });

  const promptText = [
    workingLines.length > 0 ? ["## Working Memory", ...workingLines].join("\n") : "",
    recalledLines.length > 0
      ? [
          "## Relevant Memory Recall",
          "Use trusted recollections directly. Treat `verify` entries as hints that still need confirmation.",
          ...recalledLines,
        ].join("\n")
      : "",
    proactiveLines.length > 0 ? ["## Proactive Context", ...proactiveLines].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    prompt: promptText,
    recalledCount: recalledLines.length,
    proactiveCount: proactiveLines.length,
  };
}

export function buildContextBudgetPrompt(
  contextIntelligence: Pick<ContextWindowIntelligence, "getBudget" | "getCompactionHistory">,
): string {
  const budget = contextIntelligence.getBudget();
  const remaining = Math.max(0, budget.availableTokens);
  const latestCompaction = contextIntelligence.getCompactionHistory().at(-1);

  return [
    "## Context Budget",
    `<budget:token_budget>${budget.totalTokens}</budget:token_budget>`,
    `<system_warning>Token usage: ${budget.totalTokens - remaining}/${budget.totalTokens}; ${remaining} remaining; pressure=${budget.pressureLevel}</system_warning>`,
    latestCompaction
      ? `<system_warning>Latest compaction: ${latestCompaction.stage}; reclaimed=${latestCompaction.tokensReclaimed}</system_warning>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Stage-0 pressure-relief result. Returned to callers so they can log
 * telemetry and decide whether to skip Stage-1 summarization for this
 * tick. `messages` are PROMPT-COPY messages — never write them back to
 * `session.messages` (originals must survive for replay/retry).
 */
export interface Stage0CompactionResult {
  readonly triggered: boolean;
  readonly messages: readonly AgentMessage[];
  readonly bytesReclaimed: number;
  readonly messagesAffected: number;
}

/**
 * Stage-0 truncator entry point. Run BEFORE
 * {@link compactConversationHistory} (Stage-1 LLM summarization) when
 * context pressure is in the 50-85% band. Clips verbose tool-call args
 * (write_file content, edit_file patches, execute output) in messages
 * outside the keep-window. Preserves message ordering, IDs, role, and
 * tool metadata so the prompt remains structurally valid.
 *
 * Inspired by langchain-ai/deepagents
 *   libs/deepagents/deepagents/middleware/summarization.py:122-149
 *   (TruncateArgsSettings).
 *
 * @param promptMessages prompt-copy messages (do NOT pass session.messages
 *   directly if you intend to keep originals — pass a copy or accept the
 *   trimmed result back into the prompt path only).
 * @param currentTokens current observed context usage (tokens).
 * @param maxTokens budget ceiling (tokens).
 * @param config optional Stage-0 config; defaults to DEFAULT_STAGE0_TRUNCATION.
 */
export function applyStage0Truncation(
  promptMessages: readonly AgentMessage[],
  currentTokens: number,
  maxTokens: number,
  config: Stage0TruncationConfig = DEFAULT_STAGE0_TRUNCATION,
): Stage0CompactionResult {
  const result = applyStage0PressureRelief(promptMessages, currentTokens, maxTokens, config);
  return {
    triggered: result.triggered,
    messages: result.messages as readonly AgentMessage[],
    bytesReclaimed: result.bytesReclaimed,
    messagesAffected: result.messagesAffected,
  };
}

export function compactConversationHistory(
  messages: readonly AgentMessage[],
  stage: CompactionStage,
): ConversationCompactionResult | null {
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversational = messages.filter((message) => message.role !== "system");
  const keepCount = stage === "aggressive-summarize" ? 4 : stage === "memory-offload" ? 6 : 8;

  if (conversational.length <= keepCount) {
    return null;
  }

  // Phase 13 Wave-3C: opt-in score-weighted compaction. When
  // CONTEXT_COMPACT_STRATEGY=importance, select kept turns by signal
  // score (tool-calls, decisions, questions, bookends) rather than
  // strictly by recency. Falls back to FIFO when unset — no regression.
  if (process.env["CONTEXT_COMPACT_STRATEGY"] === "importance") {
    const turns: Turn[] = conversational.map((msg, idx) => ({
      id: msg.id ?? `turn-${idx}`,
      role: msg.role === "tool" ? "tool" : msg.role,
      content: msg.content,
      timestamp: idx,
    }));
    const scored = compactByImportance(turns, { maxTurns: keepCount });
    if (scored.dropped.length > 0) {
      const keptIds = new Set(scored.kept.map((t) => t.id));
      const keptMessages: AgentMessage[] = [];
      const removedMessages: AgentMessage[] = [];
      for (let i = 0; i < conversational.length; i++) {
        const turnId = turns[i]?.id ?? "";
        const msg = conversational[i]!;
        if (keptIds.has(turnId)) keptMessages.push(msg);
        else removedMessages.push(msg);
      }
      const summary = removedMessages
        .map(
          (message, index) =>
            `${index + 1}. ${message.role}: ${truncate(message.content.replace(/\s+/g, " ").trim(), 220)}`,
        )
        .join("\n")
        .slice(0, MAX_COMPACTION_SUMMARY_CHARS);
      const summaryMessage: AgentMessage = {
        role: "system",
        content: [`Conversation summary (${stage} compaction, importance-scored):`, summary].join(
          "\n",
        ),
      };
      return {
        messages: [...systemMessages, summaryMessage, ...keptMessages],
        summary,
        removedMessages: removedMessages.length,
      };
    }
  }

  const removed = conversational.slice(0, Math.max(0, conversational.length - keepCount));
  const recent = conversational.slice(-keepCount);
  if (removed.length === 0) {
    return null;
  }

  const summary = removed
    .map(
      (message, index) =>
        `${index + 1}. ${message.role}: ${truncate(message.content.replace(/\s+/g, " ").trim(), 220)}`,
    )
    .join("\n")
    .slice(0, MAX_COMPACTION_SUMMARY_CHARS);

  const summaryMessage: AgentMessage = {
    role: "system",
    content: [`Conversation summary (${stage} compaction):`, summary].join("\n"),
  };

  return {
    messages: [...systemMessages, summaryMessage, ...recent],
    summary,
    removedMessages: removed.length,
  };
}

export function estimateConversationSplit(messages: readonly AgentMessage[]): {
  recentConversationTokens: number;
  oldConversationTokens: number;
} {
  const recent = messages.slice(-8);
  const older = messages.slice(0, Math.max(0, messages.length - recent.length));

  return {
    recentConversationTokens: estimateMessages(recent),
    oldConversationTokens: estimateMessages(older),
  };
}

function estimateMessages(messages: readonly AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokenCount(message.content) + 8, 0);
}

function scoreSkillSummary(name: string, description: string, terms: readonly string[]): number {
  const lowerName = name.toLowerCase();
  const lowerDescription = description.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (lowerName.includes(term)) score += 6;
    if (lowerDescription.includes(term)) score += 2;
  }

  return score;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
}

function normalizeMemoryQuery(prompt: string, currentFile?: string): string {
  const parts = [
    ...tokenize(prompt).map((term) => term.replace(/[./-]/g, " ")),
    currentFile ? basename(currentFile).replace(/\.[a-z0-9]+$/i, "") : "",
  ]
    .flatMap((value) => value.split(/\s+/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);

  return [...new Set(parts)].slice(0, 8).join(" ");
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}
