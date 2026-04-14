/**
 * Three-Phase Dream Pipeline — Light / REM / Deep memory consolidation.
 *
 * Upgrades from AutoDream's single-pass to 3 sequential phases
 * inspired by OpenClaw's sleep-stage architecture:
 *
 * 1. Light Phase (staging): Query recent entries, deduplicate by Jaccard
 *    trigram similarity, stage candidates with frequency/recency scores.
 *
 * 2. REM Phase (reflection): Group candidates by domain/topic using
 *    keyword clustering, build theme summaries, compute reinforcement
 *    signals (recall count, unique query contexts).
 *
 * 3. Deep Phase (promotion): Score each candidate using 6 weighted
 *    signals, apply threshold gates, rehydrate, and promote to
 *    MemoryStore permanent layer.
 *
 * Outputs a human-readable dream diary to ~/.wotann/DREAMS.md.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore, type MemoryEntry, type MemorySearchResult } from "../memory/store.js";

// ── Types ────────────────────────────────────────────────

export interface LightCandidate {
  readonly entryId: string;
  readonly key: string;
  readonly value: string;
  readonly layer: string;
  readonly frequency: number;
  readonly recency: number;
  readonly createdAt: string;
}

export interface REMSignal {
  readonly entryId: string;
  readonly domain: string;
  readonly recallCount: number;
  readonly uniqueQueryContexts: number;
  readonly themeSummary: string;
  readonly keywords: readonly string[];
}

export interface DeepCandidate {
  readonly entryId: string;
  readonly key: string;
  readonly value: string;
  readonly relevanceScore: number;
  readonly frequencyScore: number;
  readonly queryDiversityScore: number;
  readonly recencyScore: number;
  readonly consolidationScore: number;
  readonly conceptualRichnessScore: number;
  readonly finalScore: number;
  readonly promoted: boolean;
}

export interface LightPhaseResult {
  readonly candidates: readonly LightCandidate[];
  readonly duplicatesRemoved: number;
  readonly totalProcessed: number;
}

export interface REMPhaseResult {
  readonly signals: readonly REMSignal[];
  readonly domainCount: number;
  readonly themes: readonly string[];
}

export interface DeepPhaseResult {
  readonly candidates: readonly DeepCandidate[];
  readonly promoted: number;
  readonly rejected: number;
  readonly rehydrationFailures: number;
}

export interface DreamPipelineResult {
  readonly light: LightPhaseResult;
  readonly rem: REMPhaseResult;
  readonly deep: DeepPhaseResult;
  readonly durationMs: number;
  readonly diaryPath: string;
}

// ── Constants ────────────────────────────────────────────

const JACCARD_THRESHOLD = 0.8;
const HOURS_24_MS = 24 * 60 * 60 * 1000;

const SIGNAL_WEIGHTS = {
  relevance: 0.30,
  frequency: 0.24,
  queryDiversity: 0.15,
  recency: 0.15,
  consolidation: 0.10,
  conceptualRichness: 0.06,
} as const;

const PROMOTION_GATES = {
  minScore: 0.6,
  minRecallCount: 3,
  minUniqueQueries: 2,
} as const;

// ── Trigram Utilities ────────────────────────────────────

function extractTrigrams(text: string): ReadonlySet<string> {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const trigrams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Keyword Extraction ───────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "have", "has",
  "had", "do", "does", "did", "will", "would", "could", "should", "may",
  "might", "shall", "can", "to", "of", "in", "for", "on", "with", "at",
  "by", "from", "as", "into", "through", "during", "and", "but", "or",
  "not", "no", "if", "then", "this", "that", "it", "its", "my", "your",
]);

function extractKeywords(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function inferDomain(keywords: readonly string[]): string {
  const domainPatterns: Record<string, readonly string[]> = {
    auth: ["auth", "login", "session", "token", "password", "oauth", "jwt"],
    database: ["database", "query", "schema", "migration", "sql", "table"],
    testing: ["test", "spec", "coverage", "assert", "mock", "fixture"],
    deployment: ["deploy", "docker", "kubernetes", "ci/cd", "pipeline"],
    security: ["security", "vulnerability", "secret", "encryption", "csrf"],
    performance: ["performance", "latency", "cache", "optimize", "benchmark"],
    ui: ["component", "render", "style", "layout", "theme", "animation"],
    api: ["endpoint", "route", "middleware", "request", "response", "rest"],
  };

  let bestDomain = "general";
  let bestScore = 0;

  for (const [domain, patterns] of Object.entries(domainPatterns)) {
    const score = keywords.filter((k) => patterns.some((p) => k.includes(p))).length;
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

// ── Dream Pipeline ───────────────────────────────────────

export class DreamPipeline {
  private readonly memoryStore: MemoryStore;
  private readonly dreamsDir: string;

  constructor(memoryStore: MemoryStore, dreamsDir: string) {
    this.memoryStore = memoryStore;
    this.dreamsDir = dreamsDir;
  }

  /**
   * Synchronous entry point for the 3-phase dream pipeline.
   * All operations are local (SQLite + filesystem) so no async is needed.
   */
  runPipelineSync(): DreamPipelineResult {
    const startTime = Date.now();

    if (!existsSync(this.dreamsDir)) {
      mkdirSync(this.dreamsDir, { recursive: true });
    }

    const lightResult = this.lightPhase();
    this.writePhaseToDisk("light-candidates.json", lightResult);

    const remResult = this.remPhase(lightResult);
    this.writePhaseToDisk("rem-signals.json", remResult);

    const deepResult = this.deepPhase(remResult, lightResult);
    this.promoteEntries(deepResult);

    const diaryPath = this.writeDreamDiary(lightResult, remResult, deepResult);

    return {
      light: lightResult,
      rem: remResult,
      deep: deepResult,
      durationMs: Date.now() - startTime,
      diaryPath,
    };
  }

  /** @deprecated Use runPipelineSync() — async wrapper kept for backward compatibility */
  async runPipeline(): Promise<DreamPipelineResult> {
    return this.runPipelineSync();
  }

  // ── Light Phase (Staging) ──────────────────────────────

  private lightPhase(): LightPhaseResult {
    const cutoffIso = new Date(Date.now() - HOURS_24_MS).toISOString();
    const recentEntries = this.getRecentEntries(cutoffIso);

    const trigramCache = new Map<string, ReadonlySet<string>>();
    const deduped: MemoryEntry[] = [];
    let duplicatesRemoved = 0;

    for (const entry of recentEntries) {
      const entryTrigrams = extractTrigrams(entry.value);
      trigramCache.set(entry.id, entryTrigrams);

      let isDuplicate = false;
      for (const kept of deduped) {
        const keptTrigrams = trigramCache.get(kept.id);
        if (keptTrigrams && jaccardSimilarity(entryTrigrams, keptTrigrams) > JACCARD_THRESHOLD) {
          isDuplicate = true;
          duplicatesRemoved++;
          break;
        }
      }

      if (!isDuplicate) {
        deduped.push(entry);
      }
    }

    const now = Date.now();
    const candidates: LightCandidate[] = deduped.map((entry) => {
      const ageMs = now - Date.parse(entry.createdAt);
      const recency = Math.max(0, 1 - ageMs / HOURS_24_MS);
      return {
        entryId: entry.id,
        key: entry.key,
        value: entry.value,
        layer: entry.layer,
        frequency: 1,
        recency,
        createdAt: entry.createdAt,
      };
    });

    return {
      candidates,
      duplicatesRemoved,
      totalProcessed: recentEntries.length,
    };
  }

  // ── REM Phase (Reflection) ─────────────────────────────

  private remPhase(lightResult: LightPhaseResult): REMPhaseResult {
    const domainGroups = new Map<string, Array<{ candidate: LightCandidate; keywords: readonly string[] }>>();

    for (const candidate of lightResult.candidates) {
      const keywords = extractKeywords(candidate.value);
      const domain = inferDomain(keywords);
      const existing = domainGroups.get(domain) ?? [];
      domainGroups.set(domain, [...existing, { candidate, keywords }]);
    }

    const signals: REMSignal[] = [];
    const themes: string[] = [];

    for (const [domain, members] of domainGroups) {
      const allKeywords = members.flatMap((m) => m.keywords);
      const keywordFrequency = new Map<string, number>();
      for (const kw of allKeywords) {
        keywordFrequency.set(kw, (keywordFrequency.get(kw) ?? 0) + 1);
      }

      const topKeywords = [...keywordFrequency.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([kw]) => kw);

      const themeSummary = `${domain}: ${topKeywords.join(", ")} (${members.length} entries)`;
      themes.push(themeSummary);

      for (const member of members) {
        const uniqueContexts = new Set(member.keywords).size;
        const searchResults = this.safeSearch(member.candidate.key, 5);
        const recallCount = searchResults.length;

        signals.push({
          entryId: member.candidate.entryId,
          domain,
          recallCount,
          uniqueQueryContexts: uniqueContexts,
          themeSummary,
          keywords: member.keywords,
        });
      }
    }

    return {
      signals,
      domainCount: domainGroups.size,
      themes,
    };
  }

  // ── Deep Phase (Promotion) ─────────────────────────────

  private deepPhase(remResult: REMPhaseResult, lightResult: LightPhaseResult): DeepPhaseResult {
    const candidateMap = new Map<string, LightCandidate>();
    for (const c of lightResult.candidates) {
      candidateMap.set(c.entryId, c);
    }

    const signalMap = new Map<string, REMSignal>();
    for (const s of remResult.signals) {
      signalMap.set(s.entryId, s);
    }

    let rehydrationFailures = 0;
    const deepCandidates: DeepCandidate[] = [];

    for (const [entryId, lightCandidate] of candidateMap) {
      const signal = signalMap.get(entryId);
      if (!signal) continue;

      // Rehydrate: verify source content still exists
      const entry = this.memoryStore.getById(entryId);
      if (!entry) {
        rehydrationFailures++;
        continue;
      }

      // Score each signal
      const searchResults = this.safeSearch(lightCandidate.key, 10);
      const avgRetrievalScore = searchResults.length > 0
        ? searchResults.reduce((sum, r) => sum + Math.abs(r.score), 0) / searchResults.length
        : 0;
      const relevanceScore = Math.min(1, avgRetrievalScore / 10);
      const frequencyScore = Math.min(1, signal.recallCount / 10);
      const queryDiversityScore = Math.min(1, signal.uniqueQueryContexts / 8);
      const recencyScore = lightCandidate.recency;

      // Consolidation: check if entry appeared on multiple days
      const daysSinceCreation = (Date.now() - Date.parse(lightCandidate.createdAt)) / (24 * 60 * 60 * 1000);
      const consolidationScore = daysSinceCreation > 1 ? Math.min(1, daysSinceCreation / 7) : 0;

      // Conceptual richness: keyword density
      const keywords = extractKeywords(lightCandidate.value);
      const uniqueKeywords = new Set(keywords);
      const wordCount = lightCandidate.value.split(/\s+/).length;
      const conceptualRichnessScore = wordCount > 0 ? Math.min(1, uniqueKeywords.size / (wordCount * 0.5)) : 0;

      // Weighted final score
      const finalScore =
        SIGNAL_WEIGHTS.relevance * relevanceScore +
        SIGNAL_WEIGHTS.frequency * frequencyScore +
        SIGNAL_WEIGHTS.queryDiversity * queryDiversityScore +
        SIGNAL_WEIGHTS.recency * recencyScore +
        SIGNAL_WEIGHTS.consolidation * consolidationScore +
        SIGNAL_WEIGHTS.conceptualRichness * conceptualRichnessScore;

      const promoted =
        finalScore >= PROMOTION_GATES.minScore &&
        signal.recallCount >= PROMOTION_GATES.minRecallCount &&
        signal.uniqueQueryContexts >= PROMOTION_GATES.minUniqueQueries;

      deepCandidates.push({
        entryId,
        key: lightCandidate.key,
        value: lightCandidate.value,
        relevanceScore,
        frequencyScore,
        queryDiversityScore,
        recencyScore,
        consolidationScore,
        conceptualRichnessScore,
        finalScore,
        promoted,
      });
    }

    return {
      candidates: deepCandidates,
      promoted: deepCandidates.filter((c) => c.promoted).length,
      rejected: deepCandidates.filter((c) => !c.promoted).length,
      rehydrationFailures,
    };
  }

  // ── Promotion ──────────────────────────────────────────

  private promoteEntries(deepResult: DeepPhaseResult): void {
    for (const candidate of deepResult.candidates) {
      if (!candidate.promoted) continue;

      const existing = this.memoryStore.getById(candidate.entryId);
      if (!existing) continue;

      // If already in archival layer, skip
      if (existing.layer === "archival") continue;

      // Promote by inserting into archival layer with boosted confidence
      this.memoryStore.insert({
        id: `promoted-${candidate.entryId}-${Date.now()}`,
        layer: "archival",
        blockType: existing.blockType,
        key: `[dream-promoted] ${existing.key}`,
        value: existing.value,
        verified: true,
        confidence: candidate.finalScore,
        freshnessScore: 1.0,
        confidenceLevel: candidate.finalScore,
        verificationStatus: "verified",
      });
    }
  }

  // ── Dream Diary ────────────────────────────────────────

  private writeDreamDiary(
    lightResult: LightPhaseResult,
    remResult: REMPhaseResult,
    deepResult: DeepPhaseResult,
  ): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19);

    const promoted = deepResult.candidates.filter((c) => c.promoted);
    const topPromoted = [...promoted]
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 10);

    const lines: string[] = [
      `# Dream Diary — ${dateStr}`,
      "",
      `*Dreamed at ${timeStr} UTC*`,
      "",
      "## Summary",
      "",
      `- **Entries processed:** ${lightResult.totalProcessed}`,
      `- **Duplicates removed:** ${lightResult.duplicatesRemoved}`,
      `- **Candidates staged:** ${lightResult.candidates.length}`,
      `- **Domains discovered:** ${remResult.domainCount}`,
      `- **Entries promoted:** ${deepResult.promoted}`,
      `- **Entries rejected:** ${deepResult.rejected}`,
      `- **Rehydration failures:** ${deepResult.rehydrationFailures}`,
      "",
      "## Themes Discovered",
      "",
    ];

    for (const theme of remResult.themes) {
      lines.push(`- ${theme}`);
    }

    if (topPromoted.length > 0) {
      lines.push("");
      lines.push("## Top Promoted Memories");
      lines.push("");
      for (const entry of topPromoted) {
        lines.push(`### ${entry.key} (score: ${entry.finalScore.toFixed(3)})`);
        lines.push("");
        lines.push(`> ${entry.value.slice(0, 200)}${entry.value.length > 200 ? "..." : ""}`);
        lines.push("");
        lines.push(`Relevance: ${entry.relevanceScore.toFixed(2)} | ` +
          `Frequency: ${entry.frequencyScore.toFixed(2)} | ` +
          `Diversity: ${entry.queryDiversityScore.toFixed(2)} | ` +
          `Recency: ${entry.recencyScore.toFixed(2)} | ` +
          `Consolidation: ${entry.consolidationScore.toFixed(2)} | ` +
          `Richness: ${entry.conceptualRichnessScore.toFixed(2)}`);
        lines.push("");
      }
    }

    lines.push("---");
    lines.push(`*Generated by WOTANN Dream Pipeline v1.0*`);

    const diaryDir = join(this.dreamsDir, "..");
    const diaryPath = join(diaryDir, "DREAMS.md");
    const content = lines.join("\n") + "\n";

    // Append to existing diary or create new
    if (existsSync(diaryPath)) {
      const existing = readFileSync(diaryPath, "utf-8");
      writeFileSync(diaryPath, `${content}\n${existing}`);
    } else {
      writeFileSync(diaryPath, content);
    }

    return diaryPath;
  }

  // ── Helpers ────────────────────────────────────────────

  private getRecentEntries(cutoffIso: string): readonly MemoryEntry[] {
    // Get entries from auto_capture and core_blocks within the time window
    const allEntries = [
      ...this.memoryStore.getByLayer("auto_capture"),
      ...this.memoryStore.getByLayer("core_blocks"),
      ...this.memoryStore.getByLayer("working"),
    ];
    return allEntries.filter((e) => e.createdAt >= cutoffIso);
  }

  private safeSearch(query: string, limit: number): readonly MemorySearchResult[] {
    try {
      return this.memoryStore.search(query, limit);
    } catch {
      return [];
    }
  }

  private writePhaseToDisk(filename: string, data: unknown): void {
    try {
      writeFileSync(
        join(this.dreamsDir, filename),
        JSON.stringify(data, null, 2),
      );
    } catch {
      // Best-effort persistence — do not crash the pipeline
    }
  }
}
