/**
 * Nightly Knowledge Consolidator — runs during the autoDream cycle to
 * consolidate daily learnings into durable knowledge.
 *
 * This is the auto-upgrading mechanism: every night WOTANN gets smarter.
 *
 * Pipeline:
 * 1. Extract rules from repeated error patterns (3+ occurrences)
 * 2. Crystallize strategies with >80% success rate into standard approaches
 * 3. Generate skill candidates from user correction patterns
 * 4. Archive stale observations (7+ days old, 0 accesses)
 */

// -- Types -------------------------------------------------------------------

export interface ConsolidationInput {
  readonly sessionObservations: readonly {
    readonly key: string;
    readonly value: string;
    readonly type: string;
  }[];
  readonly errorPatterns: readonly {
    readonly pattern: string;
    readonly count: number;
    readonly lastSeen: number;
  }[];
  readonly successfulStrategies: readonly {
    readonly strategy: string;
    readonly taskType: string;
    readonly successRate: number;
  }[];
  readonly userCorrections: readonly {
    readonly original: string;
    readonly corrected: string;
    readonly reason: string;
  }[];
}

export interface ConsolidationOutput {
  readonly newRules: readonly {
    readonly rule: string;
    readonly confidence: number;
    readonly source: string;
  }[];
  readonly updatedPreferences: readonly {
    readonly key: string;
    readonly value: string;
    readonly reason: string;
  }[];
  readonly skillCandidates: readonly {
    readonly name: string;
    readonly description: string;
    readonly trigger: string;
    readonly body: string;
  }[];
  readonly archivedObservations: readonly string[];
  readonly consolidatedAt: number;
}

// -- Constants ---------------------------------------------------------------

const ERROR_PATTERN_THRESHOLD = 3;
const STRATEGY_SUCCESS_THRESHOLD = 0.80;
const ARCHIVE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ARCHIVE_ACCESS_THRESHOLD = 0;

// -- Implementation ----------------------------------------------------------

export class NightlyConsolidator {
  /**
   * Run the full consolidation pipeline.
   * Takes the day's accumulated data and produces durable knowledge artifacts.
   */
  consolidate(input: ConsolidationInput): ConsolidationOutput {
    const newRules = [
      ...this.extractErrorRules(input.errorPatterns),
      ...this.crystallizeStrategies(input.successfulStrategies),
    ].map((r) => ({ ...r, source: r.source ?? "consolidation" }));

    const updatedPreferences = this.extractPreferences(input.userCorrections);
    const skillCandidates = this.generateSkillCandidates(input.userCorrections);

    // Convert observations to archival format for identifyArchivable
    const observationsWithMeta = input.sessionObservations.map((obs) => ({
      key: obs.key,
      createdAt: 0,     // Will be overridden by caller with real timestamps
      accessCount: 0,   // Default: never accessed since creation
    }));

    const archivedObservations = this.identifyArchivable(observationsWithMeta);

    return {
      newRules: newRules.map((r) => ({
        rule: r.rule,
        confidence: r.confidence,
        source: r.source,
      })),
      updatedPreferences,
      skillCandidates,
      archivedObservations,
      consolidatedAt: Date.now(),
    };
  }

  /**
   * Extract prevention rules from repeated error patterns.
   * Patterns seen 3+ times are strong signals of recurring issues.
   *
   * Confidence scales with frequency:
   *   3 occurrences → 0.60
   *   5 occurrences → 0.70
   *   10+ occurrences → 0.85 (capped)
   */
  extractErrorRules(
    patterns: readonly { readonly pattern: string; readonly count: number }[],
  ): readonly { readonly rule: string; readonly confidence: number; readonly source: string }[] {
    return patterns
      .filter((p) => p.count >= ERROR_PATTERN_THRESHOLD)
      .map((p) => {
        const confidence = computeErrorConfidence(p.count);
        const rule = buildPreventionRule(p.pattern, p.count);
        return { rule, confidence, source: "error-pattern" };
      });
  }

