/**
 * Tests for the LongMemEval runner + scorer + corpus loader.
 *
 * Covers:
 *   - Corpus loader: smoke fallback, seeded shuffle, limit, missing-file error
 *   - Ability classification: all 5 abilities mapped correctly
 *   - Scorer: strict vs lenient, abstention, temporal ±1, missing hypothesis
 *   - Runner: end-to-end smoke run, per-instance isolation, error collection
 *   - RunReport shape invariants
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadLongMemEvalCorpus,
  abilityFor,
  LONGMEMEVAL_SMOKE_CORPUS,
  type LongMemEvalInstance,
} from "../../../src/memory/evals/longmemeval/corpus.js";
import {
  scoreLongMemEval,
  type Hypothesis,
} from "../../../src/memory/evals/longmemeval/scorer.js";
import { runLongMemEval } from "../../../src/memory/evals/longmemeval/runner.js";

// ── Corpus tests ──────────────────────────────────────

describe("loadLongMemEvalCorpus", () => {
  it("falls back to smoke corpus with --skip-download", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wotann-lme-"));
    try {
      const instances = loadLongMemEvalCorpus(tmp, { skipDownload: true });
      expect(instances.length).toBe(LONGMEMEVAL_SMOKE_CORPUS.length);
      expect(instances.length).toBeGreaterThanOrEqual(10);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws a helpful error when corpus is missing and --skip-download is false", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wotann-lme-"));
    try {
      expect(() => loadLongMemEvalCorpus(tmp, { skipDownload: false })).toThrow(
        /not found|download/i,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("honours limit and seed for deterministic sampling", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wotann-lme-"));
    try {
      const a = loadLongMemEvalCorpus(tmp, { skipDownload: true, seed: 42, limit: 4 });
      const b = loadLongMemEvalCorpus(tmp, { skipDownload: true, seed: 42, limit: 4 });
      expect(a.map((i) => i.question_id)).toEqual(b.map((i) => i.question_id));
      expect(a.length).toBe(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads a valid on-disk corpus when present", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wotann-lme-"));
    try {
      const dir = join(tmp, ".wotann", "benchmarks", "longmemeval");
      mkdirSync(dir, { recursive: true });
      const fake: LongMemEvalInstance[] = [
        {
          question_id: "disk-01",
          question_type: "single-session-user",
          question: "What?",
          answer: "hello",
          question_date: "2026-01-01",
          haystack_session_ids: ["s1"],
          haystack_dates: ["2026-01-01"],
          haystack_sessions: [[{ role: "user", content: "hello" }]],
          answer_session_ids: ["s1"],
        },
      ];
      writeFileSync(join(dir, "longmemeval_s.json"), JSON.stringify(fake));
      const instances = loadLongMemEvalCorpus(tmp, { skipDownload: false });
      expect(instances).toHaveLength(1);
      expect(instances[0]?.question_id).toBe("disk-01");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects a corpus file whose content is not a JSON array", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wotann-lme-"));
    try {
      const dir = join(tmp, ".wotann", "benchmarks", "longmemeval");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "longmemeval_s.json"), JSON.stringify({ not: "array" }));
      expect(() => loadLongMemEvalCorpus(tmp, { skipDownload: false })).toThrow(/array/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── Ability classification ────────────────────────────

describe("abilityFor", () => {
  it("maps single-session-* to information-extraction", () => {
    for (const qt of [
      "single-session-user",
      "single-session-assistant",
      "single-session-preference",
    ] as const) {
      const inst: LongMemEvalInstance = {
        question_id: `x-${qt}`,
        question_type: qt,
        question: "",
        answer: "",
        question_date: "",
        haystack_session_ids: [],
        haystack_dates: [],
        haystack_sessions: [],
        answer_session_ids: [],
      };
      expect(abilityFor(inst)).toBe("information-extraction");
    }
  });

  it("maps multi-session → multi-session-reasoning", () => {
    expect(
      abilityFor({
        question_id: "x",
        question_type: "multi-session",
        question: "",
        answer: "",
        question_date: "",
        haystack_session_ids: [],
        haystack_dates: [],
        haystack_sessions: [],
        answer_session_ids: [],
      }),
    ).toBe("multi-session-reasoning");
  });

  it("maps temporal-reasoning → temporal", () => {
    expect(
      abilityFor({
        question_id: "x",
        question_type: "temporal-reasoning",
        question: "",
        answer: "",
        question_date: "",
        haystack_session_ids: [],
        haystack_dates: [],
        haystack_sessions: [],
        answer_session_ids: [],
      }),
    ).toBe("temporal");
  });

  it("maps knowledge-update → knowledge-update", () => {
    expect(
      abilityFor({
        question_id: "x",
        question_type: "knowledge-update",
        question: "",
        answer: "",
        question_date: "",
        haystack_session_ids: [],
        haystack_dates: [],
        haystack_sessions: [],
        answer_session_ids: [],
      }),
    ).toBe("knowledge-update");
  });

  it("overrides every question_type when _abs suffix is present", () => {
    expect(
      abilityFor({
        question_id: "x_abs",
        question_type: "multi-session",
        question: "",
        answer: "",
        question_date: "",
        haystack_session_ids: [],
        haystack_dates: [],
        haystack_sessions: [],
        answer_session_ids: [],
      }),
    ).toBe("abstention");
  });

  it("smoke corpus covers all 5 abilities", () => {
    const abilities = new Set(LONGMEMEVAL_SMOKE_CORPUS.map(abilityFor));
    expect(abilities.has("information-extraction")).toBe(true);
    expect(abilities.has("multi-session-reasoning")).toBe(true);
    expect(abilities.has("temporal")).toBe(true);
    expect(abilities.has("knowledge-update")).toBe(true);
    expect(abilities.has("abstention")).toBe(true);
  });
});

// ── Scorer tests ──────────────────────────────────────

const BASE: Omit<LongMemEvalInstance, "question_id" | "answer"> = {
  question_type: "single-session-user",
  question: "What?",
  question_date: "2026-01-01",
  haystack_session_ids: [],
  haystack_dates: [],
  haystack_sessions: [],
  answer_session_ids: [],
};

describe("scoreLongMemEval", () => {
  it("strict pass: substring match", () => {
    const inst: LongMemEvalInstance = { ...BASE, question_id: "q1", answer: "Luna" };
    const hyps: Hypothesis[] = [{ question_id: "q1", hypothesis: "The dog's name is Luna." }];
    const r = scoreLongMemEval([inst], hyps);
    expect(r.results[0]?.strictPass).toBe(true);
    expect(r.results[0]?.lenientPass).toBe(true);
    expect(r.passed).toBe(1);
  });

  it("lenient pass: content-word overlap without substring", () => {
    const inst: LongMemEvalInstance = {
      ...BASE,
      question_id: "q2",
      answer: "iPhone 17",
    };
    const hyps: Hypothesis[] = [
      { question_id: "q2", hypothesis: "They currently use an iphone - model 17." },
    ];
    const r = scoreLongMemEval([inst], hyps);
    expect(r.results[0]?.strictPass).toBe(false);
    expect(r.results[0]?.lenientPass).toBe(true);
  });

  it("miss: unrelated answer", () => {
    const inst: LongMemEvalInstance = { ...BASE, question_id: "q3", answer: "Berlin" };
    const hyps: Hypothesis[] = [{ question_id: "q3", hypothesis: "Tokyo is a great city." }];
    const r = scoreLongMemEval([inst], hyps);
    expect(r.results[0]?.passed).toBe(false);
  });

  it("missing hypothesis counts as failure (no score inflation)", () => {
    const inst: LongMemEvalInstance = { ...BASE, question_id: "q4", answer: "x" };
    const r = scoreLongMemEval([inst], []);
    expect(r.results[0]?.passed).toBe(false);
    expect(r.results[0]?.reason).toBe("no hypothesis");
  });

  it("temporal: accepts off-by-one numeric match", () => {
    const inst: LongMemEvalInstance = {
      ...BASE,
      question_type: "temporal-reasoning",
      question_id: "q5",
      answer: "18",
    };
    const hyps: Hypothesis[] = [{ question_id: "q5", hypothesis: "About 19 days." }];
    const r = scoreLongMemEval([inst], hyps);
    expect(r.results[0]?.strictPass).toBe(false);
    expect(r.results[0]?.lenientPass).toBe(true);
    expect(r.results[0]?.reason).toMatch(/temporal/);
  });

  it("abstention: passes on correct abstention phrase", () => {
    const inst: LongMemEvalInstance = {
      ...BASE,
      question_id: "q_abs",
      answer: "The user never mentioned salary.",
    };
    const hyps: Hypothesis[] = [
      { question_id: "q_abs", hypothesis: "I don't have enough information to answer." },
    ];
    const r = scoreLongMemEval([inst], hyps);
    expect(r.results[0]?.passed).toBe(true);
    expect(r.results[0]?.ability).toBe("abstention");
  });

  it("abstention: fails when hypothesis asserts an answer", () => {
    const inst: LongMemEvalInstance = {
      ...BASE,
      question_id: "q2_abs",
      answer: "The user never mentioned salary.",
    };
    const hyps: Hypothesis[] = [{ question_id: "q2_abs", hypothesis: "Your salary is 100k." }];
    const r = scoreLongMemEval([inst], hyps);
    expect(r.results[0]?.passed).toBe(false);
  });

  it("report includes all 5 ability buckets even when empty", () => {
    const inst: LongMemEvalInstance = { ...BASE, question_id: "q1", answer: "x" };
    const r = scoreLongMemEval([inst], [{ question_id: "q1", hypothesis: "x" }]);
    expect(r.byAbility["information-extraction"]).toBeDefined();
    expect(r.byAbility["multi-session-reasoning"]).toBeDefined();
    expect(r.byAbility.temporal).toBeDefined();
    expect(r.byAbility["knowledge-update"]).toBeDefined();
    expect(r.byAbility.abstention).toBeDefined();
  });

  it("overall, strict, and lenient accuracies are consistent", () => {
    const instances: LongMemEvalInstance[] = [
      { ...BASE, question_id: "hit", answer: "Luna" },
      { ...BASE, question_id: "miss", answer: "Berlin" },
    ];
    const hyps: Hypothesis[] = [
      { question_id: "hit", hypothesis: "Luna is the name." },
      { question_id: "miss", hypothesis: "Tokyo." },
    ];
    const r = scoreLongMemEval(instances, hyps);
    expect(r.overallAccuracy).toBe(0.5);
    expect(r.strictAccuracy).toBeLessThanOrEqual(r.lenientAccuracy);
  });
});

// ── Runner integration ────────────────────────────────

describe("runLongMemEval", () => {
  it("runs end-to-end on the smoke corpus and produces a scored report", async () => {
    const report = await runLongMemEval(LONGMEMEVAL_SMOKE_CORPUS, {
      mode: "memory-stack",
      topK: 5,
    });

    expect(report.totalInstances).toBe(LONGMEMEVAL_SMOKE_CORPUS.length);
    expect(report.completedInstances).toBeGreaterThan(0);
    expect(report.mode).toBe("memory-stack");
    expect(report.topK).toBe(5);
    expect(report.score.total).toBe(report.totalInstances);
    expect(report.hypotheses.length).toBeLessThanOrEqual(report.totalInstances);
    // Baseline floor — the FTS5 stack should hit at least the trivial
    // substring retrievals on a smoke corpus designed to be answerable.
    expect(report.score.overallAccuracy).toBeGreaterThan(0);
  });

  it("isolates instances — no cross-contamination of memory", async () => {
    // Construct two instances where one has the answer to the other's question.
    // If isolation fails, both would pass; with isolation, only the
    // matching-instance question resolves.
    const instances: LongMemEvalInstance[] = [
      {
        question_id: "iso-1",
        question_type: "single-session-user",
        question: "What is the secret code?",
        answer: "alpha",
        question_date: "2026-01-01",
        haystack_session_ids: ["s1"],
        haystack_dates: ["2026-01-01"],
        haystack_sessions: [
          [{ role: "user", content: "The secret code is alpha.", has_answer: true }],
        ],
        answer_session_ids: ["s1"],
      },
      {
        question_id: "iso-2",
        question_type: "single-session-user",
        question: "What is the secret code?",
        answer: "beta",
        question_date: "2026-01-02",
        haystack_session_ids: ["s1"],
        haystack_dates: ["2026-01-02"],
        haystack_sessions: [
          [{ role: "user", content: "The secret code is beta.", has_answer: true }],
        ],
        answer_session_ids: ["s1"],
      },
    ];

    const report = await runLongMemEval(instances, { mode: "memory-stack", topK: 3 });
    const h1 = report.hypotheses.find((h) => h.question_id === "iso-1");
    const h2 = report.hypotheses.find((h) => h.question_id === "iso-2");
    expect(h1?.hypothesis).toContain("alpha");
    expect(h1?.hypothesis).not.toContain("beta");
    expect(h2?.hypothesis).toContain("beta");
    expect(h2?.hypothesis).not.toContain("alpha");
  });

  it("collects errors for malformed instances without crashing", async () => {
    // An instance with no sessions will still attempt ingest + search; it
    // shouldn't crash, but should produce an empty or abstention hypothesis.
    const broken: LongMemEvalInstance = {
      question_id: "broken-1",
      question_type: "single-session-user",
      question: "What?",
      answer: "nothing",
      question_date: "2026-01-01",
      haystack_session_ids: [],
      haystack_dates: [],
      haystack_sessions: [],
      answer_session_ids: [],
    };
    const report = await runLongMemEval([broken], { mode: "memory-stack", topK: 3 });
    expect(report.totalInstances).toBe(1);
    // Either the run errored gracefully or completed with an empty answer —
    // both are acceptable shapes; the invariant is that we don't crash.
    expect(report.errors.length + report.completedInstances).toBe(1);
  });

  it("reports wall-clock and runId", async () => {
    const report = await runLongMemEval(LONGMEMEVAL_SMOKE_CORPUS.slice(0, 2), {
      mode: "memory-stack",
      topK: 3,
    });
    expect(report.runId).toMatch(/^lme-/);
    expect(report.finishedAt).toBeGreaterThanOrEqual(report.startedAt);
  });

  it("rejects runtime mode without a runtime instance", async () => {
    await expect(
      runLongMemEval(LONGMEMEVAL_SMOKE_CORPUS.slice(0, 1), { mode: "runtime", topK: 2 }),
    ).rejects.toThrow(/runtime/);
  });
});
