/**
 * FileTransport — file-based inbox/outbox for inter-agent coordination.
 *
 * Port of HKUDS/ClawTeam's clawteam/transport/file.py, adapted to TS.
 * Each agent in a team has a directory at:
 *   ~/.wotann/teams/<team>/inboxes/<agent>/
 * Messages land as `msg-<uuid>.json`. A consumer claims one by
 * atomically renaming it to `msg-<uuid>.consumed`. After processing
 * the consumer renames again to `msg-<uuid>.done` (or moves it to
 * `dead_letters/` on failure).
 *
 * Locking: rename(2) on POSIX is atomic, so we use rename as the
 * claim primitive — no fcntl needed and no platform branching. The
 * Python original locks via fcntl/msvcrt because it has multiple
 * readers on the SAME file; we use one-file-per-message so the
 * rename-as-claim pattern is sufficient.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

export interface InboxMessage {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly meta?: Readonly<Record<string, string>>;
  readonly enqueuedAt: string;
}

const TEAM_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function validateName(s: string, kind: string): string {
  if (!TEAM_NAME_PATTERN.test(s)) {
    throw new Error(`Invalid ${kind} "${s}": must match ${TEAM_NAME_PATTERN}`);
  }
  return s;
}

function teamRoot(): string {
  const root = resolveWotannHomeSubdir("teams");
  mkdirSync(root, { recursive: true });
  return root;
}

function inboxDir(team: string, agent: string): string {
  const dir = join(teamRoot(), validateName(team, "team"), "inboxes", validateName(agent, "agent"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function deadLetterDir(team: string, agent: string): string {
  const dir = join(
    teamRoot(),
    validateName(team, "team"),
    "dead_letters",
    validateName(agent, "agent"),
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class FileTransport {
  send(args: {
    readonly team: string;
    readonly from: string;
    readonly to: string;
    readonly body: string;
    readonly meta?: Readonly<Record<string, string>>;
  }): InboxMessage {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const message: InboxMessage = {
      id,
      from: args.from,
      to: args.to,
      body: args.body,
      meta: args.meta,
      enqueuedAt: new Date().toISOString(),
    };
    const path = join(inboxDir(args.team, args.to), `msg-${id}.json`);
    writeFileSync(path, JSON.stringify(message, null, 2), { encoding: "utf8", mode: 0o600 });
    return message;
  }

  receive(team: string, agent: string, max = 10): ReadonlyArray<InboxMessage> {
    const dir = inboxDir(team, agent);
    const claimed: InboxMessage[] = [];
    const entries = listEnvelopes(dir);
    for (const entry of entries) {
      if (claimed.length >= max) break;
      const claimedPath = entry.replace(/\.json$/, ".consumed");
      try {
        renameSync(entry, claimedPath); // atomic claim
      } catch {
        continue; // someone else got it
      }
      try {
        const raw = readFileSync(claimedPath, "utf8");
        claimed.push(JSON.parse(raw) as InboxMessage);
        renameSync(claimedPath, claimedPath.replace(/\.consumed$/, ".done"));
      } catch (err) {
        const dlPath = join(
          deadLetterDir(team, agent),
          entry.split("/").pop() ?? "msg-corrupt.json",
        );
        try {
          renameSync(claimedPath, dlPath);
        } catch {
          // best-effort
        }
        throw err;
      }
    }
    return claimed;
  }

  peek(team: string, agent: string): number {
    return listEnvelopes(inboxDir(team, agent)).length;
  }

  /** All messages, including already-consumed and done — used by `wotann teams board`. */
  history(
    team: string,
    agent: string,
    limit = 50,
  ): ReadonlyArray<{
    readonly state: "pending" | "consumed" | "done";
    readonly path: string;
    readonly mtimeMs: number;
  }> {
    const dir = inboxDir(team, agent);
    if (!existsSync(dir)) return [];
    const items = readdirSync(dir)
      .filter((f) => f.startsWith("msg-"))
      .map((f) => {
        const full = join(dir, f);
        const stat = statSync(full);
        const state: "pending" | "consumed" | "done" = f.endsWith(".json")
          ? "pending"
          : f.endsWith(".consumed")
            ? "consumed"
            : "done";
        return { state, path: full, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);
    return items;
  }
}

function listEnvelopes(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("msg-") && f.endsWith(".json"))
    .map((f) => join(dir, f))
    .sort();
}

export function makeFileTransport(): FileTransport {
  return new FileTransport();
}
