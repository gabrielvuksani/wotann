/**
 * llms.txt prompt module — injects AI-readable project documentation.
 *
 * The llms.txt format is a standardized way to provide AI-readable documentation
 * for a project. If llms.txt or llms-full.txt exists in the working directory,
 * its content is injected into the system prompt.
 *
 * Priority: 72 (between memory at 70 and user at 75)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PromptContext, PromptModuleEntry } from "../engine.js";

const MAX_LLMS_TXT_CHARS = 15_000;

export const llmsTxtPromptModule: PromptModuleEntry = {
  name: "llms-txt",
  priority: 72,
  build(ctx: PromptContext): readonly string[] {
    const workingDir = ctx.workingDir;
    if (!workingDir) return [];

    // Prefer llms-full.txt (more detailed), fall back to llms.txt
    const candidates = [
      join(workingDir, "llms-full.txt"),
      join(workingDir, "llms.txt"),
    ];

    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        try {
          let content = readFileSync(filePath, "utf-8").trim();
          if (content.length === 0) continue;

          const fileName = filePath.endsWith("llms-full.txt") ? "llms-full.txt" : "llms.txt";

          if (content.length > MAX_LLMS_TXT_CHARS) {
            content = content.slice(0, MAX_LLMS_TXT_CHARS) + "\n[TRUNCATED — max 15K chars]";
          }

          return [
            `## Project Documentation (${fileName})`,
            "The following AI-readable documentation was provided by the project.",
            "",
            content,
          ];
        } catch {
          // File read failed — skip silently
          continue;
        }
      }
    }

    return [];
  },
};
