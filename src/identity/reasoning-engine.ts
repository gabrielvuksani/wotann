/**
 * Reasoning Engine — formal logical inference over user observations.
 *
 * Three reasoning modes inspired by Honcho's user modeling:
 *
 * 1. Deductive: Derive conclusions from explicitly stated premises.
 *    "User said they prefer TypeScript" + "User said strict mode" →
 *    "User wants TypeScript strict mode"
 *
 * 2. Inductive: Identify patterns across multiple sessions.
 *    "User corrected X three times" → "User prefers Y pattern"
 *
 * 3. Abductive: Infer simplest explanations for observed behaviors.
 *    "User always writes tests first" → "User follows TDD"
 *
 * Conclusions are typed and stored in MemoryStore with layer="reasoning".
 */

import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../memory/store.js";

// ── Types ────────────────────────────────────────────────

export interface Premise {
  readonly id: string;
  readonly statement: string;
  readonly source: "explicit" | "inferred" | "observed";
  readonly confidence: number;
  readonly sessionId?: string;
  readonly extractedAt: number;
}

export interface Observation {
  readonly id: string;
  readonly pattern: string;
  readonly occurrences: number;
  readonly contexts: readonly string[];
  readonly firstSeen: number;
  readonly lastSeen: number;
}

export interface Behavior {
  readonly id: string;
  readonly action: string;
  readonly frequency: number;
  readonly consistency: number;
  readonly contexts: readonly string[];
}

export type ReasoningMode = "deductive" | "inductive" | "abductive";

export interface Conclusion {
  readonly id: string;
  readonly statement: string;
  readonly mode: ReasoningMode;
  readonly confidence: number;
  readonly supportingEvidence: readonly string[];
  readonly createdAt: number;
}

// ── Premise Extraction Patterns ──────────────────────────

