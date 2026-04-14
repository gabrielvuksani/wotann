/**
 * Response Validator — validate and score agent responses before presenting to user.
 *
 * Based on research from top TerminalBench performers:
 * - LangChain: PreCompletionChecklist catches incomplete/stub responses
 * - ForgeCode: Model-specific validation for tool-call argument errors
 * - SWE-bench Pro: Scaffolding-level validation (5% variance from harness alone)
 *
 * Checks:
 * 1. Completeness — did the response address the full task?
 * 2. Code syntax — are code blocks syntactically valid?
 * 3. Consistency — does the response contradict previous responses?
 * 4. Hallucination — does the response reference things not in context?
 * 5. Quality scoring — overall response quality on a 0-100 scale
 */

// ── Types ────────────────────────────────────────────────────

export interface ValidationResult {
  readonly valid: boolean;
  readonly score: number;
  readonly issues: readonly ValidationIssue[];
  readonly completeness: CompletenessCheck;
  readonly syntaxChecks: readonly SyntaxCheck[];
  readonly consistencyCheck: ConsistencyCheck;
  readonly hallucinationCheck: HallucinationCheck;
}

export interface ValidationIssue {
  readonly type: IssueType;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly suggestion?: string;
}

export type IssueType =
  | "incomplete"
  | "stub"
  | "syntax-error"
  | "inconsistency"
  | "hallucination"
  | "too-short"
  | "any-type"
  | "missing-error-handling"
  | "missing-import"
  | "todo-marker";

export interface CompletenessCheck {
  readonly isComplete: boolean;
  readonly missingAspects: readonly string[];
  readonly score: number; // 0-100
}

export interface SyntaxCheck {
  readonly codeBlock: string;
  readonly language: string;
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface ConsistencyCheck {
  readonly isConsistent: boolean;
  readonly contradictions: readonly string[];
}

export interface HallucinationCheck {
  readonly detected: boolean;
  readonly suspiciousReferences: readonly SuspiciousReference[];
}

export interface SuspiciousReference {
  readonly reference: string;
  readonly reason: string;
}

export interface ResponseScore {
  readonly overall: number; // 0-100
  readonly completeness: number;
  readonly correctness: number;
  readonly quality: number;
  readonly breakdown: Record<string, number>;
}

// ── ResponseValidator ──────────────────────────────────────

export class ResponseValidator {
  /**
   * Run all validation checks on a response.
   */
  validate(response: string, originalQuery: string, context?: ValidationContext): ValidationResult {
    const issues: ValidationIssue[] = [];

    const completeness = this.checkCompleteness(response, classifyQueryType(originalQuery));
    const syntaxChecks = this.checkCodeSyntax(extractCodeBlocks(response));
    const consistencyCheck = this.checkConsistency(response, context?.previousResponses ?? []);
    const hallucinationCheck = this.detectHallucination(response, context?.availableContext ?? "");

    // Collect issues from completeness
    if (!completeness.isComplete) {
      for (const aspect of completeness.missingAspects) {
        issues.push({
          type: "incomplete",
          severity: "warning",
          message: `Response may be missing: ${aspect}`,
          suggestion: `Consider addressing: ${aspect}`,
        });
      }
    }

    // Collect issues from syntax checks
    for (const check of syntaxChecks) {
      if (!check.valid) {
        for (const err of check.errors) {
          issues.push({
            type: "syntax-error",
            severity: "error",
            message: `Syntax error in ${check.language} code: ${err}`,
          });
        }
      }
    }

    // Collect issues from consistency
    if (!consistencyCheck.isConsistent) {
      for (const contradiction of consistencyCheck.contradictions) {
        issues.push({
          type: "inconsistency",
          severity: "warning",
          message: contradiction,
        });
      }
    }

    // Collect issues from hallucination check
    if (hallucinationCheck.detected) {
      for (const ref of hallucinationCheck.suspiciousReferences) {
        issues.push({
          type: "hallucination",
          severity: "warning",
          message: `Suspicious reference: "${ref.reference}" — ${ref.reason}`,
        });
      }
    }

    // Additional pattern checks
    issues.push(...this.checkPatterns(response, context));

    const score = this.scoreResponse(response, originalQuery);
    const hasErrors = issues.some((i) => i.severity === "error");

    return {
      valid: !hasErrors,
      score: score.overall,
      issues,
      completeness,
      syntaxChecks,
      consistencyCheck,
      hallucinationCheck,
    };
  }

