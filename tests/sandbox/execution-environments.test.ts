/**
 * C11 — Execution environment selector tests.
 */

import { describe, it, expect } from "vitest";
import {
  EXECUTION_ENVIRONMENTS,
  chooseEnvironment,
  describePlan,
  listAllEnvironments,
} from "../../src/sandbox/execution-environments.js";

describe("EXECUTION_ENVIRONMENTS invariants", () => {
  it("has three environments with expected names", () => {
    expect(Object.keys(EXECUTION_ENVIRONMENTS).sort()).toEqual(["docker", "local", "worktree"]);
  });

  it("isolation tier ascends local → worktree → docker", () => {
    expect(EXECUTION_ENVIRONMENTS.local.isolation).toBe("none");
    expect(EXECUTION_ENVIRONMENTS.worktree.isolation).toBe("filesystem");
    expect(EXECUTION_ENVIRONMENTS.docker.isolation).toBe("full");
  });

  it("startup cost ascends local → worktree → docker", () => {
    const local = EXECUTION_ENVIRONMENTS.local.startupCostMs;
    const worktree = EXECUTION_ENVIRONMENTS.worktree.startupCostMs;
    const docker = EXECUTION_ENVIRONMENTS.docker.startupCostMs;
    expect(local).toBeLessThan(worktree);
    expect(worktree).toBeLessThan(docker);
  });

  it("rollback: local=no, worktree=yes, docker=yes", () => {
    expect(EXECUTION_ENVIRONMENTS.local.supportsRollback).toBe(false);
    expect(EXECUTION_ENVIRONMENTS.worktree.supportsRollback).toBe(true);
    expect(EXECUTION_ENVIRONMENTS.docker.supportsRollback).toBe(true);
  });
});

describe("chooseEnvironment selector", () => {
  it("safe → local", () => {
    const c = chooseEnvironment("safe");
    expect(c.env.name).toBe("local");
  });

  it("caution → worktree", () => {
    const c = chooseEnvironment("caution");
    expect(c.env.name).toBe("worktree");
  });

  it("dangerous → worktree", () => {
    const c = chooseEnvironment("dangerous");
    expect(c.env.name).toBe("worktree");
  });

  it("destructive → docker", () => {
    const c = chooseEnvironment("destructive");
    expect(c.env.name).toBe("docker");
  });

  it("destructive + docker unavailable → worktree fallback", () => {
    const c = chooseEnvironment("destructive", { dockerAvailable: false });
    expect(c.env.name).toBe("worktree");
    expect(c.reason).toMatch(/Docker unavailable/);
  });

  it("destructive-ops hint forces docker even for safe risk", () => {
    const c = chooseEnvironment("safe", { hasDestructiveOps: true });
    expect(c.env.name).toBe("docker");
  });

  it("touches-many-files hint escalates safe → worktree", () => {
    const c = chooseEnvironment("safe", { touchesManyFiles: true });
    expect(c.env.name).toBe("worktree");
  });

  it("user-requested overrides every heuristic", () => {
    const c = chooseEnvironment("destructive", { userRequested: "local" });
    expect(c.env.name).toBe("local");
    expect(c.reason).toMatch(/user requested/);
  });

  it("returns the other two environments as alternatives", () => {
    const c = chooseEnvironment("safe");
    expect([...c.alternatives].sort()).toEqual(["docker", "worktree"]);
  });
});

describe("describePlan", () => {
  it("renders the environment label + reason + tradeoffs", () => {
    const c = chooseEnvironment("dangerous");
    const out = describePlan(c);
    expect(out).toMatch(/Worktree/);
    expect(out).toMatch(/Reason:/);
    expect(out).toMatch(/Setup cost:/);
    expect(out).toMatch(/Rollback: yes/);
    expect(out).toMatch(/Alternatives:/);
  });
});

describe("listAllEnvironments", () => {
  it("returns 3 entries in fixed order", () => {
    const all = listAllEnvironments();
    expect(all.map((e) => e.name)).toEqual(["local", "worktree", "docker"]);
  });
});
