/**
 * Skills Guard -- static analysis security scanner for skill content.
 *
 * Scans skill definitions (SKILL.md, tool schemas, inline scripts) for
 * dangerous patterns before installation from the marketplace.
 *
 * Detection categories:
 * - Exfiltration: curl, wget, fetch sending data to external URLs
 * - Code injection: eval(), dynamic Function(), command invocation
 * - Destructive: rm -rf, DROP TABLE, TRUNCATE, file deletion
 * - Privilege escalation: sudo, chmod 777, system file modification
 * - Data access: reading env vars, credentials, secrets
 *
 * NOTE: This file contains regex patterns that DETECT dangerous code.
 * The patterns themselves are string matchers, not executable code.
 * Inspired by Hermes Agent's skill vetting pipeline.
 */

// ── Types ────────────────────────────────────────────────

export type IssueSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface SecurityIssue {
  readonly pattern: string;
  readonly line: number;
  readonly severity: IssueSeverity;
  readonly description: string;
  readonly recommendation: string;
}

export interface SkillScanResult {
  readonly safe: boolean;
  readonly issues: readonly SecurityIssue[];
  readonly severity: IssueSeverity;
  readonly recommendations: readonly string[];
}

// ── Pattern Definitions ──────────────────────────────────

interface DetectionPattern {
  readonly regex: RegExp;
  readonly severity: IssueSeverity;
  readonly category: string;
  readonly description: string;
  readonly recommendation: string;
}

