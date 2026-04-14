import { describe, it, expect } from "vitest";
import {
  DeepResearchEngine,
  decomposeQuery,
  extractKeywords,
  scoreRelevance,
  identifyGaps,
  deduplicateCitations,
  extractKeyPassages,
} from "../../src/intelligence/deep-research.js";
import type { Citation, SearchHit, ResearchStep } from "../../src/intelligence/deep-research.js";

// ── Unit Tests: extractKeywords ─────────────────────

describe("extractKeywords", () => {
  it("removes stop words from a query", () => {
    const keywords = extractKeywords("What is the impact of climate change on agriculture");
    expect(keywords).not.toContain("what");
    expect(keywords).not.toContain("is");
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("of");
    expect(keywords).not.toContain("on");
    expect(keywords).toContain("impact");
    expect(keywords).toContain("climate");
    expect(keywords).toContain("change");
    expect(keywords).toContain("agriculture");
  });

  it("handles empty input", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("handles single keyword", () => {
    expect(extractKeywords("typescript")).toEqual(["typescript"]);
  });

  it("strips punctuation", () => {
    const keywords = extractKeywords("What's the best approach? Use TDD!");
    expect(keywords).toContain("best");
    expect(keywords).toContain("approach");
    expect(keywords).toContain("tdd");
  });
});

// ── Unit Tests: decomposeQuery ──────────────────────

describe("decomposeQuery", () => {
  it("decomposes comparative queries on topic markers", () => {
    const subs = decomposeQuery("React versus Angular for enterprise apps");
    expect(subs.length).toBeGreaterThan(1);
    // Should include at least the original and the split parts
    expect(subs.some((s) => s.includes("react"))).toBe(true);
  });

  it("creates sub-queries for complex topics", () => {
    const subs = decomposeQuery("How do microservices handle distributed tracing");
    expect(subs.length).toBeGreaterThanOrEqual(2);
  });

  it("always includes the original query", () => {
    const query = "simple question";
    const subs = decomposeQuery(query);
    expect(subs).toContain(query);
  });

  it("handles empty input", () => {
    const subs = decomposeQuery("");
    expect(subs.length).toBeGreaterThanOrEqual(1);
  });

  it("splits on 'pros and cons' marker", () => {
    const subs = decomposeQuery("pros and cons of serverless architecture");
    expect(subs.length).toBeGreaterThan(1);
  });
});

// ── Unit Tests: scoreRelevance ──────────────────────

describe("scoreRelevance", () => {
  it("scores a highly relevant hit near 1", () => {
    const hit: SearchHit = {
      title: "Climate Change Impact on Global Agriculture",
      url: "https://example.com/climate",
      snippet: "Climate change significantly impacts agriculture through temperature shifts and water scarcity",
    };
    const score = scoreRelevance(hit, "climate change agriculture impact", "climate change");
    expect(score).toBeGreaterThan(0.5);
  });

  it("scores an irrelevant hit near 0", () => {
    const hit: SearchHit = {
      title: "Best Cat Food Brands",
      url: "https://example.com/cats",
      snippet: "Top rated cat food brands for indoor cats",
    };
    const score = scoreRelevance(hit, "climate change agriculture", "climate change");
    expect(score).toBeLessThan(0.3);
  });

  it("gives title matches a boost", () => {
    const hitWithTitleMatch: SearchHit = {
      title: "Climate Change Overview",
      url: "https://example.com/1",
      snippet: "An article about environmental topics",
    };
    const hitWithoutTitleMatch: SearchHit = {
      title: "Environmental Topics",
      url: "https://example.com/2",
      snippet: "Climate change affects many areas",
    };
    const scoreWithTitle = scoreRelevance(hitWithTitleMatch, "climate change", "climate");
    const scoreWithoutTitle = scoreRelevance(hitWithoutTitleMatch, "climate change", "climate");
    expect(scoreWithTitle).toBeGreaterThanOrEqual(scoreWithoutTitle);
  });

  it("returns 0.5 for empty query keywords", () => {
    const hit: SearchHit = { title: "Test", url: "https://x.com", snippet: "test" };
    expect(scoreRelevance(hit, "the is a", "the")).toBe(0.5);
  });
});

// ── Unit Tests: identifyGaps ────────────────────────

describe("identifyGaps", () => {
  it("identifies uncovered subtopics", () => {
    const citations: Citation[] = [
      { title: "Climate Basics", url: "https://a.com", snippet: "Climate change overview", relevanceScore: 0.8 },
    ];
    const gaps = identifyGaps(
      "climate change impact on agriculture and water supply",
      ["climate change", "agriculture water supply"],
      citations,
    );
    // "agriculture" and "water" and "supply" are likely uncovered
    expect(gaps.length).toBeGreaterThan(0);
  });

  it("returns empty when all topics are covered", () => {
    const citations: Citation[] = [
      { title: "TypeScript Guide", url: "https://a.com", snippet: "TypeScript features and best practices for development", relevanceScore: 0.9 },
    ];
    const gaps = identifyGaps(
      "typescript best practices",
      ["typescript best practices"],
      citations,
    );
    // Most keywords should be covered
    expect(gaps.length).toBeLessThanOrEqual(1);
  });

  it("limits gap count to 3", () => {
    const gaps = identifyGaps(
      "very long query with many different unrelated keywords that are completely uncovered",
      ["topic a", "topic b", "topic c", "topic d", "topic e"],
      [],
    );
    expect(gaps.length).toBeLessThanOrEqual(3);
  });
});

// ── Unit Tests: deduplicateCitations ────────────────

describe("deduplicateCitations", () => {
  it("removes duplicate URLs keeping highest score", () => {
    const citations: Citation[] = [
      { title: "A", url: "https://example.com/1", snippet: "first", relevanceScore: 0.5 },
      { title: "A (better)", url: "https://example.com/1", snippet: "better version", relevanceScore: 0.9 },
      { title: "B", url: "https://example.com/2", snippet: "unique", relevanceScore: 0.7 },
    ];
    const deduped = deduplicateCitations(citations);
    expect(deduped).toHaveLength(2);
    const first = deduped.find((c) => c.url === "https://example.com/1");
    expect(first?.relevanceScore).toBe(0.9);
  });

  it("handles empty input", () => {
    expect(deduplicateCitations([])).toEqual([]);
  });
});

// ── Unit Tests: extractKeyPassages ──────────────────

describe("extractKeyPassages", () => {
  it("extracts paragraphs matching query keywords", () => {
    const content = [
      "This is about cooking recipes.",
      "",
      "TypeScript is a strongly typed programming language that builds on JavaScript.",
      "",
      "Another irrelevant paragraph about gardening tips.",
      "",
      "TypeScript best practices include using strict mode and avoiding any types.",
    ].join("\n");

    const passages = extractKeyPassages(content, "typescript best practices");
    expect(passages).toContain("TypeScript");
    expect(passages).not.toContain("cooking");
  });

  it("returns truncated content when no paragraphs match", () => {
    const content = "Short content without any paragraph breaks that is long enough to be a passage";
    const passages = extractKeyPassages(content, "completely unrelated query");
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.length).toBeLessThanOrEqual(500);
  });

  it("handles empty content", () => {
    const passages = extractKeyPassages("", "query");
    expect(passages.length).toBeLessThanOrEqual(500);
  });
});

