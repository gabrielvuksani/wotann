/**
 * Tests for OpenHands-style todo.md goal-drift protocol (P1-B7).
 *
 * Covers:
 *  - TodoTracker lifecycle (start / complete / add / remove / reload)
 *  - todo.md render + parse round-trip
 *  - TodoRegistry per-session isolation (QB #7)
 *  - TodoParseError on corrupt input (QB #6)
 *  - GoalDriftDetector heuristic: drift vs no-drift + reasons
 *  - GoalDriftDetector LLM-assisted variant + injectable LlmQuery
 *  - GoalDriftDetector honest fallback when LLM fails
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TodoTracker,
  TodoRegistry,
  TodoParseError,
  UnknownSubgoal,
  renderTodoMd,
  parseTodoMd,
} from "../../src/orchestration/todo-tracker.js";
import {
  GoalDriftDetector,
  type AgentAction,
  type LlmQuery,
} from "../../src/orchestration/goal-drift.js";

// Helpers -------------------------------------------------

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "wotann-todo-"));
}

function fixedClock(): () => string {
  let t = 0;
  return () => {
    t += 1;
    return `2026-04-20T12:00:${String(t).padStart(2, "0")}.000Z`;
  };
}

function fixedIds(): () => string {
  let i = 0;
  return () => {
    i += 1;
    return `id-${i.toString().padStart(3, "0")}`;
  };
}

// TodoTracker lifecycle ----------------------------------

describe("TodoTracker — lifecycle", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("start creates a tracker and writes todo.md with initial subgoals", () => {
    const tracker = TodoTracker.start(
      "task-1",
      "build a thing",
      ["plan the thing", "implement the thing", "verify the thing"],
      { workingDir: dir, now: fixedClock(), nextId: fixedIds() },
    );
    const state = tracker.state();
    expect(state.pending).toHaveLength(3);
    expect(state.done).toHaveLength(0);
    expect(state.pending[0]?.description).toBe("plan the thing");
    expect(state.pending[0]?.id).toBe("id-001");
    expect(tracker.path).not.toBeNull();
    expect(existsSync(tracker.path!)).toBe(true);
    const onDisk = readFileSync(tracker.path!, "utf-8");
    expect(onDisk).toContain("# Task: task-1");
    expect(onDisk).toContain("plan the thing");
    expect(onDisk).toContain("[ ] plan the thing");
  });

  it("complete marks a subgoal done + records scope change + re-persists", () => {
    const tracker = TodoTracker.start("task-2", "spec", ["a", "b"], {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
    });
    const sgId = tracker.state().pending[0]!.id;
    tracker.complete(sgId);
    const state = tracker.state();
    expect(state.done).toHaveLength(1);
    expect(state.pending).toHaveLength(1);
    expect(state.done[0]?.id).toBe(sgId);
    expect(state.done[0]?.status).toBe("done");
    expect(state.done[0]?.completedAt).toBeDefined();
    expect(state.scopeChanges).toHaveLength(1);
    expect(state.scopeChanges[0]?.kind).toBe("completed");
    const disk = readFileSync(tracker.path!, "utf-8");
    expect(disk).toContain("[x] a");
    expect(disk).toContain("[ ] b");
  });

  it("add appends a new pending subgoal and records it as a scope change", () => {
    const tracker = TodoTracker.start("task-3", "spec", ["a"], {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
    });
    const sg = tracker.add("newly discovered subgoal");
    const state = tracker.state();
    expect(state.pending).toHaveLength(2);
    expect(state.pending.some((s) => s.id === sg.id)).toBe(true);
    expect(state.scopeChanges).toHaveLength(1);
    expect(state.scopeChanges[0]?.kind).toBe("added");
    expect(state.scopeChanges[0]?.description).toBe("newly discovered subgoal");
  });

  it("remove deletes a subgoal and logs the scope change", () => {
    const tracker = TodoTracker.start("task-4", "spec", ["a", "b"], {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
    });
    const target = tracker.state().pending[1]!;
    tracker.remove(target.id);
    const state = tracker.state();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]?.id).not.toBe(target.id);
    expect(state.scopeChanges[0]?.kind).toBe("removed");
    expect(state.scopeChanges[0]?.subgoalId).toBe(target.id);
  });

  it("complete / remove throw UnknownSubgoal for bad ids (honest failure)", () => {
    const tracker = TodoTracker.start("task-5", "spec", ["a"], {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
    });
    expect(() => tracker.complete("does-not-exist")).toThrow(UnknownSubgoal);
    expect(() => tracker.remove("does-not-exist")).toThrow(UnknownSubgoal);
  });

  it("add rejects empty description", () => {
    const tracker = TodoTracker.start("task-6", "spec", ["a"], {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
    });
    expect(() => tracker.add("   ")).toThrow(/non-empty/);
  });
});

// Persistence / round-trip -------------------------------

describe("TodoTracker — render/parse round-trip", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("state serialization survives a render -> parse round-trip", () => {
    const tracker = TodoTracker.start("task-rt", "the spec here", ["a", "b", "c"], {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
    });
    const firstId = tracker.state().pending[0]!.id;
    tracker.complete(firstId);
    tracker.add("new scope item");

    const rendered = renderTodoMd(tracker.state());
    const parsed = parseTodoMd(rendered);

    expect(parsed.taskSpec).toBe("the spec here");
    expect(parsed.subgoals).toHaveLength(4);
    const done = parsed.subgoals.filter((s) => s.status === "done");
    const pending = parsed.subgoals.filter((s) => s.status === "pending");
    expect(done).toHaveLength(1);
    expect(pending).toHaveLength(3);
    expect(done[0]?.completedAt).toBeDefined();
    expect(parsed.scopeChanges).toHaveLength(2);
    const kinds = parsed.scopeChanges.map((c) => c.kind).sort();
    expect(kinds).toEqual(["added", "completed"]);
  });

  it("load rehydrates a tracker from disk", () => {
    const original = TodoTracker.start("task-load", "spec", ["first", "second"], {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
    });
    const firstId = original.state().pending[0]!.id;
    original.complete(firstId);

    const loaded = TodoTracker.load("task-load", { workingDir: dir });
    const state = loaded.state();
    expect(state.pending).toHaveLength(1);
    expect(state.done).toHaveLength(1);
    expect(state.done[0]?.id).toBe(firstId);
    expect(state.pending[0]?.description).toBe("second");
  });

  it("load throws when file is missing", () => {
    expect(() => TodoTracker.load("missing-task", { workingDir: dir })).toThrow(/not found/);
  });
});

// Parse errors ------------------------------------------

describe("TodoTracker — corrupt todo.md (QB #6)", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("missing '# Task:' header yields TodoParseError", () => {
    const bad = "## Spec\n\nsomething\n\n## Subgoals\n";
    expect(() => parseTodoMd(bad)).toThrow(TodoParseError);
  });

  it("missing '## Spec' header yields TodoParseError", () => {
    const bad = "# Task: x\n\n## Subgoals\n";
    expect(() => parseTodoMd(bad)).toThrow(TodoParseError);
  });

  it("malformed subgoal bullet yields TodoParseError with line number", () => {
    const bad = [
      "# Task: t",
      "",
      "## Spec",
      "",
      "s",
      "",
      "## Subgoals",
      "",
      "this is not a bullet at all",
      "",
    ].join("\n");
    let caught: unknown = null;
    try {
      parseTodoMd(bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TodoParseError);
    const err = caught as TodoParseError;
    expect(err.lineNumber).toBeGreaterThan(0);
    expect(err.message).toContain("expected subgoal bullet");
  });

  it("malformed checkbox yields TodoParseError", () => {
    const bad = [
      "# Task: t",
      "",
      "## Spec",
      "",
      "s",
      "",
      "## Subgoals",
      "",
      "- [?] weird status",
      "",
    ].join("\n");
    expect(() => parseTodoMd(bad)).toThrow(TodoParseError);
  });

  it("load propagates TodoParseError (no silent empty state)", () => {
    const path = join(dir, ".wotann", "todos", "bad.md");
    mkdirSync(join(dir, ".wotann", "todos"), { recursive: true });
    writeFileSync(path, "garbage — not a todo.md");
    expect(() => TodoTracker.load("bad", { workingDir: dir })).toThrow(TodoParseError);
  });
});

// Registry isolation (QB #7) ------------------------------

describe("TodoRegistry — per-session isolation (QB #7)", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("two independent registries never share trackers", () => {
    const alphaDir = mkdtempSync(join(tmpdir(), "wotann-reg-alpha-"));
    const betaDir = mkdtempSync(join(tmpdir(), "wotann-reg-beta-"));
    try {
      const alpha = new TodoRegistry({ workingDir: alphaDir });
      const beta = new TodoRegistry({ workingDir: betaDir });
      alpha.start("shared-id", "spec a", ["a1"]);
      beta.start("shared-id", "spec b", ["b1"]);
      expect(alpha.size()).toBe(1);
      expect(beta.size()).toBe(1);
      const aTracker = alpha.get("shared-id")!;
      const bTracker = beta.get("shared-id")!;
      expect(aTracker.state().pending[0]?.description).toBe("a1");
      expect(bTracker.state().pending[0]?.description).toBe("b1");
      // Mutating one must not leak to the other.
      aTracker.complete(aTracker.state().pending[0]!.id);
      expect(bTracker.state().done).toHaveLength(0);
      expect(bTracker.state().pending).toHaveLength(1);
    } finally {
      rmSync(alphaDir, { recursive: true, force: true });
      rmSync(betaDir, { recursive: true, force: true });
    }
  });

  it("starting a duplicate taskId throws", () => {
    const reg = new TodoRegistry({ workingDir: dir });
    reg.start("x", "s", ["a"]);
    expect(() => reg.start("x", "s2", ["b"])).toThrow(/already exists/);
  });

  it("get returns null for unknown taskId", () => {
    const reg = new TodoRegistry({ workingDir: dir });
    expect(reg.get("nope")).toBeNull();
  });

  it("drop removes the tracker entry", () => {
    const reg = new TodoRegistry({ workingDir: dir });
    reg.start("y", "s", ["a"]);
    expect(reg.size()).toBe(1);
    expect(reg.drop("y")).toBe(true);
    expect(reg.size()).toBe(0);
    expect(reg.drop("nope")).toBe(false);
  });
});

// GoalDriftDetector heuristics ----------------------------

describe("GoalDriftDetector — heuristic", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeState(pending: readonly string[]) {
    const tracker = TodoTracker.start("t", "s", pending, {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
      persist: false,
    });
    return tracker.state();
  }

  it("action matching a pending todo -> no drift", async () => {
    const state = makeState(["implement user authentication", "write onboarding email"]);
    const action: AgentAction = {
      kind: "edit_file",
      description: "implement the user authentication flow in auth.ts",
      target: "src/auth.ts",
    };
    const det = new GoalDriftDetector();
    const r = await det.checkAction(state, action);
    expect(r.drift).toBe(false);
    expect(r.method).toBe("heuristic");
    expect(r.bestRelevance).toBeGreaterThan(0.18);
    expect(r.reason).toContain("matches subgoal");
  });

  it("action on a scope NOT in any todo -> drift with reason", async () => {
    const state = makeState(["implement user authentication"]);
    const action: AgentAction = {
      kind: "edit_file",
      description: "refactor the billing subsystem storage layer",
      target: "src/billing/storage.ts",
    };
    const det = new GoalDriftDetector();
    const r = await det.checkAction(state, action);
    expect(r.drift).toBe(true);
    expect(r.method).toBe("heuristic");
    expect(r.reason).toMatch(/no pending todo matched/);
  });

  it("no pending todos -> no drift (with explicit reason)", async () => {
    const state = makeState([]);
    const det = new GoalDriftDetector();
    const r = await det.checkAction(state, {
      kind: "edit_file",
      description: "anything",
    });
    expect(r.drift).toBe(false);
    expect(r.reason).toContain("no pending todos");
  });

  it("checkActions drifts if ANY action in the batch drifts", async () => {
    const state = makeState(["implement auth"]);
    const det = new GoalDriftDetector();
    const r = await det.checkActions(state, [
      { kind: "edit_file", description: "implement auth login handler" },
      { kind: "run_shell", description: "delete the billing database" },
    ]);
    expect(r.drift).toBe(true);
  });

  it("driftThreshold rejects invalid configs", () => {
    expect(() => new GoalDriftDetector({ driftThreshold: -1 })).toThrow();
    expect(() => new GoalDriftDetector({ driftThreshold: 2 })).toThrow();
    expect(() => new GoalDriftDetector({ ambiguityBand: -0.1 })).toThrow();
  });
});

// GoalDriftDetector LLM variant ---------------------------

describe("GoalDriftDetector — LLM-assisted (injectable LlmQuery)", () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeState(pending: readonly string[]) {
    return TodoTracker.start("t", "s", pending, {
      workingDir: dir,
      now: fixedClock(),
      nextId: fixedIds(),
      persist: false,
    }).state();
  }

  it("LLM overrides the heuristic when alwaysUseLlm=true", async () => {
    const state = makeState(["implement user auth"]);
    const llm: LlmQuery = async () => "DRIFT=no REASON=semantically-related to auth work";
    const det = new GoalDriftDetector({ llm, alwaysUseLlm: true });
    const r = await det.checkAction(state, {
      kind: "edit_file",
      description: "wire up session cookies in the middleware pipeline",
    });
    expect(r.method).toBe("llm");
    expect(r.drift).toBe(false);
    expect(r.reason).toContain("semantically");
  });

  it("LLM can FLAG drift even when heuristic was lenient (alwaysUseLlm)", async () => {
    const state = makeState(["refactor billing"]);
    const llm: LlmQuery = async () => "DRIFT=yes REASON=user wanted refactor not feature add";
    const det = new GoalDriftDetector({ llm, alwaysUseLlm: true });
    const r = await det.checkAction(state, {
      kind: "edit_file",
      description: "refactor billing module",
    });
    expect(r.method).toBe("llm");
    expect(r.drift).toBe(true);
    expect(r.reason).toContain("feature add");
  });

  it("LLM failure falls back to heuristic with honest method='heuristic' (QB #6)", async () => {
    const state = makeState(["implement auth"]);
    const llm: LlmQuery = async () => {
      throw new Error("rate limit");
    };
    const det = new GoalDriftDetector({ llm, alwaysUseLlm: true });
    const r = await det.checkAction(state, {
      kind: "edit_file",
      description: "refactor billing subsystem storage layer",
    });
    expect(r.method).toBe("heuristic");
    // Heuristic should still correctly flag this as drift.
    expect(r.drift).toBe(true);
  });

  it("malformed LLM response falls back to heuristic", async () => {
    const state = makeState(["implement auth"]);
    const llm: LlmQuery = async () => "I think it's probably fine?";
    const det = new GoalDriftDetector({ llm, alwaysUseLlm: true });
    const r = await det.checkAction(state, {
      kind: "edit_file",
      description: "implement authentication flow",
    });
    expect(r.method).toBe("heuristic");
  });

  it("LLM is only consulted in the ambiguity band when alwaysUseLlm=false", async () => {
    let llmCalls = 0;
    const llm: LlmQuery = async () => {
      llmCalls++;
      return "DRIFT=no REASON=fine";
    };
    const det = new GoalDriftDetector({ llm, alwaysUseLlm: false });
    // Strong match — should NOT call LLM
    const strong = await det.checkAction(
      makeState(["implement user authentication flow"]),
      {
        kind: "edit_file",
        description: "implement user authentication flow and add login endpoint",
      },
    );
    expect(strong.method).toBe("heuristic");
    expect(llmCalls).toBe(0);
  });
});