// Patterns that detect data exfiltration attempts
const EXFILTRATION_PATTERNS: readonly DetectionPattern[] = [
  {
    regex: /\bcurl\b.*(?:--data|--upload|-d\s|-F\s|-T\s)/i,
    severity: "critical",
    category: "exfiltration",
    description: "curl command sending data to external endpoint",
    recommendation: "Remove outbound data transfer or restrict to known-safe endpoints",
  },
  {
    regex: /\bwget\b.*(?:--post-data|--post-file)/i,
    severity: "critical",
    category: "exfiltration",
    description: "wget POST request sending data externally",
    recommendation: "Remove outbound data transfer commands",
  },
  {
    regex: /\bfetch\s*\(.*(?:method\s*:\s*['"]POST|body\s*:)/i,
    severity: "high",
    category: "exfiltration",
    description: "fetch() call with POST body may exfiltrate data",
    recommendation: "Audit the fetch target URL and payload contents",
  },
  {
    regex: /\bcurl\b.*https?:\/\/(?!localhost|127\.0\.0\.1)/i,
    severity: "medium",
    category: "exfiltration",
    description: "curl to external URL detected",
    recommendation: "Verify the target URL is trusted and necessary",
  },
  {
    regex: /\bwget\b.*https?:\/\/(?!localhost|127\.0\.0\.1)/i,
    severity: "medium",
    category: "exfiltration",
    description: "wget to external URL detected",
    recommendation: "Verify the target URL is trusted and necessary",
  },
  {
    regex: /XMLHttpRequest|\.send\s*\(/i,
    severity: "medium",
    category: "exfiltration",
    description: "XMLHttpRequest or .send() call may transmit data",
    recommendation: "Audit network call targets and payloads",
  },
];

// Patterns that detect code injection vectors
// NOTE: These regexes MATCH dangerous code -- they are not dangerous themselves
const CODE_INJECTION_PATTERNS: readonly DetectionPattern[] = [
  {
    // Detects: eval(...)
    regex: /\beval\s*\(/,
    severity: "critical",
    category: "code-injection",
    description: "eval() can run arbitrary code",
    recommendation: "Replace with a safe parser or structured data handling",
  },
  {
    // Detects: new Function(...)
    regex: /new\s+Function\s*\(/,
    severity: "critical",
    category: "code-injection",
    description: "Dynamic Function constructor creates runnable code from strings",
    recommendation: "Use structured logic instead of dynamic code generation",
  },
  {
    // Detects: child_process usage, execFile, spawn
    regex: /child_process|\.execFile\s*\(|\.spawn\s*\(/,
    severity: "high",
    category: "code-injection",
    description: "Shell command invocation detected",
    recommendation: "Use allowlisted commands only; never pass user input to shell",
  },
  {
    // Detects: $(...) shell substitution
    regex: /\$\(.*\)/,
    severity: "medium",
    category: "code-injection",
    description: "Shell substitution may enable injection",
    recommendation: "Ensure no user-controlled input flows into shell commands",
  },
  {
    // Detects: setTimeout("string code")
    regex: /\bsetTimeout\s*\(\s*['"`]/,
    severity: "medium",
    category: "code-injection",
    description: "setTimeout with string argument acts like eval",
    recommendation: "Pass a function reference instead of a string to setTimeout",
  },
  {
    // Detects: setInterval("string code")
    regex: /\bsetInterval\s*\(\s*['"`]/,
    severity: "medium",
    category: "code-injection",
    description: "setInterval with string argument acts like eval",
    recommendation: "Pass a function reference instead of a string to setInterval",
  },
];

// Patterns that detect destructive operations
const DESTRUCTIVE_PATTERNS: readonly DetectionPattern[] = [
  {
    regex: /\brm\s+-rf?\s/,
    severity: "critical",
    category: "destructive",
    description: "Recursive file deletion command detected",
    recommendation: "Remove destructive commands or restrict to safe directories",
  },
  {
    regex: /\bDROP\s+TABLE\b/i,
    severity: "critical",
    category: "destructive",
    description: "SQL DROP TABLE will permanently delete data",
    recommendation: "Remove destructive SQL commands",
  },
  {
    regex: /\bTRUNCATE\b/i,
    severity: "high",
    category: "destructive",
    description: "SQL TRUNCATE will remove all rows from a table",
    recommendation: "Remove or restrict TRUNCATE operations",
  },
  {
    regex: /\bunlink\s*\(|\.rmSync\s*\(|\.unlinkSync\s*\(/,
    severity: "high",
    category: "destructive",
    description: "File deletion API call detected",
    recommendation: "Ensure file deletion is scoped to safe directories only",
  },
  {
    regex: /\bformat\s+[a-zA-Z]:/i,
    severity: "critical",
    category: "destructive",
    description: "Disk format command detected",
    recommendation: "Remove disk formatting commands entirely",
  },
];

// Patterns that detect privilege escalation attempts
const PRIVILEGE_ESCALATION_PATTERNS: readonly DetectionPattern[] = [
  {
    regex: /\bsudo\b/,
    severity: "critical",
    category: "privilege-escalation",
    description: "sudo command requests elevated privileges",
    recommendation: "Skills should never require root access",
  },
  {
    regex: /\bchmod\s+777\b/,
    severity: "high",
    category: "privilege-escalation",
    description: "chmod 777 makes files world-writable",
    recommendation: "Use minimal permissions (e.g., 644 for files, 755 for dirs)",
  },
  {
    regex: /\/etc\/passwd|\/etc\/shadow|\/etc\/sudoers/,
    severity: "critical",
    category: "privilege-escalation",
    description: "Access to system authentication files detected",
    recommendation: "Skills must not access system credential files",
  },
  {
    regex: /\bchown\b.*root/i,
    severity: "high",
    category: "privilege-escalation",
    description: "Changing file ownership to root detected",
    recommendation: "Skills should not change system file ownership",
  },
];

// Patterns that detect sensitive data access
const DATA_ACCESS_PATTERNS: readonly DetectionPattern[] = [
  {
    regex: /process\.env\[|process\.env\./,
    severity: "medium",
    category: "data-access",
    description: "Reading environment variables may expose secrets",
    recommendation: "Document which env vars are accessed and why",
  },
  {
    regex: /\.env\b|credentials|\.pem\b|\.key\b|private.key/i,
    severity: "high",
    category: "data-access",
    description: "Reference to credential or key files detected",
    recommendation: "Skills should never read credential files directly",
  },
  {
    regex: /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\b/i,
    severity: "medium",
    category: "data-access",
    description: "Reference to secret/key variable names detected",
    recommendation: "Ensure secrets are not logged or transmitted",
  },
  {
    regex: /readFileSync\s*\(.*(?:\.env|config|secret|credential)/i,
    severity: "high",
    category: "data-access",
    description: "Reading sensitive configuration files",
    recommendation: "Use a proper secret manager instead of file reads",
  },
];

const ALL_PATTERNS: readonly DetectionPattern[] = [
  ...EXFILTRATION_PATTERNS,
  ...CODE_INJECTION_PATTERNS,
  ...DESTRUCTIVE_PATTERNS,
  ...PRIVILEGE_ESCALATION_PATTERNS,
  ...DATA_ACCESS_PATTERNS,
];

// ── Severity Ordering ────────────────────────────────────

const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function worstSeverity(issues: readonly SecurityIssue[]): IssueSeverity {
  if (issues.length === 0) return "info";
  let worst: IssueSeverity = "info";
  for (const issue of issues) {
    if (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[worst]) {
      worst = issue.severity;
    }
  }
  return worst;
}

// ── SkillsGuard Class ────────────────────────────────────

export class SkillsGuard {
  private readonly customPatterns: DetectionPattern[] = [];

  /**
   * Scan skill content for security issues.
   * Returns a result indicating whether the skill is safe to install.
   */
  scanSkill(content: string): SkillScanResult {
    const lines = content.split("\n");
    const issues: SecurityIssue[] = [];
    const patterns = [...ALL_PATTERNS, ...this.customPatterns];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex] ?? "";
      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          issues.push({
            pattern: pattern.category,
            line: lineIndex + 1,
            severity: pattern.severity,
            description: pattern.description,
            recommendation: pattern.recommendation,
          });
        }
      }
    }

    const deduplicated = deduplicateIssues(issues);
    const severity = worstSeverity(deduplicated);
    const safe = severity !== "critical" && severity !== "high";
    const recommendations = buildRecommendations(deduplicated);

    return { safe, issues: deduplicated, severity, recommendations };
  }

  /**
   * Quick check: returns true if content has no critical or high issues.
   */
  isSafe(content: string): boolean {
    return this.scanSkill(content).safe;
  }

  /**
   * Register a custom detection pattern for project-specific rules.
   */
  addPattern(pattern: DetectionPattern): void {
    this.customPatterns.push(pattern);
  }

  /**
   * Get the number of built-in detection patterns.
   */
  getPatternCount(): number {
    return ALL_PATTERNS.length + this.customPatterns.length;
  }

  /**
   * Scan multiple skill contents and return aggregated results.
   */
  scanBatch(
    skills: readonly { readonly name: string; readonly content: string }[],
  ): readonly { readonly name: string; readonly result: SkillScanResult }[] {
    return skills.map((skill) => ({
      name: skill.name,
      result: this.scanSkill(skill.content),
    }));
  }

  /**
   * Generate a human-readable security report from a scan result.
   */
  formatReport(result: SkillScanResult): string {
    const lines: string[] = [
      `Security Scan: ${result.safe ? "PASSED" : "FAILED"}`,
      `Overall severity: ${result.severity}`,
      `Issues found: ${result.issues.length}`,
      "",
    ];

    if (result.issues.length > 0) {
      lines.push("Issues:");
      for (const issue of result.issues) {
        lines.push(`  [${issue.severity.toUpperCase()}] Line ${issue.line}: ${issue.description}`);
        lines.push(`    Pattern: ${issue.pattern}`);
        lines.push(`    Fix: ${issue.recommendation}`);
        lines.push("");
      }
    }

    if (result.recommendations.length > 0) {
      lines.push("Recommendations:");
      for (const rec of result.recommendations) {
        lines.push(`  - ${rec}`);
      }
    }

    return lines.join("\n");
  }
}

// ── Helper Functions ─────────────────────────────────────

function deduplicateIssues(issues: readonly SecurityIssue[]): readonly SecurityIssue[] {
  const seen = new Set<string>();
  const result: SecurityIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.pattern}:${issue.line}:${issue.description}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }
  return result;
}

function buildRecommendations(issues: readonly SecurityIssue[]): readonly string[] {
  const recommendations = new Set<string>();

  const hasCritical = issues.some((i) => i.severity === "critical");
  const hasExfiltration = issues.some((i) => i.pattern === "exfiltration");
  const hasInjection = issues.some((i) => i.pattern === "code-injection");
  const hasDestructive = issues.some((i) => i.pattern === "destructive");
  const hasPrivEsc = issues.some((i) => i.pattern === "privilege-escalation");

  if (hasCritical) {
    recommendations.add("DO NOT install this skill without manual security review");
  }
  if (hasExfiltration) {
    recommendations.add("Audit all network calls and ensure no sensitive data is transmitted");
  }
  if (hasInjection) {
    recommendations.add("Replace dynamic code running with static alternatives");
  }
  if (hasDestructive) {
    recommendations.add("Remove or sandbox all destructive commands");
  }
  if (hasPrivEsc) {
    recommendations.add("Skills must operate without elevated system privileges");
  }
  if (issues.length === 0) {
    recommendations.add("No issues detected. Skill appears safe for installation.");
  }

  return [...recommendations];
}
