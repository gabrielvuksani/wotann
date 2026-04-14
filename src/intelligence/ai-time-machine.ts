/**
 * AI Time Machine -- fork conversation at any point, explore "what if" scenarios.
 * Like git branches but for conversations.
 * "What if I had asked differently?" or "What if it used a different approach?"
 *
 * Builds on ConversationBranchManager but adds timeline semantics:
 * - Named fork points with annotations
 * - Alternate timeline exploration with different prompts
 * - Side-by-side timeline comparison with quality scoring
 * - Cherry-pick merge of best parts from different timelines
 * - Tree visualization of the full timeline graph
 */

import { randomUUID } from "node:crypto";
import type { AgentMessage } from "../core/types.js";

// -- Types -------------------------------------------------------------------

export interface ForkPoint {
  readonly id: string;
  readonly conversationId: string;
  readonly messageIndex: number;
  readonly label: string;
  readonly createdAt: number;
  readonly snapshotMessages: readonly AgentMessage[];
}

export interface Timeline {
  readonly id: string;
  readonly forkPointId: string;
  readonly label: string;
  readonly newPrompt: string;
  readonly messages: readonly AgentMessage[];
  readonly createdAt: number;
  readonly status: "pending" | "exploring" | "complete" | "abandoned";
  readonly qualityScore: number | null;
}

export interface TimelineComparison {
  readonly timelineIds: readonly string[];
  readonly sharedPrefixLength: number;
  readonly divergenceDescriptions: readonly string[];
  readonly qualityRankings: readonly TimelineRanking[];
}

export interface TimelineRanking {
  readonly timelineId: string;
  readonly qualityScore: number;
  readonly messageCount: number;
  readonly label: string;
}

export interface MergeResult {
  readonly success: boolean;
  readonly mergedMessageCount: number;
  readonly sourceTimelines: readonly string[];
  readonly targetConversationId: string;
  readonly mergedMessages: readonly AgentMessage[];
}

export interface TimelineTreeNode {
  readonly id: string;
  readonly label: string;
  readonly type: "fork-point" | "timeline";
  readonly children: readonly TimelineTreeNode[];
  readonly messageCount: number;
}

export interface TimelineTree {
  readonly conversationId: string;
  readonly root: TimelineTreeNode;
  readonly totalForkPoints: number;
  readonly totalTimelines: number;
}

// -- Conversation store (in-memory) ------------------------------------------

interface ConversationRecord {
  readonly id: string;
  readonly messages: readonly AgentMessage[];
}

// -- Implementation ----------------------------------------------------------

export class AITimeMachine {
  private readonly forkPoints: Map<string, ForkPoint> = new Map();
  private readonly timelines: Map<string, Timeline> = new Map();
  private readonly conversations: Map<string, ConversationRecord> = new Map();

  /**
   * Register a conversation for time-travel operations.
   */
  registerConversation(id: string, messages: readonly AgentMessage[]): void {
    this.conversations.set(id, { id, messages });
  }

  /**
   * Create a fork point at a specific message index.
   */
  createForkPoint(conversationId: string, messageIndex: number, label?: string): ForkPoint {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    if (messageIndex < 0 || messageIndex >= conversation.messages.length) {
      throw new Error(
        `Message index ${messageIndex} out of range (0-${conversation.messages.length - 1})`,
      );
    }

    const snapshot = conversation.messages.slice(0, messageIndex + 1);
    const forkPoint: ForkPoint = {
      id: `fp_${randomUUID().slice(0, 8)}`,
      conversationId,
      messageIndex,
      label: label ?? `Fork at message ${messageIndex}`,
      createdAt: Date.now(),
      snapshotMessages: snapshot,
    };

    this.forkPoints.set(forkPoint.id, forkPoint);
    return forkPoint;
  }

  /**
   * Start an alternate timeline from a fork point with a new prompt.
   */
  startAlternateTimeline(forkId: string, newPrompt: string, label?: string): Timeline {
    const forkPoint = this.forkPoints.get(forkId);
    if (!forkPoint) {
      throw new Error(`Fork point ${forkId} not found`);
    }

    const userMessage: AgentMessage = {
      role: "user",
      content: newPrompt,
    };

    const timeline: Timeline = {
      id: `tl_${randomUUID().slice(0, 8)}`,
      forkPointId: forkId,
      label: label ?? `Timeline from ${forkPoint.label}`,
      newPrompt,
      messages: [...forkPoint.snapshotMessages, userMessage],
      createdAt: Date.now(),
      status: "pending",
      qualityScore: null,
    };

    this.timelines.set(timeline.id, timeline);
    return timeline;
  }

  /**
   * Append a message to an existing timeline.
   */
  appendToTimeline(timelineId: string, message: AgentMessage): Timeline {
    const timeline = this.timelines.get(timelineId);
    if (!timeline) {
      throw new Error(`Timeline ${timelineId} not found`);
    }

    const updated: Timeline = {
      ...timeline,
      messages: [...timeline.messages, message],
      status: "exploring",
    };
    this.timelines.set(timelineId, updated);
    return updated;
  }

