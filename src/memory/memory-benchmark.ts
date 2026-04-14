/**
 * Memory quality benchmark inspired by LoCoMo (ACL 2024).
 *
 * Evaluates memory systems across 5 question types:
 *   1. Single-hop recall — direct fact retrieval
 *   2. Multi-hop reasoning — cross-reference 2+ entries
 *   3. Temporal reasoning — time-aware queries
 *   4. Open-domain knowledge — context + general knowledge
 *   5. Adversarial/unanswerable — correct answer is "not found"
 *
 * Usage:
 *   const bench = new MemoryBenchmark();
 *   const suite = bench.run(myStoreAdapter);
 *   console.log(suite.scorePercent); // e.g. 85
 */

import { randomUUID } from "node:crypto";

// ── Interfaces ───────────────────────────────────────────────

export interface BenchmarkSetupEntry {
  readonly key: string;
  readonly value: string;
  readonly domain?: string;
  readonly topic?: string;
  readonly blockType: string;
}

export type BenchmarkCategory =
  | "single-hop"
  | "multi-hop"
  | "temporal"
  | "open-domain"
  | "adversarial";

export interface BenchmarkQuestion {
  readonly id: string;
  readonly category: BenchmarkCategory;
  readonly question: string;
  readonly expectedAnswer: string;
  readonly acceptableAnswers?: readonly string[];
  readonly setup: readonly BenchmarkSetupEntry[];
}

export interface BenchmarkResult {
  readonly questionId: string;
  readonly category: BenchmarkCategory;
  readonly passed: boolean;
  readonly expectedAnswer: string;
  readonly actualAnswer: string;
  readonly searchResults: number;
  readonly durationMs: number;
}

export interface CategoryScore {
  readonly passed: number;
  readonly total: number;
  readonly percent: number;
}

export interface BenchmarkSuite {
  readonly totalQuestions: number;
  readonly passed: number;
  readonly failed: number;
  readonly scorePercent: number;
  readonly categoryScores: Readonly<Record<string, CategoryScore>>;
  readonly results: readonly BenchmarkResult[];
  readonly durationMs: number;
}

export interface BenchmarkStoreAdapter {
  insert(entry: {
    id: string;
    layer: string;
    blockType: string;
    key: string;
    value: string;
    verified: boolean;
    freshnessScore: number;
    confidenceLevel: number;
    verificationStatus: string;
    domain?: string;
    topic?: string;
  }): void;

  search(
    query: string,
    limit: number,
  ): readonly { entry: { key: string; value: string }; score: number }[];

  searchPartitioned?(
    query: string,
    options: { domain?: string; topic?: string; limit?: number },
  ): readonly { entry: { key: string; value: string }; score: number }[];
}

// ── Built-in Question Set ────────────────────────────────────

const ADVERSARIAL_SCORE_THRESHOLD = 0.3;

