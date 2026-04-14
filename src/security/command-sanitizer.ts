/**
 * Command Sanitizer — validate shell commands from iOS/desktop frontends
 * BEFORE executing them against the host system.
 *
 * This is layer 1 of defence-in-depth for shell execution:
 *   - Blocks catastrophic patterns outright (rm -rf /, dd if=/dev/zero, forkbomb)
 *   - Blocks pipe-to-shell payloads (curl | sh, wget | bash)
 *   - Blocks writes to system-sensitive files (/etc/passwd, /etc/shadow)
 *   - Requires allowlist approval for privileged commands (sudo, chmod 777, ...)
 *
 * The sanitizer returns a typed verdict { safe, reason, severity } so callers
 * can decide whether to execute, prompt the user, or reject.
 *
 * Layer 2 (audit log) and Layer 3 (sandbox/containment) live elsewhere.
 */

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
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)[^\n]*?\s\/(?:\s|$)/, reason: "rm -rf on filesystem root" },
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)[^\n]*?\s\/(?:etc|bin|boot|sbin|usr|var|sys|root|proc)\b/, reason: "rm -rf on critical system path" },
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)\s+~\s*$/, reason: "rm -rf on home directory" },
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)[^\n]*?\s\$HOME\b/, reason: "rm -rf on $HOME" },
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)[^\n]*?\s\*\s*$/, reason: "rm -rf with bare glob" },

  // dd to raw devices / zero-write
  { pattern: /\bdd\s+[^\n]*?if=\/dev\/(?:zero|random|urandom)\b[^\n]*?of=\/dev\//, reason: "dd from /dev/zero|random to raw device" },
  { pattern: /\bdd\s+[^\n]*?of=\/dev\/(?:sd[a-z]|hd[a-z]|nvme\d|disk\d)/, reason: "dd writing to raw block device" },

  // Fork bombs (bash :(){:|:&};: and common variants)
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: "bash fork bomb" },
  { pattern: /\bbomb\s*\(\s*\)\s*\{[^}]*\}\s*;\s*bomb\b/, reason: "fork bomb variant" },

  // Pipe-to-shell payloads (curl|sh, wget|bash, fetch|sh)
  { pattern: /\b(?:curl|wget|fetch)\s+[^\n|]*\|\s*(?:sh|bash|zsh|ksh|dash|fish|sudo\s+(?:sh|bash))\b/, reason: "pipe-to-shell from network" },
  { pattern: /\b(?:curl|wget)\s+[^\n|]*\|\s*sudo\s+-?\s*\w*\s*(?:sh|bash|zsh|ksh|dash|fish)\b/, reason: "pipe-to-sudo-shell from network" },

  // Writes to system-sensitive files via redirection
  { pattern: />>?\s*\/etc\/passwd\b/, reason: "write to /etc/passwd" },
  { pattern: />>?\s*\/etc\/shadow\b/, reason: "write to /etc/shadow" },
  { pattern: />>?\s*\/etc\/sudoers(?:\.d\/|\b)/, reason: "write to /etc/sudoers" },
  { pattern: />>?\s*\/etc\/hosts\b/, reason: "write to /etc/hosts" },

  // Obvious exfiltration patterns (cat /etc/shadow | nc)
  { pattern: /\bcat\s+\/etc\/(?:shadow|passwd)\b[^\n]*\|\s*(?:nc|netcat|curl|wget)\b/, reason: "exfiltration of password file" },

  // Reverse shells (common netcat variants)
  { pattern: /\b(?:nc|netcat|ncat)\s+[^\n]*-[^\n]*e\s+\/bin\/(?:sh|bash)\b/, reason: "reverse shell via netcat" },
  { pattern: /\bbash\s+-i\s+>&?\s*\/dev\/tcp\//, reason: "bash reverse shell" },

  // Recursive chmod on sensitive paths
  { pattern: /\bchmod\s+-R\s+[0-9]{3,4}\s+\/(?:\s|etc|bin|sbin|usr|var|boot|sys|root)\b/, reason: "recursive chmod on system path" },

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
  { pattern: /\bdiskutil\s+(?:erase|unmountDisk|eraseDisk)\b/, reason: "diskutil erase requires allowlist approval" },
  { pattern: /\bhdiutil\s+eraseVolume\b/, reason: "hdiutil eraseVolume requires allowlist approval" },
];

// ── Warning patterns (allow but flag) ───────────────────────

interface WarnPattern {
  readonly pattern: RegExp;
  readonly reason: string;
}

const WARN_PATTERNS: readonly WarnPattern[] = [
  { pattern: /\brm\s+(?:-[rRf]+|--recursive|--force)\b/, reason: "recursive/forced delete" },
  { pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[fd]+|push\s+-f\b|push\s+--force)/, reason: "destructive git operation" },
  { pattern: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i, reason: "destructive SQL DDL" },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, reason: "SQL TRUNCATE" },
  { pattern: /\bexport\s+(?:PATH|LD_LIBRARY_PATH|DYLD_[A-Z_]+)=/, reason: "modifying library search path" },
];

// ── Public API ─────────────────────────────────────────────

/**
 * Validate a shell command against the sanitizer's rule set.
 * Returns a verdict describing whether the command is safe to run.
 *
 * The input is treated as an opaque shell string. The sanitizer does not parse
 * or expand the command — it performs pattern-based rejection, which is fast
 * but imperfect. Callers should still use a sandbox (e.g. containerization,
 * mac-seatbelt, or dedicated user) as a second layer.
 */
export function sanitizeCommand(
  cmd: string,
  options: SanitizerOptions = {},
): CommandVerdict {
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

  // 1. Catastrophic patterns — always block
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, severity: "danger", reason };
    }
  }

  // 2. Privileged patterns — block unless caller opts in
  for (const { pattern, reason } of PRIVILEGED_PATTERNS) {
    if (pattern.test(trimmed)) {
      if (options.allowPrivileged) {
        // Allowed but still flag it
        return { safe: true, severity: "warn", reason: `allowlisted: ${reason}` };
      }
      return { safe: false, severity: "danger", reason };
    }
  }

  // 3. Warning patterns — allow but mark as warn
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
} as const;
