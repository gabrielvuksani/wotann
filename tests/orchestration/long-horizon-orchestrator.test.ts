import { describe, it, expect } from "vitest";
import {
  LongHorizonOrchestrator,
  parsePhases,
  type OrchestratorEvent,
  type WorkerExecutor,
  type Scorer,
} from "../../src/orchestration/long-horizon-orchestrator.js";
import type { Phase } from "../../src/orchestration/phase-gate.js";
import type { PersonaExecutor } from "../../src/orchestration/dual-persona-reviewer.js";

// ── Helpers ────────────────────────────────────────────

function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "p1",
    name: "Phase 1",
    goal: "Produce artifact",
    maxIterations: 10,
    entry: { prevMinScore: 0, prevRequiresArtifact: false },
    exit: { minScore: 0.8, requireReviewPass: false },
    ...overrides,
  };
}

/**
 * Builds a worker that produces artifacts whose length grows each iteration
 * so the default heuristic scorer gets progressively higher scores.
 */
function makeScalingWorker(tokensPerCall = 100): WorkerExecutor {
  return async ({ iteration }) => ({
    artifact: "x".repeat(200 + iteration * 400),
    tokensUsed: tokensPerCall,
    costUsd: 0.01,
  });
}

function makeScalingScorer(): Scorer {
  // Scores based on artifact length, capped at 1.0.
  return async (artifact) => Math.min(1, artifact.length / 1000);
}

function makeAcceptingReviewer(): PersonaExecutor {
  return async (persona) => ({
    verdict: persona === "defender" ? "accept" : "accept",
    confidence: 0.9,
    reasoning: `${persona} accepts`,
    tokensUsed: 50,
    ...(persona === "critic" ? { issues: [] } : { strengths: ["ok"] }),
  });
}

// ── Tests ──────────────────────────────────────────────

