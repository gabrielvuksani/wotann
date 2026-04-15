/**
 * Task-Semantic Model Router -- classifies user prompts by task type and
 * complexity, then recommends the optimal model from available providers.
 *
 * Inspired by Perplexity's task-aware routing. Instead of always using
 * the most expensive model, match model capabilities to the actual task.
 *
 * Classification uses pattern matching against known task indicators.
 * Model selection uses a preference matrix keyed by task type + complexity.
 */

// -- Task types --------------------------------------------------------------

export type TaskType =
  | "code-generation"
  | "code-review"
  | "debugging"
  | "research"
  | "creative-writing"
  | "data-analysis"
  | "conversation"
  | "math-reasoning"
  | "document-processing"
  | "image-understanding";

export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex" | "expert";

// -- Interfaces --------------------------------------------------------------

export interface TaskClassification {
  readonly type: TaskType;
  readonly complexity: TaskComplexity;
  readonly confidence: number;
  readonly recommendedModel: string;
  readonly fallbackModels: readonly string[];
  readonly estimatedTokens: number;
  readonly estimatedCostUsd: number;
}

// -- Pattern definitions -----------------------------------------------------

interface TaskPattern {
  readonly type: TaskType;
  readonly indicators: readonly RegExp[];
  /** Negative indicators that demote this classification when present. */
  readonly antiIndicators: readonly RegExp[];
  readonly weight: number;
}

const TASK_PATTERNS: readonly TaskPattern[] = [
  {
    type: "code-generation",
    indicators: [
      /\b(write|create|implement|build|add\s+feature|generate\s+code|scaffold|boilerplate)\b/i,
    ],
    antiIndicators: [/\b(blog|story|poem|essay|article|letter|email)\b/i],
    weight: 1.0,
  },
  {
    type: "code-review",
    indicators: [
      /\b(review|audit|check\s+(?:my|this|the)\s+code|improve\s+(?:this|the)\s+code|code\s+quality)\b/i,
    ],
    antiIndicators: [],
    weight: 1.0,
  },
  {
    type: "debugging",
    indicators: [
      /\b(fix|debug|error|bug|failing|broken|crash|exception|stack\s*trace|not\s+working)\b/i,
    ],
    antiIndicators: [],
    weight: 1.2,
  },
  {
    type: "research",
    indicators: [
      /\b(research|find|search|compare|analyze|investigate|explore|survey|benchmark)\b/i,
    ],
    antiIndicators: [],
    weight: 0.9,
  },
  {
    type: "creative-writing",
    indicators: [
      /\b(write|draft|blog|story|poem|essay|article|letter|creative|narrative|copywriting)\b/i,
    ],
    antiIndicators: [
      /\b(code|function|class|module|api|endpoint|component|test|implement|build)\b/i,
    ],
    weight: 0.8,
  },
  {
    type: "data-analysis",
    indicators: [
      /\b(data|csv|spreadsheet|statistics|chart|graph|metrics|aggregate|pivot|sql\s+query)\b/i,
    ],
    antiIndicators: [],
    weight: 0.9,
  },
  {
    type: "math-reasoning",
    indicators: [
      /\b(calculate|prove|equation|math|theorem|integral|derivative|algebra|geometry|probability)\b/i,
    ],
    antiIndicators: [],
    weight: 1.1,
  },
  {
    type: "document-processing",
    indicators: [
      /\b(summarize|extract|parse|pdf|document|convert\s+(?:to|from)|transcribe|translate)\b/i,
    ],
    antiIndicators: [],
    weight: 0.9,
  },
  {
    type: "image-understanding",
    indicators: [
      /\b(image|photo|picture|screenshot|diagram|visual|ocr|what\s+(?:is|does)\s+this\s+show)\b/i,
    ],
    antiIndicators: [],
    weight: 1.0,
  },
  {
    type: "conversation",
    indicators: [/\b(explain|tell\s+me|what\s+is|how\s+does|help\s+me\s+understand|chat|talk)\b/i],
    antiIndicators: [],
    weight: 0.5,
  },
];

// -- Complexity heuristics ---------------------------------------------------

