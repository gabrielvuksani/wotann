/**
 * ULTRAPLAN — Remote cloud planning with extended thinking budget.
 *
 * When a task is too complex for a single context window, ULTRAPLAN
 * offloads the planning phase to the most powerful model with maximum
 * thinking time (e.g., Claude Opus 4.6 with 30-min think budget).
 *
 * FLOW:
 * 1. User requests a complex task
 * 2. ULTRAPLAN sends a detailed planning prompt to the strongest available model
 * 3. The model plans with extended thinking (up to 128K thinking tokens)
 * 4. The plan is returned as a structured document
 * 5. Execution phase uses the plan with a fast model (Sonnet/Haiku)
 *
 * This implements the Architect/Editor pattern at maximum scale:
 * - Architect: Opus with 30-min think budget
 * - Editor: Sonnet/Codex for fast implementation
 */

import type { ProviderName } from "../core/types.js";
import type { KnowledgeGraph } from "../memory/graph-rag.js";

export interface ULTRAPLANConfig {
  /** Provider for planning (strongest available) */
  readonly planProvider: ProviderName;
  /** Model for planning (e.g., claude-opus-4-6) */
  readonly planModel: string;
  /** Maximum thinking tokens for the planning phase */
  readonly maxThinkingTokens: number;
  /** Maximum time for the planning phase in ms */
  readonly maxPlanTimeMs: number;
  /** Provider for execution (fast model) */
  readonly execProvider: ProviderName;
  /** Model for execution (e.g., claude-sonnet-4-6) */
  readonly execModel: string;
}

export interface ULTRAPLANResult {
  readonly plan: StructuredPlan;
  readonly planDurationMs: number;
  readonly planTokensUsed: number;
  readonly executionResults: readonly PhaseResult[];
  readonly totalDurationMs: number;
  readonly success: boolean;
}

export interface StructuredPlan {
  readonly title: string;
  readonly summary: string;
  readonly phases: readonly PlanPhase[];
  readonly risks: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly estimatedComplexity: "low" | "medium" | "high" | "extreme";
}

export interface PlanPhase {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly files: readonly string[];
  readonly dependencies: readonly number[];
  readonly estimatedTokens: number;
}

export interface PhaseResult {
  readonly phaseId: number;
  readonly success: boolean;
  readonly output: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
}

const DEFAULT_CONFIG: ULTRAPLANConfig = {
  planProvider: "anthropic",
  planModel: "claude-opus-4-6",
  maxThinkingTokens: 128_000,
  maxPlanTimeMs: 30 * 60 * 1000, // 30 minutes
  execProvider: "anthropic",
  execModel: "claude-sonnet-4-6",
};

/**
 * Build the planning prompt for ULTRAPLAN.
 * This prompt elicits a structured plan with phases, dependencies, and risks.
 *
 * D11: if a knowledge graph is supplied, the planner seeds its context with
 * the entities and relationships most relevant to the task so the model
 * proposes phases against what *actually* exists in the repo (files,
 * modules, prior decisions) instead of hallucinating structure.
 */
export function buildPlanningPrompt(
  task: string,
  context?: string,
  knowledgeGraph?: KnowledgeGraph,
): string {
  const graphContext = knowledgeGraph ? renderGraphContext(knowledgeGraph, task) : "";
  return [
    "You are an expert software architect creating a detailed implementation plan.",
    "Think deeply and thoroughly about every aspect of this task.",
    "",
    "TASK:",
    task,
    "",
    context ? `CONTEXT:\n${context}\n` : "",
    graphContext ? `KNOWN ENTITIES & RELATIONSHIPS (from knowledge graph):\n${graphContext}\n` : "",
    "Create a structured plan with the following format:",
    "",
    "## Summary",
    "Brief overview of the approach.",
    "",
    "## Phases",
    "For each phase:",
    "- Phase number and name",
    "- What to implement",
    "- Files to create/modify",
    "- Dependencies on other phases",
    "- Estimated complexity",
    "",
    "## Risks",
    "What could go wrong and how to mitigate it.",
    "",
    "## Acceptance Criteria",
    "How to verify the work is complete.",
    "",
    "Think step by step. Consider edge cases. Plan for testability.",
    graphContext
      ? "Reference entities by name from the KNOWN ENTITIES section whenever a phase touches them — this keeps the plan grounded in the actual codebase."
      : "",
  ].join("\n");
}

