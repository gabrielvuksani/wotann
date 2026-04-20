/**
 * Command Sanitizer — validate shell commands from iOS/desktop frontends
 * BEFORE executing them against the host system.
 *
 * This is layer 1 of defence-in-depth for shell execution:
 *   - Blocks catastrophic patterns outright (rm -rf /, dd if=/dev/zero, forkbomb)
 *   - Blocks pipe-to-shell payloads (curl | sh, wget | bash)
 *   - Blocks writes to system-sensitive files (/etc/passwd, /etc/shadow)
 *   - Blocks shell substitution (backtick, $(), process substitution)
 *   - Blocks heredoc delivery of hidden payloads
 *   - Blocks hex-escaped identifiers (e.g. \x72\x6d → "rm")
 *   - Requires allowlist approval for privileged commands (sudo, chmod 777, ...)
 *
 * The sanitizer returns a typed verdict { safe, reason, severity } so callers
 * can decide whether to execute, prompt the user, or reject.
 *
 * Layer 2 (audit log) and Layer 3 (sandbox/containment) live elsewhere.
 *
 * ── P0-9 parse-based upgrade (2026-04-20) ───────────────────
 * Prior revision matched forbidden patterns against the raw input string.
 * That allowed 7 empirically-confirmed bypasses where an adversarial
 * caller split tokens, encoded bytes, or wrapped the payload in shell
 * substitution so no substring regex matched. See
 * tests/security/command-sanitizer.test.ts for the full bypass corpus.
 *
 * This revision parses the input via `shell-quote` and inspects the
 * resulting token stream. Substitution operators (`<(`, `(`, `)`,
 * `` ` ``), heredoc operators (`<<`), and hex escapes are REJECTED
 * regardless of whether the post-parse tokens match a forbidden literal.
 * Substring matching against the raw input is kept as a secondary layer
 * — it catches additional shapes that the parser collapses (e.g. quoted
 * fork bombs) without weakening any prior assertion.
 */

import { parse as parseShell } from "shell-quote";

// ── Public API ─────────────────────────────────────────────

export type CommandSeverity = "safe" | "warn" | "danger";

export interface CommandVerdict {
  readonly safe: boolean;
  readonly reason?: string;
  readonly severity: CommandSeverity;
}

export interface SanitizerOptions {
  /**
   * When true, commands matching the allowlist-required list (sudo, chmod 777, ...)
   * are permitted. When false (default), they are blocked with a "requires
   * allowlist" reason. Set to true only in contexts where the user has
   * explicitly pre-approved privileged operations (e.g. in a freeze scope).
   */
  readonly allowPrivileged?: boolean;
}

// ── Dangerous patterns (always block) ─────────────────────

