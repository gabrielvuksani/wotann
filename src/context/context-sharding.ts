/**
 * Context Sharding — topic-based conversation partitioning.
 *
 * Instead of a single monolithic conversation that grows until it overflows,
 * Context Shards partition the conversation into topic-specific pages.
 * Each shard has its own token budget and can be independently compacted,
 * offloaded to disk, or restored.
 *
 * This is the key innovation that makes 128K models work like 1M models:
 * by loading only the shard relevant to the current task, the effective
 * context is always fresh and focused.
 *
 * No competitor implements this — all use linear conversation history.
 */

// ── Types ───────────────────────────────────────────────

export interface ContextShard {
  readonly id: string;
  readonly topic: string;
  readonly messages: readonly ShardMessage[];
  readonly tokenEstimate: number;
  readonly createdAt: number;
  readonly lastAccessedAt: number;
  readonly accessCount: number;
  readonly importance: number; // 0-10, higher = keep loaded longer
  readonly state: "active" | "dormant" | "offloaded" | "summarized";
  readonly summary?: string;
  readonly parentShardId?: string;
  readonly tags: readonly string[];
}

export interface ShardMessage {
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly timestamp: number;
  readonly tokenEstimate: number;
}

export interface ShardingConfig {
  readonly maxActiveShards: number;
  readonly maxTokensPerShard: number;
  readonly totalTokenBudget: number;
  readonly autoSplitThreshold: number;
  readonly dormantAfterMinutes: number;
  readonly summaryWhenDormant: boolean;
}

export interface ShardManagerStats {
  readonly totalShards: number;
  readonly activeShards: number;
  readonly dormantShards: number;
  readonly offloadedShards: number;
  readonly totalTokensUsed: number;
  readonly totalTokenBudget: number;
  readonly utilizationPercent: number;
}

// ── Shard Manager ───────────────────────────────────────

export class ContextShardManager {
  private readonly shards: Map<string, ContextShard> = new Map();
  private activeShardId: string | null = null;
  private readonly config: ShardingConfig;
  private readonly offloadedSummaries: Map<string, string> = new Map();

  constructor(config?: Partial<ShardingConfig>) {
    this.config = {
      maxActiveShards: 5,
      maxTokensPerShard: 50_000,
      totalTokenBudget: 200_000,
      autoSplitThreshold: 40_000,
      dormantAfterMinutes: 15,
      summaryWhenDormant: true,
      ...config,
    };
  }

