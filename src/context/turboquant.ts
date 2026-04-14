/**
 * TurboQuant-inspired KV cache compression for local models.
 *
 * Based on Google ICLR 2026 TurboQuant paper achieving 6x KV cache compression
 * via mixed-precision quantization without meaningful quality loss.
 *
 * This module generates Ollama-compatible parameters that exploit quantized KV
 * caches to expand effective context windows on constrained hardware:
 * 1. COMPRESSION PROFILES — predefined configs for common scenarios
 * 2. EFFECTIVE CONTEXT ESTIMATION — predict usable tokens after compression
 * 3. OLLAMA PARAM GENERATION — produce num_ctx and KV cache type parameters
 * 4. AUTO-CONFIGURATION — pick the best profile given model and available VRAM
 * 5. CONTEXT VIRTUALIZATION — shard and retrieve when context exceeds limit
 */

// ── Types ────────────────────────────────────────────────────

export interface TurboQuantConfig {
  readonly compressionRatio: number;
  readonly quantizationBits: 2 | 4 | 8;
  readonly enableMixedPrecision: boolean;
}

export interface OllamaParams {
  readonly numCtx: number;
  readonly kvCacheType: string;
  readonly flashAttention: boolean;
  readonly numGpu: number;
  readonly description: string;
}

export interface VRAMBudget {
  readonly totalVRAM: number;
  readonly modelVRAM: number;
  readonly availableForKV: number;
  readonly estimatedContextTokens: number;
}

export interface ContextShard {
  readonly id: string;
  readonly tokens: number;
  readonly summary: string;
  readonly messages: readonly VirtualMessage[];
  readonly score: number;
}

export interface VirtualMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
  readonly tokenEstimate: number;
  readonly timestamp?: number;
  readonly topic?: string;
}

export interface VirtualizationResult {
  readonly active: readonly VirtualMessage[];
  readonly archived: readonly ContextShard[];
  readonly totalTokens: number;
  readonly activeTokens: number;
  readonly archivedTokens: number;
  readonly shardsCreated: number;
}

export type ShardingStrategy =
  | "topic-aware-shard"
  | "recency-weighted"
  | "importance-ranked";

// ── Compression Profiles ─────────────────────────────────────

export const COMPRESSION_PROFILES: Record<string, TurboQuantConfig> = {
  conservative: {
    compressionRatio: 2,
    quantizationBits: 8,
    enableMixedPrecision: false,
  },
  balanced: {
    compressionRatio: 4,
    quantizationBits: 4,
    enableMixedPrecision: true,
  },
  aggressive: {
    compressionRatio: 6,
    quantizationBits: 2,
    enableMixedPrecision: true,
  },
} as const;

// ── VRAM Estimation Constants ────────────────────────────────

/** Bytes per token in the KV cache at full (FP16) precision. */
const FP16_BYTES_PER_TOKEN = 256;

/** Minimum VRAM (GB) to reserve for the model weights and runtime overhead. */
const MIN_MODEL_VRAM_GB = 2;

/** Overhead multiplier for mixed precision bookkeeping. */
const MIXED_PRECISION_OVERHEAD = 1.05;

// ── Model Size Heuristics ────────────────────────────────────

const MODEL_VRAM_ESTIMATES: Record<string, number> = {
  "qwen3-coder-next": 16,
  "qwen3.5:27b": 16,
  "devstral:24b": 14,
  "gemma4:27b": 16,
  "gemma4:12b": 8,
  "nemotron-cascade-2": 16,
  "minimax-m2.7": 2,
  "llama3.3:70b": 40,
  "codestral:22b": 13,
  "deepseek-coder-v3:33b": 20,
};

// ── TurboQuant Engine ────────────────────────────────────────

export class TurboQuantEngine {
  private readonly config: TurboQuantConfig;

  constructor(config?: TurboQuantConfig) {
    this.config = config ?? COMPRESSION_PROFILES["balanced"]!;
  }

