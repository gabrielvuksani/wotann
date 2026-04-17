/**
 * @terminal chat mention (C8) — parse a `@terminal` reference in a
 * user prompt and produce a context attachment describing the live
 * terminal state.
 *
 * Pattern borrowed from Conductor: rather than copy/paste long
 * terminal output into the chat, the user types `@terminal` and the
 * agent automatically pulls the buffer tail, the active cwd, and the
 * last command into the prompt as a structured attachment.
 *
 * This module owns parsing + attachment shaping. Buffer capture
 * itself lives in the terminal-backends layer — callers pass the
 * snapshot in.
 */

export interface TerminalSnapshot {
  readonly cwd: string;
  readonly lastCommand: string | undefined;
  readonly lastExitCode: number | undefined;
  readonly bufferTail: string; // last ~2000 chars of the terminal
  readonly capturedAt: number; // Date.now()
}

export interface TerminalAttachment {
  readonly kind: "terminal";
  readonly uri: string;
  readonly summary: string;
  readonly body: string;
  readonly ageMs: number;
}

export interface MentionParseResult {
  readonly mentionedTerminal: boolean;
  readonly cleaned: string; // prompt with `@terminal` token replaced by a placeholder
  readonly raw: string;
}

// ── Parser ───────────────────────────────────────────────────

const MENTION_RE = /@terminal\b/gi;

export function parseTerminalMention(raw: string): MentionParseResult {
  const mentioned = MENTION_RE.test(raw);
  // Reset the stateful regex flag for the next call
  MENTION_RE.lastIndex = 0;
  if (!mentioned) {
    return { mentionedTerminal: false, cleaned: raw, raw };
  }
  // Replace each `@terminal` with a structured placeholder the agent
  // can key on. Preserve the raw prompt for audit.
  const cleaned = raw.replace(MENTION_RE, "[terminal attachment]");
  return { mentionedTerminal: true, cleaned, raw };
}

// ── Attachment builder ───────────────────────────────────────

const MAX_BUFFER_CHARS = 2000;

export function buildTerminalAttachment(snapshot: TerminalSnapshot): TerminalAttachment {
  const tail = snapshot.bufferTail.slice(-MAX_BUFFER_CHARS);
  const ageMs = Math.max(0, Date.now() - snapshot.capturedAt);
  const summary = buildSummary(snapshot, ageMs);
  const body = buildBody(snapshot, tail);
  return {
    kind: "terminal",
    uri: `terminal://${encodeURIComponent(snapshot.cwd)}/snapshot`,
    summary,
    body,
    ageMs,
  };
}

function buildSummary(s: TerminalSnapshot, ageMs: number): string {
  const ageStr = ageMs < 60_000 ? "<1m ago" : `${Math.round(ageMs / 60_000)}m ago`;
  const cmdTail = s.lastCommand ? ` · last: \`${truncate(s.lastCommand, 40)}\`` : "";
  const exit =
    s.lastExitCode !== undefined ? (s.lastExitCode === 0 ? "" : ` (exit ${s.lastExitCode})`) : "";
  return `Terminal · ${shortPath(s.cwd)} · captured ${ageStr}${cmdTail}${exit}`;
}

function buildBody(s: TerminalSnapshot, tail: string): string {
  const lines: string[] = [];
  lines.push(`# Terminal attachment`);
  lines.push(`cwd: ${s.cwd}`);
  if (s.lastCommand !== undefined) lines.push(`last command: ${s.lastCommand}`);
  if (s.lastExitCode !== undefined) lines.push(`last exit code: ${s.lastExitCode}`);
  lines.push("");
  lines.push("```text");
  lines.push(tail);
  lines.push("```");
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function shortPath(path: string): string {
  const home = process.env["HOME"] ?? "";
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

// ── Placeholder resolver ─────────────────────────────────────

/**
 * Replace the `[terminal attachment]` placeholder in a cleaned
 * prompt with a human-readable summary + body. Callers wire this
 * right before the model sees the prompt so the model treats the
 * terminal state as first-class context.
 */
export function inlineAttachment(cleaned: string, attachment: TerminalAttachment): string {
  return cleaned.replace("[terminal attachment]", `[${attachment.summary}]\n\n${attachment.body}`);
}
