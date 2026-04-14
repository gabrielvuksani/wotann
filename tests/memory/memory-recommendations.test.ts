/**
 * Tests for MemPalace/LoCoMo memory recommendations (R1-R8).
 *
 * R1: Domain-Partitioned Search (+34% retrieval)
 * R2: Temporal Validity on Knowledge Graph Edges
 * R5: Progressive Context Loading (L0/L1)
 * R6: Verbatim Storage Layer
 * R7: Adversarial Detection / Confidence Gating
 * R8: Cross-Episode Reasoning
 *
 * R3 (observation-extractor) and R4 (temporal-qa) have their own test files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../../src/memory/store.js";
import { KnowledgeGraph } from "../../src/memory/graph-rag.js";
import { ContextLoader } from "../../src/memory/context-loader.js";
import { EpisodicMemory } from "../../src/memory/episodic-memory.js";
import { MemoryToolkit } from "../../src/memory/memory-tools.js";

// ── R1: Domain-Partitioned Search ────────────────────────────

describe("R1: Domain-Partitioned Search", () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wotann-r1-"));
    store = new MemoryStore(join(tmpDir, "memory.db"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should insert and retrieve entries with domain/topic", () => {
    store.insert({
      id: "r1-1",
      layer: "core_blocks",
      blockType: "decisions",
      key: "auth migration",
      value: "Decided to use OAuth 2.0 for the new auth system",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
      domain: "auth",
      topic: "architecture",
    });

    const results = store.search("auth migration", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.entry.domain).toBe("auth");
    expect(results[0]!.entry.topic).toBe("architecture");
  });

  it("should filter search by domain", () => {
    // Insert entries in different domains
    store.insert({
      id: "r1-auth",
      layer: "core_blocks",
      blockType: "decisions",
      key: "migration plan",
      value: "Auth migration plan for OAuth",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
      domain: "auth",
      topic: "migration",
    });
    store.insert({
      id: "r1-deploy",
      layer: "core_blocks",
      blockType: "decisions",
      key: "migration plan",
      value: "Deploy migration plan for K8s",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
      domain: "deploy",
      topic: "migration",
    });

    // Unpartitioned search returns both
    const allResults = store.search("migration plan", 10);
    expect(allResults.length).toBe(2);

    // Partitioned by domain returns only auth
    const authResults = store.searchPartitioned("migration plan", { domain: "auth" });
    expect(authResults.length).toBe(1);
    expect(authResults[0]!.entry.domain).toBe("auth");
  });

  it("should filter search by domain + topic", () => {
    store.insert({
      id: "r1-a",
      layer: "core_blocks",
      blockType: "project",
      key: "auth architecture",
      value: "Using JWT with refresh tokens",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
      domain: "auth",
      topic: "architecture",
    });
    store.insert({
      id: "r1-b",
      layer: "core_blocks",
      blockType: "project",
      key: "auth testing",
      value: "Testing auth with mock tokens",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
      domain: "auth",
      topic: "testing",
    });

    const archResults = store.searchPartitioned("auth", { domain: "auth", topic: "architecture" });
    expect(archResults.length).toBe(1);
    expect(archResults[0]!.entry.topic).toBe("architecture");
  });

  it("should list domains and topics", () => {
    store.insert({
      id: "d1", layer: "core_blocks", blockType: "project", key: "x", value: "x",
      verified: false, freshnessScore: 1.0, confidenceLevel: 0.8, verificationStatus: "unverified",
      domain: "auth", topic: "testing",
    });
    store.insert({
      id: "d2", layer: "core_blocks", blockType: "project", key: "y", value: "y",
      verified: false, freshnessScore: 1.0, confidenceLevel: 0.8, verificationStatus: "unverified",
      domain: "deploy", topic: "ci",
    });

    const domains = store.getDomains();
    expect(domains).toContain("auth");
    expect(domains).toContain("deploy");

    const topics = store.getTopics("auth");
    expect(topics).toContain("testing");
    expect(topics).not.toContain("ci");
  });

  it("should fall back to unpartitioned search when no domain/topic specified", () => {
    store.insert({
      id: "fb-1", layer: "core_blocks", blockType: "project", key: "fallback test", value: "fallback value",
      verified: false, freshnessScore: 1.0, confidenceLevel: 0.8, verificationStatus: "unverified",
    });

    const results = store.searchPartitioned("fallback test");
    expect(results.length).toBe(1);
  });
});

// ── R2: Temporal Validity on Knowledge Graph Edges ───────────

describe("R2: Temporal Validity on Graph Edges", () => {
  it("should create relationships with validFrom timestamp", () => {
    const graph = new KnowledgeGraph();
    graph.addDocument("doc1", "function authenticate() { return jwt.sign(); }");

    const rels = graph.getAllRelationships();
    for (const rel of rels) {
      expect(rel.validFrom).toBeDefined();
      expect(typeof rel.validFrom).toBe("string");
    }
  });

  it("should invalidate relationships with validTo timestamp", () => {
    const graph = new KnowledgeGraph();
    // Use text with multiple entities so implicit "related-to" relationships are created
    graph.addDocument("doc1", "function authenticate(token) { return jwt.verify(token); }\nfunction jwt() {}");

    const rels = graph.getAllRelationships();
    expect(rels.length).toBeGreaterThan(0);

    const relId = rels[0]!.id;
    const success = graph.invalidateRelationship(relId, "2026-01-01T00:00:00.000Z");
    expect(success).toBe(true);

    const updated = graph.getAllRelationships().find((r) => r.id === relId);
    expect(updated?.validTo).toBe("2026-01-01T00:00:00.000Z");
  });

  it("should filter active relationships at a specific date", () => {
    const graph = new KnowledgeGraph();
    graph.addDocument("doc1", "function processAuth(input) { return validateToken(input); }\nfunction validateToken(t) {}");

    const rels = graph.getAllRelationships();
    expect(rels.length).toBeGreaterThan(0);
    const relId = rels[0]!.id;

    // Invalidate the relationship 1 hour from now
    const nowMs = Date.now();
    const futureInvalidation = new Date(nowMs + 3600_000).toISOString();
    graph.invalidateRelationship(relId, futureInvalidation);

    // Right now — should still be active (before invalidation)
    const activeNow = graph.getActiveRelationshipsAt(new Date(nowMs + 1000));
    expect(activeNow.some((r) => r.id === relId)).toBe(true);

    // After invalidation date — should not be active
    const activeFuture = graph.getActiveRelationshipsAt(new Date(nowMs + 7200_000));
    expect(activeFuture.some((r) => r.id === relId)).toBe(false);
  });

  it("should only traverse active relationships in temporal graph query", () => {
    const graph = new KnowledgeGraph();
    graph.addDocument("doc1", "function authenticate() { return jwt.sign(); }");
    graph.addDocument("doc2", "function jwt() { return encode(); }");

    // Invalidate all existing relationships
    for (const rel of graph.getAllRelationships()) {
      graph.invalidateRelationship(rel.id, "2026-01-01T00:00:00.000Z");
    }

    // Query at a date when no relationships are active
    const result = graph.queryGraphAt("authenticate", new Date("2026-04-01"));
    // Should find the seed entity but not traverse to connected entities
    expect(result.relationships.length).toBe(0);
  });

  it("should support temporal edges in SQLite store", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "wotann-r2-"));
    try {
      const store = new MemoryStore(join(tmpDir, "memory.db"));
      const nodeA = store.addKnowledgeNode("Kai", "person");
      const nodeB = store.addKnowledgeNode("Orion", "project");

      const edgeId = store.addKnowledgeEdge(nodeA, nodeB, "works_on", 1.0, "2026-01-01T00:00:00.000Z");

      // Invalidate the edge
      const invalidated = store.invalidateKnowledgeEdge(edgeId, "2026-03-01T00:00:00.000Z");
      expect(invalidated).toBe(true);

      // Query active edges at different dates
      const activeFeb = store.getActiveEdgesAt("2026-02-01T00:00:00.000Z");
      expect(activeFeb.some((e) => e.id === edgeId)).toBe(true);

      const activeApr = store.getActiveEdgesAt("2026-04-01T00:00:00.000Z");
      expect(activeApr.some((e) => e.id === edgeId)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── R5: Progressive Context Loading ──────────────────────────

describe("R5: Progressive Context Loading", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wotann-r5-"));
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should generate L0 identity payload from files", () => {
    writeFileSync(join(tmpDir, "IDENTITY.md"), "## Name\nWOTANN\n\n## Role\nUnified AI Agent Harness");
    writeFileSync(join(tmpDir, "SOUL.md"), "I am the All-Father of AI agents.");

    const loader = new ContextLoader(tmpDir);
    const l0 = loader.loadL0Identity();

    expect(l0.level).toBe("L0");
    expect(l0.content).toContain("WOTANN");
    expect(l0.tokenEstimate).toBeLessThan(60);
  });

  it("should generate fallback L0 when no identity files exist", () => {
    const loader = new ContextLoader(tmpDir);
    const l0 = loader.loadL0Identity();

    expect(l0.content).toContain("WOTANN");
    expect(l0.tokenEstimate).toBeGreaterThan(0);
  });

  it("should generate combined wake-up payload under 200 tokens", () => {
    writeFileSync(join(tmpDir, "IDENTITY.md"), "## Name\nWOTANN\n\n## Role\nAgent");
    writeFileSync(join(tmpDir, "SOUL.md"), "Minimal soul.");

    const loader = new ContextLoader(tmpDir);
    const payload = loader.generateWakeUpPayload();

    expect(payload.totalTokens).toBeLessThan(200);
    expect(payload.combinedPrompt.length).toBeGreaterThan(0);
  });

  it("should track loaded domains", () => {
    const loader = new ContextLoader(tmpDir);

    expect(loader.isDomainLoaded("auth")).toBe(false);
    loader.loadL2DomainRecall("auth");
    expect(loader.isDomainLoaded("auth")).toBe(true);
    expect(loader.getLoadedDomains()).toContain("auth");

    loader.resetLoadedDomains();
    expect(loader.isDomainLoaded("auth")).toBe(false);
  });
});

// ── R6: Verbatim Storage Layer ───────────────────────────────

describe("R6: Verbatim Storage Layer", () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wotann-r6-"));
    store = new MemoryStore(join(tmpDir, "memory.db"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should store and search verbatim content", () => {
    const id = store.storeVerbatim("The user asked about auth migration strategies for OAuth 2.0", {
      domain: "auth",
      topic: "migration",
    });

    expect(id).toBeDefined();
    expect(store.getVerbatimCount()).toBe(1);

    const results = store.searchVerbatim("auth migration", 5);
    expect(results.length).toBe(1);
    expect(results[0]!.rawContent).toContain("OAuth 2.0");
    expect(results[0]!.domain).toBe("auth");
  });

  it("should link verbatim content to structured memory entries", () => {
    // Create a structured entry
    store.insert({
      id: "entry-1",
      layer: "core_blocks",
      blockType: "decisions",
      key: "auth strategy",
      value: "Use OAuth 2.0",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
    });

    // Store verbatim linked to the entry
    store.storeVerbatim("Full conversation about auth: we discussed JWT vs sessions vs OAuth...", {
      entryId: "entry-1",
      contentType: "conversation",
    });

    const verbatim = store.getVerbatimForEntry("entry-1");
    expect(verbatim.length).toBe(1);
    expect(verbatim[0]!.rawContent).toContain("JWT vs sessions");
    expect(verbatim[0]!.contentType).toBe("conversation");
  });

  it("should support multiple verbatim chunks per entry", () => {
    store.insert({
      id: "entry-2",
      layer: "core_blocks",
      blockType: "cases",
      key: "debug session",
      value: "Fixed memory leak",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
    });

    store.storeVerbatim("First attempt: tried reducing cache size", { entryId: "entry-2" });
    store.storeVerbatim("Second attempt: found the WeakRef leak in event listeners", { entryId: "entry-2" });

    const verbatim = store.getVerbatimForEntry("entry-2");
    expect(verbatim.length).toBe(2);
  });
});

// ── R7: Adversarial Detection ────────────────────────────────

describe("R7: Adversarial Detection / Confidence Gating", () => {
  let store: MemoryStore;
  let toolkit: MemoryToolkit;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wotann-r7-"));
    store = new MemoryStore(join(tmpDir, "memory.db"));
    toolkit = new MemoryToolkit(store);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should mark high-overlap results as confident", () => {
    store.insert({
      id: "r7-1",
      layer: "core_blocks",
      blockType: "decisions",
      key: "auth migration strategy",
      value: "Decided to use OAuth 2.0 for the auth migration",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
    });

    const result = toolkit.dispatch("memory_search", { query: "auth migration strategy" });
    expect(result.success).toBe(true);

    const data = result.data as { results: Array<{ retrievalConfidence: string }> };
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]!.retrievalConfidence).toBe("confident");
  });

  it("should include retrievalConfidence field in all results", () => {
    store.insert({
      id: "r7-2",
      layer: "core_blocks",
      blockType: "project",
      key: "deployment pipeline",
      value: "CI/CD with GitHub Actions",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
    });

    const result = toolkit.dispatch("memory_search", { query: "deployment pipeline" });
    const data = result.data as { results: Array<{ retrievalConfidence: string }> };

    for (const r of data.results) {
      expect(["confident", "uncertain"]).toContain(r.retrievalConfidence);
    }
  });
});

// ── R8: Cross-Episode Reasoning ──────────────────────────────

describe("R8: Cross-Episode Reasoning", () => {
  let episodicMemory: EpisodicMemory;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wotann-r8-"));
    episodicMemory = new EpisodicMemory(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should find recurring patterns across episodes", () => {
    // Episode 1: auth bug fix
    episodicMemory.startEpisode("Fix auth token expiration bug", "openai", "gpt-4");
    episodicMemory.recordStrategy("add logging first");
    episodicMemory.recordStrategy("reproduce in test");
    episodicMemory.recordLesson("Always check token expiry edge cases");
    episodicMemory.completeEpisode("success");

    // Episode 2: auth feature
    episodicMemory.startEpisode("Add refresh token rotation to auth", "openai", "gpt-4");
    episodicMemory.recordStrategy("add logging first");
    episodicMemory.recordStrategy("test edge cases");
    episodicMemory.recordLesson("Token rotation needs atomic operations");
    episodicMemory.completeEpisode("success");

    const patterns = episodicMemory.findPatterns(["auth"], 2);
    // "add logging first" appears in both episodes
    const loggingPattern = patterns.find((p) => p.pattern.includes("add logging first"));
    expect(loggingPattern).toBeDefined();
    expect(loggingPattern!.occurrences).toBe(2);
  });

  it("should build episode links from shared tags", () => {
    episodicMemory.startEpisode("Fix auth login bug", "openai", "gpt-4");
    episodicMemory.completeEpisode("success");

    episodicMemory.startEpisode("Add auth OAuth support", "openai", "gpt-4");
    episodicMemory.completeEpisode("success");

    episodicMemory.startEpisode("Fix database query performance", "openai", "gpt-4");
    episodicMemory.completeEpisode("success");

    const links = episodicMemory.buildEpisodeLinks();
    // The two auth episodes should be linked via shared "auth" tag
    expect(links.length).toBeGreaterThan(0);
    // At least one link should share the "auth" tag
    const authLink = links.find((l) => l.sharedTags.includes("auth"));
    expect(authLink).toBeDefined();
  });

  it("should perform multi-hop recall from a tag", () => {
    episodicMemory.startEpisode("Fix auth token bug", "openai", "gpt-4");
    episodicMemory.completeEpisode("success");

    episodicMemory.startEpisode("Add auth session management", "openai", "gpt-4");
    episodicMemory.completeEpisode("success");

    const results = episodicMemory.multiHopRecall("auth", 1);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]!.hop).toBe(0); // Direct match
  });
});