  /**
   * Calculate effective context tokens after KV cache compression.
   * Base formula: effective = base * compressionRatio
   * Mixed precision adds a small overhead that slightly reduces the gain.
   */
  estimateEffectiveContext(
    baseContextTokens: number,
    config?: TurboQuantConfig,
  ): number {
    const cfg = config ?? this.config;
    const rawMultiplier = cfg.compressionRatio;
    const overhead = cfg.enableMixedPrecision ? MIXED_PRECISION_OVERHEAD : 1.0;
    return Math.floor(baseContextTokens * rawMultiplier / overhead);
  }

  /**
   * Generate Ollama-compatible parameters for the given model and config.
   */
  generateOllamaParams(
    model: string,
    config?: TurboQuantConfig,
  ): OllamaParams {
    const cfg = config ?? this.config;
    const kvCacheType = mapQuantBitsToOllamaType(cfg.quantizationBits);
    const baseContext = getBaseContextForModel(model);
    const effectiveContext = this.estimateEffectiveContext(baseContext, cfg);

    return {
      numCtx: effectiveContext,
      kvCacheType,
      flashAttention: cfg.enableMixedPrecision,
      numGpu: -1,
      description: [
        `KV cache: ${kvCacheType} (${cfg.quantizationBits}-bit, ${cfg.compressionRatio}x compression).`,
        `Effective context: ${formatTokens(effectiveContext)} from ${formatTokens(baseContext)} base.`,
        cfg.enableMixedPrecision ? "Mixed precision enabled." : "Uniform precision.",
      ].join(" "),
    };
  }

  /**
   * Auto-detect the best compression config given model and available VRAM.
   */
  getRecommendedConfig(
    model: string,
    availableVRAM: number,
  ): TurboQuantConfig {
    const modelVRAM = MODEL_VRAM_ESTIMATES[model] ?? MIN_MODEL_VRAM_GB;
    const kvBudgetGB = Math.max(0, availableVRAM - modelVRAM);

    // Very tight VRAM: aggressive compression is the only option
    if (kvBudgetGB < 2) {
      return COMPRESSION_PROFILES["aggressive"]!;
    }

    // Moderate VRAM: balanced compression
    if (kvBudgetGB < 6) {
      return COMPRESSION_PROFILES["balanced"]!;
    }

    // Plenty of VRAM: conservative compression preserves quality
    return COMPRESSION_PROFILES["conservative"]!;
  }

  /**
   * Estimate VRAM budget breakdown for a given model and config.
   */
  estimateVRAMBudget(
    model: string,
    totalVRAMGB: number,
    config?: TurboQuantConfig,
  ): VRAMBudget {
    const cfg = config ?? this.config;
    const modelVRAM = MODEL_VRAM_ESTIMATES[model] ?? MIN_MODEL_VRAM_GB;
    const availableForKV = Math.max(0, totalVRAMGB - modelVRAM);
    const bytesPerToken = FP16_BYTES_PER_TOKEN / cfg.compressionRatio;
    const availableBytes = availableForKV * 1024 * 1024 * 1024;
    const estimatedTokens = Math.floor(availableBytes / bytesPerToken);

    return {
      totalVRAM: totalVRAMGB,
      modelVRAM,
      availableForKV,
      estimatedContextTokens: estimatedTokens,
    };
  }

