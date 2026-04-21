/**
 * Wire-invocation tests for WotannRuntime.
 *
 * These tests prove that the primitives exposed as getters on
 * WotannRuntime are ACTUALLY CALLED in the runtime's query loop —
 * not just exposed. The original runtime-wiring.test.ts only
 * validated that `getPreCompletionVerifier()` returns a non-null
 * instance when the flag is on. That doesn't prove anything about
 * the loop wiring.
 *
 * Strategy:
 *   - Stub `runtime.infra.bridge.query()` to deliver a fixed
 *     assistant message.
 *   - Swap the lazily-constructed PreCompletionVerifier /
 *     ProgressiveBudget / Reflector for spies.
 *   - Drain `runtime.query(...)` and assert the spy was called with
 *     the expected shape.
 *
 * Every test here asserts the WIRE FIRES (or does not) based on
 * config flags — not just that a getter returns a non-null instance.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WotannRuntime } from "../../src/core/runtime.js";
import type {
  VerificationInput,
  VerificationReport,
} from "../../src/intelligence/pre-completion-verifier.js";
import { ProgressiveBudget } from "../../src/intelligence/progressive-budget.js";

// Tiny helper: stub the provider bridge so query() emits a
// deterministic assistant message without touching the network.
function stubBridge(
  runtime: WotannRuntime,
  content: string = "done.",
): void {
  (
    runtime as unknown as {
      infra: {
        bridge: {
          query: () => AsyncGenerator<
            | { type: "text"; content: string; provider: "anthropic" }
            | { type: "done"; content: string; provider: "anthropic" }
          >;
        };
      };
    }
  ).infra = {
    bridge: {
      async *query() {
        yield { type: "text", content, provider: "anthropic" as const };
        yield { type: "done", content: "", provider: "anthropic" as const };
      },
    },
  };
}

// Drain an async generator. Returns nothing — the point is to run
// the full query() loop so every wire-point executes.
async function drain(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

function passReport(): VerificationReport {
  return {
    status: "pass",
    perspectives: [],
    implementer: {
      perspective: "implementer",
      status: "pass",
      concerns: [],
      raw: "",
      durationMs: 0,
    },
    reviewer: {
      perspective: "reviewer",
      status: "pass",
      concerns: [],
      raw: "",
      durationMs: 0,
    },
    tester: {
      perspective: "tester",
      status: "pass",
      concerns: [],
      raw: "",
      durationMs: 0,
    },
    user: {
      perspective: "user",
      status: "pass",
      concerns: [],
      raw: "",
      durationMs: 0,
    },
    bypassed: false,
    totalDurationMs: 0,
    allConcerns: [],
  };
}

function failReport(concerns: readonly string[] = ["reviewer: missed edge case"]): VerificationReport {
  return {
    status: "fail",
    perspectives: [],
    implementer: {
      perspective: "implementer",
      status: "pass",
      concerns: [],
      raw: "",
      durationMs: 0,
    },
    reviewer: {
      perspective: "reviewer",
      status: "fail",
      concerns: ["missed edge case"],
      raw: "",
      durationMs: 0,
    },
    tester: {
      perspective: "tester",
      status: "pass",
      concerns: [],
      raw: "",
      durationMs: 0,
    },
    user: {
      perspective: "user",
      status: "pass",
      concerns: [],
      raw: "",
      durationMs: 0,
    },
    bypassed: false,
    totalDurationMs: 0,
    allConcerns: [...concerns],
  };
}

describe("WotannRuntime wire invocations", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function makeTempDir(): string {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-wire-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });
    return tempDir;
  }

  // ── B4 PreCompletionVerifier ────────────────────────────────

  describe("B4 PreCompletionVerifier wire", () => {
    it("is invoked after a turn when enablePreCompletionVerify=true", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
        enablePreCompletionVerify: true,
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      // Overwrite the lazy verifier slot with a spy that records every
      // call. We must cast through unknown because the field is
      // private.
      const verifySpy = vi.fn(async (_input: VerificationInput): Promise<VerificationReport> =>
        passReport(),
      );
      // Force construction to bind the spy in place of the real verifier.
      (runtime as unknown as {
        preCompletionVerifier: unknown;
      }).preCompletionVerifier = { verify: verifySpy };

      await drain(runtime.query({ prompt: "test prompt" }));

      expect(verifySpy).toHaveBeenCalledTimes(1);
      const call = verifySpy.mock.calls[0]?.[0];
      expect(call?.task).toContain("test prompt");
      expect(call?.result).toContain("answer.");

      runtime.close();
    });

    it("is NOT invoked when enablePreCompletionVerify is off (default)", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      vi.stubEnv("WOTANN_PRE_COMPLETION_VERIFY", "");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      // If wire fires, the lazy slot would be populated. We install a
      // tripwire that throws on any verify() call — if the wire runs
      // while flag is off, this would bubble up.
      const verifySpy = vi.fn(async (): Promise<VerificationReport> => {
        throw new Error("verify should not be invoked when flag is off");
      });
      (runtime as unknown as {
        preCompletionVerifier: unknown;
      }).preCompletionVerifier = { verify: verifySpy };

      await drain(runtime.query({ prompt: "test prompt" }));
      expect(verifySpy).not.toHaveBeenCalled();

      runtime.close();
    });

    it("yields an error chunk when verifier reports fail", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
        enablePreCompletionVerify: true,
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      (runtime as unknown as {
        preCompletionVerifier: unknown;
      }).preCompletionVerifier = {
        verify: vi.fn(async (): Promise<VerificationReport> => failReport()),
      };

      const chunks = (await drain(runtime.query({ prompt: "test" }))) as Array<{
        type: string;
        content: string;
      }>;
      const errorChunks = chunks.filter((c) => c.type === "error");
      expect(errorChunks.length).toBeGreaterThan(0);
      expect(
        errorChunks.some((c) => c.content.includes("Pre-Completion Verification: BLOCKED")),
      ).toBe(true);

      runtime.close();
    });

    it("does not recurse: the B4 verifier's inner query() skips verify", async () => {
      // This test exercises the insidePreCompletionVerify guard. We
      // inject a verifier whose llmQuery ACTUALLY calls runtime.query()
      // recursively — without the guard this would spiral. We assert
      // the inner call's verify was NOT invoked even though the outer
      // was, by tracking a counter.
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
        enablePreCompletionVerify: true,
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      let verifyCallCount = 0;
      const verifier = {
        verify: async (input: VerificationInput): Promise<VerificationReport> => {
          verifyCallCount += 1;
          // Simulate the real verifier making a nested query() call.
          // If the recursion guard is not working, this nested call
          // would itself invoke verify() → infinite loop.
          const inner = runtime.query({ prompt: `nested on: ${input.task.slice(0, 10)}` });
          for await (const _ of inner) {
            /* drain */
          }
          return passReport();
        },
      };
      (runtime as unknown as { preCompletionVerifier: unknown }).preCompletionVerifier = verifier;

      await drain(runtime.query({ prompt: "outer" }));

      // Outer call = 1 verify invocation. The nested call inside
      // verify() would trigger a second verify() only if the guard
      // failed. We expect exactly 1.
      expect(verifyCallCount).toBe(1);

      runtime.close();
    });
  });

  // ── B12 ProgressiveBudget ─────────────────────────────────

  describe("B12 ProgressiveBudget wire", () => {
    it("wraps the verifier when both flags are on (pass-0 success)", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
        enablePreCompletionVerify: true,
        enableProgressiveBudget: true,
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      const verifySpy = vi.fn(async (): Promise<VerificationReport> => passReport());
      (runtime as unknown as { preCompletionVerifier: unknown }).preCompletionVerifier = {
        verify: verifySpy,
      };

      // Swap in a real ProgressiveBudget and spy on wrap.
      const budget = new ProgressiveBudget();
      const wrapSpy = vi.spyOn(budget, "wrap");
      (runtime as unknown as { progressiveBudget: ProgressiveBudget }).progressiveBudget = budget;

      await drain(runtime.query({ prompt: "test" }));

      // wrap was called with the verifier and a sessionId.
      expect(wrapSpy).toHaveBeenCalledTimes(1);
      const wrapArgs = wrapSpy.mock.calls[0];
      expect(typeof wrapArgs?.[0]).toBe("function");
      expect(wrapArgs?.[1]?.sessionId).toBeTruthy();

      // Pass-0 passed → verify ran exactly once.
      expect(verifySpy).toHaveBeenCalledTimes(1);

      runtime.close();
    });

    it("retries on pass-0 concerns with elevated budget at pass-1", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
        enablePreCompletionVerify: true,
        enableProgressiveBudget: true,
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      let passIdx = 0;
      const verifySpy = vi.fn(async (): Promise<VerificationReport> => {
        passIdx += 1;
        // Fail pass 0, pass on pass 1.
        return passIdx === 1 ? failReport(["concern-A"]) : passReport();
      });
      (runtime as unknown as { preCompletionVerifier: unknown }).preCompletionVerifier = {
        verify: verifySpy,
      };

      const budget = new ProgressiveBudget();
      (runtime as unknown as { progressiveBudget: ProgressiveBudget }).progressiveBudget = budget;

      const chunks = (await drain(runtime.query({ prompt: "test" }))) as Array<{
        type: string;
        content: string;
      }>;

      expect(verifySpy).toHaveBeenCalledTimes(2);
      // Second pass passed → overall pass → no blocking error chunk.
      expect(chunks.some((c) => c.type === "error" && c.content.includes("BLOCKED"))).toBe(false);

      runtime.close();
    });

    it("does NOT use progressive-budget when B12 is off but B4 is on", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      vi.stubEnv("WOTANN_PROGRESSIVE_BUDGET", "");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
        enablePreCompletionVerify: true,
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      const verifySpy = vi.fn(async (): Promise<VerificationReport> => passReport());
      (runtime as unknown as { preCompletionVerifier: unknown }).preCompletionVerifier = {
        verify: verifySpy,
      };

      await drain(runtime.query({ prompt: "test" }));

      // B4 fired once. No budget involved.
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(runtime.getProgressiveBudget()).toBeNull();

      runtime.close();
    });
  });

  // ── M4 / M6 active-memory recall wires ──────────────────────

  describe("Active memory recall wire (M4 TEMPR / M6 retrieval-mode)", () => {
    it("routes to preprocessAsync when config.useTempr=true", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
        useTempr: true,
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      // Spy on the two methods to see which path the runtime takes.
      const activeMemory = (runtime as unknown as {
        activeMemory: {
          preprocess: (msg: string, sid?: string) => unknown;
          preprocessAsync: (msg: string, sid?: string, opts?: unknown) => Promise<unknown>;
        };
      }).activeMemory;
      const syncSpy = vi.spyOn(activeMemory, "preprocess");
      const asyncSpy = vi.spyOn(activeMemory, "preprocessAsync");

      await drain(runtime.query({ prompt: "what about providers?" }));

      // Config useTempr=true → async path.
      expect(asyncSpy).toHaveBeenCalled();
      expect(syncSpy).not.toHaveBeenCalled();

      // Verify opts were threaded through.
      const asyncCall = asyncSpy.mock.calls[0];
      const opts = asyncCall?.[2] as { useTempr?: boolean; recallMode?: string } | undefined;
      expect(opts?.useTempr).toBe(true);
      expect(opts?.recallMode).toBeUndefined(); // TEMPR masks mode

      runtime.close();
    });

    it("routes to preprocessAsync when config.recallMode is set", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
        recallMode: "time-decay",
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      const activeMemory = (runtime as unknown as {
        activeMemory: {
          preprocess: (msg: string, sid?: string) => unknown;
          preprocessAsync: (msg: string, sid?: string, opts?: unknown) => Promise<unknown>;
        };
      }).activeMemory;
      const syncSpy = vi.spyOn(activeMemory, "preprocess");
      const asyncSpy = vi.spyOn(activeMemory, "preprocessAsync");

      await drain(runtime.query({ prompt: "which provider handles streaming?" }));

      expect(asyncSpy).toHaveBeenCalled();
      expect(syncSpy).not.toHaveBeenCalled();

      const asyncCall = asyncSpy.mock.calls[0];
      const opts = asyncCall?.[2] as { useTempr?: boolean; recallMode?: string } | undefined;
      expect(opts?.useTempr).toBe(false);
      expect(opts?.recallMode).toBe("time-decay");

      runtime.close();
    });

    it("uses sync preprocess when no recall flags are set (default)", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      vi.stubEnv("WOTANN_USE_TEMPR", "");
      vi.stubEnv("WOTANN_RECALL_MODE", "");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      const activeMemory = (runtime as unknown as {
        activeMemory: {
          preprocess: (msg: string, sid?: string) => unknown;
          preprocessAsync: (msg: string, sid?: string, opts?: unknown) => Promise<unknown>;
        };
      }).activeMemory;
      const syncSpy = vi.spyOn(activeMemory, "preprocess");
      const asyncSpy = vi.spyOn(activeMemory, "preprocessAsync");

      await drain(runtime.query({ prompt: "which provider?" }));

      // Default path = sync.
      expect(syncSpy).toHaveBeenCalled();
      expect(asyncSpy).not.toHaveBeenCalled();

      runtime.close();
    });

    it("env var WOTANN_USE_TEMPR=1 enables TEMPR when config is unset", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      vi.stubEnv("WOTANN_USE_TEMPR", "1");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: false,
        hookProfile: "standard",
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      const activeMemory = (runtime as unknown as {
        activeMemory: {
          preprocess: (msg: string, sid?: string) => unknown;
          preprocessAsync: (msg: string, sid?: string, opts?: unknown) => Promise<unknown>;
        };
      }).activeMemory;
      const asyncSpy = vi.spyOn(activeMemory, "preprocessAsync");

      await drain(runtime.query({ prompt: "what about streaming providers?" }));

      expect(asyncSpy).toHaveBeenCalled();
      const opts = asyncSpy.mock.calls[0]?.[2] as { useTempr?: boolean } | undefined;
      expect(opts?.useTempr).toBe(true);

      runtime.close();
    });
  });

  // ── M1 Reflector ────────────────────────────────────────────

  describe("M1 Reflector wire", () => {
    it("Reflector is NOT invoked when no judge is wired (default)", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: true,
        hookProfile: "standard",
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      expect(runtime.getReflector()).toBeNull();

      await drain(runtime.query({ prompt: "test" }));
      // No throw, no reflect call. Reflector is still null.
      expect(runtime.getReflector()).toBeNull();

      runtime.close();
    });

    it("Reflector.reflect() is invoked when a judge is wired and threshold met", async () => {
      const dir = makeTempDir();
      vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
      vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
      const runtime = new WotannRuntime({
        workingDir: dir,
        enableMemory: true,
        hookProfile: "standard",
      });
      await runtime.initialize();
      stubBridge(runtime, "answer.");

      // Wire a judge that always returns "promote".
      runtime.enableReflector(
        async () => ({ promote: true, reason: "test", confidence: 0.9 }),
        1, // reflect every 1 turn — fires on turn 1
      );
      const reflector = runtime.getReflector();
      expect(reflector).not.toBeNull();

      // Spy on reflect().
      const reflectSpy = vi.spyOn(reflector!, "reflect");
      const shouldReflectSpy = vi.spyOn(reflector!, "shouldReflect").mockReturnValue(true);

      await drain(runtime.query({ prompt: "test" }));

      expect(shouldReflectSpy).toHaveBeenCalled();
      expect(reflectSpy).toHaveBeenCalledTimes(1);

      runtime.close();
    });
  });
});
