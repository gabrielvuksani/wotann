/**
 * Plan-Work-Review 6-phase cycle with bidirectional mode transitions.
 * Phases: DISCUSS → PLAN → IMPLEMENT → REVIEW → UAT → SHIP
 * Transitions are intent-driven — the harness reads the user message and moves fluidly.
 */

import type { PermissionMode } from "../core/types.js";

export type PWRPhase = "discuss" | "plan" | "implement" | "review" | "uat" | "fix" | "ship";

export interface TransitionIntent {
  readonly suggestedPhase: PWRPhase | null;
  readonly confidence: number;
}

export interface PWRState {
  readonly currentPhase: PWRPhase;
  readonly phaseHistory: readonly PWRPhase[];
  readonly checkpoints: ReadonlyMap<PWRPhase, string>;
}

const PHASE_ORDER: readonly PWRPhase[] = ["discuss", "plan", "implement", "review", "uat", "fix", "ship"];

const PHASE_PERMISSIONS: Record<PWRPhase, PermissionMode> = {
  discuss: "default",
  plan: "plan",
  implement: "acceptEdits",
  review: "plan",
  uat: "acceptEdits",
  fix: "acceptEdits",
  ship: "default",
};

// ── Keyword-based intent detection (<1ms) ───────────────────

export function detectTransitionKeywords(message: string): TransitionIntent {
  const lower = message.toLowerCase();

  if (/\b(rethink|reconsider|redesign|architect|plan|approach|strategy)\b/.test(lower)) {
    return { suggestedPhase: "plan", confidence: 0.8 };
  }
  if (/\b(just do it|go ahead|build it|implement|code it|fix it|make it)\b/.test(lower)) {
    return { suggestedPhase: "implement", confidence: 0.8 };
  }
  if (/\b(review|check|look at|audit|examine)\b/.test(lower)) {
    return { suggestedPhase: "review", confidence: 0.7 };
  }
  if (/\b(commit|push|ship|deploy|pr|pull request|merge)\b/.test(lower)) {
    return { suggestedPhase: "ship", confidence: 0.9 };
  }
  if (/\b(actually|wait|changed my mind|requirements|need to explain)\b/.test(lower)) {
    return { suggestedPhase: "discuss", confidence: 0.7 };
  }
  if (/\b(test|run tests|verify|uat|acceptance)\b/.test(lower)) {
    return { suggestedPhase: "uat", confidence: 0.7 };
  }

  return { suggestedPhase: null, confidence: 0 };
}

export function getTransitionDirection(
  from: PWRPhase,
  to: PWRPhase,
): "forward" | "backward" | "lateral" {
  const fromIdx = PHASE_ORDER.indexOf(from);
  const toIdx = PHASE_ORDER.indexOf(to);
  if (toIdx > fromIdx) return "forward";
  if (toIdx < fromIdx) return "backward";
  return "lateral";
}

export function getPermissionForPhase(phase: PWRPhase): PermissionMode {
  return PHASE_PERMISSIONS[phase];
}

// ── Auto-detect next step (from GSD) ────────────────────────

export interface ProjectContext {
  readonly hasPlan: boolean;
  readonly hasUnimplementedTasks: boolean;
  readonly hasUnreviewedChanges: boolean;
  readonly allTestsPassing: boolean;
  readonly hasUncommittedChanges: boolean;
}

export function autoDetectNextPhase(ctx: ProjectContext): PWRPhase {
  if (!ctx.hasPlan) return "discuss";
  if (ctx.hasUnimplementedTasks) return "implement";
  if (ctx.hasUnreviewedChanges) return "review";
  if (!ctx.allTestsPassing) return "fix";
  if (ctx.hasUncommittedChanges) return "ship";
  return "discuss";
}

// ── PWR State Machine ───────────────────────────────────────

export class PWREngine {
  private state: PWRState;

  constructor(initialPhase: PWRPhase = "discuss") {
    this.state = {
      currentPhase: initialPhase,
      phaseHistory: [],
      checkpoints: new Map(),
    };
  }

  getState(): PWRState {
    return this.state;
  }

  getCurrentPhase(): PWRPhase {
    return this.state.currentPhase;
  }

  processMessage(message: string): { transitioned: boolean; newPhase: PWRPhase; direction: string } {
    const intent = detectTransitionKeywords(message);

    if (!intent.suggestedPhase || intent.suggestedPhase === this.state.currentPhase) {
      return { transitioned: false, newPhase: this.state.currentPhase, direction: "none" };
    }

    const direction = getTransitionDirection(this.state.currentPhase, intent.suggestedPhase);

    this.state = {
      currentPhase: intent.suggestedPhase,
      phaseHistory: [...this.state.phaseHistory, this.state.currentPhase],
      checkpoints: this.state.checkpoints,
    };

    return { transitioned: true, newPhase: intent.suggestedPhase, direction };
  }

  getPhaseHistory(): readonly PWRPhase[] {
    return this.state.phaseHistory;
  }
}