interface ComplexitySignal {
  readonly pattern: RegExp;
  readonly delta: number;
}

const COMPLEXITY_SIGNALS: readonly ComplexitySignal[] = [
  { pattern: /\b(simple|quick|easy|trivial|basic|short)\b/i, delta: -2 },
  { pattern: /\b(small|tiny|minor|little)\b/i, delta: -1 },
  { pattern: /\b(complex|advanced|sophisticated|enterprise|production)\b/i, delta: 2 },
  { pattern: /\b(architect|design\s+system|distributed|microservice|scale)\b/i, delta: 2 },
  { pattern: /\b(expert|research\s+paper|formal\s+proof|optimize|benchmark)\b/i, delta: 3 },
  { pattern: /\b(multi-?step|pipeline|workflow|orchestrat)/i, delta: 1 },
];

function assessComplexity(prompt: string, tokenCount: number): TaskComplexity {
  let score = 0;

  for (const signal of COMPLEXITY_SIGNALS) {
    if (signal.pattern.test(prompt)) {
      score += signal.delta;
    }
  }

  // Token count influences complexity: long prompts are usually complex
  if (tokenCount > 2000) score += 2;
  else if (tokenCount > 500) score += 1;
  else if (tokenCount < 50) score -= 1;

  if (score <= -2) return "trivial";
  if (score <= 0) return "simple";
  if (score <= 2) return "moderate";
  if (score <= 4) return "complex";
  return "expert";
}

// -- Model preference matrix -------------------------------------------------

type ModelPreferenceList = readonly string[];

/**
 * Models ordered best-to-worst for each task type.
 *
 * Model IDs match the canonical tier names used across the harness
 * (see src/providers/model-defaults.ts). This list is matched against the
 * `availableModels` set the caller provides — if the caller's set uses
 * the same canonical IDs, `includes()` will hit, otherwise routing
 * gracefully degrades to the last-resort fallback at the bottom of the
 * function.
 */
const MODEL_PREFERENCES: ReadonlyMap<TaskType, ModelPreferenceList> = new Map([
  [
    "code-generation",
    ["claude-opus-4-6", "claude-sonnet-4-6", "gpt-5.4", "gpt-5", "gemini-3.1-pro", "gemma4:e4b"],
  ],
  ["code-review", ["claude-opus-4-6", "claude-sonnet-4-6", "gpt-5.4", "gemini-3.1-pro"]],
  ["debugging", ["claude-opus-4-6", "claude-sonnet-4-6", "gpt-5.4", "gemini-3.1-pro"]],
  ["research", ["gemini-3.1-pro", "gpt-5.4", "claude-opus-4-6", "claude-sonnet-4-6"]],
  ["creative-writing", ["claude-sonnet-4-6", "claude-opus-4-6", "gpt-5.4", "gemini-3.1-pro"]],
  ["data-analysis", ["gpt-5.4", "claude-sonnet-4-6", "gemini-3.1-pro", "claude-opus-4-6"]],
  ["conversation", ["claude-sonnet-4-6", "gpt-5", "gemini-2.5-flash", "gemma4:e4b"]],
  ["math-reasoning", ["claude-opus-4-6", "gpt-5.4", "claude-sonnet-4-6", "gemini-3.1-pro"]],
  ["document-processing", ["gemini-3.1-pro", "claude-sonnet-4-6", "gpt-5", "gemma4:e4b"]],
  ["image-understanding", ["claude-sonnet-4-6", "gpt-5", "gemini-3.1-pro"]],
]);

/** Cheap models for trivial tasks -- cost optimization. Sonnet, not Haiku. */
const TRIVIAL_MODELS: readonly string[] = ["gemma4:e4b", "gemini-2.5-flash", "claude-sonnet-4-6"];

// -- Cost estimates (USD per 1M tokens, rough averages) ---------------------

const COST_PER_1K_TOKENS: ReadonlyMap<string, number> = new Map([
  ["claude-opus-4-6", 0.015], // $15 / 1M input
  ["claude-sonnet-4-6", 0.003], // $3 / 1M input
  ["gpt-5.4", 0.01],
  ["gpt-5", 0.003],
  ["gemini-3.1-pro", 0.002],
  ["gemini-2.5-flash", 0.00025],
  ["gemma4:e4b", 0],
]);

