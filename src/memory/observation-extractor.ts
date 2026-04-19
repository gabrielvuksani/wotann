/**
 * Observation extraction pipeline inspired by LoCoMo (ACL 2024).
 * Extracts structured assertions from raw auto-capture data.
 *
 * LoCoMo proved that observation-based RAG outperforms raw dialogue RAG.
 * This module transforms raw tool call logs into typed observations:
 *   decisions, preferences, milestones, problems, discoveries.
 *
 * All extraction is pattern-based (no LLM calls).
 */

import { randomUUID } from "node:crypto";
import type { AutoCaptureEntry } from "./store.js";
import {
  createHeuristicClassifier,
  type MemoryRelationship,
  type RelationshipClassifier,
} from "./relationship-types.js";
import {
  EntitySchema,
  extractEntities as extractEntitiesViaLlm,
  type Entity,
  type ExtractionOptions,
} from "./entity-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObservationType = "decision" | "preference" | "milestone" | "problem" | "discovery";

export interface Observation {
  readonly id: string;
  readonly type: ObservationType;
  readonly assertion: string;
  readonly confidence: number;
  readonly sourceIds: readonly number[];
  readonly extractedAt: number;
  readonly domain?: string;
  readonly topic?: string;
}

// ---------------------------------------------------------------------------
// Pattern constants
// ---------------------------------------------------------------------------

const DECISION_PATTERNS: readonly RegExp[] = [
  /\b(?:chose|decided|selected|picked|switched\s+to|opted\s+for|went\s+with)\b/i,
  /\bover\b.*\bbecause\b/i,
  /\binstead\s+of\b/i,
];

const MILESTONE_PATTERNS: readonly RegExp[] = [
  /\b(?:complete[d]?|passed|success(?:ful(?:ly)?)?|done|finished|shipped|deployed|merged)\b/i,
  /\bbuild\s+succeeded\b/i,
  /\ball\s+tests?\s+pass(?:ed|ing)?\b/i,
];

const PROBLEM_PATTERNS: readonly RegExp[] = [
  /\b(?:error|fail(?:ed|ure)?|crash(?:ed)?|bug|exception|broken|panic|segfault)\b/i,
  /\b(?:ENOENT|EACCES|EPIPE|ECONNREFUSED|ETIMEDOUT|TypeError|RangeError|SyntaxError)\b/,
  /\b(?:stack\s+trace|traceback|unhandled\s+rejection)\b/i,
];

const DISCOVERY_EVENT_TYPES: readonly string[] = [
  "error",
  "fail",
  "fix",
  "success",
  "verify",
  "test",
];

// ---------------------------------------------------------------------------
// Domain / topic inference
// ---------------------------------------------------------------------------

function inferDomain(content: string): string | undefined {
  const pathMatch = content.match(/(?:src|lib|app)\/([^/\s]+)\//);
  if (pathMatch?.[1]) return pathMatch[1];

  const domainKeywords: Record<string, readonly string[]> = {
    memory: ["memory", "sqlite", "fts5", "observation", "recall"],
    providers: ["provider", "openai", "anthropic", "gemini", "model"],
    orchestration: ["orchestrat", "pipeline", "wave", "coordinator"],
    hooks: ["hook", "guard", "pre-commit", "pre-tool"],
    security: ["secret", "auth", "token", "credential", "permission"],
    testing: ["test", "vitest", "jest", "coverage", "assertion"],
    ui: ["tui", "ink", "theme", "render", "component"],
  };

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    const lowerContent = content.toLowerCase();
    if (keywords.some((kw) => lowerContent.includes(kw))) {
      return domain;
    }
  }
  return undefined;
}