  /**
   * Check if the response addresses all aspects of the task.
   */
  checkCompleteness(response: string, taskType: string): CompletenessCheck {
    const missingAspects: string[] = [];
    let score = 100;

    // Check for TODO/FIXME markers (incomplete work)
    if (/\bTODO\b/.test(response) || /\bFIXME\b/.test(response)) {
      missingAspects.push("Contains TODO/FIXME markers indicating incomplete work");
      score -= 20;
    }

    // Check for stub implementations
    if (/throw new Error\(["']Not implemented["']\)/.test(response) || /\/\/ stub/.test(response)) {
      missingAspects.push("Contains stub/placeholder implementations");
      score -= 30;
    }

    // Task-type-specific checks
    if (taskType === "code" || taskType === "implementation") {
      if (!response.includes("import") && response.includes("export")) {
        missingAspects.push("Code uses exports but may be missing imports");
        score -= 10;
      }
    }

    if (taskType === "bug-fix") {
      if (!/\b(test|verify|check|confirm)\b/i.test(response)) {
        missingAspects.push("Bug fix does not mention verification/testing");
        score -= 15;
      }
    }

    // Check for suspiciously short responses
    if (response.length < 50) {
      missingAspects.push("Response is very short for the task type");
      score -= 25;
    }

    return {
      isComplete: missingAspects.length === 0,
      missingAspects,
      score: Math.max(0, score),
    };
  }

  /**
   * Check extracted code blocks for syntactic validity.
   */
  checkCodeSyntax(codeBlocks: readonly CodeBlock[]): readonly SyntaxCheck[] {
    return codeBlocks.map((block) => {
      const errors = validateCodeBlock(block.content, block.language);
      return {
        codeBlock: block.content.slice(0, 200),
        language: block.language,
        valid: errors.length === 0,
        errors,
      };
    });
  }

  /**
   * Check if the response contradicts previous responses.
   */
  checkConsistency(response: string, previousResponses: readonly string[]): ConsistencyCheck {
    if (previousResponses.length === 0) {
      return { isConsistent: true, contradictions: [] };
    }

    const contradictions: string[] = [];

    // Check for contradictory claims about file existence
    const fileRefs = extractFileReferences(response);
    for (const prev of previousResponses) {
      // If a file was said to not exist before but now is referenced as existing
      for (const ref of fileRefs) {
        if (prev.includes(`${ref} does not exist`) || prev.includes(`${ref} doesn't exist`)) {
          if (response.includes(`reading ${ref}`) || response.includes(`found in ${ref}`)) {
            contradictions.push(
              `Previously said "${ref}" does not exist, but now references it as existing`,
            );
          }
        }
      }
    }

    // Check for contradictory approach descriptions
    const lastResponse = previousResponses[previousResponses.length - 1];
    if (lastResponse) {
      if (lastResponse.includes("will not") && response.includes("already did")) {
        contradictions.push("Claims to have done something that was previously declined");
      }
    }

    return {
      isConsistent: contradictions.length === 0,
      contradictions,
    };
  }

  /**
   * Detect references to things not in the available context.
   * Flags potential hallucinations (fabricated file names, APIs, etc.)
   */
  detectHallucination(response: string, availableContext: string): HallucinationCheck {
    const suspiciousReferences: SuspiciousReference[] = [];

    if (availableContext.length === 0) {
      return { detected: false, suspiciousReferences: [] };
    }

    // Check for fabricated file paths
    const responsePaths = extractFilePaths(response);
    const contextPaths = extractFilePaths(availableContext);
    const contextPathSet = new Set(contextPaths);

    for (const path of responsePaths) {
      // Only flag absolute paths that look specific (not common patterns)
      if (path.startsWith("/") && path.split("/").length > 2) {
        if (!contextPathSet.has(path) && !isCommonPath(path)) {
          suspiciousReferences.push({
            reference: path,
            reason: "File path not found in available context",
          });
        }
      }
    }

    // Check for fabricated function/method names in API references
    const apiCalls = extractApiCalls(response);
    for (const call of apiCalls) {
      if (call.length > 3 && !availableContext.includes(call)) {
        // Only flag if it looks like a specific API call (not a common one)
        if (!isCommonApiCall(call)) {
          suspiciousReferences.push({
            reference: call,
            reason: "API/function reference not found in available context",
          });
        }
      }
    }

    return {
      detected: suspiciousReferences.length > 0,
      suspiciousReferences,
    };
  }

  /**
   * Score a response on multiple quality dimensions (0-100).
   */
  scoreResponse(response: string, query: string): ResponseScore {
    const completeness = this.scoreCompleteness(response, query);
    const correctness = this.scoreCorrectness(response);
    const quality = this.scoreQuality(response);

    const overall = Math.round(
      completeness * 0.4 + correctness * 0.35 + quality * 0.25,
    );

    return {
      overall,
      completeness,
      correctness,
      quality,
      breakdown: { completeness, correctness, quality },
    };
  }

  // ── Private Scoring Helpers ──────────────────────────────

  private scoreCompleteness(response: string, query: string): number {
    let score = 70; // Baseline

    // Longer responses tend to be more complete (up to a point)
    if (response.length > 200) score += 10;
    if (response.length > 500) score += 10;
    if (response.length > 1000) score += 5;

    // Deduct for incomplete markers
    if (/\bTODO\b/.test(response)) score -= 15;
    if (/\bFIXME\b/.test(response)) score -= 15;
    if (/not implemented/i.test(response)) score -= 20;

    // Check that the response addresses query keywords
    const queryTokens = tokenize(query);
    const responseTokens = new Set(tokenize(response));
    const addressed = queryTokens.filter((t) => responseTokens.has(t)).length;
    const coverage = queryTokens.length > 0 ? addressed / queryTokens.length : 1;
    score += Math.round(coverage * 15);

    return clamp(score, 0, 100);
  }

  private scoreCorrectness(response: string): number {
    let score = 80; // Baseline

    // Deduct for syntax errors in code blocks
    const blocks = extractCodeBlocks(response);
    for (const block of blocks) {
      const errors = validateCodeBlock(block.content, block.language);
      score -= errors.length * 10;
    }

    // Deduct for `any` type usage (in TypeScript context)
    const anyCount = (response.match(/:\s*any\b/g) ?? []).length;
    score -= anyCount * 5;

    return clamp(score, 0, 100);
  }

  private scoreQuality(response: string): number {
    let score = 75; // Baseline

    // Bonus for error handling
    if (/\b(try|catch|throw|error|Error)\b/.test(response)) score += 5;

    // Bonus for type annotations
    if (/:\s*(string|number|boolean|readonly)\b/.test(response)) score += 5;

    // Bonus for immutability patterns
    if (/\breadonly\b/.test(response)) score += 5;
    if (/\bconst\b/.test(response)) score += 3;

    // Deduct for mutation patterns
    if (/\blet\b/.test(response) && !/\bconst\b/.test(response)) score -= 5;

    // Deduct for excessive console output in production code
    const consoleCount = (response.match(/console\.(log|warn|error)\b/g) ?? []).length;
    if (consoleCount > 3) score -= 10;

    return clamp(score, 0, 100);
  }

  private checkPatterns(response: string, context?: ValidationContext): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for `any` type usage
    if (/:\s*any\b/.test(response) && context?.strictTypes) {
      issues.push({
        type: "any-type",
        severity: "warning",
        message: "Response uses 'any' type in strict TypeScript mode",
        suggestion: "Replace 'any' with proper types or 'unknown'",
      });
    }

    // Check for missing error handling in async code
    if (/async\s+function/.test(response) || /\.then\(/.test(response)) {
      if (!/\b(catch|try)\b/.test(response)) {
        issues.push({
          type: "missing-error-handling",
          severity: "warning",
          message: "Async code without error handling (missing try/catch)",
          suggestion: "Wrap async operations in try/catch blocks",
        });
      }
    }

    // Check for TODO markers
    if (/\bTODO\b/.test(response)) {
      issues.push({
        type: "todo-marker",
        severity: "info",
        message: "Response contains TODO markers",
        suggestion: "Complete all TODO items before finalizing",
      });
    }

    return issues;
  }
}

// ── Context Type ───────────────────────────────────────────

export interface ValidationContext {
  readonly previousResponses: readonly string[];
  readonly availableContext: string;
  readonly strictTypes?: boolean;
}

// ── Utility Functions ────────────────────────────────────────

interface CodeBlock {
  readonly content: string;
  readonly language: string;
}

function extractCodeBlocks(text: string): readonly CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] ?? "unknown",
      content: match[2] ?? "",
    });
  }

  return blocks;
}

