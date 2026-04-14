/**
 * Context Virtualization — make small context windows feel larger.
 *
 * When a conversation exceeds the model's context limit, this module
 * transparently splits it into an active window and archived segments.
 * Relevant archived segments can be pulled back on demand via semantic
 * or keyword matching against a query.
 *
 * Strategies:
 * - topic-aware-shard: group by topic, keep current topic active
 * - recency-weighted: keep most recent messages, archive older ones
 * - importance-ranked: keep system + high-priority messages, archive the rest
 *
 * Works with any provider context size — the manager is provider-agnostic.
 */

// ── Types ────────────────────────────────────────────────────

export interface ActiveContext {
  readonly messages: readonly VCMessage[];
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly usagePercent: number;
}

export interface ArchivedSegment {
  readonly id: string;
  readonly messages: readonly VCMessage[];
  readonly tokenCount: number;
  readonly summary: string;
  readonly topics: readonly string[];
  readonly createdAt: number;
  readonly relevanceScore: number;
}

export interface VCMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly tokenEstimate: number;
  readonly timestamp: number;
  readonly topic?: string;
  readonly importance?: number;
}

export type VirtualizationStrategy =
  | "topic-aware-shard"
  | "recency-weighted"
  | "importance-ranked";

export interface VirtualizationConfig {
  readonly maxTokens: number;
  readonly strategy: VirtualizationStrategy;
  readonly shardSize: number;
  readonly overlapMessages: number;
  readonly reservePercent: number;
}

export interface RetrievalResult {
  readonly segments: readonly ArchivedSegment[];
  readonly totalTokensRetrieved: number;
  readonly query: string;
}

// ── Default Configuration ────────────────────────────────────

const DEFAULT_CONFIG: VirtualizationConfig = {
  maxTokens: 128_000,
  strategy: "recency-weighted",
  shardSize: 8,
  overlapMessages: 1,
  reservePercent: 0.1,
};

// ── Virtual Context Manager ──────────────────────────────────

export class VirtualContextManager {
  private readonly config: VirtualizationConfig;
  private archived: ArchivedSegment[] = [];
  private nextSegmentId = 0;

  constructor(config?: Partial<VirtualizationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Split a conversation into active + archived segments.
   * Messages that fit within maxTokens (minus reserve) stay active.
   * The rest are sharded and archived for later retrieval.
   */
  virtualizeConversation(
    messages: readonly VCMessage[],
    maxTokens?: number,
  ): { readonly active: ActiveContext; readonly newArchived: readonly ArchivedSegment[] } {
    const limit = maxTokens ?? this.config.maxTokens;
    const usableTokens = Math.floor(limit * (1 - this.config.reservePercent));

    if (messages.length === 0) {
      return {
        active: { messages: [], totalTokens: 0, maxTokens: limit, usagePercent: 0 },
        newArchived: [],
      };
    }

    const totalTokens = sumTokens(messages);

    // Everything fits — no archiving needed
    if (totalTokens <= usableTokens) {
      return {
        active: {
          messages,
          totalTokens,
          maxTokens: limit,
          usagePercent: totalTokens / limit,
        },
        newArchived: [],
      };
    }

    // Partition into keepers and overflow based on the strategy
    const { active, overflow } = this.partitionByStrategy(messages, usableTokens);
    const newArchived = this.shardMessages(overflow);
    this.archived = [...this.archived, ...newArchived];

    const activeTokens = sumTokens(active);
    return {
      active: {
        messages: active,
        totalTokens: activeTokens,
        maxTokens: limit,
        usagePercent: activeTokens / limit,
      },
      newArchived,
    };
  }

  /**
   * Retrieve archived segments relevant to a query.
   * Scores each segment by keyword overlap with the query.
   */
  retrieveRelevantContext(
    query: string,
    maxTokens?: number,
  ): RetrievalResult {
    if (this.archived.length === 0 || query.trim().length === 0) {
      return { segments: [], totalTokensRetrieved: 0, query };
    }

    const budget = maxTokens ?? Math.floor(this.config.maxTokens * 0.3);
    const queryTerms = extractTerms(query);

    // Score each segment against the query
    const scored = this.archived.map((segment) => {
      const segmentText = segment.messages.map((m) => m.content).join(" ");
      const segmentTerms = extractTerms(segmentText);
      const topicTerms = segment.topics.flatMap((t) => extractTerms(t));
      const allSegmentTerms = new Set([...segmentTerms, ...topicTerms]);

      let matchCount = 0;
      for (const term of queryTerms) {
        if (allSegmentTerms.has(term)) matchCount++;
      }

      const relevanceScore = queryTerms.length > 0 ? matchCount / queryTerms.length : 0;
      return { ...segment, relevanceScore };
    });

    // Sort by relevance, then pick greedily within budget
    const sorted = [...scored].sort((a, b) => b.relevanceScore - a.relevanceScore);
    const selected: ArchivedSegment[] = [];
    let totalRetrieved = 0;

    for (const segment of sorted) {
      if (segment.relevanceScore <= 0) break;
      if (totalRetrieved + segment.tokenCount > budget) continue;
      selected.push(segment);
      totalRetrieved += segment.tokenCount;
    }

    return {
      segments: selected,
      totalTokensRetrieved: totalRetrieved,
      query,
    };
  }

  /**
   * Get all currently archived segments.
   */
  getArchived(): readonly ArchivedSegment[] {
    return this.archived;
  }

  /**
   * Clear all archived segments.
   */
  clearArchived(): void {
    this.archived = [];
  }

  /**
   * Get the current configuration.
   */
  getConfig(): VirtualizationConfig {
    return this.config;
  }

  // ── Private Helpers ──────────────────────────────────────

  private partitionByStrategy(
    messages: readonly VCMessage[],
    usableTokens: number,
  ): { readonly active: readonly VCMessage[]; readonly overflow: readonly VCMessage[] } {
    switch (this.config.strategy) {
      case "recency-weighted":
        return this.partitionByRecency(messages, usableTokens);
      case "topic-aware-shard":
        return this.partitionByTopic(messages, usableTokens);
      case "importance-ranked":
        return this.partitionByImportance(messages, usableTokens);
    }
  }

  private partitionByRecency(
    messages: readonly VCMessage[],
    usableTokens: number,
  ): { readonly active: readonly VCMessage[]; readonly overflow: readonly VCMessage[] } {
    // Keep system messages always, then fill from the end (most recent)
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    let budget = usableTokens - sumTokens(systemMessages);
    const active: VCMessage[] = [];
    const overflow: VCMessage[] = [];

    // Walk backwards through non-system messages
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msg = nonSystem[i]!;
      if (budget >= msg.tokenEstimate) {
        active.unshift(msg);
        budget -= msg.tokenEstimate;
      } else {
        overflow.unshift(msg);
      }
    }

    // Prepend remaining overflow from the ones we skipped
    const remaining = nonSystem.filter(
      (m) => !active.includes(m) && !overflow.includes(m),
    );

    return {
      active: [...systemMessages, ...active],
      overflow: [...remaining, ...overflow],
    };
  }

