/**
 * Reflection buffer — persist mistakes + corrections for cross-session.
 *
 * When an agent makes a mistake and then corrects it (either via user
 * feedback or self-discovery), that pair is high-value learning
 * signal. Logging them to a reflection buffer means future sessions
 * can surface the correction BEFORE repeating the mistake.
 *
 * ReflectionBuffer stores tuples of:
 *   - context:    what the agent was trying to do
 *   - mistake:    what went wrong
 *   - correction: what the right answer was
 *   - tags:       for filtering (e.g. "bash", "typescript", "memory")
 *   - createdAt:  for recency-based retrieval
 *
 * Retrieval is by tag match + substring over context/mistake. Pure
 * in-memory; callers own persistence.
 */

// ── Types ──────────────────────────────────────────────

export interface ReflectionEntry {
  readonly id: string;
  readonly context: string;
  readonly mistake: string;
  readonly correction: string;
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly hits: number; // retrieval count (recency boost)
}

export interface AddEntryInput {
  readonly context: string;
  readonly mistake: string;
  readonly correction: string;
  readonly tags?: readonly string[];
}

export interface RetrieveOptions {
  /** Max entries to return. Default 5. */
  readonly limit?: number;
  /** Filter by tag (any-match). */
  readonly tags?: readonly string[];
  /** Substring query against context + mistake. */
  readonly query?: string;
  /** Minimum days old. Default 0. */
  readonly minAgeDays?: number;
  /** Maximum days old (recency filter). Default undefined. */
  readonly maxAgeDays?: number;
}

// ── Buffer ─────────────────────────────────────────────

export class ReflectionBuffer {
  private entries: ReflectionEntry[] = [];
  private idCounter = 0;
  private readonly now: () => number;

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Record a mistake + correction. */
  add(input: AddEntryInput): ReflectionEntry {
    const entry: ReflectionEntry = {
      id: `refl-${++this.idCounter}`,
      context: input.context,
      mistake: input.mistake,
      correction: input.correction,
      tags: input.tags ?? [],
      createdAt: this.now(),
      hits: 0,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Retrieve relevant reflections for a context. */
  retrieve(options: RetrieveOptions = {}): readonly ReflectionEntry[] {
    const limit = options.limit ?? 5;
    const minAgeMs = (options.minAgeDays ?? 0) * 86_400_000;
    const maxAgeMs = options.maxAgeDays !== undefined ? options.maxAgeDays * 86_400_000 : Infinity;
    const now = this.now();
    const queryLower = options.query?.toLowerCase();

    const scored = this.entries
      .filter((e) => {
        const age = now - e.createdAt;
        if (age < minAgeMs) return false;
        if (age > maxAgeMs) return false;
        if (options.tags && options.tags.length > 0) {
          if (!e.tags.some((t) => options.tags!.includes(t))) return false;
        }
        if (queryLower) {
          const combined = `${e.context} ${e.mistake}`.toLowerCase();
          if (!combined.includes(queryLower)) return false;
        }
        return true;
      })
      .map((entry) => ({
        entry,
        score: computeScore(entry, options, now),
      }));

    scored.sort((a, b) => b.score - a.score);

    // Update hits for returned entries
    const returned = scored.slice(0, limit).map((s) => s.entry);
    for (const entry of returned) {
      const idx = this.entries.findIndex((e) => e.id === entry.id);
      if (idx >= 0) {
        this.entries[idx] = { ...this.entries[idx]!, hits: this.entries[idx]!.hits + 1 };
      }
    }

    return returned;
  }

  /** Format reflections as a prompt-injectable block. */
  formatForPrompt(entries: readonly ReflectionEntry[]): string {
    if (entries.length === 0) return "";
    const lines = [
      "## Relevant past mistakes + corrections",
      "Before proceeding, recall these past lessons:",
      "",
    ];
    for (const e of entries) {
      lines.push(`- Context: ${e.context}`);
      lines.push(`  Mistake: ${e.mistake}`);
      lines.push(`  Correction: ${e.correction}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  size(): number {
    return this.entries.length;
  }

  list(): readonly ReflectionEntry[] {
    return [...this.entries];
  }

  removeById(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  clear(): void {
    this.entries = [];
    this.idCounter = 0;
  }

  /** Serialize to JSON for persistence. */
  serialize(): string {
    return JSON.stringify({ entries: this.entries, idCounter: this.idCounter });
  }

  /** Restore from previously serialized state. */
  loadSerialized(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as {
        entries?: ReflectionEntry[];
        idCounter?: number;
      };
      if (Array.isArray(parsed.entries)) this.entries = parsed.entries;
      if (typeof parsed.idCounter === "number") this.idCounter = parsed.idCounter;
    } catch {
      // Invalid — leave empty
    }
  }
}

// ── Scoring ────────────────────────────────────────────

function computeScore(entry: ReflectionEntry, options: RetrieveOptions, now: number): number {
  // Base: recency decay (1/day)
  const ageDays = (now - entry.createdAt) / 86_400_000;
  let score = 1 / (1 + ageDays * 0.1);

  // Boost by hits (reflections that keep surfacing are more useful)
  score += entry.hits * 0.1;

  // Tag match boost
  if (options.tags && options.tags.length > 0) {
    const matchCount = entry.tags.filter((t) => options.tags!.includes(t)).length;
    score += matchCount * 0.2;
  }

  // Query substring boost
  if (options.query) {
    const q = options.query.toLowerCase();
    if (entry.context.toLowerCase().includes(q)) score += 0.3;
    if (entry.mistake.toLowerCase().includes(q)) score += 0.2;
  }

  return score;
}
