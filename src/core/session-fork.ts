/**
 * Session Fork — branch a new session from an existing one.
 *
 * Port of `codex fork` (research/codex/codex-rs/cli/src/main.rs:148, 270-289).
 * Codex calls this "Fork a previous interactive session". The use case:
 * the user wants to "what-if" a conversation — try a different prompt path
 * without losing the original. Pairs naturally with WOTANN's loop detector
 * (commit 0ca2fd3): when a loop is detected we can suggest
 * `wotann fork-session --last` to retry from before the loop.
 *
 * Implementation note: this helper only READS via session.ts's public APIs
 * (`restoreSession`, `findLatestSession`, `saveSession`). We deliberately
 * do NOT touch the SessionStore class — the caller (src/index.ts) owns the
 * write boundary, and the file split keeps SessionStore's class-internal
 * invariants out of the fork concern.
 *
 * Quality bar: honest stub > over-engineering. If the source session can
 * be loaded and re-saved with a fresh id, fork works. If not, we return
 * a structured error instead of pretending success.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { findLatestSession, restoreSession, saveSession } from "./session.js";
import type { SessionState } from "./types.js";

// ── Types ───────────────────────────────────────────────

export interface ForkSessionResult {
  readonly ok: boolean;
  readonly newSessionId?: string;
  readonly newSessionPath?: string;
  readonly sourceSessionId?: string;
  readonly messageCount?: number;
  readonly error?: string;
}

export interface ForkSessionOptions {
  /** Source session id. Mutually exclusive with `last`. */
  readonly sessionId?: string;
  /** Fork the most recent session for this cwd. */
  readonly last?: boolean;
  /**
   * If true, search across ALL sessions in `sessionDir` regardless of cwd.
   * Default: false (cwd-filtered, matches `wotann resume`'s default).
   */
  readonly all?: boolean;
  /** Explicit session dir; defaults to `<cwd>/.wotann/sessions`. */
  readonly sessionDir?: string;
}

// ── Public API ──────────────────────────────────────────

/**
 * Fork a session: copy the source rollout to a new session id, persist it,
 * return the new id. Caller is responsible for printing user-facing output.
 *
 * Exit-code mapping (caller in src/index.ts):
 *   - ok: true                              → exit 0
 *   - ok: false, error matches /not found/  → exit 1
 *   - ok: false, error matches /argument/   → exit 2
 */
export function forkSession(opts: ForkSessionOptions): ForkSessionResult {
  const sessionDir = opts.sessionDir ?? join(process.cwd(), ".wotann", "sessions");

  // Argument validation: exactly one of {sessionId, last} must be set.
  // `--all` only widens the search space when paired with `--last`.
  if (!opts.sessionId && !opts.last) {
    return {
      ok: false,
      error: "argument: pass <sessionId> or --last (use --all to widen --last across all cwds)",
    };
  }
  if (opts.sessionId && opts.last) {
    return {
      ok: false,
      error: "argument: --last conflicts with explicit <sessionId>",
    };
  }

  // Resolve the source session file path.
  let sourcePath: string | null = null;
  if (opts.sessionId) {
    const candidate = join(sessionDir, `${opts.sessionId}.json`);
    if (existsSync(candidate)) {
      sourcePath = candidate;
    }
  } else if (opts.last) {
    sourcePath = opts.all ? findLatestSessionAllCwds(sessionDir) : findLatestSession(sessionDir);
  }

  if (!sourcePath || !existsSync(sourcePath)) {
    return {
      ok: false,
      error: opts.sessionId
        ? `session not found: ${opts.sessionId} (looked in ${sessionDir})`
        : `session not found: no recorded sessions in ${sessionDir}`,
    };
  }

  const source = restoreSession(sourcePath);
  if (!source) {
    return {
      ok: false,
      error: `session not found: ${sourcePath} could not be deserialized (corrupt or wrong version)`,
    };
  }

  // Build the forked state. Codex's fork copies ALL prior messages into a
  // new conversation — the user can then steer in a new direction. We
  // mirror that exactly: copy messages verbatim, mint a fresh id, reset
  // the startedAt clock so the new session's stats reflect the FORK time
  // (not the source's original start). Costs/tokens are inherited so the
  // fork's running tally still reflects the conversation history's
  // already-paid context.
  const newId = randomUUID();
  const forked: SessionState = {
    id: newId,
    startedAt: new Date(),
    provider: source.provider,
    model: source.model,
    totalTokens: source.totalTokens,
    totalCost: source.totalCost,
    toolCalls: source.toolCalls,
    messages: [...source.messages],
    incognito: source.incognito ?? false,
  };

  const newPath = saveSession(forked, sessionDir);

  return {
    ok: true,
    newSessionId: newId,
    newSessionPath: newPath,
    sourceSessionId: source.id,
    messageCount: source.messages.length,
  };
}

// ── Internals ───────────────────────────────────────────

/**
 * `findLatestSession` (in session.ts) filters by `cwd === process.cwd()`,
 * matching `wotann resume`'s default. The `--all` flag widens that to ALL
 * recorded sessions regardless of cwd. We replicate session.ts's logic
 * here rather than reaching into its private filter, because session.ts
 * is on the read-only list (the prompt forbids writes there).
 */
function findLatestSessionAllCwds(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;
  let latest: { path: string; mtime: number } | null = null;
  for (const file of readdirSync(sessionDir)) {
    if (!file.endsWith(".json")) continue;
    const p = join(sessionDir, file);
    try {
      const st = statSync(p);
      // Prefer savedAt from inside the file (matches session.ts's
      // ordering); fall back to filesystem mtime if read fails.
      let savedAt = st.mtimeMs;
      try {
        const data = JSON.parse(readFileSync(p, "utf-8")) as {
          savedAt?: string;
        };
        if (data.savedAt) {
          const parsed = new Date(data.savedAt).getTime();
          if (Number.isFinite(parsed)) savedAt = parsed;
        }
      } catch {
        // Use filesystem mtime — already set above.
      }
      if (latest === null || savedAt > latest.mtime) {
        latest = { path: p, mtime: savedAt };
      }
    } catch {
      // Stat failed — skip this file.
    }
  }
  return latest?.path ?? null;
}
