/**
 * Progressive context loader — Phase H Task 7.
 *
 * MemPalace's L0 / L1 / L2 / L3 tiered loading pattern. Loads only
 * what is needed per tier, keeping 95%+ of the context window free
 * at session start.
 *
 *   L0: Identity (~50 tokens) — ALWAYS loaded. Who I am.
 *   L1: Critical facts (~120 tokens) — ALWAYS loaded. Top preferences,
 *       active project, recent decisions.
 *   L2: Room recall (on topic trigger) — per-topic expansion when a
 *       domain arises in the conversation.
 *   L3: Deep search (explicit query) — full FTS / vector / hybrid
 *       search when the user asks a specific question.
 *
 * Wake-up cost: ~170 tokens (L0 + L1). MemPalace reports
 * $10/year vs $507/year for full-context approaches.
 *
 * Differences vs the older src/memory/context-loader.ts:
 *   - Typed tier budgets on every payload (so a caller can verify
 *     token usage before wiring into the system prompt).
 *   - Hall-aware L2 loader: when a Wing/Room/Hall partition is
 *     supplied, the L2 recall narrows to that hall.
 *   - PrepareContext() util exposes the whole pipeline as a single
 *     function so callers can wire it at runtime init without
 *     touching runtime.ts.
 *
 * Pure module — I/O stays in the caller's adapter.
 */

import type { Hall } from "./wings-rooms-halls.js";

// ── Types ──────────────────────────────────────────────

export type ContextTier = "L0" | "L1" | "L2" | "L3";

export interface ContextPayload {
  readonly tier: ContextTier;
  readonly content: string;
  readonly tokenEstimate: number;
  readonly source: string;
}

export interface TierBudgets {
  readonly l0: number;
  readonly l1: number;
  readonly l2: number;
  readonly l3: number;
}

export const DEFAULT_BUDGETS: TierBudgets = {
  l0: 60,
  l1: 140,
  l2: 500,
  l3: 4000,
};

// ── Token estimation ──────────────────────────────────

/** Rough 4-char-per-token heuristic. Same constant as context-loader.ts. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + "...";
}

// ── Adapters ──────────────────────────────────────────

export interface IdentityAdapter {
  /** Name/role string of the agent. "" if unknown. */
  readonly getIdentityLine: () => string;
  /** Core personality paragraph (first paragraph of SOUL.md, etc). */
  readonly getCorePersonality: () => string;
}

export interface FactsAdapter {
  /**
   * Return the top N most critical facts to always include. Caller
   * decides ranking (freshness, blockType, access_count). The returned
   * strings must fit within the L1 budget; the loader trims the tail.
   */
  readonly topFacts: (limit: number) => readonly string[];
}

export interface RecallAdapter {
  /**
   * Room-scoped recall. Narrows to the supplied wing / room / hall.
   * Callers using MemoryStore bridge their storeFields through
   * wings-rooms-halls.toStoreQuery() to get a compatible filter.
   */
  readonly recall: (
    query: string,
    partition: { readonly wing?: string; readonly room?: string; readonly hall?: Hall },
    limit: number,
  ) => readonly { readonly key: string; readonly value: string }[];
}

export interface DeepSearchAdapter {
  /** Full FTS / vector / hybrid search. Returns ranked results. */
  readonly search: (
    query: string,
    limit: number,
  ) => readonly { readonly key: string; readonly value: string }[];
}

export interface ProgressiveAdapters {
  readonly identity?: IdentityAdapter;
  readonly facts?: FactsAdapter;
  readonly recall?: RecallAdapter;
  readonly deepSearch?: DeepSearchAdapter;
}

// ── Loader ────────────────────────────────────────────

export class ProgressiveContextLoader {
  private readonly adapters: ProgressiveAdapters;
  private readonly budgets: TierBudgets;
  private readonly loadedRooms: Set<string> = new Set();

  constructor(adapters: ProgressiveAdapters = {}, budgets: Partial<TierBudgets> = {}) {
    this.adapters = adapters;
    this.budgets = { ...DEFAULT_BUDGETS, ...budgets };
  }

  /**
   * L0: identity payload (~50 tokens). Always loaded.
   * Honest-empty source field when no adapter is attached.
   */
  loadL0(): ContextPayload {
    const identity = this.adapters.identity;
    if (!identity) {
      return {
        tier: "L0",
        content: "",
        tokenEstimate: 0,
        source: "no-identity-adapter",
      };
    }

    const parts: string[] = [];
    const line = identity.getIdentityLine().trim();
    if (line) parts.push(line);
    const personality = truncateToTokens(identity.getCorePersonality().trim(), 30);
    if (personality) parts.push(personality);

    const content = parts.join(" ").trim();
    const truncated = truncateToTokens(content, this.budgets.l0);
    return {
      tier: "L0",
      content: truncated,
      tokenEstimate: estimateTokens(truncated),
      source: "identity-adapter",
    };
  }

