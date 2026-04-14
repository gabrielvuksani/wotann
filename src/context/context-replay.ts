/**
 * Context Replay — reconstruct the minimum effective context for a task.
 *
 * Instead of dumping the full conversation history, Context Replay builds
 * a targeted context slice from:
 * - Task description (user intent)
 * - Relevant files (touched or referenced)
 * - Relevant memory entries (decisions, patterns, known issues)
 * - Relevant tool results (only successful and relevant)
 * - Active plan/task state
 *
 * This makes 128K models work like 1M models for focused tasks,
 * and stops 1M models from wasting their window on noise.
 */

export interface ContextSource {
  readonly type: "file" | "memory" | "tool-result" | "conversation" | "plan" | "decision";
  readonly content: string;
  readonly relevanceScore: number;
  readonly tokenEstimate: number;
  readonly source: string;
  readonly timestamp?: number;
}

export interface ReplayBudget {
  readonly maxTokens: number;
  readonly reserveForResponse: number;
  readonly reserveForSystemPrompt: number;
}

export interface ReplayResult {
  readonly sources: readonly ContextSource[];
  readonly totalTokens: number;
  readonly budgetUsed: number;
  readonly budgetRemaining: number;
  readonly droppedSources: number;
  readonly assembledContext: string;
}

export interface TaskContext {
  readonly description: string;
  readonly files: readonly string[];
  readonly recentConversation: readonly { role: string; content: string }[];
  readonly toolResults: readonly { tool: string; output: string; success: boolean; file?: string }[];
  readonly memoryEntries: readonly { key: string; value: string; layer: string; timestamp: number }[];
  readonly activePlan?: string;
  readonly decisions: readonly { decision: string; reasoning: string }[];
}

// ── Relevance Scoring ───────────────────────────────────

function scoreFileRelevance(filePath: string, taskDescription: string, touchedFiles: readonly string[]): number {
  let score = 0;

  // File was recently touched
  if (touchedFiles.includes(filePath)) score += 5;

  // File mentioned in task description
  const fileName = filePath.split("/").pop() ?? "";
  if (taskDescription.toLowerCase().includes(fileName.toLowerCase())) score += 4;

  // Same directory as touched files
  const fileDir = filePath.split("/").slice(0, -1).join("/");
  if (touchedFiles.some((f) => f.startsWith(fileDir))) score += 2;

  // Test file for touched source
  if (fileName.includes(".test.") || fileName.includes(".spec.")) {
    const sourceName = fileName.replace(/\.(test|spec)\./, ".");
    if (touchedFiles.some((f) => f.endsWith(sourceName))) score += 3;
  }

  return score;
}

function scoreMemoryRelevance(entry: { key: string; value: string; timestamp: number }, taskDescription: string): number {
  let score = 0;
  const lowerTask = taskDescription.toLowerCase();
  const lowerKey = entry.key.toLowerCase();
  const lowerValue = entry.value.toLowerCase();

  // Key matches task keywords
  const taskWords = lowerTask.split(/\s+/).filter((w) => w.length > 3);
  for (const word of taskWords) {
    if (lowerKey.includes(word)) score += 3;
    if (lowerValue.includes(word)) score += 1;
  }

  // Recency boost (30-day decay)
  const ageMs = Date.now() - entry.timestamp;
  const ageDays = ageMs / 86_400_000;
  score += Math.max(0, 3 - ageDays * 0.1);

  return score;
}

function scoreToolResultRelevance(
  result: { tool: string; output: string; success: boolean; file?: string },
  taskDescription: string,
  touchedFiles: readonly string[],
): number {
  let score = 0;

  // Only successful results are useful
  if (!result.success) return 0;

  // Result involves a touched file
  if (result.file && touchedFiles.includes(result.file)) score += 4;

  // Tool type relevance (Read/Grep results are context-rich)
  if (result.tool === "Read" || result.tool === "Grep") score += 2;
  if (result.tool === "Bash") score += 1;

  // Content matches task
  const lowerOutput = result.output.toLowerCase();
  const taskWords = taskDescription.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  for (const word of taskWords) {
    if (lowerOutput.includes(word)) score += 1;
  }

  // Penalize very long outputs (less focused)
  if (result.output.length > 5000) score -= 1;

  return Math.max(0, score);
}

// ── Context Assembler ───────────────────────────────────