interface BlockedPattern {
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Catastrophic patterns — always block, no override. These represent commands
 * that have no legitimate use from an AI agent frontend (rm -rf /, dd of raw
 * device, fork bomb, pipe-to-shell from network sources).
 */
const BLOCKED_PATTERNS: readonly BlockedPattern[] = [
  // rm -rf on root or system paths
  {
    pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)[^\n]*?\s\/(?:\s|$)/,
    reason: "rm -rf on filesystem root",
  },
  {
    pattern:
      /\brm\s+(?:-[rRf]+|--recursive|--force)[^\n]*?\s\/(?:etc|bin|boot|sbin|usr|var|sys|root|proc)\b/,
    reason: "rm -rf on critical system path",
  },
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)\s+~\s*$/, reason: "rm -rf on home directory" },
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)[^\n]*?\s\$HOME\b/, reason: "rm -rf on $HOME" },
  {
    pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)[^\n]*?\s\*\s*$/,
    reason: "rm -rf with bare glob",
  },

  // dd to raw devices / zero-write
  {
    pattern: /\bdd\s+[^\n]*?if=\/dev\/(?:zero|random|urandom)\b[^\n]*?of=\/dev\//,
    reason: "dd from /dev/zero|random to raw device",
  },
  {
    pattern: /\bdd\s+[^\n]*?of=\/dev\/(?:sd[a-z]|hd[a-z]|nvme\d|disk\d)/,
    reason: "dd writing to raw block device",
  },

  // Fork bombs (bash :(){:|:&};: and common variants)
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: "bash fork bomb" },
  { pattern: /\bbomb\s*\(\s*\)\s*\{[^}]*\}\s*;\s*bomb\b/, reason: "fork bomb variant" },

  // Pipe-to-shell payloads (curl|sh, wget|bash, fetch|sh)
  {
    pattern:
      /\b(?:curl|wget|fetch)\s+[^\n|]*\|\s*(?:sh|bash|zsh|ksh|dash|fish|sudo\s+(?:sh|bash))\b/,
    reason: "pipe-to-shell from network",
  },
  {
    pattern: /\b(?:curl|wget)\s+[^\n|]*\|\s*sudo\s+-?\s*\w*\s*(?:sh|bash|zsh|ksh|dash|fish)\b/,
    reason: "pipe-to-sudo-shell from network",
  },

  // Writes to system-sensitive files via redirection
  { pattern: />>?\s*\/etc\/passwd\b/, reason: "write to /etc/passwd" },
  { pattern: />>?\s*\/etc\/shadow\b/, reason: "write to /etc/shadow" },
  { pattern: />>?\s*\/etc\/sudoers(?:\.d\/|\b)/, reason: "write to /etc/sudoers" },
  { pattern: />>?\s*\/etc\/hosts\b/, reason: "write to /etc/hosts" },

  // Obvious exfiltration patterns (cat /etc/shadow | nc)
  {
    pattern: /\bcat\s+\/etc\/(?:shadow|passwd)\b[^\n]*\|\s*(?:nc|netcat|curl|wget)\b/,
    reason: "exfiltration of password file",
  },

  // Reverse shells (common netcat variants)
  {
    pattern: /\b(?:nc|netcat|ncat)\s+[^\n]*-[^\n]*e\s+\/bin\/(?:sh|bash)\b/,
    reason: "reverse shell via netcat",
  },
  { pattern: /\bbash\s+-i\s+>&?\s*\/dev\/tcp\//, reason: "bash reverse shell" },

  // Recursive chmod on sensitive paths
  {
    pattern: /\bchmod\s+-R\s+[0-9]{3,4}\s+\/(?:\s|etc|bin|sbin|usr|var|boot|sys|root)\b/,
    reason: "recursive chmod on system path",
  },

  // Mass process kill
  { pattern: /\bkill\s+-9?\s+-1\b/, reason: "kill -1 (all processes)" },
  { pattern: /\bkillall\s+-9?\s*-u\s+root\b/, reason: "killall -u root" },
];

// ── Allowlist-required patterns (block unless explicitly allowed) ──────────

interface PrivilegedPattern {
  readonly pattern: RegExp;
  readonly reason: string;
}

const PRIVILEGED_PATTERNS: readonly PrivilegedPattern[] = [
  { pattern: /\bsudo\b/, reason: "sudo requires allowlist approval" },
  { pattern: /\bchmod\s+0?777\b/, reason: "chmod 777 requires allowlist approval" },
  { pattern: /\bchown\b/, reason: "chown requires allowlist approval" },
  { pattern: /\bmkfs(?:\.|\s)/, reason: "mkfs requires allowlist approval" },
  { pattern: /\bformat\s+[A-Z]:/i, reason: "format (Windows) requires allowlist approval" },
  {
    pattern: /\bdiskutil\s+(?:erase|unmountDisk|eraseDisk)\b/,
    reason: "diskutil erase requires allowlist approval",
  },
  {
    pattern: /\bhdiutil\s+eraseVolume\b/,
    reason: "hdiutil eraseVolume requires allowlist approval",
  },
];

// ── Warning patterns (allow but flag) ───────────────────────

interface WarnPattern {
  readonly pattern: RegExp;
  readonly reason: string;
}

const WARN_PATTERNS: readonly WarnPattern[] = [
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)\b/, reason: "recursive/forced delete" },
  {
    pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[fd]+|push\s+-f\b|push\s+--force)/,
    reason: "destructive git operation",
  },
  { pattern: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i, reason: "destructive SQL DDL" },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, reason: "SQL TRUNCATE" },
  {
    pattern: /\bexport\s+(?:PATH|LD_LIBRARY_PATH|DYLD_[A-Z_]+)=/,
    reason: "modifying library search path",
  },
];

// ── Forbidden command names (token-level, post-parse) ────────
//
// Commands whose mere presence as a parsed token is grounds for
// rejection. Unlike BLOCKED_PATTERNS these do not care about arg shape —
// if the frontend submits one of these, it has no business running.
// Keep this list conservative: only tokens that are destructive in
// virtually every invocation belong here.
const FORBIDDEN_TOKENS: ReadonlySet<string> = new Set([
  // Shell interpreters invoked as pipe sinks (curl | bash, echo | bash) —
  // any command whose shape ends in one of these behind a pipe is a
  // pipe-to-shell payload. See substitution check below.
]);

