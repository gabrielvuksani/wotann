/**
 * Shared helper for extracting a file path from a tool_use chunk's
 * `toolInput` record. Previously lived in both `runtime.ts` and
 * `runtime-query-pipeline.ts` verbatim — which meant any key addition
 * had to be made in both places or drift silently. The session-4
 * adversarial audit (Opus Agent 1) caught one such drift: both copies
 * missed `notebook_path`, so PreToolUse hooks couldn't see the file
 * path on `NotebookEdit` tool calls — silently bypassing
 * ConfigProtection / ReadBeforeEdit / TDDEnforcement for notebooks.
 *
 * The keys below mirror the `@anthropic-ai/claude-agent-sdk` tool
 * input shapes (`sdk-tools.d.ts`): Write/Edit/Read/MultiEdit use
 * `file_path`, Glob/Grep use `path`, NotebookEdit uses `notebook_path`,
 * some emulated-tool paths produce `target_file` / `targetPath`.
 */
export function extractTrackedFilePath(toolInput?: Record<string, unknown>): string | null {
  if (!toolInput) return null;

  const candidate =
    toolInput["file_path"] ??
    toolInput["path"] ??
    toolInput["target_file"] ??
    toolInput["targetPath"] ??
    toolInput["notebook_path"];

  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
