/**
 * Bash command risk classifier.
 * Classifies shell commands as safe, moderate, or dangerous
 * based on pattern matching and shell metacharacter detection.
 */

// ── Types ──────────────────────────────────────────────────────

export interface BashRiskLevel {
  readonly level: "safe" | "moderate" | "dangerous";
  readonly reason: string;
  readonly patterns: readonly string[];
}

interface RiskPattern {
  readonly pattern: RegExp;
  readonly label: string;
  readonly reason: string;
}

// ── Dangerous Patterns ─────────────────────────────────────────

const DANGEROUS_PATTERNS: readonly RiskPattern[] = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|.*-rf\b|.*-fr\b)/, label: "rm -rf", reason: "Recursive forced deletion can destroy entire directory trees" },
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i, label: "DROP TABLE", reason: "SQL DROP permanently removes database objects" },
  { pattern: /\bgit\s+reset\s+--hard\b/, label: "git reset --hard", reason: "Discards all uncommitted changes irreversibly" },
  { pattern: /\bgit\s+push\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*--force\b|.*--force-with-lease\b)/, label: "git push --force", reason: "Force push overwrites remote history" },
  { pattern: /\bmkfs\b/, label: "mkfs", reason: "Formats a filesystem, destroying all data on the device" },
  { pattern: /\bdd\s+/, label: "dd", reason: "Low-level disk copy can overwrite devices and partitions" },
  { pattern: /\bshutdown\b/, label: "shutdown", reason: "Shuts down the system" },
  { pattern: /\breboot\b/, label: "reboot", reason: "Reboots the system" },
  { pattern: /\bkill\s+(-9|--signal\s+(9|KILL|SIGKILL))\b/, label: "kill -9", reason: "SIGKILL forcefully terminates processes without cleanup" },
  { pattern: /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+|.*-R\s+).*777\b/, label: "chmod -R 777", reason: "Recursively sets world-writable permissions, severe security risk" },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, label: "TRUNCATE TABLE", reason: "Removes all rows from a table without logging" },
  { pattern: /\b:(){ :\|:& };:\b/, label: "fork bomb", reason: "Fork bomb will crash the system by exhausting processes" },
  { pattern: /\b>\s*\/dev\/sd[a-z]/, label: "> /dev/sdX", reason: "Writing directly to a block device destroys data" },
  { pattern: /\brm\s+.*\/\s*$/, label: "rm /", reason: "Deleting root or near-root directories" },
  { pattern: /\bgit\s+clean\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*-f\b|.*--force\b)/, label: "git clean -f", reason: "Permanently removes untracked files" },
  { pattern: /\bgit\s+branch\s+(-[a-zA-Z]*D[a-zA-Z]*\s+|.*-D\b)/, label: "git branch -D", reason: "Force-deletes a branch without merge check" },
];

// ── Moderate Patterns ──────────────────────────────────────────

