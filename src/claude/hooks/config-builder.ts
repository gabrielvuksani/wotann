/**
 * Hook config builder — V9 T3.3 Wave 2.
 *
 * Emits the JSON shape the `claude` binary's `--hooks-config <file>` flag
 * expects. We keep this as a tiny pure function so the bridge can:
 *   1. Build the config in-process and write it to a temp file.
 *   2. Pass the temp-file path on the spawn argv.
 *   3. Delete the temp file when the session ends.
 *
 * The shape mirrors what code.claude.com/docs/en/hooks documents for a
 * remote-URL hook target. Each event maps to an array of one-or-more
 * URL endpoints; the binary calls every URL in order and merges
 * decisions (later overrides earlier on equal action).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeHookEvent } from "../types.js";
import { getHookRoutes } from "./server.js";

export interface HookConfigJson {
  readonly version: 1;
  readonly hooks: Partial<Record<ClaudeHookEvent, ReadonlyArray<HookEntry>>>;
}

export interface HookEntry {
  readonly type: "url";
  readonly url: string;
  readonly timeoutMs?: number;
}

/**
 * Build the in-memory config JSON. Pass the result to `writeHookConfigFile`
 * to materialize on disk.
 */
export function buildHookConfig(baseUrl: string): HookConfigJson {
  const routes = getHookRoutes(baseUrl);
  const hooks: Partial<Record<ClaudeHookEvent, HookEntry[]>> = {};
  for (const [event, url] of Object.entries(routes)) {
    if (!url) continue;
    hooks[event as ClaudeHookEvent] = [
      {
        type: "url",
        url,
        timeoutMs: event === "Stop" ? 30_000 : 5_000,
      },
    ];
  }
  return { version: 1, hooks };
}

/**
 * Write the hook config to a temp file and return the path. Caller is
 * responsible for unlinking the file after the session ends; the path is
 * deterministic per session id so a stale file from a crashed session is
 * overwritten on the next start.
 */
export function writeHookConfigFile(config: HookConfigJson, sessionId: string): string {
  const dir = join(tmpdir(), "wotann-claude-hooks");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sanitizeId(sessionId)}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: "utf-8" });
  return path;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 64);
}
