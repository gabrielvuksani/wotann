/**
 * Non-Interactive Mode -- assume reasonable defaults instead of asking questions.
 *
 * Critical for benchmark performance and CI/CD usage where no human
 * is present to answer prompts. Detects non-interactive environments
 * automatically and provides sensible default answers.
 *
 * Detection priority:
 *   1. Explicit WOTANN_NON_INTERACTIVE=1 env var
 *   2. CI=true env var (GitHub Actions, GitLab CI, etc.)
 *   3. No TTY on stdin (piped input, cron jobs)
 *   4. --non-interactive CLI flag in process.argv
 */

// -- Configuration ----------------------------------------------------------

export interface NonInteractiveDefaults {
  readonly confirmDestructive: boolean;
  readonly autoSelectProvider: boolean;
  readonly autoApproveEdits: boolean;
  readonly maxCyclesBeforeStop: number;
  readonly timeoutMs: number;
}

export const DEFAULT_NON_INTERACTIVE: NonInteractiveDefaults = {
  confirmDestructive: false,
  autoSelectProvider: true,
  autoApproveEdits: true,
  maxCyclesBeforeStop: 50,
  timeoutMs: 300_000,
};

// -- Environment Detection --------------------------------------------------

/**
 * Detect whether the current process is running non-interactively.
 * Checks environment variables, CLI flags, and TTY status.
 */
export function isNonInteractive(): boolean {
  // Explicit opt-in via environment variable
  if (process.env["WOTANN_NON_INTERACTIVE"] === "1") {
    return true;
  }

  // Common CI environment variables
  if (process.env["CI"] === "true") {
    return true;
  }

  // CLI flag
  if (process.argv.includes("--non-interactive")) {
    return true;
  }

  // No TTY means no human to answer questions
  if (!process.stdin.isTTY) {
    return true;
  }

  return false;
}

/**
 * Detect the specific CI environment, if any.
 */
export function detectCIEnvironment(): string | null {
  if (process.env["GITHUB_ACTIONS"] === "true") return "github-actions";
  if (process.env["GITLAB_CI"] === "true") return "gitlab-ci";
  if (process.env["CIRCLECI"] === "true") return "circleci";
  if (process.env["JENKINS_URL"]) return "jenkins";
  if (process.env["TRAVIS"] === "true") return "travis";
  if (process.env["BUILDKITE"] === "true") return "buildkite";
  if (process.env["CI"] === "true") return "unknown-ci";
  return null;
}

// -- Default Answer Engine --------------------------------------------------

/**
 * Question categories used for pattern matching.
 */
type QuestionCategory =
  | "confirmation"
  | "provider-selection"
  | "file-edit"
  | "destructive-action"
  | "mode-selection"
  | "retry"
  | "unknown";

/**
 * Classify a question by its content to determine the right default answer.
 */
function classifyQuestion(question: string): QuestionCategory {
  const lower = question.toLowerCase();

  if (/\b(delete|remove|drop|reset|force|overwrite|destroy)\b/.test(lower)) {
    return "destructive-action";
  }

  if (/\b(edit|modify|change|update|write|save)\b.*\b(file|code)\b/.test(lower)) {
    return "file-edit";
  }

  if (/\b(provider|model|switch|select)\b/.test(lower)) {
    return "provider-selection";
  }

  if (/\b(mode|approach|strategy)\b/.test(lower)) {
    return "mode-selection";
  }

  if (/\b(retry|again|try)\b/.test(lower)) {
    return "retry";
  }

  if (/\b(confirm|proceed|continue|yes|no|y\/n|ok)\b/.test(lower)) {
    return "confirmation";
  }

  return "unknown";
}

/**
 * Return a reasonable default answer for a question in non-interactive mode.
 * Each category maps to a safe default that keeps execution moving forward.
 */
export function getDefaultAnswer(
  question: string,
  defaults: NonInteractiveDefaults = DEFAULT_NON_INTERACTIVE,
): string {
  const category = classifyQuestion(question);

  switch (category) {
    case "destructive-action":
      return defaults.confirmDestructive ? "yes" : "no";

    case "file-edit":
      return defaults.autoApproveEdits ? "yes" : "no";

    case "provider-selection":
      return defaults.autoSelectProvider ? "auto" : "skip";

    case "mode-selection":
      return "default";

    case "retry":
      return "yes";

    case "confirmation":
      return "yes";

    case "unknown":
      return "yes";
  }
}

/**
 * Create a customized defaults object by merging overrides.
 */
export function createDefaults(
  overrides: Partial<NonInteractiveDefaults> = {},
): NonInteractiveDefaults {
  return { ...DEFAULT_NON_INTERACTIVE, ...overrides };
}

/**
 * Summary of non-interactive detection for diagnostics.
 */
export interface NonInteractiveStatus {
  readonly isNonInteractive: boolean;
  readonly reason: string;
  readonly ciEnvironment: string | null;
  readonly defaults: NonInteractiveDefaults;
}

/**
 * Get a full status report of the non-interactive detection.
 */
export function getNonInteractiveStatus(
  defaults: NonInteractiveDefaults = DEFAULT_NON_INTERACTIVE,
): NonInteractiveStatus {
  const active = isNonInteractive();
  let reason = "interactive (TTY detected)";

  if (process.env["WOTANN_NON_INTERACTIVE"] === "1") {
    reason = "WOTANN_NON_INTERACTIVE=1";
  } else if (process.env["CI"] === "true") {
    reason = "CI=true";
  } else if (process.argv.includes("--non-interactive")) {
    reason = "--non-interactive flag";
  } else if (!process.stdin.isTTY) {
    reason = "no TTY on stdin";
  }

  return {
    isNonInteractive: active,
    reason,
    ciEnvironment: detectCIEnvironment(),
    defaults,
  };
}
