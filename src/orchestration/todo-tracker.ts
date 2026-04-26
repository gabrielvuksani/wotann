/**
 * TodoTracker — persisted subgoal checklist for a task (OpenHands port, P1-B7).
 *
 * Pattern: at task start the agent writes a `todo.md` with an initial
 * checklist of subgoals. Over the course of the task, subgoals are
 * completed, added, or removed. The markdown on disk is the durable
 * source of truth; an in-memory tracker caches the parsed state for
 * fast access and is re-hydrated from disk at construction / reload.
 *
 * Persistence path (default): `<workingDir>/.wotann/todos/<taskId>.md`.
 * The directory is created lazily on first write — tests that never
 * persist won't leave artifacts.
 *
 * Design notes (WOTANN quality bars):
 * - QB #6 honest failures: corrupt todo.md throws `TodoParseError`
 *   with the offending line, never silently returns empty state.
 * - QB #7 per-session state: `TodoRegistry` scopes trackers by
 *   `taskId` with no module-global cache; two concurrent tasks stay
 *   isolated.
 * - QB #1 immutability: `state()` returns a new snapshot object on
 *   every call; internal arrays are not exposed directly.
 */

import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// Public types ---------------------------------------------

export type SubgoalStatus = "pending" | "done";

export interface Subgoal {
  readonly id: string;
  readonly description: string;
  readonly status: SubgoalStatus;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface ScopeChange {
  readonly kind: "added" | "removed" | "completed";
  readonly subgoalId: string;
  readonly description: string;
  readonly at: string;
}

export interface TodoState {
  readonly taskId: string;
  readonly taskSpec: string;
  readonly done: readonly Subgoal[];
  readonly pending: readonly Subgoal[];
  readonly scopeChanges: readonly ScopeChange[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TodoTrackerConfig {
  /** Root directory for persistence. Defaults to `cwd`. */
  readonly workingDir?: string;
  /** Override for the todos subdirectory. Defaults to `.wotann/todos`. */
  readonly todosDir?: string;
  /** Disable persistence (tests). Defaults to true = persist. */
  readonly persist?: boolean;
  /** Clock injection for deterministic testing. */
  readonly now?: () => string;
  /** ID generator for deterministic testing. */
  readonly nextId?: () => string;
}

// Error types ----------------------------------------------

export class TodoParseError extends Error {
  readonly line: string;
  readonly lineNumber: number;
  constructor(reason: string, line: string, lineNumber: number) {
    super(`TodoParseError at line ${lineNumber}: ${reason} — saw: ${line.trim().slice(0, 80)}`);
    this.name = "TodoParseError";
    this.line = line;
    this.lineNumber = lineNumber;
  }
}

export class UnknownSubgoal extends Error {
  readonly subgoalId: string;
  constructor(subgoalId: string) {
    super(`no subgoal with id=${subgoalId}`);
    this.name = "UnknownSubgoal";
    this.subgoalId = subgoalId;
  }
}

// TodoTracker ----------------------------------------------

/**
 * Single-task tracker. Holds one `todo.md` state and persists on every
 * mutation. Instances are task-scoped: there is no global cache.
 */
export class TodoTracker {
  readonly taskId: string;
  private readonly taskSpec: string;
  private readonly subgoals: Subgoal[];
  private readonly scopeChanges: ScopeChange[];
  private readonly createdAt: string;
  private updatedAt: string;
  private readonly persist: boolean;
  private readonly todoPath: string | null;
  private readonly now: () => string;
  private readonly nextId: () => string;

  private constructor(init: {
    taskId: string;
    taskSpec: string;
    subgoals: Subgoal[];
    scopeChanges: ScopeChange[];
    createdAt: string;
    updatedAt: string;
    persist: boolean;
    todoPath: string | null;
    now: () => string;
    nextId: () => string;
  }) {
    this.taskId = init.taskId;
    this.taskSpec = init.taskSpec;
    this.subgoals = init.subgoals;
    this.scopeChanges = init.scopeChanges;
    this.createdAt = init.createdAt;
    this.updatedAt = init.updatedAt;
    this.persist = init.persist;
    this.todoPath = init.todoPath;
    this.now = init.now;
    this.nextId = init.nextId;
  }

  /**
   * Create a new tracker and (optionally) persist todo.md.
   * `subgoals` are the initial pending descriptions.
   */
  static start(
    taskId: string,
    taskSpec: string,
    subgoalDescriptions: readonly string[],
    config: TodoTrackerConfig = {},
  ): TodoTracker {
    if (!taskId || !taskId.trim()) {
      throw new Error("taskId must be non-empty");
    }
    const now = config.now ?? (() => new Date().toISOString());
    const nextId = config.nextId ?? (() => randomUUID());
    const createdAt = now();
    const persist = config.persist ?? true;
    const todoPath = persist ? resolveTodoPath(taskId, config) : null;

    const subgoals: Subgoal[] = subgoalDescriptions.map((desc) => ({
      id: nextId(),
      description: desc.trim(),
      status: "pending",
      createdAt,
    }));
    const tracker = new TodoTracker({
      taskId,
      taskSpec: taskSpec.trim(),
      subgoals,
      scopeChanges: [],
      createdAt,
      updatedAt: createdAt,
      persist,
      todoPath,
      now,
      nextId,
    });
    tracker.flush();
    return tracker;
  }

  /**
   * Re-hydrate a tracker from its persisted todo.md on disk.
   * Throws `TodoParseError` if the file is malformed, or a plain
   * Error if the file does not exist.
   */
  static load(taskId: string, config: TodoTrackerConfig = {}): TodoTracker {
    const todoPath = resolveTodoPath(taskId, config);
    if (!existsSync(todoPath)) {
      throw new Error(`todo.md not found for taskId=${taskId} at ${todoPath}`);
    }
    const raw = readFileSync(todoPath, "utf-8");
    const parsed = parseTodoMd(raw);
    const now = config.now ?? (() => new Date().toISOString());
    const nextId = config.nextId ?? (() => randomUUID());
    return new TodoTracker({
      taskId,
      taskSpec: parsed.taskSpec,
      subgoals: [...parsed.subgoals],
      scopeChanges: [...parsed.scopeChanges],
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      persist: config.persist ?? true,
      todoPath,
      now,
      nextId,
    });
  }

  /** Immutable snapshot of current state. */
  state(): TodoState {
    const done = this.subgoals.filter((s) => s.status === "done");
    const pending = this.subgoals.filter((s) => s.status === "pending");
    return Object.freeze({
      taskId: this.taskId,
      taskSpec: this.taskSpec,
      done: Object.freeze([...done]),
      pending: Object.freeze([...pending]),
      scopeChanges: Object.freeze([...this.scopeChanges]),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }

  /** Mark a subgoal complete. Throws UnknownSubgoal on bad id. */
  complete(subgoalId: string): Subgoal {
    const idx = this.subgoals.findIndex((s) => s.id === subgoalId);
    if (idx < 0) throw new UnknownSubgoal(subgoalId);
    const existing = this.subgoals[idx];
    if (!existing) throw new UnknownSubgoal(subgoalId);
    const completedAt = this.now();
    const next: Subgoal = {
      ...existing,
      status: "done",
      completedAt,
    };
    this.subgoals[idx] = next;
    this.scopeChanges.push({
      kind: "completed",
      subgoalId,
      description: existing.description,
      at: completedAt,
    });
    this.updatedAt = completedAt;
    this.flush();
    return next;
  }

  /** Add a new pending subgoal. Returns its generated id. */
  add(description: string): Subgoal {
    const trimmed = description.trim();
    if (!trimmed) throw new Error("subgoal description must be non-empty");
    const createdAt = this.now();
    const subgoal: Subgoal = {
      id: this.nextId(),
      description: trimmed,
      status: "pending",
      createdAt,
    };
    this.subgoals.push(subgoal);
    this.scopeChanges.push({
      kind: "added",
      subgoalId: subgoal.id,
      description: trimmed,
      at: createdAt,
    });
    this.updatedAt = createdAt;
    this.flush();
    return subgoal;
  }

  /** Remove a subgoal. Throws UnknownSubgoal on bad id. */
  remove(subgoalId: string): void {
    const idx = this.subgoals.findIndex((s) => s.id === subgoalId);
    if (idx < 0) throw new UnknownSubgoal(subgoalId);
    const existing = this.subgoals[idx];
    if (!existing) throw new UnknownSubgoal(subgoalId);
    this.subgoals.splice(idx, 1);
    const removedAt = this.now();
    this.scopeChanges.push({
      kind: "removed",
      subgoalId,
      description: existing.description,
      at: removedAt,
    });
    this.updatedAt = removedAt;
    this.flush();
  }

  /** Force a reload from disk; discards in-memory state. */
  reload(): void {
    if (!this.todoPath) return;
    if (!existsSync(this.todoPath)) return;
    const raw = readFileSync(this.todoPath, "utf-8");
    const parsed = parseTodoMd(raw);
    this.subgoals.splice(0, this.subgoals.length, ...parsed.subgoals);
    this.scopeChanges.splice(0, this.scopeChanges.length, ...parsed.scopeChanges);
    this.updatedAt = parsed.updatedAt;
  }

  /** Path to the todo.md file, or null if persistence disabled. */
  get path(): string | null {
    return this.todoPath;
  }

  private flush(): void {
    if (!this.persist || !this.todoPath) return;
    const dir = dirname(this.todoPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Wave 6.5-UU (H-22) — todo-tracker persistence. Atomic write.
    writeFileAtomic(this.todoPath, renderTodoMd(this.state()), { encoding: "utf-8" });
  }
}

// Registry (per-session, no module global) -----------------

/**
 * Owns a `Map<taskId, TodoTracker>` with no module-global state — two
 * separate `TodoRegistry` instances never share trackers, so concurrent
 * sessions cannot cross-contaminate (QB #7).
 */
export class TodoRegistry {
  private readonly trackers = new Map<string, TodoTracker>();
  private readonly config: TodoTrackerConfig;

  constructor(config: TodoTrackerConfig = {}) {
    this.config = config;
  }

  start(taskId: string, taskSpec: string, subgoalDescriptions: readonly string[]): TodoTracker {
    if (this.trackers.has(taskId)) {
      throw new Error(`tracker for taskId=${taskId} already exists`);
    }
    const tracker = TodoTracker.start(taskId, taskSpec, subgoalDescriptions, this.config);
    this.trackers.set(taskId, tracker);
    return tracker;
  }

  get(taskId: string): TodoTracker | null {
    return this.trackers.get(taskId) ?? null;
  }

  load(taskId: string): TodoTracker {
    const tracker = TodoTracker.load(taskId, this.config);
    this.trackers.set(taskId, tracker);
    return tracker;
  }

  drop(taskId: string): boolean {
    return this.trackers.delete(taskId);
  }

  size(): number {
    return this.trackers.size;
  }
}

// Markdown serialization -----------------------------------

function resolveTodoPath(taskId: string, config: TodoTrackerConfig): string {
  const workingDir = config.workingDir ?? process.cwd();
  const todosDir = config.todosDir ?? join(workingDir, ".wotann", "todos");
  return join(todosDir, `${sanitize(taskId)}.md`);
}

function sanitize(taskId: string): string {
  // Keep the file name filesystem-safe on all platforms.
  return taskId.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Render the tracker state as a stable, human-editable markdown file.
 * The format is intentionally simple so a human can edit the file
 * between turns and `reload()` will pick up the change.
 */
export function renderTodoMd(state: TodoState): string {
  const lines: string[] = [];
  lines.push(`# Task: ${state.taskId}`);
  lines.push("");
  lines.push("<!-- WOTANN todo.md v1 — machine-edited, do not delete -->");
  lines.push(`<!-- created-at: ${state.createdAt} -->`);
  lines.push(`<!-- updated-at: ${state.updatedAt} -->`);
  lines.push("");
  lines.push("## Spec");
  lines.push("");
  lines.push(state.taskSpec || "(no spec)");
  lines.push("");
  lines.push("## Subgoals");
  lines.push("");
  for (const sg of [...state.done, ...state.pending]) {
    const box = sg.status === "done" ? "[x]" : "[ ]";
    const meta = sg.completedAt
      ? ` <!-- id=${sg.id} created=${sg.createdAt} completed=${sg.completedAt} -->`
      : ` <!-- id=${sg.id} created=${sg.createdAt} -->`;
    lines.push(`- ${box} ${sg.description}${meta}`);
  }
  if (state.done.length === 0 && state.pending.length === 0) {
    lines.push("(no subgoals)");
  }
  lines.push("");
  lines.push("## Scope changes");
  lines.push("");
  if (state.scopeChanges.length === 0) {
    lines.push("(none)");
  } else {
    for (const change of state.scopeChanges) {
      lines.push(
        `- ${change.at} — ${change.kind}: ${change.description} <!-- id=${change.subgoalId} -->`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

interface ParsedTodo {
  taskSpec: string;
  subgoals: Subgoal[];
  scopeChanges: ScopeChange[];
  createdAt: string;
  updatedAt: string;
}

export function parseTodoMd(raw: string): ParsedTodo {
  const lines = raw.split(/\r?\n/);
  let section: "header" | "spec" | "subgoals" | "scope" = "header";
  const subgoals: Subgoal[] = [];
  const scopeChanges: ScopeChange[] = [];
  const specLines: string[] = [];
  let createdAt = "";
  let updatedAt = "";
  let sawTitle = false;
  let sawSpecHeader = false;
  let sawSubgoalsHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("# Task:")) {
      sawTitle = true;
      continue;
    }
    if (trimmed.startsWith("<!-- created-at:")) {
      const m = /created-at:\s*([^\s-][^\s>]*)/.exec(trimmed);
      if (m && m[1]) createdAt = m[1];
      continue;
    }
    if (trimmed.startsWith("<!-- updated-at:")) {
      const m = /updated-at:\s*([^\s-][^\s>]*)/.exec(trimmed);
      if (m && m[1]) updatedAt = m[1];
      continue;
    }
    if (trimmed === "## Spec") {
      section = "spec";
      sawSpecHeader = true;
      continue;
    }
    if (trimmed === "## Subgoals") {
      section = "subgoals";
      sawSubgoalsHeader = true;
      continue;
    }
    if (trimmed === "## Scope changes") {
      section = "scope";
      continue;
    }
    if (trimmed.startsWith("<!--")) continue;
    if (trimmed === "") continue;

    if (section === "spec") {
      specLines.push(line);
      continue;
    }
    if (section === "subgoals") {
      if (trimmed === "(no subgoals)") continue;
      if (!trimmed.startsWith("- ")) {
        throw new TodoParseError("expected subgoal bullet", line, i + 1);
      }
      const parsed = parseSubgoalLine(line, i + 1);
      subgoals.push(parsed);
      continue;
    }
    if (section === "scope") {
      if (trimmed === "(none)") continue;
      if (!trimmed.startsWith("- ")) {
        throw new TodoParseError("expected scope-change bullet", line, i + 1);
      }
      scopeChanges.push(parseScopeLine(line, i + 1));
      continue;
    }
  }

  if (!sawTitle) throw new TodoParseError("missing '# Task:' header", "", 0);
  if (!sawSpecHeader) throw new TodoParseError("missing '## Spec' section", "", 0);
  if (!sawSubgoalsHeader) throw new TodoParseError("missing '## Subgoals' section", "", 0);

  // filter trailing blank lines from spec
  while (specLines.length > 0 && (specLines[specLines.length - 1] ?? "").trim() === "") {
    specLines.pop();
  }
  const taskSpec = specLines.join("\n").trim() === "(no spec)" ? "" : specLines.join("\n").trim();

  if (!createdAt) createdAt = new Date().toISOString();
  if (!updatedAt) updatedAt = createdAt;
  return { taskSpec, subgoals, scopeChanges, createdAt, updatedAt };
}

function parseSubgoalLine(line: string, lineNumber: number): Subgoal {
  // Expected form: `- [x] description <!-- id=... created=... completed=... -->`
  const bulletMatch = /^- \[( |x)\] (.+)$/.exec(line.trim());
  if (!bulletMatch || !bulletMatch[1] || !bulletMatch[2]) {
    throw new TodoParseError("malformed subgoal bullet", line, lineNumber);
  }
  const status: SubgoalStatus = bulletMatch[1] === "x" ? "done" : "pending";
  const rest = bulletMatch[2];
  const commentMatch = /<!--\s*(.*?)\s*-->/.exec(rest);
  const description = commentMatch ? rest.replace(commentMatch[0], "").trim() : rest.trim();
  if (!description) {
    throw new TodoParseError("empty subgoal description", line, lineNumber);
  }
  const meta = parseMetaComment(commentMatch?.[1] ?? "");
  const id = meta.id ?? randomUUID();
  const createdAt = meta.created ?? "";
  const completedAt = meta.completed;
  const subgoal: Subgoal = completedAt
    ? { id, description, status, createdAt, completedAt }
    : { id, description, status, createdAt };
  return subgoal;
}

function parseScopeLine(line: string, lineNumber: number): ScopeChange {
  // Expected form: `- <iso-ts> — kind: description <!-- id=... -->`
  const match = /^-\s+(\S+)\s+[—-]\s+(\w+):\s*(.*)$/.exec(line.trim());
  if (!match || !match[1] || !match[2] || match[3] === undefined) {
    throw new TodoParseError("malformed scope-change bullet", line, lineNumber);
  }
  const at = match[1];
  const kindRaw = match[2];
  if (kindRaw !== "added" && kindRaw !== "removed" && kindRaw !== "completed") {
    throw new TodoParseError(`unknown scope-change kind '${kindRaw}'`, line, lineNumber);
  }
  const rest = match[3];
  const commentMatch = /<!--\s*(.*?)\s*-->/.exec(rest);
  const description = commentMatch ? rest.replace(commentMatch[0], "").trim() : rest.trim();
  const meta = parseMetaComment(commentMatch?.[1] ?? "");
  const subgoalId = meta.id ?? "";
  if (!subgoalId) {
    throw new TodoParseError("scope-change missing id=", line, lineNumber);
  }
  return { kind: kindRaw, subgoalId, description, at };
}

function parseMetaComment(comment: string): { id?: string; created?: string; completed?: string } {
  const out: { id?: string; created?: string; completed?: string } = {};
  for (const part of comment.split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (!value) continue;
    if (key === "id") out.id = value;
    else if (key === "created") out.created = value;
    else if (key === "completed") out.completed = value;
  }
  return out;
}