const EXPLICIT_PATTERNS: readonly RegExp[] = [
  /I (?:always |usually |prefer to |like to |want to )(.+)/i,
  /(?:please |always |never )(.+)/i,
  /my (?:preferred|favorite|default) (?:approach|method|style|pattern) is (.+)/i,
  /I (?:use|work with|rely on) (.+)/i,
  /(?:don't|do not|never) (.+)/i,
  /I'm (?:a|an) (.+?)(?:\.|,|$)/i,
  /I (?:know|understand|specialize in) (.+)/i,
];

const PREFERENCE_PATTERNS: readonly RegExp[] = [
  /(?:prefer|like|enjoy|love) (.+?) (?:over|instead of|rather than) (.+)/i,
  /(?:hate|dislike|avoid) (.+)/i,
  /(?:should|must|need to) (.+)/i,
];

// ── Reasoning Engine ─────────────────────────────────────

export class ReasoningEngine {
  private readonly premises: Premise[] = [];
  private readonly observations: Observation[] = [];
  private readonly conclusions: Conclusion[] = [];
  private readonly memoryStore: MemoryStore | null;

  constructor(memoryStore?: MemoryStore) {
    this.memoryStore = memoryStore ?? null;
  }

  /**
   * Extract explicit premises from a list of user messages.
   */
  extractPremises(messages: readonly string[]): readonly Premise[] {
    const extracted: Premise[] = [];

    for (const message of messages) {
      for (const pattern of EXPLICIT_PATTERNS) {
        const match = pattern.exec(message);
        if (match?.[1]) {
          const premise: Premise = {
            id: randomUUID(),
            statement: match[1].trim().slice(0, 300),
            source: "explicit",
            confidence: 0.9,
            extractedAt: Date.now(),
          };
          extracted.push(premise);
        }
      }

      for (const pattern of PREFERENCE_PATTERNS) {
        const match = pattern.exec(message);
        if (match?.[1]) {
          const premise: Premise = {
            id: randomUUID(),
            statement: `prefers: ${match[1].trim().slice(0, 200)}`,
            source: "explicit",
            confidence: 0.85,
            extractedAt: Date.now(),
          };
          extracted.push(premise);
        }
      }
    }

    // Deduplicate by normalized statement
    const seen = new Set<string>();
    const unique = extracted.filter((p) => {
      const key = p.statement.toLowerCase().slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.premises.push(...unique);
    return unique;
  }

  /**
   * Deductive reasoning: derive conclusions from stated premises.
   * Combines related premises to produce derived facts.
   */
  deductiveReason(premises: readonly Premise[]): readonly Conclusion[] {
    const conclusions: Conclusion[] = [];

    // Group premises by domain keywords
    const groups = this.groupByDomain(premises);

    for (const [_domain, domainPremises] of groups) {
      if (domainPremises.length < 2) continue;

      // Combine related premises
      const combined = domainPremises.map((p) => p.statement).join("; ");
      const avgConfidence = domainPremises.reduce((s, p) => s + p.confidence, 0) / domainPremises.length;

      const conclusion: Conclusion = {
        id: randomUUID(),
        statement: `Derived from ${domainPremises.length} premises: ${combined}`,
        mode: "deductive",
        confidence: Math.min(avgConfidence, 0.95),
        supportingEvidence: domainPremises.map((p) => p.id),
        createdAt: Date.now(),
      };
      conclusions.push(conclusion);
    }

    this.conclusions.push(...conclusions);
    this.persistConclusions(conclusions);
    return conclusions;
  }

  /**
   * Inductive reasoning: identify patterns across multiple sessions.
   * Recurring observations with high frequency get promoted to conclusions.
   */
  inductiveReason(observations: readonly Observation[]): readonly Conclusion[] {
    const conclusions: Conclusion[] = [];

    for (const obs of observations) {
      if (obs.occurrences < 3) continue;

      const timespanDays = (obs.lastSeen - obs.firstSeen) / (24 * 60 * 60 * 1000);
      const isConsistent = timespanDays >= 1 && obs.occurrences >= 3;

      if (!isConsistent) continue;

      const confidence = Math.min(0.9, 0.5 + obs.occurrences * 0.05);

      const conclusion: Conclusion = {
        id: randomUUID(),
        statement: `Pattern observed ${obs.occurrences} times: ${obs.pattern}`,
        mode: "inductive",
        confidence,
        supportingEvidence: [obs.id],
        createdAt: Date.now(),
      };
      conclusions.push(conclusion);
    }

    this.observations.push(...observations);
    this.conclusions.push(...conclusions);
    this.persistConclusions(conclusions);
    return conclusions;
  }

  /**
   * Abductive reasoning: infer simplest explanations for behaviors.
   * High-frequency, high-consistency behaviors suggest underlying preferences.
   */
  abductiveReason(behaviors: readonly Behavior[]): readonly Conclusion[] {
    const conclusions: Conclusion[] = [];

    for (const behavior of behaviors) {
      if (behavior.frequency < 2 || behavior.consistency < 0.5) continue;

      const explanation = this.inferExplanation(behavior);
      const confidence = Math.min(0.85, behavior.consistency * 0.8 + behavior.frequency * 0.02);

      const conclusion: Conclusion = {
        id: randomUUID(),
        statement: explanation,
        mode: "abductive",
        confidence,
        supportingEvidence: [behavior.id],
        createdAt: Date.now(),
      };
      conclusions.push(conclusion);
    }

    this.conclusions.push(...conclusions);
    this.persistConclusions(conclusions);
    return conclusions;
  }

  /**
   * Get all accumulated conclusions.
   */
  getConclusions(): readonly Conclusion[] {
    return [...this.conclusions];
  }

  /**
   * Get all extracted premises.
   */
  getPremises(): readonly Premise[] {
    return [...this.premises];
  }

  // ── Private Helpers ────────────────────────────────────

  private groupByDomain(premises: readonly Premise[]): Map<string, readonly Premise[]> {
    const domainKeywords: Record<string, readonly string[]> = {
      coding: ["code", "typescript", "javascript", "python", "function", "class", "variable"],
      testing: ["test", "tdd", "coverage", "spec", "assert", "mock"],
      style: ["style", "format", "indent", "naming", "convention", "prefer"],
      workflow: ["commit", "branch", "deploy", "review", "pr", "pipeline"],
      communication: ["concise", "detailed", "verbose", "brief", "explain"],
    };

    const groups = new Map<string, Premise[]>();

    for (const premise of premises) {
      const lowerStatement = premise.statement.toLowerCase();
      let matched = false;

      for (const [domain, keywords] of Object.entries(domainKeywords)) {
        if (keywords.some((kw) => lowerStatement.includes(kw))) {
          const existing = groups.get(domain) ?? [];
          groups.set(domain, [...existing, premise]);
          matched = true;
          break;
        }
      }

      if (!matched) {
        const existing = groups.get("general") ?? [];
        groups.set("general", [...existing, premise]);
      }
    }

    return groups;
  }

  private inferExplanation(behavior: Behavior): string {
    const action = behavior.action.toLowerCase();

    if (action.includes("test") && action.includes("first")) {
      return `User likely follows TDD (writes tests before implementation, consistency: ${behavior.consistency.toFixed(2)})`;
    }
    if (action.includes("immutable") || action.includes("spread") || action.includes("readonly")) {
      return `User prefers immutable data patterns (observed ${behavior.frequency} times)`;
    }
    if (action.includes("small file") || action.includes("extract")) {
      return `User prefers many small files over few large ones (observed ${behavior.frequency} times)`;
    }
    if (action.includes("research") || action.includes("search first")) {
      return `User follows research-before-coding workflow (consistency: ${behavior.consistency.toFixed(2)})`;
    }

    return `User habitually ${behavior.action} (${behavior.frequency} times, consistency: ${behavior.consistency.toFixed(2)})`;
  }

  private persistConclusions(conclusions: readonly Conclusion[]): void {
    if (!this.memoryStore || conclusions.length === 0) return;

    try {
      for (const conclusion of conclusions) {
        this.memoryStore.insert({
          id: conclusion.id,
          layer: "core_blocks",
          blockType: "patterns",
          key: `reasoning/${conclusion.mode}`,
          value: conclusion.statement,
          verified: conclusion.confidence > 0.8,
          confidence: conclusion.confidence,
          freshnessScore: 1.0,
          confidenceLevel: conclusion.confidence,
          verificationStatus: conclusion.confidence > 0.8 ? "verified" : "unverified",
          tags: `reasoning,${conclusion.mode}`,
        });
      }
    } catch {
      // Best-effort persistence
    }
  }
}
