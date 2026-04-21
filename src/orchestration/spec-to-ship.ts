/**
 * Spec-to-Ship Pipeline — end-to-end spec-driven development pipeline.
 *
 * Parses specifications, generates implementation plans, executes phased work
 * (research -> implement -> test -> review -> ship), and tracks progress.
 *
 * P2 migration: the canonical phase ordering now lives in a PhasedExecutor
 * instance (see phased-executor.ts). Public API preserved — `getPhases()`
 * is added as the canonical single-source-of-truth for the phase list.
 */

import { PhasedExecutor } from "./phased-executor.js";

// ── Types ─────────────────────────────────────────────────

export interface ParsedSpec {
  readonly title: string;
  readonly description: string;
  readonly requirements: readonly SpecRequirement[];
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly dependencies: readonly string[];
}

export interface SpecRequirement {
  readonly id: string;
  readonly description: string;
  readonly priority: "must" | "should" | "could" | "wont";
  readonly estimatedEffort: "small" | "medium" | "large";
}

export type PipelinePhase = "research" | "implement" | "test" | "review" | "ship";

export interface PipelineTask {
  readonly id: string;
  readonly phase: PipelinePhase;
  readonly description: string;
  readonly requirementIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly status: "pending" | "active" | "completed" | "failed" | "skipped";
  readonly output?: string;
}

export interface ImplementationPlan {
  readonly specTitle: string;
  readonly phases: readonly PhasePlan[];
  readonly totalTasks: number;
  readonly estimatedMinutes: number;
}

export interface PhasePlan {
  readonly phase: PipelinePhase;
  readonly tasks: readonly PipelineTask[];
  readonly estimatedMinutes: number;
}

export interface TaskExecutor {
  readonly executeTask: (task: PipelineTask) => Promise<TaskResult>;
}

export interface TaskResult {
  readonly taskId: string;
  readonly success: boolean;
  readonly output: string;
  readonly durationMs: number;
}

export interface PipelineResult {
  readonly specTitle: string;
  readonly success: boolean;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly skippedTasks: number;
  readonly totalDurationMs: number;
  readonly results: readonly TaskResult[];
}

export interface PipelineProgress {
  readonly currentPhase: PipelinePhase;
  readonly completedPhases: readonly PipelinePhase[];
  readonly currentTaskIndex: number;
  readonly totalTasks: number;
  readonly percentComplete: number;
}

// ── Parser ────────────────────────────────────────────────

/**
 * Canonical ordering of pipeline phases. External consumers (UI, stats,
 * CI reporters) can iterate this to display phase progress in the
 * correct order. Session-5: promoted from private constant to public
 * export so the name is actually consumed somewhere.
 */
export const PHASE_ORDER: readonly PipelinePhase[] = [
  "research",
  "implement",
  "test",
  "review",
  "ship",
];

/** Return the next phase after `current`, or null if current is the last phase. */
export function nextPhase(current: PipelinePhase): PipelinePhase | null {
  const idx = PHASE_ORDER.indexOf(current);
  if (idx < 0) return null;
  return PHASE_ORDER[idx + 1] ?? null;
}

/**
 * Parse a spec/requirements document into structured form.
 * Supports markdown-style specs with headers and bullet points.
 */
export class SpecToShipPipeline {
  private progress: PipelineProgress = {
    currentPhase: "research",
    completedPhases: [],
    currentTaskIndex: 0,
    totalTasks: 0,
    percentComplete: 0,
  };

  /**
   * Lightweight context threaded through the PhasedExecutor view.
   * Not used to drive actual execution (executePlan stays in charge);
   * provides canonical phase ordering + transition validation for
   * phase-aware tooling / telemetry.
   */
  private readonly phasedExecutor: PhasedExecutor<
    PipelinePhase,
    { readonly tasksVisited: readonly string[] }
  >;

  constructor() {
    // Mirror PHASE_ORDER into the PhasedExecutor so both stay in lockstep.
    // Handlers are no-ops because the real execution lives in executePlan()
    // (phase loops + dep-checking + task runners). This gives us
    // transition validation and observable state for free, without
    // restructuring the execution machinery.
    this.phasedExecutor = new PhasedExecutor({
      phases: PHASE_ORDER,
      handlers: {
        research: async (ctx) => ctx,
        implement: async (ctx) => ctx,
        test: async (ctx) => ctx,
        review: async (ctx) => ctx,
        ship: async (ctx) => ctx,
      },
    });
  }

