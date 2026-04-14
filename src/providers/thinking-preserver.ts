/**
 * Thinking Block Preservation — preserves Claude thinking blocks
 * across format translations instead of flattening to text.
 *
 * When translating Anthropic → OpenAI format, thinking blocks are
 * stored separately and re-attached when translating back.
 * This prevents loss of reasoning chains during provider fallback.
 *
 * From Hermes v0.7.0 thinking block preservation pattern.
 */

export interface ThinkingBlock {
  readonly turnIndex: number;
  readonly content: string;
  readonly model: string;
  readonly timestamp: number;
}

export interface ThinkingBlockStore {
  readonly blocks: readonly ThinkingBlock[];
  readonly totalTokensEstimate: number;
}

/**
 * Stores thinking blocks separately from message content.
 * Keyed by session ID for multi-session support.
 */
export class ThinkingPreserver {
  private readonly stores: Map<string, ThinkingBlock[]> = new Map();
  private readonly maxBlocksPerSession = 50;

  /**
   * Extract and store thinking blocks from Anthropic content blocks.
   * Returns content blocks with thinking removed (for OpenAI translation).
   */
  extractAndStore(
    sessionId: string,
    turnIndex: number,
    contentBlocks: readonly { type: string; thinking?: string; text?: string }[],
    model: string,
  ): readonly { type: string; text?: string }[] {
    const preserved: { type: string; text?: string }[] = [];

    for (const block of contentBlocks) {
      if (block.type === "thinking" && block.thinking) {
        this.storeBlock(sessionId, {
          turnIndex,
          content: block.thinking,
          model,
          timestamp: Date.now(),
        });
        // Don't include thinking in the translated output
        continue;
      }
      preserved.push(block);
    }

    return preserved;
  }

  /**
   * Re-attach thinking blocks when translating back to Anthropic format.
   * Inserts thinking blocks before the text content for the matching turn.
   */
  reattach(
    sessionId: string,
    turnIndex: number,
    contentBlocks: readonly { type: string; text?: string }[],
  ): readonly { type: string; thinking?: string; text?: string }[] {
    const blocks = this.getBlocks(sessionId, turnIndex);
    if (blocks.length === 0) return contentBlocks;

    const result: { type: string; thinking?: string; text?: string }[] = [];

    // Insert thinking blocks first
    for (const block of blocks) {
      result.push({ type: "thinking", thinking: block.content });
    }

    // Then the rest of the content
    result.push(...contentBlocks);

    return result;
  }

  /**
   * Get all stored thinking blocks for a session/turn.
   */
  getBlocks(sessionId: string, turnIndex?: number): readonly ThinkingBlock[] {
    const store = this.stores.get(sessionId) ?? [];
    if (turnIndex !== undefined) {
      return store.filter((b) => b.turnIndex === turnIndex);
    }
    return store;
  }

  /**
   * Get the complete thinking chain for a session (all turns).
   */
  getThinkingChain(sessionId: string): string {
    const blocks = this.stores.get(sessionId) ?? [];
    return blocks
      .sort((a, b) => a.turnIndex - b.turnIndex)
      .map((b) => `[Turn ${b.turnIndex}] ${b.content}`)
      .join("\n\n");
  }

  /**
   * Estimate token count for stored thinking blocks.
   */
  estimateTokens(sessionId: string): number {
    const blocks = this.stores.get(sessionId) ?? [];
    // Rough estimate: 4 chars per token
    return blocks.reduce((sum, b) => sum + Math.ceil(b.content.length / 4), 0);
  }

  /**
   * Clear thinking blocks for a session (on session end or compaction).
   */
  clear(sessionId: string): void {
    this.stores.delete(sessionId);
  }

  /**
   * Clear all stored blocks.
   */
  clearAll(): void {
    this.stores.clear();
  }

  private storeBlock(sessionId: string, block: ThinkingBlock): void {
    let store = this.stores.get(sessionId);
    if (!store) {
      store = [];
      this.stores.set(sessionId, store);
    }
    store.push(block);

    // Evict oldest blocks if over limit
    if (store.length > this.maxBlocksPerSession) {
      store.shift();
    }
  }
}
