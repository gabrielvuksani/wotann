import { describe, it, expect } from "vitest";
import {
  canEnter,
  canExit,
  initPhaseState,
  isExhausted,
  markPhaseStatus,
  recordIteration,
  type IterationResult,
  type Phase,
} from "../../src/orchestration/phase-gate.js";

function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "p1",
    name: "Phase 1",
    goal: "Produce artifact 1",
    maxIterations: 5,
    entry: { prevMinScore: 0.8, prevRequiresArtifact: true },
    exit: { minScore: 0.8, requireReviewPass: false },
    ...overrides,
  };
}

function makeIter(overrides: Partial<IterationResult> = {}): IterationResult {
  return {
    iteration: 0,
    artifact: "hello",
    score: 0.9,
    reviewPassed: null,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("phase-gate: canEnter", () => {
  it("allows first phase with no previous state when no artifact required", () => {
    const phase = makePhase({ entry: { prevMinScore: 0, prevRequiresArtifact: false } });
    const verdict = canEnter(phase, null);
    expect(verdict.allowed).toBe(true);
  });

  it("blocks first phase when it requires a prior artifact", () => {
    const phase = makePhase({ entry: { prevMinScore: 0, prevRequiresArtifact: true } });
    const verdict = canEnter(phase, null);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/no previous phase/);
  });

  it("blocks when previous phase score is below threshold", () => {
    const prev = makePhase({ id: "prev" });
    let prevState = initPhaseState(prev);
    prevState = recordIteration(prevState, makeIter({ score: 0.5, artifact: "ok" }));
    prevState = markPhaseStatus(prevState, "exited");
    const phase = makePhase({ entry: { prevMinScore: 0.8, prevRequiresArtifact: true } });
    const verdict = canEnter(phase, prevState);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/score.*< required/);
  });

  it("blocks when previous phase didn't exit cleanly", () => {
    const prev = makePhase({ id: "prev" });
    let prevState = initPhaseState(prev);
    prevState = recordIteration(prevState, makeIter({ score: 0.9, artifact: "ok" }));
    prevState = markPhaseStatus(prevState, "exhausted");
    const phase = makePhase();
    const verdict = canEnter(phase, prevState);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/exhausted/);
  });

  it("blocks when prev required artifact is empty", () => {
    const prev = makePhase({ id: "prev" });
    let prevState = initPhaseState(prev);
    prevState = recordIteration(prevState, makeIter({ artifact: "" }));
    prevState = markPhaseStatus(prevState, "exited");
    const phase = makePhase({ entry: { prevMinScore: 0, prevRequiresArtifact: true } });
    const verdict = canEnter(phase, prevState);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/no artifact/);
  });

  it("allows when previous phase cleared all gates", () => {
    const prev = makePhase({ id: "prev" });
    let prevState = initPhaseState(prev);
    prevState = recordIteration(prevState, makeIter({ score: 0.95, artifact: "content" }));
    prevState = markPhaseStatus(prevState, "exited");
    const phase = makePhase();
    const verdict = canEnter(phase, prevState);
    expect(verdict.allowed).toBe(true);
  });
});

describe("phase-gate: canExit", () => {
  it("blocks when score is below threshold", () => {
    const phase = makePhase({ exit: { minScore: 0.9, requireReviewPass: false } });
    const verdict = canExit(phase, makeIter({ score: 0.5 }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/score/);
  });

  it("blocks when review required but no verdict", () => {
    const phase = makePhase({ exit: { minScore: 0.5, requireReviewPass: true } });
    const verdict = canExit(phase, makeIter({ reviewPassed: null }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/review/);
  });

  it("blocks when dual-persona reviewer rejected", () => {
    const phase = makePhase({ exit: { minScore: 0.5, requireReviewPass: true } });
    const verdict = canExit(phase, makeIter({ reviewPassed: false }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/rejected/);
  });

  it("blocks when artifact is empty", () => {
    const phase = makePhase();
    const verdict = canExit(phase, makeIter({ artifact: "" }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/empty/);
  });

  it("allows when all criteria pass", () => {
    const phase = makePhase({ exit: { minScore: 0.5, requireReviewPass: true } });
    const verdict = canExit(
      phase,
      makeIter({ score: 0.9, reviewPassed: true, artifact: "done" }),
    );
    expect(verdict.allowed).toBe(true);
  });
});

describe("phase-gate: isExhausted", () => {
  it("returns true at maxIterations", () => {
    const phase = makePhase({ maxIterations: 5 });
    expect(isExhausted(phase, 5)).toBe(true);
    expect(isExhausted(phase, 6)).toBe(true);
    expect(isExhausted(phase, 4)).toBe(false);
  });
});

describe("phase-gate: recordIteration", () => {
  it("appends iterations and tracks best-score", () => {
    const phase = makePhase();
    let s = initPhaseState(phase);
    s = recordIteration(s, makeIter({ iteration: 0, score: 0.5 }));
    expect(s.bestIteration?.score).toBe(0.5);
    s = recordIteration(s, makeIter({ iteration: 1, score: 0.8 }));
    expect(s.bestIteration?.score).toBe(0.8);
    s = recordIteration(s, makeIter({ iteration: 2, score: 0.7 }));
    // Best stays at 0.8, not regressed.
    expect(s.bestIteration?.score).toBe(0.8);
    expect(s.iterations.length).toBe(3);
  });

  it("transitions status from pending to running on first iteration", () => {
    const phase = makePhase();
    const initial = initPhaseState(phase);
    expect(initial.status).toBe("pending");
    const after = recordIteration(initial, makeIter());
    expect(after.status).toBe("running");
  });

  it("is immutable — returns new state without mutating input", () => {
    const phase = makePhase();
    const initial = initPhaseState(phase);
    const after = recordIteration(initial, makeIter());
    expect(initial.iterations.length).toBe(0);
    expect(after.iterations.length).toBe(1);
    expect(initial).not.toBe(after);
  });
});
