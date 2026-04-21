/**
 * Tests for `wotann best-of-n` — Cursor 3 /best-of-n slash command (P1-C6).
 *
 * Leverages the P1-B10 CriticRerank under the hood. Rollouts and critic
 * are injected as pure functions; worktree isolation uses WorktreeManager
 * with the gitExec mock to avoid real git calls.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBestOfN, type BestOfNEvent } from "../../src/cli/commands/best-of-n.js";
import type {
  CriticCandidate,
  CriticJudge,
  CriticTask,
} from "../../src/orchestration/critic-rerank.js";
import { WorktreeManager } from "../../src/orchestration/worktree-manager.js";

// ── Test helpers ──────────────────────────────────────────

function constantCritic(scores: readonly number[]): CriticJudge {
  let i = 0;
  return async (_task: CriticTask, candidate: CriticCandidate) => {
    const score = scores[i++] ?? 50;
    return { score, reasoning: `len=${candidate.output.length}` };
  };
}

function okGit(
  pairs: ReadonlyArray<readonly [string, { stdout?: string; stderr?: string }]>,
) {
  const map = new Map(pairs);
  return async (args: readonly string[]) => {
    const key = args.slice(0, 4).join(" ");
    const keys = [...map.keys()].sort((a, b) => b.length - a.length);
    const match = keys.find((k) => args.join(" ").startsWith(k) || key.startsWith(k));
    const resp = match !== undefined ? map.get(match) : undefined;
    return { stdout: resp?.stdout ?? "", stderr: resp?.stderr ?? "" };
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wotann-bon-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ── Tests ─────────────────────────────────────────────────

describe("runBestOfN — happy paths", () => {
  it("dispatches N=3 rollouts in parallel, returns critic-picked winner", async () => {
    let started = 0;
    const result = await runBestOfN({
      task: { task: "write add(a,b)" },
      N: 3,
      rollout: async (_t, idx) => {
        started++;
        return { output: `r${idx}`, metadata: { idx } };
      },
      critic: constantCritic([10, 90, 50]),
    });
    expect(result.success).toBe(true);
    expect(result.winner?.index).toBe(1);
    expect(result.winner?.score).toBe(90);
    expect(started).toBe(3);
    expect(result.rollouts).toHaveLength(3);
  });

  it("defaults to N=3 when omitted", async () => {
    let called = 0;
    const result = await runBestOfN({
      task: { task: "t" },
      rollout: async (_t, idx) => {
        called++;
        return { output: `r${idx}`, metadata: {} };
      },
      critic: constantCritic([10, 20, 30]),
    });
    expect(called).toBe(3);
    expect(result.winner?.index).toBe(2);
  });

  it("N=1 still routes through critic (single-rollout variant)", async () => {
    const result = await runBestOfN({
      task: { task: "single-rollout" },
      N: 1,
      rollout: async () => ({ output: "only", metadata: {} }),
      critic: constantCritic([42]),
    });
    expect(result.rollouts).toHaveLength(1);
    expect(result.winner?.score).toBe(42);
    expect(result.winner?.output).toBe("only");
  });

  it("emits rerank events through the onEvent sink", async () => {
    const events: BestOfNEvent[] = [];
    await runBestOfN({
      task: { task: "t" },
      N: 2,
      rollout: async (_t, idx) => ({ output: `r${idx}`, metadata: {} }),
      critic: constantCritic([10, 80]),
      onEvent: (e) => events.push(e),
    });
    const rerankKinds = events.filter((e) => e.kind === "rerank").map((e) => e.inner.kind);
    expect(rerankKinds).toContain("rollout.started");
    expect(rerankKinds).toContain("critic.scored");
    expect(rerankKinds).toContain("rerank.picked");
  });
});

describe("runBestOfN — honest failure surfacing", () => {
  it("all rollouts fail -> success=false + allFailed set + readable lines", async () => {
    const result = await runBestOfN({
      task: { task: "doomed" },
      N: 3,
      rollout: async (_t, idx) => {
        throw new Error(`rollout-${idx}-boom`);
      },
      critic: constantCritic([50]),
    });
    expect(result.success).toBe(false);
    expect(result.allFailed).toBeDefined();
    expect(result.allFailed?.reasons).toHaveLength(3);
    expect(result.allFailed?.reasons[0]).toContain("rollout-0-boom");
    expect(result.winner).toBeNull();
    expect(result.lines[0]).toMatch(/failed/);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.every((e) => e.stage === "generator")).toBe(true);
  });

  it("partial failure (1/3 error) still produces a winner", async () => {
    const result = await runBestOfN({
      task: { task: "survive" },
      N: 3,
      rollout: async (_t, idx) => {
        if (idx === 1) throw new Error("mid-fail");
        return { output: `r${idx}`, metadata: {} };
      },
      critic: constantCritic([30, 70, 70]),
    });
    // Indices 0 and 2 succeed. Critic gets them in iteration order
    // (index 0 first -> 30; index 2 second -> 70). Winner = index 2.
    expect(result.success).toBe(true);
    expect(result.winner?.index).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.stage).toBe("generator");
  });
});

describe("runBestOfN — argument validation", () => {
  it("rejects non-positive N with Error (not a structured result)", async () => {
    await expect(
      runBestOfN({
        task: { task: "t" },
        N: 0,
        rollout: async () => ({ output: "x", metadata: {} }),
        critic: constantCritic([50]),
      }),
    ).rejects.toThrow(/positive integer/i);
  });

  it("rejects fractional N", async () => {
    await expect(
      runBestOfN({
        task: { task: "t" },
        N: 2.5,
        rollout: async () => ({ output: "x", metadata: {} }),
        critic: constantCritic([50]),
      }),
    ).rejects.toThrow(/positive integer/i);
  });
});

describe("runBestOfN — worktree isolation", () => {
  it("spins up one worktree per rollout when isolate=true, abandons losers", async () => {
    const calls: string[][] = [];
    const git = okGit([
      ["rev-parse --verify", { stdout: "base\n" }],
      ["worktree add -b", { stdout: "" }],
      ["worktree remove", { stdout: "" }],
      ["worktree prune", { stdout: "" }],
      ["branch -D", { stdout: "" }],
    ]);
    const manager = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts"),
      gitExec: async (args) => {
        calls.push([...args]);
        return git(args);
      },
    });
    const seenWorkspaces = new Set<string>();
    const result = await runBestOfN({
      task: { task: "with-iso" },
      N: 3,
      isolate: true,
      worktreeManager: manager,
      taskIdPrefix: "iso-test",
      rollout: async (_t, _idx, ws) => {
        if (ws) seenWorkspaces.add(ws);
        return { output: `r${_idx}`, metadata: {} };
      },
      critic: constantCritic([20, 90, 40]),
    });
    expect(result.success).toBe(true);
    expect(result.winner?.index).toBe(1);
    expect(seenWorkspaces.size).toBe(3);
    // Winner's worktree is retained (active); losers abandoned.
    const entries = manager.list();
    expect(entries).toHaveLength(3);
    const active = entries.filter((e) => e.status === "active");
    const abandoned = entries.filter((e) => e.status === "abandoned");
    expect(active).toHaveLength(1);
    expect(active[0]?.taskId).toBe("iso-test-r1");
    expect(abandoned).toHaveLength(2);
  });

  it("isolate=false does not touch the WorktreeManager at all", async () => {
    const shouldNotRun: WorktreeManager = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "never"),
      gitExec: async () => {
        throw new Error("should never be called when isolate=false");
      },
    });
    const result = await runBestOfN({
      task: { task: "no-iso" },
      N: 2,
      rollout: async (_t, idx) => ({ output: `r${idx}`, metadata: {} }),
      critic: constantCritic([10, 80]),
      worktreeManager: shouldNotRun,
      isolate: false,
    });
    expect(result.success).toBe(true);
    expect(shouldNotRun.list()).toHaveLength(0);
  });

  it("all rollouts fail + isolate=true -> every worktree is abandoned", async () => {
    const manager = new WorktreeManager({
      repoRoot: tmpDir,
      worktreesDir: join(tmpDir, "wts-fail"),
      gitExec: okGit([
        ["rev-parse --verify", { stdout: "base\n" }],
        ["worktree add -b", { stdout: "" }],
        ["worktree remove", { stdout: "" }],
        ["worktree prune", { stdout: "" }],
        ["branch -D", { stdout: "" }],
      ]),
    });
    const result = await runBestOfN({
      task: { task: "fail-all" },
      N: 2,
      isolate: true,
      worktreeManager: manager,
      taskIdPrefix: "crash",
      rollout: async () => {
        throw new Error("boom");
      },
      critic: constantCritic([50]),
    });
    expect(result.success).toBe(false);
    expect(result.allFailed?.reasons).toHaveLength(2);
    const entries = manager.list();
    expect(entries.every((e) => e.status === "abandoned")).toBe(true);
  });
});

describe("runBestOfN — CriticRerank wiring proof (QB #14)", () => {
  it("uses CriticRerank's tie-breaker (shortest output wins at same score)", async () => {
    // Two rollouts score 80. Shorter output must win.
    const result = await runBestOfN({
      task: { task: "tie" },
      N: 2,
      rollout: async (_t, idx) =>
        idx === 0 ? { output: "short", metadata: {} } : { output: "LONGEROUTPUT", metadata: {} },
      critic: constantCritic([80, 80]),
    });
    expect(result.winner?.output).toBe("short");
  });
});