const MODERATE_PATTERNS: readonly RiskPattern[] = [
  { pattern: /\bnpm\s+install\b/, label: "npm install", reason: "Installs packages that may contain arbitrary scripts" },
  { pattern: /\bpip\s+install\b/, label: "pip install", reason: "Installs Python packages that may run setup scripts" },
  { pattern: /\bapt\s+(install|remove|purge)\b/, label: "apt install", reason: "Modifies system packages" },
  { pattern: /\bbrew\s+(install|uninstall|remove)\b/, label: "brew install", reason: "Modifies system packages via Homebrew" },
  { pattern: /\bgit\s+checkout\b/, label: "git checkout", reason: "Switches branches or discards file changes" },
  { pattern: /\bgit\s+merge\b/, label: "git merge", reason: "Merges branches, may cause conflicts" },
  { pattern: /\bdocker\s+run\b/, label: "docker run", reason: "Runs a container that may have host access" },
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/, label: "curl | bash", reason: "Pipes remote content directly to shell execution" },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh\b/, label: "wget | bash", reason: "Pipes remote download directly to shell execution" },
  { pattern: /\bnpx\s+/, label: "npx", reason: "Downloads and executes packages from npm" },
  { pattern: /\bgit\s+stash\s+drop\b/, label: "git stash drop", reason: "Permanently removes a stashed change" },
  { pattern: /\bgit\s+rebase\b/, label: "git rebase", reason: "Rewrites commit history, can cause conflicts" },
  { pattern: /\bdocker\s+(rm|rmi|system\s+prune)\b/, label: "docker rm", reason: "Removes containers or images" },
  { pattern: /\byarn\s+add\b/, label: "yarn add", reason: "Installs packages that may contain arbitrary scripts" },
  { pattern: /\bpnpm\s+(add|install)\b/, label: "pnpm install", reason: "Installs packages that may contain arbitrary scripts" },
  { pattern: /\bsudo\s+/, label: "sudo", reason: "Elevates privileges, commands run as root" },
  { pattern: /\bchmod\b/, label: "chmod", reason: "Changes file permissions" },
  { pattern: /\bchown\b/, label: "chown", reason: "Changes file ownership" },
];

// ── Safe Patterns ──────────────────────────────────────────────

const SAFE_PATTERNS: readonly RiskPattern[] = [
  { pattern: /^\s*ls(\s|$)/, label: "ls", reason: "Lists directory contents" },
  { pattern: /^\s*cat\s/, label: "cat", reason: "Displays file contents" },
  { pattern: /^\s*head(\s|$)/, label: "head", reason: "Shows first lines of a file" },
  { pattern: /^\s*tail(\s|$)/, label: "tail", reason: "Shows last lines of a file" },
  { pattern: /^\s*grep(\s|$)/, label: "grep", reason: "Searches file contents" },
  { pattern: /^\s*find(\s|$)/, label: "find", reason: "Finds files by criteria" },
  { pattern: /^\s*echo(\s|$)/, label: "echo", reason: "Prints text to stdout" },
  { pattern: /^\s*pwd\s*$/, label: "pwd", reason: "Prints current directory" },
  { pattern: /^\s*cd(\s|$)/, label: "cd", reason: "Changes directory" },
  { pattern: /^\s*git\s+status(\s|$)/, label: "git status", reason: "Shows working tree status" },
  { pattern: /^\s*git\s+log(\s|$)/, label: "git log", reason: "Shows commit history" },
  { pattern: /^\s*git\s+diff(\s|$)/, label: "git diff", reason: "Shows file differences" },
  { pattern: /^\s*npm\s+test(\s|$)/, label: "npm test", reason: "Runs project tests" },
  { pattern: /^\s*npm\s+run(\s|$)/, label: "npm run", reason: "Runs a package script" },
  { pattern: /^\s*wc(\s|$)/, label: "wc", reason: "Counts lines, words, bytes" },
  { pattern: /^\s*which(\s|$)/, label: "which", reason: "Shows command location" },
  { pattern: /^\s*whoami\s*$/, label: "whoami", reason: "Shows current user" },
  { pattern: /^\s*date\s*$/, label: "date", reason: "Shows current date/time" },
  { pattern: /^\s*git\s+branch(\s|$)/, label: "git branch", reason: "Lists branches" },
  { pattern: /^\s*git\s+show(\s|$)/, label: "git show", reason: "Shows commit details" },
  { pattern: /^\s*tree(\s|$)/, label: "tree", reason: "Shows directory tree" },
  { pattern: /^\s*du(\s|$)/, label: "du", reason: "Shows disk usage" },
  { pattern: /^\s*df(\s|$)/, label: "df", reason: "Shows filesystem space" },
  { pattern: /^\s*uname(\s|$)/, label: "uname", reason: "Shows system info" },
];

// ── Shell Injection Patterns ───────────────────────────────────