describe("LongHorizonOrchestrator: 3-phase toy task", () => {
  it("completes all phases when scorer converges", async () => {
    const orchestrator = new LongHorizonOrchestrator({
      enableReview: false,
      enableTierEscalation: false,
      enableHumanInLoop: false,
    });
    const phases: Phase[] = [
      makePhase({ id: "outline", name: "Outline", maxIterations: 5 }),
      makePhase({
        id: "draft",
        name: "Draft",
        maxIterations: 5,
        entry: { prevMinScore: 0.8, prevRequiresArtifact: true },
      }),
      makePhase({
        id: "polish",
        name: "Polish",
        maxIterations: 5,
        entry: { prevMinScore: 0.8, prevRequiresArtifact: true },
      }),
    ];

    const events: OrchestratorEvent[] = [];
    const result = await orchestrator.run({
      taskDescription: "write a 75K-word novel",
      phases,
      worker: makeScalingWorker(),
      scorer: makeScalingScorer(),
      onEvent: (e) => events.push(e),
    });

    expect(result.success).toBe(true);
    expect(result.exitReason).toBe("all-phases-exited");
    expect(result.phases).toHaveLength(3);
    for (const p of result.phases) {
      expect(p.status).toBe("exited");
      expect(p.bestIteration?.score).toBeGreaterThanOrEqual(0.8);
    }

    // Progress events should fire.
    expect(events.some((e) => e.kind === "progress")).toBe(true);
    // Phase transitions.
    expect(events.filter((e) => e.kind === "phase-start")).toHaveLength(3);
    expect(events.filter((e) => e.kind === "phase-end")).toHaveLength(3);
    // Orchestrator-end fires once.
    expect(events.filter((e) => e.kind === "orchestrator-end")).toHaveLength(1);
  });

  it("blocks entry when previous phase score is too low for gate threshold", async () => {
    const orchestrator = new LongHorizonOrchestrator({
      enableReview: false,
      enableTierEscalation: false,
      enableHumanInLoop: false,
      // Plateau detection off so a flat-but-passing scorer doesn't abort.
      plateauConfig: { windowSize: 5, deltaThreshold: 0, minIterations: 1000 },
    });
    const phases: Phase[] = [
      makePhase({
        id: "first",
        maxIterations: 3,
        // Low exit score so first phase EXITS with score 0.5.
        exit: { minScore: 0.4, requireReviewPass: false },
      }),
      makePhase({
        id: "second",
        // But second phase requires prev score >= 0.99 — unreachable.
        entry: { prevMinScore: 0.99, prevRequiresArtifact: true },
      }),
    ];

    const result = await orchestrator.run({
      taskDescription: "test",
      phases,
      // Worker always produces the same mid-length artifact → score 0.5.
      worker: async () => ({ artifact: "x".repeat(500), tokensUsed: 10, costUsd: 0.001 }),
      scorer: async () => 0.5,
    });

    expect(result.success).toBe(false);
    expect(result.exitReason).toBe("phase-entry-blocked");
    // First phase actually exited cleanly — we just can't cross the gate.
    expect(result.phases[0]?.status).toBe("exited");
  });

  it("respects budget: time cap — aborts mid-phase", async () => {
    const orchestrator = new LongHorizonOrchestrator({
      budget: { tokens: 1_000_000, timeMs: 50, usd: 100 }, // 50ms hard cap
      enableReview: false,
      enableHumanInLoop: false,
    });
    const phases: Phase[] = [
      makePhase({
        id: "slow",
        maxIterations: 10,
        exit: { minScore: 0.99, requireReviewPass: false }, // never reaches
      }),
    ];

    const events: OrchestratorEvent[] = [];
    const result = await orchestrator.run({
      taskDescription: "test",
      phases,
      worker: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { artifact: "x".repeat(100), tokensUsed: 10, costUsd: 0 };
      },
      scorer: async () => 0.1, // always low
      onEvent: (e) => events.push(e),
    });

    expect(result.success).toBe(false);
    expect(result.exitReason).toBe("budget-time");
    expect(events.some((e) => e.kind === "budget-exceeded")).toBe(true);
  });

  it("respects budget: token cap — aborts honestly", async () => {
    const orchestrator = new LongHorizonOrchestrator({
      budget: { tokens: 150, timeMs: 60_000, usd: 100 }, // very small token cap
      enableReview: false,
    });
    const phases: Phase[] = [
      makePhase({
        id: "p",
        maxIterations: 10,
        exit: { minScore: 0.99, requireReviewPass: false },
      }),
    ];

    const result = await orchestrator.run({
      taskDescription: "test",
      phases,
      worker: async () => ({ artifact: "x".repeat(50), tokensUsed: 100, costUsd: 0 }),
      scorer: async () => 0.1,
    });
    expect(result.exitReason).toBe("budget-tokens");
  });

  it("exhausts phase when max iterations hit without reaching exit score", async () => {
    const orchestrator = new LongHorizonOrchestrator({
      enableReview: false,
      enableHumanInLoop: false,
    });
    const phases: Phase[] = [
      makePhase({
        id: "p",
        maxIterations: 3, // low cap
        exit: { minScore: 0.99, requireReviewPass: false }, // unreachable by worker below
      }),
    ];

    const result = await orchestrator.run({
      taskDescription: "test",
      phases,
      worker: async () => ({ artifact: "short", tokensUsed: 50, costUsd: 0 }),
      scorer: async () => 0.2, // always below exit threshold
    });

    expect(result.success).toBe(false);
    expect(result.exitReason).toBe("phase-exhausted");
    expect(result.phases[0]?.status).toBe("exhausted");
  });

  it("aborts on persistent plateau (no silent infinite loop)", async () => {
    const orchestrator = new LongHorizonOrchestrator({
      enableReview: false,
      enableTierEscalation: false,
      enableHumanInLoop: false,
      plateauConfig: {
        windowSize: 3,
        deltaThreshold: 0.01,
        minIterations: 3,
      },
    });
    const phases: Phase[] = [
      makePhase({
        id: "p",
        maxIterations: 15, // enough to hit plateau cycles
        exit: { minScore: 0.99, requireReviewPass: false },
      }),
    ];

    const events: OrchestratorEvent[] = [];
    const result = await orchestrator.run({
      taskDescription: "test",
      phases,
      // Flat scorer: every artifact scores identically → plateau.
      worker: async () => ({ artifact: "same", tokensUsed: 10, costUsd: 0 }),
      scorer: async () => 0.5,
      onEvent: (e) => events.push(e),
    });

    expect(result.success).toBe(false);
    expect(result.exitReason).toBe("plateau-abort");
    // Plateau events fire with escalating responses — honest signal.
    const plateauEvents = events.filter((e) => e.kind === "plateau");
    expect(plateauEvents.length).toBeGreaterThan(0);
  });

  it("uses dual-persona review at exit when requireReviewPass=true", async () => {
    const orchestrator = new LongHorizonOrchestrator({
      enableReview: true,
      enableTierEscalation: false,
    });
    const phases: Phase[] = [
      makePhase({
        id: "reviewed",
        maxIterations: 3,
        exit: { minScore: 0.5, requireReviewPass: true },
      }),
    ];

    const events: OrchestratorEvent[] = [];
    const result = await orchestrator.run({
      taskDescription: "test",
      phases,
      worker: makeScalingWorker(),
      scorer: async () => 0.9, // above min
      reviewer: makeAcceptingReviewer(),
      onEvent: (e) => events.push(e),
    });

    expect(result.success).toBe(true);
    expect(events.some((e) => e.kind === "review")).toBe(true);
  });

  it("persists a checkpoint after each exited phase", async () => {
    const orchestrator = new LongHorizonOrchestrator({ enableReview: false });
    const phases: Phase[] = [
      makePhase({ id: "p1", maxIterations: 3 }),
      makePhase({ id: "p2", maxIterations: 3, entry: { prevMinScore: 0.8, prevRequiresArtifact: true } }),
    ];

    const snapshots: string[] = [];
    const result = await orchestrator.run({
      taskDescription: "test",
      phases,
      worker: makeScalingWorker(),
      scorer: makeScalingScorer(),
      saveCheckpoint: async (snap) => {
        snapshots.push(`phase-${snap.currentPhaseIndex}`);
      },
    });

    expect(result.success).toBe(true);
    expect(snapshots).toContain("phase-0");
    expect(snapshots).toContain("phase-1");
  });

  it("aborts gracefully when worker returns null", async () => {
    const orchestrator = new LongHorizonOrchestrator({ enableReview: false });
    const phases: Phase[] = [makePhase({ id: "p", maxIterations: 3 })];

    const result = await orchestrator.run({
      taskDescription: "test",
      phases,
      worker: async () => null, // simulate no-provider state
      scorer: async () => 0.9,
    });

    expect(result.success).toBe(false);
    expect(result.exitReason).toBe("worker-null");
  });
});

