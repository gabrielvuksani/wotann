/**
 * Conversation mining pipeline inspired by MemPalace's mining modes.
 * Ingests past conversation exports (Claude sessions, Slack threads,
 * generic text) and stores structured observations + verbatim chunks
 * into the WOTANN memory store.
 *
 * Mining modes:
 *   - Claude export: JSON array of {role, content} messages
 *   - Slack export: JSON array of {user, text, ts} messages
 *   - Generic text: plain text split by paragraphs
 *   - Auto-capture: existing AutoCaptureEntry records
 *
 * All extraction is pattern-based (no LLM calls).
 */

import { randomUUID } from "node:crypto";
import type { AutoCaptureEntry, MemoryStore } from "./store.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface MiningResult {
  readonly entriesCreated: number;
  readonly verbatimStored: number;
  readonly observationsExtracted: number;
  readonly domainsDetected: readonly string[];
  readonly topicsDetected: readonly string[];
  readonly errors: readonly string[];
}

export interface MinerConfig {
  readonly maxChunkSize: number;
  readonly minChunkSize: number;
  readonly defaultDomain: string;
  readonly sessionId?: string;
}

// ---------------------------------------------------------------------------
// Internal chunk type
// ---------------------------------------------------------------------------

interface Chunk {
  readonly text: string;
  readonly source: string;
  readonly timestamp?: string;
}

// ---------------------------------------------------------------------------
// Observation categories — self-contained (no import from observation-extractor)
// ---------------------------------------------------------------------------

type ObservationKind = "decision" | "preference" | "fact" | "problem";

interface ExtractedObservation {
  readonly kind: ObservationKind;
  readonly key: string;
  readonly value: string;
  readonly confidence: number;
}

const DECISION_PATTERNS: readonly RegExp[] = [
  /\b(?:chose|decided\s+to|went\s+with|opted\s+for|selected|switched\s+to)\b/i,
];

const PREFERENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:prefer|always\s+use|never\s+do|rather\s+than|avoid\s+using)\b/i,
];

const FACT_PATTERNS: readonly RegExp[] = [
  /\b(?:works\s+by|the\s+reason\s+is|is\s+because|is\s+a|is\s+the)\b/i,
];

const PROBLEM_PATTERNS: readonly RegExp[] = [
  /\b(?:error|fail(?:ed|ure)?|crash(?:ed)?|bug|exception|broken|panic)\b/i,
  /\b(?:ENOENT|EACCES|EPIPE|ECONNREFUSED|TypeError|SyntaxError)\b/,
];

// ---------------------------------------------------------------------------
// Domain / topic inference (self-contained to avoid circular deps)
// ---------------------------------------------------------------------------