interface InjectionPattern {
  readonly pattern: RegExp;
  readonly label: string;
  readonly reason: string;
}

const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  { pattern: /\$\(/, label: "$()", reason: "Command substitution can execute arbitrary commands" },
  { pattern: /`[^`]+`/, label: "backticks", reason: "Backtick command substitution can execute arbitrary commands" },
  { pattern: /\|\s*\w/, label: "pipe (|)", reason: "Pipe chains can route output to dangerous commands" },
  { pattern: /;\s*\w/, label: "semicolon (;)", reason: "Command chaining may execute unintended commands" },
  { pattern: /&&\s*\w/, label: "&& chain", reason: "Conditional chaining may execute unintended commands" },
  { pattern: /\|\|\s*\w/, label: "|| chain", reason: "Conditional chaining may execute unintended commands" },
  { pattern: />\s*\S/, label: "redirect (>)", reason: "Output redirection can overwrite files" },
  { pattern: /<\s*\S/, label: "redirect (<)", reason: "Input redirection from unexpected sources" },
  { pattern: /\beval\s+/, label: "eval", reason: "Evaluates arbitrary string as shell command" },
  { pattern: /\bexec\s+/, label: "exec", reason: "Replaces current process with another command" },
];

// ── Main Classifier ────────────────────────────────────────────

/**
 * Classify a bash command by risk level.
 *
 * Checks in order: dangerous > injection > moderate > safe > default moderate.
 * Commands with shell metacharacters that could indicate injection
 * are elevated to at least moderate risk.
 */
export function classifyBashCommand(command: string): BashRiskLevel {
  const trimmed = command.trim();

  if (trimmed.length === 0) {
    return { level: "safe", reason: "Empty command", patterns: [] };
  }

  // Check dangerous patterns first (highest priority)
  const dangerousMatches = matchPatterns(trimmed, DANGEROUS_PATTERNS);
  if (dangerousMatches.length > 0) {
    return {
      level: "dangerous",
      reason: dangerousMatches[0]?.reason ?? "Matches dangerous pattern",
      patterns: dangerousMatches.map((m) => m.label),
    };
  }

  // Check for shell injection indicators
  const injectionMatches = matchInjectionPatterns(trimmed);

  // Check moderate patterns
  const moderateMatches = matchPatterns(trimmed, MODERATE_PATTERNS);
  if (moderateMatches.length > 0) {
    const allPatterns = [
      ...moderateMatches.map((m) => m.label),
      ...injectionMatches.map((m) => m.label),
    ];
    return {
      level: "moderate",
      reason: moderateMatches[0]?.reason ?? "Matches moderate-risk pattern",
      patterns: allPatterns,
    };
  }

  // If injection patterns found but no explicit moderate/dangerous match, flag as moderate
  if (injectionMatches.length > 0) {
    return {
      level: "moderate",
      reason: injectionMatches[0]?.reason ?? "Shell metacharacters detected",
      patterns: injectionMatches.map((m) => m.label),
    };
  }

  // Check safe patterns
  const safeMatches = matchPatterns(trimmed, SAFE_PATTERNS);
  if (safeMatches.length > 0) {
    return {
      level: "safe",
      reason: safeMatches[0]?.reason ?? "Matches known safe pattern",
      patterns: safeMatches.map((m) => m.label),
    };
  }

  // Default: unknown commands are moderate
  return {
    level: "moderate",
    reason: "Unrecognized command; treating as moderate risk",
    patterns: [],
  };
}

// ── Helpers ────────────────────────────────────────────────────

function matchPatterns(
  command: string,
  patterns: readonly RiskPattern[],
): readonly RiskPattern[] {
  return patterns.filter((p) => p.pattern.test(command));
}

function matchInjectionPatterns(
  command: string,
): readonly InjectionPattern[] {
  return INJECTION_PATTERNS.filter((p) => p.pattern.test(command));
}
