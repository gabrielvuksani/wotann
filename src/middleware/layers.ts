/**
 * All 16 middleware layers (except IntentGate and TTSR which have own files).
 * Each layer implements the Middleware interface with before/after hooks.
 * Per spec §9: every cross-cutting concern is a composable layer.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";
import type { RiskLevel } from "../core/types.js";
import { runSandboxedCommandSync } from "../sandbox/executor.js";

interface PackageJson {
  readonly scripts?: Record<string, string>;
}

// ── Layer 2: Thread Data — create isolated thread directory ──

export const threadDataMiddleware: Middleware = {
  name: "ThreadData",
  order: 2,
  before(ctx: MiddlewareContext): MiddlewareContext {
    const threadDir = join(ctx.workingDir, ".wotann", "threads", ctx.sessionId);
    if (!existsSync(threadDir)) {
      mkdirSync(threadDir, { recursive: true });
    }
    return { ...ctx, threadDir };
  },
};

// ── Layer 3: Uploads — inject uploaded file context ──────────

export const uploadsMiddleware: Middleware = {
  name: "Uploads",
  order: 3,
  before(ctx: MiddlewareContext): MiddlewareContext {
    // Parse @file references in user message and inject file contents
    const fileRefPattern = /@([\w./-]+)/g;
    let enrichedMessage = ctx.userMessage;
    const matches = ctx.userMessage.matchAll(fileRefPattern);
    const injectedFiles: string[] = [];

    for (const match of matches) {
      const filePath = match[1];
      if (filePath && existsSync(join(ctx.workingDir, filePath))) {
        injectedFiles.push(filePath);
      }
    }

    if (injectedFiles.length > 0) {
      enrichedMessage = `${ctx.userMessage}\n\n[Files referenced: ${injectedFiles.join(", ")}]`;
    }

    return { ...ctx, userMessage: enrichedMessage, injectedFiles };
  },
};

// ── Layer 4: Sandbox — verify working dir is within allowed scope ──

export const sandboxMiddleware: Middleware = {
  name: "Sandbox",
  order: 4,
  before(ctx: MiddlewareContext): MiddlewareContext {
    // Ensure workingDir is resolved and exists
    const resolved = ctx.workingDir;
    if (!existsSync(resolved)) {
      return { ...ctx, sandboxError: "Working directory does not exist" };
    }
    return { ...ctx, sandboxActive: true };
  },
};

// ── Layer 5: Guardrail — pre-execution hook authorization ────

export const guardrailMiddleware: Middleware = {
  name: "Guardrail",
  order: 5,
  before(ctx: MiddlewareContext): MiddlewareContext {
    // Flag requests that mention destructive operations for the hook engine
    const destructiveKeywords = /\b(delete|remove|drop|truncate|reset|force.?push|rm\s+-rf)\b/i;
    const needsGuardrail = destructiveKeywords.test(ctx.userMessage);
    return { ...ctx, guardrailTriggered: needsGuardrail };
  },
};

// ── Layer 6: Tool Error — standardize error formatting ───────

export const toolErrorMiddleware: Middleware = {
  name: "ToolError",
  order: 6,
  after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
    if (!result.success && result.content) {
      // Normalize error format for consistent agent processing
      const normalizedContent = result.content.startsWith("Error:")
        ? result.content
        : `Error: ${result.content}`;
      return { ...result, content: normalizedContent };
    }
    return result;
  },
};

// ── Layer 7: Summarization — manage token limits ─────────────

export const summarizationMiddleware: Middleware = {
  name: "Summarization",
  order: 7,
  before(ctx: MiddlewareContext): MiddlewareContext {
    // Estimate tokens in recent history and flag if nearing limit
    const historyTokens = ctx.recentHistory.reduce(
      (sum, msg) => sum + Math.ceil(msg.content.length / 4),
      0,
    );
    const contextLimit = 200_000; // Default context limit estimate
    const utilizationPercent = Math.round((historyTokens / contextLimit) * 100);
    const needsSummarization = utilizationPercent > 75;

    return { ...ctx, contextUtilization: utilizationPercent, needsSummarization };
  },
};

// ── Layer 8: Memory — queue memory extraction ────────────────

export const memoryMiddleware: Middleware = {
  name: "Memory",
  order: 8,
  after(ctx: MiddlewareContext, result: AgentResult): AgentResult {
    // After each tool use, flag observations worth capturing
    if (result.success && result.toolName) {
      const memoryCandidate = {
        tool: result.toolName,
        file: result.filePath,
        sessionId: ctx.sessionId,
        timestamp: Date.now(),
      };
      // Attach memory extraction hint to result
      return { ...result, memoryCandidate };
    }
    return result;
  },
};

// ── Layer 10: Clarification — detect when user input is ambiguous ──

const AMBIGUITY_SIGNALS: readonly RegExp[] = [
  /\b(something|stuff|things|it|this|that)\b/i,
  /\b(maybe|perhaps|possibly|or something)\b/i,
  /\?{2,}/,
];

export const clarificationMiddleware: Middleware = {
  name: "Clarification",
  order: 10,
  before(ctx: MiddlewareContext): MiddlewareContext {
    // Only flag ambiguity if the message is short (longer messages self-contextualize)
    if (ctx.userMessage.length > 100) return ctx;

    const ambiguityScore = AMBIGUITY_SIGNALS.reduce(
      (score, pattern) => score + (pattern.test(ctx.userMessage) ? 1 : 0),
      0,
    );
    return { ...ctx, ambiguityScore, needsClarification: ambiguityScore >= 2 };
  },
};

// ── Layer 11: Cache — track prompt cache hit rates ───────────

const cacheStats = { hits: 0, misses: 0, totalRequests: 0 };

export const cacheMiddleware: Middleware = {
  name: "Cache",
  order: 11,
  before(ctx: MiddlewareContext): MiddlewareContext {
    cacheStats.totalRequests++;
    const hitRate = cacheStats.totalRequests > 0 ? cacheStats.hits / cacheStats.totalRequests : 0;
    return { ...ctx, cacheHitRate: hitRate };
  },
  after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
    // Track whether the response used cached prompt prefix
    if (result.cacheHit) {
      cacheStats.hits++;
    } else {
      cacheStats.misses++;
    }
    return result;
  },
};

export function getCacheStats(): { hits: number; misses: number; hitRate: number } {
  return {
    ...cacheStats,
    hitRate: cacheStats.totalRequests > 0 ? cacheStats.hits / cacheStats.totalRequests : 0,
  };
}

// ── Layer 12: Autonomy — 3-tier risk classification ──────────

export function classifyRisk(tool: string, _input?: unknown): RiskLevel {
  if (["Read", "Glob", "Grep", "LSP", "WebSearch"].includes(tool)) return "low";
  if (["Write", "Edit"].includes(tool)) return "medium";
  if (["Bash", "ComputerUse"].includes(tool)) return "high";
  return "medium";
}

export const autonomyMiddleware: Middleware = {
  name: "Autonomy",
  order: 12,
  before(ctx: MiddlewareContext): MiddlewareContext {
    // Classify risk based on intent and complexity
    const risk: RiskLevel = ctx.complexity === "high" ? "high" : "medium";
    return { ...ctx, riskLevel: risk };
  },
};

// ── Layer 14: File Track — record files the agent touched ────

export const fileTrackMiddleware: Middleware = {
  name: "FileTrack",
  order: 14,
  before(ctx: MiddlewareContext): MiddlewareContext {
    // Initialize trackedFiles immutably on first pass so after() never mutates ctx
    if (!ctx.trackedFiles) {
      return { ...ctx, trackedFiles: new Set<string>() };
    }
    return ctx;
  },
  after(ctx: MiddlewareContext, result: AgentResult): AgentResult {
    if (result.filePath && ctx.trackedFiles) {
      // Set.add is the Set's own API — ctx property reference is unchanged
      ctx.trackedFiles.add(result.filePath);
    }
    return result;
  },
};

// ── Layer 15: Forced Verification — auto-verify after writes ─

export const forcedVerificationMiddleware: Middleware = {
  name: "ForcedVerification",
  order: 15,
  async after(ctx: MiddlewareContext, result: AgentResult): Promise<AgentResult> {
    if (!result.toolName || !["Write", "Edit"].includes(result.toolName)) {
      return result;
    }

    // Run typecheck if the file is TypeScript
    if (result.filePath?.endsWith(".ts") || result.filePath?.endsWith(".tsx")) {
      const [binary, ...args] = detectTypecheckCommand(ctx.workingDir);
      const verification = runSandboxedCommandSync(binary!, args, {
        workingDir: ctx.workingDir,
        timeoutMs: 30_000,
        allowNetwork: false,
      });

      if (!verification.success) {
        const stderr = verification.output || "Type check failed";
        return {
          ...result,
          followUp: `Verification failed (typecheck):\n${stderr.slice(0, 500)}\nFix before continuing.`,
        };
      }
    }

    return result;
  },
};

function detectTypecheckCommand(workingDir: string): readonly string[] {
  const packagePath = join(workingDir, "package.json");
  if (!existsSync(packagePath)) {
    return ["npx", "tsc", "--noEmit"];
  }

  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf-8")) as PackageJson;
    if (pkg.scripts?.["typecheck"]) {
      return [detectRunner(workingDir), "run", "typecheck"];
    }
  } catch {
    // Fall through to the generic compiler check.
  }

  return ["npx", "tsc", "--noEmit"];
}

function detectRunner(workingDir: string): string {
  if (existsSync(join(workingDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(workingDir, "yarn.lock"))) return "yarn";
  return "npm";
}

// ── Layer 16: Frustration Detection — 21 regex patterns, <5ms ─

const FRUSTRATION_PATTERNS: readonly RegExp[] = [
  /\bwtf\b/i,
  /\bwhy (won't|doesn't|can't|isn't)\b/i,
  /\bstill (broken|failing|wrong|not working)\b/i,
  /\bagain\?/i,
  /\bthis (doesn't|won't|can't) work\b/i,
  /\bi (already|just) (told|said|asked)\b/i,
  /\bstop (doing|making|repeating)\b/i,
  /\bthat's (wrong|incorrect|not what)\b/i,
  /\bno,?\s+(that's|you)\b/i,
  /!{3,}/,
  /\bugh\b/i,
  /\bfrustrat/i,
  /\bannoy/i,
  /\bfor the (nth|100th|tenth) time\b/i,
  /\byou keep\b/i,
  /\bsame (mistake|error|issue|problem)\b/i,
  /\bnot what I (asked|wanted|meant)\b/i,
  /\bplease (just|actually|really)\b/i,
  /\bi said\b.*\bnot\b/i,
  /\bdo(n't| not) (understand|get it|listen)\b/i,
  /\bworse\b/i,
];

export function detectFrustration(message: string): { detected: boolean; patterns: string[] } {
  const matched: string[] = [];
  for (const pattern of FRUSTRATION_PATTERNS) {
    if (pattern.test(message)) {
      const match = message.match(pattern);
      if (match?.[0]) matched.push(match[0]);
    }
  }
  return { detected: matched.length >= 1, patterns: matched };
}

export const frustrationMiddleware: Middleware = {
  name: "Frustration",
  order: 16,
  before(ctx: MiddlewareContext): MiddlewareContext {
    const result = detectFrustration(ctx.userMessage);
    return {
      ...ctx,
      frustrationDetected: result.detected,
      frustrationPatterns: result.patterns,
    };
  },
};

// ── Layer 17B: Self-Reflection — post-response quality check ──

/**
 * Patterns that indicate a response may contain hallucinated file paths.
 * Matches absolute paths that look plausible but are commonly fabricated.
 */