function buildQuestions(): readonly BenchmarkQuestion[] {
  return [
    // ── Single-hop (direct recall) ─────────────────────────
    {
      id: "sh-01",
      category: "single-hop",
      question: "What database does the project use?",
      expectedAnswer: "PostgreSQL 15",
      acceptableAnswers: ["PostgreSQL", "Postgres 15", "postgres"],
      setup: [
        { key: "database", value: "PostgreSQL 15", blockType: "project", domain: "infra", topic: "database" },
      ],
    },
    {
      id: "sh-02",
      category: "single-hop",
      question: "Who is the tech lead?",
      expectedAnswer: "Maya Chen",
      acceptableAnswers: ["Maya"],
      setup: [
        { key: "tech-lead", value: "Maya Chen", blockType: "project", domain: "team", topic: "roles" },
      ],
    },
    {
      id: "sh-03",
      category: "single-hop",
      question: "What CI system is configured?",
      expectedAnswer: "GitHub Actions",
      acceptableAnswers: ["GH Actions", "github actions"],
      setup: [
        { key: "ci-system", value: "GitHub Actions", blockType: "project", domain: "infra", topic: "ci" },
      ],
    },
    {
      id: "sh-04",
      category: "single-hop",
      question: "What is the default port?",
      expectedAnswer: "3000",
      setup: [
        { key: "server-port", value: "3000", blockType: "project", domain: "infra", topic: "config" },
      ],
    },

    // ── Multi-hop (cross-reference reasoning) ──────────────
    {
      id: "mh-01",
      category: "multi-hop",
      question: "What technology does the tech lead prefer?",
      expectedAnswer: "TypeScript",
      acceptableAnswers: ["TypeScript + Postgres", "TypeScript and Postgres"],
      setup: [
        { key: "tech-lead", value: "Maya Chen", blockType: "project", domain: "team", topic: "roles" },
        { key: "Maya preferences", value: "TypeScript + Postgres", blockType: "feedback", domain: "team", topic: "preferences" },
      ],
    },
    {
      id: "mh-02",
      category: "multi-hop",
      question: "What tests cover the auth module?",
      expectedAnswer: "95% coverage",
      acceptableAnswers: ["95%", "src/auth/ has 95% coverage"],
      setup: [
        { key: "auth-module", value: "src/auth/", blockType: "project", domain: "code", topic: "modules" },
        { key: "test-coverage", value: "src/auth/ has 95% coverage", blockType: "project", domain: "code", topic: "testing" },
      ],
    },
    {
      id: "mh-03",
      category: "multi-hop",
      question: "What deployment target uses the main database?",
      expectedAnswer: "AWS RDS",
      acceptableAnswers: ["production", "PostgreSQL on AWS RDS"],
      setup: [
        { key: "database", value: "PostgreSQL", blockType: "project", domain: "infra", topic: "database" },
        { key: "production-deployment", value: "uses PostgreSQL on AWS RDS", blockType: "project", domain: "infra", topic: "deploy" },
      ],
    },
    {
      id: "mh-04",
      category: "multi-hop",
      question: "What framework does the API use?",
      expectedAnswer: "Express.js",
      acceptableAnswers: ["Express", "Express.js for REST API"],
      setup: [
        { key: "api-module", value: "REST endpoints", blockType: "project", domain: "code", topic: "api" },
        { key: "framework", value: "Express.js for REST API", blockType: "project", domain: "code", topic: "framework" },
      ],
    },

    // ── Temporal (time-aware reasoning) ────────────────────
    {
      id: "tm-01",
      category: "temporal",
      question: "What was the most recent decision?",
      expectedAnswer: "Switch to Vite",
      acceptableAnswers: ["Vite", "switch to Vite for builds"],
      setup: [
        { key: "decision-2024-01", value: "Adopt TypeScript strict mode (Jan 2024)", blockType: "decisions", domain: "arch", topic: "decisions" },
        { key: "decision-2024-06", value: "Switch to Vite for builds (Jun 2024)", blockType: "decisions", domain: "arch", topic: "decisions" },
      ],
    },
    {
      id: "tm-02",
      category: "temporal",
      question: "What happened before the auth migration?",
      expectedAnswer: "API rate limiting",
      acceptableAnswers: ["rate limiting", "Added API rate limiting"],
      setup: [
        { key: "milestone-phase1", value: "Added API rate limiting (Q1 2024)", blockType: "project", domain: "timeline", topic: "milestones" },
        { key: "milestone-phase2", value: "Auth migration to OAuth2 (Q2 2024)", blockType: "project", domain: "timeline", topic: "milestones" },
      ],
    },
    {
      id: "tm-03",
      category: "temporal",
      question: "When was the database schema last changed?",
      expectedAnswer: "March 2024",
      acceptableAnswers: ["2024-03", "Mar 2024"],
      setup: [
        { key: "schema-change", value: "Database schema v3 migration completed March 2024", blockType: "project", domain: "infra", topic: "database" },
      ],
    },
    {
      id: "tm-04",
      category: "temporal",
      question: "What is the oldest open issue?",
      expectedAnswer: "flaky WebSocket reconnect",
      acceptableAnswers: ["WebSocket reconnect", "flaky reconnect"],
      setup: [
        { key: "issue-old", value: "OPEN: flaky WebSocket reconnect (filed Dec 2023)", blockType: "issues", domain: "bugs", topic: "networking" },
        { key: "issue-recent", value: "OPEN: dark mode toggle lag (filed Feb 2024)", blockType: "issues", domain: "bugs", topic: "ui" },
      ],
    },

    // ── Open-domain (needs context + general knowledge) ────
    {
      id: "od-01",
      category: "open-domain",
      question: "Is the chosen database good for time-series data?",
      expectedAnswer: "PostgreSQL",
      acceptableAnswers: ["PostgreSQL 15", "Postgres"],
      setup: [
        { key: "database", value: "PostgreSQL 15", blockType: "project", domain: "infra", topic: "database" },
      ],
    },
    {
      id: "od-02",
      category: "open-domain",
      question: "What security risks does the auth approach have?",
      expectedAnswer: "JWT with refresh tokens",
      acceptableAnswers: ["JWT", "refresh tokens"],
      setup: [
        { key: "auth-approach", value: "JWT with refresh tokens", blockType: "project", domain: "security", topic: "auth" },
      ],
    },
    {
      id: "od-03",
      category: "open-domain",
      question: "What are alternatives to the current CI system?",
      expectedAnswer: "GitHub Actions",
      acceptableAnswers: ["GH Actions", "github actions"],
      setup: [
        { key: "ci-system", value: "GitHub Actions", blockType: "project", domain: "infra", topic: "ci" },
      ],
    },
    {
      id: "od-04",
      category: "open-domain",
      question: "Is the framework choice appropriate for real-time features?",
      expectedAnswer: "Express.js",
      acceptableAnswers: ["Express"],
      setup: [
        { key: "framework", value: "Express.js", blockType: "project", domain: "code", topic: "framework" },
      ],
    },

    // ── Adversarial (unanswerable — correct answer is "not found") ──
    {
      id: "ad-01",
      category: "adversarial",
      question: "What is the team's salary budget?",
      expectedAnswer: "NOT_FOUND",
      setup: [
        { key: "team-size", value: "5 engineers", blockType: "project", domain: "team", topic: "structure" },
      ],
    },
    {
      id: "ad-02",
      category: "adversarial",
      question: "What color is the logo?",
      expectedAnswer: "NOT_FOUND",
      setup: [
        { key: "tech-stack", value: "TypeScript + React + Node", blockType: "project", domain: "code", topic: "stack" },
      ],
    },
    {
      id: "ad-03",
      category: "adversarial",
      question: "When is the next company holiday?",
      expectedAnswer: "NOT_FOUND",
      setup: [
        { key: "sprint-end", value: "Sprint 4 ends 2024-04-15", blockType: "project", domain: "timeline", topic: "sprints" },
      ],
    },
    {
      id: "ad-04",
      category: "adversarial",
      question: "What is the CEO's favorite food?",
      expectedAnswer: "NOT_FOUND",
      setup: [
        { key: "lead-engineer", value: "Maya Chen — backend specialist", blockType: "project", domain: "team", topic: "roles" },
      ],
    },
  ];
}

