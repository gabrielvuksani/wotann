/**
 * Context Relevance Scorer — smart context selection (Cursor-inspired).
 *
 * Research sources:
 * - Cursor dynamic context discovery: 46.9% token reduction from selective
 *   MCP tool loading, tool output to files, chat history preservation
 * - arxiv 2603.05344 (OpenDev): Lazy tool discovery, adaptive compaction,
 *   workload-specialized context budgets
 * - SWE-bench Pro: Search subagents (28% time reduction), fresh context
 *   per subagent prevents accumulated context noise
 * - LangChain: LocalContextMiddleware for environment bootstrapping,
 *   context injection reduces error surface
 *
 * Key insight: Models degrade when context is bloated with irrelevant info.
 * The L0/L1/L2 tiered loading pattern from Cursor achieves up to 91% token
 * savings by only loading full file content when actually needed.
 *
 * Tiers:
 * - L0: File names and types only (~10 tokens per file)
 * - L1: File names + function/class signatures (~50-100 tokens per file)
 * - L2: Full file content (~500-5000 tokens per file)
 *
 * The scorer determines which tier each file should be loaded at based on
 * relevance to the current task.
 */

// ── Types ────────────────────────────────────────────────────

export interface FileInfo {
  readonly path: string;
  readonly size: number;
  readonly language: string;
  readonly lastModified: number;
  readonly exports?: readonly string[];
  readonly imports?: readonly string[];
}

export interface MemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly timestamp: number;
  readonly type: string;
  readonly tags: readonly string[];
}

export interface ScoredFile {
  readonly file: FileInfo;
  readonly score: number;
  readonly tier: ContextTier;
  readonly reason: string;
  readonly estimatedTokens: number;
}

export interface ScoredMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
  readonly reason: string;
}

export type ContextTier = "L0" | "L1" | "L2";

export interface DiscoveredContext {
  readonly relevantFiles: readonly ScoredFile[];
  readonly relevantMemory: readonly ScoredMemory[];
  readonly totalTokenEstimate: number;
  readonly budgetUsed: number;
  readonly tieredBreakdown: TieredBreakdown;
}

export interface TieredBreakdown {
  readonly l0Count: number;
  readonly l1Count: number;
  readonly l2Count: number;
  readonly l0Tokens: number;
  readonly l1Tokens: number;
  readonly l2Tokens: number;
}

export interface TieredContext {
  readonly l0Files: readonly ScoredFile[];
  readonly l1Files: readonly ScoredFile[];
  readonly l2Files: readonly ScoredFile[];
  readonly totalTokens: number;
  readonly tokenSavings: number;
  readonly savingsPercent: number;
}

// ── Token Estimation Constants ───────────────────────────────

const TOKENS_PER_FILE_NAME = 10;
const TOKENS_PER_SIGNATURE = 50;
const TOKENS_PER_LINE = 4;

// ── ContextRelevanceScorer ───────────────────────────────────

