/**
 * Automatic cross-domain linking (MemPalace "tunnels").
 *
 * A tunnel connects topics that appear in 2+ domains, enabling
 * "what did everyone say about X?" queries across all wings.
 */

import { randomUUID } from "node:crypto";

// ── Interfaces ───────────────────────────────────────────────

export interface Tunnel {
  readonly id: string;
  readonly topic: string;
  readonly domains: readonly string[];
  readonly entryIds: readonly string[];
  readonly strength: number; // 0-1, based on entry count across domains
  readonly detectedAt: number;
}

export interface CrossDomainResult {
  readonly topic: string;
  readonly domainResults: readonly {
    readonly domain: string;
    readonly entries: readonly { readonly id: string; readonly key: string; readonly value: string }[];
  }[];
  readonly totalEntries: number;
}

export interface TunnelStoreAdapter {
  search(
    query: string,
    limit: number,
  ): readonly {
    entry: {
      id: string;
      key: string;
      value: string;
      domain?: string;
      topic?: string;
      blockType: string;
    };
  }[];
  getDomains(): readonly string[];
  getTopics(domain?: string): readonly string[];
  searchPartitioned(
    query: string,
    options: { domain?: string; topic?: string; limit?: number },
  ): readonly {
    entry: {
      id: string;
      key: string;
      value: string;
      domain?: string;
      topic?: string;
    };
  }[];
}

// ── TunnelStore (in-memory cache) ────────────────────────────

export class TunnelStore {
  private readonly tunnelsByTopic: ReadonlyMap<string, Tunnel>;
  private readonly tunnelsByDomain: ReadonlyMap<string, readonly Tunnel[]>;
  private readonly allTunnels: readonly Tunnel[];

  constructor(tunnels: readonly Tunnel[] = []) {
    const byTopic = new Map<string, Tunnel>();
    const byDomain = new Map<string, Tunnel[]>();

    for (const tunnel of tunnels) {
      byTopic.set(tunnel.topic, tunnel);
      for (const domain of tunnel.domains) {
        const existing = byDomain.get(domain) ?? [];
        byDomain.set(domain, [...existing, tunnel]);
      }
    }

    this.tunnelsByTopic = byTopic;
    this.tunnelsByDomain = byDomain;
    this.allTunnels = tunnels;
  }

  getByTopic(topic: string): Tunnel | undefined {
    return this.tunnelsByTopic.get(topic);
  }

  getByDomain(domain: string): readonly Tunnel[] {
    return this.tunnelsByDomain.get(domain) ?? [];
  }

  getAll(): readonly Tunnel[] {
    return this.allTunnels;
  }
}

// ── TunnelDetector ───────────────────────────────────────────

export class TunnelDetector {
  private cache: TunnelStore = new TunnelStore();

  /**
   * Scan all domains/topics to find topics that span 2+ domains.
   * Creates a Tunnel for each cross-domain topic with a strength
   * score of (domains containing topic) / (total domains).
   */
  detect(store: TunnelStoreAdapter): readonly Tunnel[] {
    const domains = store.getDomains();
    if (domains.length < 2) {
      this.cache = new TunnelStore();
      return [];
    }

    // Map: topic -> set of domains that contain it
    const topicDomains = new Map<string, Set<string>>();
    for (const domain of domains) {
      const topics = store.getTopics(domain);
      for (const topic of topics) {
        const existing = topicDomains.get(topic) ?? new Set<string>();
        existing.add(domain);
        topicDomains.set(topic, existing);
      }
    }

    const totalDomains = domains.length;
    const now = Date.now();
    const tunnels: Tunnel[] = [];

    for (const [topic, domainSet] of topicDomains) {
      if (domainSet.size < 2) continue;

      // Collect entry IDs from all domains that have this topic
      const entryIds: string[] = [];
      const tunnelDomains = [...domainSet];

      for (const domain of tunnelDomains) {
        const results = store.searchPartitioned(topic, { domain, topic, limit: 100 });
        for (const result of results) {
          entryIds.push(result.entry.id);
        }
      }

      tunnels.push({
        id: randomUUID(),
        topic,
        domains: tunnelDomains,
        entryIds,
        strength: domainSet.size / totalDomains,
        detectedAt: now,
      });
    }

    this.cache = new TunnelStore(tunnels);
    return tunnels;
  }

  /**
   * "What did everyone say about X?" — query a topic across all domains.
   */
  queryAcrossDomains(store: TunnelStoreAdapter, topic: string): CrossDomainResult {
    const domains = store.getDomains();
    const domainResults: { domain: string; entries: { id: string; key: string; value: string }[] }[] = [];
    let totalEntries = 0;

    for (const domain of domains) {
      const results = store.searchPartitioned(topic, { domain, topic, limit: 50 });
      if (results.length === 0) continue;

      const entries = results.map((r) => ({
        id: r.entry.id,
        key: r.entry.key,
        value: r.entry.value,
      }));

      totalEntries += entries.length;
      domainResults.push({ domain, entries });
    }

    return { topic, domainResults, totalEntries };
  }

  /**
   * Get tunnels sorted by strength (descending).
   */
  getStrongestTunnels(limit: number = 10): readonly Tunnel[] {
    const all = this.cache.getAll();
    const sorted = [...all].sort((a, b) => b.strength - a.strength);
    return sorted.slice(0, limit);
  }

  /** Access the underlying cache for direct lookups. */
  getCache(): TunnelStore {
    return this.cache;
  }
}
