/**
 * Pure-ish helpers for the TUI shell.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { ProviderStatus } from "../core/types.js";
import type { ThinkingEffort } from "../core/runtime.js";
import { parseUnifiedDiff, type DiffHunk } from "./components/DiffViewer.js";
import type { SubagentStatus } from "./components/AgentStatusPanel.js";

export type UIPanel = "diff" | "agents" | "tasks";

export interface AttachmentResolution {
  readonly prompt: string;
  readonly attachments: readonly {
    token: string;
    path: string;
    truncated: boolean;
  }[];
  readonly errors: readonly string[];
}

export interface DiffPanelEntry {
  readonly filePath: string;
  readonly hunks: readonly DiffHunk[];
}

const PANEL_ORDER: readonly UIPanel[] = ["diff", "agents", "tasks"];
const THINKING_ORDER: readonly ThinkingEffort[] = ["low", "medium", "high", "xhigh", "max"];

export function cyclePanel(current: UIPanel): UIPanel {
  const index = PANEL_ORDER.indexOf(current);
  return PANEL_ORDER[(index + 1) % PANEL_ORDER.length] ?? "diff";
}

export function cycleThinkingEffort(current: ThinkingEffort): ThinkingEffort {
  const index = THINKING_ORDER.indexOf(current);
  return THINKING_ORDER[(index + 1) % THINKING_ORDER.length] ?? "medium";
}

export function cycleModel(current: string, providers: readonly ProviderStatus[]): string {
  const available = providers
    .filter((provider) => provider.available)
    .flatMap((provider) => provider.models);

  if (available.length === 0) return current;
  const index = available.indexOf(current);
  if (index === -1) return available[0] ?? current;
  return available[(index + 1) % available.length] ?? current;
}

export function resolveFileAttachments(
  input: string,
  workingDir: string,
  maxChars: number = 4000,
): AttachmentResolution {
  const matches = [
    ...input.matchAll(/(^|\s)@([./A-Za-z0-9_-]+(?:\/[./A-Za-z0-9_-]+)*\.[A-Za-z0-9_-]+)/g),
  ];
  if (matches.length === 0) {
    return { prompt: input, attachments: [], errors: [] };
  }

  const attachments: Array<{ token: string; path: string; truncated: boolean }> = [];
  const errors: string[] = [];
  const blocks: string[] = [];

  for (const match of matches) {
    const rawPath = match[2];
    if (!rawPath) continue;

    const absolutePath = resolve(workingDir, rawPath);
    if (!existsSync(absolutePath)) {
      errors.push(`Attachment not found: ${rawPath}`);
      continue;
    }

    const content = readFileSync(absolutePath, "utf-8");
    const truncated = content.length > maxChars;
    const excerpt = truncated ? `${content.slice(0, maxChars)}\n...[truncated]` : content;

    attachments.push({
      token: `@${rawPath}`,
      path: absolutePath,
      truncated,
    });
    blocks.push([`Attached file: ${absolutePath}`, "```text", excerpt, "```"].join("\n"));
  }

  const prompt = blocks.length > 0 ? [input, "", ...blocks].join("\n") : input;

  return { prompt, attachments, errors };
}

export function readWorkspaceDiff(workingDir: string): readonly DiffPanelEntry[] {
  try {
    const diff = execFileSync("git", ["diff", "--no-color", "--unified=1"], {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    if (!diff.trim()) return [];

    const fileSections = diff.split(/^diff --git /m).filter(Boolean);
    return fileSections
      .map((section) => {
        const fileMatch = section.match(/\ba\/(.+?)\s+b\/(.+?)\n/);
        const filePath = fileMatch?.[2] ?? fileMatch?.[1] ?? "unknown";
        const hunks = parseUnifiedDiff(section);
        return { filePath, hunks };
      })
      .filter((entry) => entry.hunks.length > 0);
  } catch {
    return [];
  }
}

export function buildPrimaryAgentStatuses(args: {
  readonly model: string;
  readonly isStreaming: boolean;
  readonly panelMode: string;
  readonly turnCount: number;
}): readonly SubagentStatus[] {
  return [
    {
      id: "primary",
      name: "Main Agent",
      model: args.model,
      status: args.isStreaming ? "running" : "queued",
      startedAt: Date.now() - Math.max(1, args.turnCount) * 1000,
      toolCalls: args.turnCount,
      currentTool: args.isStreaming ? args.panelMode : undefined,
    },
  ];
}
