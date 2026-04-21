import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MiddlewarePipeline, createDefaultPipeline } from "../../src/middleware/pipeline.js";
import { analyzeIntentFast } from "../../src/middleware/intent-gate.js";
import { TTSREngine } from "../../src/middleware/ttsr.js";
import { detectFrustration, classifyRisk, forcedVerificationMiddleware } from "../../src/middleware/layers.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";

describe("Middleware Pipeline", () => {
  describe("pipeline structure", () => {
    it("has the expected layers in correct order", () => {
      // S5-4 removed two structurally dead middleware layers:
      // SubagentLimit and LSP. Phase C added FileTypeGate at 3.5.
      // Lane 2 added 6 more middleware (DanglingToolCall, SandboxAudit,
      // GuardrailProvider, LLMErrorHandling, DeferredToolFilter, Title).
      // P1-B6 added LoopDetection at 24.5 (Crush port, per-session).
      // Total: 33 layers.
      const pipeline = createDefaultPipeline();
      const names = pipeline.getLayerNames();

      expect(names).toHaveLength(33);
      expect(names[0]).toBe("ToolPairValidator");
      expect(names[1]).toBe("IntentGate");
      expect(names[2]).toBe("ThreadData");
      expect(names[3]).toBe("Uploads");
      expect(names[4]).toBe("FileTypeGate");
      // Assert key anchors rather than every index so future layer
      // insertions don't require rewriting every expectation.
      expect(names).toContain("Sandbox");
      expect(names).toContain("Guardrail");
      expect(names).toContain("ToolError");
      expect(names).toContain("OutputTruncation");
      expect(names).toContain("Frustration");
      expect(names).toContain("PreCompletionChecklist");
      expect(names).toContain("SystemNotifications");
      expect(names).toContain("NonInteractive");
      expect(names).toContain("PlanEnforcement");
      expect(names).toContain("VerificationEnforcement");
      expect(names).toContain("AutoInstall");
      expect(names).toContain("StaleDetection");
      expect(names).toContain("DoomLoop");
      expect(names).toContain("LoopDetection");
      // SelfReflection must remain the final (post-response) layer.
      expect(names[names.length - 1]).toBe("SelfReflection");
    });

    it("runs before hooks in forward order", async () => {
      const pipeline = createDefaultPipeline();
      const ctx = makeCtx("Fix the authentication bug");
      const processed = await pipeline.processBefore(ctx);

      expect(processed.resolvedIntent).toBeDefined();
      expect(processed.resolvedIntent?.type).toBe("fix");
      expect(processed.resolvedIntent?.category).toBe("debug");
    });

    it("runs after hooks in reverse order", async () => {
      const pipeline = createDefaultPipeline();
      const ctx = makeCtx("test");
      const result = await pipeline.processAfter(ctx, {
        content: "done",
        success: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("IntentGate", () => {
    it("classifies implementation tasks", () => {
      const intent = analyzeIntentFast("Create a new authentication module");
      expect(intent.category).toBe("code");
      expect(intent.type).toBe("implement");
    });

    it("classifies debugging tasks", () => {
      const intent = analyzeIntentFast("Fix the broken login flow");
      expect(intent.category).toBe("debug");
      expect(intent.type).toBe("fix");
      expect(intent.suggestedMode).toBe("debug");
    });

    it("classifies planning tasks", () => {
      const intent = analyzeIntentFast("Design the microservices architecture");
      expect(intent.category).toBe("plan");
      expect(intent.suggestedMode).toBe("careful");
    });

    it("classifies review tasks", () => {
      const intent = analyzeIntentFast("Review this pull request");
      expect(intent.category).toBe("review");
      expect(intent.suggestedMode).toBe("review");
    });

    it("classifies utility tasks", () => {
      const intent = analyzeIntentFast("Rename the file to utils.ts");
      expect(intent.category).toBe("utility");
      expect(intent.suggestedMode).toBe("rapid");
    });

    it("falls back to general for ambiguous prompts", () => {
      const intent = analyzeIntentFast("hello");
      expect(intent.category).toBe("code");
      expect(intent.type).toBe("general");
      expect(intent.confidence).toBeLessThan(0.5);
    });
  });

  describe("TTSR Engine", () => {
    it("detects TODO in streamed output", () => {
      const engine = new TTSREngine();
      const result = engine.processChunk("// TODO: implement this later");

      expect(result.injections).toHaveLength(1);
      expect(result.injections[0]).toContain("TODO/FIXME");
    });

    it("detects hardcoded passwords", () => {
      const engine = new TTSREngine();
      const result = engine.processChunk('const password = "secret123"');

      expect(result.injections).toHaveLength(1);
      expect(result.injections[0]).toContain("CRITICAL");
    });

    it("respects maxFiresPerSession", () => {
      const engine = new TTSREngine();

      // console.log rule has maxFires=1
      engine.processChunk("console.log('a')");
      const second = engine.processChunk("console.log('b')");

      expect(second.injections).toHaveLength(0);
    });

    it("resets fire counts between sessions", () => {
      const engine = new TTSREngine();

      engine.processChunk("console.log('a')");
      engine.reset();
      const result = engine.processChunk("console.log('b')");

      expect(result.injections).toHaveLength(1);
    });

    it("returns unmodified chunk text", () => {
      const engine = new TTSREngine();
      const chunk = "const x = 42;";
      const result = engine.processChunk(chunk);

      expect(result.modified).toBe(chunk);
      expect(result.injections).toHaveLength(0);
    });

    it("supports custom rules", () => {
      const engine = new TTSREngine([{
        trigger: /CUSTOM_PATTERN/,
        injection: "Custom injection",
        maxFiresPerSession: 1,
        firedCount: 0,
      }]);

      const result = engine.processChunk("Found CUSTOM_PATTERN here");
      expect(result.injections).toHaveLength(1);
      expect(result.injections[0]).toBe("Custom injection");
    });
  });

  describe("Frustration Detection", () => {
    it("detects explicit frustration", () => {
      const result = detectFrustration("wtf this is still broken");
      expect(result.detected).toBe(true);
      expect(result.patterns.length).toBeGreaterThan(0);
    });

    it("detects repeated correction patterns", () => {
      const result = detectFrustration("I already told you not to do that");
      expect(result.detected).toBe(true);
    });

    it("detects excessive punctuation", () => {
      const result = detectFrustration("Why doesn't this work!!!");
      expect(result.detected).toBe(true);
    });

    it("does not trigger on normal messages", () => {
      const result = detectFrustration("Can you help me refactor this module?");
      expect(result.detected).toBe(false);
    });
  });

  describe("Risk Classification", () => {
    it("classifies reads as low risk", () => {
      expect(classifyRisk("Read")).toBe("low");
      expect(classifyRisk("Glob")).toBe("low");
      expect(classifyRisk("Grep")).toBe("low");
    });

    it("classifies writes as medium risk", () => {
      expect(classifyRisk("Write")).toBe("medium");
      expect(classifyRisk("Edit")).toBe("medium");
    });

    it("classifies bash as high risk", () => {
      expect(classifyRisk("Bash")).toBe("high");
      expect(classifyRisk("ComputerUse")).toBe("high");
    });
  });

  describe("Forced Verification", () => {
    it("runs sandboxed typecheck after TypeScript writes", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wotann-middleware-verify-"));

      try {
        writeFileSync(join(tempDir, "package.json"), JSON.stringify({
          name: "verify-demo",
          scripts: {
            typecheck: "node -e \"process.exit(0)\"",
          },
        }, null, 2));

        const result = await forcedVerificationMiddleware.after!(makeCtx("verify", tempDir), {
          toolName: "Write",
          filePath: join(tempDir, "src", "index.ts"),
          content: "updated",
          success: true,
        });

        expect(result.followUp).toBeUndefined();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("injects a follow-up when sandboxed typecheck fails", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wotann-middleware-fail-"));

      try {
        writeFileSync(join(tempDir, "package.json"), JSON.stringify({
          name: "verify-demo",
          scripts: {
            typecheck: "node -e \"process.stderr.write('broken'); process.exit(1)\"",
          },
        }, null, 2));

        const result = await forcedVerificationMiddleware.after!(makeCtx("verify", tempDir), {
          toolName: "Edit",
          filePath: join(tempDir, "src", "index.ts"),
          content: "updated",
          success: true,
        });

        expect(result.followUp).toContain("Verification failed (typecheck)");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

function makeCtx(message: string, workingDir: string = "/tmp/test"): MiddlewareContext {
  return {
    sessionId: "test-session",
    userMessage: message,
    recentHistory: [],
    workingDir,
  };
}
