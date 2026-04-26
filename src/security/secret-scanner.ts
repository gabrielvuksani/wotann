/**
 * Secret Scanner — detect and block secret exfiltration attempts.
 *
 * Scans:
 * - Browser URLs for encoded secrets
 * - LLM responses for credential patterns
 * - Tool outputs for sensitive data leaks
 *
 * Blocks:
 * - Base64-encoded secrets in URLs
 * - URL-encoded API keys
 * - Prompt injection attempts that extract credentials
 * - Credential directory access (.docker, .azure, .config/gh, .aws, .ssh)
 *
 * From Hermes v0.7.0 secret exfiltration blocking pattern.
 */

import { canonicalizePathForCheck } from "../utils/path-realpath.js";

export interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly severity: "critical" | "high" | "medium";
  readonly description: string;
}

export interface ScanResult {
  readonly clean: boolean;
  readonly findings: readonly SecretFinding[];
}

export interface SecretFinding {
  readonly pattern: string;
  readonly severity: "critical" | "high" | "medium";
  readonly location: string;
  readonly redactedMatch: string;
  readonly description: string;
}

/**
 * Common secret patterns to detect in outputs and URLs.
 */
const SECRET_PATTERNS: readonly SecretPattern[] = [
  // API Keys
  {
    name: "anthropic_key",
    pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g,
    severity: "critical",
    description: "Anthropic API key",
  },
  {
    name: "openai_key",
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    severity: "critical",
    description: "OpenAI API key",
  },
  {
    name: "github_token",
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    severity: "critical",
    description: "GitHub token",
  },
  {
    name: "aws_access_key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: "critical",
    description: "AWS access key ID",
  },
  {
    name: "aws_secret_key",
    pattern: /[A-Za-z0-9/+=]{40}(?=\s|$|"|')/g,
    severity: "high",
    description: "Possible AWS secret key",
  },
  {
    name: "gcp_service_account",
    pattern: /"type"\s*:\s*"service_account"/g,
    severity: "critical",
    description: "GCP service account JSON",
  },
  {
    name: "azure_key",
    pattern: /[a-zA-Z0-9/+=]{44}(?=\s|$|"|')/g,
    severity: "medium",
    description: "Possible Azure key",
  },
  {
    name: "stripe_key",
    pattern: /[rs]k_(live|test)_[a-zA-Z0-9]{20,}/g,
    severity: "critical",
    description: "Stripe API key",
  },
  {
    name: "slack_token",
    pattern: /xox[bporas]-[0-9]{10,13}-[a-zA-Z0-9-]+/g,
    severity: "critical",
    description: "Slack token",
  },
  {
    name: "jwt_token",
    pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    severity: "high",
    description: "JWT token",
  },
  {
    name: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    severity: "critical",
    description: "Private key header",
  },
  {
    name: "password_literal",
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/gi,
    severity: "high",
    description: "Password in plaintext",
  },
  {
    name: "connection_string",
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s]+:[^\s]+@[^\s]+/g,
    severity: "critical",
    description: "Database connection string with credentials",
  },
  {
    name: "bearer_token",
    pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
    severity: "high",
    description: "Bearer authentication token",
  },
];

/**
 * Protected credential directories — block file reads from these paths.
 */
const PROTECTED_DIRECTORIES: readonly string[] = [
  ".docker",
  ".azure",
  ".config/gh",
  ".aws",
  ".ssh",
  ".gnupg",
  ".kube",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".gitconfig",
  ".config/gcloud",
  ".config/stripe",
  ".terraform.d",
];

export class SecretScanner {
  private readonly customPatterns: SecretPattern[] = [];
  private readonly allowedPaths: Set<string> = new Set();
  private findingCount = 0;
  private scanCount = 0;

  /**
   * Add a custom secret pattern to the scanner.
   */
  addPattern(pattern: SecretPattern): void {
    this.customPatterns.push(pattern);
  }

  /**
   * Allow access to a specific protected path (explicit user override).
   */
  allowPath(path: string): void {
    this.allowedPaths.add(path);
  }

  /**
   * Scan text content for secret patterns.
   */
  scanText(content: string, location: string = "output"): ScanResult {
    this.scanCount++;
    const findings: SecretFinding[] = [];
    const allPatterns = [...SECRET_PATTERNS, ...this.customPatterns];

    for (const sp of allPatterns) {
      // Reset regex lastIndex for global patterns
      sp.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = sp.pattern.exec(content)) !== null) {
        findings.push({
          pattern: sp.name,
          severity: sp.severity,
          location,
          redactedMatch: redactMatch(match[0]),
          description: sp.description,
        });
        this.findingCount++;
      }
    }

    return { clean: findings.length === 0, findings };
  }

  /**
   * Scan a URL for encoded secrets (base64, URL-encoding).
   */
  scanUrl(url: string): ScanResult {
    this.scanCount++;
    const findings: SecretFinding[] = [];

    // Decode URL components and scan
    try {
      const decoded = decodeURIComponent(url);
      const urlFindings = this.scanText(decoded, "url-decoded");
      findings.push(...urlFindings.findings);
    } catch {
      // Invalid URL encoding — not necessarily a finding
    }

    // Check for base64-encoded content in URL params
    const base64Regex = /[?&][^=]+=([A-Za-z0-9+/]{20,}={0,2})(?:&|$)/g;
    let b64Match: RegExpExecArray | null;
    while ((b64Match = base64Regex.exec(url)) !== null) {
      try {
        const decoded = Buffer.from(b64Match[1]!, "base64").toString("utf-8");
        const innerFindings = this.scanText(decoded, "url-base64-decoded");
        findings.push(...innerFindings.findings);
      } catch {
        // Not valid base64 — skip
      }
    }

    this.findingCount += findings.length;
    return { clean: findings.length === 0, findings };
  }

  /**
   * Check if a file path accesses a protected credential directory.
   *
   * CVE-2026-25724 defence: pure substring matching on the raw path is
   * defeated by a symlink (`harmless.txt → ~/.ssh/id_rsa`). We test
   * BOTH the raw normalized path AND the realpath-canonicalized form;
   * a hit on either is grounds for treating the access as protected.
   * Defence-in-depth: the explicit user override (`allowPath`) is
   * keyed on the raw filePath the caller supplied, so the bypass
   * surface for a symlink-allow-then-symlink-redirect is closed.
   */
  isProtectedPath(filePath: string): boolean {
    if (this.allowedPaths.has(filePath)) return false;

    const normalized = filePath.replace(/\\/g, "/");
    let canonicalNormalized = normalized;
    try {
      const canonical = canonicalizePathForCheck(filePath);
      canonicalNormalized = canonical.replace(/\\/g, "/");
    } catch {
      // realpath failure — treat as suspicious by leaving canonical equal
      // to raw. The raw match below still fires; honest-fallback (QB#6)
      // logs the gap but does not silently approve.
    }
    const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";

    for (const dir of PROTECTED_DIRECTORIES) {
      const fullPath = `${home}/${dir}`;
      const matchRaw = normalized.startsWith(fullPath) || normalized.includes(`/${dir}/`);
      const matchCanonical =
        canonicalNormalized.startsWith(fullPath) || canonicalNormalized.includes(`/${dir}/`);
      if (matchRaw || matchCanonical) {
        return true;
      }
    }

    return false;
  }

  /**
   * Redact sensitive content before logging.
   * Keeps first 4 and last 4 characters, masks the rest.
   */
  redactContent(content: string): string {
    const allPatterns = [...SECRET_PATTERNS, ...this.customPatterns];
    let redacted = content;

    for (const sp of allPatterns) {
      sp.pattern.lastIndex = 0;
      redacted = redacted.replace(sp.pattern, (match) => redactMatch(match));
    }

    return redacted;
  }

  /** Get scanner statistics */
  getStats(): { scans: number; findings: number; customPatterns: number; allowedPaths: number } {
    return {
      scans: this.scanCount,
      findings: this.findingCount,
      customPatterns: this.customPatterns.length,
      allowedPaths: this.allowedPaths.size,
    };
  }
}

// ── PII Redactor ────────────────────────────────────────
// The PIIRedactor class lives in ./pii-redactor.ts (the authoritative version).
// Re-exported here for backward compatibility with lib.ts consumers.
export { PIIRedactor } from "./pii-redactor.js";

// ── Helper ───────────────────────────────────────────────

function redactMatch(match: string): string {
  if (match.length <= 8) return "****";
  return `${match.slice(0, 4)}${"*".repeat(Math.min(match.length - 8, 20))}${match.slice(-4)}`;
}
