/**
 * Harness Intelligence — 7 Native Overrides.
 * Structural fixes for weaknesses in every agent harness.
 * Each override is a deterministic rule enforced at the harness level.
 */

import type { AgentMessage } from "../core/types.js";

// ── Override 1: Forced Verification Loop ────────────────────
// (Implemented in middleware/layers.ts as `forcedVerificationMiddleware`
//  at order 15. See docs/internal/VERIFICATION_LAYERS.md for the full
//  4-layer verification flow.)

// ── Override 2: Step 0 Deletion ─────────────────────────────

export interface Step0Result {
  readonly shouldClean: boolean;
  readonly deadCodeLines: number;
  readonly suggestion?: string;
}

export function shouldRunStep0(fileLineCount: number, isRefactor: boolean): Step0Result {
  if (!isRefactor || fileLineCount <= 300) {
    return { shouldClean: false, deadCodeLines: 0 };
  }

  return {
    shouldClean: true,
    deadCodeLines: 0,
    suggestion:
      `File has ${fileLineCount} lines and this is a structural refactor. ` +
      `Run dead-code elimination before modifying. ` +
      `Remove unused imports, unreachable code, and commented-out blocks first.`,
  };
}

// ── Override 3: Senior Dev Quality Bar ──────────────────────

export const SENIOR_DEV_PROMPT = `Before finalizing any code change, review it as a senior developer would:
- Would this pass code review at a top-tier engineering org?
- Are there any edge cases not handled?
- Is error handling comprehensive?
- Is the code readable without comments?
- Are names descriptive and consistent?
Fix all issues before presenting the result.`;

// ── Override 4: Mandatory Sub-Agent Swarming ────────────────

export interface SwarmDecision {
  readonly shouldSwarm: boolean;
  readonly batchCount: number;
  readonly batchSize: number;
  readonly reason?: string;
}

export function shouldSwarm(independentFileCount: number): SwarmDecision {
  if (independentFileCount <= 5) {
    return { shouldSwarm: false, batchCount: 1, batchSize: independentFileCount };
  }

  const batchSize = Math.min(8, Math.max(5, Math.ceil(independentFileCount / 3)));
  const batchCount = Math.ceil(independentFileCount / batchSize);

  return {
    shouldSwarm: true,
    batchCount,
    batchSize,
    reason:
      `${independentFileCount} independent files detected. ` +
      `Decomposing into ${batchCount} batches of ~${batchSize} files. ` +
      `Each sub-agent gets ~167K fresh context.`,
  };
}

// ── Override 5: File Read Chunking ──────────────────────────

export interface ChunkResult {
  readonly shouldChunk: boolean;
  readonly chunkCount: number;
  readonly chunkSize: number;
}

export function shouldChunkFile(lineCount: number, chunkSize: number = 500): ChunkResult {
  if (lineCount <= chunkSize) {
    return { shouldChunk: false, chunkCount: 1, chunkSize: lineCount };
  }

  const chunkCount = Math.ceil(lineCount / chunkSize);
  return {
    shouldChunk: true,
    chunkCount,
    chunkSize,
  };
}

export function getChunkRange(
  chunkIndex: number,
  chunkSize: number,
  totalLines: number,
): { start: number; end: number } {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, totalLines);
  return { start, end };
}

// ── Override 6: Truncation Detection ────────────────────────

export interface TruncationCheck {
  readonly isTruncated: boolean;
  readonly expectedMinLines: number;
  readonly actualLines: number;
  readonly suggestion?: string;
}

export function detectTruncation(
  toolName: string,
  resultContent: string,
  expectedScope: "file" | "directory" | "search",
): TruncationCheck {
  const actualLines = resultContent.split("\n").length;

  const thresholds: Record<string, number> = {
    file: 10,
    directory: 3,
    search: 1,
  };

  const minExpected = thresholds[expectedScope] ?? 5;

  if (actualLines < minExpected && resultContent.length < 100) {
    return {
      isTruncated: true,
      expectedMinLines: minExpected,
      actualLines,
      suggestion:
        `Result from ${toolName} seems suspiciously small (${actualLines} lines). ` +
        `Consider re-running with a narrower or broader scope.`,
    };
  }

  return {
    isTruncated: false,
    expectedMinLines: minExpected,
    actualLines,
  };
}

// ── Override 7: AST-Level Search for Renames ────────────────

export interface RenameSearchPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

export function generateRenameSearchPatterns(symbolName: string): readonly RenameSearchPattern[] {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return [
    { name: "direct_calls", pattern: new RegExp(`\\b${escaped}\\s*\\(`, "g") },
    { name: "type_references", pattern: new RegExp(`:\\s*${escaped}\\b`, "g") },
    { name: "string_literals", pattern: new RegExp(`['"\`]${escaped}['"\`]`, "g") },
    { name: "dynamic_imports", pattern: new RegExp(`import\\(.*${escaped}.*\\)`, "g") },
    { name: "re_exports", pattern: new RegExp(`export\\s*\\{[^}]*${escaped}[^}]*\\}`, "g") },
    { name: "test_references", pattern: new RegExp(`(describe|it|test)\\([^)]*${escaped}`, "g") },
  ];
}

