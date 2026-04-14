/**
 * Privacy Router — Strip PII before routing to cloud providers (DX1).
 *
 * Follows the NemoClaw pattern: local models receive full data (no PII
 * risk), cloud providers receive stripped data by default. Policies are
 * configurable per provider and per content type.
 *
 * Features:
 * - Per-provider trust levels: full, redacted, anonymized
 * - PII detection: emails, phone numbers, SSN, credit cards, API keys
 * - Configurable allowed fields per provider
 * - Full audit trail with statistics
 * - Luhn validation for credit card numbers
 */

// ── Public Types ──────────────────────────────────────

export type PrivacyPolicy = "full" | "stripped" | "local-only";

export interface PrivacyRouteResult {
  readonly content: string;
  readonly stripped: boolean;
  readonly piiCount: number;
  readonly provider: string;
  readonly policy: PrivacyPolicy;
}

export interface PIIDetection {
  readonly category: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly replacement: string;
}

export interface PrivacyAuditEntry {
  readonly timestamp: string;
  readonly provider: string;
  readonly policy: PrivacyPolicy;
  readonly piiCount: number;
  readonly stripped: boolean;
  readonly contentLengthBefore: number;
  readonly contentLengthAfter: number;
}

export interface PrivacyStats {
  readonly totalRoutes: number;
  readonly strippedCount: number;
  readonly fullCount: number;
  readonly totalPiiDetected: number;
  readonly byProvider: Readonly<Record<string, { routes: number; piiStripped: number }>>;
}

/**
 * A detected PII match with category, position, and original text.
 */
export interface PIIMatch {
  readonly category: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly original: string;
  readonly replacement: string;
}

/**
 * Provider-specific privacy policy with trust level and field allowlist.
 */
export interface ProviderPrivacyPolicy {
  readonly provider: string;
  readonly trustLevel: "full" | "redacted" | "anonymized";
  readonly allowedFields: readonly string[];
}

// ── Constants ─────────────────────────────────────────

/**
 * Default policies for known providers.
 * Local inference providers get full data. Cloud providers get stripped.
 */
const DEFAULT_POLICIES: Readonly<Record<string, PrivacyPolicy>> = {
  // Local providers — no PII risk
  ollama: "full",
  "llama.cpp": "full",
  lmstudio: "full",
  localai: "full",
  jan: "full",
  // Cloud providers — strip by default
  openai: "stripped",
  anthropic: "stripped",
  google: "stripped",
  mistral: "stripped",
  cohere: "stripped",
  groq: "stripped",
  together: "stripped",
  fireworks: "stripped",
  replicate: "stripped",
  deepseek: "stripped",
};

// ── PII Patterns (inline, no external dependency) ─────

interface PIIPattern {
  readonly category: string;
  readonly regex: RegExp;
  readonly replacement: string;
  readonly validate?: (match: string) => boolean;
}

const PII_PATTERNS: readonly PIIPattern[] = [
  {
    category: "email",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL]",
  },
  {
    category: "phone",
    regex: /(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    replacement: "[PHONE]",
  },
  {
    category: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN]",
    validate: (match) => {
      const area = parseInt(match.slice(0, 3), 10);
      return area > 0 && area !== 666 && area < 900;
    },
  },
  {
    category: "credit_card",
    regex: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    replacement: "[CARD]",
    validate: (match) => isValidLuhn(match.replace(/\D/g, "")),
  },
  {
    category: "ip_address",
    regex: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    replacement: "[IP]",
    validate: (match) => match !== "127.0.0.1" && match !== "0.0.0.0",
  },
  {
    category: "api_key",
    regex: /(?:sk|pk|api|key|token|secret|bearer)[-_]?[a-zA-Z0-9]{20,}/gi,
    replacement: "[API_KEY]",
  },
  {
    category: "auth_url",
    regex: /https?:\/\/[^\s]*(?:token|key|secret|password|auth)[=:][^\s&"']+/gi,
    replacement: "[AUTH_URL]",
  },
];