export class ContextRelevanceScorer {
  /**
   * Score files by relevance to the current task.
   * Returns files sorted by relevance (highest first), each assigned a tier.
   */
  scoreFiles(files: readonly FileInfo[], query: string): readonly ScoredFile[] {
    const querySignals = extractQuerySignals(query);

    return files
      .map((file) => {
        const score = this.computeFileScore(file, querySignals);
        const tier = scoreTier(score);
        const reason = this.explainFileScore(file, querySignals, score);
        const estimatedTokens = estimateTokensForTier(file, tier);

        return { file, score, tier, reason, estimatedTokens };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Score memory entries by relevance to the current query.
   */
  scoreMemory(entries: readonly MemoryEntry[], query: string): readonly ScoredMemory[] {
    const queryTokens = tokenize(query);

    return entries
      .map((entry) => {
        const contentTokens = tokenize(entry.content);
        const tagTokens = entry.tags.flatMap((t) => tokenize(t));
        const allTokens = [...contentTokens, ...tagTokens];

        const score = computeTokenOverlap(queryTokens, allTokens);
        const reason = this.explainMemoryScore(entry, queryTokens, score);

        return { entry, score, reason };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Dynamic context discovery — find relevant context without reading everything.
   * Returns scored files and memory entries within the given token budget.
   */
  discoverRelevantContext(
    query: string,
    files: readonly FileInfo[],
    memory: readonly MemoryEntry[],
    budget: number = 50000,
  ): DiscoveredContext {
    const scoredFiles = this.scoreFiles(files, query);
    const scoredMemory = this.scoreMemory(memory, query);

    // Pack files into budget using tiered loading
    const { packedFiles, totalTokens } = this.packIntoBudget(scoredFiles, budget);

    const tieredBreakdown = this.computeTieredBreakdown(packedFiles);

    return {
      relevantFiles: packedFiles,
      relevantMemory: scoredMemory.filter((m) => m.score > 0.1),
      totalTokenEstimate: totalTokens,
      budgetUsed: budget > 0 ? totalTokens / budget : 0,
      tieredBreakdown,
    };
  }

  /**
   * L0/L1/L2 tiered loading — load context at the appropriate detail level.
   *
   * L0: File names only (~10 tokens each) — for files barely relevant
   * L1: Names + signatures (~50-100 tokens each) — for moderately relevant files
   * L2: Full content (~500-5000 tokens each) — for highly relevant files
   *
   * This achieves up to 91% token savings compared to loading everything at L2.
   */
  loadTieredContext(
    files: readonly FileInfo[],
    query: string,
    budget: number = 50000,
  ): TieredContext {
    const scored = this.scoreFiles(files, query);

    const l0Files: ScoredFile[] = [];
    const l1Files: ScoredFile[] = [];
    const l2Files: ScoredFile[] = [];

    let totalTokens = 0;

    for (const file of scored) {
      if (totalTokens >= budget) break;

      const tokensNeeded = file.estimatedTokens;
      if (totalTokens + tokensNeeded > budget && file.tier !== "L0") {
        // Downgrade tier to fit in budget
        const downgraded = { ...file, tier: "L0" as ContextTier, estimatedTokens: TOKENS_PER_FILE_NAME };
        l0Files.push(downgraded);
        totalTokens += TOKENS_PER_FILE_NAME;
      } else {
        totalTokens += tokensNeeded;
        switch (file.tier) {
          case "L0": l0Files.push(file); break;
          case "L1": l1Files.push(file); break;
          case "L2": l2Files.push(file); break;
        }
      }
    }

    // Compute savings vs loading everything at L2
    const fullLoadTokens = scored.reduce(
      (sum, f) => sum + estimateTokensForTier(f.file, "L2"),
      0,
    );
    const tokenSavings = Math.max(0, fullLoadTokens - totalTokens);
    const savingsPercent = fullLoadTokens > 0
      ? Math.max(0, Math.round(((fullLoadTokens - totalTokens) / fullLoadTokens) * 100))
      : 0;

    return {
      l0Files,
      l1Files,
      l2Files,
      totalTokens,
      tokenSavings,
      savingsPercent,
    };
  }

  // ── Private Helpers ──────────────────────────────────────

  private computeFileScore(file: FileInfo, signals: QuerySignals): number {
    let score = 0;

    // Direct path match (highest signal)
    const pathSegments = file.path.toLowerCase().split("/");
    for (const segment of pathSegments) {
      if (signals.mentionedFiles.some((f) => segment.includes(f))) {
        score += 0.8;
      }
    }

    // Language match
    if (signals.languages.has(file.language)) {
      score += 0.1;
    }

    // Keyword match in path
    for (const keyword of signals.keywords) {
      if (file.path.toLowerCase().includes(keyword)) {
        score += 0.3;
      }
    }

    // Export/import overlap
    if (file.exports) {
      for (const exp of file.exports) {
        if (signals.keywords.some((k) => exp.toLowerCase().includes(k))) {
          score += 0.4;
        }
      }
    }

    // Recency bonus (files modified recently are more relevant)
    const ageMs = Date.now() - file.lastModified;
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < 1) score += 0.2;
    else if (ageHours < 24) score += 0.1;

    // Size penalty (very large files are less likely to be fully relevant)
    if (file.size > 10000) score -= 0.1;

    return Math.min(1, Math.max(0, score));
  }

  private explainFileScore(file: FileInfo, signals: QuerySignals, score: number): string {
    const reasons: string[] = [];

    const pathLower = file.path.toLowerCase();
    for (const mentioned of signals.mentionedFiles) {
      if (pathLower.includes(mentioned)) {
        reasons.push(`directly mentioned ("${mentioned}")`);
      }
    }
    for (const keyword of signals.keywords) {
      if (pathLower.includes(keyword)) {
        reasons.push(`path contains "${keyword}"`);
      }
    }
    if (signals.languages.has(file.language)) {
      reasons.push(`matching language (${file.language})`);
    }

    if (reasons.length === 0) {
      return score > 0 ? "Weak relevance signal" : "Not relevant";
    }
    return reasons.join(", ");
  }

  private explainMemoryScore(
    entry: MemoryEntry,
    queryTokens: readonly string[],
    score: number,
  ): string {
    if (score === 0) return "No matching terms";

    const contentTokens = new Set(tokenize(entry.content));
    const matched = queryTokens.filter((t) => contentTokens.has(t));

    if (matched.length === 0) return "Matched via tags";
    return `Matched terms: [${matched.slice(0, 5).join(", ")}]`;
  }

  private packIntoBudget(
    scored: readonly ScoredFile[],
    budget: number,
  ): { packedFiles: readonly ScoredFile[]; totalTokens: number } {
    const packed: ScoredFile[] = [];
    let totalTokens = 0;

    for (const file of scored) {
      if (totalTokens >= budget) break;

      const remaining = budget - totalTokens;
      if (file.estimatedTokens <= remaining) {
        packed.push(file);
        totalTokens += file.estimatedTokens;
      } else if (remaining >= TOKENS_PER_FILE_NAME) {
        // Downgrade to L0 to fit
        packed.push({
          ...file,
          tier: "L0",
          estimatedTokens: TOKENS_PER_FILE_NAME,
          reason: `${file.reason} (downgraded to L0 due to budget)`,
        });
        totalTokens += TOKENS_PER_FILE_NAME;
      }
    }

    return { packedFiles: packed, totalTokens };
  }

  private computeTieredBreakdown(files: readonly ScoredFile[]): TieredBreakdown {
    let l0Count = 0, l1Count = 0, l2Count = 0;
    let l0Tokens = 0, l1Tokens = 0, l2Tokens = 0;

    for (const file of files) {
      switch (file.tier) {
        case "L0":
          l0Count++;
          l0Tokens += file.estimatedTokens;
          break;
        case "L1":
          l1Count++;
          l1Tokens += file.estimatedTokens;
          break;
        case "L2":
          l2Count++;
          l2Tokens += file.estimatedTokens;
          break;
      }
    }

    return { l0Count, l1Count, l2Count, l0Tokens, l1Tokens, l2Tokens };
  }
}

// ── Query Signal Extraction ──────────────────────────────────

interface QuerySignals {
  readonly keywords: readonly string[];
  readonly mentionedFiles: readonly string[];
  readonly languages: ReadonlySet<string>;
}

function extractQuerySignals(query: string): QuerySignals {
  const lower = query.toLowerCase();

  // Extract file references
  const fileMatches = query.match(/[\w.-]+\.\w{1,5}/g) ?? [];
  const mentionedFiles = fileMatches.map((f) => f.toLowerCase());

  // Extract meaningful keywords (filter out stop words)
  const keywords = tokenize(query).filter((t) => !STOP_WORDS.has(t));

  // Detect languages mentioned
  const languages = new Set<string>();
  if (/\b(typescript|\.ts)\b/i.test(lower)) languages.add("typescript");
  if (/\b(javascript|\.js)\b/i.test(lower)) languages.add("javascript");
  if (/\b(python|\.py)\b/i.test(lower)) languages.add("python");
  if (/\b(rust|\.rs)\b/i.test(lower)) languages.add("rust");
  if (/\b(go|\.go)\b/i.test(lower)) languages.add("go");

  return { keywords, mentionedFiles, languages };
}

// ── Tier Assignment ──────────────────────────────────────────

function scoreTier(score: number): ContextTier {
  if (score >= 0.6) return "L2";
  if (score >= 0.3) return "L1";
  return "L0";
}

function estimateTokensForTier(file: FileInfo, tier: ContextTier): number {
  switch (tier) {
    case "L0":
      return TOKENS_PER_FILE_NAME;
    case "L1": {
      const signatureCount = (file.exports?.length ?? 0) + 5; // Assume ~5 internal signatures
      return TOKENS_PER_FILE_NAME + signatureCount * TOKENS_PER_SIGNATURE;
    }
    case "L2": {
      const estimatedLines = Math.ceil(file.size / 40); // ~40 chars per line
      return estimatedLines * TOKENS_PER_LINE;
    }
  }
}

// ── Utility Functions ────────────────────────────────────────

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function computeTokenOverlap(
  queryTokens: readonly string[],
  contentTokens: readonly string[],
): number {
  if (queryTokens.length === 0) return 0;

  const contentSet = new Set(contentTokens);
  let matches = 0;
  for (const token of queryTokens) {
    if (contentSet.has(token)) matches++;
  }

  return queryTokens.length > 0 ? matches / queryTokens.length : 0;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all",
  "can", "had", "her", "was", "one", "our", "out", "has",
  "have", "this", "that", "with", "from", "they", "been",
  "said", "each", "which", "their", "will", "other", "about",
  "many", "then", "them", "these", "some", "would", "make",
  "like", "into", "could", "time", "very", "when", "come",
  "made", "find", "back", "only", "long", "also", "just",
  "over", "such", "take", "than", "most", "what", "does",
]);
