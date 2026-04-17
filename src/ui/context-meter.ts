/**
 * Context meter (C9) — categorised radial dial data model.
 *
 * Conductor's context meter broke tokens down into categories (system
 * prompt, conversation, tools, docs, memory) rather than a single
 * fill bar. This module owns the pure data model so any renderer
 * (TUI radial glyph, desktop SVG dial, iOS progress ring) consumes
 * the same shape.
 */

export type ContextCategory =
  | "system" // system prompt + persistent instructions
  | "conversation" // user + assistant turns
  | "tools" // tool_use + tool_result blocks
  | "docs" // attached files / retrieved context
  | "memory" // Engram/claude-mem injected observations
  | "other"; // unclassified overhead

export interface ContextBudget {
  readonly usedTokens: number;
  readonly limit: number;
  readonly categories: Record<ContextCategory, number>;
}

export interface ContextMeterReading {
  readonly percent: number; // 0..100
  readonly severity: "ok" | "warn" | "critical";
  readonly remainingTokens: number;
  readonly slices: readonly ContextSlice[];
  readonly mostExpensiveCategory: ContextCategory | undefined;
}

export interface ContextSlice {
  readonly category: ContextCategory;
  readonly tokens: number;
  readonly percent: number; // of total limit, not of used
  readonly percentOfUsed: number;
}

const WARN_PERCENT = 70;
const CRITICAL_PERCENT = 88;

const CATEGORY_ORDER: readonly ContextCategory[] = [
  "system",
  "memory",
  "docs",
  "tools",
  "conversation",
  "other",
];

export function buildReading(budget: ContextBudget): ContextMeterReading {
  const limit = Math.max(1, budget.limit);
  const used = Math.max(0, budget.usedTokens);
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const severity: ContextMeterReading["severity"] =
    percent >= CRITICAL_PERCENT ? "critical" : percent >= WARN_PERCENT ? "warn" : "ok";

  const slices: ContextSlice[] = CATEGORY_ORDER.map((category) => {
    const tokens = Math.max(0, budget.categories[category] ?? 0);
    return {
      category,
      tokens,
      percent: Math.round((tokens / limit) * 1000) / 10,
      percentOfUsed: used > 0 ? Math.round((tokens / used) * 1000) / 10 : 0,
    };
  }).filter((s) => s.tokens > 0);

  const mostExpensive = slices.reduce<ContextSlice | undefined>(
    (acc, slice) => (acc === undefined || slice.tokens > acc.tokens ? slice : acc),
    undefined,
  );

  return {
    percent,
    severity,
    remainingTokens: Math.max(0, limit - used),
    slices,
    mostExpensiveCategory: mostExpensive?.category,
  };
}

// ── ASCII radial renderer (TUI / terminal fallback) ──────────

/**
 * 12-sector radial glyph keyed to severity and percent.
 * Returns a single line suitable for a status bar.
 */
export function renderRadialAscii(reading: ContextMeterReading): string {
  const filled = Math.round((reading.percent / 100) * 12);
  const empty = 12 - filled;
  const dots = "●".repeat(Math.max(0, filled)) + "○".repeat(Math.max(0, empty));
  const marker = reading.severity === "critical" ? "!!" : reading.severity === "warn" ? "!" : "";
  const topLabel = reading.mostExpensiveCategory ? ` · top: ${reading.mostExpensiveCategory}` : "";
  return `⧖ ${dots} ${reading.percent}%${marker}${topLabel}`;
}

/**
 * Render a compact multi-line breakdown suitable for `wotann context`.
 */
export function renderBreakdown(reading: ContextMeterReading): string {
  const lines: string[] = [
    `Context: ${reading.percent}% used (${reading.severity})`,
    `Remaining: ${reading.remainingTokens.toLocaleString()} tokens`,
    "",
  ];
  if (reading.slices.length === 0) {
    lines.push("(no category data)");
    return lines.join("\n");
  }
  const maxTokens = Math.max(...reading.slices.map((s) => s.tokens));
  for (const slice of reading.slices) {
    const bar = "▇".repeat(Math.max(1, Math.round((slice.tokens / maxTokens) * 20)));
    lines.push(
      `${slice.category.padEnd(12)} ${bar.padEnd(20)} ${slice.tokens.toLocaleString()} (${slice.percent}%)`,
    );
  }
  return lines.join("\n");
}

// ── Partial-update helper for incremental accounting ─────────

/**
 * Merge a token delta into an existing budget snapshot. Useful when
 * the runtime accumulates tokens per-turn — callers pass the prior
 * snapshot and a partial categories delta; receive a new snapshot.
 */
export function applyDelta(
  prev: ContextBudget,
  delta: Partial<Record<ContextCategory, number>>,
): ContextBudget {
  const categories: Record<ContextCategory, number> = { ...prev.categories };
  let addedUsed = 0;
  for (const [cat, add] of Object.entries(delta) as Array<[ContextCategory, number | undefined]>) {
    if (!add) continue;
    categories[cat] = (categories[cat] ?? 0) + add;
    addedUsed += add;
  }
  return {
    usedTokens: prev.usedTokens + addedUsed,
    limit: prev.limit,
    categories,
  };
}

export function emptyBudget(limit: number): ContextBudget {
  return {
    usedTokens: 0,
    limit,
    categories: {
      system: 0,
      conversation: 0,
      tools: 0,
      docs: 0,
      memory: 0,
      other: 0,
    },
  };
}
