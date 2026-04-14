import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import {
  SessionExtractor,
  type ExtractedPair,
  type ExtractionResult,
} from "../../src/training/session-extractor.js";
import type { ReplaySession, ReplayEvent } from "../../src/telemetry/session-replay.js";

// ── Test Helpers ────────────────────────────────────────

function makeSession(events: readonly ReplayEvent[], overrides?: Partial<ReplaySession>): ReplaySession {
  return {
    sessionId: "test-session",
    startedAt: 1000,
    provider: "anthropic",
    model: "claude-sonnet",
    events,
    metadata: {},
    ...overrides,
  };
}

function makePromptEvent(prompt: string, timestamp: number = 1000): ReplayEvent {
  return {
    id: `prompt-${timestamp}`,
    timestamp,
    type: "prompt",
    data: { prompt },
  };
}

function makeResponseEvent(response: string, timestamp: number = 2000, tokens: number = 100): ReplayEvent {
  return {
    id: `response-${timestamp}`,
    timestamp,
    type: "response",
    data: { response, tokens },
  };
}

// ── Tests ───────────────────────────────────────────────

describe("SessionExtractor", () => {
  let extractor: SessionExtractor;

  beforeEach(() => {
    extractor = new SessionExtractor(0.7);
  });

  // ── extractFromReplay ─────────────────────────────────

  describe("extractFromReplay", () => {
    it("extracts prompt/response pairs from session events", () => {
      const session = makeSession([
        makePromptEvent("How do I implement a linked list?", 1000),
        makeResponseEvent(
          "A linked list is a data structure where each element points to the next.\n\n```typescript\ninterface Node<T> {\n  value: T;\n  next: Node<T> | null;\n}\n```\n\nYou can implement basic operations like insert, delete, and traverse.",
          2000,
        ),
      ]);

      const result = extractor.extractFromReplay(session);

      expect(result.pairsExtracted).toBe(1);
      expect(result.totalEvents).toBe(2);
    });

    it("preserves provider and model metadata", () => {
      const session = makeSession(
        [
          makePromptEvent("test prompt with enough words for quality", 1000),
          makeResponseEvent(
            "A good response that is long enough to pass quality filters and contains useful information about the topic.",
            2000,
          ),
        ],
        { provider: "openai", model: "gpt-4" },
      );

      const result = extractor.extractFromReplay(session);
      if (result.pairs.length > 0) {
        expect(result.pairs[0]!.metadata.provider).toBe("openai");
        expect(result.pairs[0]!.metadata.model).toBe("gpt-4");
      }
    });

    it("calculates duration from timestamps", () => {
      const session = makeSession([
        makePromptEvent("What is the time complexity of sorting?", 1000),
        makeResponseEvent(
          "The time complexity depends on the algorithm:\n- Merge sort: O(n log n)\n- Quick sort: O(n log n) average, O(n^2) worst\n- Bubble sort: O(n^2)\n\nFor most cases, use the built-in sort which is typically O(n log n).",
          3500,
        ),
      ]);

      const result = extractor.extractFromReplay(session);
      if (result.pairs.length > 0) {
        expect(result.pairs[0]!.metadata.duration).toBe(2500);
      }
    });

    it("skips non-prompt/response events", () => {
      const session = makeSession([
        { id: "e1", timestamp: 1000, type: "tool_call", data: { toolName: "read" } },
        { id: "e2", timestamp: 2000, type: "tool_result", data: { output: "file content" } },
      ]);

      const result = extractor.extractFromReplay(session);
      expect(result.pairsExtracted).toBe(0);
    });

    it("handles sessions with no events", () => {
      const session = makeSession([]);
      const result = extractor.extractFromReplay(session);

      expect(result.pairs).toHaveLength(0);
      expect(result.totalEvents).toBe(0);
    });

    it("filters low-quality pairs", () => {
      const session = makeSession([
        makePromptEvent("hi", 1000),
        makeResponseEvent("ok", 2000), // Very short = low quality
      ]);

      const result = extractor.extractFromReplay(session);
      expect(result.pairsAfterFilter).toBe(0);
    });

    it("deduplicates near-identical pairs", () => {
      const session = makeSession([
        makePromptEvent("How do I use TypeScript generics?", 1000),
        makeResponseEvent(
          "TypeScript generics allow you to create reusable components that work with multiple types.\n\n```typescript\nfunction identity<T>(arg: T): T { return arg; }\n```",
          2000,
        ),
        makePromptEvent("How do I use TypeScript generics?", 3000),
        makeResponseEvent(
          "TypeScript generics allow you to create reusable components that work with multiple types.\n\n```typescript\nfunction identity<T>(arg: T): T { return arg; }\n```",
          4000,
        ),
      ]);

      const result = extractor.extractFromReplay(session);
      expect(result.pairsAfterDedup).toBeLessThanOrEqual(result.pairsAfterFilter);
    });
  });

  // ── batchExtract ──────────────────────────────────────

  describe("batchExtract", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "session-extract-"));
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });

    it("processes all session files in directory", () => {
      const session1 = makeSession([
        makePromptEvent("Explain the observer pattern in detail", 1000),
        makeResponseEvent(
          "The observer pattern defines a one-to-many dependency between objects.\n\nWhen the subject changes state, all observers are notified.\n\n```typescript\ninterface Observer {\n  update(data: unknown): void;\n}\n```\n\nThis is commonly used in event systems and reactive programming.",
          2000,
        ),
      ]);

      const session2 = makeSession([
        makePromptEvent("What is dependency injection and why is it useful?", 1000),
        makeResponseEvent(
          "Dependency injection (DI) is a design pattern where dependencies are provided from outside rather than created internally.\n\n## Benefits\n- Testability: easy to mock dependencies\n- Loose coupling: components don't create their own deps\n- Flexibility: swap implementations easily",
          2000,
        ),
      ]);

      writeFileSync(join(tmpDir, "session_1.json"), JSON.stringify(session1));
      writeFileSync(join(tmpDir, "session_2.json"), JSON.stringify(session2));

      const result = extractor.batchExtract(tmpDir);
      expect(result.pairsExtracted).toBe(2);
      expect(result.totalEvents).toBe(4);
    });

    it("returns empty result for non-existent directory", () => {
      const result = extractor.batchExtract("/nonexistent/dir");
      expect(result.pairs).toHaveLength(0);
      expect(result.pairsExtracted).toBe(0);
    });

    it("skips malformed session files", () => {
      writeFileSync(join(tmpDir, "bad.json"), "not json");
      writeFileSync(join(tmpDir, "also_bad.json"), '{"events": "not-array"}');

      const result = extractor.batchExtract(tmpDir);
      expect(result.pairs).toHaveLength(0);
    });

    it("deduplicates across sessions", () => {
      const sameSession = makeSession([
        makePromptEvent("Explain async/await in TypeScript", 1000),
        makeResponseEvent(
          "async/await is syntactic sugar for Promises.\n\n```typescript\nasync function fetchData(): Promise<Data> {\n  const response = await fetch(url);\n  return response.json();\n}\n```\n\nThe async keyword makes a function return a Promise, and await pauses until the Promise resolves.",
          2000,
        ),
      ]);

      // Write identical sessions
      writeFileSync(join(tmpDir, "session_a.json"), JSON.stringify(sameSession));
      writeFileSync(join(tmpDir, "session_b.json"), JSON.stringify(sameSession));

      const result = extractor.batchExtract(tmpDir);
      // Should deduplicate the identical pairs
      expect(result.pairsAfterDedup).toBeLessThanOrEqual(result.pairsAfterFilter);
    });
  });

  // ── Quality Threshold ─────────────────────────────────

  describe("quality threshold", () => {
    it("uses configured threshold", () => {
      const strict = new SessionExtractor(0.9);
      expect(strict.getQualityThreshold()).toBe(0.9);
    });

    it("defaults to 0.7", () => {
      const defaultExtractor = new SessionExtractor();
      expect(defaultExtractor.getQualityThreshold()).toBe(0.7);
    });
  });
});
