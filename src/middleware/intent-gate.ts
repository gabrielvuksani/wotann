/**
 * Intent gate: fast keyword detection + AI classifier fallback.
 * Analyzes TRUE intent before routing any task.
 */

import type { Middleware, MiddlewareContext, IntentResult } from "./types.js";

// ── Keyword Patterns for Fast Classification ────────────────

interface KeywordPattern {
  readonly category: string;
  readonly type: string;
  readonly keywords: readonly RegExp[];
  readonly complexity: "low" | "medium" | "high";
  readonly suggestedMode?: string;
}

const KEYWORD_PATTERNS: readonly KeywordPattern[] = [
  {
    category: "code",
    type: "implement",
    keywords: [/\b(implement|create|build|add|write)\b/i, /\b(function|class|component|module)\b/i],
    complexity: "medium",
  },
  {
    category: "debug",
    type: "fix",
    keywords: [/\b(fix|bug|error|broken|failing|crash)\b/i],
    complexity: "medium",
    suggestedMode: "debug",
  },
  {
    category: "refactor",
    type: "refactor",
    keywords: [/\b(refactor|clean|simplify|restructure|reorganize)\b/i],
    complexity: "high",
  },
  {
    category: "review",
    type: "review",
    keywords: [/\b(review|check|audit|inspect|look at)\b/i],
    complexity: "low",
    suggestedMode: "review",
  },
  {
    category: "plan",
    type: "plan",
    keywords: [/\b(plan|design|architect|strategy|approach)\b/i],
    complexity: "high",
    suggestedMode: "careful",
  },
  {
    category: "research",
    type: "research",
    keywords: [/\b(research|investigate|explore|find out|search)\b/i],
    complexity: "medium",
    suggestedMode: "research",
  },
  {
    category: "test",
    type: "test",
    keywords: [/\b(test|spec|coverage|tdd|unit test)\b/i],
    complexity: "medium",
  },
  {
    category: "deploy",
    type: "deploy",
    keywords: [/\b(deploy|ship|release|publish|push to)\b/i],
    complexity: "high",
    suggestedMode: "careful",
  },
  {
    category: "explain",
    type: "explain",
    keywords: [/\b(explain|what is|how does|why|tell me)\b/i],
    complexity: "low",
  },
  {
    category: "utility",
    type: "utility",
    keywords: [/\b(format|convert|rename|move|delete|list)\b/i],
    complexity: "low",
    suggestedMode: "rapid",
  },
  // ── New Feature Intent Patterns ──
  {
    category: "security",
    type: "security-research",
    keywords: [/\b(exploit|vulnerability|pentest|CVE|security audit|attack surface)\b/i, /\b(security|hack|payload|injection|XSS|CSRF|SSRF)\b/i],
    complexity: "high",
    suggestedMode: "guardrails-off",
  },
  {
    category: "autonomous",
    type: "autonomous",
    keywords: [/\b(autonomous|auto.?mode|finish.*task|complete.*everything|don'?t stop)\b/i],
    complexity: "high",
    suggestedMode: "autonomous",
  },
  {
    category: "comparison",
    type: "arena",
    keywords: [/\b(compare models|which model|arena|benchmark|side by side)\b/i],
    complexity: "medium",
  },
  {
    category: "deliberation",
    type: "council",
    keywords: [/\b(council|deliberat|consensus|multiple.*opinions|peer.*review)\b/i],
    complexity: "high",
  },
  {
    category: "training",
    type: "training",
    keywords: [/\b(fine.?tune|train|RL|reinforcement|dataset|LoRA|QLoRA)\b/i],
    complexity: "high",
  },
  {
    category: "voice",
    type: "voice",
    keywords: [/\b(voice|speak|listen|dictate|transcrib|record.*audio)\b/i],
    complexity: "medium",
  },
  {
    category: "channel",
    type: "channel",
    keywords: [/\b(telegram|slack|discord|whatsapp|email|sms|channel|dispatch)\b/i],
    complexity: "medium",
  },
  {
    category: "memory",
    type: "memory",
    keywords: [/\b(remember|recall|memory|knowledge.*graph|context.*tree)\b/i],
    complexity: "low",
  },
  {
    category: "context",
    type: "context",
    keywords: [/\b(context.*window|token.*limit|compact|context.*budget)\b/i],
    complexity: "medium",
  },
];

// ── Intent Analysis ─────────────────────────────────────────

export function analyzeIntentFast(message: string): IntentResult {
  const matchedKeywords: string[] = [];
  let bestMatch: KeywordPattern | null = null;
  let bestScore = 0;

  for (const pattern of KEYWORD_PATTERNS) {
    let score = 0;
    for (const kw of pattern.keywords) {
      if (kw.test(message)) {
        score++;
        const match = message.match(kw);
        if (match?.[0]) matchedKeywords.push(match[0]);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = pattern;
    }
  }

  if (bestMatch && bestScore > 0) {
    return {
      type: bestMatch.type,
      category: bestMatch.category,
      complexity: bestMatch.complexity,
      suggestedMode: bestMatch.suggestedMode,
      keywords: matchedKeywords,
      confidence: Math.min(bestScore / bestMatch.keywords.length, 1),
    };
  }

  // Default: general code task
  return {
    type: "general",
    category: "code",
    complexity: "medium",
    keywords: [],
    confidence: 0.3,
  };
}

// ── Middleware Implementation ────────────────────────────────

export const intentGateMiddleware: Middleware = {
  name: "IntentGate",
  order: 1,

  before(ctx: MiddlewareContext): MiddlewareContext {
    const intent = analyzeIntentFast(ctx.userMessage);
    return {
      ...ctx,
      resolvedIntent: intent,
      taskType: intent.type,
      complexity: intent.complexity,
      behavioralMode: intent.suggestedMode ?? ctx.behavioralMode,
    };
  },
};
