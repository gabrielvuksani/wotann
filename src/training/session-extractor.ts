/**
 * Session Extractor -- extract training data from session recordings.
 *
 * Parses ReplaySession objects into training pairs, filtering for quality
 * and removing near-duplicates. Designed to work with the session-replay
 * module's recorded sessions.
 *
 * Pipeline:
 * 1. Parse session events into prompt/response pairs
 * 2. Score quality (keep only >= 0.7)
 * 3. Deduplicate near-identical pairs
 * 4. Add metadata (provider, model, success, duration)
 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReplaySession, ReplayEvent } from "../telemetry/session-replay.js";

// ── Types ────────────────────────────────────────────────

export interface ExtractedPair {
  readonly id: string;
  readonly prompt: string;
  readonly response: string;
  readonly metadata: PairMetadata;
}

export interface PairMetadata {
  readonly provider: string;
  readonly model: string;
  readonly success: boolean;
  readonly duration: number;
  readonly quality: number;
}

export interface ExtractionResult {
  readonly pairs: readonly ExtractedPair[];
  readonly totalEvents: number;
  readonly pairsExtracted: number;
  readonly pairsAfterFilter: number;
  readonly pairsAfterDedup: number;
}

// ── Quality Scoring ──────────────────────────────────────

function scoreQuality(prompt: string, response: string): number {
  let score = 0.5;

  // Response length quality
  if (response.length >= 50 && response.length <= 4000) {
    score += 0.2;
  } else if (response.length < 20) {
    score -= 0.3;
  }

  // Prompt specificity (longer prompts tend to be more specific)
  if (prompt.length >= 20) {
    score += 0.1;
  }

  // Code block presence indicates structured output
  if (response.includes("```")) {
    score += 0.1;
  }

  // Error responses are low quality
  if (/error|failed|exception|cannot/i.test(response) && response.length < 100) {
    score -= 0.2;
  }

  // Markdown structure bonus
  if (/^#+\s|^-\s|^\d+\.\s/m.test(response)) {
    score += 0.05;
  }

  // Very short or very long responses penalized
  if (response.length > 8000) {
    score -= 0.15;
  }

  return Math.max(0, Math.min(1, score));
}

// ── Deduplication ────────────────────────────────────────

function computeFingerprint(text: string): string {
  // Normalize whitespace and lowercase for comparison
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function deduplicatePairs(pairs: readonly ExtractedPair[]): readonly ExtractedPair[] {
  const seen = new Set<string>();
  const result: ExtractedPair[] = [];

  for (const pair of pairs) {
    const fingerprint = computeFingerprint(pair.prompt) + "||" + computeFingerprint(pair.response);
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      result.push(pair);
    }
  }

  return result;
}

// ── SessionExtractor Class ───────────────────────────────

export class SessionExtractor {
  private readonly qualityThreshold: number;

  constructor(qualityThreshold: number = 0.7) {
    this.qualityThreshold = qualityThreshold;
  }

  /**
   * Extract training pairs from a ReplaySession.
   * Pairs prompt events with their corresponding response events.
   */
  extractFromReplay(session: ReplaySession): ExtractionResult {
    const events = session.events;
    const allPairs: ExtractedPair[] = [];

    // Walk events looking for prompt -> response pairs
    for (let i = 0; i < events.length - 1; i++) {
      const current = events[i];
      const next = events[i + 1];

      if (!current || !next) continue;

      if (current.type === "prompt" && next.type === "response") {
        const prompt = (current.data["prompt"] as string | undefined) ?? "";
        const response = (next.data["response"] as string | undefined) ?? "";

        if (!prompt || !response) continue;

        const quality = scoreQuality(prompt, response);
        const tokens = (next.data["tokens"] as number | undefined) ?? 0;
        const duration = next.timestamp - current.timestamp;

        allPairs.push({
          id: randomUUID(),
          prompt,
          response,
          metadata: {
            provider: session.provider,
            model: session.model,
            success: quality >= this.qualityThreshold,
            duration,
            quality,
          },
        });
      }
    }

    // Filter by quality
    const filtered = allPairs.filter((p) => p.metadata.quality >= this.qualityThreshold);

    // Deduplicate
    const deduplicated = deduplicatePairs(filtered);

    return {
      pairs: deduplicated,
      totalEvents: events.length,
      pairsExtracted: allPairs.length,
      pairsAfterFilter: filtered.length,
      pairsAfterDedup: deduplicated.length,
    };
  }

  /**
   * Process all session files in a directory.
   * Returns aggregated extraction results.
   */
  batchExtract(sessionDir: string): ExtractionResult {
    if (!existsSync(sessionDir)) {
      return {
        pairs: [],
        totalEvents: 0,
        pairsExtracted: 0,
        pairsAfterFilter: 0,
        pairsAfterDedup: 0,
      };
    }

    const files = readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
    let allPairs: ExtractedPair[] = [];
    let totalEvents = 0;
    let totalExtracted = 0;
    let totalFiltered = 0;

    for (const file of files) {
      const filePath = join(sessionDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const session = JSON.parse(content) as ReplaySession;

        if (!session.events || !Array.isArray(session.events)) continue;

        const result = this.extractFromReplay(session);
        allPairs = [...allPairs, ...result.pairs];
        totalEvents += result.totalEvents;
        totalExtracted += result.pairsExtracted;
        totalFiltered += result.pairsAfterFilter;
      } catch {
        // Skip malformed files
        continue;
      }
    }

    // Final deduplication across all sessions
    const deduplicated = deduplicatePairs(allPairs);

    return {
      pairs: deduplicated,
      totalEvents,
      pairsExtracted: totalExtracted,
      pairsAfterFilter: totalFiltered,
      pairsAfterDedup: deduplicated.length,
    };
  }

  /**
   * Get the configured quality threshold.
   */
  getQualityThreshold(): number {
    return this.qualityThreshold;
  }
}
