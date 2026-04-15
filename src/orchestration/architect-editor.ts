/**
 * Architect/Editor Dual-Model Pipeline.
 *
 * INSPIRED BY: Aider's Architect Mode — separate thinking from editing.
 *
 * FLOW:
 * 1. Architect model (strong reasoning: Opus, GPT-5.4) analyzes the task
 *    and produces a structured plan with specific file changes
 * 2. Editor model (fast/cheap: Sonnet, GPT-4.1, Gemini Flash) translates
 *    the architect's plan into precise code edits
 *
 * WOTANN ADVANTAGE: Auto-selects the pair based on task complexity and cost budget.
 * Aider requires manual model selection.
 */

import type { ProviderName } from "../core/types.js";

// ── Types ──────────────────────────────────────────────────

export interface ArchitectPlan {
  readonly analysis: string;
  readonly filesToModify: readonly string[];
  readonly steps: readonly string[];
  readonly risks: readonly string[];
  readonly estimatedComplexity: "low" | "medium" | "high";
}

export interface ArchitectEditorConfig {
  readonly architectProvider?: ProviderName;
  readonly architectModel?: string;
  readonly editorProvider?: ProviderName;
  readonly editorModel?: string;
  readonly maxArchitectTokens?: number;
  readonly maxEditorTokens?: number;
}

export interface ArchitectEditorResult {
  readonly architectOutput: string;
  readonly editorOutput: string;
  readonly totalTokens: number;
  readonly totalDurationMs: number;
  readonly architectProvider: ProviderName;
  readonly editorProvider: ProviderName;
}

export interface ArchitectEditorExecutorResult {
  readonly output: string;
  readonly tokensUsed: number;
  readonly provider?: ProviderName;
}

export type ArchitectEditorExecutor = (options: {
  readonly prompt: string;
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly maxTokens?: number;
}) => Promise<ArchitectEditorExecutorResult>;

// ── Default Model Pairs ────────────────────────────────────

const MODEL_PAIRS: ReadonlyArray<{
  architect: { provider: ProviderName; model: string };
  editor: { provider: ProviderName; model: string };
  label: string;
}> = [
  {
    architect: { provider: "anthropic", model: "claude-opus-4-6" },
    editor: { provider: "anthropic", model: "claude-sonnet-4-6" },
    label: "Claude Opus→Sonnet (highest quality)",
  },
  {
    architect: { provider: "anthropic", model: "claude-sonnet-4-6" },
    editor: { provider: "gemini", model: "gemini-2.5-flash" },
    label: "Claude Sonnet→Gemini Flash (cost-effective)",
  },
  {
    architect: { provider: "openai", model: "gpt-5.4" },
    editor: { provider: "openai", model: "gpt-4.1" },
    label: "GPT-5.4→GPT-4.1 (OpenAI native)",
  },
  {
    architect: { provider: "copilot", model: "gpt-4.1" },
    editor: { provider: "ollama", model: "qwen3-coder" },
    label: "Copilot→Ollama (hybrid, low cost)",
  },
];

// ── Pipeline ───────────────────────────────────────────────

/**
 * Run the architect/editor pipeline.
 *
 * The architect gets the full task description and produces a plan.
 * The editor gets the plan and produces the actual code changes.
 */
export async function runArchitectEditor(
  executor: ArchitectEditorExecutor,
  task: string,
  config?: ArchitectEditorConfig,
): Promise<ArchitectEditorResult> {
  const startTime = Date.now();

  // ── Phase 1: Architect ──
  const architectPrompt = [
    "You are the ARCHITECT. Your job is to ANALYZE and PLAN, not write code.",
    "",
    "Analyze this task and produce a structured plan:",
    "1. What files need to be modified?",
    "2. What is the step-by-step approach?",
    "3. What are the risks or edge cases?",
    "4. What is the estimated complexity?",
    "",
    "TASK:",
    task,
    "",
    "Output ONLY the analysis and plan. Do NOT write any code.",
  ].join("\n");

  const architectResult = await executor({
    prompt: architectPrompt,
    provider: config?.architectProvider,
    model: config?.architectModel,
    maxTokens: config?.maxArchitectTokens ?? 4096,
  });
  const architectOutput = architectResult.output;
  const architectTokens = architectResult.tokensUsed;
  const architectProvider = architectResult.provider ?? config?.architectProvider ?? "ollama";

  // ── Phase 2: Editor ──
  const editorPrompt = [
    "You are the EDITOR. An architect has analyzed a task and produced a plan.",
    "Your job is to IMPLEMENT the plan with precise code changes.",
    "",
    "ARCHITECT'S PLAN:",
    architectOutput,
    "",
    "ORIGINAL TASK:",
    task,
    "",
    "Implement ALL the steps from the plan. Write the actual code.",
  ].join("\n");

  const editorResult = await executor({
    prompt: editorPrompt,
    provider: config?.editorProvider,
    model: config?.editorModel,
    maxTokens: config?.maxEditorTokens ?? 8192,
  });
  const editorOutput = editorResult.output;
  const editorTokens = editorResult.tokensUsed;
  const editorProvider = editorResult.provider ?? config?.editorProvider ?? "ollama";

  return {
    architectOutput,
    editorOutput,
    totalTokens: architectTokens + editorTokens,
    totalDurationMs: Date.now() - startTime,
    architectProvider,
    editorProvider,
  };
}

/**
 * Auto-select the best model pair based on available providers.
 */
export function selectModelPair(availableProviders: ReadonlySet<ProviderName>): {
  architect: { provider: ProviderName; model: string };
  editor: { provider: ProviderName; model: string };
} | null {
  for (const pair of MODEL_PAIRS) {
    if (
      availableProviders.has(pair.architect.provider) &&
      availableProviders.has(pair.editor.provider)
    ) {
      return { architect: pair.architect, editor: pair.editor };
    }
  }
  return null;
}
