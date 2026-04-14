import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeAutonomousProofBundle } from "../../src/orchestration/proof-bundles.js";

describe("Autonomous proof bundles", () => {
  it("writes a machine-readable proof bundle for autonomous runs", () => {
    const workingDir = mkdtempSync(join(tmpdir(), "wotann-proof-"));

    try {
      const path = writeAutonomousProofBundle({
        workingDir,
        task: "Fix failing tests",
        result: {
          success: true,
          totalCycles: 1,
          totalDurationMs: 1200,
          totalCostUsd: 0.02,
          totalTokens: 900,
          exitReason: "tests-pass",
          strategy: "direct",
          filesChanged: ["src/index.ts"],
          cycles: [{
            cycle: 0,
            action: "Fix failing tests",
            output: "Patched the failing assertion",
            verificationOutput: "All tests passed",
            testsPass: true,
            typecheckPass: true,
            lintPass: true,
            durationMs: 1200,
            strategy: "direct",
            heartbeatOk: true,
            contextUsage: 0.42,
            tokensUsed: 900,
            costUsd: 0.02,
          }],
        },
        runtimeStatus: {
          providers: ["anthropic"],
          activeProvider: "anthropic",
          hookCount: 19,
          middlewareLayers: 18,
          memoryEnabled: true,
          sessionId: "session-123",
          totalTokens: 900,
          totalCost: 0.02,
          currentMode: "autonomous",
          traceEntries: 3,
          semanticIndexSize: 2,
          skillCount: 15,
        },
        contextBudget: {
          totalTokens: 200_000,
          systemPromptTokens: 4_000,
          memoryTokens: 2_000,
          toolSchemaTokens: 1_000,
          conversationTokens: 8_000,
          reservedOutputTokens: 8_000,
          availableTokens: 177_000,
          usagePercent: 0.115,
          pressureLevel: "green",
        },
        contextCapability: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          totalTokens: 200_000,
          documentedMaxTokens: 1_000_000,
          reservedOutputTokens: 8_000,
          cachingSupported: true,
          activationMode: "beta-header",
          notes: "Extended context requires explicit enablement.",
          extendedContextEnabled: false,
        },
        providerOverride: "anthropic",
        modelOverride: "claude-sonnet-4-6",
      });

      expect(existsSync(path)).toBe(true);

      const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
        summary: { exitReason: string };
        runtime?: { sessionId: string };
        cycles: Array<{ verificationOutput: string }>;
      };

      expect(parsed.summary.exitReason).toBe("tests-pass");
      expect(parsed.runtime?.sessionId).toBe("session-123");
      expect(parsed.cycles[0]?.verificationOutput).toContain("All tests passed");
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
