/**
 * Verification Layers — smoke tests for the 4-layer verification flow.
 *
 * This file is the regression-lock for the consolidation documented in
 * `docs/internal/VERIFICATION_LAYERS.md`. Each test instantiates one layer
 * with mocked dependencies and asserts the shape of its output.
 *
 * Layers covered (in invocation order):
 *   L1. Shell checks       — PreCompletionChecklistMiddleware
 *   L2. LLM pre-completion — PreCompletionVerifier (B4, 4-persona parallel)
 *   L3. Task cascade       — VerificationCascade (structured stages)
 *   L4. CoVe               — chainOfVerification (reason-about-reasoning)
 *
 * These are SMOKE tests only — each layer has its own full test suite.
 * The cross-layer composition test asserts the layers can run in sequence
 * on the same fixture without interference.
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PreCompletionChecklistMiddleware } from "../../src/middleware/pre-completion-checklist.js";
import { VerificationCascade } from "../../src/intelligence/verification-cascade.js";
import { chainOfVerification } from "../../src/intelligence/chain-of-verification.js";
import { PreCompletionVerifier } from "../../src/intelligence/pre-completion-verifier.js";
import type { LlmQuery } from "../../src/intelligence/chain-of-verification.js";

// ── Fixtures ─────────────────────────────────────────────

function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `wotann-verif-layers-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePackageJson(dir: string, scripts: Record<string, string> = {}): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts }, null, 2),
    "utf8",
  );
}

// ── L1: Shell checks ─────────────────────────────────────

describe("verification layer 1 (shell checks)", () => {
  it("instantiates and reports a green state as passed", () => {
    const l1 = new PreCompletionChecklistMiddleware();
    // No files modified = green baseline. Overall `passed` is computed from
    // ERROR-severity items only (warning items can fail without blocking).
    const result = l1.runChecklist();
    expect(result.passed).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    const errorItems = result.items.filter((i) => i.severity === "error");
    for (const item of errorItems) {
      expect(item.passed).toBe(true);
    }
  });

  it("blocks completion when a code file was modified but typecheck/tests never ran", () => {
    const l1 = new PreCompletionChecklistMiddleware();
    l1.recordFileModification("/fake/src/foo.ts", "export const x = 1;");
    const result = l1.runChecklist();
    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBeDefined();
  });
});

// ── L2: LLM pre-completion (B4 — 4 personas) ─────────────

describe("verification layer 2 (LLM pre-completion review)", () => {
  it("returns a structured report with per-perspective verdicts when all personas pass", async () => {
    // Persona protocol requires a JSON object with `verdict` and `concerns`.
    const mockLlm: LlmQuery = async () =>
      JSON.stringify({ verdict: "pass", concerns: [] });

    const l2 = new PreCompletionVerifier({ llmQuery: mockLlm });
    const report = await l2.verify({
      task: "add a log line",
      result: "added console.log",
    });

    expect(report).toBeDefined();
    expect(report.status).toMatch(/^(pass|fail|error)$/);
    expect(Array.isArray(report.perspectives)).toBe(true);
    // ForgeCode 4-persona fixed order — report always has all 4.
    expect(report.perspectives.length).toBe(4);
    // Named accessors line up with the fixed perspective order.
    expect(report.implementer.perspective).toBe("implementer");
    expect(report.reviewer.perspective).toBe("reviewer");
    expect(report.tester.perspective).toBe("tester");
    expect(report.user.perspective).toBe("user");
  });

  it("honours the bypass flag without calling the LLM", async () => {
    let called = 0;
    const countingLlm: LlmQuery = async () => {
      called++;
      return "{}";
    };

    const l2 = new PreCompletionVerifier({
      llmQuery: countingLlm,
      skipPreCompletionVerify: true,
    });
    const report = await l2.verify({ task: "x", result: "y" });

    expect(called).toBe(0);
    expect(l2.isBypassed()).toBe(true);
    // Bypass reports still have all 4 perspectives — each one is an empty pass.
    expect(report.bypassed).toBe(true);
    expect(report.perspectives.length).toBe(4);
    expect(report.status).toBe("pass");
  });
});

// ── L3: Task verification cascade (structured stages) ────

describe("verification layer 3 (task verification cascade)", () => {
  it("auto-detects available steps from package.json scripts", () => {
    const dir = makeTempDir("l3-detect");
    try {
      writePackageJson(dir, { typecheck: "tsc --noEmit", test: "vitest run" });
      // tsconfig.json triggers typecheck step
      writeFileSync(join(dir, "tsconfig.json"), "{}", "utf8");

      const l3 = new VerificationCascade(dir);
      const steps = l3.getSteps();
      const names = steps.map((s) => s.name);
      expect(names).toContain("typecheck");
      expect(names).toContain("unit-tests");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a CascadeResult shape when no steps are detected (empty project)", async () => {
    const dir = makeTempDir("l3-empty");
    try {
      // No tsconfig, no package.json — zero steps detected
      const l3 = new VerificationCascade(dir);
      expect(l3.getSteps().length).toBe(0);
      const result = await l3.run();
      expect(result.allPassed).toBe(true);
      expect(result.failedStep).toBeNull();
      expect(result.stepsRun).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── L4: Chain-of-verification (reason-about-reasoning) ───

describe("verification layer 4 (chain-of-verification / CoVe)", () => {
  it("produces structured output with baseline, questions, rounds, and final answer", async () => {
    let call = 0;
    const mockLlm: LlmQuery = async (prompt: string) => {
      call++;
      // 1: baseline; 2: question list; 3+: answers; last: revision
      if (call === 1) return "The capital of France is Paris.";
      if (prompt.includes("verification questions")) {
        return "Is Paris the capital of France?\nWhat country is Paris in?";
      }
      if (prompt.includes("Corrected answer")) return "The capital of France is Paris.";
      return "Yes.";
    };

    const result = await chainOfVerification("What is the capital of France?", {
      llmQuery: mockLlm,
    });

    expect(result.baselineAnswer).toBeTruthy();
    expect(result.verificationQuestions.length).toBeGreaterThan(0);
    expect(result.verificationRounds.length).toBeGreaterThan(0);
    expect(result.finalAnswer).toBeTruthy();
    for (const round of result.verificationRounds) {
      expect(round.question).toBeTruthy();
      expect(round.answer).toBeTruthy();
    }
  });
});

// ── Cross-layer composition ──────────────────────────────

describe("verification layers compose without interference", () => {
  it("L1 shell-checks and L3 cascade can share the same fixture directory", async () => {
    const dir = makeTempDir("cross");
    try {
      writePackageJson(dir, {});

      // L1 — independent stateful gate
      const l1 = new PreCompletionChecklistMiddleware();
      const l1Result = l1.runChecklist();
      expect(l1Result.passed).toBe(true);

      // L3 — detection-only on the same fixture dir
      const l3 = new VerificationCascade(dir);
      expect(l3.getSteps()).toBeDefined();

      // Reset L1 should not affect L3's detected steps
      l1.reset();
      const l1Again = l1.runChecklist();
      expect(l1Again.passed).toBe(true);
      expect(l3.getSteps()).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
