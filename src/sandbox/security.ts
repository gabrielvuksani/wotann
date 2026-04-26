/**
 * Sandbox & Security — kernel-level sandboxing + risk classification.
 *
 * FEATURES:
 * - Platform detection: Landlock (Linux), Seatbelt (macOS), Docker fallback
 * - 3-tier autonomy classifier: LOW/MEDIUM/HIGH
 * - Permission resolution matrix (mode × risk → decision)
 * - Bash command security analysis (23 checks from spec §31)
 * - Sensitive file protection (env files, credentials, SSH keys)
 * - IFS/null-byte injection prevention
 * - Environment sanitization for subagents
 */

import { platform } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { resolve, relative, normalize } from "node:path";
import { canonicalizePathForCheck } from "../utils/path-realpath.js";
import type { RiskLevel, PermissionMode, PermissionDecision } from "../core/types.js";
import {
  ApprovalRuleEngine,
  type ApprovalRule,
  type ApprovalAction,
  type EvaluationResult,
} from "./approval-rules.js";
import {
  proposeRule,
  draftToRule,
  appendPersistedRule,
  loadPersistedRules,
  type ApprovedAction,
  type RuleDraft,
} from "./request-rule.js";

export type PlatformSandbox = "landlock" | "seatbelt" | "docker" | "none";

// ── Platform Detection ───────────────────────────────────

export function detectSandbox(): PlatformSandbox {
  const os = platform();
  if (os === "linux") return "landlock";
  if (os === "darwin") return "seatbelt";
  return "none";
}

/**
 * Check if the sandbox is actually enforceable on this system.
 */
export function isSandboxEnforceable(): boolean {
  const os = platform();
  if (os === "darwin") {
    // macOS Seatbelt (sandbox-exec) is always available
    return true;
  }
  if (os === "linux") {
    // Landlock requires kernel 5.13+ and CONFIG_SECURITY_LANDLOCK=y
    return existsSync("/sys/kernel/security/landlock");
  }
  return false;
}

// ── Compound Command Splitting ──────────────────────────

/**
 * Split compound bash commands (&&, ||, ;, |) respecting quotes.
 * Each sub-command is classified independently — if ANY is HIGH, the whole thing is HIGH.
 *
 * Handles single quotes, double quotes, backtick quotes, and backslash escapes.
 * If the command contains no compound operators, returns the original command as a
 * single-element array. Unclosed quotes cause fail-closed behavior (returns whole command).
 */
function splitCompoundCommands(command: string): readonly string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    const prev = i > 0 ? command[i - 1] : "";

    if (ch === "'" && !inDouble && !inBacktick && prev !== "\\") {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && !inBacktick && prev !== "\\") {
      inDouble = !inDouble;
    } else if (ch === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      // Check for two-character compound operators first
      const next = command[i + 1];
      if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        i++; // skip second char of && or ||
        continue;
      }
      // Single-character operators: ; and |
      if (ch === ";" || ch === "|") {
        if (current.trim()) parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }

  // Unclosed quotes: fail-closed — return whole command unsplit
  if (inSingle || inDouble || inBacktick) {
    return [command];
  }

  if (current.trim()) parts.push(current.trim());
  return parts.length > 0 ? parts : [command];
}

// ── 3-Tier Risk Classification ───────────────────────────

/**
 * Classify a single (non-compound) bash command by risk level.
 * This is the core classification logic extracted so compound commands
 * can classify each sub-command independently.
 */
function classifySingleBashCommand(cmd: string): RiskLevel {
  if (isDestructiveCommand(cmd)) return "high";
  return "high"; // All bash is high risk by default
}

/**
 * Classify a tool call into LOW/MEDIUM/HIGH risk.
 *
 * LOW: Read-only operations — auto-approve in all modes
 * MEDIUM: File modifications — needs approval in default mode
 * HIGH: Shell commands, computer use, destructive ops — needs explicit approval
 *
 * For Bash/ComputerUse tools, compound commands are split quote-aware
 * and each sub-command is classified independently. If ANY sub-command
 * is HIGH risk, the whole compound command is HIGH.
 */