// ── Evaluation Helpers ───────────────────────────────────────

function matchesExpected(
  results: readonly { entry: { key: string; value: string }; score: number }[],
  expected: string,
  acceptable: readonly string[] | undefined,
): { readonly matched: boolean; readonly bestMatch: string } {
  const targets = [expected, ...(acceptable ?? [])];
  for (const result of results) {
    const valueLower = result.entry.value.toLowerCase();
    for (const target of targets) {
      if (valueLower.includes(target.toLowerCase())) {
        return { matched: true, bestMatch: result.entry.value };
      }
    }
  }
  return { matched: false, bestMatch: results[0]?.entry.value ?? "" };
}

function evaluateAdversarial(
  results: readonly { entry: { key: string; value: string }; score: number }[],
  question: string,
): { readonly passed: boolean; readonly actualAnswer: string } {
  // Adversarial questions pass when the store returns NO relevant results.
  // "Relevant" means a result whose score meets the threshold AND whose
  // value has meaningful keyword overlap with the question.
  if (results.length === 0) {
    return { passed: true, actualAnswer: "NOT_FOUND" };
  }

  const questionWords = new Set(
    question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

  const hasRelevant = results.some((r) => {
    if (Math.abs(r.score) < ADVERSARIAL_SCORE_THRESHOLD) return false;
    const valueWords = r.entry.value.toLowerCase().split(/\s+/);
    return valueWords.some((w) => questionWords.has(w));
  });

  return hasRelevant
    ? { passed: false, actualAnswer: results[0]?.entry.value ?? "" }
    : { passed: true, actualAnswer: "NOT_FOUND" };
}

function seedStore(
  store: BenchmarkStoreAdapter,
  entries: readonly BenchmarkSetupEntry[],
  questionId: string,
): void {
  for (const entry of entries) {
    store.insert({
      id: `${questionId}-${randomUUID().slice(0, 8)}`,
      layer: "core_blocks",
      blockType: entry.blockType,
      key: entry.key,
      value: entry.value,
      verified: true,
      freshnessScore: 1.0,
      confidenceLevel: 1.0,
      verificationStatus: "verified",
      domain: entry.domain,
      topic: entry.topic,
    });
  }
}

function buildCategoryScores(
  results: readonly BenchmarkResult[],
): Readonly<Record<string, CategoryScore>> {
  const grouped = new Map<string, { passed: number; total: number }>();

  for (const r of results) {
    const existing = grouped.get(r.category) ?? { passed: 0, total: 0 };
    grouped.set(r.category, {
      passed: existing.passed + (r.passed ? 1 : 0),
      total: existing.total + 1,
    });
  }

  const scores: Record<string, CategoryScore> = {};
  for (const [cat, { passed, total }] of grouped) {
    scores[cat] = {
      passed,
      total,
      percent: total > 0 ? Math.round((passed / total) * 100) : 0,
    };
  }

  return scores;
}

// ── MemoryBenchmark Class ────────────────────────────────────

export class MemoryBenchmark {
  private readonly questions: readonly BenchmarkQuestion[];

  constructor(questions?: readonly BenchmarkQuestion[]) {
    this.questions = questions ?? buildQuestions();
  }

  /** Run all benchmark questions against the provided store adapter. */
  run(store: BenchmarkStoreAdapter): BenchmarkSuite {
    const suiteStart = Date.now();
    const results: BenchmarkResult[] = [];

    for (const question of this.questions) {
      results.push(this.evaluateQuestion(store, question));
    }

    const passed = results.filter((r) => r.passed).length;

    return {
      totalQuestions: results.length,
      passed,
      failed: results.length - passed,
      scorePercent: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
      categoryScores: buildCategoryScores(results),
      results,
      durationMs: Date.now() - suiteStart,
    };
  }

  /** Run only questions in a specific category. */
  runCategory(store: BenchmarkStoreAdapter, category: string): BenchmarkSuite {
    const suiteStart = Date.now();
    const filtered = this.questions.filter((q) => q.category === category);
    const results: BenchmarkResult[] = [];

    for (const question of filtered) {
      results.push(this.evaluateQuestion(store, question));
    }

    const passed = results.filter((r) => r.passed).length;

    return {
      totalQuestions: results.length,
      passed,
      failed: results.length - passed,
      scorePercent: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
      categoryScores: buildCategoryScores(results),
      results,
      durationMs: Date.now() - suiteStart,
    };
  }

  /** Get the full built-in question set. */
  getQuestions(): readonly BenchmarkQuestion[] {
    return this.questions;
  }

  // ── Private ──────────────────────────────────────────────

  private evaluateQuestion(
    store: BenchmarkStoreAdapter,
    question: BenchmarkQuestion,
  ): BenchmarkResult {
    const start = Date.now();

    // Seed the store with setup entries for this question.
    seedStore(store, question.setup, question.id);

    // Search using partitioned search if available, falling back to plain search.
    const searchLimit = 10;
    const hasDomain = question.setup.some((e) => e.domain !== undefined);
    const firstDomain = question.setup.find((e) => e.domain !== undefined)?.domain;
    const firstTopic = question.setup.find((e) => e.topic !== undefined)?.topic;

    let results: readonly { entry: { key: string; value: string }; score: number }[];

    if (store.searchPartitioned && hasDomain) {
      results = store.searchPartitioned(question.question, {
        domain: firstDomain,
        topic: firstTopic,
        limit: searchLimit,
      });
    } else {
      results = store.search(question.question, searchLimit);
    }

    // Evaluate based on category.
    if (question.category === "adversarial") {
      const evaluation = evaluateAdversarial(results, question.question);
      return {
        questionId: question.id,
        category: question.category,
        passed: evaluation.passed,
        expectedAnswer: question.expectedAnswer,
        actualAnswer: evaluation.actualAnswer,
        searchResults: results.length,
        durationMs: Date.now() - start,
      };
    }

    const evaluation = matchesExpected(
      results,
      question.expectedAnswer,
      question.acceptableAnswers,
    );

    return {
      questionId: question.id,
      category: question.category,
      passed: evaluation.matched,
      expectedAnswer: question.expectedAnswer,
      actualAnswer: evaluation.bestMatch,
      searchResults: results.length,
      durationMs: Date.now() - start,
    };
  }
}
