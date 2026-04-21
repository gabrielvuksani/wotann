/**
 * Runtime getter wire-test for B7 GoalDriftDetector (P1-B7 part 3).
 *
 * Verifies `runtime.getGoalDriftDetector()`:
 *  - returns null when the gate is off (default)
 *  - returns an instance when `enableGoalDrift: true` is supplied
 *  - returns an instance when `WOTANN_GOAL_DRIFT=1` env var is set
 *  - returns stable singleton across calls
 *  - `getTodoProvider()` defaults to NullTodoProvider
 *  - `getTodoProvider()` returns injected provider when configured
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { WotannRuntime } from "../../src/core/runtime.js";
import { GoalDriftDetector } from "../../src/orchestration/goal-drift.js";
import {
  NullTodoProvider,
  createFsTodoProvider,
  type TodoProvider,
} from "../../src/orchestration/todo-provider.js";

describe("WotannRuntime × GoalDriftDetector wire-up", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createRuntime(overrides?: {
    enableGoalDrift?: boolean;
    todoProvider?: TodoProvider;
  }): WotannRuntime {
    vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
    return new WotannRuntime({
      workingDir: process.cwd(),
      enableMemory: false,
      hookProfile: "standard",
      ...overrides,
    });
  }

  it("getGoalDriftDetector() returns null when the gate is off (default)", () => {
    vi.stubEnv("WOTANN_GOAL_DRIFT", "");
    const runtime = createRuntime();
    expect(runtime.getGoalDriftDetector()).toBeNull();
  });

  it("getGoalDriftDetector() returns an instance when enableGoalDrift=true", () => {
    vi.stubEnv("WOTANN_GOAL_DRIFT", "");
    const runtime = createRuntime({ enableGoalDrift: true });
    const detector = runtime.getGoalDriftDetector();
    expect(detector).not.toBeNull();
    expect(detector).toBeInstanceOf(GoalDriftDetector);
  });

  it("getGoalDriftDetector() returns an instance when WOTANN_GOAL_DRIFT=1", () => {
    vi.stubEnv("WOTANN_GOAL_DRIFT", "1");
    const runtime = createRuntime();
    expect(runtime.getGoalDriftDetector()).not.toBeNull();
  });

  it("getGoalDriftDetector() returns the SAME instance on repeated calls (singleton)", () => {
    vi.stubEnv("WOTANN_GOAL_DRIFT", "");
    const runtime = createRuntime({ enableGoalDrift: true });
    const first = runtime.getGoalDriftDetector();
    const second = runtime.getGoalDriftDetector();
    expect(first).toBe(second);
  });

  it("getGoalDriftDetector() stays null even after repeated calls when gate is off", () => {
    vi.stubEnv("WOTANN_GOAL_DRIFT", "");
    const runtime = createRuntime();
    expect(runtime.getGoalDriftDetector()).toBeNull();
    expect(runtime.getGoalDriftDetector()).toBeNull();
  });

  it("getTodoProvider() defaults to NullTodoProvider when config is unset", () => {
    const runtime = createRuntime();
    expect(runtime.getTodoProvider()).toBe(NullTodoProvider);
  });

  it("getTodoProvider() returns the injected provider when configured", () => {
    const custom = createFsTodoProvider({ rootDir: "/tmp" });
    const runtime = createRuntime({ todoProvider: custom });
    expect(runtime.getTodoProvider()).toBe(custom);
  });

  it("two independent runtimes produce independent detectors (QB #7 per-session)", () => {
    const a = createRuntime({ enableGoalDrift: true });
    const b = createRuntime({ enableGoalDrift: true });
    const detA = a.getGoalDriftDetector();
    const detB = b.getGoalDriftDetector();
    expect(detA).not.toBeNull();
    expect(detB).not.toBeNull();
    expect(detA).not.toBe(detB);
  });

  it("explicit enableGoalDrift=false overrides WOTANN_GOAL_DRIFT=1 env var", () => {
    vi.stubEnv("WOTANN_GOAL_DRIFT", "1");
    const runtime = createRuntime({ enableGoalDrift: false });
    expect(runtime.getGoalDriftDetector()).toBeNull();
  });
});