export function classifyRisk(tool: string, input?: Record<string, unknown>): RiskLevel {
  // LOW: Pure read operations
  if (["Read", "Glob", "Grep", "LSP", "WebSearch", "WebFetch"].includes(tool)) return "low";

  // MEDIUM: File writes (non-destructive, reversible)
  if (["Write", "Edit", "NotebookEdit"].includes(tool)) return "medium";

  // HIGH: Shell execution — split compound commands and classify each
  if (tool === "Bash" || tool === "ComputerUse") {
    const cmd = String(input?.["command"] ?? "");
    const subCommands = splitCompoundCommands(cmd);

    for (const sub of subCommands) {
      const subRisk = classifySingleBashCommand(sub);
      if (subRisk === "high") return "high";
    }
    return "high"; // All bash is high risk by default
  }

  return "medium";
}

// ── Bash Command Security Analysis ───────────────────────

/**
 * 23 security checks for bash commands (from spec §31).
 * Returns true if the command contains destructive patterns.
 */
export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
}

const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  // File deletion
  /\brm\s+-rf\b/,
  /\brm\s+-r\s+\//,
  /\bsudo\s+rm\b/,
  // Git destructive
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-f/,
  /\bgit\s+branch\s+-D\b/,
  /\bgit\s+checkout\s+--\s+\./,
  // Database destructive
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\b.*\bWHERE\s+1\s*=\s*1/i,
  // Infrastructure destructive
  /\bkubectl\s+delete\b/,
  /\bterraform\s+destroy\b/,
  /\bdocker\s+system\s+prune\b/,
  // Process/system
  /\bkill\s+-9\b/,
  /\bkillall\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  // Credentials/secrets
  /\bcurl\b.*\bpassword\b/i,
  /\bwget\b.*\btoken\b/i,
  // Piping to shell (code execution risk)
  /\bcurl\b.*\|\s*(ba)?sh\b/,
  // Fork bomb patterns (from deer-flow research)
  /\S+\(\)\s*\{[^}]*\|\s*\S+\s*&/, // :(){ :|:& };:
  /\bwhile\s+true.*&\s*done/, // while true; do bash & done
  // Dynamic linker hijack (from deer-flow research)
  /\b(LD_PRELOAD|LD_LIBRARY_PATH)\s*=/,
  // Base64 decode piped to shell execution (from deer-flow research)
  /\bbase64\s+.*-d.*\|\s*(ba)?sh\b/,
  /\bbase64\s+--decode.*\|\s*(ba)?sh\b/,
  // Process environment dump (from deer-flow research)
  /\/proc\/[^/]+\/environ/,
  // Bash built-in networking (bypasses tool allowlists, from deer-flow research)
  /\/dev\/tcp\//,
  // Overwrite system binaries (from deer-flow research)
  />+\s*\/usr\/bin\//,
  />+\s*\/bin\//,
  />+\s*\/sbin\//,
  // Overwrite shell startup files (from deer-flow research)
  />+\s*~\/?\.(bashrc|profile|zshrc|bash_profile)/,
];

/**
 * Check a bash command for common injection patterns.
 * Returns an array of detected issues.
 */
export function analyzeBashSecurity(command: string): readonly SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  // IFS manipulation
  if (/\bIFS\s*=/.test(command)) {
    issues.push({
      type: "ifs-manipulation",
      severity: "high",
      message: "IFS variable manipulation detected",
    });
  }

  // Null byte injection
  if (command.includes("\\x00") || command.includes("\\0")) {
    issues.push({ type: "null-byte", severity: "high", message: "Null byte injection attempt" });
  }

  // Zero-width space injection. ESLint's no-misleading-character-class
  // fires on ZWJ (U+200D) because it's used to join emoji; here we want
  // it as a standalone marker, which is exactly the security-relevant
  // intent, so disable the rule on this line.
  // eslint-disable-next-line no-misleading-character-class
  if (/[\u200B\u200C\u200D\uFEFF]/.test(command)) {
    issues.push({
      type: "zero-width",
      severity: "high",
      message: "Zero-width character detected in command",
    });
  }

  // Command substitution in user-controlled strings
  if (/\$\(.*\)/.test(command) || /`.*`/.test(command)) {
    issues.push({
      type: "command-substitution",
      severity: "medium",
      message: "Command substitution detected — verify input is safe",
    });
  }

  // Pipe to eval/sh/bash
  if (/\|\s*(eval|sh|bash)\b/.test(command)) {
    issues.push({
      type: "pipe-to-shell",
      severity: "high",
      message: "Piping output to shell execution",
    });
  }

  // Environment variable exfiltration
  if (/\benv\b|\bprintenv\b|\bexport\b.*SECRET|TOKEN|KEY|PASSWORD/i.test(command)) {
    issues.push({
      type: "env-exfiltration",
      severity: "medium",
      message: "Possible environment variable exfiltration",
    });
  }

  return issues;
}

