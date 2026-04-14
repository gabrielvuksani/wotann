/**
 * User Model — backward-compatibility wrapper around the canonical
 * UserModel implementation in src/identity/user-model.ts.
 *
 * The canonical implementation lives in identity/ and persists to
 * `.wotann/context-tree/user/profile.json`. This wrapper preserves the
 * `UserModelManager` API surface expected by runtime.ts and the public
 * `lib.ts` export surface without duplicating storage or business logic.
 *
 * DO NOT add new functionality here — extend the UserModel class in
 * `src/identity/user-model.ts` instead.
 */

import { UserModel } from "../identity/user-model.js";
import type {
  CorrectionRecord,
  PreferenceRecord,
  ExpertiseRecord,
  UserProfile as CanonicalUserProfile,
} from "../identity/user-model.js";

// ── Legacy Types (kept for lib.ts export compatibility) ───

export interface UserProfile {
  readonly corrections: readonly Correction[];
  readonly preferences: readonly Preference[];
  readonly expertise: readonly ExpertiseArea[];
  readonly communicationStyle: CommunicationStyle;
  readonly lastUpdated: number;
}

export interface Correction {
  readonly original: string;
  readonly corrected: string;
  readonly context: string;
  readonly timestamp: number;
  readonly applied: boolean;
}

export interface Preference {
  readonly key: string;
  readonly value: string;
  readonly confidence: number;
  readonly source: "explicit" | "inferred";
  readonly timestamp: number;
}

export interface ExpertiseArea {
  readonly domain: string;
  readonly level: "beginner" | "intermediate" | "advanced" | "expert";
  readonly evidence: string;
  readonly timestamp: number;
}

export interface CommunicationStyle {
  readonly verbosity: "terse" | "balanced" | "detailed";
  readonly formality: "casual" | "professional" | "technical";
  readonly codeComments: boolean;
  readonly explanations: boolean;
}

// ── Manager (Compatibility Wrapper) ──────────────────────

/**
 * UserModelManager — thin adapter over UserModel.
 * Delegates storage and core behavior to the canonical UserModel.
 * Preserves the 3-arg correction / 3-arg expertise / setPreference API
 * used by runtime.ts and older call sites.
 */
export class UserModelManager {
  private readonly model: UserModel;

  constructor(wotannDir: string) {
    this.model = new UserModel(wotannDir);
  }

  /**
   * Record a user correction.
   * Adapts 3-arg (original, corrected, context) form onto the
   * canonical 2-arg (pattern, correction) form.
   */
  recordCorrection(original: string, corrected: string, _context: string): void {
    this.model.recordCorrection(original, corrected);
  }

  /**
   * Set an explicit preference (confidence = 1.0).
   */
  setPreference(key: string, value: string): void {
    this.model.recordPreference(key, value, 1.0);
  }

  /**
   * Record expertise. Evidence is accepted for API compatibility but
   * not persisted (the canonical model stores domain + level only).
   * Levels normalized: "advanced" → "expert".
   */
  recordExpertise(
    domain: string,
    level: ExpertiseArea["level"],
    _evidence: string,
  ): void {
    const normalized: "beginner" | "intermediate" | "expert" =
      level === "advanced" ? "expert" : level;
    this.model.recordExpertise(domain, normalized);
  }

  /**
   * Partial update of the communication style.
   * Canonical model stores a single string — we collapse the richest
   * available field (verbosity) when present.
   */
  setCommunicationStyle(style: Partial<CommunicationStyle>): void {
    const verbosity = style.verbosity;
    if (verbosity) {
      this.model.recordCommunicationStyle(verbosity);
    }
  }

  /**
   * Compact text representation for system-prompt injection.
   */
  getPromptContext(): string {
    return this.model.getPromptContext();
  }

  /**
   * Return the current profile in the legacy shape used by lib.ts
   * consumers. Empty arrays are provided for fields the canonical
   * model does not retain (timestamps / source / evidence).
   */
  getProfile(): UserProfile {
    const canonical: CanonicalUserProfile = this.model.getProfile();
    return {
      corrections: canonical.corrections.map(adaptCorrection),
      preferences: canonical.preferences.map(adaptPreference),
      expertise: canonical.expertise.map(adaptExpertise),
      communicationStyle: adaptCommunicationStyle(canonical.communicationStyle),
      lastUpdated: canonical.lastUpdated,
    };
  }

  /**
   * Escape hatch for callers that need the richer canonical model.
   */
  getCanonicalModel(): UserModel {
    return this.model;
  }
}

// ── Adapters ─────────────────────────────────────────────

function adaptCorrection(c: CorrectionRecord): Correction {
  return {
    original: c.pattern,
    corrected: c.correction,
    context: "",
    timestamp: c.lastSeen,
    applied: true,
  };
}

function adaptPreference(p: PreferenceRecord): Preference {
  return {
    key: p.key,
    value: p.value,
    confidence: p.confidence,
    source: "explicit",
    timestamp: Date.now(),
  };
}

function adaptExpertise(e: ExpertiseRecord): ExpertiseArea {
  return {
    domain: e.domain,
    level: e.level,
    evidence: "",
    timestamp: Date.now(),
  };
}

function adaptCommunicationStyle(style: string): CommunicationStyle {
  const verbosity: CommunicationStyle["verbosity"] =
    style === "terse" || style === "concise"
      ? "terse"
      : style === "detailed"
        ? "detailed"
        : "balanced";
  return {
    verbosity,
    formality: "technical",
    codeComments: false,
    explanations: true,
  };
}
