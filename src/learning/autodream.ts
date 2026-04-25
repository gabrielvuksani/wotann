/**
 * autoDream — Memory Consolidation.
 * Three-gate trigger, four-phase execution.
 * Corrections → gotchas → rules → instincts.
 */

import type { DreamInstinct, Gotcha } from "./types.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  SleepTimeAgent,
  SleepTimeOpportunity,
  SleepSessionReport,
} from "./sleep-time-agent.js";
import type { SummarizableEntry, SummarizeResult } from "../context/sleep-summarizer.js";

export type { DreamInstinct, Gotcha };

/** @deprecated Use DreamInstinct from ./types.js instead */
export type Instinct = DreamInstinct;

export interface DreamTriggerGates {
  readonly idleMinutes: number;
  readonly newObservations: number;
  readonly lastDreamHoursAgo: number;
}

export interface DreamResult {
  readonly patternsFound: number;
  readonly gotchasAdded: number;
  readonly instinctsUpdated: number;
  readonly duration: number;
}

/**
 * Check if autoDream should run (three-gate trigger).
 *
 * S2-8: idle threshold lowered from 30 min → 10 min, and dream cool-off
 * reduced from 4h → 2h. The stricter gates meant the learning stack
 * essentially never fired on real user sessions (people rarely leave a
 * TUI/desktop idle for 30 consecutive minutes while keeping it open).
 * Lowering the gates lets the consolidation pipeline actually run and
 * produce material for the next session.
 *
 * Override via env vars:
 *   WOTANN_DREAM_IDLE_MIN  — idle minutes required
 *   WOTANN_DREAM_COOLOFF_H — hours since last dream required
 *   WOTANN_DREAM_MIN_OBS   — minimum new observations
 */
export function shouldDream(gates: DreamTriggerGates): boolean {
  const idleThreshold = Number(process.env["WOTANN_DREAM_IDLE_MIN"] ?? 10);
  const cooloffHours = Number(process.env["WOTANN_DREAM_COOLOFF_H"] ?? 2);
  const minObservations = Number(process.env["WOTANN_DREAM_MIN_OBS"] ?? 5);

  // Gate 1: System is idle for long enough (default 10 min)
  if (gates.idleMinutes < idleThreshold) return false;

  // Gate 2: Enough new observations to consolidate
  if (gates.newObservations < minObservations) return false;

  // Gate 3: Haven't dreamed too recently (default 2h)
  if (gates.lastDreamHoursAgo < cooloffHours) return false;

  return true;
}

/**
 * Correction capture: detect corrections AND confirmations.
 */
export function classifyFeedback(message: string): {
  type: "correction" | "confirmation" | "neutral";
  confidence: number;
} {
  const correctionPatterns = [
    /\bno,?\s*(that's|you|it's)\b/i,
    /\bnot what I\b/i,
    /\bwrong\b/i,
    /\bdon't\b.*\binstead\b/i,
    /\bstop\b.*\b(doing|making)\b/i,
    /\bactually\b/i,
  ];

  const confirmationPatterns = [
    /\byes,?\s*(exactly|perfect|that's right)\b/i,
    /\bperfect\b/i,
    /\bgreat,?\s*(job|work)\b/i,
    /\bthat's\s*(what|exactly)\b/i,
    /\bkeep\s*(doing|going)\b/i,
  ];

  let correctionScore = 0;
  let confirmationScore = 0;

  for (const p of correctionPatterns) {
    if (p.test(message)) correctionScore++;
  }
  for (const p of confirmationPatterns) {
    if (p.test(message)) confirmationScore++;
  }

  if (correctionScore > confirmationScore && correctionScore > 0) {
    return { type: "correction", confidence: Math.min(correctionScore / 3, 1) };
  }
  if (confirmationScore > correctionScore && confirmationScore > 0) {
    return { type: "confirmation", confidence: Math.min(confirmationScore / 2, 1) };
  }
  return { type: "neutral", confidence: 0 };
}

/**
 * Instinct decay: reduce confidence over time.
 */
export function decayInstinct(instinct: Instinct, hoursSinceLastFire: number): Instinct {
  const decayFactor = Math.pow(instinct.decayRate, hoursSinceLastFire / 720); // 30-day half-life
  const newConfidence = Math.max(0.1, instinct.confidence * decayFactor);

  return {
    ...instinct,
    confidence: newConfidence,
  };
}

/**
 * Promote a correction to a gotcha entry.
 */
export function correctionToGotcha(correction: string, context: string): string {
  return [
    `## Gotcha: ${correction.slice(0, 80)}`,
    "",
    `**Context:** ${context}`,
    `**Correction:** ${correction}`,
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    `**Status:** Active`,
    "",
  ].join("\n");
}

// ── Four-Phase Execution Pipeline ────────────────────────────

export interface DreamPhaseResult {
  readonly phase: "recall" | "analyze" | "consolidate" | "prune";
  readonly itemsProcessed: number;
  readonly durationMs: number;
}

/**
 * Phase 1: RECALL — Gather recent observations, corrections, and confirmations.
 */
export function phaseRecall(
  observations: readonly string[],
  corrections: readonly { message: string; context: string }[],
  confirmations: readonly { message: string; context: string }[],
): {
  patterns: readonly string[];
  corrections: readonly string[];
  confirmations: readonly string[];
} {
  // Extract unique patterns from observations
  const patternCandidates = new Map<string, number>();
  for (const obs of observations) {
    const words = obs
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);
    for (const word of words) {
      patternCandidates.set(word, (patternCandidates.get(word) ?? 0) + 1);
    }
  }

  // Patterns that appear 3+ times are significant
  const patterns = [...patternCandidates.entries()]
    .filter(([_, count]) => count >= 3)
    .map(([word]) => word);

  return {
    patterns,
    corrections: corrections.map((c) => c.message),
    confirmations: confirmations.map((c) => c.message),
  };
}

