/**
 * Skill Forge: automatic skill creation from solved problems.
 * Inspired by Hermes self-improving skills pattern.
 *
 * Analyzes completed sessions to detect repeatable patterns,
 * generates SKILL.md definitions, and promotes candidates
 * once confidence exceeds threshold.
 *
 * Skills auto-improve: failure records reduce confidence,
 * successes boost confidence and frequency.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MemoryStore } from "../memory/store.js";

// ── Types ──────────────────────────────────────────────────

export interface SessionAction {
  readonly type: string;
  readonly tool?: string;
  readonly input?: string;
  readonly output?: string;
  readonly success: boolean;
  readonly timestamp: number;
  readonly domain?: string;
}

export interface SkillPattern {
  readonly id: string;
  readonly trigger: string;
  readonly actions: readonly PatternAction[];
  readonly successRate: number;
  readonly frequency: number;
  readonly domain: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export interface PatternAction {
  readonly type: string;
  readonly tool?: string;
  readonly description: string;
}

export interface SkillCandidate {
  readonly id: string;
  readonly pattern: SkillPattern;
  readonly confidence: number;
  readonly status: CandidateStatus;
  readonly generatedContent?: string;
  readonly failureReasons: readonly string[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CandidateStatus = "detected" | "candidate" | "promoted" | "rejected";

export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly trigger: string;
  readonly content: string;
}

export interface AnalysisResult {
  readonly patternsFound: number;
  readonly candidatesCreated: number;
  readonly candidatesUpdated: number;
  readonly candidatesPromotable: number;
}

// ── Constants ──────────────────────────────────────────────

const MIN_PATTERN_FREQUENCY = 3;
const MIN_PATTERN_SUCCESS_RATE = 0.7;
const PROMOTION_CONFIDENCE_THRESHOLD = 0.85;
const REJECTION_CONFIDENCE_THRESHOLD = 0.2;
const CONFIDENCE_BOOST_ON_SUCCESS = 0.05;
const CONFIDENCE_PENALTY_ON_FAILURE = 0.1;
const MIN_SEQUENCE_LENGTH = 2;
const MAX_SEQUENCE_LENGTH = 10;

// ── Skill Forge ────────────────────────────────────────────

interface PersistedState {
  readonly patterns: readonly SkillPattern[];
  readonly candidates: readonly SkillCandidate[];
}

export class SkillForge {
  private readonly patterns: Map<string, SkillPattern> = new Map();
  private readonly candidates: Map<string, SkillCandidate> = new Map();
  private readonly persistPath: string | undefined;
  private readonly skillsDir: string | undefined;
  private memoryStore: MemoryStore | null = null;
  private readonly versionMap: Map<string, number> = new Map();

  constructor(persistPath?: string, skillsDir?: string) {
    this.persistPath = persistPath;
    this.skillsDir = skillsDir;
    if (persistPath) {
      this.restoreFromDisk(persistPath);
    }
  }

  /**
   * Attach a MemoryStore for persisting patterns and candidates
   * into the memory layer with layer="skill".
   */
  setMemoryStore(store: MemoryStore): void {
    this.memoryStore = store;
  }

  /**
   * Analyze a completed session's actions to detect patterns
   * worth extracting into skills.
   */
  analyzeSession(actions: readonly SessionAction[]): AnalysisResult {
    const sequences = extractActionSequences(actions);
    let candidatesCreated = 0;
    let candidatesUpdated = 0;

    for (const sequence of sequences) {
      const patternKey = buildPatternKey(sequence);
      const existing = this.patterns.get(patternKey);

      if (existing) {
        // Update frequency and success rate
        const successCount = sequence.filter((a) => a.success).length;
        const newSuccessRate = recalculateSuccessRate(
          existing.successRate,
          existing.frequency,
          successCount / sequence.length,
        );

        const updated: SkillPattern = {
          ...existing,
          frequency: existing.frequency + 1,
          successRate: newSuccessRate,
          lastSeen: new Date().toISOString(),
        };
        this.patterns.set(patternKey, updated);

        // Update candidate if exists
        const candidateEntry = findCandidateByPatternKey(this.candidates, patternKey);
        if (candidateEntry) {
          const [candidateId, candidate] = candidateEntry;
          this.candidates.set(candidateId, {
            ...candidate,
            pattern: updated,
            updatedAt: new Date().toISOString(),
          });
          candidatesUpdated++;
        }
      } else {
        // New pattern discovered
        const domain = inferDomain(sequence);
        const trigger = inferTrigger(sequence);

        const pattern: SkillPattern = {
          id: randomUUID(),
          trigger,
          actions: sequence.map((a) => ({
            type: a.type,
            tool: a.tool,
            description: a.input?.slice(0, 100) ?? a.type,
          })),
          successRate: sequence.filter((a) => a.success).length / sequence.length,
          frequency: 1,
          domain,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };

        this.patterns.set(patternKey, pattern);
      }
    }

    // Promote qualifying patterns to candidates
    for (const pattern of this.patterns.values()) {
      if (
        pattern.frequency >= MIN_PATTERN_FREQUENCY
        && pattern.successRate >= MIN_PATTERN_SUCCESS_RATE
      ) {
        const existingCandidate = findCandidateByPatternKey(
          this.candidates,
          buildPatternKey(pattern.actions.map((a) => ({
            type: a.type,
            tool: a.tool,
            success: true,
            timestamp: 0,
          }))),
        );

        if (!existingCandidate) {
          const candidate = createCandidate(pattern);
          this.candidates.set(candidate.id, candidate);
          candidatesCreated++;
        }
      }
    }

    return {
      patternsFound: this.patterns.size,
      candidatesCreated,
      candidatesUpdated,
      candidatesPromotable: this.getPromotableCandidates().length,
    };
  }

  /**
   * Generate a SKILL.md definition for a detected pattern.
   */
  generateSkillDefinition(pattern: SkillPattern): SkillDefinition {
    const name = generateSkillName(pattern);
    const description = generateSkillDescription(pattern);
    const category = pattern.domain || "custom";

    const actionSteps = pattern.actions
      .map((a, i) => `${i + 1}. ${a.description}${a.tool ? ` (uses \`${a.tool}\`)` : ""}`)
      .join("\n");

    const content = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      `category: ${category}`,
      "context: fork",
      `paths: []`,
      "---",
      "",
      `# ${name}`,
      "",
      description,
      "",
      "## Trigger",
      "",
      `This skill activates when: ${pattern.trigger}`,
      "",
      "## Steps",
      "",
      actionSteps,
      "",
      "## Metadata",
      "",
      `- Frequency: ${pattern.frequency} occurrences`,
      `- Success rate: ${(pattern.successRate * 100).toFixed(0)}%`,
      `- Domain: ${pattern.domain}`,
      `- First seen: ${pattern.firstSeen}`,
      `- Last seen: ${pattern.lastSeen}`,
      "",
    ].join("\n");

    return { name, description, category, trigger: pattern.trigger, content };
  }

  /**
   * Promote a candidate skill to installed status.
   * Increments version on re-promotion and persists to MemoryStore.
   */
  promoteCandidateToSkill(id: string): SkillDefinition | null {
    const candidate = this.candidates.get(id);
    if (!candidate) return null;
    if (candidate.status === "promoted" || candidate.status === "rejected") return null;

    const definition = this.generateSkillDefinition(candidate.pattern);

    // Version tracking: increment if this pattern has been promoted before
    const currentVersion = this.versionMap.get(definition.name) ?? 0;
    const nextVersion = currentVersion + 1;
    this.versionMap.set(definition.name, nextVersion);

    this.candidates.set(id, {
      ...candidate,
      status: "promoted",
      generatedContent: definition.content,
      updatedAt: new Date().toISOString(),
    });

    this.persist();
    this.writeSkillFile(definition);
    this.persistToMemoryStore(definition, nextVersion);

    return definition;
  }

  /**
   * List auto-detected skill candidates with confidence scores.
   */
  candidateSkills(): readonly SkillCandidate[] {
    return [...this.candidates.values()]
      .filter((c) => c.status !== "rejected")
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Record success or failure for a candidate skill.
   * Adjusts confidence accordingly for self-improvement.
   */
  recordOutcome(id: string, success: boolean, reason?: string): void {
    const candidate = this.candidates.get(id);
    if (!candidate) return;

    const updatedConfidence = success
      ? Math.min(1.0, candidate.confidence + CONFIDENCE_BOOST_ON_SUCCESS)
      : Math.max(0, candidate.confidence - CONFIDENCE_PENALTY_ON_FAILURE);

    const failureReasons = success
      ? candidate.failureReasons
      : [...candidate.failureReasons, reason ?? "unspecified"];

    const newStatus = updatedConfidence <= REJECTION_CONFIDENCE_THRESHOLD
      ? "rejected" as const
      : candidate.status;

    this.candidates.set(id, {
      ...candidate,
      confidence: updatedConfidence,
      successCount: candidate.successCount + (success ? 1 : 0),
      failureCount: candidate.failureCount + (success ? 0 : 1),
      failureReasons,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    });
    this.persist();
  }

  /**
   * Get candidates that have reached promotion threshold.
   */
  getPromotableCandidates(): readonly SkillCandidate[] {
    return [...this.candidates.values()].filter(
      (c) =>
        c.status === "candidate"
        && c.confidence >= PROMOTION_CONFIDENCE_THRESHOLD,
    );
  }

  /**
   * Extract a skill template from a completed task (Multica pattern).
   * Lower bar than instinct promotion -- any task that completes with
   * verification passing generates a draft skill. Requires at least
   * 2 steps to be worth extracting.
   */
  extractFromCompletedTask(task: {
    readonly title: string;
    readonly steps: readonly string[];
    readonly filesModified: readonly string[];
    readonly verificationPassed: boolean;
  }): void {
    if (!task.verificationPassed || task.steps.length < 2) return;

    const skillName = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

    const skillContent = [
      "---",
      `name: ${task.title}`,
      `description: Auto-generated from completed task`,
      `confidence: 0.5`,
      `source: task-completion`,
      "---",
      "",
      "## Steps",
      ...task.steps.map((s, i) => `${i + 1}. ${s}`),
      "",
      "## Files Involved",
      ...task.filesModified.map((f) => `- ${f}`),
    ].join("\n");

    this.saveDraftSkill(skillName, skillContent);
  }

  /**
   * Save a draft skill file to the skills directory with a "draft-" prefix.
   * Draft skills are not promoted -- they are candidates for manual review
   * or future automatic promotion once confidence rises.
   */
  private saveDraftSkill(name: string, content: string): void {
    if (!this.skillsDir) return;
    try {
      mkdirSync(this.skillsDir, { recursive: true });
      const fileName = `draft-${name}.md`;
      const filePath = join(this.skillsDir, fileName);
      writeFileSync(filePath, content);
    } catch {
      // Best-effort -- do not crash if disk write fails
    }

    // Also persist to MemoryStore if available
    if (this.memoryStore) {
      try {
        this.memoryStore.captureEvent(
          "draft_skill_created",
          JSON.stringify({ name, source: "task-completion" }),
          "learning",
        );
      } catch {
        // Best-effort
      }
    }
  }

  /**
   * Get all detected patterns.
   */
  getPatterns(): readonly SkillPattern[] {
    return [...this.patterns.values()];
  }

  /**
   * Get total pattern count.
   */
  getPatternCount(): number {
    return this.patterns.size;
  }

  /**
   * Get total candidate count.
   */
  getCandidateCount(): number {
    return this.candidates.size;
  }

  /**
   * Write patterns and candidates to disk as JSON.
   * Also persists to MemoryStore if attached.
   * No-op if no persistPath was configured.
   */
  persist(): void {
    if (!this.persistPath) return;
    try {
      const dir = this.persistPath.replace(/[/\\][^/\\]+$/, "");
      mkdirSync(dir, { recursive: true });
      const state: PersistedState = {
        patterns: [...this.patterns.values()],
        candidates: [...this.candidates.values()],
      };
      writeFileSync(this.persistPath, JSON.stringify(state, null, 2));
    } catch {
      // Best-effort — do not crash if disk write fails
    }

    // Persist pattern summary to MemoryStore
    this.persistPatternsToMemoryStore();
  }

  /**
   * Persist patterns summary to MemoryStore with layer="skill".
   */
  private persistPatternsToMemoryStore(): void {
    if (!this.memoryStore) return;
    try {
      const summary = [...this.patterns.values()]
        .filter((p) => p.frequency >= 2)
        .map((p) => `${p.trigger} (${p.frequency}x, ${(p.successRate * 100).toFixed(0)}% success)`)
        .join("; ");
      if (summary.length > 0) {
        this.memoryStore.captureEvent(
          "skill_patterns",
          summary.slice(0, 2000),
          "learning",
        );
      }
    } catch {
      // Best-effort
    }
  }

  /**
   * Persist a promoted skill definition to MemoryStore with version tracking.
   */
  private persistToMemoryStore(definition: SkillDefinition, version: number): void {
    if (!this.memoryStore) return;
    try {
      this.memoryStore.captureEvent(
        "skill_promoted",
        JSON.stringify({
          name: definition.name,
          category: definition.category,
          version,
          trigger: definition.trigger,
        }),
        "learning",
      );
    } catch {
      // Best-effort
    }
  }

  /**
   * Load patterns and candidates from a JSON file on disk.
   */
  private restoreFromDisk(path: string): void {
    if (!existsSync(path)) return;
    try {
      const raw = readFileSync(path, "utf-8");
      const state = JSON.parse(raw) as PersistedState;
      if (state.patterns && Array.isArray(state.patterns)) {
        for (const pattern of state.patterns) {
          const key = buildPatternKey(pattern.actions.map((a: { type: string; tool: string }) => ({
            type: a.type,
            tool: a.tool,
          })));
          this.patterns.set(key, pattern);
        }
      }
      if (state.candidates && Array.isArray(state.candidates)) {
        for (const candidate of state.candidates) {
          this.candidates.set(candidate.id, candidate);
        }
      }
    } catch {
      // Ignore corrupt data
    }
  }

  /**
   * Write a promoted skill's SKILL.md file to the skills directory.
   * No-op if no skillsDir was configured.
   */
  private writeSkillFile(definition: SkillDefinition): void {
    if (!this.skillsDir) return;
    try {
      mkdirSync(this.skillsDir, { recursive: true });
      const fileName = `${definition.name}.md`;
      const filePath = join(this.skillsDir, fileName);
      writeFileSync(filePath, definition.content);
    } catch {
      // Best-effort — do not crash if disk write fails
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

function extractActionSequences(
  actions: readonly SessionAction[],
): readonly (readonly SessionAction[])[] {
  const sequences: SessionAction[][] = [];
  let current: SessionAction[] = [];

  for (const action of actions) {
    current.push(action);

    if (current.length >= MAX_SEQUENCE_LENGTH) {
      if (current.length >= MIN_SEQUENCE_LENGTH) {
        sequences.push([...current]);
      }
      current = current.slice(1);
    }
  }

  // Capture remaining sequence
  if (current.length >= MIN_SEQUENCE_LENGTH) {
    sequences.push(current);
  }

  return sequences;
}

function buildPatternKey(actions: readonly Pick<SessionAction, "type" | "tool">[]): string {
  return actions.map((a) => `${a.type}:${a.tool ?? "none"}`).join("|");
}

function recalculateSuccessRate(
  currentRate: number,
  currentCount: number,
  newRate: number,
): number {
  // Weighted average: existing observations weighted more heavily
  const totalWeight = currentCount + 1;
  return (currentRate * currentCount + newRate) / totalWeight;
}

function inferDomain(actions: readonly SessionAction[]): string {
  const domains = actions
    .map((a) => a.domain)
    .filter((d): d is string => d !== undefined);

  if (domains.length === 0) return "general";

  // Most frequent domain
  const counts = new Map<string, number>();
  for (const domain of domains) {
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  let best = "general";
  let bestCount = 0;
  for (const [domain, count] of counts) {
    if (count > bestCount) {
      best = domain;
      bestCount = count;
    }
  }

  return best;
}

function inferTrigger(actions: readonly SessionAction[]): string {
  const firstAction = actions[0];
  if (!firstAction) return "unknown trigger";

  const parts: string[] = [];
  if (firstAction.type) parts.push(firstAction.type);
  if (firstAction.tool) parts.push(`using ${firstAction.tool}`);

  return parts.join(" ") || "unknown trigger";
}

function createCandidate(pattern: SkillPattern): SkillCandidate {
  const baseConfidence = pattern.successRate * 0.8;

  return {
    id: randomUUID(),
    pattern,
    confidence: baseConfidence,
    status: "candidate",
    failureReasons: [],
    successCount: 0,
    failureCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function generateSkillName(pattern: SkillPattern): string {
  const tools = pattern.actions
    .map((a) => a.tool)
    .filter((t): t is string => t !== undefined);

  const uniqueTools = [...new Set(tools)];
  const toolPart = uniqueTools.length > 0 ? uniqueTools.join("-") : "auto";

  return `${pattern.domain}-${toolPart}-workflow`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function generateSkillDescription(pattern: SkillPattern): string {
  const actionCount = pattern.actions.length;
  const tools = pattern.actions
    .map((a) => a.tool)
    .filter((t): t is string => t !== undefined);

  const uniqueTools = [...new Set(tools)];
  const toolPart = uniqueTools.length > 0 ? ` using ${uniqueTools.join(", ")}` : "";

  return `Auto-generated ${pattern.domain} workflow with ${actionCount} steps${toolPart} (${(pattern.successRate * 100).toFixed(0)}% success rate)`;
}

function findCandidateByPatternKey(
  candidates: Map<string, SkillCandidate>,
  patternKey: string,
): [string, SkillCandidate] | undefined {
  for (const [id, candidate] of candidates) {
    const candidateKey = buildPatternKey(
      candidate.pattern.actions.map((a) => ({
        type: a.type,
        tool: a.tool,
      })),
    );
    if (candidateKey === patternKey) return [id, candidate];
  }
  return undefined;
}
