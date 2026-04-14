/**
 * Auto-Mode Detector — Windsurf Cascade-inspired automatic mode selection.
 * Simple question → chat. "Fix this bug" → build. "Build this feature" → autopilot.
 * User never selects a mode manually.
 */

import type { WotannMode } from "../core/mode-cycling.js";

// ── Types ────────────────────────────────────────────────

export interface ModeDetection {
  readonly detectedMode: WotannMode;
  readonly confidence: number;
  readonly reason: string;
  readonly suggestedPlanningDepth: "none" | "light" | "full";
}

export interface ComplexitySignal {
  readonly estimatedSteps: number;
  readonly estimatedFileCount: number;
  readonly hasMultiplePhases: boolean;
  readonly hasExplicitList: boolean;
}

// ── Patterns ─────────────────────────────────────────────

interface ModePattern {
  readonly mode: WotannMode;
  readonly patterns: readonly RegExp[];
  readonly planningDepth: "none" | "light" | "full";
  readonly priority: number;
}

const MODE_PATTERNS: readonly ModePattern[] = [
  // Autopilot — complex multi-step tasks
  {
    mode: "autonomous",
    patterns: [
      /build\s+(a|the|this|me)\s+/i,
      /implement\s+(a|the|this|me)\s+/i,
      /create\s+(a|the|this)\s+\w+\s+(from|with|that)/i,
      /refactor\s+(the|all|every)/i,
      /set\s*up\s+(the|a)/i,
      /migrate\s/i,
      /deploy\s/i,
    ],
    planningDepth: "full",
    priority: 3,
  },
  // Build — agent mode for targeted changes
  {
    mode: "default",
    patterns: [
      /fix\s+(the|this|a)\s+/i,
      /add\s+(a|the)\s+/i,
      /update\s+(the|this)/i,
      /change\s+(the|this)/i,
      /write\s+(a\s+)?test/i,
      /debug\s/i,
      /remove\s+(the|this)/i,
      /rename\s/i,
    ],
    planningDepth: "light",
    priority: 2,
  },
  // Research — information gathering
  {
    mode: "review",
    patterns: [
      /research\s/i,
      /find\s+(out|me)\s/i,
      /what\s+(is|are|does|do)\s/i,
      /how\s+(do|does|can|should)\s/i,
      /explain\s/i,
      /compare\s/i,
      /analyze\s/i,
    ],
    planningDepth: "none",
    priority: 1,
  },
  // Chat — simple questions
  {
    mode: "default",
    patterns: [
      /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no)/i,
      /^.{1,30}$/,  // Very short messages
      /\?$/,  // Questions
    ],
    planningDepth: "none",
    priority: 0,
  },
];

// ── Complexity Analysis ──────────────────────────────────

/** Patterns that indicate individual steps or actions in a prompt. */
const STEP_INDICATORS: readonly RegExp[] = [
  /\bthen\b/gi, /\bafter\s+that\b/gi, /\bnext\b/gi, /\bfinally\b/gi,
  /\bfirst\b/gi, /\bsecond\b/gi, /\bthird\b/gi,
  /\balso\b/gi, /\band\s+then\b/gi,
  /\d+\.\s+/g,  // Numbered lists ("1. do X, 2. do Y")
  /[-*]\s+/g,    // Bullet lists
];

/** Patterns that indicate file references in a prompt. */
const FILE_INDICATORS: readonly RegExp[] = [
  /\b[\w-]+\.(ts|tsx|js|jsx|py|rs|go|java|css|html|json|yaml|yml|md|toml)\b/gi,
  /\bsrc\//gi, /\blib\//gi, /\btest[s]?\//gi, /\bcomponents?\//gi,
];

/** Patterns that indicate the task has multiple phases or stages. */
const PHASE_INDICATORS: readonly RegExp[] = [
  /\bphase\b/i, /\bstage\b/i, /\bstep\s*\d/i, /\bpart\s*\d/i,
  /\bmilestone\b/i, /\bincrement/i,
];

function analyzeComplexity(prompt: string): ComplexitySignal {
  const stepMatches = STEP_INDICATORS.reduce(
    (count, pattern) => count + (prompt.match(pattern)?.length ?? 0),
    0,
  );
  // Each step indicator implies roughly one step; baseline is 1 (the task itself)
  const estimatedSteps = Math.max(1, stepMatches + 1);

  const fileMatches = new Set<string>();
  for (const pattern of FILE_INDICATORS) {
    const matches = prompt.match(pattern);
    if (matches) {
      for (const m of matches) fileMatches.add(m.toLowerCase());
    }
  }
  const estimatedFileCount = fileMatches.size;

  const hasMultiplePhases = PHASE_INDICATORS.some((p) => p.test(prompt));
  const hasExplicitList = /\d+\.\s+/.test(prompt) || /^[-*]\s+/m.test(prompt);

  return { estimatedSteps, estimatedFileCount, hasMultiplePhases, hasExplicitList };
}

// ── Detector ─────────────────────────────────────────────

export class AutoModeDetector {
  /**
   * Detect the appropriate mode from a user prompt.
   * Multi-step tasks (3+ steps or 3+ files) auto-enter plan mode.
   */
  detect(prompt: string): ModeDetection {
    const trimmed = prompt.trim();

    // Very short prompts → chat
    if (trimmed.length < 15) {
      return {
        detectedMode: "default",
        confidence: 0.9,
        reason: "Short message — conversational mode",
        suggestedPlanningDepth: "none",
      };
    }

    // Analyze complexity before pattern matching — plan mode overrides
    // when the task is clearly multi-step, preventing wasted execution.
    const complexity = analyzeComplexity(trimmed);

    if (complexity.estimatedSteps >= 3 || complexity.estimatedFileCount >= 3) {
      return {
        detectedMode: "plan",
        confidence: 0.85,
        reason: "Multi-step task detected — planning first",
        suggestedPlanningDepth: "full",
      };
    }

    if (complexity.hasMultiplePhases) {
      return {
        detectedMode: "plan",
        confidence: 0.8,
        reason: "Multi-phase task detected — planning first",
        suggestedPlanningDepth: "full",
      };
    }

    // Check patterns in priority order (highest first)
    const sorted = [...MODE_PATTERNS].sort((a, b) => b.priority - a.priority);

    for (const pattern of sorted) {
      for (const regex of pattern.patterns) {
        if (regex.test(trimmed)) {
          return {
            detectedMode: pattern.mode as WotannMode,
            confidence: 0.85,
            reason: `Pattern match: ${regex.source}`,
            suggestedPlanningDepth: pattern.planningDepth,
          };
        }
      }
    }

    // Default: code mode for anything that looks like work
    if (trimmed.length > 50) {
      return {
        detectedMode: "default",
        confidence: 0.6,
        reason: "Longer message — assumed to be a task",
        suggestedPlanningDepth: "light",
      };
    }

    return {
      detectedMode: "default",
      confidence: 0.5,
      reason: "No specific pattern matched — default mode",
      suggestedPlanningDepth: "none",
    };
  }

  /**
   * Analyze prompt complexity without selecting a mode.
   * Useful for callers that need the complexity signal independently
   * (e.g., to decide whether to show a planning UI).
   */
  analyzeComplexity(prompt: string): ComplexitySignal {
    return analyzeComplexity(prompt.trim());
  }
}