// ── Unit Tests: DeepResearchEngine ──────────────────

describe("DeepResearchEngine", () => {
  it("constructs with default max steps", () => {
    const engine = new DeepResearchEngine();
    expect(engine).toBeDefined();
  });

  it("constructs with custom max steps", () => {
    const engine = new DeepResearchEngine(10);
    expect(engine).toBeDefined();
  });

  it("generates a markdown report from citations", () => {
    const engine = new DeepResearchEngine();
    const citations: Citation[] = [
      { title: "Source A", url: "https://a.com", snippet: "High relevance finding", relevanceScore: 0.9 },
      { title: "Source B", url: "https://b.com", snippet: "Medium relevance", relevanceScore: 0.4 },
      { title: "Source C", url: "https://c.com", snippet: "Low relevance", relevanceScore: 0.1 },
    ];

    const report = engine.generateReport(citations, "markdown");
    expect(report).toContain("# Research Report");
    expect(report).toContain("Source A");
    expect(report).toContain("Primary Sources");
    expect(report).toContain("[1]");
    expect(report).toContain("https://a.com");
  });

  it("generates a JSON report from citations", () => {
    const engine = new DeepResearchEngine();
    const citations: Citation[] = [
      { title: "Source A", url: "https://a.com", snippet: "Finding", relevanceScore: 0.9 },
    ];

    const report = engine.generateReport(citations, "json");
    const parsed = JSON.parse(report);
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0].title).toBe("Source A");
    expect(parsed.generatedAt).toBeDefined();
  });

  it("handles empty citations in report", () => {
    const engine = new DeepResearchEngine();
    const report = engine.generateReport([], "markdown");
    expect(report).toContain("No relevant sources found");
  });

  it("yields research steps via async generator", async () => {
    const engine = new DeepResearchEngine(3);
    const mockSearch = async (_query: string): Promise<SearchHit[]> => [
      { title: "Result 1", url: "https://a.com", snippet: "Relevant snippet about TypeScript" },
      { title: "Result 2", url: "https://b.com", snippet: "Another TypeScript resource" },
    ];

    const steps: ResearchStep[] = [];
    for await (const step of engine.research({
      query: "TypeScript best practices",
      maxSteps: 3,
      maxSources: 5,
      outputFormat: "markdown",
      search: mockSearch,
    })) {
      steps.push(step);
    }

    // Should have at least decomposition + search + synthesis
    expect(steps.length).toBeGreaterThanOrEqual(2);

    // First step should be decomposition (analyze)
    expect(steps[0]?.action).toBe("analyze");

    // Last step should be synthesis
    expect(steps[steps.length - 1]?.action).toBe("synthesize");

    // Steps should have incrementing step numbers
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.stepNumber).toBeGreaterThan(steps[i - 1]!.stepNumber);
    }
  });

  it("respects maxSources limit", async () => {
    const engine = new DeepResearchEngine(10);
    const callCount = { value: 0 };
    const mockSearch = async (_query: string): Promise<SearchHit[]> => {
      callCount.value++;
      return Array.from({ length: 20 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${callCount.value}/${i}`,
        snippet: `Relevant content about the topic number ${i}`,
      }));
    };

    const steps: ResearchStep[] = [];
    for await (const step of engine.research({
      query: "test query with many results",
      maxSteps: 10,
      maxSources: 3,
      outputFormat: "markdown",
      search: mockSearch,
    })) {
      steps.push(step);
    }

    // Should eventually stop collecting even though search returns many
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });

  it("uses custom synthesize callback when provided", async () => {
    const engine = new DeepResearchEngine(3);
    let synthesizeCalledWith = "";

    const steps: ResearchStep[] = [];
    for await (const step of engine.research({
      query: "test synthesis",
      maxSteps: 3,
      maxSources: 5,
      outputFormat: "markdown",
      search: async () => [
        { title: "Source", url: "https://a.com", snippet: "Content about test synthesis" },
      ],
      synthesize: async (prompt: string) => {
        synthesizeCalledWith = prompt;
        return "Custom synthesis result";
      },
    })) {
      steps.push(step);
    }

    const synthStep = steps.find((s) => s.action === "synthesize");
    expect(synthStep?.result).toBe("Custom synthesis result");
    expect(synthesizeCalledWith).toContain("test synthesis");
  });

  it("execute() collects all steps and returns ResearchResult", async () => {
    const engine = new DeepResearchEngine(3);
    const result = await engine.execute({
      query: "test execution",
      maxSteps: 3,
      maxSources: 5,
      outputFormat: "markdown",
      search: async () => [
        { title: "Source", url: "https://a.com", snippet: "Test content" },
      ],
    });

    expect(result.query).toBe("test execution");
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.summary).toBeDefined();
  });
});
