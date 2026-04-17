/**
 * 17+ built-in hooks implementing the hook-as-guarantee pattern.
 * Each behavioral guarantee is deterministic code, not a prompt suggestion.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { HookHandler, HookPayload, HookResult } from "./engine.js";
import { detectFrustration } from "../middleware/layers.js";

// ── Secret Scanner (minimal) ────────────────────────────────

const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:^|[^a-zA-Z0-9])(?:sk-[a-zA-Z0-9]{20,})/,
  /(?:^|[^a-zA-Z0-9])(?:ghp_[a-zA-Z0-9]{36})/,
  /(?:^|[^a-zA-Z0-9])(?:AKIA[A-Z0-9]{16})/,
  /(?:^|[^a-zA-Z0-9])(?:AIza[a-zA-Z0-9_-]{35})/,
  /(?:password|secret|token|api_key)\s*[:=]\s*["'][^"']{8,}["']/i,
];

export const secretScanner: HookHandler = {
  name: "SecretScanner",
  event: "PreToolUse",
  profile: "minimal",
  handler(payload: HookPayload): HookResult {
    if (!payload.content) return { action: "allow" };
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(payload.content)) {
        return {
          action: "block",
          message: "Potential secret/credential detected. Remove before committing.",
        };
      }
    }
    return { action: "allow" };
  },
};

// ── Destructive Guard (minimal) ─────────────────────────────

const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  // File removal — all recursive variants, with or without -f
  /\brm\s+-[a-z]*r[a-z]*\b/, // rm -r, rm -rf, rm -rfi, rm -fr, etc.
  /\bsudo\s+rm\b/,
  // Content wipes that aren't full deletions
  /\btruncate\s+-s\s*0\b/,
  /\bshred\b/,
  /\bdd\s+if=/, // common format-zero-drive pattern (dd if=/dev/zero of=…)
  /\s>\s*\/(etc|boot|dev|sys|proc|bin|sbin|lib|var)\b/, // shell redirect clobbering system paths
  /\s>\s*~\/\.(ssh|aws|kube|config\/gcloud|docker)\b/, // shell redirect clobbering user creds
  // Git history-rewriting patterns
  /\bgit\s+push\s+-[a-z]*f[a-z]*\b/, // push -f, push --force, push -fu, etc.
  /\bgit\s+push\s+--force/,
  /\bgit\s+reset\s+--(hard|mixed)\b/,
  /\bgit\s+clean\s+-[a-z]*[fd][a-z]*\b/, // clean -fd, -xdf, etc.
  /\bgit\s+branch\s+-D\b/,
  /\bgit\s+checkout\s+\.\b/,
  /\bgit\s+restore\s+\.\b/,
  // Database
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\s+\w+\s*(?:;|$)/i, // DELETE FROM without WHERE
  // Orchestration
  /\bkubectl\s+delete\b/,
  /\bdocker\s+(system|image|volume)\s+prune\s+-[a-z]*a[a-z]*\b/, // docker system prune -af
  /\bdocker\s+rm\s+-[a-z]*f[a-z]*\b/, // docker rm -f
  /\bhelm\s+(delete|uninstall)\s+--purge\b/,
  // System
  /\bmkfs\.[a-z0-9]+\b/, // filesystem format
  /\bformat\s+[a-z]:/i, // windows format
  /\bdiskutil\s+erase\w+\b/i,
];

export const destructiveGuard: HookHandler = {
  name: "DestructiveGuard",
  event: "PreToolUse",
  profile: "minimal",
  handler(payload: HookPayload): HookResult {
    if (payload.toolName !== "Bash") return { action: "allow" };
    // Opt-in escape: the prior commit's block message advertised this env
    // var but never actually read it, so the "override" was documentation-
    // only. Now the env var really does allow the command through while
    // still emitting a warning that surfaces in the hook warnings list.
    const overrideActive = process.env["WOTANN_ALLOW_DESTRUCTIVE"] === "1";
    const command = payload.content ?? JSON.stringify(payload.toolInput);
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        if (overrideActive) {
          return {
            action: "warn",
            message: `Destructive pattern allowed via WOTANN_ALLOW_DESTRUCTIVE=1: ${pattern.source}`,
          };
        }
        // S2-14: upgrade from warn → block. The audit flagged this as
        // the #1 fake guarantee — "rm -rf /" used to sail through with
        // only a log message. Destructive commands now actually halt
        // unless the user has opted into an override (see `careful`
        // profile in CLAUDE.md / settings.json).
        return {
          action: "block",
          message: `Destructive command blocked: ${pattern.source}. Override with WOTANN_ALLOW_DESTRUCTIVE=1 if intentional.`,
        };
      }
    }
    return { action: "allow" };
  },
};

// ── Cost Limiter (standard) ─────────────────────────────────

export function createCostLimiter(budgetUsd: number): HookHandler {
  let totalCost = 0;
  return {
    name: "CostLimiter",
    event: "PostToolUse",
    profile: "standard",
    handler(payload: HookPayload): HookResult {
      const cost = (payload.toolInput as Record<string, unknown> | undefined)?.["cost"];
      if (typeof cost === "number") {
        totalCost += cost;
        if (totalCost >= budgetUsd) {
          return {
            action: "block",
            message: `Budget exceeded: $${totalCost.toFixed(2)} / $${budgetUsd.toFixed(2)}`,
          };
        }
      }
      return { action: "allow" };
    },
  };
}

// ── Loop Detection (standard) — 5-layer ─────────────────────

export function createLoopDetector(warnAt: number = 3, blockAt: number = 5): HookHandler {
  const history: string[] = [];
  return {
    name: "LoopDetection",
    event: "PreToolUse",
    profile: "standard",
    handler(payload: HookPayload): HookResult {
      const signature = `${payload.toolName}:${JSON.stringify(payload.toolInput)}`;
      history.push(signature);
      let count = 0;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i] === signature) count++;
        else break;
      }
      if (count >= blockAt) {
        return {
          action: "block",
          message: `Loop detected: ${payload.toolName} called ${count} times identically. Try a different approach.`,
        };
      }
      if (count >= warnAt) {
        return {
          action: "warn",
          message: `Possible loop: ${payload.toolName} called ${count} times identically.`,
        };
      }
      return { action: "allow" };
    },
  };
}

// ── Frustration Detection (standard) — delegates to 21-pattern detector ──

export const frustrationDetector: HookHandler = {
  name: "FrustrationDetection",
  event: "UserPromptSubmit",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    const message = payload.content ?? "";
    const result = detectFrustration(message);
    if (result.detected) {
      return {
        action: "warn",
        message: `Frustration detected (${result.patterns.join(", ")}). Adjusting tone to be more helpful and acknowledging the issue.`,
      };
    }
    return { action: "allow" };
  },
};

// ── Config Protection (standard) ────────────────────────────

// Patterns kept in sync with autoLint's LINTER_CONFIGS — agent-4 audit
// caught that `eslint.config.(js|mjs|cjs|ts)` (ESLint 9 flat config) was
// missing here even though autoLint correctly listed them; this repo's
// own `eslint.config.js` from commit 81700d2 was silently unprotected.
const PROTECTED_FILES: readonly RegExp[] = [
  /\.eslintrc/,
  /eslint\.config\.(?:js|mjs|cjs|ts)$/,
  /\.prettierrc/,
  /prettier\.config\.(?:js|mjs|cjs|ts)$/,
  /biome\.json/,
  /\.editorconfig/,
  /tsconfig\.json$/,
  /tsconfig\.[a-zA-Z0-9-]+\.json$/,
  /vitest\.config\.(?:js|mjs|cjs|ts)$/,
  /package\.json$/,
];

export const configProtection: HookHandler = {
  name: "ConfigProtection",
  event: "PreToolUse",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    if (!["Write", "Edit"].includes(payload.toolName ?? "")) return { action: "allow" };
    const filePath = payload.filePath ?? "";
    for (const pattern of PROTECTED_FILES) {
      if (pattern.test(filePath)) {
        return {
          action: "warn",
          message: `Modifying config file: ${filePath}. Ensure this is intentional.`,
        };
      }
    }
    return { action: "allow" };
  },
};

// ── Pre-Compact WAL Flush (standard) — saves state before compaction ──
//
// S2-15: Previously these three hooks returned decorative messages
// without touching disk (MASTER_AUDIT §6 called them "hollow no-ops").
// Now they write/read real WAL files under ~/.wotann/wal/ so context
// actually survives compaction and session boundaries. The handlers
// are still synchronous — filesystem work is best-effort and never
// blocks the pipeline.

function walDir(): string {
  const dir = join(homedir(), ".wotann", "wal");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* best effort — if we can't write WAL we still return allow */
    }
  }
  return dir;
}