function estimateCost(model: string, tokens: number): number {
  const rate = COST_PER_1K_TOKENS.get(model) ?? 0.015;
  return Math.round(((rate * tokens) / 1000) * 10000) / 10000;
}

// -- Implementation ----------------------------------------------------------

export class TaskSemanticRouter {
  /**
   * Classify a prompt into task type + complexity using pattern matching,
   * then recommend the optimal model from available models.
   */
  classify(prompt: string, availableModels: readonly string[]): TaskClassification {
    const estimatedTokens = Math.ceil(prompt.length / 4);

    // Score each task type
    const scores = scoreTaskTypes(prompt);

    // Pick highest scoring type
    const bestMatch = scores[0];
    const type: TaskType = bestMatch?.type ?? "conversation";
    const rawConfidence = bestMatch?.score ?? 0;

    // Normalize confidence to [0, 1]
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    const confidence = totalScore > 0 ? Math.round((rawConfidence / totalScore) * 100) / 100 : 0.5;

    const complexity = assessComplexity(prompt, estimatedTokens);
    const recommendedModel = this.selectModel(type, complexity, availableModels);

    const preferences = MODEL_PREFERENCES.get(type) ?? [];
    const fallbackModels = preferences
      .filter((m) => m !== recommendedModel && availableModels.includes(m))
      .slice(0, 3);

    const estimatedCostUsd = estimateCost(recommendedModel, estimatedTokens);

    return {
      type,
      complexity,
      confidence,
      recommendedModel,
      fallbackModels,
      estimatedTokens,
      estimatedCostUsd,
    };
  }

  /**
   * Return the best model for a given task type from available models.
   * For trivial tasks, always prefer cheap models regardless of task type.
   */
  selectModel(
    taskType: TaskType,
    complexity: TaskComplexity,
    available: readonly string[],
  ): string {
    // Trivial tasks: use cheap models
    if (complexity === "trivial") {
      for (const model of TRIVIAL_MODELS) {
        if (available.includes(model)) return model;
      }
    }

    // Look up preference list for this task type
    const preferences = MODEL_PREFERENCES.get(taskType) ?? [];

    // For simple tasks, skip the most expensive model (first in list)
    const startIndex = complexity === "simple" ? 1 : 0;

    for (let i = startIndex; i < preferences.length; i++) {
      const model = preferences[i];
      if (model && available.includes(model)) return model;
    }

    // If no preferred model is available, try any from the start
    for (const model of preferences) {
      if (model && available.includes(model)) return model;
    }

    // Last resort: return the first available model. Falls to the
    // Ollama-local neutral default when the caller's availability set is
    // empty (no vendor bias at the tail of the chain).
    return available[0] ?? "gemma4:e4b";
  }

  /**
   * Get all supported task types.
   */
  getSupportedTaskTypes(): readonly TaskType[] {
    return TASK_PATTERNS.map((p) => p.type);
  }

  /**
   * Get the model preference list for a task type.
   */
  getPreferences(taskType: TaskType): readonly string[] {
    return MODEL_PREFERENCES.get(taskType) ?? [];
  }
}

// -- Helpers -----------------------------------------------------------------

interface TaskScore {
  readonly type: TaskType;
  readonly score: number;
}

function scoreTaskTypes(prompt: string): readonly TaskScore[] {
  const scores: TaskScore[] = [];

  for (const pattern of TASK_PATTERNS) {
    let matchScore = 0;

    for (const indicator of pattern.indicators) {
      if (indicator.test(prompt)) {
        matchScore += pattern.weight;
      }
    }

    // Demote if anti-indicators match
    for (const anti of pattern.antiIndicators) {
      if (anti.test(prompt)) {
        matchScore *= 0.3;
      }
    }

    if (matchScore > 0) {
      scores.push({ type: pattern.type, score: matchScore });
    }
  }

  // Sort descending by score
  return [...scores].sort((a, b) => b.score - a.score);
}