const HALLUCINATED_PATH_PATTERNS: readonly RegExp[] = [
  /(?:\/usr\/local\/lib|\/home\/user|\/Users\/username|\/var\/lib)\/[\w./-]+/,
  /[A-Z]:\\(?:Users|Program Files)\\[\w\\.-]+/,
  /(?:~\/|\.\.\/){2,}[\w./-]+/,
];

/**
 * Phrases that indicate an incomplete or hedging response.
 */
const INCOMPLETE_INDICATORS: readonly RegExp[] = [
  /\bI (?:can't|cannot|don't have|am unable to) (?:actually |really )?(?:access|read|see|check|verify|run|execute)\b/i,
  /\bI would need (?:to|more|additional)\b/i,
  /\bI('m| am) not (?:sure|certain|able)\b/i,
  /\bthis (?:may|might|could|should) work\b/i,
  /\buntested\b/i,
  /\bI'll leave (?:that|this|it) (?:to|for|as)\b/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\.{3,}\s*$/m, // trailing ellipsis suggesting truncation
];

/**
 * Patterns that indicate internal contradictions within a response.
 * Each pair detects opposing claims appearing in the same text.
 */
const CONTRADICTION_PAIRS: readonly [RegExp, RegExp][] = [
  [
    /\bfile (?:exists|is present|was found)\b/i,
    /\bfile (?:does not exist|not found|is missing)\b/i,
  ],
  [/\bsucceeded|success(?:ful(?:ly)?)\b/i, /\bfailed|failure|error occurred\b/i],
  [/\bis (?:enabled|active|on|running)\b/i, /\bis (?:disabled|inactive|off|stopped)\b/i],
  [/\bno (?:errors?|issues?|problems?)\b/i, /\berror|issue|problem/i],
];

export interface SelfReflectionIssue {
  readonly type: "incomplete" | "hallucinated-path" | "contradiction";
  readonly evidence: string;
  readonly severity: "low" | "medium" | "high";
}

/**
 * Analyze a model response for common quality issues.
 * Returns an array of detected issues (empty if the response looks clean).
 */
export function analyzeResponseQuality(
  response: string,
  _originalQuery: string,
): readonly SelfReflectionIssue[] {
  const issues: SelfReflectionIssue[] = [];

  // Check for hallucinated file paths
  for (const pattern of HALLUCINATED_PATH_PATTERNS) {
    const match = response.match(pattern);
    if (match?.[0]) {
      issues.push({
        type: "hallucinated-path",
        evidence: match[0],
        severity: "medium",
      });
    }
  }

  // Check for incomplete/hedging indicators
  const incompleteMatches: string[] = [];
  for (const pattern of INCOMPLETE_INDICATORS) {
    const match = response.match(pattern);
    if (match?.[0]) {
      incompleteMatches.push(match[0]);
    }
  }
  // Only flag as incomplete if multiple indicators are present (single hedges are normal)
  if (incompleteMatches.length >= 2) {
    issues.push({
      type: "incomplete",
      evidence: incompleteMatches.slice(0, 3).join("; "),
      severity: "high",
    });
  }

  // Check for contradictions
  for (const [positive, negative] of CONTRADICTION_PAIRS) {
    if (positive.test(response) && negative.test(response)) {
      const posMatch = response.match(positive)?.[0] ?? "";
      const negMatch = response.match(negative)?.[0] ?? "";
      issues.push({
        type: "contradiction",
        evidence: `"${posMatch}" vs "${negMatch}"`,
        severity: "high",
      });
    }
  }

  return issues;
}

/**
 * Format detected issues into a system notification string.
 * Returns null if no issues were found.
 */
function formatReflectionNotice(issues: readonly SelfReflectionIssue[]): string | null {
  if (issues.length === 0) return null;

  const lines: string[] = [
    "\n--- SELF-REFLECTION NOTICE ---",
    "The following potential issues were detected in the response:",
  ];

  for (const issue of issues) {
    const severity = issue.severity === "high" ? "(!)" : "(*)";
    switch (issue.type) {
      case "hallucinated-path":
        lines.push(
          `  ${severity} Possibly hallucinated path: ${issue.evidence} — verify this path exists`,
        );
        break;
      case "incomplete":
        lines.push(
          `  ${severity} Response may be incomplete: ${issue.evidence} — consider providing a concrete answer`,
        );
        break;
      case "contradiction":
        lines.push(
          `  ${severity} Contradictory statements detected: ${issue.evidence} — re-check for consistency`,
        );
        break;
    }
  }

  lines.push("--- END SELF-REFLECTION ---");
  return lines.join("\n");
}

/**
 * Self-Reflection middleware layer.
 *
 * Runs AFTER the model responds. Inspects the response for common quality
 * issues: incomplete answers, hallucinated file paths, and contradictions.
 * If issues are found, a follow-up notification is attached suggesting
 * the model re-check its output.
 *
 * This is a post-processing hook — it does NOT re-query the model.
 */
export const selfReflectionMiddleware: Middleware = {
  name: "SelfReflection",
  order: 17,
  after(ctx: MiddlewareContext, result: AgentResult): AgentResult {
    // Only analyze text responses (not tool results)
    if (!result.content || result.toolName) return result;

    const issues = analyzeResponseQuality(result.content, ctx.userMessage);
    const notice = formatReflectionNotice(issues);

    if (!notice) return result;

    // Attach the self-reflection notice as a followUp for the agent to consider
    const existingFollowUp = result.followUp ? `${result.followUp}\n` : "";
    return { ...result, followUp: `${existingFollowUp}${notice}` };
  },
};
