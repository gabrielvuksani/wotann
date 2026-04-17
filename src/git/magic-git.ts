/**
 * Magic Git (C20) — commit-message, PR-description, and conflict
 * resolution helpers surfaced as slash-commands / CLI verbs.
 *
 * Port of the "Magic Git" channel from Jean.build, adapted to WOTANN's
 * existing shadow-git + provider infrastructure. These functions are
 * pure analyzers over raw git data; callers feed them a diff or a
 * conflict marker, and get back structured suggestions.
 *
 * The *analyzer* layer lives here — no LLM calls, no side effects, no
 * git invocations. That keeps the functions 100% testable and leaves
 * any "enrich with an LLM" step to callers that have a runtime.
 */

// ── Commit message generation ────────────────────────────────

/**
 * Conventional-commit types recognised by the analyzer. Ordered by
 * specificity — `test` and `docs` need to beat `feat` when a diff is
 * dominated by test/doc changes.
 */
const COMMIT_TYPES = [
  "test",
  "docs",
  "style",
  "build",
  "ci",
  "chore",
  "refactor",
  "perf",
  "fix",
  "feat",
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

export interface CommitMessageSuggestion {
  readonly type: CommitType;
  readonly scope: string | undefined;
  readonly subject: string;
  readonly body: string | undefined;
  readonly breaking: boolean;
  readonly confidence: number; // 0..1
}

export interface DiffStat {
  readonly path: string;
  readonly adds: number;
  readonly dels: number;
}

export function parseDiffStat(numstatOutput: string): readonly DiffStat[] {
  // `git diff --numstat` output: "ADDS\tDELS\tPATH"
  const lines = numstatOutput.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const stats: DiffStat[] = [];
  for (const line of lines) {
    const match = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
    if (!match) continue;
    const adds = match[1] === "-" ? 0 : Number.parseInt(match[1] ?? "0", 10);
    const dels = match[2] === "-" ? 0 : Number.parseInt(match[2] ?? "0", 10);
    const path = match[3] ?? "";
    stats.push({ path, adds, dels });
  }
  return stats;
}

export function suggestCommitMessage(
  stats: readonly DiffStat[],
  options: { readonly hint?: string } = {},
): CommitMessageSuggestion {
  if (stats.length === 0) {
    return {
      type: "chore",
      scope: undefined,
      subject: "empty commit",
      body: undefined,
      breaking: false,
      confidence: 0.1,
    };
  }

  const type = inferCommitType(stats);
  const scope = inferScope(stats);
  const totalAdds = stats.reduce((s, d) => s + d.adds, 0);
  const totalDels = stats.reduce((s, d) => s + d.dels, 0);

  const subject = makeSubject(type, scope, stats, options.hint);
  const body = stats.length > 1 ? makeBody(stats, totalAdds, totalDels) : undefined;

  return {
    type,
    scope,
    subject,
    body,
    breaking: false,
    confidence: stats.length > 0 ? 0.65 : 0.1,
  };
}

function inferCommitType(stats: readonly DiffStat[]): CommitType {
  const counts: Record<CommitType, number> = {
    test: 0,
    docs: 0,
    style: 0,
    build: 0,
    ci: 0,
    chore: 0,
    refactor: 0,
    perf: 0,
    fix: 0,
    feat: 0,
  };

  for (const stat of stats) {
    const bucket = classifyPath(stat.path);
    counts[bucket]++;
  }

  let best: CommitType = "chore";
  let bestCount = 0;
  for (const type of COMMIT_TYPES) {
    if (counts[type] > bestCount) {
      best = type;
      bestCount = counts[type];
    }
  }
  // If the dominant bucket is something other than "feat" (test/docs/
  // style/ci/etc.) and every file matches it, honour that classification
  // outright — deletions don't change the nature of a docs-only change.
  if (bestCount === stats.length && best !== "feat") return best;

  // When the change is source-code-heavy (bucket was feat, or mixed),
  // use the adds-vs-dels ratio to distinguish additive work (feat) from
  // removal/cleanup (fix or refactor). Strong removal signal → fix.
  const totalAdds = stats.reduce((s, d) => s + d.adds, 0);
  const totalDels = stats.reduce((s, d) => s + d.dels, 0);
  if (totalDels > totalAdds * 2) return "fix";
  return best;
}

function classifyPath(path: string): CommitType {
  if (/\.(test|spec)\.(t|j)sx?$/.test(path) || /^tests?\//.test(path)) return "test";
  if (/\.(md|mdx|rst|txt)$/i.test(path) || /^docs?\//i.test(path)) return "docs";
  if (/\.(css|scss|sass|less)$/i.test(path)) return "style";
  if (/^\.github\/workflows\//.test(path)) return "ci";
  if (/^(Dockerfile|docker-compose|\.dockerignore)/i.test(path)) return "build";
  if (/package\.json$|tsconfig|vitest\.config|eslint\.config/.test(path)) return "build";
  if (/^(\.env|\.gitignore|\.editorconfig)/.test(path)) return "chore";
  return "feat";
}

function inferScope(stats: readonly DiffStat[]): string | undefined {
  const segments = stats
    .map((s) => s.path.split("/"))
    .filter((parts) => parts.length >= 2 && parts[0] === "src")
    .map((parts) => parts[1]);
  if (segments.length === 0) return undefined;
  const unique = new Set(segments);
  return unique.size === 1 ? [...unique][0] : undefined;
}

function makeSubject(
  type: CommitType,
  scope: string | undefined,
  stats: readonly DiffStat[],
  hint: string | undefined,
): string {
  const fileCount = stats.length;
  const filePart =
    fileCount === 1 ? (stats[0]?.path.split("/").pop() ?? "changes") : `${fileCount} files`;
  const scopePrefix = scope ? `(${scope}) ` : " ";
  const descriptor =
    hint?.trim() ??
    (type === "test"
      ? "tests for " + filePart
      : type === "docs"
        ? "docs for " + filePart
        : type === "refactor"
          ? "refactor " + filePart
          : type === "fix"
            ? "fix " + filePart
            : "update " + filePart);
  return `${type}${scopePrefix}${descriptor}`.trim();
}

function makeBody(stats: readonly DiffStat[], adds: number, dels: number): string {
  const lines = [`Changes across ${stats.length} files: +${adds} -${dels}.`, ""];
  const top = [...stats].sort((a, b) => b.adds + b.dels - (a.adds + a.dels)).slice(0, 5);
  for (const stat of top) {
    lines.push(`- ${stat.path} (+${stat.adds} -${stat.dels})`);
  }
  return lines.join("\n");
}

// ── PR description generation ────────────────────────────────

export interface PRDescriptionInput {
  readonly title: string;
  readonly commits: readonly { readonly hash: string; readonly subject: string }[];
  readonly diffStats: readonly DiffStat[];
  readonly baseBranch?: string;
}

export function buildPRDescription(input: PRDescriptionInput): string {
  const lines: string[] = [];
  const bulletCommits = input.commits.slice(0, 8);
  const overflow = input.commits.length - bulletCommits.length;

  lines.push("## Summary");
  if (bulletCommits.length === 0) {
    lines.push("- No commits to describe.");
  } else {
    for (const c of bulletCommits) {
      lines.push(`- ${c.subject}`);
    }
    if (overflow > 0) lines.push(`- …plus ${overflow} more commit(s)`);
  }

  const testPaths = input.diffStats
    .map((s) => s.path)
    .filter((p) => /\.(test|spec)\.(t|j)sx?$/.test(p) || /^tests?\//.test(p));

  lines.push("", "## Test plan");
  if (testPaths.length > 0) {
    for (const path of testPaths.slice(0, 6)) {
      lines.push(`- [ ] ${path} passes`);
    }
    lines.push(`- [ ] \`npm test\` green on ${input.baseBranch ?? "main"}`);
  } else {
    lines.push("- [ ] No new tests included — verify existing suite still green.");
    lines.push("- [ ] Manual verification of affected surfaces.");
  }

  lines.push(
    "",
    `_${input.diffStats.length} file(s) changed: +${input.diffStats.reduce(
      (s, d) => s + d.adds,
      0,
    )} -${input.diffStats.reduce((s, d) => s + d.dels, 0)}._`,
  );

  return lines.join("\n");
}

// ── Conflict resolution analyzer ─────────────────────────────

export interface ConflictHunk {
  readonly ours: string;
  readonly theirs: string;
  readonly ancestor: string | undefined;
}

export interface ConflictSuggestion {
  readonly strategy: "take-ours" | "take-theirs" | "union" | "manual";
  readonly resolved: string | undefined;
  readonly reason: string;
}

export function parseConflictBlocks(text: string): readonly ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  const conflictPattern =
    /<<<<<<< [^\n]*\n([\s\S]*?)(?:\|\|\|\|\|\|\| [^\n]*\n([\s\S]*?))?=======\n([\s\S]*?)>>>>>>> [^\n]*/g;
  const matches = text.matchAll(conflictPattern);
  for (const match of matches) {
    hunks.push({
      ours: match[1] ?? "",
      ancestor: match[2],
      theirs: match[3] ?? "",
    });
  }
  return hunks;
}

export function suggestConflictResolution(hunk: ConflictHunk): ConflictSuggestion {
  const ours = hunk.ours.trim();
  const theirs = hunk.theirs.trim();

  if (ours === theirs) {
    return {
      strategy: "take-ours",
      resolved: hunk.ours,
      reason: "both sides identical",
    };
  }

  if (ours === "") {
    return {
      strategy: "take-theirs",
      resolved: hunk.theirs,
      reason: "ours is empty — taking theirs",
    };
  }
  if (theirs === "") {
    return {
      strategy: "take-ours",
      resolved: hunk.ours,
      reason: "theirs is empty — taking ours",
    };
  }

  if (ours.includes(theirs)) {
    return {
      strategy: "take-ours",
      resolved: hunk.ours,
      reason: "ours is a superset of theirs",
    };
  }
  if (theirs.includes(ours)) {
    return {
      strategy: "take-theirs",
      resolved: hunk.theirs,
      reason: "theirs is a superset of ours",
    };
  }

  return {
    strategy: "manual",
    resolved: undefined,
    reason: "divergent changes — manual review required",
  };
}

export function renderCommitMessage(sug: CommitMessageSuggestion): string {
  const head =
    sug.scope !== undefined
      ? `${sug.type}(${sug.scope})${sug.breaking ? "!" : ""}: ${sug.subject.replace(/^.+?: /, "")}`
      : `${sug.type}${sug.breaking ? "!" : ""}: ${sug.subject.replace(/^.+?: /, "")}`;
  if (sug.body) return `${head}\n\n${sug.body}`;
  return head;
}
