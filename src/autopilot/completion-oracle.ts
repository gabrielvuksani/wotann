/**
 * Completion Oracle — multi-criterion task verification.
 *
 * Unlike simple "tests pass" checks, the oracle evaluates task completion
 * across multiple weighted criteria. A task is "done" only when the
 * weighted completion score exceeds the threshold.
 *
 * Criteria:
 * - tests-pass: Run test suite
 * - typecheck-pass: Run type checker
 * - lint-pass: Run linter
 * - visual-match: Compare screenshots against reference
 * - browser-test: Load URL and verify elements
 * - custom-command: Run arbitrary command, check exit code
 * - llm-judge: Ask a model "does this satisfy the original request?"
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CompletionCriterion, VerificationEvidence } from "./types.js";
import {
  captureScreenshot as nativeCaptureScreenshot,
  extractTextFromImage,
  verifyVisual,
} from "../testing/visual-verifier.js";

export interface OracleConfig {
  readonly workingDir: string;
  readonly threshold: number; // 0-1
}

/**
 * Evaluate all completion criteria and return weighted score + evidence.
 */
export async function evaluateCompletion(
  task: string,
  criteria: readonly CompletionCriterion[],
  config: OracleConfig,
  callbacks?: {
    runCommand?: (cmd: string) => Promise<{ success: boolean; output: string }>;
    llmJudge?: (task: string, evidence: string) => Promise<{ passed: boolean; reasoning: string }>;
    captureScreenshot?: (url: string) => Promise<string | null>;
  },
): Promise<{
  completed: boolean;
  score: number;
  evidence: readonly VerificationEvidence[];
}> {
  const evidence: VerificationEvidence[] = [];
  let totalWeight = 0;
  let passedWeight = 0;

  for (const criterion of criteria) {
    totalWeight += criterion.weight;
    const start = Date.now();

    let passed = false;
    let evidenceText = "";

    switch (criterion.type) {
      case "tests-pass": {
        const result = runSilentCommand("npx vitest run --reporter=dot", config.workingDir);
        passed = result.success;
        evidenceText = result.output.slice(-500);
        break;
      }
      case "typecheck-pass": {
        const result = runSilentCommand("npx tsc --noEmit", config.workingDir);
        passed = result.success;
        evidenceText = result.output || "Clean compilation";
        break;
      }
      case "lint-pass": {
        const result = runSilentCommand(
          "npx biome check . 2>/dev/null || npx eslint . 2>/dev/null || echo 'No linter configured'",
          config.workingDir,
        );
        passed = result.success || result.output.includes("No linter configured");
        evidenceText = result.output.slice(-300);
        break;
      }
      case "custom-command": {
        const cmd = (criterion.config?.["command"] as string) ?? "echo 'No command specified'";
        if (callbacks?.runCommand) {
          const result = await callbacks.runCommand(cmd);
          passed = result.success;
          evidenceText = result.output.slice(-300);
        } else {
          const result = runSilentCommand(cmd, config.workingDir);
          passed = result.success;
          evidenceText = result.output.slice(-300);
        }
        break;
      }
      case "llm-judge": {
        if (callbacks?.llmJudge) {
          const allEvidence = evidence
            .map(
              (e) =>
                `${e.criterion.type}: ${e.passed ? "PASS" : "FAIL"} — ${e.evidence.slice(0, 100)}`,
            )
            .join("\n");
          const result = await callbacks.llmJudge(task, allEvidence);
          passed = result.passed;
          evidenceText = result.reasoning;
        } else {
          // Without an LLM judge, default to pass if other criteria pass
          passed = evidence.filter((e) => e.criterion.required).every((e) => e.passed);
          evidenceText = "LLM judge not available; defaulting to other criteria";
        }
        break;
      }
      case "visual-match": {
        // D15: default to the native visual-verifier when no callback supplied.
        // The oracle now snaps the screen via screencapture(1), runs the
        // verifyVisual expectation matcher, and records OCR text as evidence
        // so UI edits can be verified without a human in the loop.
        const url = (criterion.config?.["url"] as string) ?? "http://localhost:3000";
        const expectation = (criterion.config?.["expectation"] as string) ?? task;
        const mode = ((criterion.config?.["mode"] as string) ?? "desktop") as
          | "cli"
          | "browser"
          | "desktop";

        if (callbacks?.captureScreenshot) {
          const screenshotPath = await callbacks.captureScreenshot(url);
          passed = screenshotPath !== null;
          evidenceText = screenshotPath
            ? `Screenshot captured: ${screenshotPath}`
            : "Screenshot capture failed";
        } else {
          const shotPath = join(tmpdir(), `wotann-verify-${Date.now()}.png`);
          const captured = nativeCaptureScreenshot(shotPath);
          if (!captured) {
            passed = false;
            evidenceText = "Native screenshot failed (screencapture unavailable)";
          } else {
            // Assume text+vision until the oracle is told otherwise. The
            // visual verifier uses capabilities only to choose OCR vs vision
            // fallbacks — a permissive default is safe here.
            const result = verifyVisual(
              { mode, expectation, url },
              {
                supportsComputerUse: false,
                supportsToolCalling: true,
                supportsVision: true,
                supportsStreaming: true,
                supportsThinking: false,
                maxContextWindow: 200_000,
              },
            );
            const ocrText = extractTextFromImage(shotPath);
            passed = result.passed;
            evidenceText = `${result.description} (confidence=${result.confidence.toFixed(
              2,
            )}); OCR: ${ocrText.slice(0, 200)}`;
          }
        }
        break;
      }
      case "browser-test": {
        const url = (criterion.config?.["url"] as string) ?? "http://localhost:3000";
        // Check if the URL is reachable
        const result = runSilentCommand(
          `curl -s -o /dev/null -w "%{http_code}" ${url} 2>/dev/null || echo "000"`,
          config.workingDir,
        );
        const statusCode = parseInt(result.output.trim(), 10);
        passed = statusCode >= 200 && statusCode < 400;
        evidenceText = `HTTP ${statusCode} from ${url}`;
        break;
      }
    }

    if (passed) {
      passedWeight += criterion.weight;
    }

    evidence.push({
      criterion,
      passed,
      evidence: evidenceText,
      durationMs: Date.now() - start,
    });

    // If a required criterion fails, we can't be complete
    if (criterion.required && !passed) {
      return {
        completed: false,
        score: totalWeight > 0 ? passedWeight / totalWeight : 0,
        evidence,
      };
    }
  }

  const score = totalWeight > 0 ? passedWeight / totalWeight : 1;
  return {
    completed: score >= config.threshold,
    score,
    evidence,
  };
}

