/**
 * Context Fencing — prevents recursive memory pollution.
 *
 * Inspired by SuperMemory's context fencing pattern. When the memory system
 * retrieves memories and injects them into the LLM context, those recalled
 * memories must NOT be re-captured as new observations. Without fencing,
 * the auto-capture system creates feedback loops where recalled memories
 * get stored again as "new" observations, duplicating endlessly.
 *
 * The fence works by:
 * 1. Tagging content that was injected from memory recall
 * 2. Filtering tagged content from auto-capture ingestion
 * 3. Tracking which memory IDs were used in each turn
 *
 * This is critical for any system that both reads and writes to memory
 * in the same conversation turn.
 */

// ── Types ──────────────────────────────────────────────────

export interface FencedContent {
  readonly id: string;
  readonly content: string;
  readonly sourceMemoryIds: readonly string[];
  readonly fencedAt: number;
  readonly sessionId: string;
}

export interface FenceStats {
  readonly totalFenced: number;
  readonly totalBlocked: number;
  readonly activeFences: number;
  readonly oldestFenceAge: number;
}

// ── Context Fence ──────────────────────────────────────────

export class ContextFence {
  /** Content fingerprints that are currently fenced (should not be re-captured). */
  private readonly fencedFingerprints: Map<string, FencedContent> = new Map();
  /** Counter of blocked re-capture attempts. */
  private blockedCount = 0;
  /** Maximum age for fenced content before auto-expiry (default: 1 hour). */
  private readonly maxFenceAgeMs: number;

  constructor(maxFenceAgeMs: number = 60 * 60 * 1000) {
    this.maxFenceAgeMs = maxFenceAgeMs;
  }

  /**
   * Fence content that was recalled from memory.
   * Call this BEFORE injecting recalled memories into the LLM context.
   * The fenced content will be blocked from auto-capture.
   */
  fenceRecalledContent(
    content: string,
    sourceMemoryIds: readonly string[],
    sessionId: string,
  ): string {
    const fingerprint = this.computeFingerprint(content);
    const fenced: FencedContent = {
      id: fingerprint,
      content: content.slice(0, 500), // Store truncated for debugging
      sourceMemoryIds,
      fencedAt: Date.now(),
      sessionId,
    };
    this.fencedFingerprints.set(fingerprint, fenced);
    return fingerprint;
  }

  /**
   * Check if content should be blocked from auto-capture.
   * Returns true if the content matches a fenced fingerprint.
   */
  shouldBlock(content: string): boolean {
    this.pruneExpired();
    const fingerprint = this.computeFingerprint(content);
    if (this.fencedFingerprints.has(fingerprint)) {
      this.blockedCount++;
      return true;
    }

    // Also check for substantial overlap with fenced content
    // (catches partial matches from truncated or reformatted recalls)
    for (const fenced of this.fencedFingerprints.values()) {
      if (this.hasSubstantialOverlap(content, fenced.content)) {
        this.blockedCount++;
        return true;
      }
    }

    return false;
  }

  /**
   * Fence an entire batch of recalled memories at once.
   * More efficient than fencing individually.
   */
  fenceBatch(
    items: readonly { content: string; memoryIds: readonly string[] }[],
    sessionId: string,
  ): readonly string[] {
    return items.map((item) =>
      this.fenceRecalledContent(item.content, item.memoryIds, sessionId),
    );
  }

  /**
   * Remove all fences for a session (e.g., on session end).
   */
  clearSession(sessionId: string): number {
    let cleared = 0;
    for (const [key, fenced] of this.fencedFingerprints) {
      if (fenced.sessionId === sessionId) {
        this.fencedFingerprints.delete(key);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Get fence statistics.
   */
  getStats(): FenceStats {
    this.pruneExpired();
    const now = Date.now();
    let oldest = 0;
    for (const fenced of this.fencedFingerprints.values()) {
      const age = now - fenced.fencedAt;
      if (age > oldest) oldest = age;
    }
    return {
      totalFenced: this.fencedFingerprints.size + this.blockedCount,
      totalBlocked: this.blockedCount,
      activeFences: this.fencedFingerprints.size,
      oldestFenceAge: oldest,
    };
  }

  /**
   * Reset all fences and counters.
   */
  reset(): void {
    this.fencedFingerprints.clear();
    this.blockedCount = 0;
  }

  // ── Private ──────────────────────────────────────────────

  /**
   * Compute a fingerprint for content using a fast hash.
   * Uses normalized lowercase with whitespace collapsed.
   */
  private computeFingerprint(content: string): string {
    const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
    // DJB2 hash for speed
    let hash = 5381;
    for (let i = 0; i < Math.min(normalized.length, 1000); i++) {
      hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
    }
    return `fence_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Check if two content strings have substantial overlap (>60% shared trigrams).
   */
  private hasSubstantialOverlap(a: string, b: string): boolean {
    const trigramsA = this.extractTrigrams(a.slice(0, 500));
    const trigramsB = this.extractTrigrams(b.slice(0, 500));
    if (trigramsA.size === 0 || trigramsB.size === 0) return false;

    let overlap = 0;
    for (const tri of trigramsA) {
      if (trigramsB.has(tri)) overlap++;
    }

    const overlapRatio = overlap / Math.min(trigramsA.size, trigramsB.size);
    return overlapRatio > 0.6;
  }

  /**
   * Extract character trigrams from text.
   */
  private extractTrigrams(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    const trigrams = new Set<string>();
    for (let i = 0; i <= normalized.length - 3; i++) {
      trigrams.add(normalized.slice(i, i + 3));
    }
    return trigrams;
  }

  /**
   * Remove expired fences.
   */
  private pruneExpired(): void {
    const cutoff = Date.now() - this.maxFenceAgeMs;
    for (const [key, fenced] of this.fencedFingerprints) {
      if (fenced.fencedAt < cutoff) {
        this.fencedFingerprints.delete(key);
      }
    }
  }
}