  /**
   * Return the canonical phase ordering, sourced from PhasedExecutor.
   * External consumers (UI, telemetry, progress reporters) can iterate
   * this to render progress in the correct order. Part of the P2
   * unification: every phased orchestrator exposes `getPhases()`.
   */
  getPhases(): readonly PipelinePhase[] {
    return this.phasedExecutor.getPhases();
  }

  /**
   * Parse a spec/requirements document into structured form.
   */
  parseSpec(specContent: string): ParsedSpec {
    const lines = specContent.split("\n");

    const title = extractTitle(lines);
    const description = extractDescription(lines);
    const requirements = extractRequirements(lines);
    const acceptanceCriteria = extractSection(lines, "acceptance");
    const constraints = extractSection(lines, "constraint");
    const dependencies = extractSection(lines, "dependenc");

    return {
      title,
      description,
      requirements,
      acceptanceCriteria,
      constraints,
      dependencies,
    };
  }

  /**
   * Generate an implementation plan from a parsed spec.
   */
  planFromSpec(spec: ParsedSpec): ImplementationPlan {
    const phases: PhasePlan[] = [];
    let taskCounter = 0;

    // Research phase
    const researchTasks: PipelineTask[] = [];
    if (spec.dependencies.length > 0) {
      researchTasks.push({
        id: `task-${++taskCounter}`,
        phase: "research",
        description: `Research dependencies: ${spec.dependencies.join(", ")}`,
        requirementIds: [],
        dependsOn: [],
        status: "pending",
      });
    }
    researchTasks.push({
      id: `task-${++taskCounter}`,
      phase: "research",
      description: `Review existing codebase for overlap with: ${spec.title}`,
      requirementIds: [],
      dependsOn: [],
      status: "pending",
    });
    phases.push({
      phase: "research",
      tasks: researchTasks,
      estimatedMinutes: researchTasks.length * 5,
    });

    // Implement phase — one task per requirement
    const implTasks: PipelineTask[] = spec.requirements
      .filter((r) => r.priority !== "wont")
      .map((req) => ({
        id: `task-${++taskCounter}`,
        phase: "implement" as const,
        description: `Implement: ${req.description}`,
        requirementIds: [req.id],
        dependsOn: researchTasks.map((t) => t.id),
        status: "pending" as const,
      }));
    phases.push({
      phase: "implement",
      tasks: implTasks,
      estimatedMinutes: implTasks.length * 15,
    });

    // Test phase
    const testTasks: PipelineTask[] = [
      {
        id: `task-${++taskCounter}`,
        phase: "test",
        description: "Write unit tests for all implemented requirements",
        requirementIds: spec.requirements.map((r) => r.id),
        dependsOn: implTasks.map((t) => t.id),
        status: "pending",
      },
      {
        id: `task-${++taskCounter}`,
        phase: "test",
        description: "Run type checker and lint",
        requirementIds: [],
        dependsOn: implTasks.map((t) => t.id),
        status: "pending",
      },
    ];
    phases.push({
      phase: "test",
      tasks: testTasks,
      estimatedMinutes: testTasks.length * 10,
    });

    // Review phase
    const reviewTasks: PipelineTask[] = [
      {
        id: `task-${++taskCounter}`,
        phase: "review",
        description: "Verify acceptance criteria are met",
        requirementIds: [],
        dependsOn: testTasks.map((t) => t.id),
        status: "pending",
      },
    ];
    phases.push({
      phase: "review",
      tasks: reviewTasks,
      estimatedMinutes: 5,
    });

    // Ship phase
    const shipTasks: PipelineTask[] = [
      {
        id: `task-${++taskCounter}`,
        phase: "ship",
        description: "Create commit and prepare for merge",
        requirementIds: [],
        dependsOn: reviewTasks.map((t) => t.id),
        status: "pending",
      },
    ];
    phases.push({
      phase: "ship",
      tasks: shipTasks,
      estimatedMinutes: 5,
    });

    const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
    const estimatedMinutes = phases.reduce((sum, p) => sum + p.estimatedMinutes, 0);

    return { specTitle: spec.title, phases, totalTasks, estimatedMinutes };
  }

