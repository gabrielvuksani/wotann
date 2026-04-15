/**
 * Tools prompt module — dynamic tool loading for token efficiency.
 *
 * FROM CURSOR RESEARCH (Source #51):
 * "Store descriptions as files, show only names. 46.9% token savings."
 *
 * FROM VERCEL FINDING (Source #50):
 * "Went from 15 tools to 2 and accuracy went from 80% to 100%."
 *
 * Strategy: inject only tool NAMES into the system prompt (~50 tokens).
 * Full tool schemas loaded on-demand when the model invokes a tool.
 * Task-relevant tools get brief descriptions; irrelevant tools are name-only.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

// ── Tool Categories ──────────────────────────────────────

interface ToolEntry {
  readonly name: string;
  readonly brief: string; // One-line description (~10 tokens)
  readonly category: "core" | "standard" | "enhanced" | "specialist";
}

// S2-16: This list is the prompt-injection catalog — what the model is told
// exists. The runtime tool-dispatch layer (agent-bridge + Claude SDK)
// registers the actual callable set independently; keeping this file in sync
// is a discipline task. The previous version listed the fictional
// "HashlineEdit" and was missing "NotebookEdit" (referenced by
// middleware/deferred-tool-filter.ts and sandbox/security.ts).
const TOOL_CATALOG: readonly ToolEntry[] = [
  // Core (always available)
  { name: "Read", brief: "Read files with line numbers", category: "core" },
  { name: "Write", brief: "Create or overwrite files", category: "core" },
  { name: "Edit", brief: "String replacement in files", category: "core" },
  { name: "NotebookEdit", brief: "Jupyter notebook cell edits", category: "core" },
  { name: "Glob", brief: "File pattern matching", category: "core" },
  { name: "Grep", brief: "Content search", category: "core" },
  { name: "Bash", brief: "Shell command execution", category: "core" },
  {
    name: "LSP",
    brief: "Language server operations (find_symbol, rename_symbol)",
    category: "core",
  },

  // Standard (loaded by default)
  {
    name: "WebSearch",
    brief: "Web search (Gemini grounding when available)",
    category: "standard",
  },
  { name: "WebFetch", brief: "Fetch URL content (SSRF-guarded)", category: "standard" },
  { name: "Agent", brief: "Spawn a subagent with focused task", category: "standard" },
  { name: "Skill", brief: "Invoke a skill file for domain guidance", category: "standard" },
  { name: "TaskCreate", brief: "Create a tracked task", category: "standard" },

  // Enhanced (on-demand)
  {
    name: "EnterWorktree",
    brief: "Switch to a git worktree for isolated edits",
    category: "enhanced",
  },
  { name: "ExitWorktree", brief: "Leave the current worktree and clean up", category: "enhanced" },
  { name: "ComputerUse", brief: "Perceive + control the screen", category: "specialist" },
];

/**
 * Determine which tools are relevant to the current task.
 * Only relevant tools get brief descriptions; others are name-only.
 */
function getRelevantTools(ctx: PromptContext): readonly string[] {
  const mode = ctx.mode ?? "default";

  // Core tools always get descriptions
  const lines: string[] = ["Tools available (invoke by name — schemas loaded on use):"];

  // Core tools — always listed with descriptions
  const core = TOOL_CATALOG.filter((t) => t.category === "core");
  lines.push(`Core: ${core.map((t) => t.name).join(", ")}`);

  // Standard tools — listed with brief descriptions
  const standard = TOOL_CATALOG.filter((t) => t.category === "standard");
  lines.push(`Standard: ${standard.map((t) => t.name).join(", ")}`);

  // Mode-specific tools
  if (mode === "exploit") {
    lines.push("Security: nmap, sqlmap, nuclei, gobuster (via Bash)");
  }

  if (mode === "autonomous" || mode === "auto") {
    lines.push("Autonomous: TaskCreate for planning, Agent for parallel work");
  }

  // Enhanced tools — name only, schema loaded when invoked
  const enhanced = TOOL_CATALOG.filter(
    (t) => t.category === "enhanced" || t.category === "specialist",
  );
  if (enhanced.length > 0) {
    lines.push(`Enhanced (on-demand): ${enhanced.map((t) => t.name).join(", ")}`);
  }

  return lines;
}

export const toolsPromptModule: PromptModuleEntry = {
  name: "tools",
  priority: 92,
  build(ctx: PromptContext): readonly string[] {
    if (ctx.isMinimal) {
      // Sub-agents get minimal tool list
      return ["Tools: Read, Edit, Glob, Grep, Bash"];
    }
    return getRelevantTools(ctx);
  },
};
