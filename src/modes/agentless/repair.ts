/**
 * Agentless REPAIR phase.
 *
 * Goal: given the issue + top-K candidate files (from LOCALIZE), produce
 * a unified diff that fixes the bug. Single-shot to a stronger model
 * (Sonnet/Opus) with strict output format.
 *
 * QB #6 (honest stubs): if the model returns no parseable diff, RepairResult.diff
 * is `null` with explicit `error` — caller branches deliberately, never assumes PASS.
 * QB #7 (per-call state): every repair gets fresh context object; no shared accumulator.
 */

import { readFile } from "node:fs/promises";
import type { AgentlessIssue, AgentlessModel, LocalizeResult, RepairResult } from "./types.js";

export interface RepairOptions {
  /** Strong model (e.g. Sonnet) to produce the diff. */
  readonly model: AgentlessModel;
  /** Repo root for resolving candidate file paths. */
  readonly root: string;
  /** Max bytes per file when reading context (default 32 KiB). */
  readonly maxBytesPerFile?: number;
  /** ReadFile shim — injectable for tests. */
  readonly readFileFn?: (path: string) => Promise<string>;
  /** Override system prompt (default: AGENTLESS_REPAIR_PROMPT). */
  readonly systemPrompt?: string;
}

export const AGENTLESS_REPAIR_PROMPT = [
  "You are a senior engineer fixing a single-issue bug in an existing codebase.",
  "You will be given an issue description and the contents of 1-5 candidate files.",
  "Output a single unified diff (git format) that fixes the issue.",
  "Wrap the diff in a ```diff fenced block. Output NOTHING else outside the fence.",
  "If you cannot determine a safe fix from the given context, output an empty fence.",
  "Do not add comments explaining the diff — the diff is the entire response.",
].join("\n");

/**
 * Run the REPAIR phase. Always returns a RepairResult (never throws).
 */
export async function repairIssue(
  issue: AgentlessIssue,
  localize: LocalizeResult,
  opts: RepairOptions,
): Promise<RepairResult> {
  const t0 = Date.now();

  const context = await buildRepairContext(
    localize.candidateFiles.map((c) => c.file),
    opts,
  );

  const userMessage = [
    `# Issue: ${issue.title}`,
    "",
    issue.body || "(no body)",
    "",
    "----",
    "Candidate files:",
    "",
    context,
  ].join("\n");

  const systemPrompt = opts.systemPrompt ?? AGENTLESS_REPAIR_PROMPT;

  let response: { readonly text: string; readonly tokensIn: number; readonly tokensOut: number };
  try {
    response = await opts.model.query(`${systemPrompt}\n\n${userMessage}`, { maxTokens: 4000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      diff: null,
      rawResponse: "",
      modelUsed: opts.model.name,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: Date.now() - t0,
      error: `model failed: ${msg}`,
    };
  }

  const diff = extractUnifiedDiff(response.text);
  const result: RepairResult = {
    diff,
    rawResponse: response.text,
    modelUsed: opts.model.name,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    durationMs: Date.now() - t0,
    error: diff === null ? "could not extract a unified diff from response" : undefined,
  };
  return result;
}

/**
 * Build the context block — read each candidate file, fence its content,
 * truncate if oversized. Files that cannot be read are skipped silently
 * (best-effort context — repair can still succeed with a partial set).
 */
export async function buildRepairContext(
  files: readonly string[],
  opts: RepairOptions,
): Promise<string> {
  const reader = opts.readFileFn ?? defaultReadFile;
  const maxBytes = opts.maxBytesPerFile ?? 32 * 1024;
  const blocks: string[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await reader(file);
    } catch {
      continue;
    }
    if (Buffer.byteLength(content, "utf8") > maxBytes) {
      content = content.slice(0, maxBytes) + "\n... (truncated)\n";
    }
    blocks.push(["```ts", `// ${file}`, content, "```"].join("\n"));
  }
  return blocks.length === 0 ? "(no readable candidate files)" : blocks.join("\n\n");
}

/**
 * Extract a unified diff from a model response. Searches for ` ```diff `
 * fenced blocks first, falls back to anything that looks like a diff
 * (starts with `diff --git ` or `--- /dev/null`).
 *
 * Returns `null` if no parseable diff was found — callers must NOT
 * default to "no-op" because we'd never know.
 */
export function extractUnifiedDiff(text: string): string | null {
  const fenceMatch = /```diff\s*\n([\s\S]*?)\n```/.exec(text);
  if (fenceMatch && fenceMatch[1]) {
    const candidate = fenceMatch[1].trim();
    if (candidate.length === 0) return null;
    if (looksLikeDiff(candidate)) return candidate;
  }

  // Fallback: bare diff text (some models forget the fence).
  const trimmed = text.trim();
  if (looksLikeDiff(trimmed)) return trimmed;

  return null;
}

function looksLikeDiff(s: string): boolean {
  return (
    s.startsWith("diff --git ") ||
    s.startsWith("--- ") ||
    s.startsWith("Index: ") ||
    s.includes("\n@@ ")
  );
}

async function defaultReadFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}
