/**
 * Instinct System: pattern-driven instincts with confidence scoring.
 *
 * Instincts are learned behavioral patterns that accumulate through
 * observation. Confidence grows with positive reinforcement and
 * decays exponentially over time without reinforcement.
 *
 * High-confidence instincts (>0.9) become skill candidates
 * and feed into the SkillForge pipeline.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import type { Instinct } from "./types.js";
import type { MemoryStore } from "../memory/store.js";

export type { Instinct };

// ── Types ──────────────────────────────────────────────────

export interface InstinctSuggestion {
  readonly instinct: Instinct;
  readonly relevance: number;
}

export interface ObservationResult {
  readonly matchedInstincts: number;
  readonly createdInstincts: number;
  readonly updatedInstincts: number;
}

// ── Constants ──────────────────────────────────────────────

const DEFAULT_CONFIDENCE_THRESHOLD = 0.3;
const INITIAL_CONFIDENCE = 0.5;
const POSITIVE_REINFORCEMENT_BOOST = 0.08;
const NEGATIVE_REINFORCEMENT_PENALTY = 0.12;
const DECAY_HALF_LIFE_DAYS = 30;
const SKILL_CANDIDATE_THRESHOLD = 0.9;
const MIN_CONFIDENCE_FLOOR = 0.01;
const MAX_CONFIDENCE_CEILING = 1.0;
const RELEVANCE_KEYWORD_WEIGHT = 0.6;
const RELEVANCE_CONFIDENCE_WEIGHT = 0.4;

// ── Instinct System ────────────────────────────────────────

export class InstinctSystem {
  private readonly instincts: Map<string, Instinct> = new Map();
  private readonly confidenceThreshold: number;
  private readonly persistPath: string | undefined;
  private memoryStore: MemoryStore | null = null;

  constructor(confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD, persistPath?: string) {
    this.confidenceThreshold = confidenceThreshold;
    this.persistPath = persistPath;
    if (persistPath) {
      this.restoreFromDisk(persistPath);
    }
  }

  /**
   * Attach a MemoryStore for persisting instincts with layer="instinct".
   */
  setMemoryStore(store: MemoryStore): void {
    this.memoryStore = store;
    this.syncToMemoryStore();
  }

  /**
   * Record an observation and update matching instincts.
   * Creates new instinct if no existing pattern matches.
   */
  observe(event: string, context: string): ObservationResult {
    let matchedInstincts = 0;
    let updatedInstincts = 0;
    let createdInstincts = 0;

    const now = new Date().toISOString();

    // Check existing instincts for pattern match
    for (const [id, instinct] of this.instincts) {
      if (matchesPattern(event, instinct.pattern)) {
        matchedInstincts++;

        this.instincts.set(id, {
          ...instinct,
          occurrences: instinct.occurrences + 1,
          lastSeen: now,
          confidence: Math.min(
            MAX_CONFIDENCE_CEILING,
            instinct.confidence + 0.02,
          ),
        });

        updatedInstincts++;
      }
    }

    // If no existing instinct matched, create a new one
    if (matchedInstincts === 0) {
      const newInstinct: Instinct = {
        id: randomUUID(),
        pattern: event,
        action: context,
        confidence: INITIAL_CONFIDENCE,
        occurrences: 1,
        lastSeen: now,
        createdAt: now,
        positiveReinforcements: 0,
        negativeReinforcements: 0,
      };

      this.instincts.set(newInstinct.id, newInstinct);
      createdInstincts++;
    }

    if (createdInstincts > 0 || updatedInstincts > 0) {
      this.persist();
    }

    return { matchedInstincts, createdInstincts, updatedInstincts };
  }

  /**
   * Return matching instincts above confidence threshold for a given context.
   */
  suggest(context: string): readonly InstinctSuggestion[] {
    const suggestions: InstinctSuggestion[] = [];

    for (const instinct of this.instincts.values()) {
      if (instinct.confidence < this.confidenceThreshold) continue;

      const relevance = calculateRelevance(context, instinct);
      if (relevance > 0) {
        suggestions.push({ instinct, relevance });
      }
    }

    return suggestions.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Adjust confidence of an instinct based on reinforcement signal.
   */
  reinforce(instinctId: string, positive: boolean): Instinct | null {
    const instinct = this.instincts.get(instinctId);
    if (!instinct) return null;

    const confidenceDelta = positive
      ? POSITIVE_REINFORCEMENT_BOOST
      : -NEGATIVE_REINFORCEMENT_PENALTY;

    const newConfidence = clampConfidence(instinct.confidence + confidenceDelta);

    const updated: Instinct = {
      ...instinct,
      confidence: newConfidence,
      positiveReinforcements: instinct.positiveReinforcements + (positive ? 1 : 0),
      negativeReinforcements: instinct.negativeReinforcements + (positive ? 0 : 1),
      lastSeen: new Date().toISOString(),
    };

    this.instincts.set(instinctId, updated);
    this.persist();
    return updated;
  }

  /**
   * Apply time-based exponential decay to all instincts.
   * Should be called periodically (e.g., at session start).
   */
  applyDecay(currentTime: Date = new Date()): number {
    let decayedCount = 0;

    for (const [id, instinct] of this.instincts) {
      const lastSeenMs = Date.parse(instinct.lastSeen);
      const daysSinceLastSeen = (currentTime.getTime() - lastSeenMs) / (1000 * 60 * 60 * 24);

      if (daysSinceLastSeen <= 0) continue;

      const decayFactor = Math.pow(0.5, daysSinceLastSeen / DECAY_HALF_LIFE_DAYS);
      const decayedConfidence = clampConfidence(instinct.confidence * decayFactor);

      if (decayedConfidence !== instinct.confidence) {
        this.instincts.set(id, {
          ...instinct,
          confidence: decayedConfidence,
        });
        decayedCount++;
      }
    }

    return decayedCount;
  }

  /**
   * Get instincts that have reached skill candidate threshold.
   */
  getSkillCandidates(): readonly Instinct[] {
    return [...this.instincts.values()].filter(
      (i) => i.confidence >= SKILL_CANDIDATE_THRESHOLD,
    );
  }

  /**
   * Get all instincts.
   */
  getAllInstincts(): readonly Instinct[] {
    return [...this.instincts.values()];
  }

  /**
   * Get instinct by ID.
   */
  getInstinct(id: string): Instinct | undefined {
    return this.instincts.get(id);
  }

  /**
   * Get total instinct count.
   */
  getInstinctCount(): number {
    return this.instincts.size;
  }

  /**
   * Remove instincts below a confidence floor.
   * Returns number of pruned instincts.
   */
  prune(minConfidence: number = MIN_CONFIDENCE_FLOOR): number {
    let pruned = 0;

    for (const [id, instinct] of this.instincts) {
      if (instinct.confidence < minConfidence) {
        this.instincts.delete(id);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Write current instincts to disk as JSON.
   * Also syncs high-confidence instincts to MemoryStore.
   * No-op if no persistPath was configured.
   */
  persist(): void {
    if (!this.persistPath) return;
    try {
      const dir = this.persistPath.replace(/[/\\][^/\\]+$/, "");
      mkdirSync(dir, { recursive: true });
      const data = JSON.stringify([...this.instincts.values()], null, 2);
      writeFileSync(this.persistPath, data);
    } catch {
      // Best-effort — do not crash if disk write fails
    }

    this.syncToMemoryStore();
  }

  /**
   * Persist high-confidence instincts to MemoryStore.
   */
  private syncToMemoryStore(): void {
    if (!this.memoryStore) return;
    try {
      const highConfidence = [...this.instincts.values()]
        .filter((i) => i.confidence >= 0.6)
        .slice(0, 20);

      if (highConfidence.length > 0) {
        const summary = highConfidence
          .map((i) => `[${(i.confidence * 100).toFixed(0)}%] ${i.pattern} -> ${i.action}`)
          .join("; ");
        this.memoryStore.captureEvent(
          "instinct_sync",
          summary.slice(0, 2000),
          "learning",
        );
      }
    } catch {
      // Best-effort
    }
  }

  /**
   * Load instincts from a JSON file on disk.
   */
  private restoreFromDisk(path: string): void {
    if (!existsSync(path)) return;
    try {
      const raw = readFileSync(path, "utf-8");
      const entries = JSON.parse(raw) as Instinct[];
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (entry.id) {
          this.instincts.set(entry.id, entry);
        }
      }
    } catch {
      // Ignore corrupt data
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

function matchesPattern(event: string, pattern: string): boolean {
  const eventLower = event.toLowerCase();
  const patternLower = pattern.toLowerCase();

  // Exact match
  if (eventLower === patternLower) return true;

  // Keyword overlap: at least 60% of pattern words must appear in event
  const patternWords = patternLower.split(/\s+/).filter((w) => w.length > 2);
  const eventWords = new Set(eventLower.split(/\s+/));

  if (patternWords.length === 0) return false;

  const matchCount = patternWords.filter((pw) => eventWords.has(pw)).length;
  return matchCount / patternWords.length >= 0.6;
}

function calculateRelevance(context: string, instinct: Instinct): number {
  const contextLower = context.toLowerCase();
  const patternLower = instinct.pattern.toLowerCase();
  const actionLower = instinct.action.toLowerCase();

  // Keyword overlap score
  const contextWords = contextLower.split(/\s+/).filter((w) => w.length > 2);
  const patternWords = new Set(patternLower.split(/\s+/).filter((w) => w.length > 2));
  const actionWords = new Set(actionLower.split(/\s+/).filter((w) => w.length > 2));

  if (contextWords.length === 0) return 0;

  const patternMatches = contextWords.filter((w) => patternWords.has(w)).length;
  const actionMatches = contextWords.filter((w) => actionWords.has(w)).length;
  const keywordScore = (patternMatches + actionMatches) / (contextWords.length * 2);

  if (keywordScore === 0) return 0;

  return (
    keywordScore * RELEVANCE_KEYWORD_WEIGHT
    + instinct.confidence * RELEVANCE_CONFIDENCE_WEIGHT
  );
}

function clampConfidence(value: number): number {
  return Math.max(MIN_CONFIDENCE_FLOOR, Math.min(MAX_CONFIDENCE_CEILING, value));
}