function inferTopic(content: string): string | undefined {
  const topicPatterns: readonly [RegExp, string][] = [
    [/\bconfigur(?:e|ation|ing)\b/i, "configuration"],
    [/\bperformance\b/i, "performance"],
    [/\bmigrat(?:e|ion|ing)\b/i, "migration"],
    [/\brefactor(?:ing)?\b/i, "refactoring"],
    [/\bdebug(?:ging)?\b/i, "debugging"],
    [/\bdeploy(?:ment|ing)?\b/i, "deployment"],
    [/\bdependen(?:cy|cies)\b/i, "dependencies"],
    [/\bschema\b/i, "schema"],
    [/\bapi\b/i, "api"],
    [/\brouting?\b/i, "routing"],
  ];

  for (const [pattern, topic] of topicPatterns) {
    if (pattern.test(content)) return topic;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Pattern matchers — pure functions
// ---------------------------------------------------------------------------

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function buildAssertion(prefix: string, content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim().slice(0, 200);
  return `${prefix}: ${cleaned}`;
}

export function extractDecisions(captures: readonly AutoCaptureEntry[]): readonly Observation[] {
  const results: Observation[] = [];

  for (const cap of captures) {
    if (!matchesAny(cap.content, DECISION_PATTERNS)) continue;

    results.push({
      id: randomUUID(),
      type: "decision",
      assertion: buildAssertion("Decision made", cap.content),
      confidence: 0.7,
      sourceIds: [cap.id],
      extractedAt: Date.now(),
      domain: inferDomain(cap.content),
      topic: inferTopic(cap.content),
    });
  }
  return results;
}

export function extractPreferences(captures: readonly AutoCaptureEntry[]): readonly Observation[] {
  const toolCounts = new Map<string, { readonly count: number; readonly ids: readonly number[] }>();

  for (const cap of captures) {
    if (!cap.toolName) continue;
    const key = cap.toolName;
    const existing = toolCounts.get(key);
    toolCounts.set(key, {
      count: (existing?.count ?? 0) + 1,
      ids: [...(existing?.ids ?? []), cap.id],
    });
  }

  const results: Observation[] = [];
  for (const [tool, { count, ids }] of toolCounts) {
    if (count < 3) continue;
    results.push({
      id: randomUUID(),
      type: "preference",
      assertion: `Preference detected: tool "${tool}" used ${count} times across captures`,
      confidence: Math.min(0.5 + count * 0.1, 0.95),
      sourceIds: ids,
      extractedAt: Date.now(),
      domain: undefined,
      topic: undefined,
    });
  }
  return results;
}

export function extractMilestones(captures: readonly AutoCaptureEntry[]): readonly Observation[] {
  const results: Observation[] = [];

  for (const cap of captures) {
    if (!matchesAny(cap.content, MILESTONE_PATTERNS)) continue;

    results.push({
      id: randomUUID(),
      type: "milestone",
      assertion: buildAssertion(`Milestone at ${cap.createdAt}`, cap.content),
      confidence: 0.8,
      sourceIds: [cap.id],
      extractedAt: Date.now(),
      domain: inferDomain(cap.content),
      topic: inferTopic(cap.content),
    });
  }
  return results;
}

export function extractProblems(captures: readonly AutoCaptureEntry[]): readonly Observation[] {
  const results: Observation[] = [];

  for (const cap of captures) {
    if (!matchesAny(cap.content, PROBLEM_PATTERNS)) continue;

    results.push({
      id: randomUUID(),
      type: "problem",
      assertion: buildAssertion("Problem encountered", cap.content),
      confidence: 0.85,
      sourceIds: [cap.id],
      extractedAt: Date.now(),
      domain: inferDomain(cap.content),
      topic: inferTopic(cap.content),
    });
  }
  return results;
}

export function extractDiscoveries(captures: readonly AutoCaptureEntry[]): readonly Observation[] {
  const results: Observation[] = [];
  const bySession = new Map<string, readonly AutoCaptureEntry[]>();

  for (const cap of captures) {
    if (!cap.sessionId) continue;
    const existing = bySession.get(cap.sessionId) ?? [];
    bySession.set(cap.sessionId, [...existing, cap]);
  }

  for (const sessionCaptures of bySession.values()) {
    const relevant = sessionCaptures.filter(
      (c) =>
        DISCOVERY_EVENT_TYPES.some((t) => c.eventType.toLowerCase().includes(t)) ||
        matchesAny(c.content, PROBLEM_PATTERNS) ||
        matchesAny(c.content, MILESTONE_PATTERNS),
    );
    if (relevant.length < 2) continue;

    const hasError = relevant.some(
      (c) => c.eventType.toLowerCase().includes("error") || matchesAny(c.content, PROBLEM_PATTERNS),
    );
    const hasFix = relevant.some(
      (c) =>
        c.eventType.toLowerCase().includes("fix") ||
        c.eventType.toLowerCase().includes("success") ||
        matchesAny(c.content, MILESTONE_PATTERNS),
    );

    if (hasError && hasFix) {
      const errorCap = relevant.find(
        (c) =>
          c.eventType.toLowerCase().includes("error") || matchesAny(c.content, PROBLEM_PATTERNS),
      );
      const fixCap = relevant.find(
        (c) =>
          c.eventType.toLowerCase().includes("fix") ||
          c.eventType.toLowerCase().includes("success") ||
          matchesAny(c.content, MILESTONE_PATTERNS),
      );

      if (errorCap && fixCap) {
        const errorSnippet = errorCap.content.slice(0, 80).replace(/\s+/g, " ").trim();
        const fixSnippet = fixCap.content.slice(0, 80).replace(/\s+/g, " ").trim();
        results.push({
          id: randomUUID(),
          type: "discovery",
          assertion: `Discovery: encountered "${errorSnippet}" then resolved with "${fixSnippet}"`,
          confidence: 0.75,
          sourceIds: relevant.map((c) => c.id),
          extractedAt: Date.now(),
          domain: inferDomain(errorCap.content) ?? inferDomain(fixCap.content),
          topic: inferTopic(fixCap.content) ?? inferTopic(errorCap.content),
        });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// ObservationExtractor
// ---------------------------------------------------------------------------

export class ObservationExtractor {
  private readonly classifier: RelationshipClassifier;

  constructor(classifier?: RelationshipClassifier) {
    // Phase H Task 2: default to heuristic classifier. Callers wanting
    // LLM-backed relationships can pass createLlmClassifier(query).
    this.classifier = classifier ?? createHeuristicClassifier();
  }

  extractFromCaptures(captures: readonly AutoCaptureEntry[]): readonly Observation[] {
    if (captures.length === 0) return [];

    return [
      ...extractDecisions(captures),
      ...extractPreferences(captures),
      ...extractMilestones(captures),
      ...extractProblems(captures),
      ...extractDiscoveries(captures),
    ];
  }

  /**
   * Phase H Task 2: classify relationships between newly extracted
   * observations. Pair each observation with earlier ones in the same
   * domain and ask the classifier if the later updates/extends/derives
   * from the earlier.
   *
   * Runs AFTER extractFromCaptures. Observations are sorted by
   * extractedAt so the earlier one is the predecessor.
   *
   * The classifier is async so callers can swap in LLM-backed
   * classification; the default heuristic classifier returns instantly.
   *
   * Returns an empty list when fewer than 2 observations exist — no
   * fabricated edges. Pairs from different domains are skipped to
   * avoid cross-domain noise.
   */
  /**
   * Phase 13 Wave-3C — Zod-validated typed entity extraction. Wraps
   * entity-types' LLM-backed extractor and re-validates each returned
   * entity against EntitySchema before handing it back to the caller.
   * Re-validation catches any drift between the prompt's structural
   * contract and what the LLM actually returned. Entities that fail
   * validation are silently dropped (the extractor already swallows
   * LLM-parse failures — this step only tightens post-parse rigor).
   */
  async extractTypedEntities(
    observation: string,
    options: ExtractionOptions,
  ): Promise<readonly Entity[]> {
    const raw = await extractEntitiesViaLlm(observation, options);
    const validated: Entity[] = [];
    for (const candidate of raw) {
      const parsed = EntitySchema.safeParse(candidate);
      if (parsed.success) validated.push(parsed.data);
    }
    return validated;
  }

  async classifyRelationships(
    observations: readonly Observation[],
    now: number = Date.now(),
  ): Promise<readonly MemoryRelationship[]> {
    if (observations.length < 2) return [];

    const sorted = [...observations].sort((a, b) => a.extractedAt - b.extractedAt);
    const relationships: MemoryRelationship[] = [];

    // Pair each observation with up to 5 previous ones. Capped to keep
    // classification cost bounded: O(5n) instead of O(n²).
    for (let i = 1; i < sorted.length; i++) {
      const successor = sorted[i]!;
      const start = Math.max(0, i - 5);
      for (let j = start; j < i; j++) {
        const predecessor = sorted[j]!;

        // Only classify same-domain pairs when both have a domain.
        if (predecessor.domain && successor.domain && predecessor.domain !== successor.domain) {
          continue;
        }

        let classification: Awaited<ReturnType<RelationshipClassifier["classify"]>>;
        try {
          classification = await this.classifier.classify(
            predecessor.assertion,
            successor.assertion,
          );
        } catch {
          // Honest-failure: skip this pair rather than fabricate an edge.
          continue;
        }
        if (!classification) continue;

        const rel: MemoryRelationship = {
          id: randomUUID(),
          fromId: predecessor.id,
          toId: successor.id,
          kind: classification.kind,
          confidence: classification.confidence,
          createdAt: now,
          ...(classification.rationale ? { rationale: classification.rationale } : {}),
        };
        relationships.push(rel);
      }
    }

    return relationships;
  }
}

// ---------------------------------------------------------------------------
// ObservationStore — in-memory with deduplication
// ---------------------------------------------------------------------------

export class ObservationStore {
  private readonly observations: Map<string, Observation> = new Map();
  private readonly assertionIndex: Set<string> = new Set();

  add(observation: Observation): boolean {
    if (this.assertionIndex.has(observation.assertion)) return false;
    this.observations.set(observation.id, observation);
    this.assertionIndex.add(observation.assertion);
    return true;
  }

  addAll(observations: readonly Observation[]): number {
    let added = 0;
    for (const obs of observations) {
      if (this.add(obs)) added++;
    }
    return added;
  }

  getById(id: string): Observation | undefined {
    return this.observations.get(id);
  }

  search(query: string): readonly Observation[] {
    const lower = query.toLowerCase();
    const results: Observation[] = [];
    for (const obs of this.observations.values()) {
      if (obs.assertion.toLowerCase().includes(lower)) {
        results.push(obs);
      }
    }
    return results;
  }

  getByDomain(domain: string): readonly Observation[] {
    const results: Observation[] = [];
    for (const obs of this.observations.values()) {
      if (obs.domain === domain) results.push(obs);
    }
    return results;
  }

  getByType(type: ObservationType): readonly Observation[] {
    const results: Observation[] = [];
    for (const obs of this.observations.values()) {
      if (obs.type === type) results.push(obs);
    }
    return results;
  }

  getRecent(limit: number): readonly Observation[] {
    const all = [...this.observations.values()];
    all.sort((a, b) => b.extractedAt - a.extractedAt);
    return all.slice(0, limit);
  }

  get size(): number {
    return this.observations.size;
  }
}
