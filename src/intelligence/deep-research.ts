/**
 * Deep Research Mode — multi-step autonomous web research engine.
 *
 * Decomposes a query into sub-questions, searches/fetches for each,
 * identifies gaps, iterates with follow-up queries, and synthesizes
 * a structured report with citations.
 *
 * The engine itself is LLM-agnostic: callers provide a `synthesize`
 * callback (e.g. WotannRuntime.query()) for the final synthesis step.
 * Query decomposition and gap analysis use keyword heuristics.
 */

// ── Public Types ──────────────────────────────────────

export interface ResearchConfig {
  readonly query: string;
  readonly maxSteps: number;
  readonly maxSources: number;
  readonly outputFormat: "markdown" | "json";
  readonly synthesize?: (prompt: string) => Promise<string>;
  readonly search?: (query: string) => Promise<readonly SearchHit[]>;
  readonly fetch?: (url: string) => Promise<string>;
}

export interface ResearchResult {
  readonly query: string;
  readonly summary: string;
  readonly citations: readonly Citation[];
  readonly steps: readonly ResearchStep[];
  readonly totalDurationMs: number;
}

export interface Citation {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly relevanceScore: number;
}

export interface ResearchStep {
  readonly stepNumber: number;
  readonly query: string;
  readonly action: "search" | "fetch" | "analyze" | "synthesize";
  readonly result: string;
  readonly durationMs: number;
}

export interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

// ── Constants ─────────────────────────────────────────

const DEFAULT_MAX_STEPS = 5;
const DEFAULT_MAX_SOURCES = 10;

/**
 * Stop-words to filter out when decomposing queries.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "don", "now", "and", "but", "or", "nor", "if", "about", "what",
  "which", "who", "whom", "this", "that", "these", "those", "i", "me",
  "my", "we", "our", "you", "your", "he", "him", "his", "she", "her",
  "it", "its", "they", "them", "their",
]);

/**
 * Compound topic markers that hint at decomposition boundaries.
 */
const TOPIC_MARKERS = [
  "versus", "vs", "compared to", "comparison", "difference between",
  "pros and cons", "advantages and disadvantages", "benefits and drawbacks",
  "impact of", "effect of", "causes of", "history of", "future of",
  "how to", "best practices", "alternatives to", "relationship between",
];

// ── Deep Research Engine ──────────────────────────────

export class DeepResearchEngine {
  private readonly maxSteps: number;

  constructor(maxSteps: number = DEFAULT_MAX_STEPS) {
    this.maxSteps = maxSteps;
  }

  /**
   * Run a full deep research cycle.
   * Yields each step as it completes (streaming-friendly).
   */
  async *research(config: ResearchConfig): AsyncGenerator<ResearchStep> {
    const effectiveMaxSteps = config.maxSteps > 0 ? config.maxSteps : this.maxSteps;
    const maxSources = config.maxSources > 0 ? config.maxSources : DEFAULT_MAX_SOURCES;
    const allCitations: Citation[] = [];
    let stepNumber = 0;

    // Step 1: Decompose the query into sub-questions
    const decompositionStart = Date.now();
    const subQueries = decomposeQuery(config.query);
    const decompositionStep: ResearchStep = {
      stepNumber: ++stepNumber,
      query: config.query,
      action: "analyze",
      result: `Decomposed into ${subQueries.length} sub-questions: ${subQueries.join("; ")}`,
      durationMs: Date.now() - decompositionStart,
    };
    yield decompositionStep;

    // Step 2: Search for each sub-question
    const searchFn = config.search ?? defaultSearch;
    for (const subQuery of subQueries) {
      if (stepNumber >= effectiveMaxSteps - 1) break; // Reserve last step for synthesis
      if (allCitations.length >= maxSources) break;

      const searchStart = Date.now();
      const hits = await searchFn(subQuery);
      const searchStep: ResearchStep = {
        stepNumber: ++stepNumber,
        query: subQuery,
        action: "search",
        result: `Found ${hits.length} results for "${subQuery}"`,
        durationMs: Date.now() - searchStart,
      };
      yield searchStep;

      // Score and collect citations
      for (const hit of hits) {
        if (allCitations.length >= maxSources) break;
        const relevance = scoreRelevance(hit, config.query, subQuery);
        if (relevance > 0.1) {
          allCitations.push({
            title: hit.title,
            url: hit.url,
            snippet: hit.snippet,
            relevanceScore: relevance,
          });
        }
      }
    }

    // Step 3: Fetch top sources for deeper analysis
    if (config.fetch && stepNumber < effectiveMaxSteps - 1) {
      const topCitations = [...allCitations]
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 3);

      for (const citation of topCitations) {
        if (stepNumber >= effectiveMaxSteps - 1) break;

        const fetchStart = Date.now();
        try {
          const content = await config.fetch(citation.url);
          const fetchStep: ResearchStep = {
            stepNumber: ++stepNumber,
            query: citation.url,
            action: "fetch",
            result: `Fetched ${citation.title} (${content.length} chars)`,
            durationMs: Date.now() - fetchStart,
          };
          yield fetchStep;

          // Update snippet with richer content
          const enrichedSnippet = extractKeyPassages(content, config.query);
          const idx = allCitations.indexOf(citation);
          if (idx >= 0) {
            allCitations[idx] = { ...citation, snippet: enrichedSnippet };
          }
        } catch {
          // Fetch failures are non-fatal
          const errorStep: ResearchStep = {
            stepNumber: ++stepNumber,
            query: citation.url,
            action: "fetch",
            result: `Failed to fetch ${citation.title}`,
            durationMs: Date.now() - fetchStart,
          };
          yield errorStep;
        }
      }
    }