// ── JSON phase parsing ─────────────────────────────────

describe("parsePhases", () => {
  it("parses a valid phases array", () => {
    const raw = [
      {
        id: "outline",
        name: "Outline",
        goal: "make outline",
        maxIterations: 5,
        entry: { prevMinScore: 0, prevRequiresArtifact: false },
        exit: { minScore: 0.8, requireReviewPass: true },
      },
    ];
    const phases = parsePhases(raw);
    expect(phases).toHaveLength(1);
    expect(phases[0]?.id).toBe("outline");
    expect(phases[0]?.exit.requireReviewPass).toBe(true);
  });

  it("rejects non-array input", () => {
    expect(() => parsePhases({ not: "array" })).toThrow(/expected array/);
  });

  it("rejects missing required fields", () => {
    expect(() => parsePhases([{ id: "x" }])).toThrow(/missing field/);
  });

  it("rejects invalid maxIterations", () => {
    expect(() =>
      parsePhases([{ id: "x", name: "x", goal: "x", maxIterations: 0 }]),
    ).toThrow(/maxIterations must be >= 1/);
  });

  it("defaults entry and exit when omitted", () => {
    const phases = parsePhases([
      { id: "x", name: "X", goal: "g", maxIterations: 3 },
    ]);
    expect(phases[0]?.entry.prevMinScore).toBe(0);
    expect(phases[0]?.exit.minScore).toBe(0.8);
  });
});

// ── rc.2 follow-up: PhasedExecutor-backed phase validation (P2 partial) ──

describe("LongHorizonOrchestrator.getPhaseNames (PhasedExecutor validation)", () => {
  it("returns phase ids in declared order", () => {
    const phases: readonly Phase[] = [
      makePhase({ id: "outline", name: "Outline" }),
      makePhase({ id: "draft", name: "Draft" }),
      makePhase({ id: "polish", name: "Polish" }),
    ];
    expect(LongHorizonOrchestrator.getPhaseNames(phases)).toEqual(["outline", "draft", "polish"]);
  });

  it("throws when two phases share the same id (duplicate detection)", () => {
    const phases: readonly Phase[] = [
      makePhase({ id: "outline", name: "Outline" }),
      makePhase({ id: "outline", name: "Outline v2" }),
    ];
    expect(() => LongHorizonOrchestrator.getPhaseNames(phases)).toThrow(/duplicate phase/i);
  });

  it("throws when the phases array is empty", () => {
    expect(() => LongHorizonOrchestrator.getPhaseNames([])).toThrow(/at least one phase/i);
  });

  it("run() surfaces duplicate-phase error before any worker call", async () => {
    const orch = new LongHorizonOrchestrator({ enableReview: false });
    let workerInvoked = false;
    const worker: WorkerExecutor = async () => {
      workerInvoked = true;
      return { artifact: "x", tokensUsed: 1, costUsd: 0 };
    };
    const phases: readonly Phase[] = [
      makePhase({ id: "p", name: "P" }),
      makePhase({ id: "p", name: "P again" }),
    ];
    await expect(
      orch.run({
        taskDescription: "duplicate-phase test",
        phases,
        worker,
        scorer: makeScalingScorer(),
      }),
    ).rejects.toThrow(/duplicate phase/i);
    expect(workerInvoked).toBe(false);
  });
});
