/**
 * Tool-usage pattern detector.
 *
 * Agents often re-run the same sequence of tool calls: Read → Edit →
 * Bash(build). Read → Grep → Read. These repeated sequences are
 * opportunities for composite shortcuts — one "search_and_edit" tool
 * that batches three calls, reducing latency + context overhead.
 *
 * This module detects patterns by sequence n-gram mining on tool-call
 * history. It doesn't CREATE the shortcuts (that's a UX decision) but
 * surfaces candidates worth building.
 *
 * Ships:
 *   - PatternDetector class with record + analyze
 *   - mineNGrams(history, n) — returns counted sequences
 *   - suggestShortcuts(history, options) — ranks candidates by frequency
 */

// ── Types ──────────────────────────────────────────────

export interface ToolCall {
  readonly toolName: string;
  readonly at: number;
  /** Optional arg-fingerprint (for grouping similar calls). */
  readonly argHash?: string;
}

export interface Pattern {
  readonly sequence: readonly string[]; // ordered tool names
  readonly count: number;
  readonly totalDurationMs?: number;
}

export interface ShortcutSuggestion {
  readonly pattern: Pattern;
  /** Estimated time saved per use (ms). */
  readonly estimatedSavingMs: number;
  readonly reason: string;
}

export interface DetectorOptions {
  /** Min n-gram length. Default 2. */
  readonly minN?: number;
  /** Max n-gram length. Default 4. */
  readonly maxN?: number;
  /** Min occurrences to report. Default 3. */
  readonly minOccurrences?: number;
}

// ── N-gram mining ─────────────────────────────────────

export function mineNGrams(history: readonly ToolCall[], n: number): ReadonlyMap<string, Pattern> {
  const counts = new Map<string, Pattern>();
  if (history.length < n) return counts;

  for (let i = 0; i <= history.length - n; i++) {
    const window = history.slice(i, i + n);
    const seq = window.map((c) => c.toolName);
    const key = seq.join("→");
    const existing = counts.get(key);
    const durationEstimate = window.reduce((s, _, idx) => {
      if (idx === 0) return s;
      const prev = window[idx - 1]!;
      const curr = window[idx]!;
      return s + (curr.at - prev.at);
    }, 0);
    if (existing) {
      counts.set(key, {
        sequence: existing.sequence,
        count: existing.count + 1,
        totalDurationMs: (existing.totalDurationMs ?? 0) + durationEstimate,
      });
    } else {
      counts.set(key, {
        sequence: seq,
        count: 1,
        totalDurationMs: durationEstimate,
      });
    }
  }

  return counts;
}

// ── Detector ───────────────────────────────────────────

export class PatternDetector {
  private history: ToolCall[] = [];
  private readonly maxHistory: number;

  constructor(options: { readonly maxHistory?: number } = {}) {
    this.maxHistory = options.maxHistory ?? 500;
  }

  record(call: Omit<ToolCall, "at"> & { readonly at?: number }): void {
    const entry: ToolCall = {
      toolName: call.toolName,
      at: call.at ?? Date.now(),
      ...(call.argHash !== undefined ? { argHash: call.argHash } : {}),
    };
    this.history.push(entry);
    while (this.history.length > this.maxHistory) this.history.shift();
  }

  getHistory(): readonly ToolCall[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
  }

  /**
   * Analyze the history and produce shortcut suggestions ranked by
   * estimated benefit (count × avg duration).
   */
  suggestShortcuts(options: DetectorOptions = {}): readonly ShortcutSuggestion[] {
    const minN = options.minN ?? 2;
    const maxN = options.maxN ?? 4;
    const minOccurrences = options.minOccurrences ?? 3;

    const allPatterns: Pattern[] = [];
    for (let n = minN; n <= maxN; n++) {
      const ngrams = mineNGrams(this.history, n);
      for (const p of ngrams.values()) {
        if (p.count >= minOccurrences) allPatterns.push(p);
      }
    }

    const suggestions: ShortcutSuggestion[] = allPatterns.map((p) => {
      const avgDuration = (p.totalDurationMs ?? 0) / p.count;
      const estimatedSavingMs = avgDuration * p.count * 0.5; // assume 50% reduction via composite
      return {
        pattern: p,
        estimatedSavingMs,
        reason: `${p.sequence.join(" → ")} seen ${p.count}× (avg ${avgDuration.toFixed(0)}ms per occurrence)`,
      };
    });

    suggestions.sort((a, b) => b.estimatedSavingMs - a.estimatedSavingMs);
    return suggestions;
  }

  /** Count of distinct tools ever invoked. */
  uniqueToolCount(): number {
    const set = new Set<string>();
    for (const c of this.history) set.add(c.toolName);
    return set.size;
  }

  /** Most-used tools. */
  topTools(limit: number = 10): readonly { readonly name: string; readonly count: number }[] {
    const counts = new Map<string, number>();
    for (const c of this.history) {
      counts.set(c.toolName, (counts.get(c.toolName) ?? 0) + 1);
    }
    const entries = [...counts.entries()].map(([name, count]) => ({ name, count }));
    entries.sort((a, b) => b.count - a.count);
    return entries.slice(0, limit);
  }
}