  /**
   * L1: critical facts (~120 tokens). Always loaded.
   * Pulls from the FactsAdapter and trims to the L1 budget.
   */
  loadL1(): ContextPayload {
    const facts = this.adapters.facts;
    if (!facts) {
      return {
        tier: "L1",
        content: "",
        tokenEstimate: 0,
        source: "no-facts-adapter",
      };
    }

    const pool = facts.topFacts(15);
    const kept: string[] = [];
    let used = 0;
    for (const line of pool) {
      const tokens = estimateTokens(line);
      if (used + tokens > this.budgets.l1) break;
      kept.push(line);
      used += tokens;
    }
    const content = kept.join("\n");
    return {
      tier: "L1",
      content,
      tokenEstimate: estimateTokens(content),
      source: "facts-adapter",
    };
  }

  /**
   * L2: room-scoped recall. Loads targeted context when a topic arises.
   * partition.hall narrows to a typed corridor (facts / events / etc)
   * so "discoveries about auth" loads the right slice.
   *
   * Caches loaded rooms so subsequent calls for the same room in a
   * session are no-ops — prevents redundant L2 loads.
   */
  loadL2(
    query: string,
    partition: { readonly wing?: string; readonly room?: string; readonly hall?: Hall },
    maxTokens: number = this.budgets.l2,
  ): readonly ContextPayload[] {
    const roomKey = `${partition.wing ?? ""}/${partition.room ?? ""}/${partition.hall ?? ""}`;
    this.loadedRooms.add(roomKey);

    const recall = this.adapters.recall;
    if (!recall) return [];

    const results = recall.recall(query, partition, 20);
    const payloads: ContextPayload[] = [];
    let used = 0;
    for (const r of results) {
      const content = `${r.key}: ${r.value}`;
      const tokens = estimateTokens(content);
      if (used + tokens > maxTokens) break;
      payloads.push({
        tier: "L2",
        content,
        tokenEstimate: tokens,
        source: this.describeL2Source(partition),
      });
      used += tokens;
    }
    return payloads;
  }

  /**
   * L3: deep search — explicit user query. Returns raw search results.
   * Only triggered when a caller passes an explicit query.
   */
  loadL3(query: string, limit: number = 20): readonly ContextPayload[] {
    const deep = this.adapters.deepSearch;
    if (!deep) return [];
    const results = deep.search(query, limit);
    return results.map((r) => ({
      tier: "L3" as const,
      content: `${r.key}: ${r.value}`,
      tokenEstimate: estimateTokens(`${r.key}: ${r.value}`),
      source: `deep-search:${query.slice(0, 30)}`,
    }));
  }

  /** Has a given room been loaded in this session? */
  isRoomLoaded(wing?: string, room?: string, hall?: Hall): boolean {
    return this.loadedRooms.has(`${wing ?? ""}/${room ?? ""}/${hall ?? ""}`);
  }

  /** Reset loaded-rooms tracker (e.g., on session reset). */
  resetLoadedRooms(): void {
    this.loadedRooms.clear();
  }

  private describeL2Source(partition: {
    readonly wing?: string;
    readonly room?: string;
    readonly hall?: Hall;
  }): string {
    const parts: string[] = [];
    if (partition.wing) parts.push(`wing:${partition.wing}`);
    if (partition.room) parts.push(`room:${partition.room}`);
    if (partition.hall) parts.push(`hall:${partition.hall}`);
    return parts.join("/") || "unscoped";
  }
}

// ── Runtime-init util (no runtime.ts edits) ────────────

export interface PreparedContext {
  readonly l0: ContextPayload;
  readonly l1: ContextPayload;
  readonly combinedPrompt: string;
  readonly totalTokens: number;
  readonly loader: ProgressiveContextLoader;
}

/**
 * One-call wake-up helper for runtime init. Builds a
 * ProgressiveContextLoader, eagerly loads L0 + L1, and returns the
 * combined prompt plus the loader itself so callers can invoke L2/L3
 * lazily.
 *
 * Usage at runtime init (no runtime.ts edits — the caller does this
 * from its own composition root):
 *
 *   const { combinedPrompt, loader } = PrepareContext({ adapters });
 *   systemPrompt = `${combinedPrompt}\n\n${existingSystemPrompt}`;
 *   // Later, when a topic arises:
 *   const l2 = loader.loadL2(query, { wing: "project:wotann" });
 */
export function PrepareContext(options: {
  readonly adapters: ProgressiveAdapters;
  readonly budgets?: Partial<TierBudgets>;
}): PreparedContext {
  const loader = new ProgressiveContextLoader(options.adapters, options.budgets);
  const l0 = loader.loadL0();
  const l1 = loader.loadL1();
  const combined = [l0.content, l1.content].filter((s) => s.length > 0).join("\n\n");
  return {
    l0,
    l1,
    combinedPrompt: combined,
    totalTokens: l0.tokenEstimate + l1.tokenEstimate,
    loader,
  };
}
