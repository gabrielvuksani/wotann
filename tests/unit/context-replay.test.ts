import { describe, it, expect } from "vitest";
import { replayContext } from "../../src/context/context-replay.js";
import type { TaskContext, ReplayBudget } from "../../src/context/context-replay.js";

describe("Context Replay", () => {
  const defaultBudget: ReplayBudget = {
    maxTokens: 200_000,
    reserveForResponse: 8_000,
    reserveForSystemPrompt: 5_000,
  };

  it("includes active plan at highest priority", () => {
    const task: TaskContext = {
      description: "Fix auth bug",
      files: [],
      recentConversation: [],
      toolResults: [],
      memoryEntries: [],
      activePlan: "Step 1: Check auth middleware. Step 2: Fix token validation.",
      decisions: [],
    };

    const result = replayContext(task, defaultBudget);
    expect(result.assembledContext).toContain("Active Plan");
    expect(result.assembledContext).toContain("Check auth middleware");
  });

  it("includes recent conversation", () => {
    const task: TaskContext = {
      description: "Build API endpoint",
      files: [],
      recentConversation: [
        { role: "user", content: "Add a GET /users endpoint" },
        { role: "assistant", content: "I'll create the users route..." },
      ],
      toolResults: [],
      memoryEntries: [],
      decisions: [],
    };

    const result = replayContext(task, defaultBudget);
    expect(result.assembledContext).toContain("Recent Conversation");
    expect(result.assembledContext).toContain("GET /users");
  });

  it("scores files higher when mentioned in task description", () => {
    const task: TaskContext = {
      description: "Fix the auth-middleware.ts file",
      files: ["src/auth-middleware.ts", "src/unrelated.ts"],
      recentConversation: [],
      toolResults: [],
      memoryEntries: [],
      decisions: [],
    };

    const result = replayContext(task, defaultBudget);
    const authSource = result.sources.find((s) => s.source === "src/auth-middleware.ts");
    const unrelatedSource = result.sources.find((s) => s.source === "src/unrelated.ts");

    expect(authSource).toBeTruthy();
    expect(authSource!.relevanceScore).toBeGreaterThan(unrelatedSource?.relevanceScore ?? 0);
  });

  it("includes decisions in context", () => {
    const task: TaskContext = {
      description: "Implement user auth",
      files: [],
      recentConversation: [],
      toolResults: [],
      memoryEntries: [],
      decisions: [
        { decision: "Use JWT for auth", reasoning: "Stateless, scales better than sessions" },
      ],
    };

    const result = replayContext(task, defaultBudget);
    expect(result.assembledContext).toContain("JWT for auth");
    expect(result.assembledContext).toContain("Stateless");
  });

  it("respects token budget and drops low-priority sources", () => {
    const task: TaskContext = {
      description: "Small fix",
      files: [],
      recentConversation: Array.from({ length: 50 }, (_, i) => ({
        role: "user" as const,
        content: `Message ${i} with lots of content that takes up tokens: ${"x".repeat(500)}`,
      })),
      toolResults: [],
      memoryEntries: [],
      decisions: [],
    };

    const tightBudget: ReplayBudget = {
      maxTokens: 1_000,
      reserveForResponse: 200,
      reserveForSystemPrompt: 200,
    };

    const result = replayContext(task, tightBudget);
    expect(result.droppedSources).toBeGreaterThan(0);
    expect(result.totalTokens).toBeLessThanOrEqual(600);
  });

  it("scores tool results by file relevance", () => {
    const task: TaskContext = {
      description: "Fix type errors",
      files: ["src/utils.ts"],
      recentConversation: [],
      toolResults: [
        { tool: "Read", output: "File contents of utils.ts...", success: true, file: "src/utils.ts" },
        { tool: "Read", output: "File contents of unrelated...", success: true, file: "src/unrelated.ts" },
        { tool: "Bash", output: "Error output", success: false },
      ],
      memoryEntries: [],
      decisions: [],
    };

    const result = replayContext(task, defaultBudget);
    const utilsResult = result.sources.find((s) => s.source === "Read" && s.content.includes("utils.ts"));
    expect(utilsResult).toBeTruthy();
  });

  it("scores memory entries by keyword match", () => {
    const task: TaskContext = {
      description: "Implement JWT authentication",
      files: [],
      recentConversation: [],
      toolResults: [],
      memoryEntries: [
        { key: "jwt-setup", value: "Use RS256 for JWT signing", layer: "decisions", timestamp: Date.now() },
        { key: "database-schema", value: "Users table has columns...", layer: "project", timestamp: Date.now() - 86_400_000 * 60 },
      ],
      decisions: [],
    };

    const result = replayContext(task, defaultBudget);
    const jwtMemory = result.sources.find((s) => s.content.includes("RS256"));
    expect(jwtMemory).toBeTruthy();
  });
});