// ── Live Runtime Enforcement ───────────────────────────────

export interface OverrideDirective {
  readonly systemPromptFragments: readonly string[];
  readonly notices: readonly string[];
  readonly step0?: Step0Result;
  readonly swarm?: SwarmDecision;
  readonly chunking?: ChunkResult;
  readonly renamePatterns?: readonly RenameSearchPattern[];
}

export function buildOverrideDirective(
  prompt: string,
  context: readonly AgentMessage[] = [],
): OverrideDirective {
  const systemPromptFragments: string[] = [
    `OVERRIDE 3 — Senior Dev Quality Bar:\n${SENIOR_DEV_PROMPT}`,
  ];
  const notices: string[] = [];
  const lower = prompt.toLowerCase();
  const mentionedLines = extractMentionedLineCount(prompt, context);
  const fileMatches = extractFileReferences(prompt, context);

  let step0: Step0Result | undefined;
  if (/\b(refactor|rewrite|migrate|modernize|restructure|rename)\b/i.test(lower)) {
    step0 = shouldRunStep0(mentionedLines, true);
    if (step0.shouldClean && step0.suggestion) {
      systemPromptFragments.push(`OVERRIDE 2 — Step 0 Deletion:\n${step0.suggestion}`);
      notices.push("Step 0 deletion guard enabled.");
    }
  }

  const swarm = shouldSwarm(fileMatches.length);
  if (swarm.shouldSwarm && swarm.reason) {
    systemPromptFragments.push(
      [
        "OVERRIDE 4 — Mandatory Sub-Agent Swarming:",
        swarm.reason,
        "Decompose the work into independent batches before implementation.",
      ].join("\n"),
    );
    notices.push(`Sub-agent swarming required for ${fileMatches.length} files.`);
  }

  let chunking: ChunkResult | undefined;
  if (
    mentionedLines > 500 ||
    (/\b(read|inspect|review|open)\b/.test(lower) &&
      /\b(full|entire|whole|large|500|1000)\b/.test(lower))
  ) {
    chunking = shouldChunkFile(Math.max(mentionedLines, 501));
    if (chunking.shouldChunk) {
      systemPromptFragments.push(
        [
          "OVERRIDE 5 — File Read Chunking:",
          `If you must inspect large files, read them in ${chunking.chunkSize}-line segments.`,
          `Expected chunks: ${chunking.chunkCount}.`,
        ].join("\n"),
      );
    }
  }

  const rename = extractRenameIntent(prompt);
  let renamePatterns: readonly RenameSearchPattern[] | undefined;
  if (rename) {
    renamePatterns = generateRenameSearchPatterns(rename.from);
    systemPromptFragments.push(
      [
        "OVERRIDE 7 — AST-Level Rename Search:",
        `Before renaming ${rename.from} to ${rename.to}, search all impact surfaces using these patterns:`,
        ...renamePatterns.map((pattern) => `- ${pattern.name}: ${pattern.pattern.source}`),
      ].join("\n"),
    );
    notices.push(`Rename guard prepared for ${rename.from} → ${rename.to}.`);
  }

  return {
    systemPromptFragments,
    notices,
    step0,
    swarm,
    chunking,
    renamePatterns,
  };
}

export function buildPostQueryOverrideWarning(
  prompt: string,
  resultContent: string,
): string | null {
  const scope = classifyPromptScope(prompt);
  if (!scope) return null;

  const truncation = detectTruncation("query", resultContent, scope);
  if (truncation.isTruncated && truncation.suggestion) {
    return `Override 6 — Truncation detection: ${truncation.suggestion}`;
  }

  return null;
}

function extractMentionedLineCount(prompt: string, context: readonly AgentMessage[]): number {
  const lineMention = prompt.match(/\b(\d{3,5})\s*lines?\b/i);
  if (lineMention?.[1]) {
    return parseInt(lineMention[1], 10);
  }

  const longestMessage = context.reduce(
    (max, message) => Math.max(max, message.content.split("\n").length),
    0,
  );

  return longestMessage;
}

function extractFileReferences(
  prompt: string,
  context: readonly AgentMessage[],
): readonly string[] {
  const pattern = /\b[\w./-]+\.[a-zA-Z0-9]+\b/g;
  const candidates = [
    ...(prompt.match(pattern) ?? []),
    ...context.flatMap((message) => message.content.match(pattern) ?? []),
  ];

  return [...new Set(candidates)];
}

function extractRenameIntent(prompt: string): { from: string; to: string } | null {
  const match = prompt.match(
    /\brename\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:to|->)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i,
  );
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    from: match[1],
    to: match[2],
  };
}

function classifyPromptScope(prompt: string): "file" | "directory" | "search" | null {
  const lower = prompt.toLowerCase();

  if (/\b(search|grep|find|look for|rename)\b/.test(lower)) {
    return "search";
  }
  if (/\b(folder|directory|repo|repository|workspace)\b/.test(lower)) {
    return "directory";
  }
  if (/\b(file|read|open|inspect)\b/.test(lower)) {
    return "file";
  }

  return null;
}