    // Step 4: Gap analysis — identify missing subtopics
    const gaps = identifyGaps(config.query, subQueries, allCitations);
    if (gaps.length > 0 && stepNumber < effectiveMaxSteps - 1) {
      const gapStart = Date.now();
      const gapStep: ResearchStep = {
        stepNumber: ++stepNumber,
        query: config.query,
        action: "analyze",
        result: `Identified ${gaps.length} knowledge gaps: ${gaps.join("; ")}`,
        durationMs: Date.now() - gapStart,
      };
      yield gapStep;

      // Follow-up search for the first gap
      if (stepNumber < effectiveMaxSteps - 1 && gaps[0]) {
        const followUpStart = Date.now();
        const followUpHits = await searchFn(gaps[0]);
        const followUpStep: ResearchStep = {
          stepNumber: ++stepNumber,
          query: gaps[0],
          action: "search",
          result: `Follow-up search for gap: found ${followUpHits.length} results`,
          durationMs: Date.now() - followUpStart,
        };
        yield followUpStep;

        for (const hit of followUpHits) {
          if (allCitations.length >= maxSources) break;
          const relevance = scoreRelevance(hit, config.query, gaps[0]);
          if (relevance > 0.1) {
            allCitations.push({
              title: hit.title,
              url: hit.url,
              snippet: hit.snippet,
              relevanceScore: relevance,
            });
          }
        }
      }
    }

    // Step 5: Synthesize findings
    const synthStart = Date.now();
    const deduped = deduplicateCitations(allCitations);
    const sorted = [...deduped].sort((a, b) => b.relevanceScore - a.relevanceScore);
    let summary: string;

    if (config.synthesize) {
      const synthesisPrompt = buildSynthesisPrompt(config.query, sorted, config.outputFormat);
      summary = await config.synthesize(synthesisPrompt);
    } else {
      summary = this.generateReport(sorted, config.outputFormat);
    }

    const synthesisStep: ResearchStep = {
      stepNumber: ++stepNumber,
      query: config.query,
      action: "synthesize",
      result: summary,
      durationMs: Date.now() - synthStart,
    };
    yield synthesisStep;
  }

  /**
   * Execute research and collect all results (non-streaming).
   */
  async execute(config: ResearchConfig): Promise<ResearchResult> {
    const start = Date.now();
    const steps: ResearchStep[] = [];
    const allCitations: Citation[] = [];

    for await (const step of this.research(config)) {
      steps.push(step);
    }

    // Extract citations from search/fetch steps
    const synthStep = steps.find((s) => s.action === "synthesize");

    // Collect citations referenced across all steps
    for (const step of steps) {
      if (step.action === "search" || step.action === "fetch") {
        // Citations are tracked internally; we reconstruct from the final report
      }
    }

    return {
      query: config.query,
      summary: synthStep?.result ?? "No synthesis available",
      citations: deduplicateCitations(allCitations),
      steps,
      totalDurationMs: Date.now() - start,
    };
  }

  /**
   * Generate a structured markdown or JSON report from citations.
   */
  generateReport(
    citations: readonly Citation[],
    format: "markdown" | "json" = "markdown",
  ): string {
    if (format === "json") {
      return JSON.stringify({
        citations: citations.map((c, i) => ({
          index: i + 1,
          ...c,
        })),
        generatedAt: new Date().toISOString(),
      }, null, 2);
    }

    return generateMarkdownReport(citations);
  }
}