function validateCodeBlock(code: string, language: string): readonly string[] {
  const errors: string[] = [];

  if (language === "ts" || language === "typescript" || language === "js" || language === "javascript") {
    // Check brace balance
    const braceBalance = countChar(code, "{") - countChar(code, "}");
    if (braceBalance !== 0) {
      errors.push(`Unbalanced braces (${braceBalance > 0 ? "missing" : "extra"} ${Math.abs(braceBalance)} closing)`);
    }

    // Check paren balance
    const parenBalance = countChar(code, "(") - countChar(code, ")");
    if (parenBalance !== 0) {
      errors.push(`Unbalanced parentheses (${parenBalance > 0 ? "missing" : "extra"} ${Math.abs(parenBalance)} closing)`);
    }
  }

  if (language === "json") {
    try {
      JSON.parse(code);
    } catch {
      errors.push("Invalid JSON syntax");
    }
  }

  return errors;
}

function extractFileReferences(text: string): readonly string[] {
  const matches = text.match(/[\w./-]+\.\w{1,5}/g) ?? [];
  return [...new Set(matches)];
}

function extractFilePaths(text: string): readonly string[] {
  const matches = text.match(/(?:\/[\w.-]+)+\.\w{1,5}/g) ?? [];
  return [...new Set(matches)];
}