function inferDomain(content: string): string | undefined {
  const pathMatch = content.match(/(?:src|lib|app)\/([^/\s]+)\//);
  if (pathMatch?.[1]) return pathMatch[1];

  const domainKeywords: Record<string, readonly string[]> = {
    memory: ["memory", "sqlite", "fts5", "observation", "recall"],
    providers: ["provider", "openai", "anthropic", "gemini", "model"],
    auth: ["auth", "login", "oauth", "jwt", "credential", "permission"],
    deploy: ["deploy", "ci", "pipeline", "vercel", "docker", "kubernetes"],
    database: ["database", "postgres", "mysql", "migration", "schema"],
    testing: ["test", "vitest", "jest", "coverage", "assertion"],
    ui: ["tui", "ink", "theme", "render", "component", "tailwind", "css"],
    security: ["secret", "token", "vulnerability", "xss", "injection"],
  };

  const lower = content.toLowerCase();
  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) return domain;
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
    [/\barchitect(?:ure)?\b/i, "architecture"],
    [/\boptimiz(?:e|ation|ing)\b/i, "optimization"],
  ];

  for (const [pattern, topic] of topicPatterns) {
    if (pattern.test(content)) return topic;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Pattern-based observation extraction
// ---------------------------------------------------------------------------

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function extractObservations(text: string): readonly ExtractedObservation[] {
  const results: ExtractedObservation[] = [];
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return results;

  const snippet = trimmed.slice(0, 200);

  if (matchesAny(text, DECISION_PATTERNS)) {
    results.push({
      kind: "decision",
      key: `Decision: ${snippet.slice(0, 80)}`,
      value: snippet,
      confidence: 0.7,
    });
  }

  if (matchesAny(text, PREFERENCE_PATTERNS)) {
    results.push({
      kind: "preference",
      key: `Preference: ${snippet.slice(0, 80)}`,
      value: snippet,
      confidence: 0.65,
    });
  }

  if (matchesAny(text, FACT_PATTERNS)) {
    results.push({
      kind: "fact",
      key: `Fact: ${snippet.slice(0, 80)}`,
      value: snippet,
      confidence: 0.6,
    });
  }

  if (matchesAny(text, PROBLEM_PATTERNS)) {
    results.push({
      kind: "problem",
      key: `Problem: ${snippet.slice(0, 80)}`,
      value: snippet,
      confidence: 0.85,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Chunking helpers
// ---------------------------------------------------------------------------

function splitIntoChunks(
  text: string,
  maxSize: number,
  minSize: number,
  source: string,
): readonly Chunk[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: Chunk[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;

    if (buffer.length + trimmed.length + 1 > maxSize && buffer.length >= minSize) {
      chunks.push({ text: buffer, source });
      buffer = trimmed;
    } else {
      buffer = buffer.length > 0 ? `${buffer}\n\n${trimmed}` : trimmed;
    }
  }

  if (buffer.length >= minSize) {
    chunks.push({ text: buffer, source });
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: MinerConfig = {
  maxChunkSize: 2000,
  minChunkSize: 20,
  defaultDomain: "general",
  sessionId: undefined,
};

// ---------------------------------------------------------------------------
// Immutable result builder
// ---------------------------------------------------------------------------

function emptyResult(): MiningResult {
  return {
    entriesCreated: 0,
    verbatimStored: 0,
    observationsExtracted: 0,
    domainsDetected: [],
    topicsDetected: [],
    errors: [],
  };
}

function mergeResult(
  base: MiningResult,
  delta: {
    readonly entries?: number;
    readonly verbatim?: number;
    readonly observations?: number;
    readonly domain?: string;
    readonly topic?: string;
    readonly error?: string;
  },
): MiningResult {
  const domains = delta.domain && !base.domainsDetected.includes(delta.domain)
    ? [...base.domainsDetected, delta.domain]
    : base.domainsDetected;

  const topics = delta.topic && !base.topicsDetected.includes(delta.topic)
    ? [...base.topicsDetected, delta.topic]
    : base.topicsDetected;

  const errors = delta.error
    ? [...base.errors, delta.error]
    : base.errors;

  return {
    entriesCreated: base.entriesCreated + (delta.entries ?? 0),
    verbatimStored: base.verbatimStored + (delta.verbatim ?? 0),
    observationsExtracted: base.observationsExtracted + (delta.observations ?? 0),
    domainsDetected: domains,
    topicsDetected: topics,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Store a single chunk: verbatim + observations
// ---------------------------------------------------------------------------

function processChunk(
  store: MemoryStore,
  chunk: Chunk,
  config: MinerConfig,
): MiningResult {
  let result = emptyResult();

  const domain = inferDomain(chunk.text) ?? config.defaultDomain;
  const topic = inferTopic(chunk.text);

  // Store verbatim
  store.storeVerbatim(chunk.text, {
    contentType: "conversation",
    sessionId: config.sessionId,
    domain,
    topic: topic ?? "",
  });
  result = mergeResult(result, { verbatim: 1, domain, topic: topic ?? undefined });

  // Extract observations
  const observations = extractObservations(chunk.text);
  for (const obs of observations) {
    const entryId = randomUUID();
    store.insert({
      id: entryId,
      layer: "core_blocks",
      blockType: obs.kind === "decision" ? "decisions" : obs.kind === "problem" ? "issues" : "patterns",
      key: obs.key,
      value: obs.value,
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: obs.confidence,
      verificationStatus: "unverified",
      domain,
      topic: topic ?? "",
      sessionId: config.sessionId,
    });
    result = mergeResult(result, { entries: 1, observations: 1 });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Claude export message shape
// ---------------------------------------------------------------------------

interface ClaudeMessage {
  readonly role: string;
  readonly content: string;
}

function parseClaudeMessages(jsonContent: string): readonly ClaudeMessage[] {
  const parsed: unknown = JSON.parse(jsonContent);
  if (!Array.isArray(parsed)) {
    throw new Error("Claude export must be a JSON array of messages");
  }
  return parsed.map((item: unknown, idx: number) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Message at index ${idx} is not an object`);
    }
    const msg = item as Record<string, unknown>;
    if (typeof msg["role"] !== "string" || typeof msg["content"] !== "string") {
      throw new Error(`Message at index ${idx} missing role/content string fields`);
    }
    return { role: msg["role"] as string, content: msg["content"] as string };
  });
}

// ---------------------------------------------------------------------------
// Slack export message shape
// ---------------------------------------------------------------------------

interface SlackMessage {
  readonly user: string;
  readonly text: string;
  readonly ts: string;
}

function parseSlackMessages(jsonContent: string): readonly SlackMessage[] {
  const parsed: unknown = JSON.parse(jsonContent);
  if (!Array.isArray(parsed)) {
    throw new Error("Slack export must be a JSON array of messages");
  }
  return parsed.map((item: unknown, idx: number) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Slack message at index ${idx} is not an object`);
    }
    const msg = item as Record<string, unknown>;
    if (typeof msg["user"] !== "string" || typeof msg["text"] !== "string" || typeof msg["ts"] !== "string") {
      throw new Error(`Slack message at index ${idx} missing user/text/ts string fields`);
    }
    return { user: msg["user"] as string, text: msg["text"] as string, ts: msg["ts"] as string };
  });
}

// ---------------------------------------------------------------------------
// ConversationMiner
// ---------------------------------------------------------------------------

export class ConversationMiner {
  private readonly store: MemoryStore;
  private readonly config: MinerConfig;

  constructor(store: MemoryStore, config?: Partial<MinerConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Mine a Claude conversation JSON export.
   * Expected format: array of {role: string, content: string}.
   */
  mineClaudeExport(jsonContent: string): MiningResult {
    let result = emptyResult();

    let messages: readonly ClaudeMessage[];
    try {
      messages = parseClaudeMessages(jsonContent);
    } catch (err) {
      return mergeResult(result, {
        error: `Failed to parse Claude export: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    if (messages.length === 0) return result;

    // Group consecutive messages into conversational chunks
    const chunks: Chunk[] = [];
    let buffer = "";
    for (const msg of messages) {
      const line = `[${msg.role}] ${msg.content}`;
      if (buffer.length + line.length + 1 > this.config.maxChunkSize && buffer.length >= this.config.minChunkSize) {
        chunks.push({ text: buffer, source: "claude-export" });
        buffer = line;
      } else {
        buffer = buffer.length > 0 ? `${buffer}\n${line}` : line;
      }
    }
    if (buffer.length >= this.config.minChunkSize) {
      chunks.push({ text: buffer, source: "claude-export" });
    }

    for (const chunk of chunks) {
      const chunkResult = processChunk(this.store, chunk, this.config);
      result = mergeResult(result, {
        entries: chunkResult.entriesCreated,
        verbatim: chunkResult.verbatimStored,
        observations: chunkResult.observationsExtracted,
      });
      // Accumulate domains and topics
      for (const d of chunkResult.domainsDetected) {
        result = mergeResult(result, { domain: d });
      }
      for (const t of chunkResult.topicsDetected) {
        result = mergeResult(result, { topic: t });
      }
    }

    return result;
  }

  /**
   * Mine a Slack channel export.
   * Expected format: array of {user: string, text: string, ts: string}.
   */
  mineSlackExport(jsonContent: string): MiningResult {
    let result = emptyResult();

    let messages: readonly SlackMessage[];
    try {
      messages = parseSlackMessages(jsonContent);
    } catch (err) {
      return mergeResult(result, {
        error: `Failed to parse Slack export: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    if (messages.length === 0) return result;

    const chunks: Chunk[] = [];
    let buffer = "";
    for (const msg of messages) {
      const line = `[${msg.user}] ${msg.text}`;
      if (buffer.length + line.length + 1 > this.config.maxChunkSize && buffer.length >= this.config.minChunkSize) {
        chunks.push({ text: buffer, source: "slack-export", timestamp: msg.ts });
        buffer = line;
      } else {
        buffer = buffer.length > 0 ? `${buffer}\n${line}` : line;
      }
    }
    if (buffer.length >= this.config.minChunkSize) {
      chunks.push({ text: buffer, source: "slack-export" });
    }

    for (const chunk of chunks) {
      const chunkResult = processChunk(this.store, chunk, this.config);
      result = mergeResult(result, {
        entries: chunkResult.entriesCreated,
        verbatim: chunkResult.verbatimStored,
        observations: chunkResult.observationsExtracted,
      });
      for (const d of chunkResult.domainsDetected) {
        result = mergeResult(result, { domain: d });
      }
      for (const t of chunkResult.topicsDetected) {
        result = mergeResult(result, { topic: t });
      }
    }

    return result;
  }

  /**
   * Mine any plain text. Splits by paragraphs, extracts observations.
   */
  mineGenericText(text: string, source?: string): MiningResult {
    let result = emptyResult();

    const chunks = splitIntoChunks(
      text,
      this.config.maxChunkSize,
      this.config.minChunkSize,
      source ?? "generic-text",
    );

    if (chunks.length === 0) return result;

    for (const chunk of chunks) {
      const chunkResult = processChunk(this.store, chunk, this.config);
      result = mergeResult(result, {
        entries: chunkResult.entriesCreated,
        verbatim: chunkResult.verbatimStored,
        observations: chunkResult.observationsExtracted,
      });
      for (const d of chunkResult.domainsDetected) {
        result = mergeResult(result, { domain: d });
      }
      for (const t of chunkResult.topicsDetected) {
        result = mergeResult(result, { topic: t });
      }
    }

    return result;
  }

  /**
   * Mine existing auto-capture entries from the store.
   */
  mineAutoCaptureEntries(entries: readonly AutoCaptureEntry[]): MiningResult {
    let result = emptyResult();

    for (const entry of entries) {
      if (entry.content.length < this.config.minChunkSize) continue;

      const text = entry.content.slice(0, this.config.maxChunkSize);
      const chunk: Chunk = {
        text,
        source: `auto-capture:${entry.eventType}`,
        timestamp: entry.createdAt,
      };

      const chunkResult = processChunk(this.store, chunk, this.config);
      result = mergeResult(result, {
        entries: chunkResult.entriesCreated,
        verbatim: chunkResult.verbatimStored,
        observations: chunkResult.observationsExtracted,
      });
      for (const d of chunkResult.domainsDetected) {
        result = mergeResult(result, { domain: d });
      }
      for (const t of chunkResult.topicsDetected) {
        result = mergeResult(result, { topic: t });
      }
    }

    return result;
  }
}