  /**
   * Mark a timeline as complete with an optional quality score.
   */
  completeTimeline(timelineId: string, qualityScore?: number): Timeline {
    const timeline = this.timelines.get(timelineId);
    if (!timeline) {
      throw new Error(`Timeline ${timelineId} not found`);
    }

    const updated: Timeline = {
      ...timeline,
      status: "complete",
      qualityScore: qualityScore ?? null,
    };
    this.timelines.set(timelineId, updated);
    return updated;
  }

  /**
   * Compare multiple timelines side-by-side.
   */
  compareTimelines(timelineIds: readonly string[]): TimelineComparison {
    const resolved = timelineIds.map((id) => {
      const tl = this.timelines.get(id);
      if (!tl) throw new Error(`Timeline ${id} not found`);
      return tl;
    });

    // Find shared prefix length (messages in common before divergence)
    let sharedPrefix = 0;
    if (resolved.length >= 2) {
      const first = resolved[0]!;
      outer: for (let i = 0; i < first.messages.length; i++) {
        for (const tl of resolved.slice(1)) {
          if (
            i >= tl.messages.length ||
            tl.messages[i]?.content !== first.messages[i]?.content
          ) {
            break outer;
          }
        }
        sharedPrefix++;
      }
    }

    const divergenceDescriptions = resolved.map((tl) => {
      const divergent = tl.messages.slice(sharedPrefix);
      const firstDivergent = divergent[0];
      return `${tl.label}: diverges with "${firstDivergent?.content.slice(0, 80) ?? "(empty)"}"`;
    });

    const qualityRankings: TimelineRanking[] = resolved
      .map((tl) => ({
        timelineId: tl.id,
        qualityScore: tl.qualityScore ?? 0,
        messageCount: tl.messages.length,
        label: tl.label,
      }))
      .sort((a, b) => b.qualityScore - a.qualityScore);

    return {
      timelineIds,
      sharedPrefixLength: sharedPrefix,
      divergenceDescriptions,
      qualityRankings,
    };
  }

  /**
   * Merge the best parts (divergent messages) from source timelines into a target.
   */
  mergeBestParts(
    sourceTimelines: readonly string[],
    targetConversationId: string,
  ): MergeResult {
    const conversation = this.conversations.get(targetConversationId);
    if (!conversation) {
      return { success: false, mergedMessageCount: 0, sourceTimelines, targetConversationId, mergedMessages: [] };
    }

    const sources = sourceTimelines
      .map((id) => this.timelines.get(id))
      .filter((tl): tl is Timeline => tl !== undefined);

    if (sources.length === 0) {
      return { success: false, mergedMessageCount: 0, sourceTimelines, targetConversationId, mergedMessages: [] };
    }

    // Collect divergent assistant messages from each timeline, sorted by quality
    const ranked = [...sources].sort(
      (a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0),
    );

    const mergedMessages: AgentMessage[] = [...conversation.messages];
    let addedCount = 0;

    for (const tl of ranked) {
      const forkPoint = this.forkPoints.get(tl.forkPointId);
      const prefixLen = forkPoint?.snapshotMessages.length ?? 0;
      const divergent = tl.messages.slice(prefixLen);

      for (const msg of divergent) {
        if (msg.role === "assistant") {
          mergedMessages.push(msg);
          addedCount++;
        }
      }
    }

    this.conversations.set(targetConversationId, {
      ...conversation,
      messages: mergedMessages,
    });

    return {
      success: true,
      mergedMessageCount: addedCount,
      sourceTimelines,
      targetConversationId,
      mergedMessages,
    };
  }

  /**
   * Build a tree visualization of all fork points and timelines for a conversation.
   */
  getTimelineTree(conversationId: string): TimelineTree {
    const forkPointsForConversation = [...this.forkPoints.values()].filter(
      (fp) => fp.conversationId === conversationId,
    );

    const children: TimelineTreeNode[] = forkPointsForConversation.map((fp) => {
      const timelinesForFork = [...this.timelines.values()].filter(
        (tl) => tl.forkPointId === fp.id,
      );

      const timelineChildren: TimelineTreeNode[] = timelinesForFork.map((tl) => ({
        id: tl.id,
        label: tl.label,
        type: "timeline" as const,
        children: [],
        messageCount: tl.messages.length,
      }));

      return {
        id: fp.id,
        label: fp.label,
        type: "fork-point" as const,
        children: timelineChildren,
        messageCount: fp.snapshotMessages.length,
      };
    });

    return {
      conversationId,
      root: {
        id: conversationId,
        label: "main",
        type: "fork-point",
        children,
        messageCount: this.conversations.get(conversationId)?.messages.length ?? 0,
      },
      totalForkPoints: forkPointsForConversation.length,
      totalTimelines: children.reduce((sum, c) => sum + c.children.length, 0),
    };
  }

  /** Get a timeline by ID */
  getTimeline(id: string): Timeline | null {
    return this.timelines.get(id) ?? null;
  }

  /** Get a fork point by ID */
  getForkPoint(id: string): ForkPoint | null {
    return this.forkPoints.get(id) ?? null;
  }
}