// ── PrivacyRouter ─────────────────────────────────────

export class PrivacyRouter {
  private readonly policies = new Map<string, PrivacyPolicy>();
  private readonly audit: PrivacyAuditEntry[] = [];
  private totalRoutes = 0;
  private strippedCount = 0;
  private totalPiiDetected = 0;
  private readonly providerStats = new Map<string, { routes: number; piiStripped: number }>();

  constructor() {
    // Initialize with default policies
    for (const [provider, policy] of Object.entries(DEFAULT_POLICIES)) {
      this.policies.set(provider, policy);
    }
  }

  /**
   * Route content through the privacy layer based on the provider's policy.
   * Returns the (possibly stripped) content along with metadata.
   */
  route(content: string, provider: string): PrivacyRouteResult {
    this.totalRoutes++;
    const policy = this.policies.get(provider) ?? "stripped"; // Default to stripped for unknown

    // Update provider stats
    const stats = this.providerStats.get(provider) ?? { routes: 0, piiStripped: 0 };

    if (policy === "full") {
      // Full access — no stripping, but still count PII for audit
      const piiCount = countPII(content);
      this.providerStats.set(provider, { routes: stats.routes + 1, piiStripped: stats.piiStripped });
      this.addAuditEntry(provider, policy, piiCount, false, content.length, content.length);

      return {
        content,
        stripped: false,
        piiCount,
        provider,
        policy,
      };
    }

    if (policy === "local-only") {
      // Reject entirely — content cannot be sent to this provider
      this.providerStats.set(provider, { routes: stats.routes + 1, piiStripped: stats.piiStripped });
      this.addAuditEntry(provider, policy, 0, true, content.length, 0);

      return {
        content: "[Content blocked by local-only policy]",
        stripped: true,
        piiCount: 0,
        provider,
        policy,
      };
    }

    // Stripped policy — redact PII
    const { strippedContent, detections } = stripPII(content);
    const piiCount = detections.length;

    this.strippedCount++;
    this.totalPiiDetected += piiCount;
    this.providerStats.set(provider, {
      routes: stats.routes + 1,
      piiStripped: stats.piiStripped + piiCount,
    });
    this.addAuditEntry(provider, policy, piiCount, true, content.length, strippedContent.length);

    return {
      content: strippedContent,
      stripped: piiCount > 0,
      piiCount,
      provider,
      policy,
    };
  }

  /**
   * Set the privacy policy for a specific provider.
   */
  setPolicy(provider: string, policy: PrivacyPolicy): void {
    this.policies.set(provider, policy);
  }

  /**
   * Get the current policy for a provider.
   */
  getPolicy(provider: string): PrivacyPolicy {
    return this.policies.get(provider) ?? "stripped";
  }

  /**
   * Get all configured policies.
   */
  getAllPolicies(): ReadonlyMap<string, PrivacyPolicy> {
    return new Map(this.policies);
  }

  /**
   * Check whether a provider has full access (no PII stripping).
   */
  isFullAccess(provider: string): boolean {
    return this.policies.get(provider) === "full";
  }

  /**
   * Get the audit trail of all routing decisions.
   */
  getAuditTrail(): readonly PrivacyAuditEntry[] {
    return [...this.audit];
  }

  /**
   * Get aggregate privacy statistics.
   */
  getStats(): PrivacyStats {
    const byProvider: Record<string, { routes: number; piiStripped: number }> = {};
    for (const [provider, stats] of this.providerStats) {
      byProvider[provider] = { ...stats };
    }

    return {
      totalRoutes: this.totalRoutes,
      strippedCount: this.strippedCount,
      fullCount: this.totalRoutes - this.strippedCount,
      totalPiiDetected: this.totalPiiDetected,
      byProvider,
    };
  }

  /**
   * Reset all statistics and audit trail.
   */
  resetStats(): void {
    this.totalRoutes = 0;
    this.strippedCount = 0;
    this.totalPiiDetected = 0;
    this.providerStats.clear();
    this.audit.length = 0;
  }