// Shell interpreters that, when used as the tail of a pipe, indicate a
// pipe-to-shell payload. Listed separately from FORBIDDEN_TOKENS because
// they are legitimate at the head of a script (`bash build.sh`), only
// dangerous at the tail.
const PIPE_SHELL_SINKS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "ksh",
  "dash",
  "fish",
  "csh",
  "tcsh",
]);

// ── Parse-based rejection helpers ──────────────────────────

interface ParseReject {
  readonly reason: string;
}

/**
 * Pre-parse string-level checks — look for shapes that shell-quote
 * collapses before we can inspect them. Each returns a reject reason if
 * triggered.
 *
 * Ordering: string-level checks run first so shell-quote is not given
 * adversarial input. If the string contains a hex escape, a backtick,
 * or an embedded empty-string literal inside a command name, we reject
 * without even calling parseShell.
 */
function prescanForShellArtifacts(raw: string): ParseReject | null {
  // (5) hex-escaped bytes — `\xHH` anywhere in the command
  if (/\\x[0-9a-fA-F]{2}/.test(raw)) {
    return { reason: "hex-escape sequence (\\xHH) not permitted" };
  }

  // (6) backtick substitution — any unescaped backtick
  // shell-quote silently treats backticks as literal word characters,
  // so we must detect them pre-parse. A single backtick in the input
  // is always grounds for rejection from an AI-frontend.
  if (/[`]/.test(raw)) {
    return { reason: "backtick substitution not permitted" };
  }

  // (1) empty-string literal embedded in a command name, e.g. `r""m` or
  // `r''m`. Shell collapses the quotes, so the resulting token is "rm"
  // and substring matching never sees it. We detect the pre-collapse
  // shape: a word character immediately adjacent to a `""` or `''`.
  if (/\w(?:""|'')/.test(raw) || /(?:""|'')\w/.test(raw)) {
    return { reason: "empty-string literal embedded in identifier" };
  }

  // (4) heredoc operator `<<` — the string `<<` appearing outside a
  // quoted context. shell-quote splits it into two `<` ops which we
  // detect post-parse too, but catching pre-parse gives a clearer
  // reason string and is a defence-in-depth layer.
  //
  // We only flag standalone `<<` (preceded/followed by whitespace or
  // word boundary) so we don't false-positive on SQL-like `<<=`
  // operators that are unlikely in a shell but cheap to allow.
  if (/(?:^|\s)<<(?:\s|\w)/.test(raw)) {
    return { reason: "heredoc (<<) not permitted" };
  }

  return null;
}

/**
 * Post-parse token-level checks — inspect the shell-quote token stream
 * for substitution operators, pipe-to-shell patterns, and forbidden
 * token names.
 *
 * shell-quote parse() returns an array of strings and operator objects.
 * Operator objects have the shape `{ op: string }` where op is one of
 * "|", "||", ">", ">>", "<", "&", "&&", ";", "(", ")", "<(", ">(", etc.
 */

type ParseToken =
  | string
  | { readonly op: string }
  | { readonly comment: string }
  | { readonly pattern: string }; // glob result shape

function isOp(token: ParseToken): token is { readonly op: string } {
  return typeof token === "object" && token !== null && "op" in token;
}

function inspectTokens(tokens: readonly ParseToken[]): ParseReject | null {
  // (2, 6, 7) substitution ops: `<(`, `>(`, `(`, `)` — shell-quote
  // emits these verbatim for process substitution and `$(...)`.
  // Any such op is grounds for rejection.
  const SUBSTITUTION_OPS: ReadonlySet<string> = new Set(["<(", ">(", "(", ")"]);

  for (const t of tokens) {
    if (isOp(t) && SUBSTITUTION_OPS.has(t.op)) {
      return { reason: `shell substitution (${t.op}) not permitted` };
    }
  }

  // (4) heredoc — two consecutive `<` ops indicate a heredoc. Catch
  // this post-parse in case the pre-scan missed a variant form.
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a === undefined || b === undefined) continue;
    if (isOp(a) && a.op === "<" && isOp(b) && b.op === "<") {
      return { reason: "heredoc (<<) not permitted" };
    }
  }

  // (3) pipe-to-shell: any `|` op whose following command token is a
  // shell interpreter. This catches `echo ... | bash`, `base64 -d |
  // bash`, and any other decode-then-exec shape, regardless of whether
  // the payload itself matches a substring.
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    if (a === undefined) continue;
    if (!isOp(a) || a.op !== "|") continue;
    const next = tokens[i + 1];
    if (typeof next === "string" && PIPE_SHELL_SINKS.has(next)) {
      return { reason: `pipe to shell interpreter (| ${next}) not permitted` };
    }
  }

  // Forbidden token names — first-position token whose bare name is on
  // the forbidden list. Kept separate from pattern matching so callers
  // can extend it without writing a regex.
  const first = tokens[0];
  if (typeof first === "string" && FORBIDDEN_TOKENS.has(first)) {
    return { reason: `forbidden command: ${first}` };
  }

  return null;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Validate a shell command against the sanitizer's rule set.
 * Returns a verdict describing whether the command is safe to run.
 *
 * The input is first pre-scanned for shell artifacts that `shell-quote`
 * would collapse (hex escapes, backticks, embedded empty-string
 * literals), then tokenized via `shell-quote` so we can inspect the
 * structured token stream for substitution, heredoc, and pipe-to-shell
 * shapes. Finally, a legacy regex layer catches substring-only shapes
 * (fork bombs, quoted reverse shells) that the parser collapses.
 *
 * Callers should still use a sandbox (containerization, mac-seatbelt,
 * or dedicated user) as a second layer.
 */
export function sanitizeCommand(cmd: string, options: SanitizerOptions = {}): CommandVerdict {
  if (typeof cmd !== "string") {
    return { safe: false, severity: "danger", reason: "command must be a string" };
  }

  const trimmed = cmd.trim();
  if (trimmed.length === 0) {
    return { safe: false, severity: "danger", reason: "empty command" };
  }

  // Reject commands that are too long (typical shell line is <4KB; >64KB indicates abuse)
  if (trimmed.length > 65536) {
    return { safe: false, severity: "danger", reason: "command exceeds 64KB" };
  }

  // 1. Pre-scan for shell artifacts that shell-quote collapses.
  //    Catches bypasses (1) empty-string, (5) hex-escape, (6) backtick,
  //    and (4) heredoc before parsing.
  const prescanReject = prescanForShellArtifacts(trimmed);
  if (prescanReject) {
    return { safe: false, severity: "danger", reason: prescanReject.reason };
  }

  // 2. Tokenize via shell-quote. If parsing itself throws, we reject —
  //    an unparseable command is not safe to hand to `/bin/sh -c`.
  let tokens: readonly ParseToken[];
  try {
    tokens = parseShell(trimmed) as readonly ParseToken[];
  } catch (err) {
    return {
      safe: false,
      severity: "danger",
      reason: `unparseable command: ${(err as Error).message}`,
    };
  }

  // 3. Inspect the token stream for substitution, heredoc, and
  //    pipe-to-shell shapes. Catches bypasses (2), (3), (7).
  const tokenReject = inspectTokens(tokens);
  if (tokenReject) {
    return { safe: false, severity: "danger", reason: tokenReject.reason };
  }

  // 4. Legacy substring patterns — still run. The parse pass catches
  //    novel shapes; these catch the obvious ones (fork bombs, reverse
  //    shells, /etc/passwd writes) whose substring signatures are
  //    already well-characterised and whose regexes have been audited.
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, severity: "danger", reason };
    }
  }

  // 5. Privileged patterns — block unless caller opts in.
  for (const { pattern, reason } of PRIVILEGED_PATTERNS) {
    if (pattern.test(trimmed)) {
      if (options.allowPrivileged) {
        // Allowed but still flag it
        return { safe: true, severity: "warn", reason: `allowlisted: ${reason}` };
      }
      return { safe: false, severity: "danger", reason };
    }
  }

  // 6. Warning patterns — allow but mark as warn.
  for (const { pattern, reason } of WARN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: true, severity: "warn", reason };
    }
  }

  return { safe: true, severity: "safe" };
}

/**
 * Predicate convenience — returns true iff the command is safe to run at the
 * requested privilege level.
 */
export function isCommandSafe(cmd: string, options: SanitizerOptions = {}): boolean {
  return sanitizeCommand(cmd, options).safe;
}

/**
 * Exposed for testing — gives callers access to all pattern lists so unit tests
 * can assert coverage (e.g. "every pattern in BLOCKED_PATTERNS is matched").
 */
export const sanitizerRules = {
  blocked: BLOCKED_PATTERNS,
  privileged: PRIVILEGED_PATTERNS,
  warn: WARN_PATTERNS,
  forbiddenTokens: FORBIDDEN_TOKENS,
  pipeShellSinks: PIPE_SHELL_SINKS,
} as const;