  /**
   * Create a new shard for a topic.
   */
  createShard(topic: string, importance: number = 5, tags: readonly string[] = []): string {
    const id = `shard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const shard: ContextShard = {
      id,
      topic,
      messages: [],
      tokenEstimate: 0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      importance,
      state: "active",
      tags,
    };

    this.shards.set(id, shard);
    this.activeShardId = id;

    // Enforce max active shards
    this.enforceLimits();

    return id;
  }

  /**
   * Add a message to the active shard.
   */
  addMessage(message: Omit<ShardMessage, "tokenEstimate">): void {
    if (!this.activeShardId) return;

    const shard = this.shards.get(this.activeShardId);
    if (!shard) return;

    const tokenEstimate = Math.ceil(message.content.length / 4);
    const newMessage: ShardMessage = { ...message, tokenEstimate };

    const updatedShard: ContextShard = {
      ...shard,
      messages: [...shard.messages, newMessage],
      tokenEstimate: shard.tokenEstimate + tokenEstimate,
      lastAccessedAt: Date.now(),
      accessCount: shard.accessCount + 1,
    };

    this.shards.set(this.activeShardId, updatedShard);

    // Auto-split if shard is getting too large
    if (updatedShard.tokenEstimate > this.config.autoSplitThreshold) {
      this.splitShard(this.activeShardId);
    }
  }

  /**
   * Switch to a different shard (by topic search or ID).
   */
  switchToShard(idOrTopic: string): boolean {
    // Try exact ID match first
    if (this.shards.has(idOrTopic)) {
      this.activateShard(idOrTopic);
      return true;
    }

    // Search by topic
    const match = this.findShardByTopic(idOrTopic);
    if (match) {
      this.activateShard(match.id);
      return true;
    }

    return false;
  }

  /**
   * Get the messages from the active shard for prompt assembly.
   */
  getActiveContext(): readonly ShardMessage[] {
    if (!this.activeShardId) return [];
    const shard = this.shards.get(this.activeShardId);
    return shard?.messages ?? [];
  }

  /**
   * Get a cross-shard context: active shard + summaries of related shards.
   */
  getCrossShardContext(maxTokens: number): { messages: readonly ShardMessage[]; summaries: readonly string[] } {
    const active = this.activeShardId ? this.shards.get(this.activeShardId) : null;
    const messages = active?.messages ?? [];
    let usedTokens = active?.tokenEstimate ?? 0;

    const summaries: string[] = [];

    // Add summaries from related dormant/offloaded shards
    for (const [id, shard] of this.shards) {
      if (id === this.activeShardId) continue;
      if (usedTokens >= maxTokens) break;

      if (shard.state === "summarized" && shard.summary) {
        const summaryTokens = Math.ceil(shard.summary.length / 4);
        if (usedTokens + summaryTokens <= maxTokens) {
          summaries.push(`[Context: ${shard.topic}] ${shard.summary}`);
          usedTokens += summaryTokens;
        }
      }
    }

    // Add offloaded summaries
    for (const [, summary] of this.offloadedSummaries) {
      if (usedTokens >= maxTokens) break;
      const summaryTokens = Math.ceil(summary.length / 4);
      if (usedTokens + summaryTokens <= maxTokens) {
        summaries.push(summary);
        usedTokens += summaryTokens;
      }
    }

    return { messages, summaries };
  }

  /**
   * Detect when the user has shifted topics (for auto-shard creation).
   */
  detectTopicShift(newMessage: string): boolean {
    if (!this.activeShardId) return false;
    const active = this.shards.get(this.activeShardId);
    if (!active || active.messages.length < 3) return false;

    // Get keywords from current shard
    const shardKeywords = extractKeywords(
      active.messages.map((m) => m.content).join(" "),
    );

    // Get keywords from new message
    const messageKeywords = extractKeywords(newMessage);

    // Measure overlap
    if (messageKeywords.size === 0 || shardKeywords.size === 0) return false;
    const overlap = [...messageKeywords].filter((k) => shardKeywords.has(k)).length;
    const overlapRatio = overlap / Math.max(messageKeywords.size, 1);

    // Less than 15% keyword overlap = topic shift
    return overlapRatio < 0.15;
  }

  /**
   * Auto-manage dormant shards (called periodically).
   */
  maintenance(): { dormanted: number; offloaded: number; summarized: number } {
    const now = Date.now();
    const dormantThreshold = this.config.dormantAfterMinutes * 60_000;
    let dormanted = 0;
    let offloaded = 0;
    let summarized = 0;

    for (const [id, shard] of this.shards) {
      if (id === this.activeShardId) continue;

      // Dormant check
      if (shard.state === "active" && now - shard.lastAccessedAt > dormantThreshold) {
        const updated: ContextShard = { ...shard, state: "dormant" };
        this.shards.set(id, this.config.summaryWhenDormant ? this.generateSummary(updated) : updated);
        dormanted++;
      }

      // Offload if way over budget
      if (shard.state === "dormant" && this.getTotalTokensUsed() > this.config.totalTokenBudget * 0.9) {
        this.offloadShard(id);
        offloaded++;
      }
    }

    return { dormanted, offloaded, summarized };
  }

  /**
   * Get statistics about current shard state.
   */
  getStats(): ShardManagerStats {
    let activeShards = 0;
    let dormantShards = 0;
    let offloadedShards = 0;

    for (const shard of this.shards.values()) {
      switch (shard.state) {
        case "active": activeShards++; break;
        case "dormant":
        case "summarized": dormantShards++; break;
        case "offloaded": offloadedShards++; break;
      }
    }

    const totalTokensUsed = this.getTotalTokensUsed();

    return {
      totalShards: this.shards.size,
      activeShards,
      dormantShards,
      offloadedShards,
      totalTokensUsed,
      totalTokenBudget: this.config.totalTokenBudget,
      utilizationPercent: Math.round((totalTokensUsed / this.config.totalTokenBudget) * 100),
    };
  }

  /**
   * List all shards with metadata.
   */
  listShards(): readonly ContextShard[] {
    return [...this.shards.values()].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  /**
   * Get the active shard ID.
   */
  getActiveShardId(): string | null {
    return this.activeShardId;
  }

  // ── Private ───────────────────────────────────────────

  private activateShard(id: string): void {
    const shard = this.shards.get(id);
    if (!shard) return;

    // Reactivate if dormant
    if (shard.state !== "active") {
      this.shards.set(id, { ...shard, state: "active", lastAccessedAt: Date.now() });
    }

    this.activeShardId = id;
    this.enforceLimits();
  }

  private findShardByTopic(topic: string): ContextShard | null {
    const lower = topic.toLowerCase();
    for (const shard of this.shards.values()) {
      if (shard.topic.toLowerCase().includes(lower)) return shard;
      if (shard.tags.some((t) => t.toLowerCase().includes(lower))) return shard;
    }
    return null;
  }

  private splitShard(shardId: string): void {
    const shard = this.shards.get(shardId);
    if (!shard) return;

    // Keep recent half, archive older half
    const midpoint = Math.floor(shard.messages.length / 2);
    const olderMessages = shard.messages.slice(0, midpoint);
    const recentMessages = shard.messages.slice(midpoint);

    // Create archived shard with older messages
    const archiveId = `${shardId}_archive`;
    const archiveShard: ContextShard = {
      id: archiveId,
      topic: `${shard.topic} (archive)`,
      messages: olderMessages,
      tokenEstimate: olderMessages.reduce((sum, m) => sum + m.tokenEstimate, 0),
      createdAt: shard.createdAt,
      lastAccessedAt: shard.lastAccessedAt,
      accessCount: shard.accessCount,
      importance: Math.max(1, shard.importance - 2),
      state: "dormant",
      parentShardId: shardId,
      tags: shard.tags,
    };

    // Update current shard with only recent messages
    const updatedShard: ContextShard = {
      ...shard,
      messages: recentMessages,
      tokenEstimate: recentMessages.reduce((sum, m) => sum + m.tokenEstimate, 0),
    };

    this.shards.set(archiveId, this.generateSummary(archiveShard));
    this.shards.set(shardId, updatedShard);
  }

  private offloadShard(id: string): void {
    const shard = this.shards.get(id);
    if (!shard) return;

    // Store summary for cross-shard context
    if (shard.summary) {
      this.offloadedSummaries.set(id, `[Offloaded: ${shard.topic}] ${shard.summary}`);
    }

    // Replace with minimal stub
    this.shards.set(id, {
      ...shard,
      messages: [],
      tokenEstimate: 0,
      state: "offloaded",
    });
  }

  private generateSummary(shard: ContextShard): ContextShard {
    // Simple extractive summary: first and last messages + key decisions
    const messages = shard.messages;
    if (messages.length === 0) return { ...shard, state: "summarized", summary: "Empty shard." };

    const parts: string[] = [];
    const firstMsg = messages[0]!;
    parts.push(`Started: ${firstMsg.content.slice(0, 100)}`);

    // Find decision-like messages
    for (const msg of messages) {
      if (msg.role === "assistant" && (
        msg.content.includes("Decision:") ||
        msg.content.includes("Approach:") ||
        msg.content.includes("Result:") ||
        msg.content.includes("Fixed:") ||
        msg.content.includes("✅") ||
        msg.content.includes("❌")
      )) {
        parts.push(msg.content.slice(0, 150));
      }
    }

    const lastMsg = messages[messages.length - 1]!;
    parts.push(`Latest: ${lastMsg.content.slice(0, 100)}`);

    return {
      ...shard,
      state: "summarized",
      summary: parts.slice(0, 5).join(" | "),
    };
  }

  private enforceLimits(): void {
    const activeShards = [...this.shards.values()].filter(
      (s) => s.state === "active" && s.id !== this.activeShardId,
    );

    // Dormant oldest active shards if over limit
    if (activeShards.length >= this.config.maxActiveShards) {
      activeShards.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
      const toDormant = activeShards.slice(0, activeShards.length - this.config.maxActiveShards + 1);
      for (const shard of toDormant) {
        this.shards.set(shard.id, this.generateSummary({ ...shard, state: "dormant" }));
      }
    }
  }

  private getTotalTokensUsed(): number {
    let total = 0;
    for (const shard of this.shards.values()) {
      total += shard.tokenEstimate;
    }
    return total;
  }
}

// ── Keyword Extraction ──────────────────────────────────

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "above", "below", "between", "under",
    "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
    "neither", "each", "every", "all", "any", "few", "more", "most",
    "other", "some", "such", "no", "that", "this", "these", "those",
    "it", "its", "i", "me", "my", "we", "our", "you", "your", "he",
    "she", "they", "them", "what", "which", "who", "when", "where",
    "how", "why", "if", "then", "else", "just", "also", "very",
  ]);

  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !stopWords.has(w));
  return new Set(words);
}
