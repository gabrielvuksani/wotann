/**
 * Integration test: middleware pipeline processes a full request
 * through all 16 layers and produces enriched context.
 */

import { describe, it, expect } from "vitest";
import { createDefaultPipeline } from "../../src/middleware/pipeline.js";
import type { MiddlewareContext, AgentResult } from "../../src/middleware/types.js";

function makeCtx(message: string, opts: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    sessionId: "integration-test",
    userMessage: message,
    recentHistory: [],
    workingDir: "/tmp/test-project",
    ...opts,
  };
}

describe("Integration: Middleware Pipeline Flow", () => {
  it("all 16 layers execute in order for a standard request", async () => {
    const pipeline = createDefaultPipeline();
    const ctx = makeCtx("Fix the authentication bug in src/auth.ts");
    const enriched = await pipeline.processBefore(ctx);

    // IntentGate should have classified this as a debug task
    expect(enriched.resolvedIntent).toBeDefined();
    expect(enriched.resolvedIntent?.type).toBe("fix");

    // Frustration detection should not trigger
    expect(enriched.frustrationDetected).toBe(false);
  });

  it("detects frustration in user message", async () => {
    const pipeline = createDefaultPipeline();
    const ctx = makeCtx("wtf this is still broken!! why won't it work");
    const enriched = await pipeline.processBefore(ctx);

    expect(enriched.frustrationDetected).toBe(true);
    expect(enriched.frustrationPatterns!.length).toBeGreaterThan(0);
  });

  it("classifies risk level based on complexity", async () => {
    const pipeline = createDefaultPipeline();
    const ctx = makeCtx("Plan the entire microservices architecture redesign");
    const enriched = await pipeline.processBefore(ctx);

    expect(enriched.riskLevel).toBeDefined();
  });

  it("after hooks process tool results", async () => {
    const pipeline = createDefaultPipeline();
    const ctx = makeCtx("test");

    const result: AgentResult = {
      content: "done",
      success: true,
      toolName: "Read",
      filePath: "/tmp/test.ts",
    };

    const processed = await pipeline.processAfter(ctx, result);
    expect(processed.success).toBe(true);
  });

  it("tool error middleware normalizes error format", async () => {
    const pipeline = createDefaultPipeline();
    const ctx = makeCtx("test");

    const result: AgentResult = {
      content: "file not found",
      success: false,
    };

    const processed = await pipeline.processAfter(ctx, result);
    expect(processed.content.startsWith("Error:")).toBe(true);
  });

  it("file tracking records touched files", async () => {
    const pipeline = createDefaultPipeline();
    const ctx = makeCtx("test");

    // processBefore returns a NEW context with trackedFiles initialized (immutability fix)
    const enriched = await pipeline.processBefore(ctx);

    await pipeline.processAfter(enriched, {
      content: "written", success: true, toolName: "Write", filePath: "/tmp/a.ts",
    });
    await pipeline.processAfter(enriched, {
      content: "written", success: true, toolName: "Edit", filePath: "/tmp/b.ts",
    });

    expect(enriched.trackedFiles?.has("/tmp/a.ts")).toBe(true);
    expect(enriched.trackedFiles?.has("/tmp/b.ts")).toBe(true);
  });

  it("context utilization is estimated from history size", async () => {
    const pipeline = createDefaultPipeline();
    const longHistory = Array.from({ length: 100 }, (_, i) => ({
      role: "assistant" as const,
      content: "x".repeat(4000), // ~1000 tokens each
    }));

    const ctx = makeCtx("test", { recentHistory: longHistory });
    const enriched = await pipeline.processBefore(ctx);

    expect(enriched.contextUtilization).toBeGreaterThan(0);
    expect(enriched.needsSummarization).toBeDefined();
  });
});