function walMarkerPath(sessionId: string | undefined): string {
  // Constrain the sessionId used in the filename to avoid traversal
  // when hook payloads carry untrusted IDs.
  const safe = (sessionId ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(walDir(), `${safe}.json`);
}

export const preCompactFlush: HookHandler = {
  name: "PreCompactWALFlush",
  event: "PreCompact",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    try {
      const state = {
        sessionId: payload.sessionId ?? "unknown",
        timestamp: new Date().toISOString(),
        // Persist the most recent content the hook payload carries so
        // a post-compact recovery can thread context back into the prompt.
        tailContent: (payload.content ?? "").slice(0, 8000),
        toolName: payload.toolName ?? null,
      };
      writeFileSync(walMarkerPath(payload.sessionId), JSON.stringify(state, null, 2), "utf-8");
      return { action: "allow", message: `WAL flushed for session ${state.sessionId}` };
    } catch (err) {
      // Non-fatal — allow the compaction to proceed even if disk write fails.
      return {
        action: "warn",
        message: `WAL flush failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  },
};

// ── Session Summary (standard) — auto-summarize on stop ─────

function sessionLogPath(sessionId: string | undefined): string {
  const safe = (sessionId ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  const logDir = join(homedir(), ".wotann", "sessions");
  if (!existsSync(logDir)) {
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {
      /* best effort */
    }
  }
  return join(logDir, `${safe}.log`);
}

export const sessionSummary: HookHandler = {
  name: "SessionSummary",
  event: "Stop",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    try {
      const line = JSON.stringify({
        sessionId: payload.sessionId ?? "unknown",
        stoppedAt: new Date().toISOString(),
        lastContentLen: (payload.content ?? "").length,
      });
      appendFileSync(sessionLogPath(payload.sessionId), line + "\n", "utf-8");
      return {
        action: "allow",
        message: `Session summary appended for ${payload.sessionId ?? "unknown"}`,
      };
    } catch (err) {
      return {
        action: "warn",
        message: `Session summary failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  },
};

// ── Memory Recovery (standard) — recover memory on session start ──

export const memoryRecovery: HookHandler = {
  name: "MemoryRecovery",
  event: "SessionStart",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    try {
      const markerPath = walMarkerPath(payload.sessionId);
      if (!existsSync(markerPath)) {
        return { action: "allow", message: "No prior WAL marker — starting fresh." };
      }
      const raw = readFileSync(markerPath, "utf-8");
      const marker = JSON.parse(raw) as { timestamp?: string; tailContent?: string };
      const tail = marker.tailContent ?? "";
      const when = marker.timestamp ?? "unknown time";
      // Thread the recovered content back into the agent's next prompt
      // via HookResult.contextPrefix. Runtime captures this on
      // SessionStart and prepends to the first user prompt — closes the
      // "MemoryRecovery is cosmetic" gap from the Opus audit.
      const contextPrefix = tail
        ? `[Memory recovered from prior session at ${when}]\n${tail}\n\n---\n\n`
        : undefined;
      return {
        action: "allow",
        message: `Memory recovery: loaded WAL marker from ${when} (${tail.length} chars)${contextPrefix ? " — injecting into next turn" : ""}`,
        contextPrefix,
      };
    } catch (err) {
      return {
        action: "warn",
        message: `Memory recovery failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  },
};

// ── Prompt Injection Guard (standard) — scan agent files for injection ──

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+a/i,
  /system\s*:\s*override/i,
  /<\/?system[-_]?prompt>/i,
];

export const promptInjectionGuard: HookHandler = {
  name: "PromptInjectionGuard",
  event: "PreToolUse",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    if (payload.toolName !== "Write") return { action: "allow" };
    const content = payload.content ?? "";
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        return {
          action: "block",
          message: `Potential prompt injection detected in file content: ${pattern.source}`,
        };
      }
    }
    return { action: "allow" };
  },
};

// ── Correction Capture (standard) ───────────────────────────

const CORRECTION_PATTERNS: readonly RegExp[] = [
  /\bno,?\s*(that's|you)\b/i,
  /\bnot what I\b/i,
  /\bwrong\b/i,
  /\bdon't do\b/i,
  /\bstop\b/i,
  /\binstead\b/i,
  /\bactually\b/i,
];

export const correctionCapture: HookHandler = {
  name: "CorrectionCapture",
  event: "UserPromptSubmit",
  profile: "standard",
  async handler(payload: HookPayload): Promise<HookResult> {
    const message = payload.content ?? "";

    // Use the real autoDream classification (not just regex patterns)
    let classifyFeedback: ((msg: string) => { type: string; confidence: number }) | undefined;
    try {
      // Dynamic import to avoid circular dependencies
      const autodream = (await import("../learning/autodream.js")) as {
        classifyFeedback: (msg: string) => { type: string; confidence: number };
      };
      classifyFeedback = autodream.classifyFeedback;
    } catch {
      /* autodream not available */
    }

    if (classifyFeedback) {
      const result = classifyFeedback(message);
      if (result.type === "correction" && result.confidence > 0.5) {
        return {
          action: "warn",
          message: `Correction detected (${(result.confidence * 100).toFixed(0)}%): "${message.slice(0, 80)}". Queued for learning.`,
        };
      }
      if (result.type === "confirmation" && result.confidence > 0.6) {
        return {
          action: "warn",
          message: `Approach confirmed: "${message.slice(0, 80)}". Saved as validated pattern.`,
        };
      }
    } else {
      // Fallback to simple regex patterns
      const isCorrection = CORRECTION_PATTERNS.some((p) => p.test(message));
      if (isCorrection) {
        return {
          action: "warn",
          message: `Correction detected: "${message.slice(0, 80)}". Queued for learning.`,
        };
      }
    }

    return { action: "allow" };
  },
};

// ── Read-Before-Edit Guard (standard) — must read a file before editing ──
//
// Opus audit (2026-04-15) found the tracking was a module-global `Set<string>`
// — Read calls from session A would allow Edits in session B, and the set
// grew unbounded across the daemon's lifetime. Now the tracking is keyed by
// sessionId so each session starts fresh, and each session's set is bounded
// by a MAX_TRACKED constant to prevent runaway growth on long-running
// daemons. Evicted entries cause a re-Read requirement — acceptable
// safety-over-performance tradeoff.

const readTrackingBySession = new Map<string, Set<string>>();
const MAX_TRACKED_READS_PER_SESSION = 512;

function trackRead(sessionId: string, filePath: string): void {
  let set = readTrackingBySession.get(sessionId);
  if (!set) {
    set = new Set();
    readTrackingBySession.set(sessionId, set);
  }
  // Bound per-session set. Simple FIFO eviction: if over cap, clear oldest
  // half. The agent simply re-Reads if the file gets evicted, which is a
  // correct safety behavior.
  if (set.size >= MAX_TRACKED_READS_PER_SESSION) {
    const keep = Array.from(set).slice(-Math.floor(MAX_TRACKED_READS_PER_SESSION / 2));
    set.clear();
    for (const k of keep) set.add(k);
  }
  set.add(filePath);
}

function hasReadInSession(sessionId: string, filePath: string): boolean {
  return readTrackingBySession.get(sessionId)?.has(filePath) ?? false;
}

/** Release the per-session tracking set when a session ends — prevents map growth. */
export function clearReadTrackingForSession(sessionId: string): void {
  readTrackingBySession.delete(sessionId);
}

export const readBeforeEditGuard: HookHandler = {
  name: "ReadBeforeEdit",
  event: "PreToolUse",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    const sessionId = payload.sessionId ?? "global";
    if (payload.toolName === "Read" && payload.filePath) {
      trackRead(sessionId, payload.filePath);
      return { action: "allow" };
    }
    if (payload.toolName === "Edit" && payload.filePath) {
      if (!hasReadInSession(sessionId, payload.filePath)) {
        // S2-14: upgrade from warn → block. The Edit tool's own
        // precondition is "must have Read the file in this conversation";
        // previously this hook merely warned so the edit proceeded
        // anyway. Blocking here is the correct enforcement — the agent
        // should Read first, and the unblock path is trivial.
        return {
          action: "block",
          message: `Edit blocked: read ${payload.filePath} first so the Edit tool has the current content.`,
        };
      }
    }
    return { action: "allow" };
  },
};

// ── Completion Verifier (strict) — blocks stop without evidence ──
//
// Opus audit (2026-04-15) found the prior regex was trivially gameable:
// the literal word "pass" or a "✓" anywhere in the final message bypassed
// the check. That made strict-profile Stop verification decorative.
// The new evidence bar requires EITHER:
//   (a) a structured JSON block `{"verified": {"tests": ..., "typecheck": ..., "lint": ...}}`
//       that claims at least one verification step actually ran, OR
//   (b) explicit terminal-output markers that are hard to forge casually —
//       a test summary line AND a passing status marker AND a count.

const STRUCTURED_EVIDENCE_REGEX =
  /"verified"\s*:\s*\{[^}]*"(?:tests|typecheck|lint)"\s*:\s*(?:true|\d+)/i;
// A test summary needs (Vitest/Jest/Mocha/pytest/go-test pattern):
// - "passed" / "pass" token (case-insensitive, word-boundary)
// - AND a count of tests OR a "0 failed" marker
const TEST_SUMMARY_EVIDENCE = [
  /\b(\d+)\s+(?:tests?|passed|passing)\b/i, // "50 tests", "50 passed", "3 passing"
  /\b(?:passed|passing|ok|success|green)\b/i,
];
const TYPECHECK_EVIDENCE = [
  /\btsc\b|\btypecheck\b|\btype[- ]check\b/i,
  /\b0\s+errors?\b|\bclean\b|\bno\s+errors?\b/i,
];
const BUILD_EVIDENCE = [
  /\b(?:build|compile|bundle)\b/i,
  /\b(?:success|succeeded|passed|complete)\b/i,
];
const LINT_EVIDENCE = [
  /\b(?:lint|eslint|prettier|biome)\b/i,
  /\b(?:clean|0\s+(?:issues|warnings)|no\s+warnings?)\b/i,
];

function hasStructuredEvidence(content: string): boolean {
  return STRUCTURED_EVIDENCE_REGEX.test(content);
}

function hasPairedEvidence(content: string, pair: readonly RegExp[]): boolean {
  return pair.every((regex) => regex.test(content));
}

export const completionVerifier: HookHandler = {
  name: "CompletionVerifier",
  event: "Stop",
  profile: "strict",
  handler(payload: HookPayload): HookResult {
    const content = payload.content ?? "";
    if (content.length === 0) return { action: "allow" };

    if (hasStructuredEvidence(content)) return { action: "allow" };

    // At least one verification category must have BOTH the tool keyword
    // AND a success indicator — this is the "paired evidence" bar. A
    // single "pass" or "✓" no longer bypasses.
    const categoryPassed =
      hasPairedEvidence(content, TEST_SUMMARY_EVIDENCE) ||
      hasPairedEvidence(content, TYPECHECK_EVIDENCE) ||
      hasPairedEvidence(content, BUILD_EVIDENCE) ||
      hasPairedEvidence(content, LINT_EVIDENCE);

    if (!categoryPassed) {
      return {
        action: "block",
        message:
          "Stop blocked: no evidence of verification in the final message. " +
          'Include a test summary ("N passed"), typecheck output ("0 errors"), build result, ' +
          'or lint status. Single words like "pass" or "✓" are not sufficient — pair them ' +
          "with a tool name (tsc/tests/lint/build) and a count or clean marker. " +
          'Override: include a JSON block like `{"verified": {"tests": true}}`.',
      };
    }
    return { action: "allow" };
  },
};

// ── TDD Enforcement (strict) — blocks impl before tests exist ──

export const tddEnforcement: HookHandler = {
  name: "TDDEnforcement",
  event: "PreToolUse",
  profile: "strict",
  handler(payload: HookPayload): HookResult {
    if (payload.toolName !== "Write" || !payload.filePath) return { action: "allow" };

    // Skip if writing a test file
    if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(payload.filePath)) return { action: "allow" };

    // Check if a corresponding test file exists. Session-4 audit (Opus
    // Agent 1) flagged that prior logic only checked adjacent sibling
    // files (`foo.test.ts` next to `foo.ts`) and `__tests__/` folders —
    // but this repo (and most modern monorepos) uses a mirrored
    // `tests/` root. On the strict profile, every new production-file
    // Write was falsely blocked. The fix broadens the search to the
    // mirror path (`src/foo/bar.ts` → `tests/foo/bar.test.ts`).
    const dir = dirname(payload.filePath);
    const base = payload.filePath.replace(/\.(ts|js|tsx|jsx)$/, "");
    const filename =
      payload.filePath
        .split("/")
        .pop()
        ?.replace(/\.(ts|js|tsx|jsx)$/, "") ?? "";
    const mirroredPath = payload.filePath.startsWith("src/")
      ? `tests/${payload.filePath.slice(4).replace(/\.(ts|js|tsx|jsx)$/, ".test.ts")}`
      : null;
    const testExists =
      existsSync(`${base}.test.ts`) ||
      existsSync(`${base}.spec.ts`) ||
      existsSync(join(dir, "__tests__", `${filename}.test.ts`)) ||
      existsSync(join(dir, "__tests__", `${filename}.spec.ts`)) ||
      (mirroredPath !== null && existsSync(mirroredPath)) ||
      (mirroredPath !== null && existsSync(mirroredPath.replace(".test.", ".spec.")));

    if (!testExists) {
      // S2-14: upgrade from warn → block on the strict profile. TDD
      // enforcement means: write the test first, then the implementation.
      // The warn return meant the write proceeded anyway, defeating the
      // purpose. Override by creating the test file first (Write gets
      // allowed because the file path matches `.test.ts$`).
      return {
        action: "block",
        message:
          `Write blocked (TDD): no test found for ${payload.filePath}. ` +
          `Create ${base}.test.ts (or the corresponding .spec.ts) first.`,
      };
    }
    return { action: "allow" };
  },
};

// ── Auto-Lint Hook (standard) — run linter after Write/Edit if project has one ──

const LINTER_CONFIGS: readonly { readonly file: string; readonly name: string }[] = [
  { file: "biome.json", name: "biome" },
  { file: "biome.jsonc", name: "biome" },
  { file: ".eslintrc", name: "eslint" },
  { file: ".eslintrc.js", name: "eslint" },
  { file: ".eslintrc.json", name: "eslint" },
  { file: ".eslintrc.cjs", name: "eslint" },
  { file: "eslint.config.js", name: "eslint" },
  { file: "eslint.config.mjs", name: "eslint" },
  { file: ".prettierrc", name: "prettier" },
  { file: ".prettierrc.json", name: "prettier" },
  { file: "prettier.config.js", name: "prettier" },
];

/** Cache detected linter per working directory to avoid repeated fs lookups. */
const linterCache = new Map<string, string | null>();

function detectLinterForDir(dir: string): string | null {
  const cached = linterCache.get(dir);
  if (cached !== undefined) return cached;

  for (const config of LINTER_CONFIGS) {
    if (existsSync(join(dir, config.file))) {
      linterCache.set(dir, config.name);
      return config.name;
    }
  }
  linterCache.set(dir, null);
  return null;
}

export const autoLint: HookHandler = {
  name: "AutoLint",
  event: "PostToolUse",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    if (!["Write", "Edit"].includes(payload.toolName ?? "")) return { action: "allow" };
    const filePath = payload.filePath ?? "";
    if (!filePath) return { action: "allow" };

    // Only lint source files, not configs or generated files
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss)$/.test(filePath)) return { action: "allow" };

    const dir = dirname(filePath);
    const linter = detectLinterForDir(dir);
    if (!linter) return { action: "allow" };

    return {
      action: "warn",
      message: `AutoLint: ${linter} detected. Run linter on ${filePath.split("/").pop() ?? filePath} after editing.`,
    };
  },
};

// ── Cache Monitor (standard) — track prompt cache hit rates ─────

export function createCacheMonitor(): HookHandler {
  let totalRequests = 0;
  let cacheHits = 0;

  return {
    name: "CacheMonitor",
    event: "PostToolUse",
    profile: "standard",
    handler(payload: HookPayload): HookResult {
      // Track cache statistics from tool responses that report caching
      const input = payload.toolInput as Record<string, unknown> | undefined;
      if (!input) return { action: "allow" };

      const cacheStatus = input["cacheStatus"] ?? input["cache_status"];
      if (typeof cacheStatus === "string") {
        totalRequests++;
        if (cacheStatus === "hit") {
          cacheHits++;
        }

        // Warn periodically about low cache hit rates (every 20 requests)
        if (totalRequests > 0 && totalRequests % 20 === 0) {
          const hitRate = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;
          if (hitRate < 30) {
            return {
              action: "warn",
              message: `CacheMonitor: Low cache hit rate: ${hitRate.toFixed(1)}% (${cacheHits}/${totalRequests}). Consider restructuring prompts for better cacheability.`,
            };
          }
        }
      }

      return { action: "allow" };
    },
  };
}

// ── Auto-Test Hook (standard) — suggest running tests after file edits ──

export const autoTestSuggestion: HookHandler = {
  name: "AutoTestSuggestion",
  event: "PostToolUse",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    if (!["Write", "Edit"].includes(payload.toolName ?? "")) return { action: "allow" };
    const filePath = payload.filePath ?? "";
    if (!filePath) return { action: "allow" };

    // Skip if this IS a test file
    if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(filePath)) return { action: "allow" };

    // Only check source files
    if (!/\.(ts|js|tsx|jsx)$/.test(filePath)) return { action: "allow" };

    // Derive potential test file paths
    const base = filePath.replace(/\.(ts|js|tsx|jsx)$/, "");
    const ext = filePath.match(/\.(ts|js|tsx|jsx)$/)?.[0] ?? ".ts";
    const dir = dirname(filePath);
    const fileName = filePath.split("/").pop() ?? "";
    const testBase = fileName.replace(/\.(ts|js|tsx|jsx)$/, "");

    const candidates = [
      `${base}.test${ext}`,
      `${base}.spec${ext}`,
      join(dir, "__tests__", `${testBase}.test${ext}`),
      join(dir, "__tests__", `${testBase}.spec${ext}`),
      filePath.replace(/\/src\//, "/tests/").replace(/\.(ts|js|tsx|jsx)$/, `.test${ext}`),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return {
          action: "warn",
          message: `AutoTest: Test file found at ${candidate.split("/").pop()}. Consider running tests to verify your changes.`,
        };
      }
    }

    return { action: "allow" };
  },
};

// ── Pre-Tool Cost Limiter (standard) — block when session budget exceeded ──

export function createPreToolCostLimiter(budgetUsd?: number): HookHandler {
  const budget = budgetUsd ?? 50;
  return {
    name: "PreToolCostLimiter",
    event: "PreToolUse",
    profile: "standard",
    handler(payload: HookPayload): HookResult {
      const input = payload.toolInput as Record<string, unknown> | undefined;
      const sessionCost = input?.["sessionCost"] ?? input?.["session_cost"];
      if (typeof sessionCost === "number" && sessionCost > budget) {
        return {
          action: "block",
          message: `Session cost $${sessionCost.toFixed(2)} exceeds budget of $${budget.toFixed(2)}. Stop and review spending.`,
        };
      }
      return { action: "allow" };
    },
  };
}

// ── Git Checkpoint Hook (standard) — shadow-git checkpoint after file edits ──

export function createGitCheckpointHook(
  shared?: InstanceType<typeof ShadowGitClass> | string,
): HookHandler {
  // `shared` can be either the runtime's existing ShadowGit singleton or a
  // working-directory string (the legacy signature). Using the singleton
  // keeps the in-memory recentCheckpoints ring buffer consistent with the
  // shadow.undo / shadow.checkpoints RPC path, so the auto-checkpoint
  // chain is observable end-to-end. Fresh-instance creation remains the
  // no-runtime fallback for standalone test harnesses.
  let shadowGit: InstanceType<typeof ShadowGitClass> | undefined =
    typeof shared === "object" ? shared : undefined;
  const workDir = typeof shared === "string" ? shared : undefined;

  return {
    name: "GitCheckpoint",
    event: "PostToolUse",
    profile: "standard",
    async handler(payload: HookPayload): Promise<HookResult> {
      if (!["Write", "Edit"].includes(payload.toolName ?? "")) return { action: "allow" };
      const filePath = payload.filePath ?? "";
      if (!filePath) return { action: "allow" };

      try {
        if (!shadowGit) {
          const dir = workDir ?? process.cwd();
          shadowGit = new ShadowGitClass(dir);
        }
        const label = `auto: ${payload.toolName} ${filePath.split("/").pop() ?? filePath}`;
        const hash = await shadowGit.createCheckpoint(label);
        if (hash) {
          return { action: "allow", message: `GitCheckpoint: ${hash.slice(0, 8)} — ${label}` };
        }
      } catch {
        // Shadow git failures should never block the agent
      }

      return { action: "allow" };
    },
  };
}

// ── Git Pre-Checkpoint Hook (standard) — S3-3 auto-snapshot BEFORE mutating ──
//
// The PostToolUse GitCheckpoint above snapshots AFTER the tool has already run
// — which captures the new state but not a recoverable rollback point. S3-3
// added ShadowGit.beforeTool() to snapshot BEFORE mutating tools (Write, Edit,
// NotebookEdit, MultiEdit, HashlineEdit) and recorded each snapshot in a
// ring-buffer that restoreLastBefore(toolName) can use for rollback. However,
// the Opus audit found ShadowGit.beforeTool, markStable, restoreLastBefore,
// and getRecentCheckpoints had ZERO callsites — the entire S3-3 API was dead.
// Registering this hook on the newly-live PreToolUse event makes the S3-3
// rollback capability real.
export function createGitPreCheckpointHook(
  shared?: InstanceType<typeof ShadowGitClass> | string,
): HookHandler {
  // Shared ShadowGit singleton (preferred) so the ring-buffer populated by
  // `beforeTool` here is the same buffer that shadow.undo / shadow.checkpoints
  // read via runtime.getShadowGit(). Without this the RPC handlers always
  // saw empty checkpoints and restoreLastBefore silently returned false —
  // end-to-end rollback was broken despite the individual APIs working.
  let shadowGit: InstanceType<typeof ShadowGitClass> | undefined =
    typeof shared === "object" ? shared : undefined;
  const workDir = typeof shared === "string" ? shared : undefined;

  return {
    name: "GitPreCheckpoint",
    event: "PreToolUse",
    profile: "standard",
    async handler(payload: HookPayload): Promise<HookResult> {
      const toolName = payload.toolName ?? "";
      try {
        if (!shadowGit) {
          const dir = workDir ?? process.cwd();
          shadowGit = new ShadowGitClass(dir);
        }
        const context =
          (payload.filePath as string | undefined) ??
          (payload.toolInput ? JSON.stringify(payload.toolInput).slice(0, 120) : undefined);
        const hash = await shadowGit.beforeTool(toolName, context);
        if (hash) {
          return {
            action: "allow",
            message: `GitPreCheckpoint: ${hash.slice(0, 8)} (pre-${toolName})`,
          };
        }
      } catch {
        // Shadow git failures should never block the agent — allow through.
      }
      return { action: "allow" };
    },
  };
}

// ── Correction Capture (simple) (standard) — detect user corrections via pattern matching ──

const SIMPLE_CORRECTION_PATTERNS: readonly RegExp[] = [
  /^\s*no\b/i,
  /\bwrong\b/i,
  /\bdon'?t\b/i,
  /\bstop\b/i,
  /\bactually\b/i,
  /\binstead\b/i,
  /\bnot what I\b/i,
  /\bthat'?s not\b/i,
  /\bincorrect\b/i,
  /\bundo\b/i,
];

export const simpleCorrectionCapture: HookHandler = {
  name: "SimpleCorrectionCapture",
  event: "UserPromptSubmit",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    const message = payload.content ?? "";
    if (!message) return { action: "allow" };

    const matched = SIMPLE_CORRECTION_PATTERNS.filter((p) => p.test(message));
    if (matched.length > 0) {
      return {
        action: "warn",
        message: `Correction captured: "${message.slice(0, 100)}". Queued for learning system.`,
      };
    }

    return { action: "allow" };
  },
};

// ── Prompt Injection Scanner (standard) — scan tool RESULTS for injection patterns ──

const RESULT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\b/i,
  /system\s*:\s*override/i,
  /\bnew\s+instructions?\s*:/i,
  /forget\s+(all\s+)?(your|prior|previous)\b/i,
  /disregard\s+(all\s+)?(previous|prior|above)\b/i,
  /<\/?system[-_]?prompt>/i,
  /\bact\s+as\s+(if|though)\s+you\s+are\b/i,
];

export const resultInjectionScanner: HookHandler = {
  name: "ResultInjectionScanner",
  // Session-5 architectural fix: ToolResultReceived fires on the raw
  // tool_result chunk BEFORE the agent response text is assembled, so
  // the scanner can block/sanitise before the model sees the injection.
  // PostToolUse was the wrong layer — by the time it ran, the result
  // had already entered the next-turn context.
  event: "ToolResultReceived",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    const content = payload.content ?? "";
    if (!content) return { action: "allow" };

    const matches: string[] = [];
    for (const pattern of RESULT_INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        matches.push(pattern.source);
      }
    }

    if (matches.length > 0) {
      // S2-14: upgrade from warn → block. A PostToolUse return of "warn"
      // still passes the tool output to the model, which is exactly the
      // window the injection attack exploits. Blocking replaces the
      // result with our error message and forces the agent to treat the
      // content as suspect rather than as instructions from the user.
      return {
        action: "block",
        message:
          `Tool result blocked by prompt-injection scanner — ${matches.length} ` +
          `pattern${matches.length > 1 ? "s" : ""} matched (${matches.slice(0, 3).join(", ")}). ` +
          `The tool output appears to contain instructions trying to override the system prompt. ` +
          `Investigate the source before acting on the content.`,
      };
    }

    return { action: "allow" };
  },
};

// ── Tool Call/Result Pair Validator (standard) — validates tool_use/tool_result consistency ──

/**
 * Tracks tool calls and validates that results match expectations:
 * - tool_use has matching tool_result
 * - Required output fields are present (not null/undefined)
 * - File paths referenced in results exist on disk
 * Warns on mismatches without blocking execution.
 */
export function createToolPairValidator(): HookHandler {
  const pendingCalls = new Map<
    string,
    { toolName: string; filePath?: string; timestamp: number }
  >();

  return {
    name: "ToolPairValidator",
    event: "PostToolUse",
    profile: "standard",
    handler(payload: HookPayload): HookResult {
      const toolName = payload.toolName ?? "unknown";
      const callId = `${toolName}:${payload.timestamp ?? Date.now()}`;
      const warnings: string[] = [];

      // Track the call for pairing
      if (payload.filePath) {
        pendingCalls.set(callId, {
          toolName,
          filePath: payload.filePath,
          timestamp: payload.timestamp ?? Date.now(),
        });
      }

      // Check 1: Validate that tool result content is present (not null/undefined)
      const resultContent = payload.content;
      if (resultContent === null || resultContent === undefined) {
        warnings.push(`Tool ${toolName} returned null/undefined result content`);
      }

      // Check 2: Validate required output fields based on tool type
      const toolInput = payload.toolInput as Record<string, unknown> | undefined;
      if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
        if (!payload.filePath && !toolInput?.["file_path"] && !toolInput?.["filePath"]) {
          warnings.push(`Tool ${toolName} result missing required file_path field`);
        }
      }

      // Check 3: Validate file paths in results exist on disk
      const filePath =
        payload.filePath ??
        (toolInput?.["file_path"] as string | undefined) ??
        (toolInput?.["filePath"] as string | undefined);
      if (filePath && typeof filePath === "string" && filePath.startsWith("/")) {
        if (!existsSync(filePath)) {
          warnings.push(`File path in ${toolName} result does not exist: ${filePath}`);
        }
      }

      // Clean up stale pending calls (older than 5 minutes)
      const now = Date.now();
      for (const [id, call] of pendingCalls) {
        if (now - call.timestamp > 300_000) {
          pendingCalls.delete(id);
        }
      }

      if (warnings.length > 0) {
        return {
          action: "warn",
          message: `ToolPairValidator: ${warnings.join("; ")}`,
        };
      }

      return { action: "allow" };
    },
  };
}

// ── Archive Preflight Guard (standard) — validate archives before extraction ──

const ARCHIVE_EXTENSIONS: readonly RegExp[] = [
  /\.zip$/i,
  /\.jar$/i,
  /\.war$/i,
  /\.tar$/i,
  /\.tar\.gz$/i,
  /\.tgz$/i,
  /\.tar\.bz2$/i,
  /\.tar\.xz$/i,
  /\.tar\.zst$/i,
];

const EXTRACT_TOOLS: readonly string[] = ["unzip", "tar", "extract", "decompress", "gunzip"];

export const archivePreflightGuard: HookHandler = {
  name: "ArchivePreflightGuard",
  event: "PreToolUse",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    // Check if the tool is extracting/unzipping files
    const toolName = payload.toolName ?? "";
    const command = payload.content ?? JSON.stringify(payload.toolInput ?? "");
    const filePath = payload.filePath ?? "";

    // Detect extraction operations
    const isExtractTool = EXTRACT_TOOLS.some((t) => command.toLowerCase().includes(t));
    if (!isExtractTool && toolName !== "Bash") return { action: "allow" };

    // Find archive file path in the command or file path
    const archivePath = filePath || extractArchivePath(command);
    if (!archivePath) return { action: "allow" };

    // Validate the archive
    const validation = validateArchive(archivePath);
    if (!validation.safe) {
      return {
        action: "block",
        message: `Archive preflight check FAILED for ${archivePath.split("/").pop() ?? archivePath}:\n${validation.issues.join("\n")}`,
      };
    }

    return { action: "allow" };
  },
};

function extractArchivePath(command: string): string | null {
  for (const ext of ARCHIVE_EXTENSIONS) {
    const match = command.match(new RegExp(`(\\S+${ext.source})`, "i"));
    if (match?.[1]) return match[1];
  }
  return null;
}

// ── Focus Mode Toggle (standard) — detects /focus command, tracks state ──

/**
 * Focus mode: strips display to prompt + 1-line tool summary + response.
 * Activated by /focus command, deactivated by /focus again.
 *
 * NOTE: This hook detects and tracks the toggle state. The actual display
 * stripping must be implemented in the UI layer (PromptInput.tsx / App.tsx)
 * by reading `isFocusModeActive()`. The hook system cannot directly control
 * TUI rendering, so this serves as the state source for the UI to consume.
 */
let focusModeEnabled = false;

export function isFocusModeActive(): boolean {
  return focusModeEnabled;
}

export const focusModeToggle: HookHandler = {
  name: "FocusModeToggle",
  event: "UserPromptSubmit",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    const message = (payload.content ?? "").trim().toLowerCase();
    if (message === "/focus") {
      focusModeEnabled = !focusModeEnabled;
      return {
        action: "modify",
        message: focusModeEnabled
          ? "Focus mode ON — display stripped to prompt + 1-line tool summary + response."
          : "Focus mode OFF — full display restored.",
        modifiedContent: "", // Consume the /focus command so it is not sent to the model
      };
    }
    return { action: "allow" };
  },
};

// ── MCP Auto-Approval (standard) — pre-approve tools listed in .wotann/mcp-approvals.json ──

export const mcpAutoApproval: HookHandler = {
  name: "MCPAutoApproval",
  event: "PreToolUse",
  profile: "standard",
  handler(payload: HookPayload): HookResult {
    const toolName = payload.toolName ?? "";
    if (!toolName) return { action: "allow" };

    try {
      const approvalsPath = join(process.cwd(), ".wotann", "mcp-approvals.json");
      if (existsSync(approvalsPath)) {
        const raw = readFileSync(approvalsPath, "utf-8");
        const approvals = JSON.parse(raw) as { approved?: readonly string[] };
        if (Array.isArray(approvals.approved) && approvals.approved.includes(toolName)) {
          return {
            action: "allow",
            message: `MCPAutoApproval: tool "${toolName}" is pre-approved.`,
          };
        }
      }
    } catch {
      /* ignore parse errors or missing file */
    }

    return { action: "allow" };
  },
};

// ── Register All Built-in Hooks ─────────────────────────────

import { HookEngine } from "./engine.js";
import { ShadowGit as ShadowGitClass } from "../utils/shadow-git.js";
import { validateArchive } from "../security/archive-preflight.js";

export function registerBuiltinHooks(
  engine: HookEngine,
  shadowGit?: InstanceType<typeof ShadowGitClass>,
): void {
  // Minimal profile (always active)
  engine.register(secretScanner);
  engine.register(destructiveGuard);

  // Standard profile
  engine.register(createCostLimiter(50));
  engine.register(createPreToolCostLimiter());
  engine.register(createLoopDetector());
  engine.register(frustrationDetector);
  engine.register(configProtection);
  engine.register(preCompactFlush);
  engine.register(sessionSummary);
  engine.register(memoryRecovery);
  engine.register(promptInjectionGuard);
  engine.register(correctionCapture);
  engine.register(simpleCorrectionCapture);
  engine.register(readBeforeEditGuard);
  engine.register(autoLint);
  engine.register(createCacheMonitor());
  engine.register(autoTestSuggestion);
  // Share the runtime's ShadowGit singleton so the pre/post checkpoint
  // hooks and the shadow.undo / shadow.checkpoints RPC surface all see
  // the same in-memory ring buffer (S3-3 end-to-end rollback).
  engine.register(createGitCheckpointHook(shadowGit));
  engine.register(createGitPreCheckpointHook(shadowGit));
  engine.register(resultInjectionScanner);
  engine.register(createToolPairValidator());
  engine.register(archivePreflightGuard);
  engine.register(focusModeToggle);
  engine.register(mcpAutoApproval);

  // Strict profile
  engine.register(completionVerifier);
  engine.register(tddEnforcement);
}
