/**
 * Session recap + auto-naming (C23).
 *
 * Claude Code recently added two session conveniences we didn't have:
 *   1. Auto-generated session names derived from the plan / first prompt
 *      (instead of "session-8f3a1" UUIDs).
 *   2. Concise recap on resume — a 3-5 bullet snapshot of where things
 *      stood, showing "last action", "next step", and any blockers —
 *      instead of the full verbose dump `buildResumePrompt` produces.
 *
 * Both are pure functions over `SessionSnapshot` so they are trivially
 * testable and composable. No side effects.
 */

import type { SessionSnapshot, ConversationMessage, ActiveTask } from "./session-resume.js";

// ── Auto-naming ──────────────────────────────────────────────

/**
 * Best-effort noun-phrase title for a session. Priority:
 *   1. First in-progress or paused task description
 *   2. First user message in the conversation
 *   3. Working dir name + timestamp fallback
 *
 * Normalises whitespace, strips imperative verbs so the result reads as
 * a topic rather than a command ("fix the auth bug" → "auth bug fix").
 * Truncated to 60 chars with a visible ellipsis, kebab-safe for use in
 * filenames via slugifyTitle().
 */
export function autoNameFromSnapshot(snapshot: SessionSnapshot): string {
  const fromTask = firstNonTrivialTask(snapshot.activeTasks);
  if (fromTask) return normaliseTitle(fromTask);

  const firstUser = snapshot.conversation.find((m) => m.role === "user");
  if (firstUser?.content) return normaliseTitle(firstUser.content);

  const dirName = snapshot.workingDir.split("/").filter(Boolean).pop() ?? "session";
  const date = new Date(snapshot.createdAt).toISOString().slice(0, 10);
  return `${dirName}-${date}`;
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function firstNonTrivialTask(tasks: readonly ActiveTask[]): string | undefined {
  for (const t of tasks) {
    if ((t.status === "in-progress" || t.status === "paused") && t.description.trim().length > 3) {
      return t.description;
    }
  }
  // Fall back to the first task of any status
  return tasks[0]?.description;
}

const LEADING_IMPERATIVES = new Set([
  "add",
  "fix",
  "update",
  "refactor",
  "build",
  "create",
  "write",
  "rewrite",
  "remove",
  "delete",
  "implement",
  "make",
  "help",
  "please",
  "ship",
  "land",
  "wire",
  "port",
  "enable",
]);

function normaliseTitle(raw: string): string {
  const cleaned = raw
    .replace(/[\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ");
  const hasImperative = words[0] && LEADING_IMPERATIVES.has(words[0].toLowerCase());
  const stripped = hasImperative ? words.slice(1).join(" ") : cleaned;
  if (stripped.length <= 60) return stripped;
  return stripped.slice(0, 57) + "…";
}

// ── Recap ────────────────────────────────────────────────────

export interface SessionRecap {
  readonly title: string;
  readonly ageMinutes: number;
  readonly lastAction: string | undefined;
  readonly nextStep: string | undefined;
  readonly blockers: readonly string[];
  readonly filesTouchedCount: number;
  readonly costUsd: number;
  readonly contextTokens: number;
}

/**
 * Build a structured recap from the snapshot. Unlike `buildResumePrompt`,
 * this only keeps the signal — last assistant turn gist, next step, open
 * blockers derived from failed tasks — so the resume UI can render a
 * short card instead of a wall of text.
 */
export function buildRecap(snapshot: SessionSnapshot): SessionRecap {
  const ageMs = Date.now() - snapshot.savedAt;
  const ageMinutes = Math.max(0, Math.round(ageMs / 60_000));

  const lastAction = lastAssistantGist(snapshot.conversation);
  const nextStep = firstActiveTask(snapshot.activeTasks);
  const blockers = failedTaskDescriptions(snapshot.activeTasks);

  return {
    title: autoNameFromSnapshot(snapshot),
    ageMinutes,
    lastAction,
    nextStep,
    blockers,
    filesTouchedCount: snapshot.trackedFiles.length,
    costUsd: snapshot.totalCost,
    contextTokens: snapshot.contextTokensUsed,
  };
}

function lastAssistantGist(conversation: readonly ConversationMessage[]): string | undefined {
  // Walk backwards for the most recent assistant turn with substantive
  // content (not just a tool invocation marker). Trim to the first
  // sentence or 140 chars — whichever is shorter.
  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i];
    if (msg?.role !== "assistant") continue;
    const text = msg.content.trim();
    if (text.length < 8) continue;
    const firstSentence = text.split(/[.!?]\s|\n/)[0] ?? text;
    return firstSentence.length > 140 ? firstSentence.slice(0, 137) + "…" : firstSentence;
  }
  return undefined;
}

function firstActiveTask(tasks: readonly ActiveTask[]): string | undefined {
  const active = tasks.find((t) => t.status === "in-progress");
  return active?.description;
}

function failedTaskDescriptions(tasks: readonly ActiveTask[]): readonly string[] {
  return tasks.filter((t) => t.status === "failed").map((t) => t.description);
}

/**
 * Render the recap as a compact markdown block suitable for the resume
 * prompt. Targets <= 500 characters so it doesn't crowd the first turn
 * context window the way the full snapshot does.
 */
export function renderRecap(recap: SessionRecap): string {
  const ageStr =
    recap.ageMinutes < 60
      ? `${recap.ageMinutes}m ago`
      : `${Math.round(recap.ageMinutes / 60)}h ago`;

  const lines: string[] = [`# Resumed: ${recap.title} (${ageStr})`, ""];

  if (recap.lastAction) {
    lines.push(`**Last action:** ${recap.lastAction}`);
  }
  if (recap.nextStep) {
    lines.push(`**Next step:** ${recap.nextStep}`);
  }
  if (recap.blockers.length > 0) {
    lines.push(`**Blocked:** ${recap.blockers.slice(0, 3).join(", ")}`);
  }
  if (recap.filesTouchedCount > 0) {
    lines.push(
      `**Session so far:** ${recap.filesTouchedCount} files touched, ` +
        `~${recap.contextTokens} tokens, $${recap.costUsd.toFixed(4)}.`,
    );
  }

  return lines.join("\n");
}
