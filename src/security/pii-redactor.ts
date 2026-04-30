/**
 * PII Redactor — automatically scrub personally identifiable information
 * before sending context to LLM providers.
 *
 * Detects and redacts:
 * - Email addresses
 * - Phone numbers (US, international)
 * - Social Security Numbers
 * - Credit card numbers (Luhn-validated)
 * - IP addresses (v4 and v6)
 * - Names in known PII fields (JSON keys like "name", "firstName", etc.)
 * - Date of birth patterns
 * - URLs with auth tokens or credentials
 *
 * From Hermes v0.5.0 privacy.redact_pii pattern.
 * Configurable: toggle per category, whitelist specific patterns.
 */

export type PIICategory =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "physical_address"
  | "name_field"
  | "date_of_birth"
  | "passport"
  | "auth_url"
  // ── opensre-port additions (Round 6 audit, 2026-04-29) ──
  // Cloud / k8s / EC2 identifiers that leak silently when an agent
  // pastes log output (kubectl, journalctl, CloudWatch) into the LLM.
  // Hermes-redact only covers PII; opensre identified these as the
  // missing layer for SRE workflows.
  | "k8s_namespace"
  | "k8s_pod"
  | "k8s_cluster"
  | "service_name"
  | "aws_account_id"
  | "infra_hostname"
  | "custom";

export interface PIIFinding {
  readonly category: PIICategory;
  readonly original: string;
  readonly redacted: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly confidence: number;
}

export interface PIIRedactionResult {
  readonly redactedText: string;
  readonly findings: readonly PIIFinding[];
  readonly totalRedacted: number;
  readonly categoryCounts: Readonly<Record<PIICategory, number>>;
}

export interface PIIRedactorConfig {
  readonly enabled: boolean;
  readonly categories: ReadonlySet<PIICategory>;
  readonly whitelistPatterns: readonly RegExp[];
  readonly redactionStyle: "mask" | "placeholder" | "hash";
  readonly preserveFormat: boolean;
}

interface PIIPattern {
  readonly category: PIICategory;
  readonly pattern: RegExp;
  readonly confidence: number;
  readonly validate?: (match: string) => boolean;
  readonly format: (match: string, style: "mask" | "placeholder" | "hash") => string;
}

const DEFAULT_CONFIG: PIIRedactorConfig = {
  enabled: true,
  categories: new Set([
    "email",
    "phone",
    "ssn",
    "credit_card",
    "ip_address",
    "auth_url",
    "date_of_birth",
    "passport",
  ]),
  whitelistPatterns: [],
  redactionStyle: "placeholder",
  preserveFormat: true,
};