/**
 * Phase 2: ANALYZE — Find themes, group related items, score by impact.
 */
export function phaseAnalyze(
  recalled: ReturnType<typeof phaseRecall>,
): readonly { theme: string; items: readonly string[]; impact: number }[] {
  const themes: { theme: string; items: string[]; impact: number }[] = [];

  // Group corrections by similarity (same words)
  if (recalled.corrections.length > 0) {
    themes.push({
      theme: "user-corrections",
      items: [...recalled.corrections],
      impact: 0.9, // Corrections are high-impact
    });
  }

  if (recalled.confirmations.length > 0) {
    themes.push({
      theme: "user-confirmations",
      items: [...recalled.confirmations],
      impact: 0.7,
    });
  }

  if (recalled.patterns.length > 0) {
    themes.push({
      theme: "recurring-patterns",
      items: [...recalled.patterns],
      impact: 0.5,
    });
  }

  return themes;
}

/**
 * Phase 3: CONSOLIDATE — Convert themes into durable knowledge.
 * Corrections → gotchas. Confirmations → instincts. Patterns → rules.
 */
export function phaseConsolidate(
  themes: readonly { theme: string; items: readonly string[]; impact: number }[],
): { gotchas: readonly string[]; instincts: readonly Instinct[]; rulesUpdated: number } {
  const gotchas: string[] = [];
  const instincts: Instinct[] = [];
  let rulesUpdated = 0;

  for (const theme of themes) {
    if (theme.theme === "user-corrections") {
      for (const item of theme.items) {
        gotchas.push(correctionToGotcha(item, theme.theme));
      }
    }

    if (theme.theme === "user-confirmations") {
      for (const item of theme.items) {
        instincts.push({
          id: `instinct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          behavior: item,
          confidence: 0.7,
          source: "confirmation",
          createdAt: new Date(),
          fireCount: 0,
          decayRate: 0.99,
        });
      }
    }

    if (theme.theme === "recurring-patterns") {
      rulesUpdated += theme.items.length;
    }
  }

  return { gotchas, instincts, rulesUpdated };
}

/**
 * Phase 4: PRUNE — Remove low-confidence instincts and outdated gotchas.
 */
export function phasePrune(
  instincts: readonly Instinct[],
  minConfidence: number = 0.15,
): readonly Instinct[] {
  return instincts.filter((i) => i.confidence >= minConfidence);
}

/**
 * Run the full 4-phase autoDream pipeline.
 */
export function runDreamPipeline(
  observations: readonly string[],
  corrections: readonly { message: string; context: string }[],
  confirmations: readonly { message: string; context: string }[],
  existingInstincts: readonly Instinct[],
): DreamResult {
  const startTime = Date.now();

  // Phase 1: Recall
  const recalled = phaseRecall(observations, corrections, confirmations);

  // Phase 2: Analyze
  const themes = phaseAnalyze(recalled);

  // Phase 3: Consolidate
  const consolidated = phaseConsolidate(themes);

  // Phase 4: Prune
  const prunedInstincts = phasePrune([...existingInstincts, ...consolidated.instincts]);

  return {
    patternsFound: recalled.patterns.length,
    gotchasAdded: consolidated.gotchas.length,
    instinctsUpdated: prunedInstincts.length,
    duration: Date.now() - startTime,
  };
}

// ── Gotcha Persistence ──────────────────────────────────────

/**
 * Load existing gotchas from a LESSONS.md file.
 * Returns empty array if file does not exist or is corrupt.
 */
export function loadGotchas(lessonsPath: string): readonly Gotcha[] {
  if (!existsSync(lessonsPath)) return [];
  try {
    const raw = readFileSync(lessonsPath, "utf-8");
    return parseGotchasFromMarkdown(raw);
  } catch {
    return [];
  }
}

/**
 * Persist gotchas to a LESSONS.md file, deduplicating against existing entries.
 * Returns the deduplicated merged set that was written.
 */
export function persistGotchas(
  lessonsPath: string,
  newGotchas: readonly string[],
  existingGotchas: readonly Gotcha[],
): readonly Gotcha[] {
  const existingDescriptions = new Set(
    existingGotchas.map((g) => normalizeGotchaKey(g.description)),
  );

  const dedupedNew: Gotcha[] = [];
  for (const raw of newGotchas) {
    const key = normalizeGotchaKey(raw);
    if (!existingDescriptions.has(key)) {
      existingDescriptions.add(key);
      dedupedNew.push({
        id: randomUUID(),
        description: raw,
        source: "dream-pipeline",
        severity: inferGotchaSeverity(raw),
        createdAt: Date.now(),
        appliedCount: 0,
      });
    }
  }

  if (dedupedNew.length === 0) return existingGotchas;

  const merged = [...existingGotchas, ...dedupedNew];

  // Write LESSONS.md
  const dir = lessonsPath.replace(/[/\\][^/\\]+$/, "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(lessonsPath, formatGotchasAsMarkdown(merged));

  return merged;
}

/**
 * Run the dream pipeline AND persist gotchas to disk.
 * Call this instead of runDreamPipeline when you want persistence.
 */
export function runDreamPipelineWithPersistence(
  observations: readonly string[],
  corrections: readonly { message: string; context: string }[],
  confirmations: readonly { message: string; context: string }[],
  existingInstincts: readonly Instinct[],
  wotannDir: string,
): DreamResult & { readonly gotchasPersisted: number } {
  const result = runDreamPipeline(observations, corrections, confirmations, existingInstincts);

  const lessonsPath = join(wotannDir, "LESSONS.md");
  const consolidated = phaseConsolidate(
    phaseAnalyze(phaseRecall(observations, corrections, confirmations)),
  );
  const existingGotchas = loadGotchas(lessonsPath);
  const merged = persistGotchas(lessonsPath, consolidated.gotchas, existingGotchas);
  const newCount = merged.length - existingGotchas.length;

  return { ...result, gotchasPersisted: newCount };
}

// ── Helpers ─────────────────────────────────────────────────

function normalizeGotchaKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function inferGotchaSeverity(text: string): Gotcha["severity"] {
  const lower = text.toLowerCase();
  if (lower.includes("critical") || lower.includes("security") || lower.includes("data loss")) {
    return "high";
  }
  if (lower.includes("wrong") || lower.includes("error") || lower.includes("fail")) {
    return "medium";
  }
  return "low";
}

function parseGotchasFromMarkdown(markdown: string): Gotcha[] {
  const gotchas: Gotcha[] = [];
  const blocks = markdown.split(/^## Gotcha:/m).filter(Boolean);

  for (const block of blocks) {
    const descMatch = block.match(/^(.+?)(?:\n|$)/);
    if (!descMatch?.[1]) continue;

    const correctionMatch = block.match(/\*\*Correction:\*\*\s*(.+)/);
    const dateMatch = block.match(/\*\*Date:\*\*\s*(.+)/);

    gotchas.push({
      id: randomUUID(),
      description: correctionMatch?.[1] ?? descMatch[1].trim(),
      source: "lessons-file",
      severity: "medium",
      createdAt: dateMatch?.[1] ? Date.parse(dateMatch[1]) : Date.now(),
      appliedCount: 0,
    });
  }

  return gotchas;
}

function formatGotchasAsMarkdown(gotchas: readonly Gotcha[]): string {
  const lines = [
    "# LESSONS — Gotchas Learned from Sessions",
    "",
    `*Last updated: ${new Date().toISOString().slice(0, 10)}*`,
    "",
  ];

  for (const gotcha of gotchas) {
    lines.push(`## Gotcha: ${gotcha.description.slice(0, 80)}`);
    lines.push("");
    lines.push(`**Severity:** ${gotcha.severity}`);
    lines.push(`**Source:** ${gotcha.source}`);
    lines.push(`**Date:** ${new Date(gotcha.createdAt).toISOString().slice(0, 10)}`);
    lines.push(`**Applied:** ${gotcha.appliedCount} times`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── Sleep-Time-Agent + Summarizer Wire (V9 T11.2) ───────────

/**
 * Function shape for the optional sleep-summarizer hook. Caller injects
 * the bound `summarizeForSleep` from `src/context/sleep-summarizer.ts`,
 * keeping autodream pure (no direct module-level coupling).
 */
export type SleepSummarizerHook = (opts: {
  readonly entries: readonly SummarizableEntry[];
  readonly targetTokens?: number;
}) => SummarizeResult;

/**
 * The optional dependency-injection bag for end-of-cycle sleep wiring.
 *
 * `sleepAgent` lets the dream pipeline schedule durable maintenance
 * (memory consolidation, cache warmup, plan rehearsal) during the same
 * idle window that triggered the dream. `summarizer` lets it collapse
 * recent observations into a compact summary block.
 *
 * Both are optional — when missing, the cycle reports `agentRan=false` /
 * `summaryProduced=false` rather than crashing. Per QB #6 honest stubs.
 * Per QB #7, callers thread fresh instances per cycle (no module globals).
 */
export interface SleepHooks {
  readonly sleepAgent?: SleepTimeAgent;
  readonly opportunity?: SleepTimeOpportunity;
  readonly summarizer?: SleepSummarizerHook;
  /** Target tokens for the summary block. Default 1024. */
  readonly summaryTargetTokens?: number;
}

export interface DreamResultWithSleepHooks extends DreamResult {
  /** True when sleepAgent.runIdleSession actually ran. */
  readonly sleepAgentRan: boolean;
  /** Tasks completed during the sleep session (zero when agentRan=false). */
  readonly sleepTasksCompleted: number;
  /** True when the summarizer produced a non-empty summary block. */
  readonly summaryProduced: boolean;
  /** Bytes of summary text emitted (zero when summaryProduced=false). */
  readonly summaryBytes: number;
  /** Honest reason when an optional hook didn't fire. */
  readonly skipReasons: readonly string[];
}

/**
 * Run the full 4-phase dream pipeline AND, when hooks are supplied,
 * wire the sleep-time-agent (`processIdleTime`) and summarizer
 * (`summarize`) at the END of the cycle.
 *
 * Honest stubs: missing hooks ⇒ `sleepAgentRan=false` /
 * `summaryProduced=false` with a reason in `skipReasons`. We never
 * silently treat absent dependencies as success.
 *
 * Per-call state: each invocation builds its own SummarizableEntry
 * list and forwards a fresh opportunity. No module globals.
 */
export async function runDreamPipelineWithSleepHooks(
  observations: readonly string[],
  corrections: readonly { message: string; context: string }[],
  confirmations: readonly { message: string; context: string }[],
  existingInstincts: readonly Instinct[],
  hooks: SleepHooks = {},
): Promise<DreamResultWithSleepHooks> {
  const baseResult = runDreamPipeline(observations, corrections, confirmations, existingInstincts);

  const skipReasons: string[] = [];
  let sleepAgentRan = false;
  let sleepTasksCompleted = 0;
  let summaryProduced = false;
  let summaryBytes = 0;

  // ── Sleep-time agent ───────────────────────────────────
  if (hooks.sleepAgent) {
    if (!hooks.opportunity) {
      skipReasons.push("sleepAgent supplied without opportunity");
    } else {
      try {
        const report: SleepSessionReport = await hooks.sleepAgent.runIdleSession(hooks.opportunity);
        sleepAgentRan = true;
        sleepTasksCompleted = report.results.filter((r) => r.ok).length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipReasons.push(`sleepAgent threw: ${msg}`);
      }
    }
  } else {
    skipReasons.push("sleepAgent not supplied");
  }

  // ── Sleep summarizer ───────────────────────────────────
  if (hooks.summarizer) {
    const entries: SummarizableEntry[] = observations.map((content, idx) => ({
      id: `obs-${idx}`,
      timestamp: Date.now() - (observations.length - idx) * 1000,
      source: "autodream-recall",
      content,
    }));
    if (entries.length === 0) {
      skipReasons.push("summarizer skipped: no observations to summarize");
    } else {
      try {
        const summarizeOpts: { entries: readonly SummarizableEntry[]; targetTokens?: number } = {
          entries,
        };
        if (hooks.summaryTargetTokens !== undefined) {
          summarizeOpts.targetTokens = hooks.summaryTargetTokens;
        }
        const result = hooks.summarizer(summarizeOpts);
        if (result.ok) {
          summaryProduced = true;
          summaryBytes = result.block.summary.length;
        } else {
          skipReasons.push(`summarizer abstained: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipReasons.push(`summarizer threw: ${msg}`);
      }
    }
  } else {
    skipReasons.push("summarizer not supplied");
  }

  return {
    ...baseResult,
    sleepAgentRan,
    sleepTasksCompleted,
    summaryProduced,
    summaryBytes,
    skipReasons,
  };
}
