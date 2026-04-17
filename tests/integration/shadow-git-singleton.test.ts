import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookEngine } from "../../src/hooks/engine.js";
import {
  registerBuiltinHooks,
  createGitPreCheckpointHook,
} from "../../src/hooks/built-in.js";
import { ShadowGit } from "../../src/utils/shadow-git.js";

// Session-4 regression guards for Opus Agent 2's GAP-6:
// No test exercises the shadow-git singleton-identity chain.
// Session 2 shipped with 3 parallel ShadowGit instances silently
// decoupling shadow.undo. Session 3 fixed the runtime-hook-RPC chain,
// but no regression test would catch a future revival of the same
// bug pattern. These tests pin the invariant.
//
// Integration scope: runtime.getShadowGit() singleton identity,
// PreToolUse hook populates the ring, getRecentCheckpoints reads it.
// End-to-end RPC exercise requires a live daemon; the in-memory chain
// is what mattered for S3-3 rollback to work.

describe("ShadowGit singleton identity (Agent 2 GAP-6)", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "shadow-git-singleton-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("registerBuiltinHooks + createGitPreCheckpointHook share one ring buffer", async () => {
    // Session 2's bug: the hook closure used one ShadowGit instance and
    // the RPC handler constructed another — writes to one never showed
    // up in reads from the other. Session 3 threaded the singleton.
    const shadowGit = new ShadowGit(workDir);
    await shadowGit.initialize();

    const engine = new HookEngine("standard");
    registerBuiltinHooks(engine, shadowGit);

    // Fire PreToolUse manually (the firing path runtime.ts uses).
    await engine.fire({
      event: "PreToolUse",
      toolName: "Write",
      filePath: join(workDir, "example.ts"),
      toolInput: { file_path: join(workDir, "example.ts"), content: "test" },
    });

    // Assert the ring buffer in our instance shows the checkpoint.
    const checkpoints = shadowGit.getRecentCheckpoints();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[checkpoints.length - 1]?.toolName).toBe("Write");
  });

  it("parallel ShadowGit instances DO NOT share ring buffer (anti-test)", async () => {
    // The exact bug we're preventing: if you construct two ShadowGit
    // instances against the same workDir, they have SEPARATE in-memory
    // ring buffers. Write to one, read from the other → empty. This
    // test formalises the contract so any future refactor that tries
    // to "just construct a new one" would see the gap.
    const a = new ShadowGit(workDir);
    await a.initialize();
    const b = new ShadowGit(workDir);
    await b.initialize();

    await a.beforeTool("Write", "test");

    const aCheckpoints = a.getRecentCheckpoints();
    const bCheckpoints = b.getRecentCheckpoints();
    expect(aCheckpoints.length).toBeGreaterThanOrEqual(1);
    expect(bCheckpoints.length).toBe(0);
    expect(aCheckpoints).not.toBe(bCheckpoints); // different Array identity
  });

  it("createGitPreCheckpointHook accepts a shared ShadowGit instance", async () => {
    const shadowGit = new ShadowGit(workDir);
    await shadowGit.initialize();

    const hook = createGitPreCheckpointHook(shadowGit);
    const engine = new HookEngine("standard");
    engine.register(hook);

    await engine.fire({
      event: "PreToolUse",
      toolName: "Edit",
      filePath: join(workDir, "foo.ts"),
    });

    // The same shadowGit instance passed into the hook should now have
    // the entry — proof that hook and caller share one ring.
    const checkpoints = shadowGit.getRecentCheckpoints();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[checkpoints.length - 1]?.toolName).toBe("Edit");
  });

  it("createGitPreCheckpointHook accepts a workDir string (standalone)", async () => {
    // Back-compat overload: tests / standalone callers that don't have
    // a runtime singleton still need this to construct a fresh instance.
    // The hook must not throw, and should populate its own ring buffer.
    const hook = createGitPreCheckpointHook(workDir);
    const engine = new HookEngine("standard");
    engine.register(hook);

    const result = await engine.fire({
      event: "PreToolUse",
      toolName: "Write",
      filePath: join(workDir, "a.ts"),
    });

    // Hook did not error out and did not block.
    expect(["allow", "warn"]).toContain(result.action);
  });

  it("beforeTool silently returns empty string for non-mutating tools", async () => {
    const shadowGit = new ShadowGit(workDir);
    await shadowGit.initialize();

    // Read / Bash / WebFetch are not in the MUTATING_TOOLS set; they
    // should not populate the ring.
    const readHash = await shadowGit.beforeTool("Read");
    const bashHash = await shadowGit.beforeTool("Bash");
    const writeHash = await shadowGit.beforeTool("Write");

    expect(readHash).toBe("");
    expect(bashHash).toBe("");
    expect(writeHash).not.toBe(""); // Write IS mutating
  });
});