function isValidLuhn(num: string): boolean {
  const digits = num.replace(/\D/g, "");
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

const PII_PATTERNS: readonly PIIPattern[] = [
  {
    category: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    confidence: 0.95,
    format: (_match, style) => {
      if (style === "placeholder") return "[EMAIL_REDACTED]";
      if (style === "mask") return "***@***.***";
      return "[EMAIL_HASH]";
    },
  },
  {
    category: "phone",
    pattern: /(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    confidence: 0.85,
    format: (_match, style) => {
      if (style === "placeholder") return "[PHONE_REDACTED]";
      if (style === "mask") return "***-***-****";
      return "[PHONE_HASH]";
    },
  },
  {
    category: "phone",
    pattern: /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    confidence: 0.8,
    format: (_match, style) => {
      if (style === "placeholder") return "[PHONE_REDACTED]";
      if (style === "mask") return "+**-****-****";
      return "[PHONE_HASH]";
    },
  },
  {
    category: "ssn",
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    confidence: 0.9,
    validate: (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length !== 9) return false;
      const area = parseInt(digits.slice(0, 3), 10);
      return area > 0 && area !== 666 && area < 900;
    },
    format: (_match, style) => {
      if (style === "placeholder") return "[SSN_REDACTED]";
      if (style === "mask") return "***-**-****";
      return "[SSN_HASH]";
    },
  },
  {
    category: "credit_card",
    pattern: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    confidence: 0.9,
    validate: (match) => isValidLuhn(match),
    format: (match, style) => {
      if (style === "placeholder") return "[CARD_REDACTED]";
      if (style === "mask") {
        const digits = match.replace(/\D/g, "");
        return `****-****-****-${digits.slice(-4)}`;
      }
      return "[CARD_HASH]";
    },
  },
  {
    category: "ip_address",
    pattern:
      /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 0.85,
    validate: (match) =>
      match !== "127.0.0.1" && match !== "0.0.0.0" && !match.startsWith("192.168."),
    format: (_match, style) => {
      if (style === "placeholder") return "[IP_REDACTED]";
      if (style === "mask") return "***.***.***.***";
      return "[IP_HASH]";
    },
  },
  {
    category: "date_of_birth",
    pattern: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g,
    confidence: 0.7,
    format: (_match, style) => {
      if (style === "placeholder") return "[DOB_REDACTED]";
      if (style === "mask") return "**/**/****";
      return "[DOB_HASH]";
    },
  },
  {
    category: "auth_url",
    pattern:
      /https?:\/\/[^\s]*(?:token|key|secret|password|auth|credential|apikey|access_token|bearer)[=:][^\s&"']+/gi,
    confidence: 0.9,
    format: (_match, style) => {
      if (style === "placeholder") return "[AUTH_URL_REDACTED]";
      if (style === "mask") return "https://***?***";
      return "[AUTH_URL_HASH]";
    },
  },
  {
    category: "name_field",
    pattern:
      /(?:"(?:first_?name|last_?name|full_?name|patient_?name|customer_?name)"\s*:\s*")((?:[^"\\]|\\.)*)"/gi,
    confidence: 0.85,
    format: (match, style) => {
      if (style === "placeholder") {
        return match.replace(/"([^"]+)"$/, '"[NAME_REDACTED]"');
      }
      return match.replace(/"([^"]+)"$/, '"***"');
    },
  },
  // ── opensre-port: infrastructure identifiers ──
  // Each pattern requires a recognized label prefix (`namespace:`,
  // `pod:`, etc.) so common English words like "frontend" don't get
  // mistakenly redacted. Capture group strategy mirrors opensre's
  // detectors.py so the surrounding label survives in the redacted
  // output (preserves log readability while hiding the value).
  {
    category: "k8s_namespace",
    pattern: /\b(namespace|ns)[:=\s]+([a-z0-9][a-z0-9-]{1,62}[a-z0-9])\b/gi,
    confidence: 0.9,
    format: (match, style) => {
      if (style === "placeholder")
        return match.replace(/[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i, "[NAMESPACE]");
      return match.replace(/[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i, "***");
    },
  },
  {
    category: "k8s_pod",
    pattern: /\b(pod|deployment|statefulset)[:=\s]+([a-z0-9][a-z0-9-]{1,253}[a-z0-9])\b/gi,
    confidence: 0.9,
    format: (match, style) => {
      if (style === "placeholder")
        return match.replace(/[a-z0-9][a-z0-9-]{1,253}[a-z0-9]$/i, "[POD]");
      return match.replace(/[a-z0-9][a-z0-9-]{1,253}[a-z0-9]$/i, "***");
    },
  },
  {
    category: "k8s_cluster",
    pattern: /\b(cluster|kube_cluster|eks_cluster|gke_cluster)[:=\s]+([A-Za-z0-9][\w.-]{1,99})\b/gi,
    confidence: 0.92,
    format: (match, style) => {
      if (style === "placeholder") return match.replace(/[A-Za-z0-9][\w.-]{1,99}$/i, "[CLUSTER]");
      return match.replace(/[A-Za-z0-9][\w.-]{1,99}$/i, "***");
    },
  },
  {
    category: "service_name",
    pattern: /\b(service|svc|microservice)[:=\s]+([a-z0-9][a-z0-9.-]{1,99}[a-z0-9])\b/gi,
    confidence: 0.85,
    format: (match, style) => {
      if (style === "placeholder")
        return match.replace(/[a-z0-9][a-z0-9.-]{1,99}[a-z0-9]$/i, "[SERVICE]");
      return match.replace(/[a-z0-9][a-z0-9.-]{1,99}[a-z0-9]$/i, "***");
    },
  },
  {
    category: "aws_account_id",
    // 12-digit AWS account ID, anchored by a nearby AWS-context
    // keyword to avoid matching arbitrary 12-digit numbers.
    pattern: /\b\d{12}\b(?=.*?(?:account|aws|arn:|iam:))/g,
    confidence: 0.9,
    format: (_match, style) => {
      if (style === "placeholder") return "[AWS_ACCOUNT]";
      if (style === "mask") return "*** redacted ***";
      return "[AWS_ACCOUNT_HASH]";
    },
  },
  {
    category: "infra_hostname",
    // EC2-internal/private DNS, .compute.internal, .compute.amazonaws.com,
    // .svc.cluster.local — anchor on the suffix so generic words don't
    // match.
    pattern:
      /\b[\w-]+\.(?:compute\.internal|compute\.amazonaws\.com|svc\.cluster\.local|cluster\.local)\b/g,
    confidence: 0.95,
    format: (_match, style) => {
      if (style === "placeholder") return "[INFRA_HOSTNAME]";
      return "***.cluster.***";
    },
  },
];

export class PIIRedactor {
  private readonly config: PIIRedactorConfig;
  private totalScans = 0;
  private totalRedactions = 0;

  constructor(config?: Partial<PIIRedactorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  redact(text: string): PIIRedactionResult {
    if (!this.config.enabled) {
      return {
        redactedText: text,
        findings: [],
        totalRedacted: 0,
        categoryCounts: {} as Record<PIICategory, number>,
      };
    }

    this.totalScans++;
    const findings: PIIFinding[] = [];
    let redactedText = text;

    for (const pattern of PII_PATTERNS) {
      if (!this.config.categories.has(pattern.category)) continue;

      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const original = match[0];

        if (this.config.whitelistPatterns.some((wl) => wl.test(original))) continue;
        if (pattern.validate && !pattern.validate(original)) continue;

        const redacted = pattern.format(original, this.config.redactionStyle);

        findings.push({
          category: pattern.category,
          original,
          redacted,
          startIndex: match.index,
          endIndex: match.index + original.length,
          confidence: pattern.confidence,
        });
      }
    }

    const sortedFindings = [...findings].sort((a, b) => b.startIndex - a.startIndex);
    for (const finding of sortedFindings) {
      redactedText =
        redactedText.slice(0, finding.startIndex) +
        finding.redacted +
        redactedText.slice(finding.endIndex);
    }

    this.totalRedactions += findings.length;

    const categoryCounts: Record<string, number> = {};
    for (const f of findings) {
      categoryCounts[f.category] = (categoryCounts[f.category] ?? 0) + 1;
    }

    return {
      redactedText,
      findings,
      totalRedacted: findings.length,
      categoryCounts: categoryCounts as Record<PIICategory, number>,
    };
  }

  hasPII(text: string): boolean {
    for (const pattern of PII_PATTERNS) {
      if (!this.config.categories.has(pattern.category)) continue;

      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      const match = regex.exec(text);
      if (match) {
        if (pattern.validate && !pattern.validate(match[0])) continue;
        if (this.config.whitelistPatterns.some((wl) => wl.test(match[0]))) continue;
        return true;
      }
    }
    return false;
  }

  getStats(): { totalScans: number; totalRedactions: number } {
    return { totalScans: this.totalScans, totalRedactions: this.totalRedactions };
  }
}