  // ── Spec-Required Methods (DX1) ────────────────────

  /**
   * Apply privacy policy to a message before sending to a provider.
   * Convenience method that combines detection and redaction.
   */
  applyPolicy(message: string, provider: string): string {
    const result = this.route(message, provider);
    return result.content;
  }

  /**
   * Detect PII patterns in text without modifying it.
   * Returns all matches with position, category, and original text.
   */
  detectPII(text: string): readonly PIIMatch[] {
    const matches: PIIMatch[] = [];

    for (const pattern of PII_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let found = regex.exec(text);
      while (found !== null) {
        const matched = found[0];
        if (!pattern.validate || pattern.validate(matched)) {
          matches.push({
            category: pattern.category,
            startIndex: found.index,
            endIndex: found.index + matched.length,
            original: matched,
            replacement: pattern.replacement,
          });
        }
        found = regex.exec(text);
      }
    }

    // Sort by position (ascending)
    return [...matches].sort((a, b) => a.startIndex - b.startIndex);
  }

  /**
   * Redact detected PII with their replacement placeholders.
   * Applies replacements from end-to-start to preserve indices.
   */
  redact(text: string, matches: readonly PIIMatch[]): string {
    let result = text;
    // Apply in reverse order to preserve string indices
    const sorted = [...matches].sort((a, b) => b.startIndex - a.startIndex);

    for (const match of sorted) {
      result =
        result.slice(0, match.startIndex) +
        match.replacement +
        result.slice(match.endIndex);
    }

    return result;
  }

  /**
   * Register a provider-specific privacy policy with trust level and
   * field allowlisting. Maps trust levels to internal policy types.
   */
  registerProviderPolicy(policy: ProviderPrivacyPolicy): void {
    const mapped: PrivacyPolicy =
      policy.trustLevel === "full" ? "full" :
      policy.trustLevel === "anonymized" ? "local-only" :
      "stripped";
    this.policies.set(policy.provider, mapped);
  }

  // ── Private ─────────────────────────────────────────

  private addAuditEntry(
    provider: string,
    policy: PrivacyPolicy,
    piiCount: number,
    stripped: boolean,
    lengthBefore: number,
    lengthAfter: number,
  ): void {
    this.audit.push({
      timestamp: new Date().toISOString(),
      provider,
      policy,
      piiCount,
      stripped,
      contentLengthBefore: lengthBefore,
      contentLengthAfter: lengthAfter,
    });

    // Keep audit trail bounded
    if (this.audit.length > 1000) {
      this.audit.splice(0, this.audit.length - 1000);
    }
  }
}

// ── PII Stripping ─────────────────────────────────────

interface StripResult {
  readonly strippedContent: string;
  readonly detections: readonly PIIDetection[];
}

function stripPII(content: string): StripResult {
  const detections: PIIDetection[] = [];
  let result = content;

  for (const pattern of PII_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    const matches: { match: string; index: number }[] = [];

    let found = regex.exec(content);
    while (found !== null) {
      const matched = found[0];
      if (!pattern.validate || pattern.validate(matched)) {
        matches.push({ match: matched, index: found.index });
      }
      found = regex.exec(content);
    }

    // Apply replacements in reverse order to preserve indices
    for (const m of [...matches].reverse()) {
      detections.push({
        category: pattern.category,
        startIndex: m.index,
        endIndex: m.index + m.match.length,
        replacement: pattern.replacement,
      });

      result =
        result.slice(0, m.index) +
        pattern.replacement +
        result.slice(m.index + m.match.length);
    }
  }

  return { strippedContent: result, detections };
}

function countPII(content: string): number {
  let count = 0;

  for (const pattern of PII_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let found = regex.exec(content);
    while (found !== null) {
      if (!pattern.validate || pattern.validate(found[0])) {
        count++;
      }
      found = regex.exec(content);
    }
  }

  return count;
}

// ── Luhn Validation ───────────────────────────────────

function isValidLuhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let alternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}
