import { describe, it, expect } from "vitest";
import {
  TurboQuantEngine,
  COMPRESSION_PROFILES,
} from "../../src/context/ollama-kv-compression.js";
import type { TurboQuantConfig, VirtualMessage } from "../../src/context/ollama-kv-compression.js";

describe("TurboQuant Engine", () => {
  describe("estimateEffectiveContext", () => {
    it("applies compression ratio to base context", () => {
      const engine = new TurboQuantEngine(COMPRESSION_PROFILES["conservative"]);
      // Conservative: 2x compression, no mixed precision
      const effective = engine.estimateEffectiveContext(131_072);
      expect(effective).toBe(262_144);
    });

    it("applies mixed precision overhead for balanced profile", () => {
      const engine = new TurboQuantEngine(COMPRESSION_PROFILES["balanced"]);
      // Balanced: 4x compression with mixed precision (1.05 overhead)
      const effective = engine.estimateEffectiveContext(131_072);
      expect(effective).toBe(Math.floor(131_072 * 4 / 1.05));
    });

    it("achieves ~6x for aggressive profile", () => {
      const engine = new TurboQuantEngine(COMPRESSION_PROFILES["aggressive"]);
      const effective = engine.estimateEffectiveContext(131_072);
      // 6x with 1.05 overhead
      expect(effective).toBe(Math.floor(131_072 * 6 / 1.05));
      expect(effective).toBeGreaterThan(700_000);
    });

    it("accepts override config parameter", () => {
      const engine = new TurboQuantEngine();
      const custom: TurboQuantConfig = { compressionRatio: 3, quantizationBits: 4, enableMixedPrecision: false };
      const effective = engine.estimateEffectiveContext(100_000, custom);
      expect(effective).toBe(300_000);
    });
  });

  describe("generateOllamaParams", () => {
    it("generates correct params for conservative config", () => {
      const engine = new TurboQuantEngine(COMPRESSION_PROFILES["conservative"]);
      const params = engine.generateOllamaParams("qwen3-coder-next");
      expect(params.kvCacheType).toBe("q8_0");
      expect(params.flashAttention).toBe(false);
      expect(params.numCtx).toBe(262_144); // 131K * 2
      expect(params.description).toContain("q8_0");
    });

    it("generates correct params for aggressive config", () => {
      const engine = new TurboQuantEngine(COMPRESSION_PROFILES["aggressive"]);
      const params = engine.generateOllamaParams("gemma4:27b");
      expect(params.kvCacheType).toBe("q2_K");
      expect(params.flashAttention).toBe(true);
      expect(params.numCtx).toBeGreaterThan(700_000);
    });

    it("generates correct params for balanced config", () => {
      const engine = new TurboQuantEngine(COMPRESSION_PROFILES["balanced"]);
      const params = engine.generateOllamaParams("devstral:24b");
      expect(params.kvCacheType).toBe("q4_0");
      expect(params.flashAttention).toBe(true);
    });

    it("includes a human-readable description", () => {
      const engine = new TurboQuantEngine();
      const params = engine.generateOllamaParams("qwen3-coder-next");
      expect(params.description).toContain("KV cache");
      expect(params.description).toContain("compression");
    });
  });

  describe("getRecommendedConfig", () => {
    it("recommends aggressive for tight VRAM (< model + 2GB)", () => {
      const engine = new TurboQuantEngine();
      const config = engine.getRecommendedConfig("qwen3.5:27b", 17);
      expect(config.compressionRatio).toBe(6);
      expect(config.quantizationBits).toBe(2);
    });

    it("recommends balanced for moderate VRAM", () => {
      const engine = new TurboQuantEngine();
      const config = engine.getRecommendedConfig("gemma4:12b", 12);
      expect(config.compressionRatio).toBe(4);
      expect(config.quantizationBits).toBe(4);
    });

    it("recommends conservative for plentiful VRAM", () => {
      const engine = new TurboQuantEngine();
      const config = engine.getRecommendedConfig("gemma4:12b", 24);
      expect(config.compressionRatio).toBe(2);
      expect(config.quantizationBits).toBe(8);
    });
  });

  describe("estimateVRAMBudget", () => {
    it("calculates VRAM breakdown correctly", () => {
      const engine = new TurboQuantEngine(COMPRESSION_PROFILES["conservative"]);
      const budget = engine.estimateVRAMBudget("gemma4:12b", 24);
      expect(budget.totalVRAM).toBe(24);
      expect(budget.modelVRAM).toBe(8);
      expect(budget.availableForKV).toBe(16);
      expect(budget.estimatedContextTokens).toBeGreaterThan(0);
    });

    it("returns zero available when model fills VRAM", () => {
      const engine = new TurboQuantEngine();
      const budget = engine.estimateVRAMBudget("llama3.3:70b", 40);
      expect(budget.availableForKV).toBe(0);
      expect(budget.estimatedContextTokens).toBe(0);
    });
  });

  describe("contextVirtualization", () => {
    const makeMessages = (count: number, tokensEach: number): VirtualMessage[] =>
      Array.from({ length: count }, (_, i) => ({
        role: "user" as const,
        content: `Message ${i}`,
        tokenEstimate: tokensEach,
        timestamp: Date.now() + i * 1000,
      }));

    it("returns all messages when they fit", () => {
      const engine = new TurboQuantEngine();
      const messages = makeMessages(5, 100);
      const result = engine.contextVirtualization(messages, 1000);
      expect(result.active).toHaveLength(5);
      expect(result.archived).toHaveLength(0);
      expect(result.activeTokens).toBe(500);
    });

    it("shards when messages exceed limit", () => {
      const engine = new TurboQuantEngine();
      const messages = makeMessages(20, 100);
      const result = engine.contextVirtualization(messages, 1000);
      expect(result.activeTokens).toBeLessThanOrEqual(1000);
      expect(result.archived.length).toBeGreaterThan(0);
      expect(result.archivedTokens).toBeGreaterThan(0);
      expect(result.activeTokens + result.archivedTokens).toBe(2000);
    });

    it("handles empty messages", () => {
      const engine = new TurboQuantEngine();
      const result = engine.contextVirtualization([], 1000);
      expect(result.active).toHaveLength(0);
      expect(result.archived).toHaveLength(0);
      expect(result.totalTokens).toBe(0);
    });

    it("prioritizes system messages", () => {
      const engine = new TurboQuantEngine();
      const messages: VirtualMessage[] = [
        { role: "system", content: "System", tokenEstimate: 400, timestamp: 1 },
        { role: "user", content: "Old", tokenEstimate: 400, timestamp: 2 },
        { role: "user", content: "Recent", tokenEstimate: 400, timestamp: 3 },
      ];
      const result = engine.contextVirtualization(messages, 800);
      expect(result.active.some((m) => m.role === "system")).toBe(true);
    });

    it("supports topic-aware-shard strategy", () => {
      const engine = new TurboQuantEngine();
      const messages: VirtualMessage[] = [
        { role: "user", content: "Old topic A", tokenEstimate: 300, topic: "A" },
        { role: "user", content: "Old topic B", tokenEstimate: 300, topic: "B" },
        { role: "user", content: "Recent topic A", tokenEstimate: 300, topic: "A" },
      ];
      const result = engine.contextVirtualization(messages, 600, "topic-aware-shard");
      expect(result.activeTokens).toBeLessThanOrEqual(600);
    });
  });

  describe("getConfig", () => {
    it("returns the current config", () => {
      const engine = new TurboQuantEngine(COMPRESSION_PROFILES["aggressive"]);
      expect(engine.getConfig().compressionRatio).toBe(6);
      expect(engine.getConfig().quantizationBits).toBe(2);
    });

    it("defaults to balanced profile", () => {
      const engine = new TurboQuantEngine();
      expect(engine.getConfig().compressionRatio).toBe(4);
    });
  });
});
