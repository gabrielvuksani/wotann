import { describe, it, expect } from "vitest";
import {
  TunnelDetector,
  TunnelStore,
  type Tunnel,
  type TunnelStoreAdapter,
  type CrossDomainResult,
} from "../../src/memory/tunnel-detector.js";

// ── Test Helpers ─────────────────────────────────────────────

type FakeEntry = {
  id: string;
  key: string;
  value: string;
  domain?: string;
  topic?: string;
  blockType: string;
};

function makeFakeStore(entries: readonly FakeEntry[]): TunnelStoreAdapter {
  return {
    search(query: string, limit: number) {
      return entries
        .filter((e) => e.value.includes(query) || e.key.includes(query))
        .slice(0, limit)
        .map((entry) => ({ entry }));
    },

    getDomains() {
      const domains = new Set<string>();
      for (const e of entries) {
        if (e.domain) domains.add(e.domain);
      }
      return [...domains].sort();
    },

    getTopics(domain?: string) {
      const topics = new Set<string>();
      for (const e of entries) {
        if (!e.topic) continue;
        if (domain && e.domain !== domain) continue;
        topics.add(e.topic);
      }
      return [...topics].sort();
    },

    searchPartitioned(query: string, options: { domain?: string; topic?: string; limit?: number }) {
      const { domain, topic, limit = 10 } = options;
      return entries
        .filter((e) => {
          if (domain && e.domain !== domain) return false;
          if (topic && e.topic !== topic) return false;
          return true;
        })
        .slice(0, limit)
        .map((entry) => ({ entry }));
    },
  };
}

function makeEntry(
  id: string,
  key: string,
  value: string,
  domain: string,
  topic: string,
): FakeEntry {
  return { id, key, value, domain, topic, blockType: "project" };
}

// ── Tests ────────────────────────────────────────────────────

describe("TunnelStore", () => {
  const makeTunnel = (topic: string, domains: string[], entryIds: string[] = []): Tunnel => ({
    id: `tunnel-${topic}`,
    topic,
    domains,
    entryIds,
    strength: domains.length / 3,
    detectedAt: Date.now(),
  });

  it("starts empty", () => {
    const store = new TunnelStore();
    expect(store.getAll()).toHaveLength(0);
  });

  it("stores and retrieves tunnels by topic", () => {
    const tunnel = makeTunnel("auth", ["backend", "frontend"]);
    const store = new TunnelStore([tunnel]);

    expect(store.getByTopic("auth")).toEqual(tunnel);
    expect(store.getByTopic("nonexistent")).toBeUndefined();
  });

  it("retrieves tunnels by domain", () => {
    const t1 = makeTunnel("auth", ["backend", "frontend"]);
    const t2 = makeTunnel("logging", ["backend", "infra"]);
    const store = new TunnelStore([t1, t2]);

    const backendTunnels = store.getByDomain("backend");
    expect(backendTunnels).toHaveLength(2);

    const frontendTunnels = store.getByDomain("frontend");
    expect(frontendTunnels).toHaveLength(1);
    expect(frontendTunnels[0]!.topic).toBe("auth");

    expect(store.getByDomain("unknown")).toHaveLength(0);
  });

  it("returns all tunnels", () => {
    const t1 = makeTunnel("auth", ["backend", "frontend"]);
    const t2 = makeTunnel("config", ["backend", "infra"]);
    const store = new TunnelStore([t1, t2]);

    expect(store.getAll()).toHaveLength(2);
  });

  it("deduplicates by topic (last wins in constructor)", () => {
    const t1 = makeTunnel("auth", ["backend", "frontend"]);
    const t2 = makeTunnel("auth", ["backend", "frontend", "mobile"]);
    const store = new TunnelStore([t1, t2]);

    // Map overwrites, so last one with same topic wins for getByTopic
    const found = store.getByTopic("auth");
    expect(found!.domains).toHaveLength(3);
  });
});