export interface SecurityIssue {
  readonly type: string;
  readonly severity: "low" | "medium" | "high";
  readonly message: string;
}

// ── Sensitive File Protection ────────────────────────────

const SENSITIVE_FILE_PATTERNS: readonly RegExp[] = [
  /\.env$/,
  /\.env\.\w+$/,
  /credentials\.json$/,
  /\.aws\/credentials$/,
  /\.ssh\/(id_rsa|id_ed25519|config)$/,
  /\.npmrc$/,
  /\.pypirc$/,
  /\.netrc$/,
  /auth\.json$/,
  /token\.json$/,
  /secret/i,
];

/**
 * Check if a file path points to a sensitive file.
 *
 * CVE-2026-25724 defence: the patterns test the RAW path string, so a
 * symlink (`harmless.txt → /home/user/.env`) bypasses the matcher. We
 * test BOTH the raw input AND the canonical (realpath-resolved) form;
 * a match on either is grounds for treating the file as sensitive.
 * Defence-in-depth: callers should still combine this with
 * `safeWriteFile` so a successful raw-match doesn't lull them into
 * forgetting the leaf-symlink risk on writes.
 */
export function isSensitiveFile(filePath: string): boolean {
  if (SENSITIVE_FILE_PATTERNS.some((p) => p.test(filePath))) return true;
  try {
    const canonical = canonicalizePathForCheck(filePath);
    if (canonical !== filePath && SENSITIVE_FILE_PATTERNS.some((p) => p.test(canonical))) {
      return true;
    }
  } catch {
    // realpath failure — honest fallback (QB#6): be cautious. We've
    // already evaluated the raw path; if that didn't match, there's
    // nothing more to test, but the caller still has lstat-precheck
    // protection on writes via safeWriteFile.
  }
  return false;
}

// ── Environment Sanitization ─────────────────────────────

/**
 * Remove sensitive environment variables before passing to subagents.
 * Pattern from Appendix Z.6: subagents should not inherit raw API keys.
 */
export function sanitizeEnvForSubagent(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const sensitiveKeys = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "AZURE_OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "DISCORD_BOT_TOKEN",
    "TELEGRAM_BOT_TOKEN",
  ];

  const sanitized = { ...env };
  for (const key of sensitiveKeys) {
    if (sanitized[key]) {
      sanitized[key] = undefined;
    }
  }
  return sanitized;
}

// ── Permission Resolution ────────────────────────────────

/**
 * Decide whether to allow, prompt, or block based on permission mode and risk.
 */
export function resolvePermission(mode: PermissionMode, risk: RiskLevel): PermissionDecision {
  const matrix: Record<PermissionMode, Record<RiskLevel, PermissionDecision>> = {
    default: { low: "allow", medium: "deny", high: "deny" },
    acceptEdits: { low: "allow", medium: "allow", high: "deny" },
    plan: { low: "allow", medium: "deny", high: "deny" },
    auto: { low: "allow", medium: "allow", high: "allow" },
    bypassPermissions: { low: "allow", medium: "allow", high: "allow" },
    dontAsk: { low: "allow", medium: "deny", high: "deny" },
  };

  return matrix[mode][risk];
}

// ── Workspace Boundary Enforcement ───────────────────────

/**
 * Check if a file path is within the allowed workspace.
 * Prevents the agent from writing outside the project directory.
 * Resolves symlinks to prevent traversal bypasses.
 */
