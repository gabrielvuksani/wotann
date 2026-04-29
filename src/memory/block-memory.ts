/**
 * Block-typed memory — port of letta-ai/letta + claude-subconscious.
 *
 * What it is: a small registry of *named* memory blocks, each with a
 * fixed character-budget. Unlike the existing semantic-search memory
 * (mem-palace, atomic-memory), blocks are *always-loaded* — they get
 * injected into the model's system context on every turn via the
 * GuidanceWhisper hook. Think of them as a controlled "permanent
 * scratchpad" the agent reads every turn.
 *
 * Block kinds (matches letta's 8-block taxonomy plus 4 user-extensible
 * slots, capped at 12 active to keep the context-injection bounded):
 *   - persona — how the agent should behave/sound (4 KB)
 *   - human   — facts about the user it should remember (4 KB)
 *   - task    — current task focus (2 KB)
 *   - project — project-level conventions and constraints (4 KB)
 *   - scratch — short-lived working memory (2 KB)
 *   - issues  — known bugs / pending state (2 KB)
 *   - decisions — architectural decisions log (2 KB)
 *   - bindings — env/secret aliases (1 KB)
 *   - custom1..4 — user-defined slots (2 KB each)
 *
 * Storage: `~/.wotann/blocks/<name>.json` — one file per block. We use
 * one file per block (rather than a single JSON registry) so that
 * concurrent writers from multiple WOTANN sessions don't trample each
 * other on a serialized JSON object. Each file is independently
 * truncated to its character cap on write (QB: hard truncation, never
 * silent drop — if you exceed the cap, the tail is sliced but a
 * `truncated_at: ISO8601` marker is recorded so the agent can detect it).
 */

import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

export type BlockKind =
  | "persona"
  | "human"
  | "task"
  | "project"
  | "scratch"
  | "issues"
  | "decisions"
  | "bindings"
  | "custom1"
  | "custom2"
  | "custom3"
  | "custom4";

export const BLOCK_KINDS: ReadonlyArray<BlockKind> = [
  "persona",
  "human",
  "task",
  "project",
  "scratch",
  "issues",
  "decisions",
  "bindings",
  "custom1",
  "custom2",
  "custom3",
  "custom4",
];

const BLOCK_LIMITS: Readonly<Record<BlockKind, number>> = Object.freeze({
  persona: 4096,
  human: 4096,
  task: 2048,
  project: 4096,
  scratch: 2048,
  issues: 2048,
  decisions: 2048,
  bindings: 1024,
  custom1: 2048,
  custom2: 2048,
  custom3: 2048,
  custom4: 2048,
});

export interface MemoryBlock {
  readonly kind: BlockKind;
  readonly content: string;
  readonly updatedAt: string;
  readonly truncatedAt?: string;
}

export interface BlockSummary {
  readonly kind: BlockKind;
  readonly bytes: number;
  readonly limit: number;
  readonly truncated: boolean;
  readonly updatedAt: string;
}

const BLOCK_DIR_NAME = "blocks";

function blocksDir(): string {
  const dir = resolveWotannHomeSubdir(BLOCK_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function blockPath(kind: BlockKind): string {
  return join(blocksDir(), `${kind}.json`);
}

export function getBlockLimit(kind: BlockKind): number {
  return BLOCK_LIMITS[kind];
}

export function readBlock(kind: BlockKind): MemoryBlock | null {
  try {
    const raw = readFileSync(blockPath(kind), "utf8");
    const parsed = JSON.parse(raw) as Partial<MemoryBlock>;
    if (typeof parsed.content !== "string") return null;
    return {
      kind,
      content: parsed.content,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      truncatedAt: typeof parsed.truncatedAt === "string" ? parsed.truncatedAt : undefined,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function writeBlock(kind: BlockKind, content: string): MemoryBlock {
  const limit = BLOCK_LIMITS[kind];
  const exceeded = content.length > limit;
  const truncated = exceeded ? content.slice(0, limit) : content;
  const block: MemoryBlock = {
    kind,
    content: truncated,
    updatedAt: new Date().toISOString(),
    truncatedAt: exceeded ? new Date().toISOString() : undefined,
  };
  writeFileSync(blockPath(kind), JSON.stringify(block, null, 2), { encoding: "utf8", mode: 0o600 });
  return block;
}

export function appendBlock(kind: BlockKind, addition: string, separator = "\n"): MemoryBlock {
  const existing = readBlock(kind);
  const next = existing ? `${existing.content}${separator}${addition}` : addition;
  return writeBlock(kind, next);
}

export function clearBlock(kind: BlockKind): boolean {
  try {
    unlinkSync(blockPath(kind));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export function listBlocks(): ReadonlyArray<BlockSummary> {
  const dir = blocksDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const summaries: BlockSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const kind = entry.slice(0, -".json".length) as BlockKind;
    if (!BLOCK_KINDS.includes(kind)) continue;
    try {
      const block = readBlock(kind);
      if (!block) continue;
      const stat = statSync(join(dir, entry));
      summaries.push({
        kind,
        bytes: Buffer.byteLength(block.content, "utf8"),
        limit: BLOCK_LIMITS[kind],
        truncated: Boolean(block.truncatedAt),
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {
      // ignore corrupt entries — listing is best-effort
    }
  }
  summaries.sort((a, b) => a.kind.localeCompare(b.kind));
  return summaries;
}

/**
 * Returns the rendered system-context block for injection into the
 * model. Format intentionally mirrors letta's "core memory" section so
 * any agent already trained on letta-style memory patterns recognizes
 * the shape immediately.
 */
export function renderActiveBlocks(): string {
  const blocks: MemoryBlock[] = [];
  for (const kind of BLOCK_KINDS) {
    const b = readBlock(kind);
    if (b && b.content.trim().length > 0) blocks.push(b);
  }
  if (blocks.length === 0) return "";
  const parts: string[] = ["<core_memory>"];
  for (const b of blocks) {
    const limit = BLOCK_LIMITS[b.kind];
    const used = Buffer.byteLength(b.content, "utf8");
    parts.push(
      `  <block kind="${b.kind}" bytes="${used}/${limit}"${b.truncatedAt ? ' truncated="true"' : ""}>`,
    );
    parts.push(b.content);
    parts.push(`  </block>`);
  }
  parts.push("</core_memory>");
  return parts.join("\n");
}

export function isValidBlockKind(s: string): s is BlockKind {
  return (BLOCK_KINDS as ReadonlyArray<string>).includes(s);
}