  private partitionByTopic(
    messages: readonly VCMessage[],
    usableTokens: number,
  ): { readonly active: readonly VCMessage[]; readonly overflow: readonly VCMessage[] } {
    // Identify the current topic from the last few messages
    const recentMessages = messages.slice(-5);
    const currentTopics = new Set(
      recentMessages.map((m) => m.topic).filter((t): t is string => t !== undefined),
    );

    // Score: system=always, current-topic=high, recent=medium, other=low
    const scored = messages.map((m, idx) => {
      let priority = 0;
      if (m.role === "system") priority = 100;
      else if (m.topic && currentTopics.has(m.topic)) priority = 50;
      else priority = idx / messages.length * 10;
      return { message: m, priority };
    });

    const sorted = [...scored].sort((a, b) => b.priority - a.priority);

    let budget = usableTokens;
    const activeSet = new Set<VCMessage>();

    for (const item of sorted) {
      if (budget >= item.message.tokenEstimate) {
        activeSet.add(item.message);
        budget -= item.message.tokenEstimate;
      }
    }

    // Preserve original ordering
    const active = messages.filter((m) => activeSet.has(m));
    const overflow = messages.filter((m) => !activeSet.has(m));

    return { active, overflow };
  }

  private partitionByImportance(
    messages: readonly VCMessage[],
    usableTokens: number,
  ): { readonly active: readonly VCMessage[]; readonly overflow: readonly VCMessage[] } {
    const scored = messages.map((m, idx) => {
      const rolePriority = m.role === "system" ? 100 : m.role === "user" ? 50 : 25;
      const importance = m.importance ?? 0;
      const recency = idx / messages.length * 10;
      return { message: m, score: rolePriority + importance + recency };
    });

    const sorted = [...scored].sort((a, b) => b.score - a.score);

    let budget = usableTokens;
    const activeSet = new Set<VCMessage>();

    for (const item of sorted) {
      if (budget >= item.message.tokenEstimate) {
        activeSet.add(item.message);
        budget -= item.message.tokenEstimate;
      }
    }

    const active = messages.filter((m) => activeSet.has(m));
    const overflow = messages.filter((m) => !activeSet.has(m));

    return { active, overflow };
  }

  private shardMessages(
    messages: readonly VCMessage[],
  ): readonly ArchivedSegment[] {
    if (messages.length === 0) return [];

    const shards: ArchivedSegment[] = [];
    const now = Date.now();

    for (let i = 0; i < messages.length; i += this.config.shardSize) {
      const chunk = messages.slice(i, i + this.config.shardSize);
      const tokenCount = sumTokens(chunk);
      const topics = [
        ...new Set(
          chunk.map((m) => m.topic).filter((t): t is string => t !== undefined),
        ),
      ];

      shards.push({
        id: `segment-${this.nextSegmentId++}`,
        messages: chunk,
        tokenCount,
        summary: buildSummary(chunk, topics),
        topics,
        createdAt: now,
        relevanceScore: 0,
      });
    }

    return shards;
  }
}

// ── Module-Level Helpers ─────────────────────────────────────

function sumTokens(messages: readonly VCMessage[]): number {
  return messages.reduce((sum, m) => sum + m.tokenEstimate, 0);
}

function extractTerms(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function buildSummary(
  messages: readonly VCMessage[],
  topics: readonly string[],
): string {
  const roleBreakdown = messages.reduce<Record<string, number>>((acc, m) => {
    return { ...acc, [m.role]: (acc[m.role] ?? 0) + 1 };
  }, {});

  const parts: string[] = [];
  if (topics.length > 0) parts.push(`Topics: ${topics.join(", ")}`);

  const roleParts = Object.entries(roleBreakdown)
    .map(([role, count]) => `${count} ${role}`)
    .join(", ");
  parts.push(`${messages.length} messages (${roleParts})`);

  return parts.join(". ");
}