describe("TunnelDetector", () => {
  describe("detect", () => {
    it("returns empty when fewer than 2 domains", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-key", "auth config", "backend", "auth"),
      ]);
      const detector = new TunnelDetector();
      const tunnels = detector.detect(store);

      expect(tunnels).toHaveLength(0);
    });

    it("detects a tunnel when topic spans 2 domains", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-backend", "backend auth setup", "backend", "auth"),
        makeEntry("e2", "auth-frontend", "frontend auth flow", "frontend", "auth"),
      ]);
      const detector = new TunnelDetector();
      const tunnels = detector.detect(store);

      expect(tunnels).toHaveLength(1);
      expect(tunnels[0]!.topic).toBe("auth");
      expect(tunnels[0]!.domains).toContain("backend");
      expect(tunnels[0]!.domains).toContain("frontend");
    });

    it("does not create tunnel for single-domain topics", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "backend auth", "backend", "auth"),
        makeEntry("e2", "deploy-be", "backend deploy", "backend", "deploy"),
        makeEntry("e3", "style-fe", "frontend styles", "frontend", "styles"),
      ]);
      const detector = new TunnelDetector();
      const tunnels = detector.detect(store);

      expect(tunnels).toHaveLength(0);
    });

    it("calculates strength as (domains with topic) / (total domains)", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "be auth", "backend", "auth"),
        makeEntry("e2", "auth-fe", "fe auth", "frontend", "auth"),
        makeEntry("e3", "other-infra", "infra stuff", "infra", "deploy"),
      ]);
      const detector = new TunnelDetector();
      const tunnels = detector.detect(store);

      expect(tunnels).toHaveLength(1);
      // "auth" spans 2 of 3 domains
      expect(tunnels[0]!.strength).toBeCloseTo(2 / 3);
    });

    it("detects multiple tunnels", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "be auth", "backend", "auth"),
        makeEntry("e2", "auth-fe", "fe auth", "frontend", "auth"),
        makeEntry("e3", "config-be", "be config", "backend", "config"),
        makeEntry("e4", "config-fe", "fe config", "frontend", "config"),
      ]);
      const detector = new TunnelDetector();
      const tunnels = detector.detect(store);

      expect(tunnels).toHaveLength(2);
      const topics = tunnels.map((t) => t.topic).sort();
      expect(topics).toEqual(["auth", "config"]);
    });

    it("collects entry IDs from all domains", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "be auth", "backend", "auth"),
        makeEntry("e2", "auth-fe", "fe auth", "frontend", "auth"),
        makeEntry("e3", "auth-be2", "be auth2", "backend", "auth"),
      ]);
      const detector = new TunnelDetector();
      const tunnels = detector.detect(store);

      expect(tunnels[0]!.entryIds).toContain("e1");
      expect(tunnels[0]!.entryIds).toContain("e2");
      expect(tunnels[0]!.entryIds).toContain("e3");
    });

    it("stores tunnels in cache after detection", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "be", "backend", "auth"),
        makeEntry("e2", "auth-fe", "fe", "frontend", "auth"),
      ]);
      const detector = new TunnelDetector();
      detector.detect(store);

      const cache = detector.getCache();
      expect(cache.getAll()).toHaveLength(1);
      expect(cache.getByTopic("auth")).toBeDefined();
      expect(cache.getByDomain("backend")).toHaveLength(1);
    });

    it("assigns a UUID id and timestamp to each tunnel", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "be", "backend", "auth"),
        makeEntry("e2", "auth-fe", "fe", "frontend", "auth"),
      ]);
      const detector = new TunnelDetector();
      const before = Date.now();
      const tunnels = detector.detect(store);
      const after = Date.now();

      const tunnel = tunnels[0]!;
      // UUID v4 format
      expect(tunnel.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(tunnel.detectedAt).toBeGreaterThanOrEqual(before);
      expect(tunnel.detectedAt).toBeLessThanOrEqual(after);
    });

    it("clears cache when no tunnels found", () => {
      const crossDomainStore = makeFakeStore([
        makeEntry("e1", "auth-be", "be", "backend", "auth"),
        makeEntry("e2", "auth-fe", "fe", "frontend", "auth"),
      ]);
      const singleDomainStore = makeFakeStore([
        makeEntry("e3", "auth-be", "be", "backend", "auth"),
      ]);

      const detector = new TunnelDetector();
      detector.detect(crossDomainStore);
      expect(detector.getCache().getAll()).toHaveLength(1);

      detector.detect(singleDomainStore);
      expect(detector.getCache().getAll()).toHaveLength(0);
    });
  });

  describe("queryAcrossDomains", () => {
    it("returns entries from all domains containing the topic", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "backend auth", "backend", "auth"),
        makeEntry("e2", "auth-fe", "frontend auth", "frontend", "auth"),
        makeEntry("e3", "deploy-be", "backend deploy", "backend", "deploy"),
      ]);
      const detector = new TunnelDetector();
      const result: CrossDomainResult = detector.queryAcrossDomains(store, "auth");

      expect(result.topic).toBe("auth");
      expect(result.domainResults).toHaveLength(2);
      expect(result.totalEntries).toBe(2);

      const backendResult = result.domainResults.find((r) => r.domain === "backend");
      expect(backendResult).toBeDefined();
      expect(backendResult!.entries).toHaveLength(1);
      expect(backendResult!.entries[0]!.id).toBe("e1");

      const frontendResult = result.domainResults.find((r) => r.domain === "frontend");
      expect(frontendResult).toBeDefined();
      expect(frontendResult!.entries).toHaveLength(1);
      expect(frontendResult!.entries[0]!.id).toBe("e2");
    });

    it("returns empty domainResults when topic is not present", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "backend auth", "backend", "auth"),
      ]);
      const detector = new TunnelDetector();
      const result = detector.queryAcrossDomains(store, "nonexistent");

      expect(result.topic).toBe("nonexistent");
      expect(result.domainResults).toHaveLength(0);
      expect(result.totalEntries).toBe(0);
    });

    it("aggregates multiple entries per domain", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be-1", "be auth v1", "backend", "auth"),
        makeEntry("e2", "auth-be-2", "be auth v2", "backend", "auth"),
        makeEntry("e3", "auth-fe", "fe auth", "frontend", "auth"),
      ]);
      const detector = new TunnelDetector();
      const result = detector.queryAcrossDomains(store, "auth");

      expect(result.totalEntries).toBe(3);
      const beResult = result.domainResults.find((r) => r.domain === "backend");
      expect(beResult!.entries).toHaveLength(2);
    });
  });

  describe("getStrongestTunnels", () => {
    it("returns tunnels sorted by strength descending", () => {
      const store = makeFakeStore([
        makeEntry("e1", "auth-be", "be", "backend", "auth"),
        makeEntry("e2", "auth-fe", "fe", "frontend", "auth"),
        makeEntry("e3", "config-be", "be", "backend", "config"),
        makeEntry("e4", "config-fe", "fe", "frontend", "config"),
        makeEntry("e5", "config-infra", "infra", "infra", "config"),
      ]);
      const detector = new TunnelDetector();
      detector.detect(store);

      const strongest = detector.getStrongestTunnels();

      // "config" spans 3/3 domains (strength 1.0), "auth" spans 2/3 (strength ~0.67)
      expect(strongest[0]!.topic).toBe("config");
      expect(strongest[0]!.strength).toBeCloseTo(1.0);
      expect(strongest[1]!.topic).toBe("auth");
      expect(strongest[1]!.strength).toBeCloseTo(2 / 3);
    });

    it("respects limit parameter", () => {
      const store = makeFakeStore([
        makeEntry("e1", "a-be", "be", "backend", "auth"),
        makeEntry("e2", "a-fe", "fe", "frontend", "auth"),
        makeEntry("e3", "c-be", "be", "backend", "config"),
        makeEntry("e4", "c-fe", "fe", "frontend", "config"),
      ]);
      const detector = new TunnelDetector();
      detector.detect(store);

      const strongest = detector.getStrongestTunnels(1);
      expect(strongest).toHaveLength(1);
    });

    it("returns empty before detect is called", () => {
      const detector = new TunnelDetector();
      expect(detector.getStrongestTunnels()).toHaveLength(0);
    });
  });
});