export function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
  // Resolve to absolute paths
  const resolvedPath = resolve(filePath);
  const resolvedRoot = resolve(workspaceRoot);

  // Resolve symlinks for existing paths
  let realPath: string;
  try {
    realPath = realpathSync(resolvedPath);
  } catch {
    // Path doesn't exist yet (e.g., creating a new file) — use resolved path
    realPath = resolvedPath;
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(resolvedRoot);
  } catch {
    realRoot = resolvedRoot;
  }

  // Check containment after symlink resolution
  if (!realPath.startsWith(realRoot + "/") && realPath !== realRoot) {
    return false;
  }

  // Double-check: normalize the relative path and ensure it doesn't escape
  const rel = normalize(relative(realRoot, realPath));
  if (rel.startsWith("..")) {
    return false;
  }

  return true;
}

// ── Phase 13 Wave 3B: Codex approval-rule parity ────────

/**
 * Per-process singleton approval engine. Session-scoped rules live here;
 * persistent rules are hydrated lazily from ~/.wotann/approval-rules.json
 * on first access. Callers (hook gate, CLI `wotann approve`) reach for
 * this via `getApprovalRuleEngine()` rather than instantiating their own.
 */
let APPROVAL_RULE_ENGINE: ApprovalRuleEngine | null = null;
let APPROVAL_ENGINE_HYDRATED = false;

export function getApprovalRuleEngine(): ApprovalRuleEngine {
  if (!APPROVAL_RULE_ENGINE) {
    APPROVAL_RULE_ENGINE = new ApprovalRuleEngine();
  }
  if (!APPROVAL_ENGINE_HYDRATED) {
    APPROVAL_ENGINE_HYDRATED = true;
    try {
      const persisted = loadPersistedRules();
      APPROVAL_RULE_ENGINE.loadSerialized(persisted);
    } catch (err) {
      // Honest: log but don't throw — a malformed rules file shouldn't
      // brick every tool call. Callers still get an empty-rule engine.
      console.warn(`[WOTANN] approval-rules hydrate failed: ${(err as Error).message}`);
    }
  }
  return APPROVAL_RULE_ENGINE;
}

/**
 * Evaluate a proposed tool call against all active approval rules.
 * Returns `allow`/`deny`/`ask` — the hook gate calls this first so an
 * earlier "always approve this command" rule short-circuits before
 * the manual prompt fires.
 */
export function evaluateApprovalRules(toolName: string, input: unknown): EvaluationResult {
  return getApprovalRuleEngine().evaluate(toolName, input);
}

/**
 * Propose a Codex-style rule draft from a just-approved action. Called
 * after a user manually approves a prompt so the UI can offer "save
 * this rule?" without mutating state. Pure — returns only the draft.
 */
export function proposeApprovalRuleFromAction(approved: ApprovedAction): RuleDraft {
  return proposeRule(approved);
}

/**
 * Accept a user-chosen rule draft: add it to the session engine AND
 * persist it to ~/.wotann/approval-rules.json so future sessions
 * inherit the user's choice. Refuses empty-matching patterns (handled
 * internally by appendPersistedRule).
 */
export function acceptApprovalRuleDraft(draft: RuleDraft, reason?: string): ApprovalRule {
  const rule = draftToRule(draft, reason);
  const engine = getApprovalRuleEngine();
  engine.addRule(rule);
  if (rule.scope === "persistent") {
    try {
      appendPersistedRule({
        id: rule.id,
        ...(rule.toolName !== undefined ? { toolName: rule.toolName } : {}),
        patternSource: rule.pattern instanceof RegExp ? rule.pattern.source : rule.pattern,
        ...(rule.pattern instanceof RegExp ? { patternFlags: rule.pattern.flags } : {}),
        patternIsRegex: rule.pattern instanceof RegExp,
        action: rule.action,
        scope: rule.scope,
        ...(rule.expiresAt !== undefined ? { expiresAt: rule.expiresAt } : {}),
        ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
      });
    } catch (err) {
      console.warn(`[WOTANN] approval-rule persist failed: ${(err as Error).message}`);
    }
  }
  return rule;
}

export type { ApprovalAction, ApprovedAction, RuleDraft, ApprovalRule };
