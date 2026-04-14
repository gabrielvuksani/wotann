/**
 * Progressive Context Loading — MemPalace L0-L3 pattern.
 *
 * Instead of loading all memory layers equally at session start,
 * this loads context progressively:
 *
 *   L0: Identity (~50 tokens)  — ALWAYS loaded
 *   L1: Critical facts (~120 tokens) — ALWAYS loaded
 *   L2: Domain recall (variable) — loaded when topic arises
 *   L3: Deep search (unlimited) — loaded on explicit query
 *
 * Wake-up cost: ~170 tokens (L0 + L1). 95%+ of context window stays free.
 * MemPalace demonstrated $10/year vs $507/year for full-context approaches.
 *
 * @see competitor-research-perplexity-mempalace-2026-04-09.md
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────

export type ContextLevel = "L0" | "L1" | "L2" | "L3";

export interface ContextPayload {
  readonly level: ContextLevel;
  readonly content: string;
  readonly tokenEstimate: number;
  readonly source: string;
}

export interface WakeUpPayload {
  readonly l0: ContextPayload;
  readonly l1: ContextPayload;
  readonly totalTokens: number;
  readonly combinedPrompt: string;
}

export interface L2RecallResult {
  readonly domain: string;
  readonly entries: readonly ContextPayload[];
  readonly totalTokens: number;
}

/** Minimal interface for the memory store methods used by ContextLoader. */
export interface ContextLoaderStoreAdapter {
  search(query: string, limit: number): readonly { entry: { key: string; value: string; domain?: string; topic?: string }; score: number }[];
  searchPartitioned?(
    query: string,
    options: { domain?: string; topic?: string; limit?: number },
  ): readonly { entry: { key: string; value: string; domain?: string; topic?: string }; score: number }[];
  getByLayer(layer: string): readonly { key: string; value: string; blockType: string; domain?: string; topic?: string; updatedAt: string }[];
}

// ── Token Estimation ───────────────────────────────────────

/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate text to fit within a token budget. */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

// ── Context Loader ─────────────────────────────────────────

export class ContextLoader {
  private readonly wotannDir: string;
  private readonly store: ContextLoaderStoreAdapter | null;
  private readonly loadedDomains: Set<string> = new Set();

  constructor(wotannDir: string, store?: ContextLoaderStoreAdapter) {
    this.wotannDir = wotannDir;
    this.store = store ?? null;
  }

  /**
   * Generate the L0 + L1 wake-up payload (~170 tokens).
   * This is loaded at every session start — minimal cost, maximum context.
   */
  generateWakeUpPayload(): WakeUpPayload {
    const l0 = this.loadL0Identity();
    const l1 = this.loadL1CriticalFacts();
    const combined = [l0.content, l1.content].filter(Boolean).join("\n\n");

    return {
      l0,
      l1,
      totalTokens: l0.tokenEstimate + l1.tokenEstimate,
      combinedPrompt: combined,
    };
  }