function extractApiCalls(text: string): readonly string[] {
  const matches = text.match(/\b\w+\.\w+\(/g) ?? [];
  return [...new Set(matches.map((m) => m.replace("(", "")))];
}

function isCommonPath(path: string): boolean {
  const commonPrefixes = ["/usr/", "/etc/", "/tmp/", "/var/", "/home/", "/bin/"];
  return commonPrefixes.some((p) => path.startsWith(p));
}

function isCommonApiCall(call: string): boolean {
  const common = new Set([
    "console.log", "console.warn", "console.error",
    "Math.round", "Math.max", "Math.min", "Math.floor", "Math.ceil",
    "JSON.parse", "JSON.stringify",
    "Array.from", "Array.isArray",
    "Object.keys", "Object.values", "Object.entries", "Object.assign",
    "Promise.all", "Promise.resolve", "Promise.reject",
    "String.raw",
    "process.exit", "process.env",
  ]);
  return common.has(call);
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === char) count++;
  }
  return count;
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function classifyQueryType(query: string): string {
  const lower = query.toLowerCase();
  if (/\b(fix|bug|error|broken|failing)\b/.test(lower)) return "bug-fix";
  if (/\b(refactor|rename|restructure)\b/.test(lower)) return "refactor";
  if (/\b(implement|create|build|add|write)\b/.test(lower)) return "implementation";
  if (/\b(test|spec|coverage)\b/.test(lower)) return "test";
  return "general";
}
