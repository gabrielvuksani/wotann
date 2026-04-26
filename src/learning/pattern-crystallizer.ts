/**
 * Pattern Crystallizer — auto-generates skills from repeated action patterns.
 *
 * FROM OPENCLAW FOUNDRY RESEARCH:
 * "When a pattern hits 5+ uses with 70%+ success rate, Foundry crystallizes
 *  it into a dedicated tool, reducing 8 tool calls to 1."
 *
 * This is automagical self-improvement at the prompt/skill level:
 * 1. Track action sequences across sessions
 * 2. Detect repeating patterns (same tool sequence for similar tasks)
 * 3. When threshold reached (5+ uses, 70%+ success) → auto-generate SKILL.md
 * 4. Prune stale patterns (< 20% success or 30+ days unused)
 *
 * No model training required. No GPU. Immediate benefit.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveWotannHome } from "../utils/wotann-home.js";

// ── Types ────────────────────────────────────────────────

export interface ActionPattern {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly toolSequence: readonly string[]; // e.g., ["Read", "Grep", "Edit", "Bash"]
  readonly triggerKeywords: readonly string[]; // What prompts trigger this pattern
  readonly useCount: number;
  readonly successCount: number;
  readonly lastUsed: number;
  readonly createdAt: number;
  readonly crystallized: boolean; // true = promoted to skill
  readonly skillPath?: string; // Path to generated SKILL.md
}

export interface PatternMatch {
  readonly patternId: string;
  readonly similarity: number; // 0-1 Jaccard similarity of tool sequence
  readonly confidence: number; // successCount / useCount
}

// ── Pattern Crystallizer ─────────────────────────────────

export class PatternCrystallizer {
  private patterns: Map<string, ActionPattern> = new Map();
  private readonly dataPath: string;
  private readonly skillsDir: string;

  // Thresholds (from OpenClaw Foundry research)
  private readonly MIN_USES = 5;
  private readonly MIN_SUCCESS_RATE = 0.7;
  private readonly PRUNE_SUCCESS_RATE = 0.2;
  private readonly PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor() {
    const wotannDir = resolveWotannHome();
    this.dataPath = join(wotannDir, "patterns.json");
    this.skillsDir = join(wotannDir, "skills");

    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }

    this.loadPatterns();
  }

  /**
   * Record a tool sequence from a completed task.
   * Called after each successful (or failed) task execution.
   */
  recordPattern(
    toolSequence: readonly string[],
    triggerKeywords: readonly string[],
    success: boolean,
  ): PatternMatch | null {
    if (toolSequence.length < 2) return null;

    // Find existing pattern with similar tool sequence
    const match = this.findSimilarPattern(toolSequence);

    if (match && match.similarity >= 0.7) {
      // Update existing pattern
      const existing = this.patterns.get(match.patternId)!;
      const updated: ActionPattern = {
        ...existing,
        useCount: existing.useCount + 1,
        successCount: existing.successCount + (success ? 1 : 0),
        lastUsed: Date.now(),
        triggerKeywords: [...new Set([...existing.triggerKeywords, ...triggerKeywords])],
      };
      this.patterns.set(match.patternId, updated);

      // Check if ready for crystallization
      if (this.shouldCrystallize(updated)) {
        this.crystallize(updated);
      }

      this.savePatterns();
      return match;
    }

    // Create new pattern
    const id = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newPattern: ActionPattern = {
      id,
      name: this.generatePatternName(toolSequence, triggerKeywords),
      description: `Auto-detected pattern: ${toolSequence.join(" → ")}`,
      toolSequence,
      triggerKeywords,
      useCount: 1,
      successCount: success ? 1 : 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      crystallized: false,
    };
    this.patterns.set(id, newPattern);
    this.savePatterns();

    return null;
  }

  /**
   * Find a similar pattern by Jaccard similarity of tool sequences.
   */
  private findSimilarPattern(toolSequence: readonly string[]): PatternMatch | null {
    let bestMatch: PatternMatch | null = null;

    for (const [id, pattern] of this.patterns) {
      const similarity = this.jaccardSimilarity(toolSequence, pattern.toolSequence);
      const confidence = pattern.useCount > 0 ? pattern.successCount / pattern.useCount : 0;

      if (similarity > (bestMatch?.similarity ?? 0)) {
        bestMatch = { patternId: id, similarity, confidence };
      }
    }

    return bestMatch;
  }

  /**
   * Jaccard similarity of two tool sequences (order-aware via bigrams).
   */
  private jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
    const bigramsA = new Set(a.slice(0, -1).map((t, i) => `${t}→${a[i + 1]}`));
    const bigramsB = new Set(b.slice(0, -1).map((t, i) => `${t}→${b[i + 1]}`));

    if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }

    const union = bigramsA.size + bigramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Check if a pattern should be crystallized into a skill.
   */
  private shouldCrystallize(pattern: ActionPattern): boolean {
    if (pattern.crystallized) return false;
    if (pattern.useCount < this.MIN_USES) return false;

    const successRate = pattern.successCount / pattern.useCount;
    return successRate >= this.MIN_SUCCESS_RATE;
  }

  /**
   * Crystallize a pattern into a SKILL.md file.
   */
  private crystallize(pattern: ActionPattern): void {
    const skillName = pattern.name.toLowerCase().replace(/\s+/g, "-");
    const skillPath = join(this.skillsDir, `${skillName}.md`);

    const successRate = Math.round((pattern.successCount / pattern.useCount) * 100);
    const skillContent = [
      "---",
      `name: ${skillName}`,
      `description: Auto-crystallized pattern (${successRate}% success over ${pattern.useCount} uses)`,
      `paths: []`,
      "---",
      "",
      `# ${pattern.name}`,
      "",
      `Auto-generated by Pattern Crystallizer on ${new Date().toISOString()}.`,
      `Based on ${pattern.useCount} observed uses with ${successRate}% success rate.`,
      "",
      "## Tool Sequence",
      "",
      ...pattern.toolSequence.map((tool, i) => `${i + 1}. **${tool}**`),
      "",
      "## Trigger Keywords",
      "",
      pattern.triggerKeywords.map((k) => `- ${k}`).join("\n"),
      "",
      "## Instructions",
      "",
      `When the user's request matches these keywords, follow this tool sequence:`,
      "",
      pattern.toolSequence
        .map((tool, i) => `Step ${i + 1}: Use ${tool} to ${this.describeToolAction(tool)}`)
        .join("\n"),
      "",
    ].join("\n");

    writeFileSync(skillPath, skillContent);

    // Update pattern as crystallized
    this.patterns.set(pattern.id, {
      ...pattern,
      crystallized: true,
      skillPath,
    });

    console.log(`Pattern crystallized: ${pattern.name} → ${skillPath}`);
  }

  /**
   * Generate a human-readable name for a pattern.
   */
  private generatePatternName(tools: readonly string[], keywords: readonly string[]): string {
    const toolPart = tools.slice(0, 3).join("-");
    const keywordPart = keywords[0] ?? "general";
    return `${keywordPart}-${toolPart}`.slice(0, 40);
  }

  /**
   * Describe what a tool does (for generated skill instructions).
   */
  private describeToolAction(tool: string): string {
    const descriptions: Record<string, string> = {
      Read: "read the relevant file(s)",
      Grep: "search for the relevant code pattern",
      Glob: "find matching files",
      Edit: "make the necessary changes",
      Write: "create the new file",
      Bash: "run the verification command",
      LSP: "check symbol references",
      Agent: "delegate to a specialized agent",
    };
    return descriptions[tool] ?? "perform the action";
  }

  /**
   * Prune stale patterns (low success or old unused).
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [id, pattern] of this.patterns) {
      if (pattern.crystallized) continue; // Don't prune crystallized patterns

      const successRate = pattern.useCount > 0 ? pattern.successCount / pattern.useCount : 0;
      const age = now - pattern.lastUsed;

      if (
        (pattern.useCount >= 3 && successRate < this.PRUNE_SUCCESS_RATE) ||
        (age > this.PRUNE_AGE_MS && pattern.useCount < this.MIN_USES)
      ) {
        this.patterns.delete(id);
        pruned++;
      }
    }

    if (pruned > 0) this.savePatterns();
    return pruned;
  }

  /**
   * Get all patterns (for dashboard display).
   */
  getPatterns(): readonly ActionPattern[] {
    return [...this.patterns.values()];
  }

  /**
   * Get crystallized skills count.
   */
  getCrystallizedCount(): number {
    return [...this.patterns.values()].filter((p) => p.crystallized).length;
  }

  // ── Persistence ────────────────────────────────────────

  private loadPatterns(): void {
    if (!existsSync(this.dataPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.dataPath, "utf-8")) as ActionPattern[];
      this.patterns = new Map(data.map((p) => [p.id, p]));
    } catch {
      // Start fresh if corrupted
    }
  }

  private savePatterns(): void {
    const data = [...this.patterns.values()];
    writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
  }
}