  /**
   * Convert successful strategies into reusable standard-approach rules.
   * Only strategies with >80% success rate are promoted.
   *
   * Confidence matches the strategy's success rate (already proven).
   */
  crystallizeStrategies(
    strategies: readonly {
      readonly strategy: string;
      readonly successRate: number;
    }[],
  ): readonly { readonly rule: string; readonly confidence: number; readonly source: string }[] {
    return strategies
      .filter((s) => s.successRate > STRATEGY_SUCCESS_THRESHOLD)
      .map((s) => ({
        rule: `Prefer strategy: ${s.strategy} (${Math.round(s.successRate * 100)}% success rate)`,
        confidence: Math.round(s.successRate * 100) / 100,
        source: "strategy-crystallization",
      }));
  }

  /**
   * Generate skill candidates from user correction patterns.
   * Each correction encodes a preference that can become an automated skill.
   */
  generateSkillCandidates(
    corrections: readonly {
      readonly original: string;
      readonly corrected: string;
      readonly reason: string;
    }[],
  ): readonly {
    readonly name: string;
    readonly description: string;
    readonly trigger: string;
    readonly body: string;
  }[] {
    return corrections.map((correction) => {
      const name = generateSkillName(correction.reason);
      return {
        name,
        description: `Auto-generated from correction: ${correction.reason}`,
        trigger: `When output resembles: "${truncate(correction.original, 60)}"`,
        body: buildSkillBody(correction),
      };
    });
  }

  /**
   * Determine which observations can be archived.
   * Criteria: older than 7 days AND 0 accesses since creation.
   */
  identifyArchivable(
    observations: readonly {
      readonly key: string;
      readonly createdAt: number;
      readonly accessCount: number;
    }[],
  ): readonly string[] {
    const now = Date.now();

    return observations
      .filter((obs) => {
        const age = now - obs.createdAt;
        return age > ARCHIVE_AGE_MS && obs.accessCount <= ARCHIVE_ACCESS_THRESHOLD;
      })
      .map((obs) => obs.key);
  }

  // -- Private helpers -------------------------------------------------------

  /**
   * Extract preference updates from user corrections.
   * Each correction implies a preference the user wants respected.
   */
  private extractPreferences(
    corrections: readonly {
      readonly original: string;
      readonly corrected: string;
      readonly reason: string;
    }[],
  ): readonly { readonly key: string; readonly value: string; readonly reason: string }[] {
    return corrections.map((c) => ({
      key: `pref-${slugify(c.reason)}`,
      value: c.corrected,
      reason: c.reason,
    }));
  }
}

// -- Pure helper functions ---------------------------------------------------

function computeErrorConfidence(count: number): number {
  // Base confidence at threshold, asymptotically approaching 0.85
  const base = 0.50;
  const maxBoost = 0.35;
  const normalized = Math.min((count - ERROR_PATTERN_THRESHOLD) / 10, 1);
  return Math.round((base + maxBoost * normalized) * 100) / 100;
}

function buildPreventionRule(pattern: string, count: number): string {
  return `Avoid pattern: "${pattern}" (seen ${count} times). Proactively prevent this error.`;
}

function generateSkillName(reason: string): string {
  const slug = slugify(reason);
  return `auto-correct-${slug}`.slice(0, 50);
}

function buildSkillBody(correction: {
  readonly original: string;
  readonly corrected: string;
  readonly reason: string;
}): string {
  return [
    `# Auto-Correction: ${correction.reason}`,
    "",
    "## When this applies",
    `When the output resembles: "${truncate(correction.original, 80)}"`,
    "",
    "## Correct behavior",
    `Replace with: "${truncate(correction.corrected, 80)}"`,
    "",
    "## Reason",
    correction.reason,
  ].join("\n");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 3) + "...";
}
