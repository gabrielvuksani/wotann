/**
 * Error Pattern Learner: track which error patterns lead to which fixes.
 * After N sessions, common error->fix pairs become instant corrections.
 *
 * Based on TerminalBench research:
 * - ForgeCode: Error-aware retry with model-specific harness adaptation
 * - LangChain: LoopDetection + error analysis for breaking retry cycles
 * - SWE-bench Pro: Trajectory-level failure analysis feeds future runs
 *
 * Workflow:
 * 1. Agent encounters an error -> recordFix() captures the error + fix attempt
 * 2. On success/failure, confidence is updated
 * 3. Next time the same error appears -> findMatchingPattern() returns the fix
 * 4. High-confidence patterns (>= 0.8) can be applied automatically
 * 5. Patterns are exported/imported for cross-session persistence
 */

// ── Types ────────────────────────────────────────────────────

export interface ErrorPattern {
  readonly id: string;
  readonly errorSignature: string; // Normalized error message
  readonly fixApproach: string;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastSeen: number;
  readonly confidence: number; // successCount / (successCount + failureCount)
}

// ── Normalization Rules ──────────────────────────────────────

/**
 * Patterns stripped during normalization to produce stable error signatures.
 * Order matters: broader patterns last.
 */
const NORMALIZATION_RULES: readonly RegExp[] = [
  // Strip absolute file paths (preserve basename)
  /(?:\/[\w.\-]+)+\/([\w.\-]+)/g,
  // Strip UUIDs (BEFORE line numbers to avoid partial digit matches)
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // Strip timestamps (ISO, Unix) — before line numbers to avoid partial matches
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g,
  /\b\d{10,13}\b/g,
  // Strip hexadecimal addresses
  /0x[0-9a-fA-F]+/g,
  // Strip line:column numbers
  /\b(?:line\s+)?\d+(?::\d+)?(?:\s*[-–]\s*\d+(?::\d+)?)?\b/gi,
  // Collapse whitespace
  /\s+/g,
];

// ── Learner ──────────────────────────────────────────────────

const DEFAULT_AUTO_CORRECTION_THRESHOLD = 0.8;

export class ErrorPatternLearner {
  private readonly patterns: Map<string, ErrorPattern> = new Map();

  /**
   * Record an error and its eventual fix attempt.
   * Creates a new pattern or updates confidence of an existing one.
   */
  recordFix(errorMessage: string, fixDescription: string, success: boolean): void {
    const signature = normalizeError(errorMessage);
    const existing = this.patterns.get(signature);

    if (existing) {
      // Update existing pattern immutably
      const newSuccessCount = existing.successCount + (success ? 1 : 0);
      const newFailureCount = existing.failureCount + (success ? 0 : 1);
      const total = newSuccessCount + newFailureCount;

      const updated: ErrorPattern = {
        ...existing,
        fixApproach: success ? fixDescription : existing.fixApproach,
        successCount: newSuccessCount,
        failureCount: newFailureCount,
        lastSeen: Date.now(),
        confidence: total > 0 ? roundTo(newSuccessCount / total, 3) : 0,
      };
      this.patterns.set(signature, updated);
    } else {
      // Create new pattern
      const pattern: ErrorPattern = {
        id: generatePatternId(signature),
        errorSignature: signature,
        fixApproach: fixDescription,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        lastSeen: Date.now(),
        confidence: success ? 1.0 : 0.0,
      };
      this.patterns.set(signature, pattern);
    }
  }

  /**
   * Look up if we have seen this error before.
   * Returns the best matching pattern or null if no match found.
   */
  findMatchingPattern(errorMessage: string): ErrorPattern | null {
    const signature = normalizeError(errorMessage);

    // Exact match first
    const exact = this.patterns.get(signature);
    if (exact) return exact;

    // Fuzzy match: find patterns whose signature shares significant tokens
    let bestMatch: ErrorPattern | null = null;
    let bestScore = 0;

    const queryTokens = tokenize(signature);
    if (queryTokens.length === 0) return null;

    for (const pattern of this.patterns.values()) {
      const patternTokens = tokenize(pattern.errorSignature);
      const score = computeTokenOverlap(queryTokens, patternTokens);

      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = pattern;
      }
    }

    return bestMatch;
  }

  /**
   * Get high-confidence patterns suitable for automatic correction.
   * Returns patterns sorted by confidence (highest first).
   */
  getAutoCorrections(minConfidence?: number): readonly ErrorPattern[] {
    const threshold = minConfidence ?? DEFAULT_AUTO_CORRECTION_THRESHOLD;
    const results: ErrorPattern[] = [];

    for (const pattern of this.patterns.values()) {
      const totalObservations = pattern.successCount + pattern.failureCount;
      // Require at least 2 observations to be considered reliable
      if (pattern.confidence >= threshold && totalObservations >= 2) {
        results.push(pattern);
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get all patterns, optionally sorted by last seen time.
   */
  getAllPatterns(): readonly ErrorPattern[] {
    return [...this.patterns.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /**
   * Get the total number of tracked patterns.
   */
  getPatternCount(): number {
    return this.patterns.size;
  }

  /**
   * Export all patterns for persistence (e.g., to disk or database).
   * Returns an immutable snapshot.
   */
  exportPatterns(): readonly ErrorPattern[] {
    return [...this.patterns.values()];
  }

  /**
   * Import patterns from a previously exported snapshot.
   * Merges with existing patterns; higher-confidence version wins on conflict.
   */
  importPatterns(patterns: readonly ErrorPattern[]): void {
    for (const incoming of patterns) {
      const existing = this.patterns.get(incoming.errorSignature);

      if (!existing) {
        this.patterns.set(incoming.errorSignature, incoming);
      } else {
        // Merge: keep the one with more observations
        const existingTotal = existing.successCount + existing.failureCount;
        const incomingTotal = incoming.successCount + incoming.failureCount;

        if (incomingTotal > existingTotal) {
          this.patterns.set(incoming.errorSignature, incoming);
        }
      }
    }
  }

  /**
   * Remove patterns older than the given age (in milliseconds).
   * Returns the number of patterns removed.
   */
  pruneOldPatterns(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [key, pattern] of this.patterns) {
      if (pattern.lastSeen < cutoff) {
        this.patterns.delete(key);
        removed++;
      }
    }

    return removed;
  }
}

// ── Normalization ────────────────────────────────────────────

/**
 * Normalize an error message to produce a stable signature for matching.
 * Strips file paths, line numbers, timestamps, UUIDs, and collapses whitespace.
 */
function normalizeError(error: string): string {
  let normalized = error;

  for (const rule of NORMALIZATION_RULES) {
    // Create a new RegExp for each use to reset lastIndex on global patterns
    const fresh = new RegExp(rule.source, rule.flags);
    normalized = normalized.replace(fresh, (match, group1?: string) => {
      // For file paths, preserve the basename
      if (group1) return group1;
      // For whitespace collapse, use single space
      if (/^\s+$/.test(match)) return " ";
      // For everything else, use placeholder
      return "<*>";
    });
  }

  return normalized.trim().toLowerCase();
}

// ── Helpers ──────────────────────────────────────────────────

function generatePatternId(signature: string): string {
  // Simple hash-like ID from the signature
  let hash = 0;
  for (let i = 0; i < signature.length; i++) {
    const char = signature.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `ep_${Math.abs(hash).toString(36)}`;
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function computeTokenOverlap(
  tokensA: readonly string[],
  tokensB: readonly string[],
): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setB = new Set(tokensB);
  let matches = 0;
  for (const token of tokensA) {
    if (setB.has(token)) matches++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? matches / union : 0;
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
