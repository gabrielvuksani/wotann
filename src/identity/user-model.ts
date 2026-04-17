/**
 * User Model -- persistent user profiling for prompt personalization.
 *
 * Tracks:
 * - Corrections: pattern + correction + count + lastSeen
 * - Preferences: key + value + confidence
 * - Expertise: domain + level (beginner/intermediate/expert)
 *
 * Methods: recordCorrection(), recordPreference(), getProfile()
 * Persists to .wotann/context-tree/user/profile.json
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomicSyncBestEffort } from "../utils/atomic-io.js";

// ── Types ────────────────────────────────────────────────

export interface CorrectionRecord {
  readonly pattern: string;
  readonly correction: string;
  readonly count: number;
  readonly lastSeen: number;
}

export interface PreferenceRecord {
  readonly key: string;
  readonly value: string;
  readonly confidence: number;
}

export interface ExpertiseRecord {
  readonly domain: string;
  readonly level: "beginner" | "intermediate" | "expert";
}

export interface PeerCard {
  readonly name?: string;
  readonly role?: string;
  readonly expertise: readonly string[];
  readonly preferences: readonly string[];
  readonly communicationStyle: string;
  readonly updatedAt: Date;
}

export type ObservationMode = "observeMe" | "observeOthers";

export interface UserProfile {
  readonly corrections: readonly CorrectionRecord[];
  readonly preferences: readonly PreferenceRecord[];
  readonly expertise: readonly ExpertiseRecord[];
  readonly communicationStyle: string;
  readonly lastUpdated: number;
  readonly peerCard?: PeerCard;
  readonly observationMode: ObservationMode;
}

// ── Constants ────────────────────────────────────────────

const MAX_CORRECTIONS = 100;
const MAX_PREFERENCES = 50;
const MAX_EXPERTISE = 30;

const DEFAULT_PROFILE: UserProfile = {
  corrections: [],
  preferences: [],
  expertise: [],
  communicationStyle: "concise",
  lastUpdated: Date.now(),
  observationMode: "observeMe",
};

// Token budget allocation percentages
const BUDGET_PEER_CARD = 0.10;
const BUDGET_CORRECTIONS = 0.20;
const BUDGET_PREFERENCES = 0.30;
const BUDGET_SESSION_SUMMARY = 0.40;

// ── User Model ────────────────────────────────────────────

export class UserModel {
  private profile: UserProfile;
  private readonly persistPath: string;

  constructor(wotannDir: string) {
    this.persistPath = join(wotannDir, "context-tree", "user", "profile.json");
    this.profile = this.loadFromDisk();
  }

  /**
   * Record a user correction: "I said X, you should have done Y."
   * Increments count if the same pattern was corrected before.
   */
  recordCorrection(pattern: string, correction: string): void {
    const normalizedPattern = pattern.toLowerCase().trim().slice(0, 200);
    const normalizedCorrection = correction.trim().slice(0, 300);

    const existing = this.profile.corrections.findIndex(
      (c) => c.pattern === normalizedPattern,
    );

    let updatedCorrections: CorrectionRecord[];
    if (existing >= 0) {
      const prev = this.profile.corrections[existing]!;
      updatedCorrections = this.profile.corrections.map((c, i) =>
        i === existing
          ? { ...c, correction: normalizedCorrection, count: prev.count + 1, lastSeen: Date.now() }
          : c,
      );
    } else {
      updatedCorrections = [
        ...this.profile.corrections,
        {
          pattern: normalizedPattern,
          correction: normalizedCorrection,
          count: 1,
          lastSeen: Date.now(),
        },
      ];
    }

    // Cap at max and keep most recent
    if (updatedCorrections.length > MAX_CORRECTIONS) {
      updatedCorrections = [...updatedCorrections]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, MAX_CORRECTIONS);
    }

    this.profile = {
      ...this.profile,
      corrections: updatedCorrections,
      lastUpdated: Date.now(),
    };
    this.persist();
  }

  /**
   * Record or update a user preference.
   * Existing preference with the same key is replaced if confidence is higher.
   */
  recordPreference(key: string, value: string, confidence: number = 0.8): void {
    const normalizedKey = key.toLowerCase().trim();
    const clampedConfidence = Math.max(0, Math.min(1, confidence));

    const existing = this.profile.preferences.findIndex(
      (p) => p.key === normalizedKey,
    );

    let updatedPreferences: PreferenceRecord[];
    if (existing >= 0) {
      const prev = this.profile.preferences[existing]!;
      // Only update if new confidence is higher or equal
      if (clampedConfidence >= prev.confidence) {
        updatedPreferences = this.profile.preferences.map((p, i) =>
          i === existing
            ? { key: normalizedKey, value, confidence: clampedConfidence }
            : p,
        );
      } else {
        return; // Lower confidence -- do not override
      }
    } else {
      updatedPreferences = [
        ...this.profile.preferences,
        { key: normalizedKey, value, confidence: clampedConfidence },
      ];
    }

    if (updatedPreferences.length > MAX_PREFERENCES) {
      updatedPreferences = [...updatedPreferences]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_PREFERENCES);
    }

    this.profile = {
      ...this.profile,
      preferences: updatedPreferences,
      lastUpdated: Date.now(),
    };
    this.persist();
  }

  /**
   * Record or update a user expertise observation.
   */
  recordExpertise(domain: string, level: ExpertiseRecord["level"]): void {
    const normalizedDomain = domain.toLowerCase().trim();
    const existing = this.profile.expertise.findIndex(
      (e) => e.domain === normalizedDomain,
    );

    let updatedExpertise: ExpertiseRecord[];
    if (existing >= 0) {
      updatedExpertise = this.profile.expertise.map((e, i) =>
        i === existing ? { domain: normalizedDomain, level } : e,
      );
    } else {
      updatedExpertise = [
        ...this.profile.expertise,
        { domain: normalizedDomain, level },
      ];
    }

    if (updatedExpertise.length > MAX_EXPERTISE) {
      updatedExpertise = updatedExpertise.slice(-MAX_EXPERTISE);
    }

    this.profile = {
      ...this.profile,
      expertise: updatedExpertise,
      lastUpdated: Date.now(),
    };
    this.persist();
  }

  /**
   * Record the user's preferred communication style.
   * Examples: "concise", "detailed", "technical", "casual".
   */
  recordCommunicationStyle(style: string): void {
    const normalizedStyle = style.trim().slice(0, 50);
    if (normalizedStyle.length === 0) return;

    this.profile = {
      ...this.profile,
      communicationStyle: normalizedStyle,
      lastUpdated: Date.now(),
    };
    this.persist();
  }

  /**
   * Get the current user profile.
   */
  getProfile(): UserProfile {
    return this.profile;
  }

  /**
   * Build a system prompt section from the user profile.
   * Returns a compact text representation (~100-200 tokens).
   */
  getPromptContext(): string {
    const parts: string[] = [];

    // Frequent corrections (top 5 by count)
    const topCorrections = [...this.profile.corrections]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    if (topCorrections.length > 0) {
      parts.push("User corrections: " +
        topCorrections.map((c) => `"${c.correction}" (${c.count}x)`).join("; "));
    }

    // High-confidence preferences
    const topPrefs = [...this.profile.preferences]
      .filter((p) => p.confidence >= 0.6)
      .slice(0, 8);
    if (topPrefs.length > 0) {
      parts.push("Preferences: " +
        topPrefs.map((p) => `${p.key}=${p.value}`).join(", "));
    }

    // Expertise areas
    if (this.profile.expertise.length > 0) {
      parts.push("Expertise: " +
        this.profile.expertise.map((e) => `${e.domain} (${e.level})`).join(", "));
    }

    // Communication style
    if (this.profile.communicationStyle && this.profile.communicationStyle !== "concise") {
      parts.push(`Communication style: ${this.profile.communicationStyle}`);
    }

    return parts.join("\n");
  }

  /**
   * Build or update the PeerCard from the current profile state.
   */
  buildPeerCard(): PeerCard {
    const card: PeerCard = {
      name: this.extractNameFromPreferences(),
      role: this.extractRoleFromExpertise(),
      expertise: this.profile.expertise.map((e) => `${e.domain} (${e.level})`),
      preferences: this.profile.preferences
        .filter((p) => p.confidence >= 0.6)
        .map((p) => `${p.key}: ${p.value}`),
      communicationStyle: this.profile.communicationStyle,
      updatedAt: new Date(),
    };

    this.profile = {
      ...this.profile,
      peerCard: card,
      lastUpdated: Date.now(),
    };
    this.persist();
    return card;
  }

  /**
   * Get the current PeerCard, building one if it does not exist.
   */
  getPeerCard(): PeerCard {
    return this.profile.peerCard ?? this.buildPeerCard();
  }

  /**
   * Set the observation mode for the user model.
   * - observeMe: build from ALL sessions (default)
   * - observeOthers: build from shared sessions only
   */
  setObservationMode(mode: ObservationMode): void {
    this.profile = {
      ...this.profile,
      observationMode: mode,
      lastUpdated: Date.now(),
    };
    this.persist();
  }

  /**
   * Get the current observation mode.
   */
  getObservationMode(): ObservationMode {
    return this.profile.observationMode;
  }

  /**
   * Token-budgeted context assembly.
   * Allocates the given token budget across 4 sections:
   * - PeerCard: 10%
   * - Corrections: 20%
   * - Preferences: 30%
   * - Session summary: 40%
   */
  assembleUserContext(tokenBudget: number, sessionSummary?: string): string {
    const sections: string[] = [];

    // PeerCard section (10% of budget)
    const peerCardBudget = Math.floor(tokenBudget * BUDGET_PEER_CARD);
    const card = this.getPeerCard();
    const cardText = this.renderPeerCard(card);
    if (cardText.length > 0) {
      sections.push(truncateToTokenBudget(cardText, peerCardBudget));
    }

    // Corrections section (20% of budget)
    const correctionBudget = Math.floor(tokenBudget * BUDGET_CORRECTIONS);
    const topCorrections = [...this.profile.corrections]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    if (topCorrections.length > 0) {
      const corrText = "Corrections: " +
        topCorrections.map((c) => `"${c.correction}" (${c.count}x)`).join("; ");
      sections.push(truncateToTokenBudget(corrText, correctionBudget));
    }

    // Preferences section (30% of budget)
    const prefBudget = Math.floor(tokenBudget * BUDGET_PREFERENCES);
    const topPrefs = [...this.profile.preferences]
      .filter((p) => p.confidence >= 0.5)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 15);
    if (topPrefs.length > 0) {
      const prefText = "Preferences: " +
        topPrefs.map((p) => `${p.key}=${p.value}`).join(", ");
      sections.push(truncateToTokenBudget(prefText, prefBudget));
    }

    // Session summary section (40% of budget)
    const summaryBudget = Math.floor(tokenBudget * BUDGET_SESSION_SUMMARY);
    if (sessionSummary) {
      sections.push(truncateToTokenBudget(`Session: ${sessionSummary}`, summaryBudget));
    }

    return sections.join("\n");
  }

  // ── Private ────────────────────────────────────────────

  private renderPeerCard(card: PeerCard): string {
    const parts: string[] = [];
    if (card.name) parts.push(`Name: ${card.name}`);
    if (card.role) parts.push(`Role: ${card.role}`);
    if (card.expertise.length > 0) parts.push(`Expertise: ${card.expertise.join(", ")}`);
    if (card.communicationStyle) parts.push(`Style: ${card.communicationStyle}`);
    return parts.join(" | ");
  }

  private extractNameFromPreferences(): string | undefined {
    const nameEntry = this.profile.preferences.find(
      (p) => p.key === "name" || p.key === "user_name",
    );
    return nameEntry?.value;
  }

  private extractRoleFromExpertise(): string | undefined {
    const topExpertise = this.profile.expertise[0];
    if (!topExpertise) return undefined;
    return `${topExpertise.level} ${topExpertise.domain} developer`;
  }

  private persist(): void {
    try {
      // SECURITY (B6): atomic write + best-effort lock to prevent corrupted
      // profile.json if two daemon instances write concurrently. The lock TTL
      // is short (1s) since user-profile writes are quick; if the lock can't
      // be acquired we fall through to a best-effort write rather than hang.
      writeFileAtomicSyncBestEffort(
        this.persistPath,
        JSON.stringify(this.profile, null, 2),
        { encoding: "utf-8", mode: 0o600 },
      );
    } catch {
      // Best-effort -- do not crash on write failure
    }
  }

  private loadFromDisk(): UserProfile {
    if (!existsSync(this.persistPath)) return DEFAULT_PROFILE;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Validate shape minimally
      if (Array.isArray(parsed["corrections"]) && Array.isArray(parsed["preferences"])) {
        // Restore PeerCard if persisted (convert updatedAt string back to Date)
        let peerCard: PeerCard | undefined;
        if (parsed["peerCard"] && typeof parsed["peerCard"] === "object") {
          const rawCard = parsed["peerCard"] as Record<string, unknown>;
          peerCard = {
            name: typeof rawCard["name"] === "string" ? rawCard["name"] : undefined,
            role: typeof rawCard["role"] === "string" ? rawCard["role"] : undefined,
            expertise: Array.isArray(rawCard["expertise"])
              ? rawCard["expertise"] as readonly string[]
              : [],
            preferences: Array.isArray(rawCard["preferences"])
              ? rawCard["preferences"] as readonly string[]
              : [],
            communicationStyle: typeof rawCard["communicationStyle"] === "string"
              ? rawCard["communicationStyle"]
              : "concise",
            updatedAt: rawCard["updatedAt"]
              ? new Date(rawCard["updatedAt"] as string)
              : new Date(),
          };
        }

        return {
          corrections: parsed["corrections"] as readonly CorrectionRecord[],
          preferences: parsed["preferences"] as readonly PreferenceRecord[],
          expertise: Array.isArray(parsed["expertise"]) ? parsed["expertise"] as readonly ExpertiseRecord[] : [],
          communicationStyle: typeof parsed["communicationStyle"] === "string"
            ? parsed["communicationStyle"]
            : DEFAULT_PROFILE.communicationStyle,
          lastUpdated: typeof parsed["lastUpdated"] === "number" ? parsed["lastUpdated"] : Date.now(),
          peerCard,
          observationMode: parsed["observationMode"] === "observeOthers"
            ? "observeOthers"
            : "observeMe",
        };
      }
      return DEFAULT_PROFILE;
    } catch {
      return DEFAULT_PROFILE;
    }
  }
}

// ── Module-level Helpers ─────────────────────────────────

/**
 * Rough token estimate: ~4 chars per token.
 * Truncate text to fit within a character budget derived from token count.
 */
function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const charBudget = tokenBudget * 4;
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget - 3) + "...";
}