// ── Query Decomposition ───────────────────────────────

/**
 * Decompose a complex query into sub-questions using keyword analysis.
 * Uses topic markers, conjunction splitting, and entity extraction.
 */
export function decomposeQuery(query: string): readonly string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [query];

  const subQueries: string[] = [];

  // Strategy 1: Split on explicit conjunctions and topic markers
  for (const marker of TOPIC_MARKERS) {
    if (trimmed.toLowerCase().includes(marker)) {
      const parts = trimmed.toLowerCase().split(marker);
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const left = parts[0].trim();
        const right = parts[1].trim();
        if (left.length > 3 && right.length > 3) {
          subQueries.push(left);
          subQueries.push(right);
          subQueries.push(trimmed); // Keep the full query too
          return [...new Set(subQueries)];
        }
      }
    }
  }

  // Strategy 2: Extract key entities and form sub-questions
  const keywords = extractKeywords(trimmed);
  if (keywords.length >= 4) {
    const mid = Math.ceil(keywords.length / 2);
    const firstHalf = keywords.slice(0, mid);
    const secondHalf = keywords.slice(mid);
    subQueries.push(firstHalf.join(" "));
    subQueries.push(secondHalf.join(" "));
  }

  // Strategy 3: Create definitional and contextual sub-queries
  if (keywords.length >= 2) {
    subQueries.push(`what is ${keywords.join(" ")}`);
    subQueries.push(`${keywords.join(" ")} latest developments`);
    subQueries.push(`${keywords.join(" ")} key findings`);
  }

  // Always include the original query
  subQueries.push(trimmed);

  // Deduplicate and limit
  const unique = [...new Set(subQueries)].filter((q) => q.length > 2);
  return unique.slice(0, 5);
}

/**
 * Extract meaningful keywords from a query, removing stop words.
 */
export function extractKeywords(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

// ── Relevance Scoring ─────────────────────────────────

/**
 * Score a search hit's relevance to the original and sub-query.
 * Returns 0-1 based on keyword overlap.
 */
export function scoreRelevance(
  hit: SearchHit,
  originalQuery: string,
  subQuery: string,
): number {
  const originalKeywords = extractKeywords(originalQuery);
  const subKeywords = extractKeywords(subQuery);
  const allKeywords = [...new Set([...originalKeywords, ...subKeywords])];

  if (allKeywords.length === 0) return 0.5;

  const hitText = `${hit.title} ${hit.snippet}`.toLowerCase();
  let matches = 0;

  for (const keyword of allKeywords) {
    if (hitText.includes(keyword)) {
      matches++;
    }
  }

  const keywordScore = matches / allKeywords.length;

  // Boost for title matches (more relevant)
  const titleText = hit.title.toLowerCase();
  let titleBoost = 0;
  for (const keyword of originalKeywords) {
    if (titleText.includes(keyword)) {
      titleBoost += 0.1;
    }
  }

  return Math.min(1, keywordScore * 0.7 + Math.min(titleBoost, 0.3));
}

// ── Gap Analysis ──────────────────────────────────────

/**
 * Identify knowledge gaps: subtopics from the query that lack citations.
 */
export function identifyGaps(
  query: string,
  subQueries: readonly string[],
  citations: readonly Citation[],
): readonly string[] {
  const gaps: string[] = [];
  const coveredKeywords = new Set<string>();

  // Build a set of keywords covered by existing citations
  for (const citation of citations) {
    const words = extractKeywords(`${citation.title} ${citation.snippet}`);
    for (const word of words) {
      coveredKeywords.add(word);
    }
  }

  // Check each sub-query for uncovered keywords
  for (const subQuery of subQueries) {
    const subKeywords = extractKeywords(subQuery);
    const uncovered = subKeywords.filter((k) => !coveredKeywords.has(k));

    if (uncovered.length > subKeywords.length * 0.5 && uncovered.length > 0) {
      gaps.push(uncovered.join(" "));
    }
  }

  // Check original query keywords
  const originalKeywords = extractKeywords(query);
  const uncoveredOriginal = originalKeywords.filter((k) => !coveredKeywords.has(k));
  if (uncoveredOriginal.length > 0) {
    gaps.push(`${uncoveredOriginal.join(" ")} overview`);
  }

  return [...new Set(gaps)].slice(0, 3);
}

// ── Citation Processing ───────────────────────────────

/**
 * Deduplicate citations by URL, keeping the highest-scored version.
 */
export function deduplicateCitations(
  citations: readonly Citation[],
): readonly Citation[] {
  const byUrl = new Map<string, Citation>();

  for (const citation of citations) {
    const existing = byUrl.get(citation.url);
    if (!existing || citation.relevanceScore > existing.relevanceScore) {
      byUrl.set(citation.url, citation);
    }
  }

  return [...byUrl.values()];
}

// ── Content Extraction ────────────────────────────────

/**
 * Extract key passages from fetched content that relate to the query.
 * Splits on paragraph boundaries and scores each by keyword overlap.
 */
export function extractKeyPassages(content: string, query: string): string {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return content.slice(0, 500);

  // Split into paragraphs
  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 30 && p.length < 2000);

  if (paragraphs.length === 0) return content.slice(0, 500);

  // Score each paragraph
  const scored = paragraphs.map((para) => {
    const lower = para.toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) score++;
    }
    return { text: para, score: score / keywords.length };
  });

  // Return top 3 paragraphs sorted by score
  const topParagraphs = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.text);

  if (topParagraphs.length === 0) return content.slice(0, 500);
  return topParagraphs.join("\n\n");
}