export function replayContext(task: TaskContext, budget: ReplayBudget): ReplayResult {
  const availableTokens = budget.maxTokens - budget.reserveForResponse - budget.reserveForSystemPrompt;
  const sources: ContextSource[] = [];

  // 1. Active plan always included (highest priority)
  if (task.activePlan) {
    sources.push({
      type: "plan",
      content: task.activePlan,
      relevanceScore: 10,
      tokenEstimate: Math.ceil(task.activePlan.length / 4),
      source: "active-plan",
    });
  }

  // 2. Decisions (always relevant to architectural context)
  for (const decision of task.decisions) {
    sources.push({
      type: "decision",
      content: `Decision: ${decision.decision}\nReasoning: ${decision.reasoning}`,
      relevanceScore: 7,
      tokenEstimate: Math.ceil((decision.decision.length + decision.reasoning.length) / 4),
      source: "decision-log",
    });
  }

  // 3. Score and add file contexts
  for (const file of task.files) {
    const score = scoreFileRelevance(file, task.description, task.files);
    if (score > 0) {
      sources.push({
        type: "file",
        content: `[File: ${file}]`,
        relevanceScore: score,
        tokenEstimate: 50, // Just the reference, not full content
        source: file,
      });
    }
  }

  // 4. Score and add memory entries
  for (const entry of task.memoryEntries) {
    const score = scoreMemoryRelevance(entry, task.description);
    if (score > 1) {
      sources.push({
        type: "memory",
        content: `[${entry.layer}] ${entry.key}: ${entry.value}`,
        relevanceScore: score,
        tokenEstimate: Math.ceil(entry.value.length / 4),
        source: `memory/${entry.layer}`,
        timestamp: entry.timestamp,
      });
    }
  }

  // 5. Score and add tool results
  for (const result of task.toolResults) {
    const score = scoreToolResultRelevance(result, task.description, task.files);
    if (score > 2) {
      const truncated = result.output.length > 2000 ? result.output.slice(0, 2000) + "\n[truncated]" : result.output;
      sources.push({
        type: "tool-result",
        content: `[${result.tool}${result.file ? ` → ${result.file}` : ""}]\n${truncated}`,
        relevanceScore: score,
        tokenEstimate: Math.ceil(truncated.length / 4),
        source: result.tool,
      });
    }
  }

  // 6. Recent conversation (always included, most recent first)
  const recentMessages = task.recentConversation.slice(-6);
  for (let i = 0; i < recentMessages.length; i++) {
    const msg = recentMessages[i]!;
    sources.push({
      type: "conversation",
      content: `${msg.role}: ${msg.content}`,
      relevanceScore: 6 + (i / recentMessages.length), // More recent = higher score
      tokenEstimate: Math.ceil(msg.content.length / 4),
      source: `conversation[${i}]`,
    });
  }

  // Sort by relevance (highest first) and pack into budget
  sources.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const selected: ContextSource[] = [];
  let usedTokens = 0;
  let droppedCount = 0;

  for (const source of sources) {
    if (usedTokens + source.tokenEstimate <= availableTokens) {
      selected.push(source);
      usedTokens += source.tokenEstimate;
    } else {
      droppedCount++;
    }
  }

  // Assemble final context
  const sections: string[] = [];

  // Group by type for clean output
  const byType = new Map<string, ContextSource[]>();
  for (const s of selected) {
    const existing = byType.get(s.type) ?? [];
    existing.push(s);
    byType.set(s.type, existing);
  }

  if (byType.has("plan")) {
    sections.push("## Active Plan");
    for (const s of byType.get("plan")!) sections.push(s.content);
  }

  if (byType.has("decision")) {
    sections.push("\n## Relevant Decisions");
    for (const s of byType.get("decision")!) sections.push(s.content);
  }

  if (byType.has("memory")) {
    sections.push("\n## Memory Context");
    for (const s of byType.get("memory")!) sections.push(s.content);
  }

  if (byType.has("file")) {
    sections.push("\n## Relevant Files");
    for (const s of byType.get("file")!) sections.push(s.content);
  }

  if (byType.has("tool-result")) {
    sections.push("\n## Recent Tool Results");
    for (const s of byType.get("tool-result")!) sections.push(s.content);
  }

  if (byType.has("conversation")) {
    sections.push("\n## Recent Conversation");
    for (const s of byType.get("conversation")!) sections.push(s.content);
  }

  return {
    sources: selected,
    totalTokens: usedTokens,
    budgetUsed: usedTokens,
    budgetRemaining: availableTokens - usedTokens,
    droppedSources: droppedCount,
    assembledContext: sections.join("\n"),
  };
}