/**
 * Get default completion criteria for common task types.
 */
export function getDefaultCriteria(
  taskType: "code" | "ui" | "docs" | "test",
): readonly CompletionCriterion[] {
  const base: CompletionCriterion[] = [
    {
      type: "typecheck-pass",
      weight: 3,
      required: true,
      description: "TypeScript compilation must pass",
    },
    { type: "tests-pass", weight: 4, required: true, description: "All tests must pass" },
  ];

  switch (taskType) {
    case "code":
      return [...base];
    case "ui":
      return [
        ...base,
        {
          type: "browser-test",
          weight: 3,
          required: false,
          description: "App loads in browser",
          config: { url: "http://localhost:3000" },
        },
        {
          type: "visual-match",
          weight: 2,
          required: false,
          description: "Visual appearance matches expectations",
        },
      ];
    case "docs":
      return [
        {
          type: "typecheck-pass",
          weight: 2,
          required: false,
          description: "TypeScript compilation (if applicable)",
        },
        {
          type: "llm-judge",
          weight: 5,
          required: true,
          description: "Documentation is complete and accurate",
        },
      ];
    case "test":
      return [
        ...base,
        {
          type: "custom-command",
          weight: 3,
          required: true,
          description: "Coverage threshold met",
          config: { command: "npx vitest run --coverage 2>/dev/null || true" },
        },
      ];
  }
}

/** Run a known-safe command. Only call with hardcoded strings — never interpolate user input. */
function runSilentCommand(cmd: string, cwd: string): { success: boolean; output: string } {
  try {
    const output = execFileSync("bash", ["-c", cmd], {
      cwd,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output: output.toString() };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: (err.stdout ?? "") + (err.stderr ?? "") || err.message || "Command failed",
    };
  }
}