/**
 * Render a compact summary of the entities and relationships most relevant
 * to the task. The planner can then name real files and modules instead of
 * guessing. Limits output to 40 entities and 60 relationships to stay within
 * prompt token budgets.
 */
function renderGraphContext(kg: KnowledgeGraph, task: string): string {
  const result = kg.queryGraph(task, 2);
  if (result.entities.length === 0) return "";

  const entities = result.entities.slice(0, 40);
  const relationships = result.relationships.slice(0, 60);

  const entityLines = entities.map((e) => `- ${e.type}:${e.name}`);
  const relLines = relationships.map((r) => {
    const src = kg.getEntity(r.sourceId)?.name ?? r.sourceId;
    const tgt = kg.getEntity(r.targetId)?.name ?? r.targetId;
    return `- ${src} -[${r.type}]-> ${tgt}`;
  });

  return [
    `Entities (${entities.length}/${result.entities.length}):`,
    ...entityLines,
    "",
    `Relationships (${relationships.length}/${result.relationships.length}):`,
    ...relLines,
  ].join("\n");
}

/**
 * Parse a model's planning response into a StructuredPlan.
 */
export function parsePlanResponse(response: string): StructuredPlan {
  const lines = response.split("\n");
  const phases: PlanPhase[] = [];
  const risks: string[] = [];
  const acceptanceCriteria: string[] = [];
  let summary = "";
  let title = "";
  let currentSection = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      currentSection = trimmed.slice(3).toLowerCase();
      if (!title && currentSection !== "summary") title = trimmed.slice(3);
      continue;
    }

    if (currentSection === "summary" || currentSection === "overview") {
      if (trimmed) summary += (summary ? " " : "") + trimmed;
    } else if (currentSection.includes("risk")) {
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        risks.push(trimmed.slice(2));
      }
    } else if (currentSection.includes("acceptance") || currentSection.includes("criteria")) {
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        acceptanceCriteria.push(trimmed.slice(2));
      }
    } else if (currentSection.includes("phase")) {
      // Parse phase headers: "### Phase 1: Name" or "- Phase 1: Name"
      const phaseMatch = trimmed.match(/(?:###?\s*)?(?:Phase\s+)?(\d+)[.:]\s*(.*)/i);
      if (phaseMatch) {
        phases.push({
          id: parseInt(phaseMatch[1] ?? "0", 10),
          name: phaseMatch[2] ?? "",
          description: "",
          files: [],
          dependencies: [],
          estimatedTokens: 2000,
        });
      }
    }
  }

  // Estimate complexity
  const estimatedComplexity: StructuredPlan["estimatedComplexity"] =
    phases.length > 10
      ? "extreme"
      : phases.length > 5
        ? "high"
        : phases.length > 2
          ? "medium"
          : "low";

  return {
    title: title || "Implementation Plan",
    summary: summary || "Plan generated by ULTRAPLAN.",
    phases,
    risks,
    acceptanceCriteria,
    estimatedComplexity,
  };
}

/**
 * Get the default ULTRAPLAN configuration.
 */
export function getDefaultConfig(): ULTRAPLANConfig {
  return DEFAULT_CONFIG;
}

/**
 * Check if ULTRAPLAN should be triggered for a task.
 * Heuristic: tasks with 3+ phases, 5+ files, or explicit keywords.
 */
export function shouldUseULTRAPLAN(task: string): boolean {
  const keywords = /\b(architect|design|refactor|migrate|overhaul|rewrite|redesign|rebuild)\b/i;
  const multiFile = /\b(multiple files|across files|several files|entire|whole)\b/i;
  const complexity = /\b(complex|complicated|difficult|challenging|ambitious)\b/i;

  let score = 0;
  if (keywords.test(task)) score += 2;
  if (multiFile.test(task)) score += 2;
  if (complexity.test(task)) score += 1;
  if (task.length > 500) score += 1;

  return score >= 3;
}