  /**
   * When context exceeds the limit, shard into active + archived segments.
   * Returns the active window and archived shards for later retrieval.
   */
  contextVirtualization(
    messages: readonly VirtualMessage[],
    maxTokens: number,
    strategy: ShardingStrategy = "recency-weighted",
  ): VirtualizationResult {
    if (messages.length === 0) {
      return {
        active: [],
        archived: [],
        totalTokens: 0,
        activeTokens: 0,
        archivedTokens: 0,
        shardsCreated: 0,
      };
    }

    const totalTokens = messages.reduce((sum, m) => sum + m.tokenEstimate, 0);

    // Everything fits — no sharding needed
    if (totalTokens <= maxTokens) {
      return {
        active: messages,
        archived: [],
        totalTokens,
        activeTokens: totalTokens,
        archivedTokens: 0,
        shardsCreated: 0,
      };
    }

    const scored = scoreMessages(messages, strategy);
    const sorted = [...scored].sort((a, b) => b.score - a.score);

    // Greedily fill the active window with highest-scoring messages
    const active: VirtualMessage[] = [];
    let activeTokens = 0;

    for (const item of sorted) {
      if (activeTokens + item.message.tokenEstimate <= maxTokens) {
        active.push(item.message);
        activeTokens += item.message.tokenEstimate;
      }
    }

    // Preserve original message ordering within the active set
    const activeSet = new Set(active);
    const orderedActive = messages.filter((m) => activeSet.has(m));

    // Everything else goes into archived shards
    const archivedMessages = messages.filter((m) => !activeSet.has(m));
    const archived = buildShards(archivedMessages);
    const archivedTokens = totalTokens - activeTokens;

    return {
      active: orderedActive,
      archived,
      totalTokens,
      activeTokens,
      archivedTokens,
      shardsCreated: archived.length,
    };
  }

  getConfig(): TurboQuantConfig {
    return this.config;
  }
}

// ── Private Helpers ──────────────────────────────────────────

function mapQuantBitsToOllamaType(bits: 2 | 4 | 8): string {
  switch (bits) {
    case 2: return "q2_K";
    case 4: return "q4_0";
    case 8: return "q8_0";
  }
}

function getBaseContextForModel(model: string): number {
  const defaults: Record<string, number> = {
    "qwen3-coder-next": 131_072,
    "qwen3.5:27b": 262_144,
    "devstral:24b": 131_072,
    "gemma4:27b": 128_000,
    "gemma4:12b": 128_000,
    "nemotron-cascade-2": 131_072,
    "minimax-m2.7": 200_000,
  };
  return defaults[model] ?? 131_072;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface ScoredMessage {
  readonly message: VirtualMessage;
  readonly score: number;
}

function scoreMessages(
  messages: readonly VirtualMessage[],
  strategy: ShardingStrategy,
): readonly ScoredMessage[] {
  const total = messages.length;
  return messages.map((message, index) => {
    let score: number;

    switch (strategy) {
      case "recency-weighted": {
        // More recent messages score higher; system messages always score highest
        const recencyScore = (index + 1) / total;
        const roleBoost = message.role === "system" ? 1.0 : 0;
        score = recencyScore + roleBoost;
        break;
      }
      case "topic-aware-shard": {
        // Messages with topics matching the latest message score higher
        const lastTopic = messages[total - 1]?.topic;
        const topicMatch = message.topic && message.topic === lastTopic ? 0.5 : 0;
        const recency = (index + 1) / total;
        score = recency + topicMatch + (message.role === "system" ? 1.0 : 0);
        break;
      }
      case "importance-ranked": {
        // System > user > assistant; recency is secondary
        const rolePriority = message.role === "system" ? 3 : message.role === "user" ? 2 : 1;
        score = rolePriority + (index + 1) / (total * 10);
        break;
      }
    }

    return { message, score };
  });
}

function buildShards(
  messages: readonly VirtualMessage[],
): readonly ContextShard[] {
  if (messages.length === 0) return [];

  const shardSize = 10;
  const shards: ContextShard[] = [];

  for (let i = 0; i < messages.length; i += shardSize) {
    const chunk = messages.slice(i, i + shardSize);
    const tokens = chunk.reduce((sum, m) => sum + m.tokenEstimate, 0);
    const topics = chunk
      .map((m) => m.topic)
      .filter((t): t is string => t !== undefined);
    const uniqueTopics = [...new Set(topics)];

    shards.push({
      id: `shard-${shards.length}`,
      tokens,
      summary: uniqueTopics.length > 0
        ? `Topics: ${uniqueTopics.join(", ")}`
        : `${chunk.length} messages (${formatTokens(tokens)} tokens)`,
      messages: chunk,
      score: chunk.reduce((sum, m) => sum + m.tokenEstimate, 0) / chunk.length,
    });
  }

  return shards;
}