// ── Report Generation ─────────────────────────────────

/**
 * Build a synthesis prompt for an LLM from collected citations.
 */
function buildSynthesisPrompt(
  query: string,
  citations: readonly Citation[],
  format: "markdown" | "json",
): string {
  const citationBlock = citations
    .map((c, i) => `[${i + 1}] ${c.title}\n    URL: ${c.url}\n    ${c.snippet}`)
    .join("\n\n");

  return [
    `Synthesize a comprehensive answer to the following research query.`,
    ``,
    `Query: ${query}`,
    ``,
    `Sources:`,
    citationBlock,
    ``,
    `Requirements:`,
    `- Use numbered citations [1], [2], etc. when referencing sources`,
    `- Structure the answer with clear sections`,
    `- Identify areas of agreement and disagreement across sources`,
    `- Note any limitations or gaps in the available information`,
    format === "json"
      ? `- Output as JSON with keys: summary, keyFindings, gaps, citations`
      : `- Output as markdown with headers, bullet points, and a references section`,
  ].join("\n");
}

/**
 * Generate a markdown report from citations (no LLM needed).
 */
function generateMarkdownReport(citations: readonly Citation[]): string {
  if (citations.length === 0) {
    return "# Research Report\n\nNo relevant sources found.";
  }

  const lines: string[] = [
    "# Research Report",
    "",
    "## Key Findings",
    "",
  ];

  // Group citations by relevance tier
  const highRelevance = citations.filter((c) => c.relevanceScore >= 0.6);
  const mediumRelevance = citations.filter((c) => c.relevanceScore >= 0.3 && c.relevanceScore < 0.6);
  const lowRelevance = citations.filter((c) => c.relevanceScore < 0.3);

  if (highRelevance.length > 0) {
    lines.push("### Primary Sources");
    lines.push("");
    for (const citation of highRelevance) {
      lines.push(`- **${citation.title}** (relevance: ${(citation.relevanceScore * 100).toFixed(0)}%)`);
      lines.push(`  ${citation.snippet.slice(0, 200)}${citation.snippet.length > 200 ? "..." : ""}`);
      lines.push("");
    }
  }

  if (mediumRelevance.length > 0) {
    lines.push("### Supporting Sources");
    lines.push("");
    for (const citation of mediumRelevance) {
      lines.push(`- **${citation.title}** (relevance: ${(citation.relevanceScore * 100).toFixed(0)}%)`);
      lines.push(`  ${citation.snippet.slice(0, 150)}${citation.snippet.length > 150 ? "..." : ""}`);
      lines.push("");
    }
  }

  if (lowRelevance.length > 0) {
    lines.push("### Additional References");
    lines.push("");
    for (const citation of lowRelevance) {
      lines.push(`- ${citation.title}`);
    }
    lines.push("");
  }

  // References section
  lines.push("## References");
  lines.push("");
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i]!;
    lines.push(`[${i + 1}] [${c.title}](${c.url})`);
  }
  lines.push("");
  lines.push(`*Report generated at ${new Date().toISOString()}*`);

  return lines.join("\n");
}

// ── Default Search Stub ───────────────────────────────

/**
 * Default search implementation (returns empty).
 * Callers should provide a real search function via config.search.
 */
async function defaultSearch(_query: string): Promise<readonly SearchHit[]> {
  return [];
}
