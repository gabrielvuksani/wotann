/**
 * Conventions prompt module -- injects project coding conventions
 * from .editorconfig, CLAUDE.md, and .wotann/rules/ into the system prompt.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptContext, PromptModuleEntry } from "../engine.js";

/**
 * Extract coding conventions from the project configuration files.
 * Returns a compact summary suitable for system prompt injection.
 */
function extractConventions(workingDir: string): readonly string[] {
  const conventions: string[] = [];

  // .editorconfig
  const editorConfig = join(workingDir, ".editorconfig");
  if (existsSync(editorConfig)) {
    try {
      const content = readFileSync(editorConfig, "utf-8");
      const indentStyle = content.match(/indent_style\s*=\s*(\w+)/)?.[1];
      const indentSize = content.match(/indent_size\s*=\s*(\d+)/)?.[1];
      if (indentStyle) conventions.push(`Indent: ${indentStyle}${indentSize ? ` (${indentSize})` : ""}`);
    } catch {
      // Skip unreadable config
    }
  }

  // CLAUDE.md / .wotann/AGENTS.md
  const claudeMd = join(workingDir, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    try {
      const content = readFileSync(claudeMd, "utf-8").slice(0, 2000);
      // Extract architecture rules section
      const rulesMatch = content.match(/## Architecture Rules\n([\s\S]*?)(?=\n## |\n$)/);
      if (rulesMatch?.[1]) {
        const rules = rulesMatch[1]
          .split("\n")
          .filter((l) => l.startsWith("- "))
          .map((l) => l.replace(/^- /, ""))
          .slice(0, 5);
        conventions.push(...rules);
      }
    } catch {
      // Skip unreadable
    }
  }

  return conventions;
}

export const conventionsModule: PromptModuleEntry = {
  name: "conventions",
  priority: 55,
  build(ctx: PromptContext): readonly string[] {
    const lines: string[] = [];

    // User-provided conventions from context
    if (ctx.conventions && ctx.conventions.length > 0) {
      lines.push("## Project Conventions");
      for (const conv of ctx.conventions.slice(0, 10)) {
        lines.push(`- ${conv}`);
      }
    }

    // Auto-detected conventions from workspace
    const detected = extractConventions(ctx.workingDir);
    if (detected.length > 0 && lines.length === 0) {
      lines.push("## Project Conventions");
    }
    for (const conv of detected) {
      lines.push(`- ${conv}`);
    }

    return lines;
  },
};