  /**
   * L0: Identity payload (~50 tokens).
   * Agent name, role, and core personality from SOUL.md and IDENTITY.md.
   */
  loadL0Identity(): ContextPayload {
    const parts: string[] = [];

    // Read IDENTITY.md for name and role
    const identityPath = join(this.wotannDir, "IDENTITY.md");
    if (existsSync(identityPath)) {
      const raw = readFileSync(identityPath, "utf-8");
      const nameMatch = raw.match(/^## Name\s*\n(.+)/m);
      const roleMatch = raw.match(/^## Role\s*\n(.+)/m);
      if (nameMatch?.[1]) parts.push(`I am ${nameMatch[1].trim()}.`);
      if (roleMatch?.[1]) parts.push(roleMatch[1].trim());
    }

    // Read SOUL.md first line for core personality
    const soulPath = join(this.wotannDir, "SOUL.md");
    if (existsSync(soulPath)) {
      const raw = readFileSync(soulPath, "utf-8");
      const firstParagraph = raw.split("\n\n")[0]?.trim() ?? "";
      if (firstParagraph) {
        parts.push(truncateToTokens(firstParagraph, 30));
      }
    }

    // Fallback if no identity files exist
    if (parts.length === 0) {
      parts.push("I am WOTANN, a unified AI agent harness.");
    }

    const content = parts.join(" ");
    return {
      level: "L0",
      content,
      tokenEstimate: estimateTokens(content),
      source: "identity-files",
    };
  }

  /**
   * L1: Critical facts (~120 tokens).
   * Top 10-15 most important facts from the memory store.
   * Prioritizes: active project context, user preferences, recent decisions.
   */
  loadL1CriticalFacts(): ContextPayload {
    if (!this.store) {
      return { level: "L1", content: "", tokenEstimate: 0, source: "none" };
    }

    const facts: string[] = [];
    const TOKEN_BUDGET = 120;
    let usedTokens = 0;

    // Priority 1: User preferences (blockType = "user" or "feedback")
    const userEntries = this.store.getByLayer("core_blocks")
      .filter((e) => e.blockType === "user" || e.blockType === "feedback")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);

    for (const entry of userEntries) {
      const fact = `${entry.key}: ${entry.value}`;
      const tokens = estimateTokens(fact);
      if (usedTokens + tokens > TOKEN_BUDGET) break;
      facts.push(fact);
      usedTokens += tokens;
    }

    // Priority 2: Active project context
    const projectEntries = this.store.getByLayer("core_blocks")
      .filter((e) => e.blockType === "project")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 3);

    for (const entry of projectEntries) {
      const fact = `${entry.key}: ${entry.value}`;
      const tokens = estimateTokens(fact);
      if (usedTokens + tokens > TOKEN_BUDGET) break;
      facts.push(fact);
      usedTokens += tokens;
    }

    // Priority 3: Recent decisions
    const decisionEntries = this.store.getByLayer("core_blocks")
      .filter((e) => e.blockType === "decisions")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 3);

    for (const entry of decisionEntries) {
      const fact = `Decision: ${entry.key} — ${entry.value}`;
      const tokens = estimateTokens(fact);
      if (usedTokens + tokens > TOKEN_BUDGET) break;
      facts.push(fact);
      usedTokens += tokens;
    }

    const content = facts.join("\n");
    return {
      level: "L1",
      content,
      tokenEstimate: estimateTokens(content),
      source: "memory-store",
    };
  }

  /**
   * L2: Domain recall (variable tokens).
   * Loads context for a specific domain when the topic arises.
   * Uses partitioned search for targeted retrieval.
   */
  loadL2DomainRecall(domain: string, topic?: string, maxTokens: number = 500): L2RecallResult {
    this.loadedDomains.add(domain);

    if (!this.store) {
      return { domain, entries: [], totalTokens: 0 };
    }

    const entries: ContextPayload[] = [];
    let usedTokens = 0;

    // Use partitioned search if available, otherwise fall back to regular search
    const results = this.store.searchPartitioned
      ? this.store.searchPartitioned(domain, { domain, topic, limit: 20 })
      : this.store.search(domain, 20);

    for (const result of results) {
      const content = `${result.entry.key}: ${result.entry.value}`;
      const tokens = estimateTokens(content);
      if (usedTokens + tokens > maxTokens) break;

      entries.push({
        level: "L2",
        content,
        tokenEstimate: tokens,
        source: `domain:${domain}${topic ? `/topic:${topic}` : ""}`,
      });
      usedTokens += tokens;
    }

    return { domain, entries, totalTokens: usedTokens };
  }

  /**
   * L3: Deep search (unlimited tokens).
   * Full FTS5 + vector search across the entire memory store.
   * Only triggered on explicit queries. Returns raw search results.
   */
  loadL3DeepSearch(query: string, limit: number = 20): readonly ContextPayload[] {
    if (!this.store) return [];

    const results = this.store.search(query, limit);
    return results.map((r) => ({
      level: "L3" as const,
      content: `${r.entry.key}: ${r.entry.value}`,
      tokenEstimate: estimateTokens(`${r.entry.key}: ${r.entry.value}`),
      source: `deep-search:${query.slice(0, 30)}`,
    }));
  }

  /**
   * Check if a domain has already been loaded in this session.
   * Prevents redundant L2 loads for the same domain.
   */
  isDomainLoaded(domain: string): boolean {
    return this.loadedDomains.has(domain);
  }

  /** Get all domains that have been loaded this session. */
  getLoadedDomains(): readonly string[] {
    return [...this.loadedDomains];
  }

  /** Reset loaded domains (e.g., on session reset). */
  resetLoadedDomains(): void {
    this.loadedDomains.clear();
  }
}
