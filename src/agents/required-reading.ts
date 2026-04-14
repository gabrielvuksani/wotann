/**
 * required_reading support for agent specs (E13).
 *
 * GSD pattern: an agent's YAML spec may declare a list of documents that
 * MUST be loaded into context before the agent acts. This prevents the
 * common failure mode where an agent starts work without having read the
 * project's conventions, security rules, or domain-specific briefs.
 *
 * YAML shape:
 *   ```yaml
 *   name: security-reviewer
 *   required_reading:
 *     - .wotann/AGENTS.md
 *     - docs/SECURITY.md
 *     - {path: docs/OWASP_top10.md, optional: true}
 *   ```
 *
 * At boot, we resolve each item, read the file, and prepend its contents
 * to the agent's system prompt with a provenance marker (integrates with
 * instruction-provenance.ts so users can trace which rule came from where).
 */

import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export type RequiredReadingItem =
  | string
  | {
      readonly path: string;
      readonly optional?: boolean;
      readonly maxChars?: number;
      readonly label?: string;
    };

export interface ResolvedRequiredReading {
  readonly source: string;
  readonly content: string;
  readonly optional: boolean;
  readonly truncated: boolean;
  readonly error?: string;
}

export interface RequiredReadingOptions {
  readonly workspaceRoot: string;
  readonly defaultMaxCharsPerFile?: number;
  readonly totalBudgetChars?: number;
}

/**
 * Load every required_reading item. Missing optional items are skipped;
 * missing non-optional items produce an error entry so the caller can
 * refuse to start the agent.
 */
export function loadRequiredReading(
  items: readonly RequiredReadingItem[],
  options: RequiredReadingOptions,
): readonly ResolvedRequiredReading[] {
  const defaultMax = options.defaultMaxCharsPerFile ?? 8_000;
  const totalBudget = options.totalBudgetChars ?? 40_000;
  const out: ResolvedRequiredReading[] = [];
  let consumed = 0;

  for (const raw of items) {
    const normalised = typeof raw === "string" ? { path: raw, optional: false } : raw;
    const { path: itemPath, optional = false, maxChars = defaultMax, label } = normalised;
    const resolved = isAbsolute(itemPath) ? itemPath : join(options.workspaceRoot, itemPath);
    const displayPath = label ?? (relative(options.workspaceRoot, resolved) || resolved);

    if (!existsSync(resolved)) {
      out.push({
        source: displayPath,
        content: "",
        optional,
        truncated: false,
        error: "file does not exist",
      });
      continue;
    }

    try {
      let content = readFileSync(resolved, "utf-8");
      let truncated = false;

      // Per-file cap
      if (content.length > maxChars) {
        content = `${content.slice(0, maxChars)}\n\n[truncated: file exceeded ${maxChars} chars]`;
        truncated = true;
      }

      // Budget cap across all files
      const remaining = totalBudget - consumed;
      if (remaining <= 0) {
        out.push({
          source: displayPath,
          content: "",
          optional,
          truncated: true,
          error: "total required-reading budget exhausted",
        });
        continue;
      }
      if (content.length > remaining) {
        content = `${content.slice(0, remaining)}\n\n[truncated: total budget exhausted]`;
        truncated = true;
      }

      consumed += content.length;
      out.push({ source: displayPath, content, optional, truncated });
    } catch (err) {
      out.push({
        source: displayPath,
        content: "",
        optional,
        truncated: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}

/**
 * Render the required-reading block as a single string ready to splice
 * into the system prompt. Files appear in order; missing/errored files
 * surface their error so the model can reason about missing context.
 */
export function renderRequiredReadingBlock(resolved: readonly ResolvedRequiredReading[]): string {
  if (resolved.length === 0) return "";
  const blocks: string[] = ["<required_reading>"];
  for (const item of resolved) {
    if (item.error && !item.optional) {
      blocks.push(`<file path="${item.source}" status="error">${item.error}</file>`);
      continue;
    }
    if (item.error && item.optional) continue; // skip silently
    blocks.push(`<file path="${item.source}"${item.truncated ? ' truncated="true"' : ""}>`);
    blocks.push(item.content);
    blocks.push(`</file>`);
  }
  blocks.push("</required_reading>");
  return blocks.join("\n");
}

/**
 * Predicate — true if any mandatory file failed to load. Callers can use
 * this to abort agent boot instead of silently proceeding.
 */
export function hasMandatoryFailures(resolved: readonly ResolvedRequiredReading[]): boolean {
  return resolved.some((r) => r.error && !r.optional);
}
