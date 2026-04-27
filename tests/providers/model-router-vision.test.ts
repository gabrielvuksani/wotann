import { describe, it, expect, beforeEach } from "vitest";
import { ModelRouter } from "../../src/providers/model-router.js";
import type { TaskDescriptor, ProviderName } from "../../src/core/types.js";

function makeTask(overrides: Partial<TaskDescriptor> = {}): TaskDescriptor {
  return {
    category: "code",
    priority: "balanced",
    requiresComputerUse: false,
    requiresVision: false,
    estimatedTokens: 1000,
    ...overrides,
  };
}

function makeRouter(providers: ProviderName[]): ModelRouter {
  return new ModelRouter({
    availableProviders: new Set(providers),
    ollamaModels: [],
  });
}

describe("ModelRouter — vision routing (Phase 4 Sprint B2 item 16)", () => {
  describe("vision tasks prefer Gemini 3.1 Pro free tier", () => {
    it("routes to Gemini when Gemini is available", () => {
      const router = makeRouter(["gemini", "anthropic", "openai"]);
      const decision = router.route(makeTask({ requiresVision: true }));
      expect(decision.provider).toBe("gemini");
      expect(decision.model).toBe("gemini-3.1-pro");
      expect(decision.tier).toBe(1);
    });

    // Vertex was dropped from the first-class set in the 21→8 provider
    // consolidation. The Vertex-fallback test that lived here is no
    // longer applicable; users wanting Google's enterprise tier reach
    // it through OpenRouter using the `openrouter/google/...` slug.

    it("falls back to Claude Sonnet when Gemini+Vertex both missing", () => {
      const router = makeRouter(["anthropic", "openai"]);
      const decision = router.route(makeTask({ requiresVision: true }));
      expect(decision.provider).toBe("anthropic");
      expect(decision.model).toBe("claude-sonnet-4-7");
    });

    it("falls back to GPT-5.4 when only OpenAI available", () => {
      const router = makeRouter(["openai"]);
      const decision = router.route(makeTask({ requiresVision: true }));
      expect(decision.provider).toBe("openai");
      expect(decision.model).toBe("gpt-5.4");
    });

    it("falls back to Ollama installed model when only local available", () => {
      // SB-NEW-2 fix (QB#15): the router no longer hardcodes "qwen3.5" —
      // it picks from the user's installed models. Pass qwen3.5:27b in the
      // installed list so the router can match it; an empty list now
      // correctly omits the Ollama candidate entirely (no qwen3.5 ghost).
      const router = new ModelRouter({
        availableProviders: new Set(["ollama"]),
        ollamaModels: ["qwen3.5:27b"],
      });
      const decision = router.route(makeTask({ requiresVision: true }));
      expect(decision.provider).toBe("ollama");
      expect(decision.model).toBe("qwen3.5:27b");
    });

    it("returns honest 'auto' fallback when only ollama available with NO models installed (SB-NEW-2)", () => {
      const router = new ModelRouter({
        availableProviders: new Set(["ollama"]),
        ollamaModels: [],
      });
      const decision = router.route(makeTask({ requiresVision: true }));
      // The router omits the ollama candidate when no models are installed
      // (previously it injected the hardcoded "qwen3.5" string and a
      // subsequent query would 404). The fall-through "auto" string makes
      // it loud that no real model was selected.
      expect(decision.model).toBe("auto");
    });

    it("skips Gemini when its health is degraded", () => {
      const router = makeRouter(["gemini", "anthropic"]);
      // Record 5 consecutive failures on Gemini to mark it unhealthy
      for (let i = 0; i < 5; i++) router.recordResult("gemini", false, 1000);
      const decision = router.route(makeTask({ requiresVision: true }));
      expect(decision.provider).toBe("anthropic");
    });
  });

  describe("long-context tasks (>128k tokens) route to Gemini", () => {
    it("routes 150k-token plan task to Gemini 3.1 Pro", () => {
      const router = makeRouter(["gemini", "anthropic"]);
      const decision = router.route(
        makeTask({ category: "plan", priority: "quality", estimatedTokens: 150_000 }),
      );
      expect(decision.provider).toBe("gemini");
      expect(decision.model).toBe("gemini-3.1-pro");
    });

    it("routes 500k-token code task to Gemini (bypasses default code routing)", () => {
      const router = makeRouter(["gemini", "anthropic"]);
      const decision = router.route(makeTask({ category: "code", estimatedTokens: 500_000 }));
      expect(decision.provider).toBe("gemini");
    });

    it("at exactly 128k tokens uses the standard path (not long-context branch)", () => {
      const router = makeRouter(["gemini", "anthropic"]);
      const decision = router.route(makeTask({ category: "code", estimatedTokens: 128_000 }));
      // Standard tier-2 code routing — Anthropic preferred
      expect(decision.provider).toBe("anthropic");
    });

    it("128001 tokens crosses the threshold", () => {
      const router = makeRouter(["gemini", "anthropic"]);
      const decision = router.route(makeTask({ estimatedTokens: 128_001 }));
      expect(decision.provider).toBe("gemini");
    });

    it("long-context vision task (both conditions met) also hits Gemini", () => {
      const router = makeRouter(["gemini", "anthropic"]);
      const decision = router.route(
        makeTask({ requiresVision: true, estimatedTokens: 500_000 }),
      );
      expect(decision.provider).toBe("gemini");
      // Vision branch takes precedence (evaluated first) — either way we
      // land on Gemini 3.1 Pro.
    });

    it("falls back to Sonnet at long-context when no Gemini/Vertex", () => {
      const router = makeRouter(["anthropic"]);
      const decision = router.route(makeTask({ estimatedTokens: 500_000 }));
      expect(decision.provider).toBe("anthropic");
    });
  });

  describe("ordering: vision/long-context checks occur BEFORE default routes", () => {
    it("vision task with code category still hits vision branch (not code)", () => {
      const router = makeRouter(["gemini", "anthropic", "openai"]);
      const decision = router.route(
        makeTask({ category: "code", requiresVision: true }),
      );
      expect(decision.provider).toBe("gemini");
    });

    it("computer-use (which also sets vision) still hits CU branch first", () => {
      const router = makeRouter(["anthropic", "gemini"]);
      const decision = router.route(
        makeTask({
          category: "computer-use",
          requiresComputerUse: true,
          requiresVision: true,
        }),
      );
      // CU branch is first — routes to Claude Sonnet, not Gemini
      expect(decision.provider).toBe("anthropic");
    });
  });
});