  /**
   * Execute a plan phase by phase using the provided executor.
   */
  async executePlan(plan: ImplementationPlan, executor: TaskExecutor): Promise<PipelineResult> {
    const results: TaskResult[] = [];
    const startTime = Date.now();
    let failedTasks = 0;
    let skippedTasks = 0;

    this.progress = {
      currentPhase: "research",
      completedPhases: [],
      currentTaskIndex: 0,
      totalTasks: plan.totalTasks,
      percentComplete: 0,
    };

    for (const phasePlan of plan.phases) {
      this.progress = {
        ...this.progress,
        currentPhase: phasePlan.phase,
      };

      for (const task of phasePlan.tasks) {
        // Check if dependencies have all succeeded
        const depsOk = task.dependsOn.every((depId) =>
          results.some((r) => r.taskId === depId && r.success),
        );

        if (!depsOk && task.dependsOn.length > 0) {
          skippedTasks++;
          results.push({
            taskId: task.id,
            success: false,
            output: "Skipped: dependency failed",
            durationMs: 0,
          });
          continue;
        }

        const result = await executor.executeTask(task);
        results.push(result);

        if (!result.success) {
          failedTasks++;
        }

        this.progress = {
          ...this.progress,
          currentTaskIndex: results.length,
          percentComplete: Math.round((results.length / plan.totalTasks) * 100),
        };
      }

      this.progress = {
        ...this.progress,
        completedPhases: [...this.progress.completedPhases, phasePlan.phase],
      };
    }

    return {
      specTitle: plan.specTitle,
      success: failedTasks === 0 && skippedTasks === 0,
      completedTasks: results.length - failedTasks - skippedTasks,
      failedTasks,
      skippedTasks,
      totalDurationMs: Date.now() - startTime,
      results,
    };
  }

  /**
   * Get current pipeline progress.
   */
  getProgress(): PipelineProgress {
    return { ...this.progress };
  }
}

// ── Parsing Helpers ───────────────────────────────────────

function extractTitle(lines: readonly string[]): string {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim();
    }
    if (trimmed.length > 0 && !trimmed.startsWith("#")) {
      return trimmed;
    }
  }
  return "Untitled Spec";
}

function extractDescription(lines: readonly string[]): string {
  const descLines: string[] = [];
  let pastTitle = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ") && !pastTitle) {
      pastTitle = true;
      continue;
    }
    if (pastTitle && trimmed.startsWith("## ")) break;
    if (pastTitle && trimmed.length > 0) {
      descLines.push(trimmed);
    }
  }

  return descLines.join(" ").slice(0, 500);
}

function extractRequirements(lines: readonly string[]): readonly SpecRequirement[] {
  const requirements: SpecRequirement[] = [];
  let inRequirements = false;
  let counter = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^##?\s.*requirement/i.test(trimmed)) {
      inRequirements = true;
      continue;
    }
    if (inRequirements && trimmed.startsWith("## ")) {
      inRequirements = false;
      continue;
    }

    if (inRequirements && (trimmed.startsWith("- ") || trimmed.startsWith("* "))) {
      const description = trimmed.slice(2).trim();
      const priority = inferPriority(description);
      const effort = inferEffort(description);

      requirements.push({
        id: `req-${++counter}`,
        description,
        priority,
        estimatedEffort: effort,
      });
    }
  }

  // If no requirement section found, treat all bullet points as requirements
  if (requirements.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        requirements.push({
          id: `req-${++counter}`,
          description: trimmed.slice(2).trim(),
          priority: "should",
          estimatedEffort: "medium",
        });
      }
    }
  }

  return requirements;
}

function extractSection(lines: readonly string[], keyword: string): readonly string[] {
  const items: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (lower.includes(keyword) && trimmed.startsWith("#")) {
      inSection = true;
      continue;
    }
    if (inSection && trimmed.startsWith("## ")) {
      inSection = false;
      continue;
    }

    if (inSection && (trimmed.startsWith("- ") || trimmed.startsWith("* "))) {
      items.push(trimmed.slice(2).trim());
    }
  }

  return items;
}

function inferPriority(text: string): SpecRequirement["priority"] {
  const lower = text.toLowerCase();
  if (/\b(must|critical|required|essential)\b/.test(lower)) return "must";
  if (/\b(should|important|recommended)\b/.test(lower)) return "should";
  if (/\b(could|nice[\s-]to[\s-]have|optional)\b/.test(lower)) return "could";
  if (/\b(won'?t|deferred|out[\s-]of[\s-]scope)\b/.test(lower)) return "wont";
  return "should";
}

function inferEffort(text: string): SpecRequirement["estimatedEffort"] {
  const lower = text.toLowerCase();
  if (/\b(simple|trivial|quick|minor)\b/.test(lower)) return "small";
  if (/\b(complex|large|major|significant|architecture)\b/.test(lower)) return "large";
  return "medium";
}
